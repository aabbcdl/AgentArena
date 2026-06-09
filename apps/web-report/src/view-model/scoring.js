/**
 * @module view-model/scoring
 *
 * Score weights, presets, composite scoring, and metric formatting.
 *
 * IMPORTANT: The backend (packages/report/scoring.ts) is the single source of
 * truth for scoring. Runs loaded from summary.json already have `compositeScore`
 * and `scoreReasons` pre-computed by `enrichRunWithScores()`.
 *
 * This module provides:
 * 1. Weight preset data + helpers (used by the UI slider controls)
 * 2. Dynamic re-computation when users adjust weights in the UI
 * 3. Metric formatting helpers (findJudgeByType, formatTestMetric, etc.)
 *
 * The scoring logic (component computation, band rules, normalization) is
 * intentionally kept in sync with the backend (packages/report/src/scoring.ts).
 * When the backend changes, this module must be updated accordingly.
 *
 * CRITICAL SYNC POINTS (frontend must match backend exactly):
 * - FAILED_EFFICIENCY_SCALE = 100 (used in Rule 1 failed band)
 * - CRITICAL_FAIL_SCORE_BAND = { min: 50, max: 70 } (Rule 2 critical-fail band)
 * - Rule 2 uses normalizeApplicableWeights with user's active weights, NOT hardcoded multipliers
 * - Rule 3 uses normalizeApplicableWeights with the full weight set
 * - All band constants come from @agentarena/core (FAILED_SCORE_BAND, CRITICAL_FAIL_SCORE_BAND)
 */

/**
 * @typedef {Record<string, number>} ScoreWeights
 */

/**
 * @typedef {Object} CompositeScoreResult
 * @property {number} total - Weighted composite score (0–100 scale)
 * @property {ScoreWeights} weights - Normalized weights used
 * @property {Object} components - Individual component scores (0–1 scale)
 */

// ---------------------------------------------------------------------------
// Weight presets — mirrors packages/core/src/scoring-weights.ts
// Consistency is guarded by automated tests in tests/scoring.test.mjs
// ---------------------------------------------------------------------------

/** @type {ScoreWeights} */
export const DEFAULT_SCORE_WEIGHTS = Object.freeze({
  status: 0.24,
  tests: 0.26,
  criticalJudges: 0.20,
  nonCriticalJudges: 0.08,
  precision: 0.05,
  lint: 0.03,
  duration: 0.08,
  cost: 0.06
});

/** @type {Record<string, ScoreWeights>} */
export const SCORE_WEIGHT_PRESETS = Object.freeze({
  practical: Object.freeze({
    status: 0.24,
    tests: 0.26,
    criticalJudges: 0.20,
    nonCriticalJudges: 0.08,
    precision: 0.05,
    lint: 0.03,
    duration: 0.08,
    cost: 0.06
  }),
  balanced: Object.freeze({
    status: 0.30,
    tests: 0.25,
    criticalJudges: 0.10,
    nonCriticalJudges: 0.05,
    lint: 0.10,
    precision: 0.10,
    duration: 0.06,
    cost: 0.04
  }),
  "issue-resolution": Object.freeze({
    status: 0.15,
    resolutionRate: 0.45,
    failToPassTests: 0.20,
    passToPassTests: 0.15,
    duration: 0.05
  }),
  "efficiency-first": Object.freeze({
    status: 0.20,
    tests: 0.15,
    criticalJudges: 0.15,
    tokenEfficiency: 0.25,
    acceptanceRate: 0.10,
    duration: 0.10,
    cost: 0.05
  }),
  "rotating-tasks": Object.freeze({
    status: 0.20,
    tests: 0.20,
    criticalJudges: 0.20,
    categoryScore: 0.20,
    duration: 0.10,
    cost: 0.10
  }),
  comprehensive: Object.freeze({
    status: 0.12,
    tests: 0.15,
    criticalJudges: 0.10,
    nonCriticalJudges: 0.05,
    resolutionRate: 0.12,
    tokenEfficiency: 0.08,
    categoryScore: 0.08,
    duration: 0.15,
    cost: 0.15,
    precision: 0.05,
    lint: 0.05
  })
});

/** @type {Record<string, ScoreWeights>} */
export const DEPRECATED_SCORE_PRESETS = Object.freeze({
  "correctness-first": Object.freeze({ status: 0.20, tests: 0.30, criticalJudges: 0.25, nonCriticalJudges: 0.10, duration: 0.10, cost: 0.05 }),
  "speed-first": Object.freeze({ status: 0.12, tests: 0.08, criticalJudges: 0.05, nonCriticalJudges: 0.03, lint: 0.02, precision: 0.02, duration: 0.48, cost: 0.2 }),
  "cost-first": Object.freeze({ status: 0.12, tests: 0.1, criticalJudges: 0.05, nonCriticalJudges: 0.03, lint: 0.05, precision: 0.05, duration: 0.1, cost: 0.5 }),
  "scope-discipline": Object.freeze({ status: 0.14, tests: 0.1, criticalJudges: 0.05, nonCriticalJudges: 0.03, lint: 0.06, precision: 0.56, duration: 0.03, cost: 0.03 })
});

/**
 * Get a score weight preset by id, falling back to "practical".
 * @param {string} [presetId]
 * @returns {ScoreWeights}
 */
export function getScoreWeightPreset(presetId = "practical") {
  if (SCORE_WEIGHT_PRESETS[presetId]) {
    return SCORE_WEIGHT_PRESETS[presetId];
  }
  if (DEPRECATED_SCORE_PRESETS[presetId]) {
    return DEPRECATED_SCORE_PRESETS[presetId];
  }
  return SCORE_WEIGHT_PRESETS.practical;
}

/**
 * Find the preset id that matches the given weights (within tolerance).
 * @param {ScoreWeights} [weights]
 * @returns {string | null}
 */
export function getMatchingScorePresetId(weights = DEFAULT_SCORE_WEIGHTS) {
  const normalized = normalizeScoreWeights(weights);
  return (
    Object.entries(SCORE_WEIGHT_PRESETS).find(([, preset]) => {
      const normalizedPreset = normalizeScoreWeights(/** @type {ScoreWeights} */ (preset));
      const presetKeys = Object.keys(normalizedPreset);
      const normKeys = Object.keys(normalized);
      if (presetKeys.length !== normKeys.length) return false;
      return presetKeys.every((key) => Math.abs(normalizedPreset[key] - (normalized[key] ?? 0)) < 0.001);
    })?.[0] ?? null
  );
}

/**
 * Normalize score weights so they sum to 1.0, filling missing keys from defaults.
 * @param {ScoreWeights} [weights]
 * @returns {ScoreWeights}
 */
export function normalizeScoreWeights(weights = DEFAULT_SCORE_WEIGHTS) {
  const merged = {
    ...DEFAULT_SCORE_WEIGHTS,
    ...(weights ?? {})
  };
  const sanitized = Object.fromEntries(
    Object.entries(merged).map(([key, value]) => [key, Number.isFinite(value) && value >= 0 ? value : 0])
  );
  const total = Object.values(sanitized).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return { ...DEFAULT_SCORE_WEIGHTS };
  }
  return Object.fromEntries(Object.entries(sanitized).map(([key, value]) => [key, value / total]));
}

/**
 * Get all available score presets (active + deprecated).
 * @returns {Record<string, ScoreWeights>}
 */
export function getAllScorePresets() {
  return { ...SCORE_WEIGHT_PRESETS, ...DEPRECATED_SCORE_PRESETS };
}

// ---------------------------------------------------------------------------
// Individual metric helpers (formatting + lookup)
// ---------------------------------------------------------------------------

/**
 * Ratio of passed judges to total judges for a result.
 * @param {Object} result
 * @param {Array} result.judgeResults
 * @returns {number}
 */
export function judgePassRatio(result) {
  if (result.judgeResults.length === 0) {
    return 0;
  }
  return result.judgeResults.filter((judge) => judge.success).length / result.judgeResults.length;
}

/**
 * Diff precision score, or -1 if not available.
 * @param {Object} result
 * @param {Object} [result.diffPrecision]
 * @param {number} [result.diffPrecision.score]
 * @returns {number}
 */
export function diffPrecisionScore(result) {
  return typeof result.diffPrecision?.score === "number" ? result.diffPrecision.score : -1;
}

/**
 * Find the first judge result matching the given type.
 * @param {Object} result
 * @param {Array} result.judgeResults
 * @param {string} type
 * @returns {Object|null}
 */
export function findJudgeByType(result, type) {
  return result.judgeResults.find((judge) => judge.type === type) ?? null;
}

/**
 * Format test metric as "passed/total" string.
 * @param {Object} result
 * @returns {string}
 */
export function formatTestMetric(result) {
  const judge = findJudgeByType(result, "test-result");
  if (!judge || typeof judge.totalCount !== "number") {
    return "n/a";
  }
  return `${judge.passedCount ?? 0}/${judge.totalCount}`;
}

/**
 * Format lint metric as "errorsE/warningsW" string.
 * @param {Object} result
 * @returns {string}
 */
export function formatLintMetric(result) {
  const judge = findJudgeByType(result, "lint-check");
  if (!judge) {
    return "n/a";
  }
  return `${judge.errorCount ?? 0}E/${judge.warningCount ?? 0}W`;
}

/**
 * Format diff precision as a percentage string.
 * @param {Object} result
 * @returns {string}
 */
export function formatDiffPrecisionMetric(result) {
  if (typeof result.diffPrecision?.score !== "number") {
    return "n/a";
  }
  return `${Math.round(result.diffPrecision.score * 100)}%`;
}

// ---------------------------------------------------------------------------
// Score component computation — mirrors backend report/scoring.ts exactly
// ---------------------------------------------------------------------------

/**
 * Score band constants — must match backend FAILED_SCORE_BAND / CRITICAL_FAIL_SCORE_BAND.
 */
const FAILED_SCORE_BAND = { min: 10, max: 40 };
const CRITICAL_FAIL_SCORE_BAND = { min: 50, max: 70 };

export function isScoreExcluded(result) {
  return result?.scoreExcluded === true;
}

/**
 * Weighted pass ratio for a set of judges: Σ(weightᵢ·passedᵢ) / Σ(weightᵢ),
 * using `weight ?? 1`. Returns 1 for an empty set (vacuously true).
 * Mirrors `weightedJudgePassRatio` in packages/report/src/score-metrics.ts.
 * @param {Array<{success?: boolean, weight?: number}>} judges
 * @returns {number}
 */
function weightedJudgePassRatio(judges) {
  if (judges.length === 0) {
    return 1;
  }
  let weightedPassed = 0;
  let totalWeight = 0;
  for (const judge of judges) {
    const weight = judge.weight ?? 1;
    totalWeight += weight;
    if (judge.success) {
      weightedPassed += weight;
    }
  }
  return totalWeight > 0 ? weightedPassed / totalWeight : 1;
}

/**
 * Compute all individual score components for a result within a run.
 * Mirrors `computeScoreComponents()` from packages/report/src/scoring.ts.
 * @param {Object} result
 * @param {Object} run
 * @returns {Object}
 */
export function computeScoreComponents(result, run) {
  const testJudge = findJudgeByType(result, "test-result");
  const lintJudge = findJudgeByType(result, "lint-check");
  const patchJudges = (result.judgeResults ?? []).filter(j => j.type === "patch-validation");

  // testPassRatio
  let testsScore = 0;
  if (testJudge && typeof testJudge.totalCount === "number") {
    testsScore = testJudge.totalCount > 0 ? (testJudge.passedCount ?? 0) / testJudge.totalCount : testJudge.success ? 1 : 0;
  } else if (testJudge?.success) {
    testsScore = 1;
  }

  // criticalJudgePassRatio (weight-based — mirrors backend score-metrics.ts)
  const criticalJudges = result.judgeResults.filter(j => j.critical === true);
  const criticalJudgesScore = weightedJudgePassRatio(criticalJudges);

  // nonCriticalJudgePassRatio (weight-based — mirrors backend score-metrics.ts)
  const nonCriticalJudges = result.judgeResults.filter(j => j.critical !== true);
  const nonCriticalJudgesScore = weightedJudgePassRatio(nonCriticalJudges);

  // hasCriticalJudgeFailure
  const hasCriticalFailure = result.judgeResults.some(j => j.critical === true && !j.success);

  // lintQualityScore
  let lintScore = 0;
  if (lintJudge) {
    const errors = lintJudge.errorCount ?? 0;
    const warnings = lintJudge.warningCount ?? 0;
    lintScore = 1 / (1 + errors * 10 + warnings);
  }

  // precisionScore
  const hasExpectedPaths = run.task?.expectedChangedPaths && run.task.expectedChangedPaths.length > 0;
  const precisionScoreVal = hasExpectedPaths ? Math.max(result.diffPrecision?.score ?? 0, 0) : 0;

  // durationEfficiencyScore
  const durations = run.results.map(entry => entry.durationMs).filter(v => v > 0);
  let durationScore = 0;
  if (durations.length > 0) {
    const fastest = Math.min(...durations);
    durationScore = fastest / Math.max(result.durationMs, fastest);
  }

  // costEfficiencyScore
  const costs = run.results.filter(entry => entry.costKnown && entry.estimatedCostUsd > 0).map(entry => entry.estimatedCostUsd);
  let costScore = 0;
  if (result.costKnown && result.estimatedCostUsd > 0 && costs.length > 0) {
    const cheapest = Math.min(...costs);
    costScore = cheapest / Math.max(result.estimatedCostUsd, cheapest);
  }

  // failToPassScore
  const failToPassScoreVal = patchJudges.length === 0 ? 0 : patchJudges.filter(j => j.success).length / patchJudges.length;

  // passToPassScore — uses explicit patch-validation data (matches backend score-metrics.ts)
  const patchValidation = result.sweBench?.patchValidationResult;
  let passToPassScoreVal = 0;
  if (patchValidation?.passToPassResults && patchValidation.passToPassResults.length > 0) {
    const passed = patchValidation.passToPassResults.filter(r => r.status === "pass").length;
    passToPassScoreVal = passed / patchValidation.passToPassResults.length;
  }

  return {
    status: result.status === "success" ? 1 : 0,
    tests: testsScore,
    criticalJudges: criticalJudgesScore,
    nonCriticalJudges: nonCriticalJudgesScore,
    lint: lintScore,
    precision: precisionScoreVal,
    duration: durationScore,
    cost: costScore,
    resolutionRate: result.sweBench?.resolutionRate ?? (result.status === "success" ? 1 : 0),
    tokenEfficiency: result.tokenEfficiencyScore ?? 0,
    acceptanceRate: result.cursorBench?.acceptanceRate ?? 0,
    categoryScore: result.status === "success" ? 1 : 0,
    failToPassTests: failToPassScoreVal,
    passToPassTests: passToPassScoreVal,
    _hasCriticalFailure: hasCriticalFailure
  };
}

/**
 * Normalize weights to only applicable keys, then normalize to sum=1.
 * Mirrors `normalizeApplicableWeights()` from packages/report/src/scoring.ts.
 * @param {ScoreWeights} weights
 * @param {Object} result
 * @param {Object} run
 * @returns {ScoreWeights}
 */
export function normalizeApplicableWeights(weights, result, run) {
  // Compatibility: migrate legacy "judges" key → criticalJudges + nonCriticalJudges
  /** @type {Record<string, number>} */
  const migratedWeights = {};
  for (const [key, weight] of Object.entries(weights)) {
    if (key === "judges") {
      // Split legacy "judges" weight 2:1 into critical:nonCritical
      if (!weights.criticalJudges) migratedWeights.criticalJudges = weight * (2 / 3);
      if (!weights.nonCriticalJudges) migratedWeights.nonCriticalJudges = weight * (1 / 3);
    } else {
      migratedWeights[key] = weight;
    }
  }

  /** @type {Record<string, number>} */
  const applicableWeights = {};
  const isPrecisionApplicable = run.task?.expectedChangedPaths && run.task.expectedChangedPaths.length > 0;
  const hasTokenEfficiency = result.tokenEfficiencyScore !== undefined;
  const hasResolutionRate = result.sweBench?.resolutionRate !== undefined;
  const hasAcceptanceRate = result.cursorBench?.acceptanceRate !== undefined;
  const hasPatchValidation = typeof result.sweBench?.patchValidationResult === "object"
    && result.sweBench?.patchValidationResult !== null;

  // Check if test/lint judges exist
  const hasTestJudge = (result.judgeResults ?? []).some(j => j.type === "test-result");
  const hasLintJudge = (result.judgeResults ?? []).some(j => j.type === "lint-check");

  for (const [key, weight] of Object.entries(migratedWeights)) {
    if (key === "tests" && !hasTestJudge) continue;
    if (key === "lint" && !hasLintJudge) continue;
    if (key === "precision" && !isPrecisionApplicable) continue;
    if (key === "tokenEfficiency" && !hasTokenEfficiency) continue;
    if (key === "resolutionRate" && !hasResolutionRate) continue;
    if (key === "acceptanceRate" && !hasAcceptanceRate) continue;
    if (key === "failToPassTests" && !hasPatchValidation) continue;
    if (key === "passToPassTests" && !hasPatchValidation) continue;
    applicableWeights[key] = weight;
  }

  const total = Object.values(applicableWeights).reduce((sum, v) => sum + v, 0);
  if (total <= 0) {
    return applicableWeights;
  }
  return Object.fromEntries(Object.entries(applicableWeights).map(([k, v]) => [k, v / total]));
}

// ---------------------------------------------------------------------------
// Composite scoring — mirrors backend computeCompositeScore exactly
// ---------------------------------------------------------------------------

/**
 * Compute detailed composite score breakdown for a result within a run.
 *
 * When the user hasn't changed weights, prefer using `result.compositeScore`
 * (pre-computed by the backend). This function is used for dynamic re-scoring
 * when the user adjusts weight sliders.
 *
 * @param {Object} result
 * @param {Object} run
 * @param {ScoreWeights} [weights]
 * @returns {CompositeScoreResult}
 */
export function getCompositeScoreDetails(result, run, weights = DEFAULT_SCORE_WEIGHTS) {
  const components = computeScoreComponents(result, run);
  if (isScoreExcluded(result)) {
    return {
      total: 0,
      weights: normalizeScoreWeights(weights),
      components
    };
  }

  // Rule 1: Failed run → failed band
  if (result.status !== "success") {
    const baseScore = FAILED_SCORE_BAND.min;
    const efficiencyBonus = components.duration * 0.3 + components.cost * 0.2;
    // MUST match backend FAILED_EFFICIENCY_SCALE = 100
    return {
      total: Math.round(Math.min(FAILED_SCORE_BAND.max, baseScore + efficiencyBonus * 100) * 10) / 10,
      weights: normalizeScoreWeights(weights),
      components
    };
  }

  // Rule 2: Critical judge failure → partial band (use only applicable non-critical weights)
  if (components._hasCriticalFailure) {
    // MUST match backend: normalize applicable weights, compute weighted partial, map to band range
    const partialWeightKeys = ["tests", "nonCriticalJudges", "lint", "precision", "duration", "cost"];
    /** @type {Record<string, number>} */
    const rawPartialWeights = {};
    for (const key of partialWeightKeys) {
      if (weights[key] !== undefined) rawPartialWeights[key] = weights[key];
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
    return {
      total: Math.round(Math.min(CRITICAL_FAIL_SCORE_BAND.max, baseScore) * 10) / 10,
      weights: normalizeScoreWeights(weights),
      components
    };
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

  return {
    total: Math.round(weightedScore * 1000) / 10,
    weights: normalizeScoreWeights(weights),
    components
  };
}

function weightsMatchArchivedRun(weights, run) {
  const archivedWeights = run?.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;
  const normalizedCurrent = normalizeScoreWeights(weights);
  const normalizedArchived = normalizeScoreWeights(archivedWeights);
  const keys = new Set([...Object.keys(normalizedCurrent), ...Object.keys(normalizedArchived)]);
  for (const key of keys) {
    if (Math.abs((normalizedCurrent[key] ?? 0) - (normalizedArchived[key] ?? 0)) > 0.0001) {
      return false;
    }
  }
  return true;
}

/**
 * Format composite score as a single decimal string.
 * Prefers pre-computed `result.compositeScore` when available.
 * @param {Object} result
 * @param {Object} run
 * @param {ScoreWeights} [weights]
 * @returns {string}
 */
export function formatCompositeScore(result, run, weights = DEFAULT_SCORE_WEIGHTS) {
  if (isScoreExcluded(result)) {
    return "n/a";
  }
  // Use the archived score only when the active weights match the run's stored
  // scoring weights. Preset identity alone is not enough: switching presets in
  // the UI must re-score the visible report.
  if (typeof result.compositeScore === "number" && weightsMatchArchivedRun(weights, run)) {
    return result.compositeScore.toFixed(1);
  }
  return `${getCompositeScoreDetails(result, run, weights).total.toFixed(1)}`;
}

/**
 * Get human-readable reasons why a result scored well.
 * Prefers pre-computed `result.scoreReasons` when available.
 * @param {Object} result
 * @param {Object} run
 * @param {ScoreWeights} [weights]
 * @returns {string[]}
 */
export function getCompositeScoreReasons(result, run, weights = DEFAULT_SCORE_WEIGHTS) {
  if (isScoreExcluded(result)) {
    return [result.scoreExclusionReason ?? "not-comparable"];
  }

  // Use pre-computed reasons if available and weights match
  if (Array.isArray(result.scoreReasons) && weightsMatchArchivedRun(weights, run)) {
    return result.scoreReasons;
  }

  const components = computeScoreComponents(result, run);
  const reasons = [];

  if (result.status !== "success") {
    reasons.push("failed");
    return reasons;
  }
  if (components._hasCriticalFailure) {
    reasons.push("critical-judge-failed");
  }
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
 * Sort comparator for result quality: composite score → precision → duration.
 * Exported for use by comparison module's getRunVerdict / getCompareResults.
 * @param {Object} left
 * @param {Object} right
 * @param {ScoreWeights} [weights]
 * @returns {number}
 */
export function resultQualitySort(left, right, weights = DEFAULT_SCORE_WEIGHTS) {
  const scopedRun = { results: [left, right] };
  const scoreDelta = getCompositeScoreDetails(right, scopedRun, weights).total - getCompositeScoreDetails(left, scopedRun, weights).total;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  const precisionDelta = diffPrecisionScore(right) - diffPrecisionScore(left);
  if (precisionDelta !== 0) {
    return precisionDelta;
  }
  return left.durationMs - right.durationMs;
}
