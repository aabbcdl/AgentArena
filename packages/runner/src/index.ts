import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { preflightAdapters } from "@agentarena/adapters";
import {
  type AgentRunResult,
  type AgentSelection,
  type BenchmarkCancellation,
  type BenchmarkRun,
  createRunId,
  ensureDirectory,
  getDefaultWeights,
  isAbortError,
  isInternalUrl,
  resolveRepoSource,
  throwIfAborted,
} from "@agentarena/core";
import { loadTaskPack } from "@agentarena/taskpacks";
import { normalizeSelections, runAgent } from "./agent-lifecycle.js";
import { agentConcurrency, mapWithConcurrency } from "./concurrency.js";
import {
  createBaseResult,
  createCancellationSummary,
  createCancelledRunResult,
  createSkippedRunResult,
} from "./result-builder.js";
import { cleanupWorkspace, formatErrorDetails, formatErrorMessage, type WorkspaceCleanupResult } from "./workspace.js";

export type { AgentRunContext, normalizeSelections, runAgent, wrapWithTimeout } from "./agent-lifecycle.js";
export type { agentConcurrency, agentExecuteTimeoutMs, MapWithConcurrencyResult, mapWithConcurrency, resolvePositiveInt } from "./concurrency.js";
export { DEFAULT_AGENT_CONCURRENCY } from "./concurrency.js";
export type { buildDiffPrecision, collectChangedFiles } from "./snapshot.js";
export type { cleanupWorkspace, debugLog, formatErrorDetails, formatErrorMessage, WorkspaceCleanupResult } from "./workspace.js";

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
  scoreMode?: string;
  tokenBudget?: number;
  categories?: string[];
  debug?: boolean;
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

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkRun> {
  const cancellation = options.cancellation;
  const safeProgress = async (event: BenchmarkProgressEvent): Promise<void> => {
    try {
      await options.onProgress?.(event);
    } catch (progressError) {
      console.warn(`[agentarena] onProgress callback threw for phase "${event.phase}": ${progressError instanceof Error ? progressError.message : String(progressError)}`);
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

  if (repoResolution.kind === "url") {
    try {
      const stat = await fs.stat(repoPath);
      if (!stat.isDirectory()) {
        throw new Error(`URL repo path is not a directory: "${repoPath}"`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const repoUrl = task.repoSource;
        if (typeof repoUrl !== "string" || !repoUrl.startsWith("http")) {
          throw new Error(`Invalid URL repoSource: "${repoUrl}"`);
        }
        if (isInternalUrl(repoUrl)) {
          throw new Error(`Cannot clone from internal/private URL: "${repoUrl}". Only public internet URLs are allowed.`);
        }
        const parentDir = path.dirname(repoPath);
        await fs.mkdir(parentDir, { recursive: true });
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        try {
          await execFileAsync("git", ["clone", repoUrl, repoPath], {
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024
          });
        } catch (cloneError) {
          throw new Error(
            `Failed to clone URL repoSource "${repoUrl}": ${cloneError instanceof Error ? cloneError.message : String(cloneError)}`
          );
        }
      } else {
        throw error;
      }
    }
  }

  if (repoResolution.kind === "user") {
    try {
      const stat = await fs.stat(repoPath);
      if (!stat.isDirectory()) {
        throw new Error(`User repo path is not a directory: "${repoPath}"`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`User repo not found: "${repoPath}". The specified repository path does not exist.`);
      }
      throw error;
    }
  }

  const runId = options.runId ?? createRunId();
  const outputRootPath = options.outputPath
    ? path.resolve(options.outputPath)
    : path.join(userRepoPath, ".agentarena", "runs");
  const outputPath = path.join(outputRootPath, runId);
  let workspaceRootPath: string;
  try {
    workspaceRootPath = await fs.mkdtemp(
      path.join(tmpdir(), `agentarena-workspaces-${runId.replace(/[^a-zA-Z0-9_-]+/g, "-")}-`)
    );
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    throw new Error(`Failed to create workspace directory in "${tmpdir()}": ${errorDetails.message}. Check available disk space and permissions.`);
  }
  const selections = normalizeSelections(options);
  const workspacePaths = new Set<string>();

  throwIfAborted(cancellation?.signal, createCancellationSummary("startup"));

  let completedNormally = false;
  try {
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

  let preflights: Awaited<ReturnType<typeof preflightAdapters>>;
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

  const { results: rawResults, aborted } = await mapWithConcurrency(
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
        result = await runAgent(repoPath, outputPath, workspaceRootPath, task, preflight, {
          updateSnapshots: options.updateSnapshots,
          cancellation,
          debug: options.debug
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

  const results: AgentRunResult[] = [];
  const processedVariantIds = new Set<string>();
  for (let i = 0; i < preflights.length; i++) {
    const raw = i < rawResults.length ? rawResults[i] : undefined;
    if (raw === undefined) {
      const preflight = preflights[i];
      const fallbackPath = path.join(outputPath, "agents", preflight.variantId, "trace.jsonl");
      results.push(createBaseResult({
        preflight,
        tracePath: fallbackPath,
        workspacePath: path.join(workspaceRootPath, preflight.variantId),
        status: "cancelled",
        summary: "Cancelled due to concurrent execution abort."
      }));
      processedVariantIds.add(preflight.variantId);
    } else if (raw instanceof Error) {
      const preflight = preflights[i];
      const fallbackPath = path.join(outputPath, "agents", preflight.variantId, "trace.jsonl");
      results.push(createBaseResult({
        preflight,
        tracePath: fallbackPath,
        workspacePath: path.join(workspaceRootPath, preflight.variantId),
        status: "failed",
        summary: `Agent execution error: ${raw.message}`
      }));
      processedVariantIds.add(preflight.variantId);
    } else {
      results.push(raw);
      processedVariantIds.add(raw.variantId);
    }
  }
  for (const preflight of preflights) {
    if (!processedVariantIds.has(preflight.variantId)) {
      const fallbackPath = path.join(outputPath, "agents", preflight.variantId, "trace.jsonl");
      results.push(createBaseResult({
        preflight,
        tracePath: fallbackPath,
        workspacePath: path.join(workspaceRootPath, preflight.variantId),
        status: "failed",
        summary: "Agent was not executed due to a concurrent execution error."
      }));
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

  completedNormally = true;
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
  } finally {
    if (!completedNormally && options.cleanupWorkspaces) {
      for (const workspacePath of workspacePaths) {
        await cleanupWorkspace(workspacePath).catch(() => {});
      }
      await cleanupWorkspace(workspaceRootPath, 1).catch(() => {});
    }
  }
}

