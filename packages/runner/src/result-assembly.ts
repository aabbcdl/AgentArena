import type {
  AdapterPreflightResult,
  AgentRunResult,
  CommandStepResult,
  DiffPrecisionSummary,
  DiffSummary,
  FileDiffArtifact,
} from "@agentarena/core";
import { logger, metrics } from "@agentarena/core";
import type { runJudges } from "@agentarena/judges";
import {
  createBaseResult,
  createCancellationSummary,
  mergeResolvedRuntime,
} from "./result-builder.js";
import type { AgentRunContext } from "./types.js";
import { formatErrorMessage } from "./workspace.js";

export function buildFinalResult(
  preflight: AdapterPreflightResult,
  context: AgentRunContext,
  adapterResult: Awaited<ReturnType<typeof context.adapter.execute>> | undefined,
  adapterError: unknown,
  startedAt: number,
  setupResults: CommandStepResult[],
  judgeResults: Awaited<ReturnType<typeof runJudges>>,
  teardownResults: CommandStepResult[],
  diff: DiffSummary,
  changedFiles: string[],
  diffPrecision: DiffPrecisionSummary | undefined,
  cancelled: boolean,
  success: boolean,
  assembledPrompt?: string,
  diffReliable?: boolean,
  fileDiffs?: FileDiffArtifact[]
): AgentRunResult {
  const { adapter, workspacePath, tracePath, task } = context;
  const durationMs = Date.now() - startedAt;
  const fileDiffPayload = fileDiffs && fileDiffs.length > 0 ? fileDiffs : undefined;

  if (cancelled) {
    return createBaseResult({
      preflight,
      tracePath,
      workspacePath,
      status: "cancelled",
      summary: createCancellationSummary("agent execution"),
      durationMs,
      changedFiles,
      changedFilesHint: changedFiles,
      fileDiffs: fileDiffPayload,
      setupResults,
      judgeResults,
      teardownResults,
      diff,
      diffPrecision,
      diffReliable,
      assembledPrompt
    });
  }

  if (adapterError) {
    const errorMessage = formatErrorMessage(adapterError);
    return createBaseResult({
      preflight,
      tracePath,
      workspacePath,
      status: "failed",
      summary: `${adapter.title} crashed: ${errorMessage}`,
      durationMs,
      changedFiles,
      changedFilesHint: changedFiles,
      fileDiffs: fileDiffPayload,
      setupResults,
      diff,
      diffPrecision,
      diffReliable,
      assembledPrompt
    });
  }

  if (!adapterResult) {
    return createBaseResult({
      preflight,
      tracePath,
      workspacePath,
      status: "failed",
      summary: `${adapter.title} did not return a result.`,
      durationMs,
      changedFiles,
      changedFilesHint: changedFiles,
      fileDiffs: fileDiffPayload,
      setupResults,
      diff,
      diffPrecision,
      diffReliable,
      assembledPrompt
    });
  }

  const tokenUsage = adapterResult.tokenUsage;
  const tokenBudget = task.metadata?.tokenBudget;
  const tokenUsageBreakdown = adapterResult.tokenUsageBreakdown;
  // Don't derive an efficiency score from unreliable/fallback token data —
  // leaving it undefined excludes it from scoring (the correct behavior).
  const tokenUsageReliable = adapterResult.tokenUsageReliable;
  const tokenEfficiencyScore =
    tokenUsageReliable !== false &&
    tokenUsage && tokenBudget && Number.isFinite(tokenBudget) && Number.isFinite(tokenUsage) && tokenBudget > 0
      ? Math.min(1, tokenBudget / tokenUsage)
      : undefined;

  const patchValidationJudgeResult = judgeResults.find(
    (result) => result.type === "patch-validation"
  );
  const patchValidationResult = patchValidationJudgeResult
    ? {
        resolved: patchValidationJudgeResult.success,
        failToPassResults: patchValidationJudgeResult.failToPassResults ?? [],
        passToPassResults: patchValidationJudgeResult.passToPassResults ?? []
      }
    : undefined;

  const resolutionRate = patchValidationResult?.resolved !== undefined
    ? (patchValidationResult.resolved ? 1 : 0)
    : undefined;

  const sweBench = patchValidationResult !== undefined
    ? { patchValidationResult, resolutionRate }
    : undefined;

  const taskCategory = task.metadata?.taskCategories?.[0];
  const contaminationChecked = task.metadata?.antiContamination !== undefined;
  const difficultyGeneration = task.metadata?.difficultyEvolution?.generation;

  const liveBench = taskCategory !== undefined || contaminationChecked !== undefined || difficultyGeneration !== undefined
    ? { taskCategory, contaminationChecked, difficultyGeneration }
    : undefined;

  const finalStatus = success ? "success" : "failed";
  const durationSeconds = durationMs / 1000;

  metrics.agentStatusTotal.inc({ status: finalStatus, agentId: preflight.agentId, adapterKind: adapter.kind });
  metrics.agentDurationSeconds.observe({ agentId: preflight.agentId, status: finalStatus }, durationSeconds);

  if (adapterResult.tokenUsage) {
    metrics.agentTokenUsage.observe({ agentId: preflight.agentId }, adapterResult.tokenUsage);
  }

  if (adapterResult.estimatedCostUsd && adapterResult.costKnown) {
    metrics.agentCostUsd.observe({ agentId: preflight.agentId }, adapterResult.estimatedCostUsd);
  }

  const passedJudges = judgeResults.filter(j => j.success).length;
  const totalJudges = judgeResults.length;
  if (totalJudges > 0) {
    metrics.judgePassRate.set({ agentId: preflight.agentId }, passedJudges / totalJudges);
  }

  logger.info("adapter", "agent.complete", `Agent execution completed: ${adapter.title}`, {
    agentId: preflight.agentId,
    variantId: preflight.variantId,
    metadata: {
      status: finalStatus,
      durationMs,
      tokenUsage: adapterResult.tokenUsage,
      costUsd: adapterResult.estimatedCostUsd,
      judgesPassed: passedJudges,
      judgesTotal: totalJudges
    }
  });

  return createBaseResult({
    preflight,
    tracePath,
    workspacePath,
    status: success ? "success" : "failed",
    summary: adapterResult.summary,
    durationMs,
    tokenUsage: adapterResult.tokenUsage,
    estimatedCostUsd: adapterResult.estimatedCostUsd,
    costKnown: adapterResult.costKnown,
    costQuality: adapterResult.costQuality,
    tokenUsageReliable: adapterResult.tokenUsageReliable,
    dataQualityWarning: adapterResult.dataQualityWarning,
    missingCriticalEvents: adapterResult.missingCriticalEvents,
    changedFiles,
    changedFilesHint: changedFiles,
    fileDiffs: fileDiffPayload,
    setupResults,
    judgeResults,
    teardownResults,
    diff,
    diffPrecision,
    diffReliable,
    resolvedRuntime: mergeResolvedRuntime(adapterResult.resolvedRuntime, preflight.resolvedRuntime),
    tokenUsageBreakdown,
    tokenEfficiencyScore,
    sweBench,
    liveBench,
    assembledPrompt
  });
}
