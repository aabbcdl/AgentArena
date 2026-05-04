import type {
  AdapterPreflightResult,
  AgentResolvedRuntime,
  AgentRunResult,
  CommandStepResult,
  DiffPrecisionSummary,
  DiffSummary,
  JudgeResult
} from "@agentarena/core";
import { uniqueSorted } from "@agentarena/core";

export function createCancelledRunResult(
  preflight: AdapterPreflightResult,
  tracePath: string,
  workspacePath: string,
  summary: string,
  setupResults: CommandStepResult[] = [],
  judgeResults: JudgeResult[] = [],
  teardownResults: CommandStepResult[] = [],
  diff: DiffSummary = { added: [], changed: [], removed: [], skippedLargeFiles: [] },
  diffPrecision?: DiffPrecisionSummary
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
    status: "cancelled",
    summary,
    durationMs: 0,
    tokenUsage: 0,
    estimatedCostUsd: 0,
    costKnown: false,
    changedFiles: uniqueSorted([...diff.added, ...diff.changed, ...diff.removed]),
    changedFilesHint: [],
    setupResults,
    judgeResults,
    teardownResults,
    tracePath,
    workspacePath,
    diff,
    diffPrecision
  };
}

export function createSkippedRunResult(
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
      removed: [],
      skippedLargeFiles: []
    }
  };
}

export function buildChangedFiles(diff: DiffSummary, hints: string[]): string[] {
  return uniqueSorted([...diff.added, ...diff.changed, ...diff.removed, ...hints]);
}

export function mergeResolvedRuntime(
  primary?: AgentResolvedRuntime,
  fallback?: AgentResolvedRuntime
): AgentResolvedRuntime | undefined {
  if (!primary && !fallback) {
    return undefined;
  }

  const merged = {
    ...(fallback ?? {}),
    ...(primary ?? {}),
    notes: [...(fallback?.notes ?? []), ...(primary?.notes ?? [])].filter(Boolean)
  };

  return {
    ...merged,
    source: merged.source ?? "unknown",
    verification: merged.verification ?? "unknown"
  };
}

export function summarizeCommandStepFailure(stage: "setup" | "teardown", result: CommandStepResult): string {
  return `${stage} command "${result.label}" failed with exit code ${result.exitCode}.`;
}

export function createCancellationSummary(stage: string): string {
  return `Benchmark cancelled during ${stage}.`;
}
