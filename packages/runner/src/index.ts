import { tmpdir } from "node:os";
import path from "node:path";
import { getAdapter, preflightAdapters } from "@repoarena/adapters";
import {
  AdapterPreflightResult,
  AgentRunResult,
  BenchmarkRun,
  CommandStepResult,
  DiffSummary,
  buildExecutionEnvironment,
  copyRepository,
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
  outputPath?: string;
  probeAuth?: boolean;
  maxConcurrency?: number;
}

const DEFAULT_AGENT_CONCURRENCY = 1;

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function agentConcurrency(options: BenchmarkOptions): number {
  return options.maxConcurrency ?? resolveTimeoutMs(process.env.REPOARENA_MAX_CONCURRENCY, DEFAULT_AGENT_CONCURRENCY);
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

function createSkippedRunResult(
  preflight: AdapterPreflightResult,
  tracePath: string,
  workspacePath: string
): AgentRunResult {
  return {
    agentId: preflight.agentId,
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
  preflight: AdapterPreflightResult
): Promise<AgentRunResult> {
  const task = await loadTaskPack(taskPath);
  const adapter = getAdapter(preflight.agentId);
  const agentOutputPath = path.join(outputPath, "agents", preflight.agentId);
  const workspacePath = path.join(workspaceRootPath, preflight.agentId);
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

  const setupResults = await runCommandSteps(task.setupCommands, workspacePath, executionEnvironment);
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

    const judgeResults = await runJudges(task.judges, workspacePath, executionEnvironment);

    const afterSnapshot = await snapshotDirectory(workspacePath);
    const diff = diffSnapshots(beforeSnapshot, afterSnapshot);
    const teardownResults = await runCommandSteps(
      task.teardownCommands,
      workspacePath,
      executionEnvironment
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

  await ensureDirectory(outputPath);
  await ensureDirectory(workspaceRootPath);

  const preflights = await preflightAdapters(options.agentIds, { probeAuth: options.probeAuth });
  const results = await mapWithConcurrency(
    preflights,
    agentConcurrency(options),
    async (preflight) => await runAgent(repoPath, outputPath, workspaceRootPath, options.taskPath, preflight)
  );

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
