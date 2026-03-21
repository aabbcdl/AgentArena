import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAdapter, preflightAdapters } from "@repoarena/adapters";
import {
  type AdapterPreflightResult,
  type AgentRunResult,
  type AgentSelection,
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
  normalizePath,
  resolveRepoSource,
  snapshotDirectory,
  uniqueSorted
} from "@repoarena/core";
import { runCommandSteps, runJudges } from "@repoarena/judges";
import { loadTaskPack } from "@repoarena/taskpacks";
import { JsonlTraceRecorder } from "@repoarena/trace";

export interface BenchmarkOptions {
  repoPath: string;
  taskPath: string;
  agentIds: string[];
  agents?: AgentSelection[];
  outputPath?: string;
  probeAuth?: boolean;
  maxConcurrency?: number;
  updateSnapshots?: boolean;
  cleanupWorkspaces?: boolean;
  builtinReposRoot?: string;
  onProgress?: (event: BenchmarkProgressEvent) => void | Promise<void>;
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
  return options.maxConcurrency ?? resolvePositiveInt(process.env.REPOARENA_MAX_CONCURRENCY, DEFAULT_AGENT_CONCURRENCY);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const errors: Array<{ index: number; error: unknown }> = [];

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      } catch (error) {
        errors.push({ index: currentIndex, error });
        // Re-throw to maintain original behavior
        throw error;
      }
    }
  }

  const workers = Array.from({ length: safeLimit }, async () => {
    await worker();
  });

  await Promise.all(workers);

  return results;
}

function buildChangedFiles(diff: DiffSummary, hints: string[]): string[] {
  return uniqueSorted([...diff.added, ...diff.changed, ...diff.removed, ...hints]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globPatternToRegExp(pattern: string): RegExp {
  const normalizedPattern = normalizePath(pattern);
  let regex = "^";

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    const next = normalizedPattern[index + 1];

    if (char === "*") {
      if (next === "*") {
        const afterNext = normalizedPattern[index + 2];
        if (afterNext === "/") {
          regex += "(?:.*/)?";
          index += 2;
        } else {
          regex += ".*";
          index += 1;
        }
      } else {
        regex += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    if (char === "{") {
      const closingIndex = normalizedPattern.indexOf("}", index);
      if (closingIndex > index) {
        const segment = normalizedPattern.slice(index + 1, closingIndex);
        regex += `(?:${segment.split(",").map(escapeRegExp).join("|")})`;
        index = closingIndex;
        continue;
      }
    }

    regex += escapeRegExp(char);
  }

  return new RegExp(`${regex}$`);
}

function buildDiffPrecision(
  expectedChangedPaths: string[] | undefined,
  changedFiles: string[]
): DiffPrecisionSummary | undefined {
  if (!expectedChangedPaths || expectedChangedPaths.length === 0) {
    return undefined;
  }

  const matchers = expectedChangedPaths.map((pattern) => ({
    pattern,
    matches: globPatternToRegExp(pattern)
  }));
  const matchedFiles = changedFiles.filter((filePath) => matchers.some((entry) => entry.matches.test(filePath)));
  const unexpectedFiles = changedFiles.filter((filePath) => !matchers.some((entry) => entry.matches.test(filePath)));

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
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
      return { success: true, path: workspacePath };
    } catch (error) {
      const errorDetails = formatErrorDetails(error);
      if (attempt < retries) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, WORKSPACE_CLEANUP_RETRY_DELAY_MS));
        continue;
      }
      return {
        success: false,
        path: workspacePath,
        error: `Failed after ${retries} attempts: ${errorDetails.message}`
      };
    }
  }
  return { success: false, path: workspacePath, error: "Unexpected cleanup failure" };
}

async function runAgent(
  repoPath: string,
  outputPath: string,
  workspaceRootPath: string,
  taskPath: string,
  preflight: AdapterPreflightResult,
  options: Pick<BenchmarkOptions, "updateSnapshots">
): Promise<AgentRunResult> {
  const task = await loadTaskPack(taskPath);
  const adapter = getAdapter(preflight.baseAgentId);
  const agentOutputPath = path.join(outputPath, "agents", preflight.variantId);
  const workspacePath = path.join(workspaceRootPath, preflight.variantId);
  const tracePath = path.join(agentOutputPath, "trace.jsonl");
  const traceRecorder = new JsonlTraceRecorder(tracePath);
  const executionEnvironment = buildExecutionEnvironment(task.envAllowList);

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
    return createSkippedRunResult(preflight, tracePath, workspacePath);
  }

  await ensureDirectory(agentOutputPath);
  
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
      ...createSkippedRunResult(preflight, tracePath, workspacePath),
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

  let setupResults: CommandStepResult[] = [];
  try {
    setupResults = await runCommandSteps(task.setupCommands, workspacePath, task.envAllowList);
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "setup.error",
      message: "Setup commands execution failed.",
      metadata: errorDetails
    });
    return {
      ...createSkippedRunResult(preflight, tracePath, workspacePath),
      summary: `Setup commands failed: ${errorDetails.message}`,
      setupResults: []
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
      summary: summarizeCommandStepFailure(
        "setup",
        setupResults.find((value) => !value.success) ?? setupResults[0]
      ),
      durationMs: 0,
      tokenUsage: 0,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFiles: [],
      changedFilesHint: [],
      setupResults,
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

  let beforeSnapshot: Map<string, { relativePath: string; hash: string }>;
  try {
    beforeSnapshot = await snapshotDirectory(workspacePath);
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "snapshot.before_failed",
      message: "Failed to create before snapshot.",
      metadata: errorDetails
    });
    beforeSnapshot = new Map();
  }

  const startedAt = Date.now();
  let adapterResult: Awaited<ReturnType<typeof adapter.execute>> | undefined;
  let adapterError: unknown;

  try {
    adapterResult = await adapter.execute({
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
      trace: async (event) => {
        await traceRecorder.record({
          ...event,
          agentId: preflight.agentId,
          timestamp: new Date().toISOString()
        });
      }
    });
  } catch (error) {
    adapterError = error;
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "adapter.error",
      message: `${adapter.title} execution failed.`,
      metadata: errorDetails
    });
  }

  let judgeResults: Awaited<ReturnType<typeof runJudges>> = [];
  let judgeError: unknown;

  if (adapterResult && adapterResult.status === "success") {
    try {
      judgeResults = await runJudges(task.judges, workspacePath, task.envAllowList, {
        updateSnapshots: options.updateSnapshots
      });
    } catch (error) {
      judgeError = error;
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

  let afterSnapshot: Map<string, { relativePath: string; hash: string }>;
  try {
    afterSnapshot = await snapshotDirectory(workspacePath);
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "snapshot.after_failed",
      message: "Failed to create after snapshot.",
      metadata: errorDetails
    });
    afterSnapshot = new Map();
  }

  const diff = diffSnapshots(beforeSnapshot, afterSnapshot);
  const changedFiles = buildChangedFiles(diff, adapterResult?.changedFilesHint ?? []);
  const diffPrecision = buildDiffPrecision(task.expectedChangedPaths, changedFiles);

  let teardownResults: CommandStepResult[] = [];
  let teardownError: unknown;

  try {
    teardownResults = await runCommandSteps(
      task.teardownCommands,
      workspacePath,
      task.envAllowList
    );
  } catch (error) {
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

  const durationMs = Date.now() - startedAt;
  const success =
    adapterResult?.status === "success" &&
    !adapterError &&
    !judgeError &&
    judgeResults.every((value) => value.success) &&
    !teardownError &&
    teardownResults.every((value) => value.success);

  await traceRecorder.record({
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

  await traceRecorder.record({
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

  return {
    agentId: preflight.agentId,
    baseAgentId: preflight.baseAgentId,
    variantId: preflight.variantId,
    displayLabel: preflight.displayLabel,
    requestedConfig: preflight.requestedConfig,
    resolvedRuntime: adapterResult.resolvedRuntime ?? preflight.resolvedRuntime,
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
    diffPrecision
  };
}

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkRun> {
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

  const runId = createRunId();
  const outputPath = options.outputPath ?? path.join(userRepoPath, ".repoarena", "runs", runId);
  const workspaceRootPath = path.join(tmpdir(), "repoarena-workspaces", runId);
  const selections = normalizeSelections(options);
  const workspacePaths: string[] = [];

  await ensureDirectory(outputPath);
  await ensureDirectory(workspaceRootPath);
  await options.onProgress?.({
    phase: "starting",
    message: `Created run ${runId}.`,
    metadata: {
      runId,
      outputPath
    }
  });

  await options.onProgress?.({
    phase: "preflight",
    message: `Running preflight for ${selections.length} agent selection(s).`,
    metadata: {
      count: selections.length
    }
  });

  let preflights: AdapterPreflightResult[];
  try {
    preflights = await preflightAdapters(selections, { probeAuth: options.probeAuth });
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    throw new Error(`Preflight failed: ${errorDetails.message}`);
  }

  await options.onProgress?.({
    phase: "preflight",
    message: `Preflight finished. ${preflights.filter((value) => value.status === "ready").length}/${preflights.length} ready.`,
    metadata: {
      total: preflights.length,
      ready: preflights.filter((value) => value.status === "ready").length
    }
  });

  const results = await mapWithConcurrency(
    preflights,
    agentConcurrency(options),
    async (preflight) => {
      const workspacePath = path.join(workspaceRootPath, preflight.variantId);
      workspacePaths.push(workspacePath);

      await options.onProgress?.({
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
          updateSnapshots: options.updateSnapshots
        });
      } catch (error) {
        const errorDetails = formatErrorDetails(error);
        result = createSkippedRunResult(preflight, path.join(outputPath, "agents", preflight.variantId, "trace.jsonl"), workspacePath);
        result.summary = `Agent execution failed: ${errorDetails.message}`;
      }

      await options.onProgress?.({
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

  const cleanupResults: WorkspaceCleanupResult[] = [];
  if (options.cleanupWorkspaces) {
    for (const workspacePath of workspacePaths) {
      const cleanupResult = await cleanupWorkspace(workspacePath);
      cleanupResults.push(cleanupResult);
      if (!cleanupResult.success) {
        console.warn(`Warning: Failed to cleanup workspace ${workspacePath}: ${cleanupResult.error}`);
      }
    }
  }

  await options.onProgress?.({
    phase: "complete",
    message: `Benchmark run finished for ${results.length} result(s).`,
    metadata: {
      total: results.length,
      success: results.filter((value) => value.status === "success").length,
      cleanupFailures: cleanupResults.filter((r) => !r.success).length
    }
  });

  return {
    runId,
    createdAt: new Date().toISOString(),
    repoPath,
    outputPath,
    task,
    preflights,
    results
  };
}
