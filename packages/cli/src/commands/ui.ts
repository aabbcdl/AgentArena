#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { getCodexDefaultResolvedRuntime } from "@agentarena/adapters";
import {
  clearRunState,
  createCancellation,
  createRunId,
  isAbortError,
  loadRunState,
  metrics,
  saveRunState,
} from "@agentarena/core";
import { writeReport } from "@agentarena/report";
import { type BenchmarkProgressEvent, runBenchmark } from "@agentarena/runner";
import type { ParsedArgs } from "../args.js";
import {
  checkAuthHeader,
  checkCorsOrigin,
  checkRateLimit,
  detectContentType,
  generateAuthToken,
  getClientIp,
  HttpError,
  jsonResponse,
  readRequestBody,
  setTrustProxy,
  startRateLimitCleanup,
  textResponse,
} from "../server.js";
import {
  handleAdaptersList,
  handleAdhocTaskpackDelete,
  handleAdhocTaskpacksList,
  handleCreateAdhocTaskpack,
  handlePreflight,
  handleProviderProfileCreate,
  handleProviderProfileDelete,
  handleProviderProfileSecret,
  handleProviderProfilesGet,
  handleProviderProfileUpdate,
  handleTaskpacksList,
  handleUiInfo,
  withErrorHandling,
} from "./api-routes.js";
import {
  normalizeUiSelections,
  resolveReportLocale,
  type UiRunLogEntry,
  type UiRunPayload,
  type UiRunStatus,
  WORKSPACE_ROOT,
} from "./shared.js";

const DEFAULT_UI_PORT = 4320;
const MAX_UI_LOG_ENTRIES = 30;

/**
 * Validate a run payload from the UI. Returns an error message if invalid, or null if valid.
 * This is a pure validation function with no side effects.
 */
function validateRunPayload(runPayload: UiRunPayload): string | null {
  if (!runPayload.repoPath || typeof runPayload.repoPath !== "string") {
    return "repoPath is required and must be a string.";
  }
  if (!runPayload.taskPath || typeof runPayload.taskPath !== "string") {
    return "taskPath is required and must be a string.";
  }
  // Path containment checks (security: prevent path traversal)
  const resolvedRepoPath = path.resolve(runPayload.repoPath);
  const resolvedTaskPath = path.resolve(runPayload.taskPath);
  const cwd = process.cwd();
  if (!resolvedRepoPath.startsWith(cwd + path.sep) && resolvedRepoPath !== cwd) {
    return "repoPath must be within the current working directory.";
  }
  if (!resolvedTaskPath.startsWith(cwd + path.sep) && resolvedTaskPath !== cwd) {
    return "taskPath must be within the current working directory.";
  }
  // Numeric validation
  if (runPayload.maxConcurrency !== undefined) {
    const parsed = Number(runPayload.maxConcurrency);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return "maxConcurrency must be a positive integer.";
    }
  }
  if (runPayload.tokenBudget !== undefined) {
    const parsed = Number(runPayload.tokenBudget);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return "tokenBudget must be a positive number.";
    }
  }
  return null;
}

const WEB_REPORT_DIST_ROOT = path.join(WORKSPACE_ROOT, "apps", "web-report", "dist");

interface ActiveUiRun {
  promise: Promise<unknown>;
  cancel: () => void;
}

function maybeOpenBrowser(url: string): void {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd.exe" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true, shell: false });
  child.on("error", () => {});
  child.unref();
}

/**
 * Helper to send an ApiResponse to the HTTP response.
 */
function sendApiResponse(response: http.ServerResponse, apiResponse: { statusCode: number; body: string; headers: Record<string, string> }): void {
  response.writeHead(apiResponse.statusCode, apiResponse.headers);
  response.end(apiResponse.body);
}

export async function runUi(parsed: ParsedArgs): Promise<void> {
  const host = parsed.host ?? "127.0.0.1";
  const port = parsed.port ?? DEFAULT_UI_PORT;
  const isLocalhost = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "::ffff:127.0.0.1";
  // Token priority: --auth-token > AGENTARENA_AUTH_TOKEN env > auto-generated
  const authToken = parsed.authToken?.trim() || process.env.AGENTARENA_AUTH_TOKEN?.trim() || generateAuthToken();
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
      await saveRunState(process.cwd(), activeRunStatus as import("@agentarena/core").UiRunState);
    } else if (persistedState) {
      activeRunStatus = persistedState as UiRunStatus;
    }
  } catch (error) {
    console.warn("[agentarena] Failed to restore persisted run state:", error instanceof Error ? error.message : String(error));
  }

  const setRunStatus = (status: Partial<UiRunStatus>): void => {
    activeRunStatus = {
      ...activeRunStatus,
      ...status,
      updatedAt: new Date().toISOString()
    };
    // Fire-and-forget persistence (don't await, don't block)
    saveRunState(process.cwd(), activeRunStatus as import("@agentarena/core").UiRunState).catch(() => {});
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
    // Fire-and-forget persistence (don't await, don't block)
    saveRunState(process.cwd(), activeRunStatus as import("@agentarena/core").UiRunState).catch(() => {});
  };

  // Configure proxy trust if requested
  if (parsed.trustProxy) {
    setTrustProxy(true);
  }

  // Periodically clean up stale rate limit entries to prevent memory leaks
  const rateLimitCleanupInterval = startRateLimitCleanup();

  const server = http.createServer(async (request, response) => {
    const requestStartTime = Date.now();
    let requestPath = "/";
    const requestMethod = request.method ?? "GET";
    let responseStatusCode = 200;

    try {
      const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
      requestPath = requestUrl.pathname;

      // ─── Middleware: Rate limiting ───
      if (requestUrl.pathname.startsWith("/api/")) {
        const clientIp = getClientIp(request);
        const rateLimitResult = checkRateLimit(clientIp, requestUrl.pathname);
        if (!rateLimitResult.allowed) {
          const retryAfterSeconds = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
          response.writeHead(429, {
            "Content-Type": "application/json; charset=utf-8",
            "Retry-After": String(retryAfterSeconds),
            "Cache-Control": "no-store"
          });
          response.end(JSON.stringify({
            error: "Rate limit exceeded. Please wait before retrying.",
            retryAfterSeconds
          }));
          return;
        }
      }

      // ─── Middleware: CORS protection ───
      const origin = request.headers.origin;
      if (!checkCorsOrigin(origin, host, port)) {
        sendApiResponse(response, jsonResponse({ error: "Cross-origin requests are not allowed." }, 403));
        return;
      }

      // ─── Middleware: Token authentication ───
      const clientIp = getClientIp(request);
      if (!checkAuthHeader(requestUrl, request.method, isLocalhost, authToken, request.headers.authorization, clientIp)) {
        sendApiResponse(response, jsonResponse({ error: "Authentication required. Pass token via Authorization: Bearer <token> header." }, 401));
        return;
      }

      // ─── API Routes ───

      // GET /api/ui-info
      if (request.method === "GET" && requestUrl.pathname === "/api/ui-info") {
        sendApiResponse(response, await withErrorHandling(handleUiInfo(codexDefaults, host, port, isLocalhost)));
        return;
      }

      // GET /api/adapters
      if (request.method === "GET" && requestUrl.pathname === "/api/adapters") {
        sendApiResponse(response, await withErrorHandling(handleAdaptersList()));
        return;
      }

      // POST /api/preflight
      if (request.method === "POST" && requestUrl.pathname === "/api/preflight") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handlePreflight(rawBody)));
        return;
      }

      // GET /api/provider-profiles
      if (request.method === "GET" && requestUrl.pathname === "/api/provider-profiles") {
        sendApiResponse(response, await withErrorHandling(handleProviderProfilesGet()));
        return;
      }

      // POST /api/provider-profiles
      if (request.method === "POST" && requestUrl.pathname === "/api/provider-profiles") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handleProviderProfileCreate(rawBody)));
        return;
      }

      // /api/provider-profiles/:id and /api/provider-profiles/:id/secret
      const providerProfileMatch = requestUrl.pathname.match(/^\/api\/provider-profiles\/([^/]+)(?:\/(secret))?$/);
      if (providerProfileMatch) {
        const profileId = decodeURIComponent(providerProfileMatch[1]);
        const action = providerProfileMatch[2];

        if (request.method === "PUT" && !action) {
          const rawBody = await readRequestBody(request);
          sendApiResponse(response, await withErrorHandling(handleProviderProfileUpdate(profileId, rawBody)));
          return;
        }

        if (request.method === "DELETE" && !action) {
          sendApiResponse(response, await withErrorHandling(handleProviderProfileDelete(profileId)));
          return;
        }

        if (request.method === "POST" && action === "secret") {
          const rawBody = await readRequestBody(request);
          sendApiResponse(response, await withErrorHandling(handleProviderProfileSecret(profileId, rawBody)));
          return;
        }
      }

      // POST /api/create-adhoc-taskpack
      if (request.method === "POST" && requestUrl.pathname === "/api/create-adhoc-taskpack") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await handleCreateAdhocTaskpack(rawBody));
        return;
      }

      // GET /api/adhoc-taskpacks
      if (request.method === "GET" && requestUrl.pathname === "/api/adhoc-taskpacks") {
        sendApiResponse(response, await handleAdhocTaskpacksList());
        return;
      }

      // DELETE /api/adhoc-taskpacks/:id
      if (request.method === "DELETE" && requestUrl.pathname.startsWith("/api/adhoc-taskpacks/")) {
        const adhocId = decodeURIComponent(requestUrl.pathname.slice("/api/adhoc-taskpacks/".length));
        sendApiResponse(response, await handleAdhocTaskpackDelete(adhocId));
        return;
      }

      // GET /api/taskpacks
      if (request.method === "GET" && requestUrl.pathname === "/api/taskpacks") {
        sendApiResponse(response, await handleTaskpacksList());
        return;
      }

      // GET /api/metrics — Prometheus metrics endpoint
      if (request.method === "GET" && requestUrl.pathname === "/api/metrics") {
        const { exportAllMetrics } = await import("@agentarena/core");
        const metricsText = exportAllMetrics();
        response.writeHead(200, {
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end(metricsText);
        return;
      }

      // GET /api/run-status
      if (request.method === "GET" && requestUrl.pathname === "/api/run-status") {
        sendApiResponse(response, jsonResponse(activeRunStatus));
        return;
      }

      // POST /api/run — kept in-line due to deep state coupling
      if (request.method === "POST" && requestUrl.pathname === "/api/run") {
        // Mutex guard: In Node.js's single-threaded event loop, the check and assignment
        // below are atomic within a single synchronous block. However, the await for
        // readRequestBody() yields control, during which another request could pass the
        // activeRun check. We use the runStarting flag set synchronously before any await
        // to prevent this race condition.
        if (activeRun || runStarting) {
          sendApiResponse(response, jsonResponse({ error: "A benchmark run is already in progress." }, 409));
          return;
        }
        // Synchronously acquire the mutex before any async operations
        runStarting = true;

        let rawBody: string;
        try {
          rawBody = await readRequestBody(request);
        } catch (readError) {
          runStarting = false;
          throw readError;
        }
        let runPayload: UiRunPayload;
        try {
          runPayload = JSON.parse(rawBody) as UiRunPayload;
        } catch {
          runStarting = false;
          sendApiResponse(response, jsonResponse({ error: "Invalid JSON in request body." }, 400));
          return;
        }

        const validationError = validateRunPayload(runPayload);
        if (validationError) {
          runStarting = false;
          sendApiResponse(response, jsonResponse({ error: validationError }, 400));
          return;
        }

        const selections = normalizeUiSelections(runPayload);
        if (selections.length === 0) {
          runStarting = false;
          sendApiResponse(response, jsonResponse({ error: "At least one agent selection is required." }, 400));
          return;
        }

        // Reset status to clean state before starting a new run
        activeRunStatus = {
          state: "idle",
          phase: "idle",
          logs: [],
          updatedAt: new Date().toISOString()
        };
        saveRunState(process.cwd(), activeRunStatus as import("@agentarena/core").UiRunState).catch(() => {});

        setRunStatus({
          state: "running",
          phase: "starting",
          startedAt: new Date().toISOString(),
          repoPath: runPayload.repoPath,
          taskPath: runPayload.taskPath,
          outputPath: runPayload.outputPath
        });
        appendRunLog({
          phase: "starting",
          message: `Starting benchmark for ${selections.length} selection(s).`
        });

        const cancellationController = new AbortController();
        const cancellation = createCancellation(cancellationController.signal);
        const currentRunGeneration = ++runGeneration;

        activeRun = {
          cancel: () => cancellationController.abort(),
          promise: (async () => {
          // Mutex is now transferred to activeRun; clear the starting flag
          runStarting = false;
          try {
            const uiRunId = createRunId();
            const outputPath = runPayload.outputPath
              ? path.join(path.resolve(runPayload.outputPath), uiRunId)
              : undefined;
            const benchmark = await runBenchmark({
              runId: uiRunId,
              repoPath: runPayload.repoPath,
              taskPath: runPayload.taskPath,
              agentIds: selections.map((selection) => selection.baseAgentId),
              agents: selections,
              outputPath,
              probeAuth: runPayload.probeAuth,
              updateSnapshots: runPayload.updateSnapshots,
              cleanupWorkspaces: runPayload.cleanupWorkspaces,
              maxConcurrency: runPayload.maxConcurrency,
              scoreMode: runPayload.scoreMode,
              tokenBudget: runPayload.tokenBudget ? (Number(runPayload.tokenBudget) || undefined) : undefined,
              cancellation,
              onProgress: (event: BenchmarkProgressEvent) => {
                const phase =
                  event.phase === "starting" || event.phase === "preflight"
                    ? event.phase
                    : event.phase === "report"
                      ? "report"
                      : "benchmark";
                setRunStatus({
                  phase,
                  currentAgentId:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.agentId
                      : activeRunStatus.currentAgentId,
                  currentVariantId:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.variantId
                      : activeRunStatus.currentVariantId,
                  currentDisplayLabel:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.displayLabel
                      : activeRunStatus.currentDisplayLabel
                });
                appendRunLog({
                  phase,
                  message: event.message,
                  agentId: event.agentId,
                  variantId: event.variantId,
                  displayLabel: event.displayLabel
                });
              }
            });

            const runCancelled =
              cancellationController.signal.aborted || benchmark.results.some((result) => result.status === "cancelled");
            if (runCancelled) {
              appendRunLog({
                phase: activeRunStatus.phase,
                message: "Run cancelled."
              });
              setRunStatus({
                state: "cancelled",
                phase: "idle",
                error: undefined,
                currentAgentId: undefined,
                currentVariantId: undefined,
                currentDisplayLabel: undefined,
                result: undefined
              });
              return;
            }

            setRunStatus({
              phase: "report",
              currentAgentId: undefined,
              currentVariantId: undefined,
              currentDisplayLabel: undefined
            });
            appendRunLog({
              phase: "report",
              message: "Writing report artifacts."
            });
            const report = await writeReport(benchmark, {
              locale: resolveReportLocale(process.env.AGENTARENA_LOCALE)
            });
            appendRunLog({
              phase: "report",
              message: "Report artifacts are ready."
            });
            const run = JSON.parse(await fs.readFile(report.jsonPath, "utf8"));
            const markdown = await fs.readFile(report.markdownPath, "utf8");
            setRunStatus({
              state: "done",
              phase: "idle",
              result: { run, markdown, report }
            });
          } catch (runError) {
            const errorMessage = runError instanceof Error ? runError.message : String(runError);
            appendRunLog({
              phase: activeRunStatus.phase,
              message: isAbortError(runError) ? "Run cancelled." : `Run failed: ${errorMessage}`
            });
            setRunStatus(
              isAbortError(runError)
                ? {
                    state: "cancelled",
                    phase: "idle",
                    error: undefined,
                    currentAgentId: undefined,
                    currentVariantId: undefined,
                    currentDisplayLabel: undefined
                  }
                : {
                    state: "error",
                    error: errorMessage
                  }
            );
          } finally {
            // Only update state if this is still the current run (not stale from a cancel/restart)
            if (currentRunGeneration === runGeneration) {
              if (activeRunStatus.state !== "cancelling" && activeRunStatus.state !== "cancelled" && activeRunStatus.state !== "error") {
                activeRunStatus = { ...activeRunStatus, state: "done" };
              }
              activeRun = null;
              // Clear persisted state on completion
              clearRunState(process.cwd()).catch(() => {});
            }
          }
        })()
        };

        sendApiResponse(response, jsonResponse({ accepted: true }, 202));
        return;
      }

      // POST /api/run/cancel
      if (request.method === "POST" && requestUrl.pathname === "/api/run/cancel") {
        if (!activeRun) {
          sendApiResponse(response, jsonResponse({ error: "No benchmark run in progress." }, 409));
          return;
        }
        activeRun.cancel();
        activeRunStatus = { ...activeRunStatus, state: "cancelling" };
        // Don't set activeRun = null here — let the old run's finally block handle it.
        // Setting it null here would allow a new run to start while the old one is still
        // cleaning up, causing state corruption via the stale finally block.
        appendRunLog({ phase: activeRunStatus.phase, message: "Cancellation requested by user." });
        sendApiResponse(response, jsonResponse({ cancelled: true }));
        return;
      }

      // ─── Static file serving ───

      if (request.method === "GET") {
        let filePath = requestUrl.pathname === "/" ? path.join(WEB_REPORT_DIST_ROOT, "index.html") : path.join(WEB_REPORT_DIST_ROOT, requestUrl.pathname.replace(/^\/+/, ""));
        filePath = path.normalize(filePath);
        if (!filePath.startsWith(WEB_REPORT_DIST_ROOT)) {
          sendApiResponse(response, textResponse("Forbidden", 403));
          return;
        }

        try {
          const body = await fs.readFile(filePath);
          response.writeHead(200, {
            "Content-Type": detectContentType(filePath),
            "Cache-Control": "no-store",
            "X-Frame-Options": "DENY",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin"
          });
          response.end(body);
          return;
        } catch {
          sendApiResponse(response, textResponse("Not Found", 404));
          return;
        }
      }

      const methodNotAllowed = textResponse("Method Not Allowed", 405);
      response.writeHead(methodNotAllowed.statusCode, methodNotAllowed.headers);
      response.end(methodNotAllowed.body);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      responseStatusCode = statusCode;
      const message = statusCode >= 500 ? "Internal server error" : (error instanceof Error ? error.message : String(error));
      const payload = jsonResponse({ error: message }, statusCode);
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
    } finally {
      const durationSeconds = (Date.now() - requestStartTime) / 1000;
      const actualStatusCode = response.statusCode || responseStatusCode;
      metrics.httpRequestsTotal.inc({ method: requestMethod, path: requestPath, status: String(actualStatusCode) });
      metrics.httpRequestDuration.observe({ method: requestMethod, path: requestPath }, durationSeconds);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const url = `http://${host}:${port}`;
  console.log(`\nAgentArena UI server running`);
  console.log(`url=${url}`);
  console.log(`repo=${process.cwd()}`);
  const authTokenFilePath = path.join(process.cwd(), ".agentarena", "last-auth-token");
  await fs.mkdir(path.dirname(authTokenFilePath), { recursive: true });
  await fs.writeFile(authTokenFilePath, authToken, { encoding: "utf8", mode: 0o600 });
  // Attempt to restrict file permissions (best-effort; Windows ACLs differ)
  await fs.chmod(authTokenFilePath, 0o600).catch(() => {});
  console.log(`auth_token=${authToken}`);
  console.log(`auth_token_file=${authTokenFilePath}`);
  if (!isLocalhost) {
    console.log(`\n  Non-localhost access requires authentication.`);
    console.log(`  Open in browser: http://${host}:${port}#token=${authToken}`);
    console.log(`  Token saved to: ${authTokenFilePath}\n`);
  } else {
    console.log(`  WARNING: This token grants full API access. Do not share it.`);
  }

  if (!parsed.noOpen) {
    maybeOpenBrowser(url);
  }

  await new Promise<void>((resolve) => {
    const closeServer = () => {
      clearInterval(rateLimitCleanupInterval);
      server.close(() => resolve());
    };

    process.once("SIGINT", closeServer);
    process.once("SIGTERM", closeServer);
  });
}
