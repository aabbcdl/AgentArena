import path from "node:path";
import { getAdapter } from "@agentarena/adapters";
import {
  type AdapterPreflightResult,
  type AgentRunResult,
  type AgentSelection,
  type BenchmarkCancellation,
  BenchmarkCancelledError,
  buildExecutionEnvironment,
  type CommandStepResult,
  copyRepository,
  createAgentSelection,
  createWorkspaceSandbox,
  type DiffPrecisionSummary,
  type DiffSummary,
  diffSnapshots,
  ensureDirectory,
  isAbortError,
  logger,
  metrics,
  snapshotDirectory,
  type TraceEvent,
  throwIfAborted,
} from "@agentarena/core";
import { runCommandSteps, runJudges } from "@agentarena/judges";
import type { loadTaskPack } from "@agentarena/taskpacks";
import { JsonlTraceRecorder } from "@agentarena/trace";
import { agentExecuteTimeoutMs } from "./concurrency.js";
import {
  buildChangedFiles,
  createBaseResult,
  createCancellationSummary,
  createCancelledRunResult,
  createSkippedRunResult,
  mergeResolvedRuntime,
  summarizeCommandStepFailure
} from "./result-builder.js";
import { buildDiffPrecision, collectChangedFiles } from "./snapshot.js";
import { debugLog, formatErrorDetails, formatErrorMessage } from "./workspace.js";

const AGENT_EXECUTE_TIMEOUT_GRACE_MS = 5_000;

export interface AgentRunContext {
  task: Awaited<ReturnType<typeof loadTaskPack>>;
  adapter: ReturnType<typeof getAdapter>;
  agentOutputPath: string;
  workspacePath: string;
  tracePath: string;
  traceRecorder: JsonlTraceRecorder;
  executionEnvironment: ReturnType<typeof buildExecutionEnvironment>;
  cancellation: BenchmarkCancellation | undefined;
  throwIfCancelled: (stage: string) => void;
  debug: boolean;
}

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

export async function setupWorkspaceAndPrechecks(
  repoPath: string,
  preflight: AdapterPreflightResult,
  context: AgentRunContext
): Promise<AgentRunResult | undefined> {
  const { agentOutputPath, workspacePath, traceRecorder, throwIfCancelled } = context;

  if (preflight.status === "missing" || preflight.status === "blocked") {
    await ensureDirectory(agentOutputPath);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "preflight.result",
      message: preflight.summary,
      metadata: {
        status: preflight.status,
        command: preflight.command,
        details: preflight.details
      }
    });
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "agent.skipped",
      message: `Skipped ${preflight.agentId} because preflight status is ${preflight.status}.`,
      metadata: {
        status: preflight.status
      }
    });
    return createSkippedRunResult(preflight, context.tracePath, workspacePath);
  }

  await ensureDirectory(agentOutputPath);

  throwIfCancelled("workspace setup");

  try {
    await copyRepository(repoPath, workspacePath);
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "agent.copy_failed",
      message: "Failed to copy repository to workspace.",
      metadata: errorDetails
    });
    return {
      ...createSkippedRunResult(preflight, context.tracePath, workspacePath),
      summary: `Failed to copy repository: ${errorDetails.message}`
    };
  }

  await traceRecorder.record({
    agentId: preflight.agentId,
    timestamp: new Date().toISOString(),
    type: "preflight.result",
    message: preflight.summary,
    metadata: {
      status: preflight.status,
      command: preflight.command,
      details: preflight.details
    }
  });

  return undefined;
}

export async function runSetupCommands(
  preflight: AdapterPreflightResult,
  context: AgentRunContext
): Promise<{ setupResults: CommandStepResult[]; earlyResult?: AgentRunResult }> {
  const { task, workspacePath, traceRecorder, throwIfCancelled, cancellation } = context;

  let setupResults: CommandStepResult[] = [];
  try {
    throwIfCancelled("setup");
    setupResults = await runCommandSteps(task.setupCommands, workspacePath, task.envAllowList, cancellation?.signal);
  } catch (error) {
    if (isAbortError(error)) {
      return {
        setupResults: [],
        earlyResult: createCancelledRunResult(preflight, context.tracePath, workspacePath, formatErrorMessage(error))
      };
    }
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "setup.error",
      message: "Setup commands execution failed.",
      metadata: errorDetails
    });
    return {
      setupResults: [],
      earlyResult: {
        ...createSkippedRunResult(preflight, context.tracePath, workspacePath),
        summary: `Setup commands failed: ${errorDetails.message}`,
        setupResults: []
      }
    };
  }

  await traceRecorder.record({
    agentId: preflight.agentId,
    timestamp: new Date().toISOString(),
    type: "setup.finish",
    message:
      setupResults.length === 0
        ? "No setup commands executed."
        : setupResults.every((value) => value.success)
          ? "All setup commands passed."
          : "One or more setup commands failed.",
    metadata: {
      setupResults: setupResults.map((value) => ({
        stepId: value.stepId,
        label: value.label,
        success: value.success,
        exitCode: value.exitCode
      }))
    }
  });

  if (setupResults.some((value) => !value.success)) {
    const failedStep = setupResults.find((value) => !value.success) ?? setupResults[0];
    return {
      setupResults,
      earlyResult: {
        agentId: preflight.agentId,
        baseAgentId: preflight.baseAgentId,
        variantId: preflight.variantId,
        displayLabel: preflight.displayLabel,
        requestedConfig: preflight.requestedConfig,
        resolvedRuntime: preflight.resolvedRuntime,
        agentTitle: context.adapter.title,
        adapterKind: context.adapter.kind,
        preflight,
        status: "failed",
        summary: failedStep
          ? summarizeCommandStepFailure("setup", failedStep)
          : "Setup command failed but no result was captured.",
        durationMs: 0,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFiles: [],
        changedFilesHint: [],
        setupResults,
        judgeResults: [],
        teardownResults: [],
        tracePath: context.tracePath,
        workspacePath,
        diff: {
          added: [],
          changed: [],
          removed: [],
          skippedLargeFiles: []
        }
      }
    };
  }

  return { setupResults, earlyResult: undefined };
}

export async function createBeforeSnapshot(
  preflight: AdapterPreflightResult,
  context: AgentRunContext
): Promise<Map<string, { relativePath: string; hash: string }>> {
  const { workspacePath, traceRecorder } = context;

  let beforeSnapshot: Map<string, { relativePath: string; hash: string }>;
  try {
    beforeSnapshot = await snapshotDirectory(workspacePath);
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "snapshot.before_failed",
      message: "Failed to create before snapshot. Diff accuracy will be reduced.",
      metadata: errorDetails
    });
    console.warn(`Warning: Before snapshot failed for ${preflight.agentId}: ${errorDetails.message}. Diff may be inaccurate.`);
    beforeSnapshot = new Map();
  }

  return beforeSnapshot;
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
  beforeSnapshot: Map<string, { relativePath: string; hash: string }>,
  options: Pick<{ updateSnapshots?: boolean }, "updateSnapshots">,
  context: AgentRunContext
): Promise<{ judgeResults: Awaited<ReturnType<typeof runJudges>>; judgeError: unknown; afterSnapshot: Map<string, { relativePath: string; hash: string }>; diff: DiffSummary; changedFiles: string[]; diffPrecision: DiffPrecisionSummary | undefined }> {
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
  try {
    afterSnapshot = await snapshotDirectory(workspacePath);
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "snapshot.after_failed",
      message: "Failed to create after snapshot. Diff accuracy will be reduced.",
      metadata: errorDetails
    });
    console.warn(`Warning: After snapshot failed for ${preflight.agentId}: ${errorDetails.message}. Diff may be inaccurate.`);
    afterSnapshot = new Map();
  }

  const diff = diffSnapshots(beforeSnapshot, afterSnapshot);
  const changedFiles = buildChangedFiles(diff, adapterResult?.changedFilesHint ?? []);
  const diffPrecision = buildDiffPrecision(task.expectedChangedPaths, changedFiles);

  return { judgeResults, judgeError, afterSnapshot, diff, changedFiles, diffPrecision };
}

export async function runTeardownCommands(
  preflight: AdapterPreflightResult,
  adapterError: unknown,
  judgeError: unknown,
  context: AgentRunContext,
  signal?: AbortSignal
): Promise<{ teardownResults: CommandStepResult[]; teardownError: unknown }> {
  const { task, workspacePath, traceRecorder, cancellation } = context;

  let teardownResults: CommandStepResult[] = [];
  let teardownError: unknown;
  const teardownShouldIgnoreCancellation =
    cancellation?.signal?.aborted === true || isAbortError(adapterError) || isAbortError(judgeError);

  try {
    const effectiveSignal = teardownShouldIgnoreCancellation
      ? signal
      : (signal ?? cancellation?.signal);
    teardownResults = await runCommandSteps(
      task.teardownCommands,
      workspacePath,
      task.envAllowList,
      effectiveSignal
    );
  } catch (error) {
    if (!isAbortError(error)) {
      teardownError = error;
      const errorDetails = formatErrorDetails(error);
      await traceRecorder.record({
        agentId: preflight.agentId,
        timestamp: new Date().toISOString(),
        type: "teardown.error",
        message: "Teardown commands execution failed.",
        metadata: errorDetails
      });
    }
  }

  return { teardownResults, teardownError };
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
        success: value.success,
        exitCode: value.exitCode
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

export function buildFinalResult(
  preflight: AdapterPreflightResult,
  adapterResult: Awaited<ReturnType<typeof context.adapter.execute>> | undefined,
  adapterError: unknown,
  startedAt: number,
  setupResults: CommandStepResult[],
  judgeResults: Awaited<ReturnType<typeof runJudges>>,
  _judgeError: unknown,
  teardownResults: CommandStepResult[],
  _teardownError: unknown,
  diff: DiffSummary,
  changedFiles: string[],
  collectedFiles: string[],
  diffPrecision: DiffPrecisionSummary | undefined,
  cancelled: boolean,
  success: boolean,
  context: AgentRunContext
): AgentRunResult {
  const { adapter, workspacePath, tracePath, task } = context;
  const durationMs = Date.now() - startedAt;

  if (cancelled) {
    return createBaseResult({
      preflight,
      tracePath,
      workspacePath,
      status: "cancelled",
      summary: createCancellationSummary("agent execution"),
      durationMs,
      changedFiles,
      changedFilesHint: collectedFiles,
      setupResults,
      judgeResults,
      teardownResults,
      diff,
      diffPrecision
    });
  }

  if (adapterError) {
    const errorMessage = formatErrorMessage(adapterError);
    return createBaseResult({
      preflight,
      tracePath,
      workspacePath,
      status: "failed",
      summary: `${adapter.title} crashed: ${errorMessage}`,
      durationMs,
      changedFiles,
      changedFilesHint: collectedFiles,
      setupResults,
      diff,
      diffPrecision
    });
  }

  if (!adapterResult) {
    return createBaseResult({
      preflight,
      tracePath,
      workspacePath,
      status: "failed",
      summary: `${adapter.title} did not return a result.`,
      durationMs,
      changedFiles,
      changedFilesHint: collectedFiles,
      setupResults,
      diff,
      diffPrecision
    });
  }

  const tokenUsage = adapterResult.tokenUsage;
  const tokenBudget = task.metadata?.tokenBudget;
  const tokenUsageBreakdown = adapterResult.tokenUsageBreakdown;
  const tokenEfficiencyScore =
    tokenUsage && tokenBudget && Number.isFinite(tokenBudget) && Number.isFinite(tokenUsage) && tokenBudget > 0
      ? Math.min(1, tokenBudget / tokenUsage)
      : undefined;

  const patchValidationJudgeResult = judgeResults.find(
    (result) => result.type === "patch-validation"
  );
  const patchValidationResult = patchValidationJudgeResult
    ? {
        resolved: patchValidationJudgeResult.success,
        failToPassResults: [],
        passToPassResults: []
      }
    : undefined;

  const resolutionRate = patchValidationResult?.resolved !== undefined
    ? (patchValidationResult.resolved ? 1 : 0)
    : undefined;

  const sweBench = patchValidationResult !== undefined
    ? { patchValidationResult, resolutionRate }
    : undefined;

  const taskCategory = task.metadata?.taskCategories?.[0];
  const contaminationChecked = task.metadata?.antiContamination !== undefined;
  const difficultyGeneration = task.metadata?.difficultyEvolution?.generation;

  const liveBench = taskCategory !== undefined || contaminationChecked !== undefined || difficultyGeneration !== undefined
    ? { taskCategory, contaminationChecked, difficultyGeneration }
    : undefined;

  const finalStatus = success ? "success" : "failed";
  const durationSeconds = durationMs / 1000;
  
  metrics.agentStatusTotal.inc({ status: finalStatus, agentId: preflight.agentId, adapterKind: adapter.kind });
  metrics.agentDurationSeconds.observe({ agentId: preflight.agentId, status: finalStatus }, durationSeconds);
  
  if (adapterResult.tokenUsage) {
    metrics.agentTokenUsage.observe({ agentId: preflight.agentId }, adapterResult.tokenUsage);
  }
  
  if (adapterResult.estimatedCostUsd && adapterResult.costKnown) {
    metrics.agentCostUsd.observe({ agentId: preflight.agentId }, adapterResult.estimatedCostUsd);
  }
  
  const passedJudges = judgeResults.filter(j => j.success).length;
  const totalJudges = judgeResults.length;
  if (totalJudges > 0) {
    metrics.judgePassRate.set({ agentId: preflight.agentId }, passedJudges / totalJudges);
  }
  
  logger.info("adapter", "agent.complete", `Agent execution completed: ${adapter.title}`, {
    agentId: preflight.agentId,
    variantId: preflight.variantId,
    metadata: {
      status: finalStatus,
      durationMs,
      tokenUsage: adapterResult.tokenUsage,
      costUsd: adapterResult.estimatedCostUsd,
      judgesPassed: passedJudges,
      judgesTotal: totalJudges
    }
  });

  return createBaseResult({
    preflight,
    tracePath,
    workspacePath,
    status: success ? "success" : "failed",
    summary: adapterResult.summary,
    durationMs,
    tokenUsage: adapterResult.tokenUsage,
    estimatedCostUsd: adapterResult.estimatedCostUsd,
    costKnown: adapterResult.costKnown,
    changedFiles,
    changedFilesHint: collectedFiles,
    setupResults,
    judgeResults,
    teardownResults,
    diff,
    diffPrecision,
    resolvedRuntime: mergeResolvedRuntime(adapterResult.resolvedRuntime, preflight.resolvedRuntime),
    tokenUsageBreakdown,
    tokenEfficiencyScore,
    sweBench,
    liveBench
  });
}

export function wrapWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutHandle);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
  });
}

export function normalizeSelections(options: { agents?: AgentSelection[]; agentIds: string[] }): AgentSelection[] {
  const rawSelections =
    options.agents && options.agents.length > 0
      ? options.agents
      : options.agentIds.map((agentId) =>
          createAgentSelection({
            baseAgentId: agentId,
            displayLabel: getAdapter(agentId).title
          })
        );

  const seenVariantIds = new Map<string, number>();
  return rawSelections.map((selection) => {
    const occurrence = (seenVariantIds.get(selection.variantId) ?? 0) + 1;
    seenVariantIds.set(selection.variantId, occurrence);
    if (occurrence === 1) {
      return selection;
    }

    return {
      ...selection,
      variantId: `${selection.variantId}-${occurrence}`,
      displayLabel: `${selection.displayLabel} #${occurrence}`
    };
  });
}

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

  const beforeSnapshot = await createBeforeSnapshot(preflight, context);

  const { adapterResult, adapterError, startedAt } = await executeAgent(preflight, repoPath, context);

  const collectedFiles = await collectChangedFiles(context.workspacePath);

  const { judgeResults, judgeError, diff, changedFiles, diffPrecision } = await runJudgesAndAfterSnapshot(
    preflight,
    adapterResult,
    beforeSnapshot,
    options,
    context
  );

  let teardownResults: CommandStepResult[] = [];
  let teardownError: unknown;
  const teardownTimeout = 30_000;
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
    teardownError = new BenchmarkCancelledError("Teardown timeout");
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

  return buildFinalResult(
    preflight,
    adapterResult,
    adapterError,
    startedAt,
    setupResults,
    judgeResults,
    judgeError,
    teardownResults,
    teardownError,
    diff,
    changedFiles,
    collectedFiles,
    diffPrecision,
    cancelled,
    success,
    context
  );
  } finally {
    // Clean up intermediate files on cancellation
    if (context.cancellation?.signal?.aborted) {
      try {
        const { promises: fs } = await import("node:fs");
        const intermediateFiles = [
          context.tracePath,
          path.join(context.agentOutputPath, "before-snapshot.json"),
          path.join(context.agentOutputPath, "after-snapshot.json"),
        ];
        for (const filePath of intermediateFiles) {
          try {
            await fs.unlink(filePath);
          } catch (error) {
            console.debug("[agentarena] Failed to delete intermediate file:", error instanceof Error ? error.message : String(error));
          }
        }
      } catch (error) {
        console.debug("[agentarena] Intermediate file cleanup failed:", error instanceof Error ? error.message : String(error));
      }
    }

    await context.traceRecorder.close().catch((closeError: unknown) => {
      console.warn(`[agentarena] Failed to close trace recorder: ${closeError instanceof Error ? closeError.message : String(closeError)}`);
    });
  }
}
