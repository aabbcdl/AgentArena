import { tmpdir } from "node:os";
import path from "node:path";
import { getAdapter, preflightAdapters } from "@repoarena/adapters";
import {
  AgentSelection,
  AdapterPreflightResult,
  AgentRunResult,
  BenchmarkRun,
  CommandStepResult,
  DiffSummary,
  buildExecutionEnvironment,
  copyRepository,
  createAgentSelection,
  createRunId,
  diffSnapshots,
  ensureDirectory,
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const safeLimit = Math.max(1, limit);
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
      await worker();
    })
  );

  return results;
}

function buildChangedFiles(diff: DiffSummary, hints: string[]): string[] {
  return uniqueSorted([...diff.added, ...diff.changed, ...diff.removed, ...hints]);
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
  await copyRepository(repoPath, workspacePath);

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

  const setupResults = await runCommandSteps(task.setupCommands, workspacePath, task.envAllowList);
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

  const beforeSnapshot = await snapshotDirectory(workspacePath);
  const startedAt = Date.now();

  try {
    const adapterResult = await adapter.execute({
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

    const judgeResults = await runJudges(task.judges, workspacePath, task.envAllowList, {
      updateSnapshots: options.updateSnapshots
    });

    const afterSnapshot = await snapshotDirectory(workspacePath);
    const diff = diffSnapshots(beforeSnapshot, afterSnapshot);
    const teardownResults = await runCommandSteps(
      task.teardownCommands,
      workspacePath,
      task.envAllowList
    );
    const durationMs = Date.now() - startedAt;
    const success =
      adapterResult.status === "success" &&
      judgeResults.every((value) => value.success) &&
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
        }))
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
        }))
      }
    });

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
      changedFiles: buildChangedFiles(diff, adapterResult.changedFilesHint),
      changedFilesHint: adapterResult.changedFilesHint,
      setupResults,
      judgeResults,
      teardownResults,
      tracePath,
      workspacePath,
      diff
    };
  } catch (error) {
    const errorMessage = formatErrorMessage(error);
    const durationMs = Date.now() - startedAt;
    let diff: DiffSummary = {
      added: [],
      changed: [],
      removed: []
    };

    try {
      const afterSnapshot = await snapshotDirectory(workspacePath);
      diff = diffSnapshots(beforeSnapshot, afterSnapshot);
    } catch (snapshotError) {
      await traceRecorder.record({
        agentId: preflight.agentId,
        timestamp: new Date().toISOString(),
        type: "agent.snapshot_failed",
        message: "Failed to snapshot workspace after adapter error.",
        metadata: {
          error: formatErrorMessage(snapshotError)
        }
      });
    }

    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "agent.crash",
      message: `${adapter.title} crashed during execution.`,
      metadata: {
        error: errorMessage
      }
    });

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
      changedFiles: buildChangedFiles(diff, []),
      changedFilesHint: [],
      setupResults,
      judgeResults: [],
      teardownResults: [],
      tracePath,
      workspacePath,
      diff
    };
  }
}

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkRun> {
  const repoPath = path.resolve(options.repoPath);
  const task = await loadTaskPack(options.taskPath);
  const runId = createRunId();
  const outputPath = options.outputPath ?? path.join(repoPath, ".repoarena", "runs", runId);
  const workspaceRootPath = path.join(tmpdir(), "repoarena-workspaces", runId);
  const selections = normalizeSelections(options);

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
  const preflights = await preflightAdapters(selections, { probeAuth: options.probeAuth });
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
      const result = await runAgent(repoPath, outputPath, workspaceRootPath, options.taskPath, preflight, {
        updateSnapshots: options.updateSnapshots
      });
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
  await options.onProgress?.({
    phase: "complete",
    message: `Benchmark run finished for ${results.length} result(s).`,
    metadata: {
      total: results.length,
      success: results.filter((value) => value.status === "success").length
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
