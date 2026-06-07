#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { getCodexDefaultResolvedRuntime } from "@agentarena/adapters";
import {
  loadRunState,
  logger,
  saveRunState,
} from "@agentarena/core";
import type { ParsedArgs } from "../args.js";
import {
  generateAuthToken,
  setTrustProxy,
  startRateLimitCleanup,
} from "../server.js";
import {
  fromUiRunState,
  toUiRunState,
  type UiRunLogEntry,
  type UiRunStatus,
} from "./shared.js";
import {
  type ActiveUiRun,
  createRequestHandler,
} from "./ui-routes.js";

const DEFAULT_UI_PORT = 4320;
const MAX_UI_LOG_ENTRIES = 30;

function maybeOpenBrowser(url: string): void {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd.exe" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true, shell: false });
  child.on("error", () => {});
  child.unref();
}

export async function runUi(parsed: ParsedArgs): Promise<void> {
  const host = parsed.host ?? "127.0.0.1";
  const port = parsed.port ?? DEFAULT_UI_PORT;
  const isLocalhost = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "::ffff:127.0.0.1";
  // Token priority: --auth-token > AGENTARENA_AUTH_TOKEN env > auto-generated
  const authTokenSource = parsed.authToken?.trim() ? "cli" : process.env.AGENTARENA_AUTH_TOKEN?.trim() ? "env" : "auto";
  const authToken = parsed.authToken?.trim() || process.env.AGENTARENA_AUTH_TOKEN?.trim() || generateAuthToken();
  if (!isLocalhost && authTokenSource === "auto") {
    logger.warn(
      "server",
      "auth.auto_generated",
      "WARNING: Auth token was auto-generated for non-localhost binding. Set AGENTARENA_AUTH_TOKEN or use --auth-token for stable authentication."
    );
  }
  let activeRun: ActiveUiRun | null = null;
  /** Generation counter to prevent stale finally blocks from corrupting new run state. */
  let runGeneration = 0;
  /**
   * Mutex flag for concurrent run requests.
   *
   * Problem: Between checking `activeRun === null` and assigning `activeRun = { ... }`,
   * there are `await` points (e.g., readRequestBody) where another request can sneak in.
   * This flag is set synchronously BEFORE any await, preventing the TOCTOU race.
   *
   * Reset points (5 total — missing any one causes deadlock):
   *   1. readRequestBody failure (line ~388)
   *   2. JSON parse failure (line ~395)
   *   3. validateRunPayload failure (line ~402)
   *   4. Empty selections (line ~409)
   *   5. Successful run start — transferred to activeRun (line ~444)
   */
  let runStarting = false;
  const codexDefaults = await getCodexDefaultResolvedRuntime();

  /**
   * Run state machine.
   *
   * States: idle | running | done | error | cancelled | cancelling
   * Phases: idle | starting | preflight | benchmark | report | complete
   *
   * Transitions:
   *   idle       → running     (POST /api/run accepted)
   *   running    → done        (benchmark completes normally)
   *   running    → error       (benchmark throws)
   *   running    → cancelling  (POST /api/run/cancel)
   *   running    → cancelled   (abort signal propagates)
   *   cancelling → cancelled   (abort completes)
   *   *          → error       (server restart recovery — persisted state was running)
   *
   * Guard: finally block must NOT overwrite "error" or "cancelled" with "done".
   */
  let activeRunStatus: UiRunStatus = {
    state: "idle",
    phase: "idle",
    logs: [],
    updatedAt: new Date().toISOString()
  };

  // Restore persisted run state on startup
  try {
    const persistedState = await loadRunState(process.cwd());
    if (persistedState && persistedState.state === "running") {
      // Server crashed while a run was in progress — mark it as error
      activeRunStatus = {
        ...persistedState,
        state: "error",
        phase: "idle",
        error: "Server restarted while run was in progress. Previous run state was recovered.",
        updatedAt: new Date().toISOString()
      };
      await saveRunState(process.cwd(), toUiRunState(activeRunStatus));
    } else if (persistedState) {
      activeRunStatus = fromUiRunState(persistedState);
    }
  } catch (error) {
    logger.warn("server", "run_state.restore_failed", `Failed to restore persisted run state: ${error instanceof Error ? error.message : String(error)}`, {
      error
    });
  }

  /**
   * Debounced persistence. Run state can change rapidly during a benchmark
   * (every preflight, every agent start/finish, every progress event). Without
   * debouncing, each change fires a JSON.stringify + atomic file write, which
   * stalls the hot path and saturates disk. A 750ms trailing debounce coalesces
   * a burst of updates into a single write at the end of the burst.
   *
   * We always re-read activeRunStatus inside the timer so the persisted state
   * reflects the latest mutation, not the snapshot captured when the timer was
   * scheduled.
   *
   * Note: debounced writes are lost on SIGKILL. This is acceptable because run state
   * is best-effort recovery data, not source of truth.
   */
  const RUN_STATE_SAVE_DEBOUNCE_MS = 750;
  let pendingSaveHandle: ReturnType<typeof setTimeout> | undefined;
  const scheduleSaveRunState = (): void => {
    if (pendingSaveHandle) return; // a save is already scheduled; it will pick up latest activeRunStatus
    pendingSaveHandle = setTimeout(() => {
      pendingSaveHandle = undefined;
      saveRunState(process.cwd(), toUiRunState(activeRunStatus)).catch((err: unknown) => {
        // saveRunState already logs internally, but log here too so the call-site
        // failure is correlated with the request that triggered it.
        logger.warn("server", "run_state.persist_failed", `scheduleSaveRunState: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, RUN_STATE_SAVE_DEBOUNCE_MS);
  };

  const setRunStatus = (status: Partial<UiRunStatus>): void => {
    activeRunStatus = {
      ...activeRunStatus,
      ...status,
      updatedAt: new Date().toISOString()
    };
    scheduleSaveRunState();
  };

  const appendRunLog = (entry: Omit<UiRunLogEntry, "timestamp">): void => {
    const nextEntry: UiRunLogEntry = {
      ...entry,
      timestamp: new Date().toISOString()
    };
    activeRunStatus = {
      ...activeRunStatus,
      logs: [...activeRunStatus.logs, nextEntry].slice(-MAX_UI_LOG_ENTRIES),
      updatedAt: nextEntry.timestamp
    };
    scheduleSaveRunState();
  };

  /**
   * Force-flush any pending debounced save. Called at terminal lifecycle moments
   * (run end, server shutdown) so a debounced write doesn't get lost.
   */
  const flushSaveRunState = async (): Promise<void> => {
    if (pendingSaveHandle) {
      clearTimeout(pendingSaveHandle);
      pendingSaveHandle = undefined;
    }
    await saveRunState(process.cwd(), toUiRunState(activeRunStatus)).catch((err: unknown) => {
      logger.warn("server", "run_state.persist_failed", `flushSaveRunState: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  // Configure proxy trust if requested
  if (parsed.trustProxy) {
    setTrustProxy(true);
  }

  // Periodically clean up stale rate limit entries to prevent memory leaks
  const rateLimitCleanupInterval = startRateLimitCleanup();

  const requestHandler = createRequestHandler({
    host,
    port,
    isLocalhost,
    authToken,
    codexDefaults,
    get activeRun() { return activeRun; },
    setActiveRun: (run) => { activeRun = run; },
    get activeRunStatus() { return activeRunStatus; },
    setActiveRunStatus: (status) => { activeRunStatus = status; },
    appendRunLog,
    setRunStatus,
    get runGeneration() { return runGeneration; },
    incrementRunGeneration: () => ++runGeneration,
    get runStarting() { return runStarting; },
    setRunStarting: (val) => { runStarting = val; },
    flushSaveRunState,
  });

  const server = http.createServer(requestHandler);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });
  } catch (err) {
    clearInterval(rateLimitCleanupInterval);
    const errorCode = (err as NodeJS.ErrnoException | undefined)?.code;
    if (errorCode === "EADDRINUSE") {
      const nextPort = port + 1;
      throw new Error(
        `Port ${port} is already in use.\n` +
        `  Another AgentArena instance or another process is using this port.\n` +
        `  Try: agentarena ui --port ${nextPort}\n` +
        `  Or kill the process: netstat -ano | findstr :${port}  (Windows)\n` +
        `                       lsof -i :${port}                (macOS/Linux)`
      );
    }
    throw err;
  }

  const url = `http://${host}:${port}`;
  console.log(`\nAgentArena UI server running`);
  console.log(`url=${url}`);
  console.log(`repo=${process.cwd()}`);
  const authTokenFilePath = path.join(process.cwd(), ".agentarena", "last-auth-token");
  await fs.mkdir(path.dirname(authTokenFilePath), { recursive: true });
  await fs.writeFile(authTokenFilePath, authToken, { encoding: "utf8", mode: 0o600 });
  // Restrict file permissions to owner-only.
  // On Unix: fs.chmod(0o600) is sufficient.
  // On Windows: fs.chmod is a no-op; use icacls to restrict to the current user.
  if (process.platform === "win32") {
    try {
      const { execFileSync } = await import("node:child_process");
      const username = process.env.USERNAME || process.env.USER;
      if (username) {
        // Remove inherited permissions, grant full control only to current user.
        // (F) — not (R) — so the owner retains write+delete: overwriting the token on a
        // later launch and cleaning up the file both require those rights on Windows.
        execFileSync("icacls", [authTokenFilePath, "/inheritance:r", "/grant:r", `${username}:(F)`], {
          stdio: "ignore",
          timeout: 5000,
          windowsHide: true,
        });
      }
    } catch {
      logger.warn("server", "auth.token_acl", "Failed to set Windows ACL on auth token file. The token may be readable by other users on this machine.");
    }
  } else {
    await fs.chmod(authTokenFilePath, 0o600).catch(() => {});
  }
  // Never print the token (or any prefix of it) to stdout — CI logs and terminal
  // scrollback capture stdout, and even a partial prefix narrows brute force.
  // Don't include the token in the URL fragment either: browser history persists it.
  // Operators retrieve the token by reading the file path printed below.
  console.log(`auth_token_file=${authTokenFilePath}`);
  if (!isLocalhost) {
    console.log(`\n  Non-localhost access requires authentication.`);
    console.log(`  Token file: ${authTokenFilePath}`);
    console.log(`  Browser URL: ${url}    (paste the token from the file when prompted)\n`);
  } else {
    console.log(`  WARNING: The token in ${authTokenFilePath} grants full API access. Do not share it.`);
  }

  if (!parsed.noOpen) {
    maybeOpenBrowser(url);
  }

  await new Promise<void>((resolve) => {
    const closeServer = () => {
      clearInterval(rateLimitCleanupInterval);
      // Flush any pending debounced run-state write before the process exits.
      flushSaveRunState()
        .catch(() => {})
        .finally(() => server.close(() => resolve()));
    };

    process.once("SIGINT", closeServer);
    process.once("SIGTERM", closeServer);
  });
}
