#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { getCodexDefaultResolvedRuntime } from "@agentarena/adapters";
import { logger } from "@agentarena/core";
import type { ParsedArgs } from "../args.js";
import { formatLocalUiOrigin, isLocalUiHost } from "../local-only.js";
import {
  generateAuthToken,
  setTrustProxy,
  startRateLimitCleanup,
} from "../server/index.js";
import { createUiAuthBootstrap } from "./ui-auth-bootstrap.js";
import { createRequestHandler } from "./ui-routes.js";
import { UiRunStateController } from "./ui-run-state.js";

const DEFAULT_UI_PORT = 4320;

/**
 * Validate a host string for safe use in a browser URL / `start` invocation.
 * Rejects anything containing shell/redirect metacharacters or whitespace that
 * could let a crafted `--host` value break out of the URL and inject commands.
 */
function isValidHost(host: string): boolean {
  return (
    /^[a-zA-Z0-9.\-:[\]]+$/.test(host) &&
    !host.includes(" ") &&
    !host.includes('"') &&
    !host.includes("'")
  );
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Only open the browser for a well-formed http(s) URL built from a valid host/port. */
function maybeOpenBrowser(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    logger.warn("server", "browser.skip", `Refusing to open malformed URL: ${url}`);
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    logger.warn("server", "browser.skip", `Refusing to open non-http(s) URL: ${url}`);
    return;
  }
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
  if (!isLocalUiHost(host)) {
    throw new Error("AgentArena UI only supports local addresses: 127.0.0.1, localhost, ::1, or ::ffff:127.0.0.1.");
  }
  if (!isValidPort(port)) {
    throw new Error(`Invalid port: "${port}". Port must be an integer in 1-65535.`);
  }
  // Token priority: --auth-token > AGENTARENA_AUTH_TOKEN env > auto-generated
  const authToken = parsed.authToken?.trim() || process.env.AGENTARENA_AUTH_TOKEN?.trim() || generateAuthToken();
  const authBootstrap = parsed.noOpen ? undefined : createUiAuthBootstrap(authToken);
  const runState = new UiRunStateController(process.cwd());
  await runState.restore();
  const codexDefaults = await getCodexDefaultResolvedRuntime();

  // Configure proxy trust if requested
  if (parsed.trustProxy) {
    setTrustProxy(true);
  }

  // Periodically clean up stale rate limit entries to prevent memory leaks
  const rateLimitCleanupInterval = startRateLimitCleanup();

  const requestHandler = createRequestHandler({
    host,
    port,
    isLocalhost: true,
    authToken,
    exchangeAuthBootstrap: authBootstrap?.exchange,
    codexDefaults,
    get activeRun() { return runState.activeRun; },
    setActiveRun: (run) => runState.setActiveRun(run),
    get activeRunStatus() { return runState.status; },
    setActiveRunStatus: (status) => runState.replaceStatus(status),
    appendRunLog: (entry) => runState.appendLog(entry),
    setRunStatus: (status) => runState.setStatus(status),
    get runGeneration() { return runState.generation; },
    incrementRunGeneration: () => runState.nextGeneration(),
    tryReserveStart: () => runState.tryReserveStart(),
    releaseStartReservation: () => runState.releaseStartReservation(),
    flushSaveRunState: () => runState.flush(),
    rememberLogStore: (runId, store) => runState.rememberLogStore(runId, store),
    getLogStore: (runId) => runState.getLogStore(runId),
    clearPersistedRunState: () => runState.clearPersisted()
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

  if (!isValidHost(host) || !isValidPort(port)) {
    throw new Error(`Invalid host or port: "${host}:${port}". Host must be a hostname/IP and port an integer in 1-65535.`);
  }

  const url = formatLocalUiOrigin(host, port);
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
  // The real token is never included in the opened URL.
  // Operators retrieve the token by reading the file path printed below.
  console.log(`auth_token_file=${authTokenFilePath}`);
  console.log(`  WARNING: The token in ${authTokenFilePath} grants full API access. Do not share it.`);

  if (!parsed.noOpen) {
    maybeOpenBrowser(`${url}/workbench/#bootstrap=${encodeURIComponent(authBootstrap?.code ?? "")}`);
  }

  await new Promise<void>((resolve) => {
    const closeServer = () => {
      clearInterval(rateLimitCleanupInterval);
      // Flush any pending debounced run-state write before the process exits.
      runState.flush()
        .catch((error: unknown) => {
          logger.warn("server", "run_state.persist_failed", `shutdown flush: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => server.close(() => resolve()));
    };

    process.once("SIGINT", closeServer);
    process.once("SIGTERM", closeServer);
  });
}
