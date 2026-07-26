import type { NormalizedAgentResult, NormalizedRun } from "./run";
import { normalizeScoreMode } from "./score-mode.ts";

export type TrustLevel = "strong" | "caution";

function recordKey(result: NormalizedAgentResult): string {
  const runtime = (result.resolvedRuntime ?? {}) as Record<string, unknown>;
  const version = typeof runtime.version === "string" ? runtime.version : "";
  return `${result.variantId ?? result.agentId}@@${version}`;
}

function passedJudgeCount(result: NormalizedAgentResult): number {
  return result.judgeResults.filter((judge) => judge.success).length;
}

function judgePassRatio(result: NormalizedAgentResult): number {
  return result.judgeResults.length > 0 ? passedJudgeCount(result) / result.judgeResults.length : 1;
}

function runtimeVersion(result: NormalizedAgentResult): string {
  const version = result.resolvedRuntime?.version;
  return typeof version === "string" ? version : "";
}

/**
 * Runs that share the current run's task identity and score mode. This is the
 * fairness anchor for trends and cross-run comparison: comparing across
 * different tasks or score modes would be meaningless.
 */
export function getComparableRuns(runs: NormalizedRun[], currentRun: NormalizedRun): NormalizedRun[] {
  const currentTaskId = currentRun.task?.id || currentRun.task?.title;
  const currentScoreMode = normalizeScoreMode(currentRun.scoreMode);

  return runs.filter((run) => {
    const taskId = run.task?.id || run.task?.title;
    const scoreMode = normalizeScoreMode(run.scoreMode);
    return taskId === currentTaskId && scoreMode === currentScoreMode;
  });
}

export interface AgentTrendRow {
  run: NormalizedRun;
  result: NormalizedAgentResult | null;
  version: string;
  statusChange: string;
  durationDeltaMs: number | null;
  tokenDelta: number | null;
  costDelta: number | null;
  judgeDelta: number | null;
}

/**
 * Chronological per-run metrics for one agent (keyed by variantId@@version),
 * used to draw a historical baseline trend.
 */
export function getAgentTrendRows(runs: NormalizedRun[], currentRun: NormalizedRun, agentKey: string): AgentTrendRow[] {
  if (!agentKey) return [];

  const comparable = getComparableRuns(runs, currentRun).sort((left, right) =>
    String(left.createdAt).localeCompare(String(right.createdAt))
  );

  const rows: AgentTrendRow[] = [];
  let previous: NormalizedAgentResult | null = null;

  for (const run of comparable) {
    const result = run.results.find((entry) => recordKey(entry) === agentKey) ?? null;
    rows.push({
      run,
      result,
      version: result ? runtimeVersion(result) : "",
      statusChange: `${previous?.status ?? "start"} -> ${result?.status ?? "missing"}`,
      durationDeltaMs: previous && result && previous.durationMs !== null && result.durationMs !== null ? result.durationMs - previous.durationMs : null,
      tokenDelta: previous && result && previous.tokenUsage !== null && result.tokenUsage !== null ? result.tokenUsage - previous.tokenUsage : null,
      costDelta:
        previous?.costKnown && result?.costKnown && previous.estimatedCostUsd !== null && result.estimatedCostUsd !== null
          ? result.estimatedCostUsd - previous.estimatedCostUsd
          : null,
      judgeDelta: previous && result ? passedJudgeCount(result) - passedJudgeCount(previous) : null
    });
    if (result) previous = result;
  }

  return rows;
}

export interface CrossRunAgentRow {
  agentId: string;
  recordKey: string;
  displayLabel: string;
  version: string;
  stats: {
    totalRuns: number;
    successCount: number;
    totalDurationMs: number;
    totalTokens: number;
    totalCost: number;
    costKnownCount: number;
    totalJudgePasses: number;
    totalJudges: number;
  };
  bestRunId: string | null;
  bestDurationMs: number | null;
  score: number;
}

export interface CrossRunComparison {
  comparableRuns: NormalizedRun[];
  excludedRuns: Array<{ run: NormalizedRun; reasons: string[] }>;
  rows: CrossRunAgentRow[];
}

function exclusionReasons(base: NormalizedRun, candidate: NormalizedRun): string[] {
  const reasons: string[] = [];
  if (base.task.id !== candidate.task.id || base.task.schemaVersion !== candidate.task.schemaVersion) {
    reasons.push("different-task");
  }
  if (base.repository.revision !== candidate.repository.revision) reasons.push("different-revision");
  if (base.scoreMode !== candidate.scoreMode) reasons.push("different-score-mode");
  if (candidate.integrity === "damaged") reasons.push("damaged-result");
  return reasons;
}

// Minimal composite: judge pass ratio dominates, then shorter duration is better.
// Intentionally dependency-free so the workbench stays decoupled from legacy scoring.
function simpleComposite(result: NormalizedAgentResult): number {
  const ratio = judgePassRatio(result);
  const durationPenalty = result.durationMs === null ? 0 : Math.min(result.durationMs / 1_000_000, 0.5);
  return ratio * 100 - durationPenalty;
}

/**
 * Aggregate each agent across the selected (and fairness-filtered) runs.
 * Non-comparable runs are split into `excludedRuns` with their reasons so the
 * UI can explain why they were left out instead of silently dropping them.
 */
export function getCrossRunCompareRows(selectedRuns: NormalizedRun[]): CrossRunComparison {
  if (!selectedRuns || selectedRuns.length === 0) {
    return { comparableRuns: [], excludedRuns: [], rows: [] };
  }

  const baseline = selectedRuns[0];
  const comparableRuns = selectedRuns.filter((run) => exclusionReasons(baseline, run).length === 0);
  const excludedRuns = selectedRuns
    .filter((run) => exclusionReasons(baseline, run).length > 0)
    .map((run) => ({ run, reasons: exclusionReasons(baseline, run) }));

  const agentMap = new Map<string, Array<{ run: NormalizedRun; result: NormalizedAgentResult }>>();
  for (const run of comparableRuns) {
    for (const result of run.results) {
      const key = recordKey(result);
      const entries = agentMap.get(key);
      if (entries) {
        entries.push({ run, result });
      } else {
        agentMap.set(key, [{ run, result }]);
      }
    }
  }

  const rows: CrossRunAgentRow[] = [];
  for (const [key, entries] of agentMap) {
    if (entries.length === 0) continue;
    const first = entries[0];
    const successful = entries.filter((entry) => entry.result.status === "success");
    const knownCostEntries = entries.filter((entry) => entry.result.costKnown);
    const best = successful
      .slice()
      .sort((left, right) => {
        const delta = simpleComposite(right.result) - simpleComposite(left.result);
        if (delta !== 0) return delta;
        return (left.result.durationMs ?? Infinity) - (right.result.durationMs ?? Infinity);
      })[0];

    rows.push({
      agentId: first.result.variantId ?? first.result.agentId,
      recordKey: key,
      displayLabel: first.result.displayLabel,
      version: runtimeVersion(first.result),
      stats: {
        totalRuns: entries.length,
        successCount: successful.length,
        totalDurationMs: entries.reduce((sum, entry) => sum + (entry.result.durationMs ?? 0), 0),
        totalTokens: entries.reduce((sum, entry) => sum + (entry.result.tokenUsage ?? 0), 0),
        totalCost: knownCostEntries.reduce((sum, entry) => sum + (entry.result.estimatedCostUsd ?? 0), 0),
        costKnownCount: knownCostEntries.length,
        totalJudgePasses: entries.reduce((sum, entry) => sum + passedJudgeCount(entry.result), 0),
        totalJudges: entries.reduce((sum, entry) => sum + entry.result.judgeResults.length, 0)
      },
      bestRunId: best ? best.run.runId : null,
      bestDurationMs: best ? best.result.durationMs : null,
      score: successful.length > 0
        ? successful.reduce((sum, entry) => sum + simpleComposite(entry.result), 0) / successful.length
        : 0
    });
  }

  rows.sort((left, right) => {
    const successDelta = right.stats.successCount - left.stats.successCount;
    if (successDelta !== 0) return successDelta;
    return left.stats.totalDurationMs - right.stats.totalDurationMs;
  });

  return { comparableRuns, excludedRuns, rows };
}

export interface CrossRunRecommendation {
  agentId: string;
  recordKey: string;
  displayLabel: string;
  version: string;
  successRate: number;
  avgDurationMs: number;
  avgTokens: number;
  avgCost: number | null;
  bestRunId: string | null;
  score: number;
}

/**
 * Recommend the most reliable agent from a cross-run comparison. Only agents
 * with at least one success qualify — a fully failed agent is never promoted.
 */
export function getCrossRunRecommendation(comparison: CrossRunComparison): CrossRunRecommendation | null {
  const candidates = comparison.rows
    .filter((row) => row.stats.successCount > 0)
    .map((row) => ({
      agentId: row.agentId,
      recordKey: row.recordKey,
      displayLabel: row.displayLabel,
      version: row.version,
      successRate: row.stats.successCount / row.stats.totalRuns,
      avgDurationMs: row.stats.totalDurationMs / row.stats.totalRuns,
      avgTokens: row.stats.totalTokens / row.stats.totalRuns,
      avgCost: row.stats.costKnownCount > 0 ? row.stats.totalCost / row.stats.costKnownCount : null,
      bestRunId: row.bestRunId,
      score: row.score
    }));

  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.successRate !== left.successRate) return right.successRate - left.successRate;
    return left.avgDurationMs - right.avgDurationMs;
  });
  return candidates[0];
}

export interface SelectionTrustSummary {
  comparableRuns: number;
  excludedRuns: number;
  hasLegacyFallback: boolean;
  lowSampleSize: boolean;
  hasExclusions: boolean;
  level: TrustLevel;
}

/**
 * Surface why a comparison session might be weak: too few runs, legacy data
 * being mixed in, or excluded runs. The UI renders this as a caution banner
 * rather than letting small samples look authoritative.
 */
export function getSelectionTrust(summary: {
  comparableRuns: number;
  excludedRuns: number;
  hasLegacyFallback: boolean;
}): SelectionTrustSummary {
  const comparableRuns = summary.comparableRuns ?? 0;
  const excludedRuns = summary.excludedRuns ?? 0;
  const hasLegacyFallback = summary.hasLegacyFallback ?? false;
  const lowSampleSize = comparableRuns < 3;
  const hasExclusions = excludedRuns > 0;
  const level: TrustLevel = lowSampleSize || hasLegacyFallback || hasExclusions ? "caution" : "strong";

  return {
    comparableRuns,
    excludedRuns,
    hasLegacyFallback,
    lowSampleSize,
    hasExclusions,
    level
  };
}
