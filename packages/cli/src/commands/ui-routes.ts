import { promises as fs } from "node:fs";
import type http from "node:http";
import path from "node:path";
import type { getCodexDefaultResolvedRuntime } from "@agentarena/adapters";
import { createCancellation, createRunId, isAbortError, metrics } from "@agentarena/core";
import { writeReport } from "@agentarena/report";
import { type BenchmarkProgressEvent, runBenchmark } from "@agentarena/runner";
import {
  checkAuthHeader,
  checkCorsOrigin,
  checkRateLimit,
  detectContentType,
  getClientIp,
  HttpError,
  jsonResponse,
  readRequestBody,
  textResponse,
} from "../server.js";
import {
  handleAdaptersList,
  handleAdhocTaskpackDelete,
  handleAdhocTaskpacksList,
  handleAgentDetection,
  handleCheckCompatibility,
  handleCreateAdhocTaskpack,
  handleInstallGuides,
  handlePreflight,
  handleProviderProfileCreate,
  handleProviderProfileDelete,
  handleProviderProfileSecret,
  handleProviderProfilesGet,
  handleProviderProfileUpdate,
  handleQuickPreflight,
  handleTaskpacksList,
  handleUiInfo,
  withErrorHandling,
} from "./api-routes.js";
import { validateRunPayload } from "./run-payload-validator.js";
import {
  normalizeUiSelections,
  resolveReportLocale,
  type UiRunPayload,
  type UiRunStatus,
  WORKSPACE_ROOT,
} from "./shared.js";

export const WEB_REPORT_DIST_ROOT = path.join(WORKSPACE_ROOT, "apps", "web-report", "dist");

export function sendApiResponse(
  response: http.ServerResponse,
  apiResponse: { statusCode: number; body: string; headers: Record<string, string> }
): void {
  response.writeHead(apiResponse.statusCode, apiResponse.headers);
  response.end(apiResponse.body);
}

export interface ActiveUiRun {
  promise: Promise<unknown>;
  cancel: () => void;
}

/**
 * RUN LIFECYCLE STATE MACHINE
 *
 * The benchmark run goes through these states (activeRunStatus.state):
 *
 *   idle ──POST /api/run──> running ──success──> done
 *                              │
 *                              ├──error──> error
 *                              │
 *                              └──cancel──> cancelling ──abort──> cancelled
 *
 * Transitions:
 * - idle → running:   POST /api/run accepted, runStarting mutex acquired
 * - running → done:   Benchmark completed, report written
 * - running → error:  Benchmark threw an unrecoverable error
 * - running → cancelling: POST /api/run/cancel called
 * - cancelling → cancelled: AbortController fired, run acknowledged abort
 *
 * The `runGeneration` counter prevents stale finally-blocks from overwriting
 * state from a newer run. Each POST /api/run increments the counter; the
 * finally block checks `currentRunGeneration === ctx.runGeneration` before
 * updating state.
 *
 * MUTEX INVARIANT:
 * The `runStarting` flag MUST be set synchronously (before any await) in the
 * POST /api/run handler. This prevents two concurrent requests from both
 * passing the `if (ctx.activeRun || ctx.runStarting)` check during the same
 * event loop tick. Refactoring that inserts an `await` between the check and
 * `setRunStarting(true)` WILL introduce a race condition.
 */
export interface RequestContext {
  host: string;
  port: number;
  isLocalhost: boolean;
  authToken: string;
  codexDefaults: Awaited<ReturnType<typeof getCodexDefaultResolvedRuntime>>;
  activeRun: ActiveUiRun | null;
  setActiveRun: (run: ActiveUiRun | null) => void;
  activeRunStatus: UiRunStatus;
  setActiveRunStatus: (status: UiRunStatus) => void;
  appendRunLog: (entry: Omit<import("./shared.js").UiRunLogEntry, "timestamp">) => void;
  setRunStatus: (status: Partial<UiRunStatus>) => void;
  runGeneration: number;
  incrementRunGeneration: () => number;
  runStarting: boolean;
  setRunStarting: (val: boolean) => void;
  flushSaveRunState: () => Promise<void>;
}

export function createRequestHandler(ctx: RequestContext) {
  return async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const requestStartTime = Date.now();
    let requestPath = "/";
    const requestMethod = request.method ?? "GET";
    let responseStatusCode = 200;

    try {
      const requestUrl = new URL(request.url ?? "/", `http://${ctx.host}:${ctx.port}`);
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
      if (!checkCorsOrigin(origin, ctx.host, ctx.port)) {
        sendApiResponse(response, jsonResponse({ error: "Cross-origin requests are not allowed." }, 403));
        return;
      }

      // ─── Middleware: Token authentication ───
      const clientIp = getClientIp(request);
      if (!checkAuthHeader(requestUrl, request.method, ctx.isLocalhost, ctx.authToken, request.headers.authorization, clientIp)) {
        sendApiResponse(response, jsonResponse({ error: "Authentication required. Pass token via Authorization: Bearer <token> header." }, 401));
        return;
      }

      // ─── API Routes ───

      // GET /api/ui-info
      if (request.method === "GET" && requestUrl.pathname === "/api/ui-info") {
        sendApiResponse(response, await withErrorHandling(handleUiInfo(ctx.codexDefaults, ctx.host, ctx.port, ctx.isLocalhost)));
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

      // POST /api/quick-preflight
      if (request.method === "POST" && requestUrl.pathname === "/api/quick-preflight") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handleQuickPreflight(rawBody)));
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
        sendApiResponse(response, await withErrorHandling(handleCreateAdhocTaskpack(rawBody)));
        return;
      }

      // POST /api/check-compatibility
      if (request.method === "POST" && requestUrl.pathname === "/api/check-compatibility") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handleCheckCompatibility(rawBody)));
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

      // GET /api/agent-detection — EchoBird-style agent detection
      if (request.method === "GET" && requestUrl.pathname === "/api/agent-detection") {
        sendApiResponse(response, await withErrorHandling(handleAgentDetection()));
        return;
      }

      // GET /api/install-guides — install guide definitions for all agents
      if (request.method === "GET" && requestUrl.pathname === "/api/install-guides") {
        sendApiResponse(response, await withErrorHandling(handleInstallGuides()));
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
        sendApiResponse(response, jsonResponse(ctx.activeRunStatus));
        return;
      }

      // POST /api/run — kept in-line due to deep state coupling
      if (request.method === "POST" && requestUrl.pathname === "/api/run") {
        // Mutex guard: In Node.js's single-threaded event loop, the check and assignment
        // below are atomic within a single synchronous block. However, the await for
        // readRequestBody() yields control, during which another request could pass the
        // activeRun check. We use the runStarting flag set synchronously before any await
        // to prevent this race condition.
        if (ctx.activeRun || ctx.runStarting) {
          sendApiResponse(response, jsonResponse({ error: "A benchmark run is already in progress." }, 409));
          return;
        }
        // Synchronously acquire the mutex before any async operations
        ctx.setRunStarting(true);

        let rawBody: string;
        try {
          rawBody = await readRequestBody(request);
        } catch (readError) {
          ctx.setRunStarting(false);
          throw readError;
        }
        let runPayload: UiRunPayload;
        try {
          runPayload = JSON.parse(rawBody) as UiRunPayload;
        } catch {
          ctx.setRunStarting(false);
          sendApiResponse(response, jsonResponse({ error: "Invalid JSON in request body." }, 400));
          return;
        }

        const validationError = validateRunPayload(runPayload);
        if (validationError) {
          ctx.setRunStarting(false);
          sendApiResponse(response, jsonResponse({ error: validationError }, 400));
          return;
        }

        const selections = normalizeUiSelections(runPayload);
        if (selections.length === 0) {
          ctx.setRunStarting(false);
          sendApiResponse(response, jsonResponse({ error: "At least one agent selection is required." }, 400));
          return;
        }

        // Reset status to clean state before starting a new run
        const freshStatus: UiRunStatus = {
          state: "idle",
          phase: "idle",
          logs: [],
          updatedAt: new Date().toISOString()
        };
        ctx.setActiveRunStatus(freshStatus);
        // This is a new-run boundary — flush before resetting so any pending
        // debounced save from the previous run lands first.
        await ctx.flushSaveRunState();

        ctx.setRunStatus({
          state: "running",
          phase: "starting",
          startedAt: new Date().toISOString(),
          repoPath: runPayload.repoPath,
          taskPath: runPayload.taskPath,
          outputPath: runPayload.outputPath
        });
        ctx.appendRunLog({
          phase: "starting",
          message: `Starting benchmark for ${selections.length} selection(s).`
        });

        const cancellationController = new AbortController();
        const cancellation = createCancellation(cancellationController.signal);
        const currentRunGeneration = ctx.incrementRunGeneration();

        const activeRun = {
          cancel: () => cancellationController.abort(),
          promise: (async () => {
          // Mutex is now transferred to activeRun; clear the starting flag
          ctx.setRunStarting(false);
          try {
            const uiRunId = createRunId();
            const outputPath = runPayload.outputPath
              ? path.resolve(runPayload.outputPath)
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
                ctx.setRunStatus({
                  phase,
                  currentAgentId:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.agentId
                      : ctx.activeRunStatus.currentAgentId,
                  currentVariantId:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.variantId
                      : ctx.activeRunStatus.currentVariantId,
                  currentDisplayLabel:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.displayLabel
                      : ctx.activeRunStatus.currentDisplayLabel
                });
                ctx.appendRunLog({
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
              ctx.appendRunLog({
                phase: ctx.activeRunStatus.phase,
                message: "Run cancelled."
              });
              ctx.setRunStatus({
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

            ctx.setRunStatus({
              phase: "report",
              currentAgentId: undefined,
              currentVariantId: undefined,
              currentDisplayLabel: undefined
            });
            ctx.appendRunLog({
              phase: "report",
              message: "Writing report artifacts."
            });
            const report = await writeReport(benchmark, {
              locale: resolveReportLocale(process.env.AGENTARENA_LOCALE)
            });
            ctx.appendRunLog({
              phase: "report",
              message: "Report artifacts are ready."
            });
            const run = JSON.parse(await fs.readFile(report.jsonPath, "utf8"));
            const markdown = await fs.readFile(report.markdownPath, "utf8");
            ctx.setRunStatus({
              state: "done",
              phase: "idle",
              result: { run, markdown, report }
            });
          } catch (runError) {
            const errorMessage = runError instanceof Error ? runError.message : String(runError);
            ctx.appendRunLog({
              phase: ctx.activeRunStatus.phase,
              message: isAbortError(runError) ? "Run cancelled." : `Run failed: ${errorMessage}`
            });
            ctx.setRunStatus(
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
            if (currentRunGeneration === ctx.runGeneration) {
              if (ctx.activeRunStatus.state !== "cancelling" && ctx.activeRunStatus.state !== "cancelled" && ctx.activeRunStatus.state !== "error") {
                ctx.setActiveRunStatus({ ...ctx.activeRunStatus, state: "done" });
              }
              ctx.setActiveRun(null);
              // Clear persisted state on completion
              const { clearRunState } = await import("@agentarena/core");
              clearRunState(process.cwd()).catch(() => {});
            }
          }
        })()
        };

        ctx.setActiveRun(activeRun);

        sendApiResponse(response, jsonResponse({ accepted: true }, 202));
        return;
      }

      // POST /api/run/cancel
      if (request.method === "POST" && requestUrl.pathname === "/api/run/cancel") {
        if (!ctx.activeRun) {
          sendApiResponse(response, jsonResponse({ error: "No benchmark run in progress." }, 409));
          return;
        }
        ctx.activeRun.cancel();
        ctx.setActiveRunStatus({ ...ctx.activeRunStatus, state: "cancelling" });
        // Don't set activeRun = null here — let the old run's finally block handle it.
        // Setting it null here would allow a new run to start while the old one is still
        // cleaning up, causing state corruption via the stale finally block.
        ctx.appendRunLog({ phase: ctx.activeRunStatus.phase, message: "Cancellation requested by user." });
        sendApiResponse(response, jsonResponse({ cancelled: true }));
        return;
      }

      // ─── Static file serving ───

      if (request.method === "GET") {
        let filePath = requestUrl.pathname === "/" ? path.join(WEB_REPORT_DIST_ROOT, "index.html") : path.join(WEB_REPORT_DIST_ROOT, requestUrl.pathname.replace(/^\/+/, ""));
        filePath = path.normalize(filePath);
        const relativeToDistRoot = path.relative(WEB_REPORT_DIST_ROOT, filePath);
        if (relativeToDistRoot.startsWith("..") || path.isAbsolute(relativeToDistRoot)) {
          sendApiResponse(response, textResponse("Forbidden", 403));
          return;
        }

        try {
          let body = await fs.readFile(filePath);

          // Auto-inject auth token into index.html for localhost (seamless first-time UX).
          //
          // SECURITY RATIONALE:
          // - Meta tag is injected server-side only for localhost connections
          // - Self-removing script reads token into sessionStorage and deletes the meta tag
          // - sessionStorage is tab-scoped and cleared on tab close (not persistent)
          // - The meta tag exists in the DOM for <1ms before the script removes it
          // - Risk: if an attacker can inject content before this script runs, they could
          //   exfiltrate the token. Mitigated by localhost-only + CORS + CSP headers.
          // - The token is NOT persisted in saved pages, screenshots, or printouts
          if (ctx.isLocalhost && filePath.endsWith("index.html") && ctx.authToken) {
            let html = body.toString("utf8");
            const metaTag = `<meta name="agentarena-auth-token" content="${ctx.authToken}">`;
            const cleanupScript = `<script>(function(){var m=document.querySelector('meta[name="agentarena-auth-token"]');if(m){try{sessionStorage.setItem('agentarena-auth-token',m.getAttribute('content'))}catch(e){/* ignore: sessionStorage may be unavailable */}m.remove()}})();</script>`;
            const injection = `  ${metaTag}\n  ${cleanupScript}\n`;
            if (html.includes("</head>")) {
              html = html.replace("</head>", `${injection}</head>`);
            } else {
              html = injection + html;
            }
            body = Buffer.from(html, "utf8");
          }

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
  };
}
