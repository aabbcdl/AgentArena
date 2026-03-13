import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAdapter, preflightAdapters } from "@repoarena/adapters";
import {
  AdapterPreflightResult,
  AgentRunResult,
  BenchmarkRun,
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
}

async function runCommand(label: string, command: string, cwd: string): Promise<JudgeResult> {
  const startedAt = Date.now();

  return await new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      resolve({
        label,
        command,
        exitCode,
        success: exitCode === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startedAt
      });
    });

    child.on("error", (error) => {
      resolve({
        label,
        command,
        exitCode: -1,
        success: false,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - startedAt
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
    task.successCommands.map((command) => runCommand(command.label, command.command, workspacePath))
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
}

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkRun> {
  const repoPath = path.resolve(options.repoPath);
  const task = await loadTaskPack(options.taskPath);
  const runId = createRunId();
  const outputPath = options.outputPath ?? path.join(repoPath, ".repoarena", "runs", runId);
  const workspaceRootPath = path.join(tmpdir(), "repoarena-workspaces", runId);

  await ensureDirectory(outputPath);
  await ensureDirectory(workspaceRootPath);

  const preflights = await preflightAdapters(options.agentIds, { probeAuth: false });
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
