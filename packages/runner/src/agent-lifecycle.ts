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
import { collectFileDiffs } from "./file-diffs.js";
import { buildFinalResult } from "./result-assembly.js";
import {
  buildChangedFiles,
  createCancellationSummary,
} from "./result-builder.js";
import { buildDiffPrecision } from "./snapshot.js";
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
  preflight: AdapterPreflightResult & { adapter?: AgentRunContext["adapter"] },
  options: { updateSnapshots?: boolean; cancellation?: BenchmarkCancellation; debug?: boolean; allowEvalInTaskCommands?: boolean }
): Promise<AgentRunContext> {
  // Prefer an already-resolved adapter injected via preflight (M12),
  // falling back to the registry lookup for backward compatibility.
  const adapter = preflight.adapter ?? getAdapter(preflight.baseAgentId);
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
    debug: options.debug ?? false,
    allowEvalInTaskCommands: options.allowEvalInTaskCommands
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
  context: AgentRunContext,
  options: { enableActivity?: boolean; onActivity?: (line: string, stream: "stdout" | "stderr", seq: number) => void } = {}
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
      // Pass activity callback so real CLI adapters can stream stdout/stderr
      ...(options.enableActivity && options.onActivity ? { onActivity: options.onActivity } : {}),
      trace: async (event: Omit<TraceEvent, "agentId" | "timestamp">) => {
        await traceRecorder.record({
          ...event,
          agentId: preflight.agentId,
          timestamp: new Date().toISOString()
        });
        // Also emit as activity for live display (trace messages are the
        // demo adapter's "stdout equivalent")
        if (options.enableActivity && options.onActivity) {
          const text = event.message ?? JSON.stringify(event.metadata ?? {});
          if (text) options.onActivity(text, "stdout", 0);
        }
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
        tokenBudget: task.metadata?.tokenBudget,
        tokenUsageReliable: adapterResult.tokenUsageReliable,
        allowEval: context.allowEvalInTaskCommands
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
  validationStatus: NonNullable<AgentRunResult["validationStatus"]>,
  context: AgentRunContext
): Promise<void> {
  const validationMessage = {
    passed: "All judges passed",
    partial: "One or more non-critical judges failed",
    failed: "One or more critical judges failed",
    error: "Judges execution failed",
    "not-run": "Judges were not run"
  }[validationStatus];
  await context.traceRecorder.record({
    agentId: preflight.agentId,
    timestamp: new Date().toISOString(),
    type: "judge.finish",
    message: validationMessage,
    metadata: {
      validationStatus,
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
 * **Error propagation strategy:** This function never throws. All errors
 * (adapter failures, judge failures, snapshot failures, teardown failures,
 * timeouts, cancellation) are caught, logged, and folded into the returned
 * `AgentRunResult` as structured fields (`status`, `adapterError`, `judgeError`,
 * `teardownError`, `cancelled`). The caller can inspect the result to determine
 * what went wrong without needing try/catch. The only exception is if the
 * trace recorder itself fails to close, which is swallowed in the finally block.
 *
 * **Pipeline phases:** createAgentRunContext -> setupWorkspaceAndPrechecks ->
 * runSetupCommands -> createBeforeSnapshot -> executeAgent ->
 * runJudgesAndAfterSnapshot -> collectFileDiffs -> runTeardownCommands ->
 * buildFinalResult.
 *
 * **Critical behaviors:**
 * - Teardown failure marks the ENTIRE run as failed (intentional: environment problem).
 * - Teardown ALWAYS runs, even on cancellation (three-layer cancellation system).
 * - Timeout is double-layered: adapter timeout + grace period, teardown gets 30s.
 * - success requires ALL of: adapter succeeded, no errors, all judges passed, all teardown passed.
 */
export async function runAgent(
  repoPath: string,
  outputPath: string,
  workspaceRootPath: string,
  task: Awaited<ReturnType<typeof loadTaskPack>>,
  preflight: AdapterPreflightResult,
  options: {
    updateSnapshots?: boolean;
    cancellation?: BenchmarkCancellation;
    debug?: boolean;
    /** When true, capture stdout/stderr and emit activity events. */
    enableActivityEvents?: boolean;
    /** Per-agent log store for capturing output lines. */
    agentLogStore?: import("@agentarena/core").AgentLogStore;
    /** Callback invoked (post-debounce) for each captured stdout/stderr line. */
    onActivity?: (line: string, stream: "stdout" | "stderr", seq: number) => void;
    /** External monotonic seq provider (from runner). Falls back to local counter. */
    nextActivitySeq?: () => number;
    allowEvalInTaskCommands?: boolean;
  }
): Promise<AgentRunResult> {
  const context = await createAgentRunContext(outputPath, workspaceRootPath, task, preflight, options);
  debugLog(context.debug, `Starting agent ${preflight.displayLabel} (${preflight.variantId})`);
  debugLog(context.debug, `  workspace: ${context.workspacePath}`);
  debugLog(context.debug, `  trace: ${context.tracePath}`);
  debugLog(context.debug, `  timeout: ${agentExecuteTimeoutMs()}ms`);

  // ── Per-agent activity capture (opt-in) ──
  // RingBuffer for last 30 lines (failureTail). Shared with AgentLogStore
  // when provided — the store gets ALL lines, the buffer only keeps 30 for
  // failure diagnostics.
  const enableActivity = options.enableActivityEvents === true;
  const pendingLines: string[] = [];     // sliding window of last 30 lines
  const MAX_FAILURE_TAIL = 30;
  // Use external monotonic seq provider (per-run) or fall back to local counter
  let localSeqCounter = 0;
  const getNextSeq = options.nextActivitySeq ?? (() => localSeqCounter++);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedLines: Array<{ line: string; stream: "stdout" | "stderr"; seq: number }> = [];
  const DEBOUNCE_MS = 120;

  /** Extract all pending debounced lines (mutates the array). */
  const spliceDebouncedLines = (
    arr: Array<{ line: string; stream: "stdout" | "stderr"; seq: number }>
  ): Array<{ line: string; stream: "stdout" | "stderr"; seq: number }> => {
    if (arr.length === 0) return [];
    return arr.splice(0, arr.length);
  };

  const pushActivityLine = (line: string, stream: "stdout" | "stderr") => {
    const seq = getNextSeq();
    // Always store in AgentLogStore if provided (full fidelity)
    options.agentLogStore?.append(preflight.variantId, {
      seq,
      ts: Date.now(),
      stream,
      text: line
    });
    // Keep last 30 lines for failureTail (sliding window)
    pendingLines.push(`[${stream}] ${line}`);
    if (pendingLines.length > MAX_FAILURE_TAIL) pendingLines.shift();
    // Debounce the emitted event (high-frequency output shouldn't flood the bus).
    // Capture seq at push time so the streamed SSE order exactly matches the
    // AgentLogStore order (critical for Last-Event-ID reconnect resync).
    debouncedLines.push({ line, stream, seq });
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const batch = spliceDebouncedLines(debouncedLines);
      for (const { line: ln, stream: st, seq: sq } of batch) {
        options.onActivity?.(ln, st, sq);
      }
    }, DEBOUNCE_MS);
  };

  /** Flush any pending debounced lines immediately. */
  const flushActivity = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const batch = spliceDebouncedLines(debouncedLines);
    for (const { line: ln, stream: st, seq: sq } of batch) {
      options.onActivity?.(ln, st, sq);
    }
  };

  // Tracks the final status so the finally block can decide whether to purge
  // intermediate evidence. We only delete trace/snapshots when the run was
  // genuinely cancelled (never when it succeeded or failed), so a late-arriving
  // cancel signal cannot destroy evidence for an already-completed run.
  let runStatus: string | undefined;
  // Held so finally can attach trace integrity after close() without losing it
  // on early returns (same object reference is returned to the caller).
  let outgoingResult: AgentRunResult | undefined;
  try {
  const earlyResult1 = await setupWorkspaceAndPrechecks(repoPath, preflight, context);
  if (earlyResult1) {
    runStatus = earlyResult1.status;
    outgoingResult = earlyResult1;
    return earlyResult1;
  }

  const { setupResults, earlyResult: earlyResult2 } = await runSetupCommands(preflight, context);
  if (earlyResult2) {
    // Contract (see runAgent docs): once the workspace exists, teardown ALWAYS
    // runs on cancellation. A cancel landing in the setup phase still has a
    // prepared workspace, so run cleanup and attach the results before returning.
    // runTeardownCommands ignores the aborted cancellation signal in this case.
    if (earlyResult2.status === "cancelled" && (task.teardownCommands?.length ?? 0) > 0) {
      const setupCancelTeardownController = new AbortController();
      const setupCancelTeardownHandle = setTimeout(
        () => setupCancelTeardownController.abort(),
        TEARDOWN_TIMEOUT_MS
      );
      try {
        const { teardownResults: cancelTeardownResults } = await runTeardownCommands(
          preflight,
          undefined,
          undefined,
          context,
          setupCancelTeardownController.signal
        );
        runStatus = earlyResult2.status;
        const cancelledWithTeardown = { ...earlyResult2, teardownResults: cancelTeardownResults };
        outgoingResult = cancelledWithTeardown;
        return cancelledWithTeardown;
      } finally {
        clearTimeout(setupCancelTeardownHandle);
      }
    }
    runStatus = earlyResult2.status;
    outgoingResult = earlyResult2;
    return earlyResult2;
  }

  const beforeSnapshotResult = await createBeforeSnapshot(preflight, context);

  const { adapterResult, adapterError, startedAt } = await executeAgent(preflight, repoPath, context, {
    enableActivity,
    onActivity: enableActivity ? pushActivityLine : undefined
  });

    const { judgeResults, judgeError, diff, changedFiles, diffPrecision, diffReliable } = await runJudgesAndAfterSnapshot(
    preflight,
    adapterResult,
    beforeSnapshotResult,
    options,
    context
  );

  // Capture agent-produced evidence before teardown commands can modify or
  // remove the files that were evaluated.
  const fileDiffs = changedFiles.length > 0
    ? await collectFileDiffs(context.workspacePath, changedFiles)
    : [];

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
  const criticalJudgeFailed = judgeResults.some(
    (value) => value.critical === true && !value.success
  );
  const nonCriticalJudgeFailed = judgeResults.some(
    (value) => value.critical !== true && !value.success
  );
  const validationStatus: NonNullable<AgentRunResult["validationStatus"]> =
    adapterResult?.status !== "success" || adapterError
      ? "not-run"
      : judgeError
        ? "error"
        : criticalJudgeFailed
          ? "failed"
          : nonCriticalJudgeFailed
            ? "partial"
            : "passed";
  const executionStatus: NonNullable<AgentRunResult["executionStatus"]> =
    cancelled
      ? "cancelled"
      : adapterResult?.status !== "success" ||
          adapterError ||
          judgeError ||
          teardownError ||
          teardownResults.some((value) => !value.success)
        ? "failed"
        : "completed";
  const success =
    executionStatus === "completed" &&
    validationStatus !== "failed" &&
    validationStatus !== "error";

  await recordFinalEvents(
    preflight,
    judgeResults,
    judgeError,
    teardownResults,
    teardownError,
    validationStatus,
    context
  );

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
    // Trace query failed; the file fallback below may still recover it.
  }

  if (assembledPrompt === undefined) {
    try {
      const promptPath = path.join(context.workspacePath, "prompt.txt");
      assembledPrompt = await fs.readFile(promptPath, "utf8");
    } catch {
      // Both layers failed; prompt will be undefined in result.
    }
  }

  const runResult = buildFinalResult(
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
    diffPrecision,
    cancelled,
    success,
    assembledPrompt,
    diffReliable,
    fileDiffs,
    executionStatus,
    validationStatus
  );

  // Attach failureTail when the run failed (opt-in: only when activity capture was enabled)
  if (enableActivity && (runResult.status === "failed") && pendingLines.length > 0) {
    runResult.failureTail = [...pendingLines];
  }

  runStatus = runResult.status;
  outgoingResult = runResult;
  return runResult;
  } catch (error) {
    // Preserve the cancellation reason for the finally block even when the
    // cancellation arrives before the pipeline can construct a result.
    if (isAbortError(error)) {
      runStatus = "cancelled";
    }
    throw error;
  } finally {
    // A cancellation can happen before the first normal trace event (for
    // example, between agent scheduling and workspace setup). Keep a minimal
    // replayable event in that case and for all normal cancelled results.
    if (runStatus === "cancelled") {
      await context.traceRecorder.record({
        agentId: preflight.agentId,
        timestamp: new Date().toISOString(),
        type: "agent.cancelled",
        message: "Agent run cancelled.",
        metadata: { variantId: preflight.variantId }
      });
    }
    // Flush any pending debounced activity lines before exiting
    flushActivity();
    // Trace and snapshots are evidence, including when execution is cancelled.
    // Only the outer runner may remove temporary workspaces; never delete the
    // files referenced by AgentRunResult.tracePath here.

    await context.traceRecorder.close().catch((closeError: unknown) => {
      logger.warn("runner", "trace.close_failed", `Failed to close trace recorder: ${closeError instanceof Error ? closeError.message : String(closeError)}`);
    });

    // Surface incomplete traces on the result object after close drains the queue.
    if (outgoingResult) {
      const integrity = context.traceRecorder.getIntegrity();
      if (integrity.writeFailed) {
        outgoingResult.traceWriteFailed = true;
      }
      if (integrity.droppedWrites > 0) {
        outgoingResult.traceDroppedWrites = integrity.droppedWrites;
      }
    }
  }
}
