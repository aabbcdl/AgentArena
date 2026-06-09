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

// ---------------------------------------------------------------------------
// Base result factory — single source of truth for AgentRunResult shape
// ---------------------------------------------------------------------------

/**
 * Options for constructing an AgentRunResult via the base factory.
 * All fields have sensible defaults so callers only override what they need.
 */
interface BaseResultOptions {
  preflight: AdapterPreflightResult;
  tracePath: string;
  workspacePath: string;
  status?: AgentRunResult["status"];
  summary?: string;
  durationMs?: number;
  tokenUsage?: number;
  estimatedCostUsd?: number;
  costKnown?: boolean;
  tokenUsageReliable?: boolean;
  changedFiles?: string[];
  changedFilesHint?: string[];
  setupResults?: CommandStepResult[];
  judgeResults?: JudgeResult[];
  teardownResults?: CommandStepResult[];
  diff?: DiffSummary;
  diffPrecision?: DiffPrecisionSummary;
  resolvedRuntime?: AgentResolvedRuntime;
  tokenUsageBreakdown?: AgentRunResult["tokenUsageBreakdown"];
  tokenEfficiencyScore?: number;
  sweBench?: AgentRunResult["sweBench"];
  cursorBench?: AgentRunResult["cursorBench"];
  liveBench?: AgentRunResult["liveBench"];
  assembledPrompt?: string;
  scoreExcluded?: boolean;
  scoreExclusionReason?: string;
  failureCategory?: AgentRunResult["failureCategory"];
}

/**
 * Create a fully-formed AgentRunResult with all required fields.
 * This is the SINGLE entry point for constructing results —
 * every code path must go through here so the field set is always consistent.
 */
export function createBaseResult(options: BaseResultOptions): AgentRunResult {
  const { preflight, tracePath, workspacePath } = options;
  return {
    agentId: preflight.agentId,
    baseAgentId: preflight.baseAgentId,
    variantId: preflight.variantId,
    displayLabel: preflight.displayLabel,
    requestedConfig: preflight.requestedConfig,
    resolvedRuntime: options.resolvedRuntime ?? preflight.resolvedRuntime,
    agentTitle: preflight.agentTitle,
    adapterKind: preflight.adapterKind,
    preflight,
    status: options.status ?? "failed",
    summary: options.summary ?? preflight.summary,
    durationMs: options.durationMs ?? 0,
    tokenUsage: options.tokenUsage ?? 0,
    estimatedCostUsd: options.estimatedCostUsd ?? 0,
    costKnown: options.costKnown ?? false,
    tokenUsageReliable: options.tokenUsageReliable,
    changedFiles: options.changedFiles ?? [],
    changedFilesHint: options.changedFilesHint ?? [],
    setupResults: options.setupResults ?? [],
    judgeResults: options.judgeResults ?? [],
    teardownResults: options.teardownResults ?? [],
    tracePath,
    workspacePath,
    diff: options.diff ?? { added: [], changed: [], removed: [], skippedLargeFiles: [] },
    diffPrecision: options.diffPrecision,
    scoreExcluded: options.scoreExcluded,
    scoreExclusionReason: options.scoreExclusionReason,
    failureCategory: options.failureCategory,
    tokenUsageBreakdown: options.tokenUsageBreakdown,
    tokenEfficiencyScore: options.tokenEfficiencyScore,
    sweBench: options.sweBench,
    cursorBench: options.cursorBench,
    liveBench: options.liveBench,
    assembledPrompt: options.assembledPrompt
  };
}

// ---------------------------------------------------------------------------
// Convenience factories — thin wrappers over createBaseResult
// ---------------------------------------------------------------------------

const EMPTY_DIFF: DiffSummary = Object.freeze({ added: [], changed: [], removed: [], skippedLargeFiles: [] });

/**
 * Create a cancelled run result.
 */
export function createCancelledRunResult(
  preflight: AdapterPreflightResult,
  tracePath: string,
  workspacePath: string,
  summary: string,
  setupResults: CommandStepResult[] = [],
  judgeResults: JudgeResult[] = [],
  teardownResults: CommandStepResult[] = [],
  diff: DiffSummary = EMPTY_DIFF,
  diffPrecision?: DiffPrecisionSummary
): AgentRunResult {
  return createBaseResult({
    preflight,
    tracePath,
    workspacePath,
    status: "cancelled",
    summary,
    changedFiles: uniqueSorted([...diff.added, ...diff.changed, ...diff.removed]),
    setupResults,
    judgeResults,
    teardownResults,
    diff,
    diffPrecision
  });
}

/**
 * Create a skipped run result (preflight failed / agent not available).
 */
export function createSkippedRunResult(
  preflight: AdapterPreflightResult,
  tracePath: string,
  workspacePath: string
): AgentRunResult {
  return createBaseResult({
    preflight,
    tracePath,
    workspacePath,
    status: "failed",
    summary: preflight.summary,
    scoreExcluded: true,
    scoreExclusionReason: "Agent did not run because adapter preflight was not ready.",
    failureCategory: "environment"
  });
}

// ---------------------------------------------------------------------------
// Shared utility functions
// ---------------------------------------------------------------------------

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
