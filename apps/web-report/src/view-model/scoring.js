/**
 * @module view-model/scoring
 * Score weights, presets, composite scoring, and metric formatting.
 */

/**
 * @typedef {Record<string, number>} ScoreWeights
 */

/**
 * @typedef {Object} CompositeScoreResult
 * @property {number} total - Weighted composite score (0–100 scale)
 * @property {ScoreWeights} weights - Normalized weights used
 * @property {Object} components - Individual component scores (0–1 scale)
 * @property {number} components.status
 * @property {number} components.tests
 * @property {number} components.criticalJudges
 * @property {number} components.nonCriticalJudges
 * @property {number} components.lint
 * @property {number} components.precision
 * @property {number} components.duration
 * @property {number} components.cost
 * @property {number} components.resolutionRate
 * @property {number} components.tokenEfficiency
 * @property {number} components.acceptanceRate
 * @property {number} components.categoryScore
 */

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
    judges: 0.15,
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
  "speed-first": Object.freeze({ status: 0.12, tests: 0.08, judges: 0.08, lint: 0.02, precision: 0.02, duration: 0.48, cost: 0.2 }),
  "cost-first": Object.freeze({ status: 0.12, tests: 0.1, judges: 0.08, lint: 0.05, precision: 0.05, duration: 0.1, cost: 0.5 }),
  "scope-discipline": Object.freeze({ status: 0.14, tests: 0.1, judges: 0.08, lint: 0.06, precision: 0.56, duration: 0.03, cost: 0.03 })
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
      return Object.keys(normalizedPreset).every((key) => Math.abs(normalizedPreset[key] - normalized[key]) < 0.001);
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
// Individual metric helpers
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
// Private scoring helpers
// ---------------------------------------------------------------------------

/**
 * Duration efficiency: fastest / this result's duration (0–1, higher is better).
 * @param {Object} result
 * @param {Object} run
 * @returns {number}
 */
function durationEfficiencyScore(result, run) {
  const durations = run.results.map((entry) => entry.durationMs).filter((value) => value > 0);
  if (durations.length === 0) {
    return 0;
  }
  const fastest = Math.min(...durations);
  if (fastest <= 0) return 0;
  return fastest / Math.max(result.durationMs, fastest);
}

/**
 * Cost efficiency: cheapest / this result's cost (0–1, higher is better).
 * @param {Object} result
 * @param {Object} run
 * @returns {number}
 */
function costEfficiencyScore(result, run) {
  const costs = run.results.filter((entry) => entry.costKnown && entry.estimatedCostUsd > 0).map((entry) => entry.estimatedCostUsd);
  if (!result.costKnown || result.estimatedCostUsd <= 0 || costs.length === 0) {
    return 0;
  }
  const cheapest = Math.min(...costs);
  if (cheapest <= 0) return 0;
  return cheapest / Math.max(result.estimatedCostUsd, cheapest);
}

/**
 * Test pass ratio from judge results (-1 if no test judge).
 * @param {Object} result
 * @returns {number}
 */
function testPassRatio(result) {
  const judge = findJudgeByType(result, "test-result");
  if (!judge || typeof judge.totalCount !== "number") {
    return -1;
  }
  return judge.totalCount > 0 ? (judge.passedCount ?? 0) / judge.totalCount : judge.success ? 1 : 0;
}

/**
 * Lint quality score: 1 / (1 + errors*10 + warnings).
 * @param {Object} result
 * @returns {number}
 */
function lintQualityScore(result) {
  const judge = findJudgeByType(result, "lint-check");
  if (!judge) {
    return -1;
  }
  const errors = judge.errorCount ?? 0;
  const warnings = judge.warningCount ?? 0;
  return 1 / (1 + errors * 10 + warnings);
}

// ---------------------------------------------------------------------------
// Composite scoring
// ---------------------------------------------------------------------------

/**
 * Compute detailed composite score breakdown for a result within a run.
 * @param {Object} result
 * @param {Object} run
 * @param {ScoreWeights} [weights]
 * @returns {CompositeScoreResult}
 */
export function getCompositeScoreDetails(result, run, weights = DEFAULT_SCORE_WEIGHTS) {
  const normalizedWeights = normalizeScoreWeights(weights);
  const statusScore = result.status === "success" ? 1 : 0;
  const testsScore = Math.max(testPassRatio(result), 0);
  const criticalJudgePassRatio = result.criticalJudgePassRatio ?? judgePassRatio(result);
  const nonCriticalJudgePassRatio = result.nonCriticalJudgePassRatio ?? judgePassRatio(result);
  const criticalJudgesScore = Math.max(criticalJudgePassRatio, 0);
  const nonCriticalJudgesScore = Math.max(nonCriticalJudgePassRatio, 0);
  const lintScore = Math.max(lintQualityScore(result), 0);
  const precisionScore = Math.max(diffPrecisionScore(result), 0);
  const durationScore = durationEfficiencyScore(result, run);
  const costScore = costEfficiencyScore(result, run);
  const resolutionRateScore = result.resolutionRate ?? 0;
  const tokenEfficiencyScore = result.tokenEfficiencyScore ?? 0;
  const acceptanceRateScore = result.acceptanceRate ?? 0;
  const categoryScoreScore = result.categoryScore ?? 0;

  const weightedScore =
    statusScore * (normalizedWeights.status ?? 0) +
    testsScore * (normalizedWeights.tests ?? 0) +
    criticalJudgesScore * (normalizedWeights.criticalJudges ?? 0) +
    nonCriticalJudgesScore * (normalizedWeights.nonCriticalJudges ?? 0) +
    lintScore * (normalizedWeights.lint ?? 0) +
    precisionScore * (normalizedWeights.precision ?? 0) +
    durationScore * (normalizedWeights.duration ?? 0) +
    costScore * (normalizedWeights.cost ?? 0) +
    resolutionRateScore * (normalizedWeights.resolutionRate ?? 0) +
    tokenEfficiencyScore * (normalizedWeights.tokenEfficiency ?? 0) +
    acceptanceRateScore * (normalizedWeights.acceptanceRate ?? 0) +
    categoryScoreScore * (normalizedWeights.categoryScore ?? 0);

  return {
    total: Math.round(weightedScore * 1000) / 10,
    weights: normalizedWeights,
    components: {
      status: statusScore,
      tests: testsScore,
      criticalJudges: criticalJudgesScore,
      nonCriticalJudges: nonCriticalJudgesScore,
      lint: lintScore,
      precision: precisionScore,
      duration: durationScore,
      cost: costScore,
      resolutionRate: resolutionRateScore,
      tokenEfficiency: tokenEfficiencyScore,
      acceptanceRate: acceptanceRateScore,
      categoryScore: categoryScoreScore
    }
  };
}

/**
 * Format composite score as a single decimal string.
 * @param {Object} result
 * @param {Object} run
 * @param {ScoreWeights} [weights]
 * @returns {string}
 */
export function formatCompositeScore(result, run, weights = DEFAULT_SCORE_WEIGHTS) {
  return `${getCompositeScoreDetails(result, run, weights).total.toFixed(1)}`;
}

/**
 * Get human-readable reasons why a result scored well.
 * @param {Object} result
 * @param {Object} run
 * @param {ScoreWeights} [weights]
 * @returns {string[]}
 */
export function getCompositeScoreReasons(result, run, weights = DEFAULT_SCORE_WEIGHTS) {
  const details = getCompositeScoreDetails(result, run, weights);
  const reasons = [];
  const normalizedWeights = normalizeScoreWeights(weights);

  if (details.components.tests >= 0.999) {
    reasons.push("tests");
  }
  if (details.components.criticalJudges >= 0.999) {
    reasons.push("criticalJudges");
  }
  if (details.components.nonCriticalJudges >= 0.999) {
    reasons.push("nonCriticalJudges");
  }
  if (details.components.lint >= 0.999) {
    reasons.push("lint");
  }
  if (details.components.precision >= 0.999) {
    reasons.push("precision");
  }
  if (details.components.duration >= 0.999) {
    reasons.push("duration");
  }
  if (details.components.cost >= 0.999) {
    reasons.push("cost");
  }
  if (details.components.resolutionRate > 0.95 * normalizedWeights.resolutionRate && normalizedWeights.resolutionRate > 0) {
    reasons.push("resolution-rate-high");
  }
  if (details.components.tokenEfficiency > 0.95 * normalizedWeights.tokenEfficiency && normalizedWeights.tokenEfficiency > 0) {
    reasons.push("token-efficiency-good");
  }
  if (details.components.acceptanceRate > 0.95 * normalizedWeights.acceptanceRate && normalizedWeights.acceptanceRate > 0) {
    reasons.push("acceptance-rate-high");
  }

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
