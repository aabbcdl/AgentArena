/**
 * Scoring system for AgentArena benchmark results.
 *
 * Single source of truth for composite scoring.
 * The frontend (view-model/scoring.js) defers to pre-computed scores from
 * `enrichRunWithScores()` and only recomputes when the user dynamically
 * adjusts weights in the UI.
 *
 * Design inspiration:
 * - Issue Resolution mode → Inspired by SWE-Bench (MIT License)
 * - Efficiency First mode → Inspired by industry best practices
 * - Rotating Tasks mode → Inspired by LiveBench (Apache 2.0)
 *
 * Implementation is fully independent with no official affiliation.
 */

import type { BenchmarkRun } from "@agentarena/core";
import { getDefaultWeights } from "@agentarena/core";
import { findJudgeByType, hasScoreMetadata, type ScoredRun } from "./report-helpers.js";

// ---------------------------------------------------------------------------
// Individual metric helpers (shared by both score computation & score reasons)
// ---------------------------------------------------------------------------

/**
 * Test pass ratio from judge results.
 * Returns 0 if no test judge is present or judge has no totalCount.
 * Returns 1 if judge.success is true but totalCount is 0 (edge: no tests, but judge passed).
 */
function testPassRatio(result: BenchmarkRun["results"][number]): number {
  const judge = findJudgeByType(result, "test-result");
  if (!judge || typeof judge.totalCount !== "number") {
    return judge?.success ? 1 : 0;
  }
  return judge.totalCount > 0 ? (judge.passedCount ?? 0) / judge.totalCount : judge.success ? 1 : 0;
}

/**
 * Critical judge pass ratio.
 * Returns 1 when there are no critical judges (vacuously true: all 0 of 0 passed).
 */
function criticalJudgePassRatio(result: BenchmarkRun["results"][number]): number {
  const criticalJudges = result.judgeResults.filter((j) => j.critical === true);
  if (criticalJudges.length === 0) {
    return 1;
  }
  return criticalJudges.filter((j) => j.success).length / criticalJudges.length;
}

/**
 * Non-critical judge pass ratio.
 * Returns 1 when there are no non-critical judges (vacuously true).
 */
function nonCriticalJudgePassRatio(result: BenchmarkRun["results"][number]): number {
  const nonCriticalJudges = result.judgeResults.filter((j) => j.critical !== true);
  if (nonCriticalJudges.length === 0) {
    return 1;
  }
  return nonCriticalJudges.filter((j) => j.success).length / nonCriticalJudges.length;
}

/** Whether any critical judge failed. */
function hasCriticalJudgeFailure(result: BenchmarkRun["results"][number]): boolean {
  return result.judgeResults.some((j) => j.critical === true && !j.success);
}

/**
 * fail-to-pass score (Issue Resolution mode).
 * Uses patch-validation judge success rate as proxy.
 * Returns 0 when no patch-validation judges exist.
 */
function failToPassScore(result: BenchmarkRun["results"][number]): number {
  const patchValidationJudges = (result.judgeResults ?? []).filter(j => j.type === "patch-validation");
  if (patchValidationJudges.length === 0) return 0;
  return patchValidationJudges.filter(j => j.success).length / patchValidationJudges.length;
}

/**
 * pass-to-pass score (Issue Resolution mode).
 * Returns 0 when no test judge data exists.
 */
function passToPassScore(result: BenchmarkRun["results"][number]): number {
  const patchValidation = result.sweBench?.patchValidationResult;
  if (patchValidation?.passToPassResults && patchValidation.passToPassResults.length > 0) {
    const passed = patchValidation.passToPassResults.filter(r => r.status === "pass").length;
    return passed / patchValidation.passToPassResults.length;
  }
  const judge = findJudgeByType(result, "test-result");
  if (!judge || typeof judge.totalCount !== "number" || judge.totalCount === 0) {
    return 0;
  }
  return (judge.passedCount ?? 0) / judge.totalCount;
}

/**
 * Lint quality score: 1 / (1 + errors*10 + warnings).
 * Returns 0 when no lint judge is present.
 */
function lintQualityScore(result: BenchmarkRun["results"][number]): number {
  const judge = findJudgeByType(result, "lint-check");
  if (!judge) {
    return 0;
  }
  const errors = judge.errorCount ?? 0;
  const warnings = judge.warningCount ?? 0;
  return 1 / (1 + errors * 10 + warnings);
}

/** Duration efficiency: fastest / this result's duration (0–1, higher is better). */
function durationEfficiencyScore(result: BenchmarkRun["results"][number], run: BenchmarkRun): number {
  const durations = run.results.map((entry) => entry.durationMs).filter((value) => value > 0);
  if (durations.length === 0) {
    return 0;
  }
  const fastest = Math.min(...durations);
  return fastest / Math.max(result.durationMs, fastest);
}

/** Cost efficiency: cheapest / this result's cost (0–1, higher is better). */
function costEfficiencyScore(result: BenchmarkRun["results"][number], run: BenchmarkRun): number {
  const costs = run.results.filter((entry) => entry.costKnown && entry.estimatedCostUsd > 0).map((entry) => entry.estimatedCostUsd);
  if (!result.costKnown || result.estimatedCostUsd <= 0 || costs.length === 0) {
    return 0;
  }
  const cheapest = Math.min(...costs);
  return cheapest / Math.max(result.estimatedCostUsd, cheapest);
}

/**
 * Precision score: only applicable when task defines expectedChangedPaths.
 * Returns 0 when not applicable.
 */
function precisionScore(result: BenchmarkRun["results"][number], run: BenchmarkRun): number {
  const hasExpectedPaths = run.task.expectedChangedPaths && run.task.expectedChangedPaths.length > 0;
  if (!hasExpectedPaths) {
    return 0;
  }
  return Math.max(result.diffPrecision?.score ?? 0, 0);
}

/** Resolution rate score (Issue Resolution mode). Falls back to status boolean. */
function resolutionRateScore(result: BenchmarkRun["results"][number]): number {
  return result.sweBench?.resolutionRate ?? (result.status === "success" ? 1 : 0);
}

/** Token efficiency score component (Efficiency First / Comprehensive modes). */
function tokenEfficiencyScoreComponent(result: BenchmarkRun["results"][number]): number {
  return result.tokenEfficiencyScore ?? 0;
}

/** Acceptance rate score (Efficiency First mode). */
function acceptanceRateScore(result: BenchmarkRun["results"][number]): number {
  return result.cursorBench?.acceptanceRate ?? 0;
}

/** Category score (Rotating Tasks mode). Full mark on success. */
function categoryScore(result: BenchmarkRun["results"][number]): number {
  return result.status === "success" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Score component computation (shared by computeCompositeScore & frontend)
// ---------------------------------------------------------------------------

/**
 * Compute all individual score components for a result within a run.
 * This is the single source of truth for component values.
 * Both backend scoring and frontend dynamic re-scoring use this.
 */
export function computeScoreComponents(
  result: BenchmarkRun["results"][number],
  run: BenchmarkRun
): {
  status: number;
  tests: number;
  criticalJudges: number;
  nonCriticalJudges: number;
  lint: number;
  precision: number;
  duration: number;
  cost: number;
  resolutionRate: number;
  tokenEfficiency: number;
  acceptanceRate: number;
  categoryScore: number;
  failToPassTests: number;
  passToPassTests: number;
} {
  return {
    status: result.status === "success" ? 1 : 0,
    tests: testPassRatio(result),
    criticalJudges: criticalJudgePassRatio(result),
    nonCriticalJudges: nonCriticalJudgePassRatio(result),
    lint: lintQualityScore(result),
    precision: precisionScore(result, run),
    duration: durationEfficiencyScore(result, run),
    cost: costEfficiencyScore(result, run),
    resolutionRate: resolutionRateScore(result),
    tokenEfficiency: tokenEfficiencyScoreComponent(result),
    acceptanceRate: acceptanceRateScore(result),
    categoryScore: categoryScore(result),
    failToPassTests: failToPassScore(result),
    passToPassTests: passToPassScore(result)
  };
}

/**
 * Filter weights to only include applicable keys, then normalize to sum=1.
 * Applicability rules:
 * - "precision" only if task defines expectedChangedPaths
 * - "tokenEfficiency" only if result has tokenEfficiencyScore
 * - "resolutionRate" / "failToPassTests" / "passToPassTests" only if result has sweBench.resolutionRate
 * - "acceptanceRate" only if result has cursorBench.acceptanceRate
 */
export function normalizeApplicableWeights(
  weights: Record<string, number>,
  result: BenchmarkRun["results"][number],
  run: BenchmarkRun
): Record<string, number> {
  // Compatibility: migrate legacy "judges" key → criticalJudges + nonCriticalJudges
  const migratedWeights: Record<string, number> = {};
  for (const [key, weight] of Object.entries(weights)) {
    if (key === "judges") {
      // Split legacy "judges" weight 2:1 into critical:nonCritical
      if (!weights.criticalJudges) migratedWeights.criticalJudges = weight * (2 / 3);
      if (!weights.nonCriticalJudges) migratedWeights.nonCriticalJudges = weight * (1 / 3);
    } else {
      migratedWeights[key] = weight;
    }
  }

  const applicableWeights: Record<string, number> = {};
  const isPrecisionApplicable = run.task.expectedChangedPaths && run.task.expectedChangedPaths.length > 0;
  const hasTokenEfficiency = result.tokenEfficiencyScore !== undefined;
  const hasResolutionRate = result.sweBench?.resolutionRate !== undefined;
  const hasAcceptanceRate = result.cursorBench?.acceptanceRate !== undefined;

  for (const [key, weight] of Object.entries(migratedWeights)) {
    if (key === "precision" && !isPrecisionApplicable) continue;
    if (key === "tokenEfficiency" && !hasTokenEfficiency) continue;
    if (key === "resolutionRate" && !hasResolutionRate) continue;
    if (key === "acceptanceRate" && !hasAcceptanceRate) continue;
    if (key === "failToPassTests" && !hasResolutionRate) continue;
    if (key === "passToPassTests" && !hasResolutionRate) continue;
    applicableWeights[key] = weight;
  }

  // Normalize so weights sum to 1
  const total = Object.values(applicableWeights).reduce((sum, v) => sum + v, 0);
  if (total <= 0) {
    return applicableWeights;
  }
  return Object.fromEntries(Object.entries(applicableWeights).map(([k, v]) => [k, v / total]));
}

// ---------------------------------------------------------------------------
// Score band constants (used by both backend and frontend)
// ---------------------------------------------------------------------------

/** Score band for failed runs: 10–40 */
export const FAILED_SCORE_BAND = { min: 10, max: 40 } as const;
/** Score band for runs with critical judge failures: 50–70 */
export const CRITICAL_FAIL_SCORE_BAND = { min: 50, max: 70 } as const;

// ---------------------------------------------------------------------------
// Composite scoring
// ---------------------------------------------------------------------------

/**
 * Compute composite score for a result within a run.
 *
 * Core rules:
 * 1. Failed run → pressed into FAILED_SCORE_BAND (10–40)
 * 2. Critical judge failure → pressed into CRITICAL_FAIL_SCORE_BAND (50–70)
 * 3. Completed run → weighted linear combination, mapped to 0–100
 */
export function computeCompositeScore(
  result: BenchmarkRun["results"][number],
  run: BenchmarkRun,
  scoreWeights?: Record<string, number>,
  scoreMode?: string
): number {
  const weights = scoreWeights ?? getDefaultWeights(scoreMode ?? "practical");

  // Rule 1: Failed run → failed band
  if (result.status !== "success") {
    const baseScore = FAILED_SCORE_BAND.min;
    const efficiencyBonus = (
      durationEfficiencyScore(result, run) * 0.3 +
      costEfficiencyScore(result, run) * 0.2
    );
    return Math.round(Math.min(FAILED_SCORE_BAND.max, baseScore + efficiencyBonus * 100) * 10) / 10;
  }

  const components = computeScoreComponents(result, run);

  // Rule 2: Critical judge failure → partial band (use user weights)
  if (hasCriticalJudgeFailure(result)) {
    const n = normalizeApplicableWeights(weights, result, run);
    const weightedPartial =
      components.tests * (n.tests ?? 0) +
      components.nonCriticalJudges * (n.nonCriticalJudges ?? 0) +
      components.lint * (n.lint ?? 0) +
      components.precision * (n.precision ?? 0) +
      components.duration * (n.duration ?? 0) +
      components.cost * (n.cost ?? 0);
    const bandRange = CRITICAL_FAIL_SCORE_BAND.max - CRITICAL_FAIL_SCORE_BAND.min;
    const baseScore = CRITICAL_FAIL_SCORE_BAND.min + weightedPartial * bandRange;
    return Math.round(Math.min(CRITICAL_FAIL_SCORE_BAND.max, baseScore) * 10) / 10;
  }

  // Rule 3: Completed — weighted sum
  const n = normalizeApplicableWeights(weights, result, run);

  const weightedScore =
    components.status * (n.status ?? 0) +
    components.tests * (n.tests ?? 0) +
    components.criticalJudges * (n.criticalJudges ?? 0) +
    components.nonCriticalJudges * (n.nonCriticalJudges ?? 0) +
    components.lint * (n.lint ?? 0) +
    components.precision * (n.precision ?? 0) +
    components.duration * (n.duration ?? 0) +
    components.cost * (n.cost ?? 0) +
    components.resolutionRate * (n.resolutionRate ?? 0) +
    components.tokenEfficiency * (n.tokenEfficiency ?? 0) +
    components.acceptanceRate * (n.acceptanceRate ?? 0) +
    components.categoryScore * (n.categoryScore ?? 0) +
    components.failToPassTests * (n.failToPassTests ?? 0) +
    components.passToPassTests * (n.passToPassTests ?? 0);

  // Map to 0–100 scale
  const finalScore = weightedScore * 100;
  return Math.round(finalScore * 10) / 10;
}

/**
 * Compute score reasons — why a result scored well (or not).
 */
export function computeScoreReasons(result: BenchmarkRun["results"][number], run: BenchmarkRun): string[] {
  const reasons: string[] = [];

  if (result.status !== "success") {
    reasons.push("failed");
    return reasons;
  }

  if (hasCriticalJudgeFailure(result)) {
    reasons.push("critical-judge-failed");
  }

  const components = computeScoreComponents(result, run);

  if (components.tests >= 0.999) reasons.push("tests");
  if (components.criticalJudges >= 0.999) reasons.push("critical-judges");
  if (components.nonCriticalJudges >= 0.999) reasons.push("non-critical-judges");
  if (components.lint >= 0.999) reasons.push("lint");
  if (components.precision >= 0.999) reasons.push("precision");
  if (components.duration >= 0.999) reasons.push("duration");
  if (components.cost >= 0.999) reasons.push("cost");
  if (components.resolutionRate > 0.95) reasons.push("resolution-rate-high");
  if (components.tokenEfficiency > 0.95) reasons.push("token-efficiency-good");
  if (components.acceptanceRate > 0.95) reasons.push("acceptance-rate-high");

  return reasons;
}

/**
 * Enrich a run with computed scores.
 * This is the main entry point called by the report pipeline.
 */
export function enrichRunWithScores(run: BenchmarkRun): ScoredRun {
  const scoreMode = hasScoreMetadata(run) ? (run.scoreMode ?? "practical") : "practical";
  const scoreWeights = (hasScoreMetadata(run) ? run.scoreWeights : undefined) ?? getDefaultWeights(scoreMode);

  return {
    ...run,
    scoreMode,
    scoreWeights,
    scoreScope: run.scoreScope ?? "run-local",
    scoreValidityNote:
      run.scoreValidityNote ??
      "Scores only compare variants inside this run. Treat them as local rankings for the current agent version, model, and provider settings.",
    results: run.results.map((result) => ({
      ...result,
      compositeScore: computeCompositeScore(result, run, scoreWeights, scoreMode),
      scoreReasons: computeScoreReasons(result, run)
    }))
  };
}
