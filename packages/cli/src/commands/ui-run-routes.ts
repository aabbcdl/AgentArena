import { promises as fs } from "node:fs";
import type http from "node:http";
import path from "node:path";
import type { TaskPack } from "@agentarena/core";
import { AgentLogStore, createCancellation, createRunId, isAbortError } from "@agentarena/core";
import { writeReport } from "@agentarena/report";
import {
  type BenchmarkProgressEvent,
  checkTaskCompatibility,
  resolveAndValidateRepo,
  runBenchmark
} from "@agentarena/runner";
import { TraceTailer } from "@agentarena/trace";
import { jsonResponse, readRequestBody } from "../server/index.js";
import { createAdhocLintCommand, createAdhocTestCommand, createPackageScriptCommand } from "../templates.js";
import { resolveRunPayloadPaths, validateRunPayload, validateRunPayloadPaths } from "./run-payload-validator.js";
import { BUILTIN_REPOS_ROOT, isTrustedBuiltinTaskPack, normalizeUiSelections, OFFICIAL_TASKPACK_ROOT, resolveReportLocale, type UiRunPayload, type UiRunStatus } from "./shared.js";
import { SseConnection } from "./sse.js";
import { sendApiResponse } from "./ui-http.js";
import type { UiRunRequestContext } from "./ui-run-types.js";
import { prepareUiRuntimeAdmission } from "./ui-runtime-admission.js";

const GET_RUN_ROUTES = new Set(["/api/run-status", "/api/agent-logs", "/api/run-stream"]);
const POST_RUN_ROUTES = new Set(["/api/run", "/api/run/cancel"]);

/**
 * Generated adhoc checks use fixed inline Node helpers because they need to
 * create machine-readable test/lint reports without asking the user to edit
 * the target repository. Keep eval enabled only when the complete task shape
 * still matches those exact helpers. A hand-edited adhoc YAML falls back to
 * the normal command security policy.
 */
function isGeneratedAdhocTaskPack(task: TaskPack): boolean {
  const tags = task.metadata?.tags ?? [];
  if (
    task.repoSource !== "user" ||
    task.metadata?.owner !== "user" ||
    !tags.includes("adhoc") ||
    !tags.includes("custom") ||
    task.id.length === 0 ||
    task.setupCommands.length > 0 ||
    task.teardownCommands.length > 0 ||
    task.judges.length !== 5
  ) {
    return false;
  }

  const expectedTestReport = `.agentarena/${task.id}-test-results.json`;
  const expectedLintReport = `.agentarena/${task.id}-lint-results.json`;
  const judgeIds = new Set<string>();
  for (const judge of task.judges) {
    if (judgeIds.has(judge.id)) return false;
    judgeIds.add(judge.id);
    if (judge.type === "file-exists") {
      if (
        !((judge.id === "repo-not-broken" && judge.path === "package.json") ||
          (judge.id === "readme-exists" && judge.path === "README.md"))
      ) {
        return false;
      }
      continue;
    }
    if (judge.type === "command") {
      if (judge.id !== "build-passes" || judge.command !== createPackageScriptCommand("build")) {
        return false;
      }
      continue;
    }
    if (judge.type === "test-result") {
      if (judge.id !== "tests-pass" || judge.reportFile !== expectedTestReport || judge.command !== createAdhocTestCommand(expectedTestReport)) {
        return false;
      }
      continue;
    }
    if (judge.type === "lint-check") {
      if (judge.id !== "lint-clean" || judge.reportFile !== expectedLintReport || judge.command !== createAdhocLintCommand(expectedLintReport)) {
        return false;
      }
      continue;
    }
    return false;
  }

  return ["repo-not-broken", "readme-exists", "build-passes", "tests-pass", "lint-clean"].every((id) => judgeIds.has(id));
}

export function isUiRunRoute(method: string | undefined, pathname: string): boolean {
  return method === "GET" ? GET_RUN_ROUTES.has(pathname) : method === "POST" && POST_RUN_ROUTES.has(pathname);
}

export async function handleUiRunRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  ctx: UiRunRequestContext
): Promise<void> {
  // GET /api/run-status
  if (request.method === "GET" && requestUrl.pathname === "/api/run-status") {
    sendApiResponse(response, jsonResponse(ctx.activeRunStatus));
    return;
  }

  // GET /api/agent-logs?agentId=xxx&limit=50[&runId=xxx] — per-agent log lines
  // Supports both live (activeRun) and post-run (persisted by runId) queries.
  if (request.method === "GET" && requestUrl.pathname === "/api/agent-logs") {
    const agentId = requestUrl.searchParams.get("agentId") ?? "";
    const runId = requestUrl.searchParams.get("runId") ?? "";
    const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "200", 10);
    // Try active run first (live), then fall back to persisted store (post-run)
    const store = ctx.activeRun?.agentLogStore ?? (runId ? ctx.getLogStore(runId) : undefined);
    if (!store) {
      sendApiResponse(response, jsonResponse({ logs: [] }));
      return;
    }
    const logs = store.last(agentId, Number.isFinite(limit) ? Math.min(limit, 1000) : 200);
    sendApiResponse(response, jsonResponse({ agentId, logs }));
    return;
  }

  // GET /api/run-stream — SSE live event stream. Authentication has already
  // been enforced by the shared request middleware before this route is called.
  if (request.method === "GET" && requestUrl.pathname === "/api/run-stream") {
    // SSE connections are tracked on the active run and closed when the
    // run completes. If no run is active, send a single snapshot event.
    // Pass request for reliable client-disconnect detection.
    const conn = new SseConnection(response, request);
    if (ctx.activeRun) {
      ctx.activeRun.sseConnections?.add(conn);
      // Send current snapshot immediately on connect
      conn.send("snapshot", ctx.activeRunStatus);
    } else {
      // No active run — send current status and close
      conn.send("snapshot", ctx.activeRunStatus);
      conn.close("no-run", { message: "No active benchmark run." });
    }
    // Return without calling end() — SseConnection manages the response lifecycle.
    return;
  }

  // POST /api/run — kept in-line due to deep state coupling
  if (request.method === "POST" && requestUrl.pathname === "/api/run") {
    // Reserve before any await so concurrent requests cannot both begin.
    if (!ctx.tryReserveStart()) {
      sendApiResponse(response, jsonResponse({ error: "A benchmark run is already in progress." }, 409));
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readRequestBody(request);
    } catch (readError) {
      ctx.releaseStartReservation();
      throw readError;
    }
    let runPayload: UiRunPayload;
    try {
      runPayload = JSON.parse(rawBody) as UiRunPayload;
    } catch {
      ctx.releaseStartReservation();
      sendApiResponse(response, jsonResponse({ error: "Invalid JSON in request body." }, 400));
      return;
    }

    const workingDirectory = ctx.workspaceRoot ?? process.cwd();
    runPayload = resolveRunPayloadPaths(runPayload, workingDirectory);
    const trustedTaskRoots = [workingDirectory, OFFICIAL_TASKPACK_ROOT];
    const validationError = validateRunPayload(runPayload, workingDirectory, trustedTaskRoots);
    if (validationError) {
      ctx.releaseStartReservation();
      sendApiResponse(response, jsonResponse({ error: validationError }, 400));
      return;
    }
    const pathValidationError = await validateRunPayloadPaths(runPayload, {
      cwd: workingDirectory,
      taskRoots: trustedTaskRoots
    });
    if (pathValidationError) {
      ctx.releaseStartReservation();
      sendApiResponse(response, jsonResponse({ error: pathValidationError }, 400));
      return;
    }

    const requestedSelections = normalizeUiSelections(runPayload);
    if (requestedSelections.length === 0) {
      ctx.releaseStartReservation();
      sendApiResponse(response, jsonResponse({ error: "At least one agent selection is required." }, 400));
      return;
    }
    let admission: Awaited<ReturnType<typeof prepareUiRuntimeAdmission>>;
    let allowEvalInTaskCommands = isTrustedBuiltinTaskPack(runPayload.taskPath) || process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES === "1";
    try {
      const resolvedRepository = await resolveAndValidateRepo({
        repoPath: runPayload.repoPath,
        taskPath: runPayload.taskPath,
        builtinReposRoot: BUILTIN_REPOS_ROOT,
        userRepoRoot: workingDirectory
      });
      const compatibility = await checkTaskCompatibility(resolvedRepository.task, resolvedRepository.repoPath);
      if (compatibility.status === "incompatible") {
        ctx.releaseStartReservation();
        sendApiResponse(response, jsonResponse({
          error: compatibility.summary,
          compatibility
        }, 409));
        return;
      }
      allowEvalInTaskCommands ||= isGeneratedAdhocTaskPack(resolvedRepository.task);
      admission = await prepareUiRuntimeAdmission(requestedSelections, resolvedRepository.repoPath);
    } catch (error) {
      ctx.releaseStartReservation();
      sendApiResponse(response, jsonResponse({
        error: error instanceof Error ? error.message : String(error)
      }, 409));
      return;
    }
    const selections = admission.selections;
    const outputPath = path.resolve(runPayload.outputPath || path.join(workingDirectory, ".agentarena", "ui-runs"));

    // Reset status to clean state before starting a new run
    const freshStatus: UiRunStatus = {
      state: "idle",
      phase: "idle",
      logs: [],
      updatedAt: new Date().toISOString()
    };
    ctx.setActiveRunStatus(freshStatus);
    // Persist the clean new-run baseline before transferring the start
    // reservation to an active run. A failed flush must release the reservation.
    try {
      await ctx.flushSaveRunState();
    } catch (error) {
      ctx.releaseStartReservation();
      throw error;
    }

    ctx.setRunStatus({
      state: "running",
      phase: "starting",
      startedAt: new Date().toISOString(),
      repoPath: runPayload.repoPath,
      taskPath: runPayload.taskPath,
      outputPath
    });
    ctx.appendRunLog({
      phase: "starting",
      message: `Starting benchmark for ${selections.length} selection(s).`
    });

    const cancellationController = new AbortController();
    const cancellation = createCancellation(cancellationController.signal);
    const currentRunGeneration = ctx.incrementRunGeneration();
    const uiRunId = createRunId();

    // SSE connection tracking + agent log store — declared in outer scope
    // so the finally block (which runs even on error) can close connections
    // and the SSE endpoint can access the log store immediately.
    const runSseConnections = new Set<SseConnection>();
    const agentLogStore = new AgentLogStore(1000);

    // Trace tailers — one per running agent, emits real-time trace records via SSE
    const traceTailers = new Map<string, { tailer: TraceTailer; variantId: string }>();
    let activeOutputPath = outputPath;

    const activeRun = {
      cancel: () => cancellationController.abort(),
      sseConnections: runSseConnections,
      agentLogStore,
      promise: (async () => {
      // Mutex is now transferred to activeRun; release the start reservation.
      ctx.releaseStartReservation();
      try {
        const benchmark = await runBenchmark({
          runId: uiRunId,
          repoPath: runPayload.repoPath,
          taskPath: runPayload.taskPath,
          agentIds: selections.map((selection) => selection.baseAgentId),
          agents: selections,
          runtimeBindings: admission.runtimeBindings,
          outputPath,
          builtinReposRoot: BUILTIN_REPOS_ROOT,
          userRepoRoot: workingDirectory,
          probeAuth: runPayload.probeAuth,
          updateSnapshots: runPayload.updateSnapshots,
          cleanupWorkspaces: runPayload.cleanupWorkspaces,
          maxConcurrency: admission.runtimeBindings ? 1 : runPayload.maxConcurrency,
          scoreMode: runPayload.scoreMode,
          entryPoint: runPayload.entryPoint ?? "legacy-launcher",
          tokenBudget: runPayload.tokenBudget ? (Number(runPayload.tokenBudget) || undefined) : undefined,
          allowEvalInTaskCommands,
          cancellation,
          enableActivityEvents: true,
          agentLogStore,
          onProgress: async (event: BenchmarkProgressEvent) => {
            const phase =
              event.phase === "starting" || event.phase === "preflight"
                ? event.phase
                : event.phase === "report"
                  ? "report"
                  : event.phase === "agent-activity"
                    ? "benchmark"
                    : "benchmark";
            const eventRunId = typeof event.metadata?.runId === "string" ? event.metadata.runId : undefined;
            const eventOutputPath = typeof event.metadata?.outputPath === "string"
              ? event.metadata.outputPath
              : undefined;
            if (eventOutputPath) activeOutputPath = eventOutputPath;
            ctx.setRunStatus({
              phase,
              ...(eventRunId ? { runId: eventRunId } : {}),
              ...(eventOutputPath ? { outputPath: eventOutputPath } : {}),
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
                  : ctx.activeRunStatus.currentDisplayLabel,
              snapshot: event.snapshot ?? ctx.activeRunStatus.snapshot
            });
            if (event.phase === "starting" && eventRunId && eventOutputPath) {
              await ctx.flushSaveRunState();
            }
            ctx.appendRunLog({
              phase,
              message: event.message,
              agentId: event.agentId,
              variantId: event.variantId,
              displayLabel: event.displayLabel
            });

            // Prune connections whose client disconnected (browser refresh) so
            // the Set doesn't accumulate stale references during long runs.
            // Safe to mutate a Set during for..of iteration.
            for (const conn of runSseConnections) {
              if (conn.isClosed) {
                runSseConnections.delete(conn);
              }
            }
            // Broadcast to all connected SSE clients
            for (const conn of runSseConnections) {
              if (conn.isClosed) continue;
              if (event.phase === "agent-activity") {
                conn.send("activity", {
                  agentId: event.agentId,
                  variantId: event.variantId,
                  displayLabel: event.displayLabel,
                  line: event.line,
                  seq: event.seq,
                  stream: event.stream,
                  ts: Date.now()
                });
              } else {
                conn.send("progress", {
                  phase: event.phase,
                  message: event.message,
                  agentId: event.agentId,
                  variantId: event.variantId,
                  displayLabel: event.displayLabel,
                  snapshot: event.snapshot,
                  ts: Date.now()
                });
              }
            }

            // Trace tailer lifecycle — start on agent-start, stop on agent-finish
            if (event.phase === "agent-start" && event.variantId) {
              const tracePath = path.join(activeOutputPath, "agents", event.variantId, "trace.jsonl");
              // Only start if not already tailing this variant
              if (!traceTailers.has(event.variantId)) {
                const tailer = new TraceTailer(tracePath, (record) => {
                  // Broadcast new trace records to all SSE clients
                  for (const conn of runSseConnections) {
                    if (conn.isClosed) continue;
                    conn.send("trace-record", {
                      agentId: event.agentId,
                      variantId: event.variantId,
                      displayLabel: event.displayLabel,
                      record,
                      ts: Date.now()
                    });
                  }
                });
                tailer.start();
                traceTailers.set(event.variantId, { tailer, variantId: event.variantId });
              }
            }
            if (event.phase === "agent-finish" && event.variantId) {
              const entry = traceTailers.get(event.variantId);
              if (entry) {
                entry.tailer.stop();  // grace tick flushes trailing records
                traceTailers.delete(event.variantId);
              }
            }
          }
        });

        // Persist the log store BEFORE activeRun is nulled in finally.
        // This enables /api/agent-logs?runId=xxx to work post-run.
        ctx.rememberLogStore(uiRunId, agentLogStore);
        // Store references so SSE endpoint and /api/agent-logs can access them
        if (ctx.activeRun) {
          ctx.activeRun.agentLogStore = agentLogStore;
          ctx.activeRun.sseConnections = runSseConnections;
        }

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
        // Stop all trace tailers (they were tracking this run)
        for (const [, entry] of traceTailers) {
          try { entry.tailer.stop(); } catch { /* ignore */ }
        }
        traceTailers.clear();
        // Close all SSE connections (they were tracking this run)
        for (const conn of runSseConnections) {
          if (!conn.isClosed) {
            try { conn.close("done", { runId: uiRunId }); } catch { /* ignore */ }
          }
        }
        runSseConnections.clear();
        // Only update state if this is still the current run (not stale from a cancel/restart)
        if (currentRunGeneration === ctx.runGeneration) {
          if (ctx.activeRunStatus.state !== "cancelling" && ctx.activeRunStatus.state !== "cancelled" && ctx.activeRunStatus.state !== "error") {
            ctx.setActiveRunStatus({ ...ctx.activeRunStatus, state: "done" });
          }
          ctx.setActiveRun(null);
          // Clear persisted state on completion
          void ctx.clearPersistedRunState();
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
}
