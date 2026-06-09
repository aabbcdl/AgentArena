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
  logger,
  type ScoreMode,
  type TaskCompatibilityResult,
  throwIfAborted,
} from "@agentarena/core";
import { runAgent } from "./agent-lifecycle.js";
import { agentConcurrency, mapWithConcurrency } from "./concurrency.js";
import { normalizeSelections } from "./normalize-selections.js";
import { resolveAndValidateRepo } from "./repo-resolution.js";
import {
  createCancellationSummary,
  createCancelledRunResult,
  createSkippedRunResult,
} from "./result-builder.js";
import { collectResults } from "./result-collection.js";
import { checkTaskCompatibility } from "./task-compatibility.js";
import { cleanupWorkspace, formatErrorDetails, formatErrorMessage, type WorkspaceCleanupResult } from "./workspace.js";
import { prepareWorkspace } from "./workspace-prep.js";

export type { AgentRunContext } from "./agent-lifecycle.js";
export { runAgent } from "./agent-lifecycle.js";
export type { MapWithConcurrencyResult } from "./concurrency.js";
export { agentConcurrency, agentExecuteTimeoutMs, DEFAULT_AGENT_CONCURRENCY, mapWithConcurrency, resolvePositiveInt } from "./concurrency.js";
export { normalizeSelections } from "./normalize-selections.js";
export type { RepoResolution, RepoResolutionOptions } from "./repo-resolution.js";
export { buildDiffPrecision, collectChangedFiles } from "./snapshot.js";
export type { CompatibilityCheck, CompatibilityCheckResult } from "./task-compatibility.js";
export { checkTaskCompatibility } from "./task-compatibility.js";
export { wrapWithTimeout } from "./timeout-utils.js";
export type { WorkspaceCleanupResult } from "./workspace.js";
export { cleanupWorkspace, debugLog, formatErrorDetails, formatErrorMessage } from "./workspace.js";
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
  resumeFrom?: string;
  builtinReposRoot?: string;
  cancellation?: BenchmarkCancellation;
  onProgress?: (event: BenchmarkProgressEvent) => void | Promise<void>;
  scoreMode?: ScoreMode;
  tokenBudget?: number;
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

function agentResultPath(outputPath: string, variantId: string): string {
  return path.join(outputPath, "agents", variantId, "result.json");
}

function isAgentRunResult(value: unknown): value is AgentRunResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.variantId === "string" &&
    typeof result.agentId === "string" &&
    (result.status === "success" ||
      result.status === "failed" ||
      result.status === "cancelled")
  );
}

async function writeAgentResult(outputPath: string, result: AgentRunResult): Promise<void> {
  const filePath = agentResultPath(outputPath, result.variantId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(result, null, 2), "utf8");
}

async function loadResumeState(
  resumeFrom: string | undefined,
): Promise<{ taskId?: string; results: Map<string, AgentRunResult> }> {
  const results = new Map<string, AgentRunResult>();
  if (!resumeFrom) {
    return { results };
  }

  let taskId: string | undefined;
  try {
    const marker = JSON.parse(
      await fs.readFile(path.join(resumeFrom, "run-state.json"), "utf8"),
    ) as Record<string, unknown>;
    if (typeof marker.taskId === "string") {
      taskId = marker.taskId;
    }
  } catch {
    // Older or partial runs may not have a readable marker.
  }

  try {
    const summary = JSON.parse(
      await fs.readFile(path.join(resumeFrom, "summary.json"), "utf8"),
    ) as BenchmarkRun;
    if (typeof summary.task?.id === "string") {
      taskId = summary.task.id;
    }
    for (const result of summary.results ?? []) {
      if (isAgentRunResult(result) && result.status !== "cancelled") {
        results.set(result.variantId, result);
      }
    }
  } catch {
    // Interrupted runs may not have reached report generation.
  }

  try {
    const agentsDir = path.join(resumeFrom, "agents");
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const result = JSON.parse(
          await fs.readFile(path.join(agentsDir, entry.name, "result.json"), "utf8"),
        ) as unknown;
        if (isAgentRunResult(result) && result.status !== "cancelled") {
          results.set(result.variantId, result);
        }
      } catch {
        // Missing or malformed per-agent result files are treated as not resumable.
      }
    }
  } catch {
    // No per-agent result directory yet.
  }

  return { taskId, results };
}

function createTaskIncompatibleResult(
  preflight: Awaited<ReturnType<typeof preflightAdapters>>[number],
  outputPath: string,
  workspaceRootPath: string,
  compatibility: TaskCompatibilityResult
): AgentRunResult {
  const failedChecks = compatibility.checks.filter((check) => check.status === "fail");
  const reason = failedChecks[0]?.message ?? compatibility.summary;
  const result = createSkippedRunResult(
    preflight,
    path.join(outputPath, "agents", preflight.variantId, "trace.jsonl"),
    path.join(workspaceRootPath, preflight.variantId)
  );
  return {
    ...result,
    summary: `Task pack is not runnable with this repository: ${reason}`,
    scoreExcluded: true,
    scoreExclusionReason: "Task pack does not match this repository, so the agent was not run.",
    failureCategory: "task-pack"
  };
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
  const resolved = await resolveAndValidateRepo(options);
  const repoPath = resolved.repoPath;
  // Wire the CLI --token-budget flag: when options.tokenBudget is set it
  // overrides task.metadata.tokenBudget for this run, so token-efficiency
  // scoring (judges + result assembly read task.metadata.tokenBudget) uses the
  // CLI value. Applied immutably to a fresh task object.
  const task =
    options.tokenBudget !== undefined && Number.isFinite(options.tokenBudget) && options.tokenBudget > 0
      ? {
          ...resolved.task,
          metadata: {
            ...(resolved.task.metadata ?? {
              source: "community" as const,
              owner: "unknown",
              repoTypes: [],
              tags: [],
              dependencies: []
            }),
            tokenBudget: options.tokenBudget
          }
        }
      : resolved.task;

  const resumeState = await loadResumeState(options.resumeFrom);
  const resumeResults =
    resumeState.taskId && resumeState.taskId !== task.id
      ? new Map<string, AgentRunResult>()
      : resumeState.results;
  if (options.resumeFrom && resumeState.taskId && resumeState.taskId !== task.id) {
    logger.warn(
      "runner",
      "resume.task_mismatch",
      `Ignoring resume results from ${options.resumeFrom}: task id ${resumeState.taskId} does not match ${task.id}.`
    );
  }

  // Step 2: Prepare workspace directories and temp paths
  const { runId, outputPath, workspaceRootPath } = await prepareWorkspace({
    runId: options.runId,
    outputPath: options.outputPath,
    repoPath: options.repoPath
  });

  await writeRunMarker(outputPath, "in-progress", {
    runId,
    taskId: task.id,
    taskTitle: task.title
  });

  const selections = normalizeSelections(options);
  // Track all workspace paths for cleanup. Added BEFORE runAgent so that even
  // if runAgent throws, the path is in the Set for the finally-block cleanup.
  // If the entire benchmark is aborted before a callback runs, that workspace
  // was never created so no cleanup is needed.
  const workspacePaths = new Set<string>();

  throwIfAborted(cancellation?.signal, createCancellationSummary("startup"));

  let taskCompatibility: TaskCompatibilityResult | undefined;
  let completedNormally = false;
  try {
  await safeProgress({
    phase: "starting",
    message: `Created run ${runId}.`,
    metadata: { runId, outputPath }
  });

  // Step 2.5: Non-fatal task/repo compatibility preflight signal.
  // Surfaces a warning when the task pack's requirements (scripts, fixtures,
  // runtimes) are not satisfied by the resolved repo, but does NOT hard-fail —
  // the run still attempts to execute (preserving prior behavior). The result
  // is exposed via the progress event metadata so the UI/CLI can show it.
  try {
    const compatibility = await checkTaskCompatibility(task, repoPath);
    taskCompatibility = compatibility;
    if (compatibility.status !== "compatible") {
      const failedChecks = compatibility.checks
        .filter((check) => check.status !== "pass")
        .map((check) => `${check.label}: ${check.message}${check.fix ? ` Fix: ${check.fix}` : ""}`);
      await safeProgress({
        phase: "preflight",
        message: `Task compatibility warning: ${compatibility.summary}`,
        metadata: {
          compatibility: {
            status: compatibility.status,
            summary: compatibility.summary,
            checks: compatibility.checks,
            failedChecks
          }
        }
      });
      logger.warn(
        "runner",
        "task.compatibility_warning",
        `Task "${task.id}" compatibility: ${compatibility.status} — ${compatibility.summary}`,
        { metadata: { failedChecks } }
      );
    } else {
      await safeProgress({
        phase: "preflight",
        message: "Task compatibility check passed.",
        metadata: {
          compatibility: {
            status: compatibility.status,
            summary: compatibility.summary,
            checks: compatibility.checks,
            failedChecks: []
          }
        }
      });
    }
  } catch (compatibilityError) {
    // Compatibility evaluation is best-effort; never let it abort the run.
    logger.warn(
      "runner",
      "task.compatibility_check_failed",
      `Task compatibility check could not run: ${compatibilityError instanceof Error ? compatibilityError.message : String(compatibilityError)}`
    );
  }

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

  const incompatibleCompatibility = taskCompatibility;
  if (incompatibleCompatibility?.status === "incompatible") {
    const results = preflights.map((preflight) =>
      createTaskIncompatibleResult(preflight, outputPath, workspaceRootPath, incompatibleCompatibility)
    );

    await Promise.all(results.map((result) => writeAgentResult(outputPath, result)));

    await safeProgress({
      phase: "complete",
      message: `Benchmark did not run agents because the task pack is incompatible with this repository: ${incompatibleCompatibility.summary}`,
      metadata: {
        total: results.length,
        success: 0,
        cancelled: 0,
        scoreExcluded: results.length
      }
    });

    completedNormally = true;
    await writeRunMarker(outputPath, "complete", {
      runId,
      taskId: task.id,
      taskTitle: task.title,
      totalResults: results.length,
      successResults: 0,
      cancelledResults: 0,
      taskCompatibility: incompatibleCompatibility
    });

    return {
      runId,
      createdAt: new Date().toISOString(),
      repoPath,
      outputPath,
      scoreMode: options.scoreMode ?? "practical",
      scoreWeights: getDefaultWeights(options.scoreMode ?? "practical"),
      task,
      taskCompatibility: incompatibleCompatibility,
      preflights,
      results
    };
  }

  // Step 4: Execute agents concurrently
  const { results: rawResults, aborted } = await mapWithConcurrency(
    preflights,
    agentConcurrency(options),
    async (preflight) => {
      throwIfAborted(cancellation?.signal, createCancellationSummary("agent scheduling"));
      const resumedResult = resumeResults.get(preflight.variantId);
      if (resumedResult) {
        const result: AgentRunResult = { ...resumedResult, preflight };
        await safeProgress({
          phase: "agent-finish",
          agentId: result.agentId,
          variantId: result.variantId,
          displayLabel: result.displayLabel,
          message: `Reusing completed result for ${result.displayLabel}.`,
          metadata: {
            resumed: true,
            status: result.status,
            durationMs: result.durationMs,
            judgePasses: result.judgeResults.filter((value) => value.success).length,
            judgeTotal: result.judgeResults.length
          }
        });
        return result;
      }
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

      try {
        await writeAgentResult(outputPath, result);
      } catch (persistError) {
        logger.warn(
          "runner",
          "resume.result_persist_failed",
          `Failed to persist resumable result for ${result.displayLabel}: ${persistError instanceof Error ? persistError.message : String(persistError)}`,
          { error: persistError }
        );
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
    taskId: task.id,
    taskTitle: task.title,
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
    taskCompatibility,
    preflights,
    results
  };
  } finally {
    if (!completedNormally) {
      await writeRunMarker(outputPath, "failed", {
        runId,
        taskId: task.id,
        taskTitle: task.title
      });
      for (const workspacePath of workspacePaths) {
        await cleanupWorkspace(workspacePath).catch(() => {});
      }
      await cleanupWorkspace(workspaceRootPath, 1).catch(() => {});
    }
  }
}
