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

import type { BenchmarkRun, ScoreMode } from "@agentarena/core";
import { getDefaultWeights, isScoreMode } from "@agentarena/core";
import { hasScoreMetadata, type ScoredRun } from "./report-helpers.js";
import {
  acceptanceRateScore,
  categoryScore,
  costEfficiencyScore,
  criticalJudgePassRatio,
  durationEfficiencyScore,
  failToPassScore,
  hasCriticalJudgeFailure,
  lintQualityScore,
  nonCriticalJudgePassRatio,
  passToPassScore,
  precisionScore,
  resolutionRateScore,
  testPassRatio,
  tokenEfficiencyScoreComponent,
} from "./score-metrics.js";
import { normalizeApplicableWeights } from "./score-weights.js";

export { hasCriticalJudgeFailure } from "./score-metrics.js";
// Re-export for backward compatibility
export { normalizeApplicableWeights } from "./score-weights.js";

export function isScoreExcluded(result: BenchmarkRun["results"][number]): boolean {
  return result.scoreExcluded === true;
}

function isExecutionCompleted(result: BenchmarkRun["results"][number]): boolean {
  return result.executionStatus === undefined
    ? result.status === "success"
    : result.executionStatus === "completed";
}

// ---------------------------------------------------------------------------
// Score band constants (used by both backend and frontend)
// ---------------------------------------------------------------------------

/**
 * Score band for failed runs: 10–40.
 *
 * Rationale: Failed runs should score below passing runs (50+) but not zero,
 * because some partial work may still have value (e.g., correct approach but
 * wrong implementation). The 10–40 range leaves room for efficiency bonuses
 * to differentiate between "barely tried" and "almost succeeded" failures.
 *
 * SCORING_VERSION history: v1-v4 used different bands and weight formulas.
 * v5 is the current version (frozen at 0.1.0 per STABILITY.md).
 */
export const FAILED_SCORE_BAND = { min: 10, max: 40 } as const;

/**
 * Score band for runs with critical judge failures: 50–70.
 *
 * Rationale: These runs technically succeeded (exit code 0) but failed critical
 * validation (e.g., tests broken, security issues). They should score below
 * fully passing runs (70+) but above failures (40). The 50–70 range reflects
 * "partially successful" — the agent did something right but missed critical checks.
 */
export const CRITICAL_FAIL_SCORE_BAND = { min: 50, max: 70 } as const;

// ---------------------------------------------------------------------------
// Scoring weights and thresholds
// ---------------------------------------------------------------------------

/** Duration efficiency weight in failed-run bonus calculation */
const FAILED_DURATION_WEIGHT = 0.3;
/** Cost efficiency weight in failed-run bonus calculation */
const FAILED_COST_WEIGHT = 0.2;
/** Scale factor to map efficiency bonus (0-0.5) into score points (0-50) */
const FAILED_EFFICIENCY_SCALE = 100;

/** Threshold for "perfect" score reason tags (≥ 99.9%) */
const SCORE_PERFECT_THRESHOLD = 0.999;
/** Threshold for "high" score reason tags (> 95%) */
const SCORE_HIGH_THRESHOLD = 0.95;

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
 *
 * @param precomputedComponents - When caller already has components (e.g. from
 *   `enrichRunWithScores`), pass them in to avoid recomputing the same values
 *   twice. Falls back to `computeScoreComponents(result, run)` when omitted.
 */
export function computeCompositeScore(
  result: BenchmarkRun["results"][number],
  run: BenchmarkRun,
  scoreWeights?: Record<string, number>,
  scoreMode?: ScoreMode,
  precomputedComponents?: ReturnType<typeof computeScoreComponents>
): number {
  if (isScoreExcluded(result)) {
    return 0;
  }

  const weights = scoreWeights ?? getDefaultWeights(scoreMode ?? "practical");

  // Rule 1: Failed run → failed band
  if (!isExecutionCompleted(result)) {
    const baseScore = FAILED_SCORE_BAND.min;
    const efficiencyBonus = (
      durationEfficiencyScore(result, run) * FAILED_DURATION_WEIGHT +
      costEfficiencyScore(result, run) * FAILED_COST_WEIGHT
    );
    return Math.round(Math.min(FAILED_SCORE_BAND.max, baseScore + efficiencyBonus * FAILED_EFFICIENCY_SCALE) * 10) / 10;
  }

  const components = precomputedComponents ?? computeScoreComponents(result, run);

  // Rule 2: Critical judge failure → partial band (use only applicable non-critical weights)
  if (hasCriticalJudgeFailure(result)) {
    // Build partial weights from ONLY the six components the partial score sums,
    // then apply the same applicability filtering as Rule 3. Previously this
    // included every non-status/criticalJudges weight (resolutionRate,
    // tokenEfficiency, …) in the denominator while the numerator summed only
    // six components, deflating the score and diverging from the frontend's
    // getCompositeScoreDetails (which this must match — see scoring.js Rule 2).
    const partialWeightKeys = ["tests", "nonCriticalJudges", "lint", "precision", "duration", "cost"];
    const rawPartialWeights: Record<string, number> = {};
    for (const key of partialWeightKeys) {
      if (weights[key] !== undefined) {
        rawPartialWeights[key] = weights[key];
      }
    }
    const n = normalizeApplicableWeights(rawPartialWeights, result, run);
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

  if (isScoreExcluded(result)) {
    return [result.scoreExclusionReason ?? "not-comparable"];
  }

  if (!isExecutionCompleted(result)) {
    reasons.push("failed");
    return reasons;
  }

  if (hasCriticalJudgeFailure(result)) {
    reasons.push("critical-judge-failed");
  }

  const components = computeScoreComponents(result, run);

  if (components.tests >= SCORE_PERFECT_THRESHOLD) reasons.push("tests");
  if (components.criticalJudges >= SCORE_PERFECT_THRESHOLD) reasons.push("critical-judges");
  if (components.nonCriticalJudges >= SCORE_PERFECT_THRESHOLD) reasons.push("non-critical-judges");
  if (components.lint >= SCORE_PERFECT_THRESHOLD) reasons.push("lint");
  if (components.precision >= SCORE_PERFECT_THRESHOLD) reasons.push("precision");
  if (components.duration >= SCORE_PERFECT_THRESHOLD) reasons.push("duration");
  if (components.cost >= SCORE_PERFECT_THRESHOLD) reasons.push("cost");
  if (components.resolutionRate > SCORE_HIGH_THRESHOLD) reasons.push("resolution-rate-high");
  if (components.tokenEfficiency > SCORE_HIGH_THRESHOLD) reasons.push("token-efficiency-good");
  if (components.acceptanceRate > SCORE_HIGH_THRESHOLD) reasons.push("acceptance-rate-high");

  return reasons;
}

/**
 * Enrich a run with computed scores.
 * This is the main entry point called by the report pipeline.
 *
 * The per-result `scoreComponents` are computed once here and serialized into
 * summary.json. They are the single source of truth for the component values;
 * the frontend reads them and only performs the weighted aggregation locally
 * when the user adjusts weights in the UI. This eliminates the previous
 * dual-source-of-truth where backend and frontend each recomputed components
 * independently (and could silently diverge).
 */
export function enrichRunWithScores(run: BenchmarkRun): ScoredRun {
  const rawMode = hasScoreMetadata(run) ? run.scoreMode : undefined;
  const scoreMode: ScoreMode = (rawMode && isScoreMode(rawMode)) ? rawMode : "practical";
  const scoreWeights = (hasScoreMetadata(run) ? run.scoreWeights : undefined) ?? getDefaultWeights(scoreMode);

  return {
    ...run,
    scoreMode,
    scoreWeights,
    scoreScope: run.scoreScope ?? "run-local",
    scoreValidityNote:
      run.scoreValidityNote ??
      "Scores only compare variants inside this run. Treat them as local rankings for the current agent version, model, and provider settings.",
    results: run.results.map((result) => {
      if (isScoreExcluded(result)) {
        return { ...result, compositeScore: undefined, scoreReasons: computeScoreReasons(result, run) };
      }
      // Compute components once, reuse for both compositeScore and storage.
      const components = computeScoreComponents(result, run);
      return {
        ...result,
        scoreComponents: components,
        compositeScore: computeCompositeScore(result, run, scoreWeights, scoreMode, components),
        scoreReasons: computeScoreReasons(result, run)
      };
    })
  };
}
