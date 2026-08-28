import path from "node:path";

import { preflightAdapters, resolveRuntimeProfileLaunch } from "@agentarena/adapters";
import {
  AgentLogStore,
  type AgentRunResult,
  type AgentSelection,
  type BenchmarkCancellation,
  type BenchmarkRun,
  createFairComparisonMetadata,
  getDefaultWeights,
  isAbortError,
  logger,
  RESULT_ARTIFACT_SCHEMA,
  recordTelemetryEvent,
  type ScoreMode,
  type TaskCompatibilityResult,
  throwIfAborted,
  writeJsonAtomic
} from "@agentarena/core";
import { runAgent } from "./agent-lifecycle.js";
import { agentConcurrency, mapWithConcurrency } from "./concurrency.js";
import {
  createJobManifest,
  type JobManifestHarnessDriftRecord,
  type RuntimeExecutionBindings,
  runtimeBindingForSelection,
  updateJobManifestHarnessDrift,
  updateJobManifestStatus,
  writeJobManifest
} from "./job-manifest.js";
import { normalizeSelections } from "./normalize-selections.js";
import { resolveAndValidateRepo } from "./repo-resolution.js";
import {
  createCancellationSummary,
  createCancelledRunResult,
  createSkippedRunResult,
} from "./result-builder.js";
import { collectResults } from "./result-collection.js";
import {
  AgentResultPersistenceError,
  createResultSelectionFingerprint,
  createRunContractFingerprint,
  createRunFingerprint,
  createSelectionFingerprint,
  loadResumeState,
  repositoryIdentity,
  writeAgentResult,
} from "./resume.js";
import { checkTaskCompatibility } from "./task-compatibility.js";
import { cleanupWorkspace, formatErrorDetails, formatErrorMessage, type WorkspaceCleanupResult } from "./workspace.js";
import { prepareWorkspace } from "./workspace-prep.js";

export type { AgentRunContext } from "./agent-lifecycle.js";
export { runAgent } from "./agent-lifecycle.js";
export type { MapWithConcurrencyResult } from "./concurrency.js";
export { agentConcurrency, agentExecuteTimeoutMs, DEFAULT_AGENT_CONCURRENCY, mapWithConcurrency, resolvePositiveInt } from "./concurrency.js";
export type {
  CreateJobManifestOptions,
  RuntimeExecutionBinding,
  RuntimeExecutionBindings
} from "./job-manifest.js";
export {
  assertFrozenRuntimeSelection,
  createJobManifest,
  jobManifestPath,
  markJobManifestInterrupted,
  readJobManifest,
  runtimeBindingForSelection,
  updateJobManifestHarnessDrift,
  updateJobManifestStatus,
  writeJobManifest
} from "./job-manifest.js";
export { normalizeSelections } from "./normalize-selections.js";
export type { RepoResolution, RepoResolutionOptions } from "./repo-resolution.js";
export { resolveAndValidateRepo } from "./repo-resolution.js";
export { repositoryIdentity } from "./resume.js";
export { buildDiffPrecision, collectChangedFiles, evaluateChangePolicy } from "./snapshot.js";
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
  userRepoRoot?: string;
  cancellation?: BenchmarkCancellation;
  onProgress?: (event: BenchmarkProgressEvent) => void | Promise<void>;
  scoreMode?: ScoreMode;
  tokenBudget?: number;
  debug?: boolean;
  /** Explicit opt-in for trusted built-in task packs that still use inline eval commands. */
  allowEvalInTaskCommands?: boolean;
  /** Low-cardinality source of the run request for local activation measurement. */
  entryPoint?: "cli" | "legacy-launcher" | "legacy-quick-demo" | "workbench-plan";
  /**
   * When true, the runner emits fine-grained `agent-activity` progress
   * events (stdout/stderr lines) AND per-agent log capture. Default-off
   * to honor STABILITY.md — no existing consumer sees new behavior
   * unless they opt in.
   */
  enableActivityEvents?: boolean;
  /**
   * Per-agent log store for capturing stdout/stderr lines during the run.
   * When provided AND enableActivityEvents is true, log lines are appended
   * here AND emitted as progress events. The UI server holds the reference
   * to serve /api/agent-logs.
   */
  agentLogStore?: AgentLogStore;
  /** Frozen task-ready runtime bindings keyed by variant or RuntimeProfile ID. */
  runtimeBindings?: RuntimeExecutionBindings;
}

export interface BenchmarkProgressEvent {
  phase:
    | "starting"
    | "preflight"
    | "agent-start"
    | "agent-finish"
    | "report"
    | "complete"
    | "agent-activity";
  message: string;
  agentId?: string;
  variantId?: string;
  displayLabel?: string;
  metadata?: Record<string, unknown>;
  /**
   * Present only when phase === "agent-activity". The raw stdout/stderr
   * line content (truncated to 500 chars for event-bus safety).
   */
  line?: string;
  /** Present only when phase === "agent-activity". Monotonic per-agent seq. */
  seq?: number;
  /** Present only when phase === "agent-activity". Which stdio stream. */
  stream?: "stdout" | "stderr";
  /**
   * Present on every non-starting event. Aggregate run progress snapshot
   * so CLI and web UI share one computation source.
   */
  snapshot?: RunProgressSnapshot;
}

/**
 * Aggregate progress snapshot emitted with every progress event.
 * Single source of truth for progress bars, stalled detection, and ETA.
 */
export interface RunProgressSnapshot {
  total: number;
  finished: number;
  running: string[];          // variantIds of currently running agents
  failed: number;
  /** variantId -> last activity epoch ms (Date.now()) */
  lastActivityByAgent: Record<string, number>;
}

async function writeRunMarker(
  outputPath: string,
  state: "in-progress" | "complete" | "failed" | "cancelled",
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await writeJsonAtomic(
      path.join(outputPath, "run-state.json"),
      { state, updatedAt: new Date().toISOString(), ...metadata }
    );
  } catch (error) {
    logger.warn("runner", "run_marker.write_failed", `Failed to write run marker for ${outputPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
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


function telemetryResultIntegrity(results: AgentRunResult[]): "complete" | "partial" | "unavailable" {
  if (results.length === 0) return "unavailable";
  return results.every((result) =>
    typeof result.status === "string" &&
    Number.isFinite(result.durationMs) &&
    Number.isFinite(result.tokenUsage) &&
    Array.isArray(result.judgeResults)
  ) ? "complete" : "partial";
}

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkRun> {
  const cancellation = options.cancellation;
  const safeProgress = async (event: BenchmarkProgressEvent): Promise<void> => {
    try {
      await options.onProgress?.(event);
    } catch (progressError) {
      logger.warn("runner", "progress.callback_error", `onProgress callback threw for phase "${event.phase}": ${progressError instanceof Error ? progressError.message : String(progressError)}`);
    }
  };

  // Progress snapshot — single source of truth for progress bars, stalled
  // detection, and ETA. `total` is set once after selections are normalized
  // (not incremented per agent). Per-agent lifecycle state lives in
  // `statusByAgent` (each worker touches only its own variantId); the
  // `running` array and counters are *derived* from that map at emit time,
  // removing the previous pattern where concurrent closures incrementally
  // mutated shared counters (which would silently miscount if an `await` were
  // ever inserted between read and write).
  let snapshotTotal = 0;
  const statusByAgent = new Map<string, "running" | "success" | "failed" | "cancelled">();
  const lastActivityByAgent: Record<string, number> = {};

  // Monotonic per-run activity sequence counter. Ensures every activity event
  // gets a unique, ordered seq that survives debounce coalescing. Enables
  // future SSE reconnection via Last-Event-ID.
  let activitySeqCounter = 0;

  /** Derive the progress snapshot from authoritative per-agent state. */
  function deriveSnapshot(): RunProgressSnapshot {
    let finished = 0;
    let failed = 0;
    const running: string[] = [];
    for (const [variantId, status] of statusByAgent) {
      if (status === "running") {
        running.push(variantId);
      } else {
        finished++;
        if (status === "failed") failed++;
      }
    }
    return { total: snapshotTotal, finished, running, failed, lastActivityByAgent: { ...lastActivityByAgent } };
  }

  /** Attach the current snapshot to a progress event before sending. */
  const emitProgress = async (event: BenchmarkProgressEvent): Promise<void> => {
    // agent-activity events are high-frequency; skip snapshot attach for them
    // to avoid creating garbage objects 8+ times/sec/agent.
    if (event.phase !== "agent-activity") {
      event.snapshot = deriveSnapshot();
    }
    await safeProgress(event);
  };

  /** Get next monotonic seq for an activity event. */
  const nextActivitySeq = (): number => activitySeqCounter++;

  // Per-agent log store: use the one passed in (UI server) or create a
  // throwaway one (CLI mode) so the capture path is always the same.
  const agentLogStore = options.agentLogStore ?? new AgentLogStore(1000);
  const enableActivity = options.enableActivityEvents === true;

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

  const selections = normalizeSelections(options);
  const scoreMode = options.scoreMode ?? "practical";
  const repositoryBaselineIdentity = repositoryIdentity(repoPath);
  const fairComparison = createFairComparisonMetadata(task, repositoryBaselineIdentity);
  if (!fairComparison.taskIdentity || !fairComparison.judgeIdentity) {
    throw new Error("Cannot create a frozen job without task and judge identities.");
  }
  const runContractFingerprint = createRunContractFingerprint(
    repoPath,
    task,
    scoreMode,
    repositoryBaselineIdentity
  );
  const runFingerprint = createRunFingerprint(
    repoPath,
    task,
    selections,
    scoreMode,
    repositoryBaselineIdentity
  );
  const resumeState = await loadResumeState(options.resumeFrom, runFingerprint, runContractFingerprint);
  const resumeResults =
    resumeState.taskId && resumeState.taskId !== task.id
      ? new Map<string, AgentRunResult>()
      : resumeState.mismatchReason
        ? new Map<string, AgentRunResult>()
        : resumeState.results;
  if (options.resumeFrom && (resumeState.taskId && resumeState.taskId !== task.id || resumeState.mismatchReason)) {
    logger.warn(
      "runner",
      "resume.rejected",
      `Ignoring resume results from ${options.resumeFrom}: ${resumeState.taskId && resumeState.taskId !== task.id
        ? `task id ${resumeState.taskId} does not match ${task.id}`
        : resumeState.mismatchReason}. ` +
      `Discarding ${resumeState.results.size} cached agent result(s); the run will be re-executed.`
    );
  }

  // Step 2: Prepare workspace directories and temp paths
  const { runId, outputPath, workspaceRootPath } = await prepareWorkspace({
    runId: options.runId,
    outputPath: options.outputPath,
    repoPath: options.repoPath
  });

  // Ownership of the temporary root transfers from prepareWorkspace only after
  // it returns. From this point, every failure must pass through this finalizer.
  const workspacePaths = new Set<string>();
  let jobManifest: ReturnType<typeof createJobManifest> | undefined;
  let completedNormally = false;
  let terminalError: unknown;

  const capturePostRunHarnessDrift = async (): Promise<void> => {
    if (!jobManifest || !options.runtimeBindings) return;
    const checkedAt = new Date().toISOString();
    const records: JobManifestHarnessDriftRecord[] = [];
    for (const selection of selections) {
      const binding = runtimeBindingForSelection(selection, options.runtimeBindings);
      if (!binding) continue;
      if (!binding.registryBacked) {
        records.push({
          variantId: selection.variantId,
          evidence: {
            status: "check-failed",
            checkedAt,
            summary: "This programmatic runtime binding is not registry-backed, so post-run Harness drift could not be re-resolved."
          }
        });
        continue;
      }
      try {
        const currentRepositoryBaseline = repositoryIdentity(repoPath);
        const current = await resolveRuntimeProfileLaunch({
          profileId: binding.launchSpec.profile.id,
          repositoryPath: repoPath,
          repositoryBaselineIdentity: currentRepositoryBaseline,
          environment: process.env,
          resolveSecrets: false
        });
        const unchanged = current.launchSpec.launchSpecHash === binding.launchSpec.launchSpecHash;
        records.push({
          variantId: selection.variantId,
          evidence: {
            status: unchanged ? "unchanged" : "changed",
            checkedAt,
            postRunSnapshotId: current.harnessSnapshot.snapshotId,
            summary: unchanged
              ? "Known Profile, installation, environment, repository, and Harness inputs were unchanged after the run."
              : "Known Profile, installation, environment, repository, or Harness inputs changed during the run."
          }
        });
      } catch (error) {
        records.push({
          variantId: selection.variantId,
          evidence: {
            status: "check-failed",
            checkedAt,
            summary: `Post-run Harness drift check failed: ${formatErrorMessage(error)}`
          }
        });
      }
    }
    jobManifest = await updateJobManifestHarnessDrift(outputPath, records);
  };

  const usesFrozenRuntime = options.runtimeBindings !== undefined
    || selections.some((selection) =>
      selection.runtimeProfileId !== undefined
      || selection.launchSpecHash !== undefined
      || selection.verificationReceiptId !== undefined
    );
  try {
  jobManifest = usesFrozenRuntime
    ? createJobManifest({
        runId,
        status: "queued",
        repositoryBaselineIdentity,
        taskIdentity: fairComparison.taskIdentity,
        judgeIdentity: fairComparison.judgeIdentity,
        scoreMode,
        selections,
        runtimeBindings: options.runtimeBindings ?? {}
      })
    : undefined;
  if (jobManifest) {
    await writeJobManifest(outputPath, jobManifest);
  }

  await writeRunMarker(outputPath, "in-progress", {
    runId,
    taskId: task.id,
    taskTitle: task.title,
    runFingerprint,
    runContractFingerprint
  });

  // Set total once to the full selection count — NOT incremented per agent.
  // This ensures progress percentage is correct from the start (e.g. 0/40, not 0/1).
  snapshotTotal = selections.length;
  // Opt-in product measurement (no-op unless AGENTARENA_TELEMETRY=1).
  // Records only aggregate, decision-relevant signals — no repo paths or prompts.
  void recordTelemetryEvent("run_started", {
    agentCount: selections.length,
    taskPackId: task.id,
    scoreMode: options.scoreMode ?? "practical",
    entryPoint: options.entryPoint ?? "cli",
    probeAuth: options.probeAuth === true,
  });
  // Track all workspace paths for cleanup. Added BEFORE runAgent so that even
  // if runAgent throws, the path is in the Set for the finally-block cleanup.
  // If the entire benchmark is aborted before a callback runs, that workspace
  // was never created so no cleanup is needed.
  let taskCompatibility: TaskCompatibilityResult | undefined;
  throwIfAborted(cancellation?.signal, createCancellationSummary("startup"));
  await emitProgress({
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
      await emitProgress({
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
      await emitProgress({
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
  await emitProgress({
    phase: "preflight",
    message: `Running preflight for ${selections.length} agent selection(s).`,
    metadata: { count: selections.length }
  });

  let preflights: Awaited<ReturnType<typeof preflightAdapters>>;
  try {
    throwIfAborted(cancellation?.signal, createCancellationSummary("preflight"));
    preflights = await Promise.all(selections.map(async (selection) => {
      const binding = runtimeBindingForSelection(selection, options.runtimeBindings);
      const [preflight] = await preflightAdapters([selection], {
        probeAuth: options.probeAuth,
        resolvedLaunchSpec: binding?.launchSpec,
        runtimeSecretValues: binding?.runtimeSecretValues,
        repositoryPath: repoPath
      });
      return binding
        ? {
            ...preflight,
            runtimeProfileId: selection.runtimeProfileId,
            launchSpecHash: selection.launchSpecHash,
            verificationReceiptId: selection.verificationReceiptId
          }
        : preflight;
    }));
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const errorDetails = formatErrorDetails(error);
    throw new Error(`Preflight failed: ${errorDetails.message}`);
  }

  await emitProgress({
    phase: "preflight",
    message: `Preflight finished. ${preflights.filter((value) => value.status === "ready").length}/${preflights.length} ready.`,
    metadata: {
      total: preflights.length,
      ready: preflights.filter((value) => value.status === "ready").length
    }
  });

  const validatedResumeResults = new Map<string, AgentRunResult>();
  for (const preflight of preflights) {
    const cachedResult = resumeResults.get(preflight.variantId);
    if (!cachedResult) continue;
    const currentSelectionFingerprint = createSelectionFingerprint({
      baseAgentId: preflight.baseAgentId,
      variantId: preflight.variantId,
      displayLabel: preflight.displayLabel,
      config: preflight.requestedConfig,
      runtimeProfileId: preflight.runtimeProfileId,
      launchSpecHash: preflight.launchSpecHash,
      verificationReceiptId: preflight.verificationReceiptId
    });
    if (currentSelectionFingerprint !== createResultSelectionFingerprint(cachedResult)) {
      logger.warn(
        "runner",
        "resume.agent_rejected",
        `Ignoring cached result for ${preflight.displayLabel}: the current agent selection does not match the persisted result.`
      );
      continue;
    }
    validatedResumeResults.set(preflight.variantId, cachedResult);
  }

  const incompatibleCompatibility = taskCompatibility;
  if (incompatibleCompatibility?.status === "incompatible") {
    const results = preflights.map((preflight) =>
      createTaskIncompatibleResult(preflight, outputPath, workspaceRootPath, incompatibleCompatibility)
    );

    await Promise.all(results.map((result) => writeAgentResult(outputPath, result, RESULT_ARTIFACT_SCHEMA, writeJsonAtomic)));

    await emitProgress({
      phase: "complete",
      message: `Benchmark did not run agents because the task pack is incompatible with this repository: ${incompatibleCompatibility.summary}`,
      metadata: {
        total: results.length,
        success: 0,
        cancelled: 0,
        scoreExcluded: results.length
      }
    });

    await writeRunMarker(outputPath, "complete", {
      runId,
      taskId: task.id,
      taskTitle: task.title,
      runFingerprint,
      runContractFingerprint,
      totalResults: results.length,
      successResults: 0,
      cancelledResults: 0,
      taskCompatibility: incompatibleCompatibility
    });
    if (jobManifest) {
      await capturePostRunHarnessDrift();
      jobManifest = await updateJobManifestStatus(outputPath, "completed");
    }
    completedNormally = true;

    // Telemetry: run ended because the task pack was incompatible with the repo.
    void recordTelemetryEvent("run_completed", {
      agentCount: results.length,
      taskPackId: task.id,
      scoreMode: options.scoreMode ?? "practical",
      entryPoint: options.entryPoint ?? "cli",
      resultIntegrity: telemetryResultIntegrity(results),
      outcome: "incompatible",
      successCount: 0,
      totalCount: results.length,
    });

    return {
      runId,
      createdAt: new Date().toISOString(),
      repoPath,
      outputPath,
      scoreMode: options.scoreMode ?? "practical",
      scoreWeights: getDefaultWeights(options.scoreMode ?? "practical"),
      fairComparison,
      jobManifest,
      task,
      taskCompatibility: incompatibleCompatibility,
      preflights,
      results
    };
  }

  // Step 4: Execute agents concurrently
  if (jobManifest) {
    jobManifest = await updateJobManifestStatus(outputPath, "running");
  }
  let persistenceFailure: AgentResultPersistenceError | undefined;
  const { results: rawResults, aborted } = await mapWithConcurrency(
    preflights,
    agentConcurrency(options),
    async (preflight) => {
      if (persistenceFailure) {
        throw persistenceFailure;
      }
      throwIfAborted(cancellation?.signal, createCancellationSummary("agent scheduling"));
      const resumedResult = validatedResumeResults.get(preflight.variantId);
      if (resumedResult) {
        const result: AgentRunResult = { ...resumedResult, preflight };
        // Mark terminal status; `deriveSnapshot()` recomputes counters/array.
        statusByAgent.set(preflight.variantId, result.status);
        lastActivityByAgent[preflight.variantId] = Date.now();
        await emitProgress({
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
      const selection = selections.find(
        (candidate) => candidate.variantId === preflight.variantId
      );
      if (!selection) {
        throw new Error(`Missing selection for preflight variant ${preflight.variantId}.`);
      }
      const runtimeBinding = runtimeBindingForSelection(
        selection,
        options.runtimeBindings
      );

      // Mark as running; `deriveSnapshot()` recomputes the running array.
      statusByAgent.set(preflight.variantId, "running");
      lastActivityByAgent[preflight.variantId] = Date.now();

      await emitProgress({
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
          debug: options.debug,
          allowEvalInTaskCommands: options.allowEvalInTaskCommands,
          enableActivityEvents: enableActivity,
          agentLogStore: enableActivity ? agentLogStore : undefined,
          nextActivitySeq: enableActivity ? nextActivitySeq : undefined,
          resolvedLaunchSpec: runtimeBinding?.launchSpec,
          runtimeSecretValues: runtimeBinding?.runtimeSecretValues,
          hostEnvironment: runtimeBinding?.hostEnvironment,
          onActivity: enableActivity
            ? (line, stream, seq) => {
                const eventLine = line.slice(0, 500);
                lastActivityByAgent[preflight.variantId] = Date.now();
                void emitProgress({
                  phase: "agent-activity",
                  agentId: preflight.agentId,
                  variantId: preflight.variantId,
                  displayLabel: preflight.displayLabel,
                  message: eventLine,
                  line: eventLine,
                  seq,
                  stream
                }).catch((error) => {
                  logger.warn(
                    "runner",
                    "activity.progress_failed",
                    `Failed to emit activity for ${preflight.displayLabel}: ${error instanceof Error ? error.message : String(error)}`,
                    { error }
                  );
                });
              }
            : undefined
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

      // Mark terminal status; `deriveSnapshot()` recomputes counters/array.
      statusByAgent.set(preflight.variantId, result.status);
      lastActivityByAgent[preflight.variantId] = Date.now();

      try {
        await writeAgentResult(outputPath, result, RESULT_ARTIFACT_SCHEMA, writeJsonAtomic);
      } catch (error) {
        if (error instanceof AgentResultPersistenceError) {
          persistenceFailure ??= error;
        }
        throw error;
      }

      await emitProgress({
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

  const fatalPersistenceError = persistenceFailure ?? rawResults.find((result) => result instanceof AgentResultPersistenceError);
  if (fatalPersistenceError instanceof AgentResultPersistenceError) {
    throw fatalPersistenceError;
  }

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
        logger.warn("runner", "cleanup.failed", `Failed to cleanup workspace ${result.path}: ${result.error}`);
      }
    }
    const rootCleanupResult = await cleanupWorkspace(workspaceRootPath, 1);
    cleanupResults.push(rootCleanupResult);
    if (!rootCleanupResult.success) {
      logger.warn("runner", "cleanup.root_failed", `Failed to cleanup workspace root ${workspaceRootPath}: ${rootCleanupResult.error}`);
    }
  }

  const completedWithCancellation = aborted || results.some((value) => value.status === "cancelled");

  await emitProgress({
    phase: "complete",
    message: `${completedWithCancellation ? "Benchmark cancelled" : "Benchmark run finished"} for ${results.length} result(s).`,
    metadata: {
      total: results.length,
      success: results.filter((value) => value.status === "success").length,
      cancelled: results.filter((value) => value.status === "cancelled").length,
      cleanupFailures: cleanupResults.filter((r) => !r.success).length
    }
  });

  // A run that completed with one or more cancelled agents (but also successes)
  // must NOT be folded into "failed" — that would misrepresent an otherwise
  // successful run. Use a distinct "cancelled" marker so callers/consumers can
  // distinguish "benchmark aborted" from "benchmark failed".
  await writeRunMarker(outputPath, completedWithCancellation ? "cancelled" : "complete", {
    runId,
    taskId: task.id,
    taskTitle: task.title,
    totalResults: results.length,
    successResults: results.filter((value) => value.status === "success").length,
    cancelledResults: results.filter((value) => value.status === "cancelled").length,
    runFingerprint,
    runContractFingerprint
  });
  if (jobManifest) {
    await capturePostRunHarnessDrift();
    jobManifest = await updateJobManifestStatus(
      outputPath,
      completedWithCancellation ? "cancelled" : "completed"
    );
  }
  completedNormally = true;
  // Telemetry: run finished (success or cancelled-with-successes).
  void recordTelemetryEvent("run_completed", {
    agentCount: results.length,
    taskPackId: task.id,
    scoreMode: options.scoreMode ?? "practical",
    entryPoint: options.entryPoint ?? "cli",
    resultIntegrity: telemetryResultIntegrity(results),
    outcome: completedWithCancellation ? "cancelled" : "completed",
    successCount: results.filter((value) => value.status === "success").length,
    totalCount: results.length,
  });
  return {
    runId,
    createdAt: new Date().toISOString(),
    repoPath,
    outputPath,
    scoreMode: options.scoreMode ?? "practical",
    scoreWeights: getDefaultWeights(options.scoreMode ?? "practical"),
    fairComparison,
    jobManifest,
    task,
    taskCompatibility,
    preflights,
    results
  };
  } catch (error) {
    terminalError = error;
    throw error;
  } finally {
    if (!completedNormally) {
      const terminalState = isAbortError(terminalError) ? "cancelled" : "failed";
      void recordTelemetryEvent("run_completed", {
        agentCount: selections.length,
        taskPackId: task.id,
        scoreMode: options.scoreMode ?? "practical",
        entryPoint: options.entryPoint ?? "cli",
        resultIntegrity: "unavailable",
        outcome: terminalState,
      });
      try {
        await writeRunMarker(outputPath, terminalState, {
          runId,
          taskId: task.id,
          taskTitle: task.title,
          runFingerprint,
          runContractFingerprint
        });
      } catch (finalizationError) {
        logger.warn(
          "runner",
          "run_marker.finalization_failed",
          `Failed to persist the ${terminalState} run marker: ${formatErrorMessage(finalizationError)}`
        );
      }
      if (jobManifest) {
        try {
          await capturePostRunHarnessDrift();
        } catch (finalizationError) {
          logger.warn(
            "runner",
            "job_manifest.drift_finalization_failed",
            `Failed to persist post-run Harness drift: ${formatErrorMessage(finalizationError)}`
          );
        }
        try {
          jobManifest = await updateJobManifestStatus(
            outputPath,
            terminalState,
            () => new Date().toISOString(),
            terminalError === undefined ? undefined : formatErrorMessage(terminalError)
          );
        } catch (finalizationError) {
          logger.warn(
            "runner",
            "job_manifest.status_finalization_failed",
            `Failed to persist the ${terminalState} JobManifest status: ${formatErrorMessage(finalizationError)}`
          );
        }
      }
      for (const workspacePath of workspacePaths) {
        const cleanupResult = await cleanupWorkspace(workspacePath).catch((cleanupError) => ({
          success: false,
          path: workspacePath,
          error: formatErrorMessage(cleanupError)
        }));
        if (!cleanupResult.success) {
          logger.warn("runner", "cleanup.finalization_failed", `Failed to cleanup workspace ${workspacePath}: ${cleanupResult.error}`);
        }
      }
      const rootCleanupResult = await cleanupWorkspace(workspaceRootPath, 1).catch((cleanupError) => ({
        success: false,
        path: workspaceRootPath,
        error: formatErrorMessage(cleanupError)
      }));
      if (!rootCleanupResult.success) {
        logger.warn(
          "runner",
          "cleanup.root_finalization_failed",
          `Failed to cleanup workspace root ${workspaceRootPath}: ${rootCleanupResult.error}`
        );
      }
    }
  }
}
