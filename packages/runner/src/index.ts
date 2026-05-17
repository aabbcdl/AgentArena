import { promises as fs } from "node:fs";
import path from "node:path";

import { preflightAdapters } from "@agentarena/adapters";
import {
  type AgentRunResult,
  type AgentSelection,
  type BenchmarkCancellation,
  type BenchmarkRun,
  getDefaultWeights,
  isAbortError,
  throwIfAborted,
} from "@agentarena/core";
import { normalizeSelections, runAgent } from "./agent-lifecycle.js";
import { agentConcurrency, mapWithConcurrency } from "./concurrency.js";
import { resolveAndValidateRepo } from "./repo-resolution.js";
import {
  createCancellationSummary,
  createCancelledRunResult,
  createSkippedRunResult,
} from "./result-builder.js";
import { collectResults } from "./result-collection.js";
import { cleanupWorkspace, formatErrorDetails, formatErrorMessage, type WorkspaceCleanupResult } from "./workspace.js";
import { prepareWorkspace } from "./workspace-prep.js";

export type { AgentRunContext, normalizeSelections, runAgent, wrapWithTimeout } from "./agent-lifecycle.js";
export type { agentConcurrency, agentExecuteTimeoutMs, MapWithConcurrencyResult, mapWithConcurrency, resolvePositiveInt } from "./concurrency.js";
export { DEFAULT_AGENT_CONCURRENCY } from "./concurrency.js";
export type { RepoResolution, RepoResolutionOptions } from "./repo-resolution.js";
export type { buildDiffPrecision, collectChangedFiles } from "./snapshot.js";
export type { cleanupWorkspace, debugLog, formatErrorDetails, formatErrorMessage, WorkspaceCleanupResult } from "./workspace.js";
export type { WorkspacePrep, WorkspacePrepOptions } from "./workspace-prep.js";

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

async function writeRunMarker(
  outputPath: string,
  state: "in-progress" | "complete" | "failed",
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await fs.writeFile(
      path.join(outputPath, "run-state.json"),
      JSON.stringify({ state, updatedAt: new Date().toISOString(), ...metadata }, null, 2),
      "utf8"
    );
  } catch (error) {
    console.warn(`[agentarena] Failed to write run marker for ${outputPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
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

  // Step 1: Resolve and validate the repository
  const { repoPath, task } = await resolveAndValidateRepo(options);

  // Step 2: Prepare workspace directories and temp paths
  const { runId, outputPath, workspaceRootPath } = await prepareWorkspace({
    runId: options.runId,
    outputPath: options.outputPath,
    repoPath: options.repoPath
  });

  await writeRunMarker(outputPath, "in-progress", { runId });

  const selections = normalizeSelections(options);
  const workspacePaths = new Set<string>();

  throwIfAborted(cancellation?.signal, createCancellationSummary("startup"));

  let completedNormally = false;
  try {
  await safeProgress({
    phase: "starting",
    message: `Created run ${runId}.`,
    metadata: { runId, outputPath }
  });

  // Step 3: Run preflight checks
  await safeProgress({
    phase: "preflight",
    message: `Running preflight for ${selections.length} agent selection(s).`,
    metadata: { count: selections.length }
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

  // Step 4: Execute agents concurrently
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
        metadata: { status: preflight.status }
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

  // Step 5: Collect results
  const results = collectResults(rawResults, preflights, outputPath, workspaceRootPath);

  // Step 6: Cleanup workspaces
  const cleanupResults: WorkspaceCleanupResult[] = [];
  if (options.cleanupWorkspaces) {
    const cleanupR = await Promise.all(
      [...workspacePaths].map((wp) => cleanupWorkspace(wp))
    );
    for (const result of cleanupR) {
      cleanupResults.push(result);
      if (!result.success) {
        console.warn(`Warning: Failed to cleanup workspace ${result.path}: ${result.error}`);
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
  await writeRunMarker(outputPath, completedWithCancellation ? "failed" : "complete", {
    runId,
    totalResults: results.length,
    successResults: results.filter((value) => value.status === "success").length,
    cancelledResults: results.filter((value) => value.status === "cancelled").length
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
  } finally {
    if (!completedNormally) {
      await writeRunMarker(outputPath, "failed", { runId });
      for (const workspacePath of workspacePaths) {
        await cleanupWorkspace(workspacePath).catch(() => {});
      }
      await cleanupWorkspace(workspaceRootPath, 1).catch(() => {});
    }
  }
}
