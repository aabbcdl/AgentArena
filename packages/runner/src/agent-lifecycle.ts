import { promises as fs } from "node:fs";
import path from "node:path";
import { getAdapter } from "@agentarena/adapters";
import {
  type AdapterPreflightResult,
  type AgentRunResult,
  type BenchmarkCancellation,
  buildExecutionEnvironment,
  type CommandStepResult,
  createWorkspaceSandbox,
  type DiffPrecisionSummary,
  type DiffSummary,
  diffSnapshots,
  isAbortError,
  logger,
  metrics,
  snapshotDirectory,
  type TraceEvent,
  throwIfAborted,
} from "@agentarena/core";
import { runJudges } from "@agentarena/judges";
import type { loadTaskPack } from "@agentarena/taskpacks";
import { JsonlTraceRecorder } from "@agentarena/trace";
import { agentExecuteTimeoutMs } from "./concurrency.js";
import { buildFinalResult } from "./result-assembly.js";
import {
  buildChangedFiles,
  createCancellationSummary,
} from "./result-builder.js";
import { buildDiffPrecision, collectChangedFiles } from "./snapshot.js";
import { wrapWithTimeout } from "./timeout-utils.js";
import type { AgentRunContext } from "./types.js";
import { debugLog, formatErrorDetails, formatErrorMessage } from "./workspace.js";
import {
  runSetupCommands,
  runTeardownCommands,
  setupWorkspaceAndPrechecks,
} from "./workspace-operations.js";

export type { AgentRunContext } from "./types.js";

/**
 * Grace period added on top of agentTimeoutMs for the outer wrapWithTimeout.
 * The adapter has its own setTimeout at agentTimeoutMs; this outer wrapper
 * at agentTimeoutMs + 5s catches the case where the adapter's internal timeout
 * doesn't cleanly resolve (e.g., stuck in a finally block after SIGTERM).
 */
const AGENT_EXECUTE_TIMEOUT_GRACE_MS = 5_000;
/** Timeout for teardown commands (30 seconds) */
const TEARDOWN_TIMEOUT_MS = 30_000;

export async function createAgentRunContext(
  outputPath: string,
  workspaceRootPath: string,
  task: Awaited<ReturnType<typeof loadTaskPack>>,
  preflight: AdapterPreflightResult,
  options: { updateSnapshots?: boolean; cancellation?: BenchmarkCancellation; debug?: boolean }
): Promise<AgentRunContext> {
  const adapter = getAdapter(preflight.baseAgentId);
  const agentOutputPath = path.join(outputPath, "agents", preflight.variantId);
  const workspacePath = path.join(workspaceRootPath, preflight.variantId);
  const tracePath = path.join(agentOutputPath, "trace.jsonl");
  const traceRecorder = new JsonlTraceRecorder(tracePath);
  const executionEnvironment = buildExecutionEnvironment(task.envAllowList);
  const cancellation = options.cancellation;
  const throwIfCancelled = (stage: string) => {
    throwIfAborted(cancellation?.signal, createCancellationSummary(stage));
  };
  return {
    task,
    adapter,
    agentOutputPath,
    workspacePath,
    tracePath,
    traceRecorder,
    executionEnvironment,
    cancellation,
    throwIfCancelled,
    debug: options.debug ?? false
  };
}

export interface BeforeSnapshotResult {
  snapshot: Map<string, { relativePath: string; hash: string }>;
  reliable: boolean;
  reason?: string;
}

export async function createBeforeSnapshot(
  preflight: AdapterPreflightResult,
  context: AgentRunContext
): Promise<BeforeSnapshotResult> {
  const { workspacePath, traceRecorder } = context;

  try {
    return { snapshot: await snapshotDirectory(workspacePath), reliable: true };
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "snapshot.before_failed",
      message: "Failed to create before snapshot. Diff will be marked unreliable.",
      metadata: errorDetails
    });
    logger.warn("runner", "snapshot.before_failed", `Before snapshot failed for ${preflight.agentId}: ${errorDetails.message}. Diff marked unreliable.`, {
      agentId: preflight.agentId
    });
    return { snapshot: new Map(), reliable: false, reason: errorDetails.message };
  }
}

export async function executeAgent(
  preflight: AdapterPreflightResult,
  repoPath: string,
  context: AgentRunContext
): Promise<{ adapterResult: Awaited<ReturnType<typeof context.adapter.execute>> | undefined; adapterError: unknown; startedAt: number }> {
  const { adapter, workspacePath, executionEnvironment, traceRecorder, cancellation, task, debug } = context;
  const startedAt = Date.now();
  let adapterResult: Awaited<ReturnType<typeof adapter.execute>> | undefined;
  let adapterError: unknown;
  const adapterTimeoutMs = agentExecuteTimeoutMs();
  const adapterAbortController = new AbortController();
  let adapterTimedOut = false;
  let adapterTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const forwardCancellation = () => {
    adapterAbortController.abort();
  };

  debugLog(debug, `  [adapter] Executing ${adapter.title} (${adapter.kind})`);
  debugLog(debug, `  [adapter] Timeout: ${adapterTimeoutMs}ms`);

  metrics.agentExecuteTotal.inc({ agentId: preflight.agentId, adapterKind: adapter.kind });
  logger.info("adapter", "agent.execute", `Starting agent execution: ${adapter.title}`, {
    agentId: preflight.agentId,
    variantId: preflight.variantId,
    metadata: { adapterKind: adapter.kind, timeoutMs: adapterTimeoutMs }
  });

  if (cancellation?.signal) {
    if (cancellation.signal.aborted) {
      forwardCancellation();
    } else {
      cancellation.signal.addEventListener("abort", forwardCancellation, { once: true });
    }
  }

  try {
    adapterTimeoutHandle = setTimeout(() => {
      adapterTimedOut = true;
      adapterAbortController.abort();
    }, adapterTimeoutMs);

    debugLog(debug, `  [adapter] Starting execute...`);
    const executePromise = adapter.execute({
      agentId: preflight.agentId,
      selection: {
        baseAgentId: preflight.baseAgentId,
        variantId: preflight.variantId,
        displayLabel: preflight.displayLabel,
        config: preflight.requestedConfig
      },
      repoPath,
      workspacePath,
      environment: executionEnvironment,
      task,
      signal: adapterAbortController.signal,
      trace: async (event: Omit<TraceEvent, "agentId" | "timestamp">) => {
        await traceRecorder.record({
          ...event,
          agentId: preflight.agentId,
          timestamp: new Date().toISOString()
        });
      },
      sandbox: createWorkspaceSandbox(workspacePath, async (event) => {
        await traceRecorder.record({
          ...event,
          agentId: preflight.agentId,
          timestamp: new Date().toISOString()
        });
      })
    });

    adapterResult = await wrapWithTimeout(
      executePromise,
      adapterTimeoutMs + AGENT_EXECUTE_TIMEOUT_GRACE_MS,
      `${adapter.title} execution shutdown`
    );
  } catch (error) {
    adapterError =
      adapterTimedOut
        ? new Error(`${adapter.title} execution timed out after ${adapterTimeoutMs}ms.`)
        : error;

    if (adapterTimedOut) {
      metrics.agentTimeoutTotal.inc({ agentId: preflight.agentId, adapterKind: adapter.kind });
      logger.warn("adapter", "agent.timeout", `${adapter.title} execution timed out`, {
        agentId: preflight.agentId,
        variantId: preflight.variantId,
        metadata: { timeoutMs: adapterTimeoutMs }
      });
    } else {
      logger.error("adapter", "agent.error", `${adapter.title} execution failed`, {
        agentId: preflight.agentId,
        variantId: preflight.variantId,
        error
      });
    }

    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "adapter.error",
      message: adapterTimedOut ? `${adapter.title} execution timed out.` : `${adapter.title} execution failed.`,
      metadata: {
        ...errorDetails,
        timeoutMs: adapterTimedOut ? adapterTimeoutMs : undefined
      }
    });
  } finally {
    if (adapterTimeoutHandle) {
      clearTimeout(adapterTimeoutHandle);
    }
    cancellation?.signal?.removeEventListener("abort", forwardCancellation);
  }

  const durationMs = Date.now() - startedAt;
  debugLog(debug, `  [adapter] Completed in ${durationMs}ms`);
  if (adapterResult) {
    debugLog(debug, `  [adapter] Status: ${adapterResult.status}, tokens: ${adapterResult.tokenUsage}, cost: $${adapterResult.estimatedCostUsd}`);
  }
  if (adapterError) {
    debugLog(debug, `  [adapter] Error: ${formatErrorMessage(adapterError)}`);
  }

  return { adapterResult, adapterError, startedAt };
}

export async function runJudgesAndAfterSnapshot(
  preflight: AdapterPreflightResult,
  adapterResult: Awaited<ReturnType<typeof context.adapter.execute>> | undefined,
  beforeSnapshotResult: BeforeSnapshotResult,
  options: Pick<{ updateSnapshots?: boolean }, "updateSnapshots">,
  context: AgentRunContext
): Promise<{ judgeResults: Awaited<ReturnType<typeof runJudges>>; judgeError: unknown; afterSnapshot: Map<string, { relativePath: string; hash: string }>; diff: DiffSummary; changedFiles: string[]; diffPrecision: DiffPrecisionSummary | undefined; diffReliable: boolean }> {
  const { task, workspacePath, traceRecorder, throwIfCancelled, cancellation } = context;

  let judgeResults: Awaited<ReturnType<typeof runJudges>> = [];
  let judgeError: unknown;

  if (adapterResult && adapterResult.status === "success") {
    try {
      throwIfCancelled("judges");
      judgeResults = await runJudges(task.judges, workspacePath, task.envAllowList, {
        updateSnapshots: options.updateSnapshots,
        signal: cancellation?.signal,
        tokenUsage: adapterResult.tokenUsage,
        tokenBudget: task.metadata?.tokenBudget
      });

    } catch (error) {
      judgeError = error;
      if (!isAbortError(error)) {
        const errorDetails = formatErrorDetails(error);
        await traceRecorder.record({
          agentId: preflight.agentId,
          timestamp: new Date().toISOString(),
          type: "judge.error",
          message: "Judges execution failed.",
          metadata: errorDetails
        });
      }
    }
  }

  let afterSnapshot: Map<string, { relativePath: string; hash: string }>;
  let afterReliable = true;
  let afterReason: string | undefined;
  try {
    afterSnapshot = await snapshotDirectory(workspacePath);
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "snapshot.after_failed",
      message: "Failed to create after snapshot. Diff will be marked unreliable.",
      metadata: errorDetails
    });
    logger.warn("runner", "snapshot.after_failed", `After snapshot failed for ${preflight.agentId}: ${errorDetails.message}. Diff marked unreliable.`, {
      agentId: preflight.agentId
    });
    afterSnapshot = new Map();
    afterReliable = false;
    afterReason = errorDetails.message;
  }

  const diffReliable = beforeSnapshotResult.reliable && afterReliable;
  const unreliableReason = !diffReliable
    ? (beforeSnapshotResult.reason ?? afterReason ?? "snapshot failed")
    : undefined;
  const diff = diffSnapshots(beforeSnapshotResult.snapshot, afterSnapshot, {
    reliable: diffReliable,
    unreliableReason
  });
  const changedFiles = buildChangedFiles(diff, adapterResult?.changedFilesHint ?? []);
  const diffPrecision = buildDiffPrecision(task.expectedChangedPaths, changedFiles, { reliable: diffReliable });

  return { judgeResults, judgeError, afterSnapshot, diff, changedFiles, diffPrecision, diffReliable };
}

export async function recordFinalEvents(
  preflight: AdapterPreflightResult,
  judgeResults: Awaited<ReturnType<typeof runJudges>>,
  judgeError: unknown,
  teardownResults: CommandStepResult[],
  teardownError: unknown,
  success: boolean,
  context: AgentRunContext
): Promise<void> {
  await context.traceRecorder.record({
    agentId: preflight.agentId,
    timestamp: new Date().toISOString(),
    type: "judge.finish",
    message: success ? "All judges passed" : "One or more judges failed",
    metadata: {
      judgeResults: judgeResults.map((value) => ({
        label: value.label,
        type: value.type,
        success: value.success,
        exitCode: value.exitCode,
        command: value.command,
        target: value.target,
        expectation: value.expectation,
        stdout: value.stdout?.substring(0, 500),
        stderr: value.stderr?.substring(0, 500)
      })),
      judgeError: judgeError ? formatErrorMessage(judgeError) : undefined
    }
  });

  await context.traceRecorder.record({
    agentId: preflight.agentId,
    timestamp: new Date().toISOString(),
    type: "teardown.finish",
    message:
      teardownResults.length === 0
        ? "No teardown commands executed."
        : teardownResults.every((value) => value.success)
          ? "All teardown commands passed."
          : "One or more teardown commands failed.",
    metadata: {
      teardownResults: teardownResults.map((value) => ({
        stepId: value.stepId,
        label: value.label,
        success: value.success,
        exitCode: value.exitCode
      })),
      teardownError: teardownError ? formatErrorMessage(teardownError) : undefined
    }
  });
}

// wrapWithTimeout and normalizeSelections moved to dedicated modules

/**
 * Execute a single agent run through the full benchmark pipeline.
 *
 * STATE MACHINE (implicit — no state variable, each phase returns or continues):
 *
 *   1. createAgentRunContext   — allocate workspace, trace recorder, abort controller
 *   2. setupWorkspaceAndPrechecks — copy repo, check preflight status
 *      → returns early if preflight blocked
 *   3. runSetupCommands        — run task setup commands
 *      → returns early if any setup command fails
 *   4. createBeforeSnapshot    — snapshot workspace before agent runs
 *   5. executeAgent            — run adapter with timeout + cancellation
 *   6. collectChangedFiles     — git diff for changed file detection
 *   7. runJudgesAndAfterSnapshot — run judges + after-snapshot + diff
 *   8. runTeardownCommands     — cleanup commands (ALWAYS runs, even on cancel)
 *   9. buildFinalResult        — assemble the result object
 *
 * CRITICAL BEHAVIORS:
 *
 * - Teardown failure marks the ENTIRE run as failed, even if agent + all judges
 *   passed. This is intentional: a failing cleanup script indicates an
 *   environment problem that invalidates the benchmark.
 *
 * - Cancellation is a three-layer system:
 *   (a) BenchmarkCancellation.signal → forwarded to adapter's AbortController
 *   (b) Adapter timeout → SIGTERM → grace period → SIGKILL
 *   (c) Teardown ignores cancellation if adapter/judges already aborted
 *       (teardownShouldIgnoreCancellation), ensuring cleanup always runs
 *
 * - Timeout is double-layered:
 *   (a) Adapter gets agentTimeoutMs() + 5s grace period (AGENT_EXECUTE_TIMEOUT_GRACE_MS)
 *   (b) Teardown gets TEARDOWN_TIMEOUT_MS (30s)
 *
 * - changedFilesHint (agent-claimed) vs changedFiles (git diff):
 *   If git is unreliable (snapshot failed), the hint becomes the primary source.
 *   The diffReliable flag tracks this but is NOT surfaced to the user in the UI.
 *
 * - success requires ALL of: adapter succeeded, no adapter error, no judge error,
 *   all judges passed, no teardown error, all teardown passed.
 */
export async function runAgent(
  repoPath: string,
  outputPath: string,
  workspaceRootPath: string,
  task: Awaited<ReturnType<typeof loadTaskPack>>,
  preflight: AdapterPreflightResult,
  options: { updateSnapshots?: boolean; cancellation?: BenchmarkCancellation; debug?: boolean }
): Promise<AgentRunResult> {
  const context = await createAgentRunContext(outputPath, workspaceRootPath, task, preflight, options);
  debugLog(context.debug, `Starting agent ${preflight.displayLabel} (${preflight.variantId})`);
  debugLog(context.debug, `  workspace: ${context.workspacePath}`);
  debugLog(context.debug, `  trace: ${context.tracePath}`);
  debugLog(context.debug, `  timeout: ${agentExecuteTimeoutMs()}ms`);

  try {
  const earlyResult1 = await setupWorkspaceAndPrechecks(repoPath, preflight, context);
  if (earlyResult1) {
    return earlyResult1;
  }

  const { setupResults, earlyResult: earlyResult2 } = await runSetupCommands(preflight, context);
  if (earlyResult2) {
    return earlyResult2;
  }

  const beforeSnapshotResult = await createBeforeSnapshot(preflight, context);

  const { adapterResult, adapterError, startedAt } = await executeAgent(preflight, repoPath, context);

  const collectedResult = await collectChangedFiles(context.workspacePath);
  const collectedFiles = collectedResult.files;

  const { judgeResults, judgeError, diff, changedFiles, diffPrecision } = await runJudgesAndAfterSnapshot(
    preflight,
    adapterResult,
    beforeSnapshotResult,
    options,
    context
  );

  let teardownResults: CommandStepResult[] = [];
  let teardownError: unknown;
  const teardownTimeout = TEARDOWN_TIMEOUT_MS;
  let teardownTimedOut = false;
  const teardownAbortController = new AbortController();
  const teardownTimeoutHandle = setTimeout(() => {
    teardownTimedOut = true;
    teardownAbortController.abort();
  }, teardownTimeout);
  try {
    ({ teardownResults, teardownError } = await runTeardownCommands(
      preflight,
      adapterError,
      judgeError,
      context,
      teardownAbortController.signal
    ));
  } catch (error) {
    teardownError = error;
    const errorDetails = formatErrorDetails(error);
    await context.traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "teardown.error",
      message: "Teardown commands execution failed.",
      metadata: errorDetails
    });
  } finally {
    clearTimeout(teardownTimeoutHandle);
  }
  if (teardownTimedOut && !teardownError) {
    teardownError = new Error("Teardown timeout");
    const errorDetails = formatErrorDetails(teardownError);
    await context.traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "teardown.error",
      message: "Teardown commands timed out.",
      metadata: errorDetails
    });
  }

  const cancelled =
    isAbortError(adapterError) ||
    isAbortError(judgeError) ||
    isAbortError(teardownError) ||
    context.cancellation?.signal?.aborted === true;
  const success =
    !cancelled &&
    adapterResult?.status === "success" &&
    !adapterError &&
    !judgeError &&
    judgeResults.every((value) => value.success) &&
    !teardownError &&
    teardownResults.every((value) => value.success);

  await recordFinalEvents(preflight, judgeResults, judgeError, teardownResults, teardownError, success, context);

  // Extract the assembled prompt for inclusion in the result.
  // Three-layer fallback (any layer may silently produce undefined):
  //   1. Trace events: adapter.prompt event written by the adapter
  //   2. File fallback: prompt.txt in the workspace (some adapters write this)
  //   3. undefined: prompt omitted from result (UI shows "no prompt available")
  let assembledPrompt: string | undefined;
  try {
    const promptEvents = await context.traceRecorder.query({
      filter: { type: "adapter.prompt", agentId: preflight.agentId },
      limit: 1
    });
    const promptEvent = promptEvents[0];
    if (promptEvent?.metadata?.prompt && typeof promptEvent.metadata.prompt === "string") {
      assembledPrompt = promptEvent.metadata.prompt;
    }
  } catch {
    // Trace query failed — try file fallback
    try {
      const promptPath = path.join(context.workspacePath, "prompt.txt");
      assembledPrompt = await fs.readFile(promptPath, "utf8");
    } catch {
      // Both layers failed — prompt will be undefined in result
    }
  }

  return buildFinalResult(
    preflight,
    context,
    adapterResult,
    adapterError,
    startedAt,
    setupResults,
    judgeResults,
    teardownResults,
    diff,
    changedFiles,
    collectedFiles,
    diffPrecision,
    cancelled,
    success,
    assembledPrompt
  );
  } finally {
    // Clean up intermediate files on cancellation
    if (context.cancellation?.signal?.aborted) {
      try {
        const intermediateFiles = [
          context.tracePath,
          path.join(context.agentOutputPath, "before-snapshot.json"),
          path.join(context.agentOutputPath, "after-snapshot.json"),
        ];
        for (const filePath of intermediateFiles) {
          try {
            await fs.unlink(filePath);
          } catch (error) {
            const errCode = (error as NodeJS.ErrnoException | undefined)?.code;
            if (errCode !== "ENOENT") {
              logger.debug("runner", "cleanup.intermediate_failed", `Failed to delete intermediate file: ${error instanceof Error ? error.message : String(error)}`, {
                metadata: { filePath }
              });
            }
          }
        }
      } catch (error) {
        logger.debug("runner", "cleanup.intermediate_failed", `Intermediate file cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await context.traceRecorder.close().catch((closeError: unknown) => {
      logger.warn("runner", "trace.close_failed", `Failed to close trace recorder: ${closeError instanceof Error ? closeError.message : String(closeError)}`);
    });
  }
}
