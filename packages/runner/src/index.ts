import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAdapter, preflightAdapters } from "@agentarena/adapters";
import {
  type AdapterPreflightResult,
  type AgentResolvedRuntime,
  type AgentRunResult,
  type AgentSelection,
  type BenchmarkCancellation,
  type BenchmarkRun,
  buildExecutionEnvironment,
  type CommandStepResult,
  copyRepository,
  createAgentSelection,
  createRunId,
  type DiffPrecisionSummary,
  type DiffSummary,
  diffSnapshots,
  ensureDirectory,
  isAbortError,
  resolveRepoSource,
  snapshotDirectory,
  type TraceEvent,
  throwIfAborted,
  uniqueSorted
} from "@agentarena/core";
import { runCommandSteps, runJudges } from "@agentarena/judges";
import { getDefaultWeights } from "@agentarena/report";
import { loadTaskPack } from "@agentarena/taskpacks";
import { JsonlTraceRecorder } from "@agentarena/trace";
import picomatch from "picomatch";

export interface BenchmarkOptions {
  repoPath: string;
  taskPath: string;
  agentIds: string[];
  agents?: AgentSelection[];
  runId?: string;
  outputPath?: string;
  probeAuth?: boolean;
  maxConcurrency?: number;
  updateSnapshots?: boolean;
  cleanupWorkspaces?: boolean;
  builtinReposRoot?: string;
  cancellation?: BenchmarkCancellation;
  onProgress?: (event: BenchmarkProgressEvent) => void | Promise<void>;
  // Scoring options
  scoreMode?: string;
  tokenBudget?: number;
  categories?: string[];
}

export interface BenchmarkProgressEvent {
  phase:
    | "starting"
    | "preflight"
    | "agent-start"
    | "agent-finish"
    | "report"
    | "complete";
  message: string;
  agentId?: string;
  variantId?: string;
  displayLabel?: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_AGENT_CONCURRENCY = 1;
const WORKSPACE_CLEANUP_MAX_RETRIES = 3;
const WORKSPACE_CLEANUP_RETRY_DELAY_MS = 1000;
const DEFAULT_AGENT_EXECUTE_TIMEOUT_MS = 30 * 60 * 1_000; // 30 minutes hard cap
const AGENT_EXECUTE_TIMEOUT_GRACE_MS = 5_000;

interface WorkspaceCleanupResult {
  success: boolean;
  path: string;
  error?: string;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function formatErrorDetails(error: unknown): { message: string; stack?: string; code?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      code: (error as NodeJS.ErrnoException).code
    };
  }
  return { message: String(error) };
}

function resolvePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function agentConcurrency(options: BenchmarkOptions): number {
  return options.maxConcurrency ?? resolvePositiveInt(process.env.AGENTARENA_MAX_CONCURRENCY, DEFAULT_AGENT_CONCURRENCY);
}

function agentExecuteTimeoutMs(): number {
  return resolvePositiveInt(
    process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS,
    DEFAULT_AGENT_EXECUTE_TIMEOUT_MS
  );
}

interface MapWithConcurrencyResult<R> {
  results: R[];
  aborted: boolean;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
  options: { signal?: AbortSignal } = {}
): Promise<MapWithConcurrencyResult<R>> {
  if (items.length === 0) {
    return { results: [], aborted: false };
  }

  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R | undefined>(items.length);
  const errors = new Array<Error | unknown | undefined>(items.length);
  let nextIndex = 0;
  let aborted = false;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      if (options.signal?.aborted) {
        aborted = true;
        return;
      }

      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      } catch (error) {
        if (isAbortError(error)) {
          aborted = true;
          return;
        }
        // Isolate errors: record the failure but don't crash other workers
        errors[currentIndex] = error;
        console.error(`mapWithConcurrency: item[${currentIndex}] failed: ${formatErrorMessage(error)}`);
      }
    }
  }

  const workers = Array.from({ length: safeLimit }, () => worker());
  await Promise.all(workers);

  return {
    results: results.filter((value): value is R => value !== undefined),
    aborted
  };
}

function buildChangedFiles(diff: DiffSummary, hints: string[]): string[] {
  return uniqueSorted([...diff.added, ...diff.changed, ...diff.removed, ...hints]);
}

function mergeResolvedRuntime(
  primary?: AgentResolvedRuntime,
  fallback?: AgentResolvedRuntime
): AgentResolvedRuntime | undefined {
  if (!primary && !fallback) {
    return undefined;
  }

  const merged = {
    ...(fallback ?? {}),
    ...(primary ?? {}),
    notes: [...(fallback?.notes ?? []), ...(primary?.notes ?? [])].filter(Boolean)
  };

  return {
    ...merged,
    source: merged.source ?? "unknown",
    verification: merged.verification ?? "unknown"
  };
}

function buildDiffPrecision(
  expectedChangedPaths: string[] | undefined,
  changedFiles: string[]
): DiffPrecisionSummary | undefined {
  if (!expectedChangedPaths || expectedChangedPaths.length === 0) {
    return undefined;
  }

  const matchers = expectedChangedPaths.map((pattern) => picomatch(pattern, { dot: true }));
  const matchedFiles = changedFiles.filter((filePath) => matchers.some((isMatch) => isMatch(filePath)));
  const unexpectedFiles = changedFiles.filter((filePath) => !matchers.some((isMatch) => isMatch(filePath)));

  return {
    score: changedFiles.length > 0 ? matchedFiles.length / changedFiles.length : 0,
    expectedScopeCount: expectedChangedPaths.length,
    totalChangedFiles: changedFiles.length,
    matchedFiles: uniqueSorted(matchedFiles),
    unexpectedFiles: uniqueSorted(unexpectedFiles)
  };
}

function summarizeCommandStepFailure(stage: "setup" | "teardown", result: CommandStepResult): string {
  return `${stage} command "${result.label}" failed with exit code ${result.exitCode}.`;
}

function wrapWithTimeout<T>(
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

function createCancellationSummary(stage: string): string {
  return `Benchmark cancelled during ${stage}.`;
}

function createCancelledRunResult(
  preflight: AdapterPreflightResult,
  tracePath: string,
  workspacePath: string,
  summary: string,
  setupResults: CommandStepResult[] = [],
  judgeResults: Awaited<ReturnType<typeof runJudges>> = [],
  teardownResults: CommandStepResult[] = [],
  diff: DiffSummary = { added: [], changed: [], removed: [] },
  diffPrecision?: DiffPrecisionSummary
): AgentRunResult {
  return {
    agentId: preflight.agentId,
    baseAgentId: preflight.baseAgentId,
    variantId: preflight.variantId,
    displayLabel: preflight.displayLabel,
    requestedConfig: preflight.requestedConfig,
    resolvedRuntime: preflight.resolvedRuntime,
    agentTitle: preflight.agentTitle,
    adapterKind: preflight.adapterKind,
    preflight,
    status: "cancelled",
    summary,
    durationMs: 0,
    tokenUsage: 0,
    estimatedCostUsd: 0,
    costKnown: false,
    changedFiles: uniqueSorted([...diff.added, ...diff.changed, ...diff.removed]),
    changedFilesHint: [],
    setupResults,
    judgeResults,
    teardownResults,
    tracePath,
    workspacePath,
    diff,
    diffPrecision
  };
}

function normalizeSelections(options: BenchmarkOptions): AgentSelection[] {
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

function createSkippedRunResult(
  preflight: AdapterPreflightResult,
  tracePath: string,
  workspacePath: string
): AgentRunResult {
  return {
    agentId: preflight.agentId,
    baseAgentId: preflight.baseAgentId,
    variantId: preflight.variantId,
    displayLabel: preflight.displayLabel,
    requestedConfig: preflight.requestedConfig,
    resolvedRuntime: preflight.resolvedRuntime,
    agentTitle: preflight.agentTitle,
    adapterKind: preflight.adapterKind,
    preflight,
    status: "failed",
    summary: preflight.summary,
    durationMs: 0,
    tokenUsage: 0,
    estimatedCostUsd: 0,
    costKnown: false,
    changedFiles: [],
    changedFilesHint: [],
    setupResults: [],
    judgeResults: [],
    teardownResults: [],
    tracePath,
    workspacePath,
    diff: {
      added: [],
      changed: [],
      removed: []
    }
  };
}

async function cleanupWorkspace(workspacePath: string, retries = WORKSPACE_CLEANUP_MAX_RETRIES): Promise<WorkspaceCleanupResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
      return { success: true, path: workspacePath };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, WORKSPACE_CLEANUP_RETRY_DELAY_MS));
      }
    }
  }
  const errorDetails = formatErrorDetails(lastError);
  return {
    success: false,
    path: workspacePath,
    error: `Failed after ${retries} attempts: ${errorDetails.message}`
  };
}

interface AgentRunContext {
  task: Awaited<ReturnType<typeof loadTaskPack>>;
  adapter: ReturnType<typeof getAdapter>;
  agentOutputPath: string;
  workspacePath: string;
  tracePath: string;
  traceRecorder: JsonlTraceRecorder;
  executionEnvironment: ReturnType<typeof buildExecutionEnvironment>;
  cancellation: Pick<BenchmarkOptions, "cancellation">["cancellation"];
  throwIfCancelled: (stage: string) => void;
}

async function createAgentRunContext(
  outputPath: string,
  workspaceRootPath: string,
  taskPath: string,
  preflight: AdapterPreflightResult,
  options: Pick<BenchmarkOptions, "updateSnapshots" | "cancellation">
): Promise<AgentRunContext> {
  const task = await loadTaskPack(taskPath);
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
    throwIfCancelled
  };
}

async function setupWorkspaceAndPrechecks(
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

async function runSetupCommands(
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
          removed: []
        }
      }
    };
  }

  return { setupResults, earlyResult: undefined };
}

async function createBeforeSnapshot(
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

async function executeAgent(
  preflight: AdapterPreflightResult,
  repoPath: string,
  context: AgentRunContext
): Promise<{ adapterResult: Awaited<ReturnType<typeof context.adapter.execute>> | undefined; adapterError: unknown; startedAt: number }> {
  const { adapter, workspacePath, executionEnvironment, traceRecorder, cancellation, task } = context;
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
      }
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

  return { adapterResult, adapterError, startedAt };
}

async function runJudgesAndAfterSnapshot(
  preflight: AdapterPreflightResult,
  adapterResult: Awaited<ReturnType<typeof context.adapter.execute>> | undefined,
  beforeSnapshot: Map<string, { relativePath: string; hash: string }>,
  options: Pick<BenchmarkOptions, "updateSnapshots">,
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

async function runTeardownCommands(
  preflight: AdapterPreflightResult,
  adapterError: unknown,
  judgeError: unknown,
  context: AgentRunContext
): Promise<{ teardownResults: CommandStepResult[]; teardownError: unknown }> {
  const { task, workspacePath, traceRecorder, cancellation } = context;

  let teardownResults: CommandStepResult[] = [];
  let teardownError: unknown;
  const teardownShouldIgnoreCancellation =
    cancellation?.signal?.aborted === true || isAbortError(adapterError) || isAbortError(judgeError);

  try {
    teardownResults = await runCommandSteps(
      task.teardownCommands,
      workspacePath,
      task.envAllowList,
      teardownShouldIgnoreCancellation ? undefined : cancellation?.signal
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

async function recordFinalEvents(
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

function buildFinalResult(
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
  diffPrecision: DiffPrecisionSummary | undefined,
  cancelled: boolean,
  success: boolean,
  context: AgentRunContext
): AgentRunResult {
  const { adapter, workspacePath, tracePath, task } = context;
  const durationMs = Date.now() - startedAt;

  if (cancelled) {
    return {
      ...createCancelledRunResult(
        preflight,
        tracePath,
        workspacePath,
        createCancellationSummary("agent execution"),
        setupResults,
        judgeResults,
        teardownResults,
        diff,
        diffPrecision
      ),
      durationMs,
      changedFiles,
      changedFilesHint: adapterResult?.changedFilesHint ?? []
    };
  }

  if (adapterError) {
    const errorMessage = formatErrorMessage(adapterError);
    return {
      agentId: preflight.agentId,
      baseAgentId: preflight.baseAgentId,
      variantId: preflight.variantId,
      displayLabel: preflight.displayLabel,
      requestedConfig: preflight.requestedConfig,
      resolvedRuntime: preflight.resolvedRuntime,
      agentTitle: adapter.title,
      adapterKind: adapter.kind,
      preflight,
      status: "failed",
      summary: `${adapter.title} crashed: ${errorMessage}`,
      durationMs,
      tokenUsage: 0,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFiles,
      changedFilesHint: [],
      setupResults,
      judgeResults: [],
      teardownResults: [],
      tracePath,
      workspacePath,
      diff,
      diffPrecision
    };
  }

  if (!adapterResult) {
    return {
      agentId: preflight.agentId,
      baseAgentId: preflight.baseAgentId,
      variantId: preflight.variantId,
      displayLabel: preflight.displayLabel,
      requestedConfig: preflight.requestedConfig,
      resolvedRuntime: preflight.resolvedRuntime,
      agentTitle: adapter.title,
      adapterKind: adapter.kind,
      preflight,
      status: "failed",
      summary: `${adapter.title} did not return a result.`,
      durationMs,
      tokenUsage: 0,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFiles,
      changedFilesHint: [],
      setupResults,
      judgeResults: [],
      teardownResults: [],
      tracePath,
      workspacePath,
      diff,
      diffPrecision
    };
  }

  // Extract token usage information
  const tokenUsage = adapterResult.tokenUsage;
  const tokenBudget = task.metadata?.tokenBudget;
  const tokenUsageBreakdown = adapterResult.tokenUsageBreakdown;
  const tokenEfficiencyScore =
    tokenUsage && tokenBudget ? Math.min(1, tokenBudget / tokenUsage) : undefined;

  // Extract patch validation result from judge results
  const patchValidationJudgeResult = judgeResults.find(
    (result) => result.type === "patch-validation"
  );
  // TODO: Parse detailed test results from judge stdout when output format is standardized.
  // Currently the judge outputs structured test details in stdout, but the runner only
  // captures the boolean success flag. Enhance this when a formal result extraction
  // mechanism is added to the patch-validation judge.
  const patchValidationResult = patchValidationJudgeResult
    ? {
        resolved: patchValidationJudgeResult.success,
        failToPassResults: [],  // TODO: Parse from stdout when available
        passToPassResults: []   // TODO: Parse from stdout when available
      }
    : undefined;

  // Calculate resolution rate
  const resolutionRate = patchValidationResult?.resolved !== undefined
    ? (patchValidationResult.resolved ? 1 : 0)
    : undefined;

  // Extract task metadata
  const taskCategory = task.metadata?.taskCategories?.[0];
  const contaminationChecked = task.metadata?.antiContamination !== undefined;
  const difficultyGeneration = task.metadata?.difficultyEvolution?.generation;

  return {
    agentId: preflight.agentId,
    baseAgentId: preflight.baseAgentId,
    variantId: preflight.variantId,
    displayLabel: preflight.displayLabel,
    requestedConfig: preflight.requestedConfig,
    resolvedRuntime: mergeResolvedRuntime(adapterResult.resolvedRuntime, preflight.resolvedRuntime),
    agentTitle: adapter.title,
    adapterKind: adapter.kind,
    preflight,
    status: success ? "success" : "failed",
    summary: adapterResult.summary,
    durationMs,
    tokenUsage: adapterResult.tokenUsage,
    estimatedCostUsd: adapterResult.estimatedCostUsd,
    costKnown: adapterResult.costKnown,
    changedFiles,
    changedFilesHint: adapterResult.changedFilesHint,
    setupResults,
    judgeResults,
    teardownResults,
    tracePath,
    workspacePath,
    diff,
    diffPrecision,
    // Token efficiency metrics (CursorBench)
    tokenUsageBreakdown,
    tokenEfficiencyScore,
    // Patch validation results (SWE-Bench)
    patchValidationResult,
    resolutionRate,
    // Task metadata extensions (LiveBench)
    taskCategory,
    contaminationChecked,
    difficultyGeneration
  };
}

async function runAgent(
  repoPath: string,
  outputPath: string,
  workspaceRootPath: string,
  taskPath: string,
  preflight: AdapterPreflightResult,
  options: Pick<BenchmarkOptions, "updateSnapshots" | "cancellation">
): Promise<AgentRunResult> {
  const context = await createAgentRunContext(outputPath, workspaceRootPath, taskPath, preflight, options);

  // Step 1: Setup workspace and prechecks
  const earlyResult1 = await setupWorkspaceAndPrechecks(repoPath, preflight, context);
  if (earlyResult1) {
    return earlyResult1;
  }

  // Step 2: Run setup commands
  const { setupResults, earlyResult: earlyResult2 } = await runSetupCommands(preflight, context);
  if (earlyResult2) {
    return earlyResult2;
  }

  // Step 3: Create before snapshot
  const beforeSnapshot = await createBeforeSnapshot(preflight, context);

  // Step 4: Execute agent
  const { adapterResult, adapterError, startedAt } = await executeAgent(preflight, repoPath, context);

  // Step 5: Run judges and create after snapshot
  const { judgeResults, judgeError, diff, changedFiles, diffPrecision } = await runJudgesAndAfterSnapshot(
    preflight,
    adapterResult,
    beforeSnapshot,
    options,
    context
  );

  // Step 6: Run teardown commands
  const { teardownResults, teardownError } = await runTeardownCommands(preflight, adapterError, judgeError, context);

  // Determine final status
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

  // Record final events
  await recordFinalEvents(preflight, judgeResults, judgeError, teardownResults, teardownError, success, context);

  // Step 7: Build and return final result
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
    diffPrecision,
    cancelled,
    success,
    context
  );
}

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkRun> {
  const cancellation = options.cancellation;
  const safeProgress = async (event: BenchmarkProgressEvent): Promise<void> => {
    try {
      await options.onProgress?.(event);
    } catch {
      // Ignore progress callback errors
    }
  };

  const userRepoPath = path.resolve(options.repoPath);
  const task = await loadTaskPack(options.taskPath);
  const builtinReposRoot = options.builtinReposRoot ?? path.join(path.dirname(options.taskPath), "..", "repos");
  const repoResolution = resolveRepoSource(task.repoSource, userRepoPath, builtinReposRoot);
  const repoPath = path.resolve(repoResolution.repoPath);

  if (repoResolution.kind === "builtin") {
    try {
      const stat = await fs.stat(repoPath);
      if (!stat.isDirectory()) {
        throw new Error(`Builtin repo path is not a directory: "${repoPath}"`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Builtin repo not found: "${repoPath}". ` +
          `The task pack requires repoSource "${task.repoSource}" but the directory does not exist.`
        );
      }
      throw error;
    }
  }

  const runId = options.runId ?? createRunId();
  const outputRootPath = options.outputPath
    ? path.resolve(options.outputPath)
    : path.join(userRepoPath, ".agentarena", "runs");
  const outputPath = path.join(outputRootPath, runId);
  const workspaceRootPath = await fs.mkdtemp(
    path.join(tmpdir(), `agentarena-workspaces-${runId.replace(/[^a-zA-Z0-9_-]+/g, "-")}-`)
  );
  const selections = normalizeSelections(options);
  const workspacePaths = new Set<string>();

  throwIfAborted(cancellation?.signal, createCancellationSummary("startup"));

  await ensureDirectory(outputRootPath);
  await ensureDirectory(outputPath);
  await safeProgress({
    phase: "starting",
    message: `Created run ${runId}.`,
    metadata: {
      runId,
      outputPath
    }
  });

  await safeProgress({
    phase: "preflight",
    message: `Running preflight for ${selections.length} agent selection(s).`,
    metadata: {
      count: selections.length
    }
  });

  let preflights: AdapterPreflightResult[];
  try {
    throwIfAborted(cancellation?.signal, createCancellationSummary("preflight"));
    preflights = await preflightAdapters(selections, { probeAuth: options.probeAuth });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const errorDetails = formatErrorDetails(error);
    throw new Error(`Preflight failed: ${errorDetails.message}`);
  }

  await safeProgress({
    phase: "preflight",
    message: `Preflight finished. ${preflights.filter((value) => value.status === "ready").length}/${preflights.length} ready.`,
    metadata: {
      total: preflights.length,
      ready: preflights.filter((value) => value.status === "ready").length
    }
  });

  const { results, aborted } = await mapWithConcurrency(
    preflights,
    agentConcurrency(options),
    async (preflight) => {
      throwIfAborted(cancellation?.signal, createCancellationSummary("agent scheduling"));
      const workspacePath = path.join(workspaceRootPath, preflight.variantId);
      workspacePaths.add(workspacePath);

      await safeProgress({
        phase: "agent-start",
        agentId: preflight.agentId,
        variantId: preflight.variantId,
        displayLabel: preflight.displayLabel,
        message: `Running ${preflight.displayLabel}.`,
        metadata: {
          status: preflight.status
        }
      });

      let result: AgentRunResult;
      try {
        result = await runAgent(repoPath, outputPath, workspaceRootPath, options.taskPath, preflight, {
          updateSnapshots: options.updateSnapshots,
          cancellation
        });
      } catch (error) {
        if (isAbortError(error)) {
          result = createCancelledRunResult(
            preflight,
            path.join(outputPath, "agents", preflight.variantId, "trace.jsonl"),
            workspacePath,
            formatErrorMessage(error)
          );
        } else {
          const errorDetails = formatErrorDetails(error);
          result = createSkippedRunResult(preflight, path.join(outputPath, "agents", preflight.variantId, "trace.jsonl"), workspacePath);
          result.summary = `Agent execution failed: ${errorDetails.message}`;
        }
      }

      await safeProgress({
        phase: "agent-finish",
        agentId: result.agentId,
        variantId: result.variantId,
        displayLabel: result.displayLabel,
        message: `${result.displayLabel} finished with status ${result.status}.`,
        metadata: {
          status: result.status,
          durationMs: result.durationMs,
          judgePasses: result.judgeResults.filter((value) => value.success).length,
          judgeTotal: result.judgeResults.length
        }
      });

      return result;
    }
  );

  // Handle preflights that didn't produce results (due to isolated errors in mapWithConcurrency)
  const processedVariantIds = new Set(results.map((r) => r.variantId));
  for (const preflight of preflights) {
    if (!processedVariantIds.has(preflight.variantId)) {
      const fallbackPath = path.join(outputPath, "agents", preflight.variantId, "trace.jsonl");
      const fallbackResult = createSkippedRunResult(preflight, fallbackPath, path.join(workspaceRootPath, preflight.variantId));
      fallbackResult.summary = "Agent was not executed due to a concurrent execution error.";
      results.push(fallbackResult);
    }
  }

  const cleanupResults: WorkspaceCleanupResult[] = [];
  if (options.cleanupWorkspaces) {
    for (const workspacePath of workspacePaths) {
      const cleanupResult = await cleanupWorkspace(workspacePath);
      cleanupResults.push(cleanupResult);
      if (!cleanupResult.success) {
        console.warn(`Warning: Failed to cleanup workspace ${workspacePath}: ${cleanupResult.error}`);
      }
    }
    // Clean up the parent workspace root directory
    const rootCleanupResult = await cleanupWorkspace(workspaceRootPath, 1);
    cleanupResults.push(rootCleanupResult);
    if (!rootCleanupResult.success) {
      console.warn(`Warning: Failed to cleanup workspace root ${workspaceRootPath}: ${rootCleanupResult.error}`);
    }
  }

  const completedWithCancellation = aborted || results.some((value) => value.status === "cancelled");

  await safeProgress({
    phase: "complete",
    message: `${completedWithCancellation ? "Benchmark cancelled" : "Benchmark run finished"} for ${results.length} result(s).`,
    metadata: {
      total: results.length,
      success: results.filter((value) => value.status === "success").length,
      cancelled: results.filter((value) => value.status === "cancelled").length,
      cleanupFailures: cleanupResults.filter((r) => !r.success).length
    }
  });

  return {
    runId,
    createdAt: new Date().toISOString(),
    repoPath,
    outputPath,
    scoreMode: options.scoreMode ?? "practical",
    scoreWeights: getDefaultWeights(options.scoreMode ?? "practical"),
    task,
    preflights,
    results
  };
}
