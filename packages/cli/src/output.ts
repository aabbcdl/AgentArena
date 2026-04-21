import { createHash } from "node:crypto";
import type { AdapterPreflightResult, BenchmarkRun, TaskJudge, TaskPack } from "@agentarena/core";
import { enrichRunWithScores } from "@agentarena/report";

function createTaskIdentity(task: TaskPack): string {
  return task.id ? `task:${task.id}` : `task-title:${task.title}`;
}

function createJudgeIdentity(task: TaskPack): string {
  const payload = JSON.stringify(
    task.judges.map((judge: TaskJudge) => ({
      id: judge.id,
      type: judge.type,
      label: judge.label,
      critical: judge.critical ?? false
    }))
  );
  return `judge:${createHash("sha256").update(payload).digest("hex")}`;
}

function createRepoBaselineIdentity(benchmark: BenchmarkRun): string | undefined {
  const baseCommit = benchmark.task.metadata?.githubIssue?.baseCommit;
  if (baseCommit) {
    return `repo-base:${baseCommit}`;
  }
  return undefined;
}

export function formatCapabilitySummary(capability: AdapterPreflightResult["capability"]): string {
  return [
    `tier=${capability.supportTier}`,
    `tokens=${capability.tokenAvailability}`,
    `cost=${capability.costAvailability}`,
    `trace=${capability.traceRichness}`
  ].join(" | ");
}

export function buildBenchmarkOutputSummary(
  benchmark: BenchmarkRun,
  report: {
    jsonPath: string;
    markdownPath: string;
    htmlPath: string;
    badgePath: string;
    prCommentPath: string;
  }
) {
  const scoredBenchmark = enrichRunWithScores(benchmark);
  return {
    runId: scoredBenchmark.runId,
    createdAt: scoredBenchmark.createdAt,
    repoPath: scoredBenchmark.repoPath,
    outputPath: scoredBenchmark.outputPath,
    scoreMode: scoredBenchmark.scoreMode,
    scoreWeights: scoredBenchmark.scoreWeights,
    scoreScope: scoredBenchmark.scoreScope,
    scoreValidityNote: scoredBenchmark.scoreValidityNote,
    fairComparison: {
      taskIdentity: createTaskIdentity(scoredBenchmark.task),
      judgeIdentity: createJudgeIdentity(scoredBenchmark.task),
      repoBaselineIdentity: createRepoBaselineIdentity(scoredBenchmark)
    },
    task: {
      id: scoredBenchmark.task.id,
      title: scoredBenchmark.task.title,
      schemaVersion: scoredBenchmark.task.schemaVersion,
      metadata: scoredBenchmark.task.metadata
    },
    preflights: scoredBenchmark.preflights,
    results: scoredBenchmark.results.map((result) => ({
      agentId: result.agentId,
      baseAgentId: result.baseAgentId,
      variantId: result.variantId,
      displayLabel: result.displayLabel,
      requestedConfig: result.requestedConfig,
      resolvedRuntime: result.resolvedRuntime,
      agentTitle: result.agentTitle,
      adapterKind: result.adapterKind,
      status: result.status,
      summary: result.summary,
      compositeScore: result.compositeScore,
      scoreReasons: result.scoreReasons,
      durationMs: result.durationMs,
      tokenUsage: result.tokenUsage,
      estimatedCostUsd: result.estimatedCostUsd,
      costKnown: result.costKnown,
      changedFiles: result.changedFiles,
      changedFilesCount: result.changedFiles.length,
      tracePath: result.tracePath,
      workspacePath: result.workspacePath,
      judges: {
        passed: result.judgeResults.filter((judge) => judge.success).length,
        total: result.judgeResults.length
      }
    })),
    report
  };
}
