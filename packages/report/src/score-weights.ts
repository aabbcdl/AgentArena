/**
 * Score weight normalization and migration.
 *
 * Handles:
 * - Legacy "judges" key migration → criticalJudges + nonCriticalJudges
 * - Applicability filtering (remove weights for missing data)
 * - Normalization (weights sum to 1.0)
 *
 * Extracted from scoring.ts for independent testability.
 */

import type { BenchmarkRun } from "@agentarena/core";

/**
 * Legacy "judges" weight split ratio: critical gets 2/3, non-critical gets 1/3.
 * Rationale: critical judges (test-result, patch-validation) are more important
 * than non-critical ones (lint-check, file-exists), so they get double weight.
 */
const LEGACY_JUDGES_CRITICAL_RATIO = 2 / 3;
const LEGACY_JUDGES_NONCRITICAL_RATIO = 1 / 3;

/**
 * Migrate legacy "judges" weight key into criticalJudges + nonCriticalJudges.
 * If the new keys already exist, the legacy key is simply dropped.
 */
export function migrateLegacyWeights(weights: Record<string, number>): Record<string, number> {
  const migrated: Record<string, number> = {};
  for (const [key, weight] of Object.entries(weights)) {
    if (key === "judges") {
      if (!weights.criticalJudges) migrated.criticalJudges = weight * LEGACY_JUDGES_CRITICAL_RATIO;
      if (!weights.nonCriticalJudges) migrated.nonCriticalJudges = weight * LEGACY_JUDGES_NONCRITICAL_RATIO;
    } else {
      migrated[key] = weight;
    }
  }
  return migrated;
}

/**
 * Filter out weights for components that don't apply to this result.
 * For example, "precision" is only applicable when the task defines expectedChangedPaths.
 */
export function filterApplicableWeights(
  weights: Record<string, number>,
  result: BenchmarkRun["results"][number],
  run: BenchmarkRun
): Record<string, number> {
  const hasPrecision = run.task.expectedChangedPaths && run.task.expectedChangedPaths.length > 0;
  const hasTokenEfficiency = typeof result.tokenEfficiencyScore === "number";
  const hasResolutionRate = typeof result.sweBench?.resolutionRate === "number";
  const hasAcceptanceRate = typeof result.cursorBench?.acceptanceRate === "number";

  const applicable: Record<string, number> = {};
  for (const [key, weight] of Object.entries(weights)) {
    if (key === "precision" && !hasPrecision) continue;
    if (key === "tokenEfficiency" && !hasTokenEfficiency) continue;
    if (key === "resolutionRate" && !hasResolutionRate) continue;
    if (key === "acceptanceRate" && !hasAcceptanceRate) continue;
    if (key === "failToPassTests" && !hasResolutionRate) continue;
    if (key === "passToPassTests" && !hasResolutionRate) continue;
    applicable[key] = weight;
  }
  return applicable;
}

/**
 * Normalize weights so they sum to 1.0.
 * Returns the input unchanged if the total is <= 0.
 */
export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const total = Object.values(weights).reduce((sum, v) => sum + v, 0);
  if (total <= 0) {
    return weights;
  }
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]));
}

/**
 * Full pipeline: migrate → filter → normalize.
 * This is the main entry point used by computeCompositeScore.
 *
 * IMPORTANT: Weight redistribution means different results within the same run
 * may be scored with different weight distributions. For example, if result A
 * has tokenEfficiencyScore but result B does not, the "tokenEfficiency" weight
 * is removed from B's scoring and redistributed to other components.
 *
 * This is intentional: it ensures each result is scored on the dimensions where
 * it has data, rather than penalizing results for missing optional metrics.
 * The trade-off is that cross-result score comparisons are not strictly apples-to-apples
 * when results have different data availability.
 */
export function normalizeApplicableWeights(
  weights: Record<string, number>,
  result: BenchmarkRun["results"][number],
  run: BenchmarkRun
): Record<string, number> {
  const migrated = migrateLegacyWeights(weights);
  const applicable = filterApplicableWeights(migrated, result, run);
  return normalizeWeights(applicable);
}
