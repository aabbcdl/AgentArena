import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAdapter, preflightAdapters } from "@repoarena/adapters";
import {
  AdapterPreflightResult,
  AgentRunResult,
  BenchmarkRun,
  CommandJudge,
  DiffSummary,
  JudgeResult,
  copyRepository,
  createRunId,
  diffSnapshots,
  ensureDirectory,
  snapshotDirectory,
  uniqueSorted
} from "@repoarena/core";
import { loadTaskPack } from "@repoarena/taskpacks";
import { JsonlTraceRecorder } from "@repoarena/trace";

export interface BenchmarkOptions {
  repoPath: string;
  taskPath: string;
  agentIds: string[];
  outputPath?: string;
  probeAuth?: boolean;
}

const DEFAULT_JUDGE_TIMEOUT_MS = 5 * 60 * 1_000;

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function judgeTimeoutMs(): number {
  return resolveTimeoutMs(process.env.REPOARENA_JUDGE_TIMEOUT_MS, DEFAULT_JUDGE_TIMEOUT_MS);
}

function resolveJudgeWorkingDirectory(workspacePath: string, judge: CommandJudge): string {
  const candidatePath = judge.cwd ? path.resolve(workspacePath, judge.cwd) : workspacePath;
  const relativePath = path.relative(workspacePath, candidatePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Judge "${judge.id}" cwd must stay inside the workspace.`);
  }

  return candidatePath;
}

async function runCommand(judge: CommandJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const timeoutMs = judge.timeoutMs ?? judgeTimeoutMs();
  const cwd = resolveJudgeWorkingDirectory(workspacePath, judge);

  return await new Promise((resolve) => {
    const child = spawn(judge.command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      resolve({
        judgeId: judge.id,
        label: judge.label,
        type: "command",
        command: judge.command,
        exitCode,
        success: exitCode === 0 && !timedOut,
        stdout: stdout.trim(),
        stderr: `${stderr}${timedOut ? `\nJudge timed out after ${timeoutMs}ms.` : ""}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      resolve({
        judgeId: judge.id,
        label: judge.label,
        type: "command",
        command: judge.command,
        exitCode: -1,
        success: false,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });
  });
}

function buildChangedFiles(diff: DiffSummary, hints: string[]): string[] {
  return uniqueSorted([...diff.added, ...diff.changed, ...diff.removed, ...hints]);
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
    judgeResults: [],
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

  if (preflight.status === "missing" || preflight.status === "blocked") {
    return createSkippedRunResult(preflight, tracePath, workspacePath);
  }

  await ensureDirectory(agentOutputPath);
  await copyRepository(repoPath, workspacePath);

  const traceRecorder = new JsonlTraceRecorder(tracePath);
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

  const beforeSnapshot = await snapshotDirectory(workspacePath);
  const startedAt = Date.now();

  try {
    const adapterResult = await adapter.execute({
      agentId: preflight.agentId,
      repoPath,
      workspacePath,
      task,
      trace: async (event) => {
        await traceRecorder.record({
          ...event,
          agentId: preflight.agentId,
          timestamp: new Date().toISOString()
        });
      }
    });

    const judgeResults = await Promise.all(
      task.judges.map((judge) => runCommand(judge, workspacePath))
    );

    const afterSnapshot = await snapshotDirectory(workspacePath);
    const diff = diffSnapshots(beforeSnapshot, afterSnapshot);
    const durationMs = Date.now() - startedAt;
    const success = adapterResult.status === "success" && judgeResults.every((value) => value.success);

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
      judgeResults,
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
      judgeResults: [],
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
  const results: AgentRunResult[] = [];
  for (const preflight of preflights) {
    results.push(await runAgent(repoPath, outputPath, workspaceRootPath, options.taskPath, preflight));
  }

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
