/**
 * @typedef {Record<string, number>} ScoreWeights
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
 * @returns {Record<string, ScoreWeights>}
 */
export function getAllScorePresets() {
  return { ...SCORE_WEIGHT_PRESETS, ...DEPRECATED_SCORE_PRESETS };
}
