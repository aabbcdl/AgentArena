/**
 * Scoring schema validation.
 *
 * Provides runtime validation for score components to prevent
 * garbage-in → garbage-out in scoring. Both backend and frontend
 * scoring implementations should use this to validate computed results.
 */

export interface ScoreComponents {
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
}

export interface CompositeScore {
  total: number;
  components: ScoreComponents;
  applicableWeights: Record<string, number>;
}

const EXPECTED_COMPONENT_KEYS: (keyof ScoreComponents)[] = [
  "status",
  "tests",
  "criticalJudges",
  "nonCriticalJudges",
  "lint",
  "precision",
  "duration",
  "cost",
  "resolutionRate",
  "tokenEfficiency",
  "acceptanceRate",
  "categoryScore",
  "failToPassTests",
  "passToPassTests",
];

/**
 * Validate that a value is a finite number between 0 and 1 (inclusive).
 */
function isValidScore(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Validate score components structure and value ranges.
 * Returns true if valid, false otherwise.
 */
export function validateScoreComponents(components: unknown): components is ScoreComponents {
  if (!components || typeof components !== "object") {
    return false;
  }

  const obj = components as Record<string, unknown>;

  for (const key of EXPECTED_COMPONENT_KEYS) {
    if (!(key in obj)) {
      return false;
    }
    if (!isValidScore(obj[key])) {
      return false;
    }
  }

  return true;
}

/**
 * Validate composite score structure and value ranges.
 * Returns true if valid, false otherwise.
 */
export function validateCompositeScore(score: unknown): score is CompositeScore {
  if (!score || typeof score !== "object") {
    return false;
  }

  const obj = score as Record<string, unknown>;

  // Validate total
  if (typeof obj.total !== "number" || !Number.isFinite(obj.total) || obj.total < 0 || obj.total > 100) {
    return false;
  }

  // Validate components
  if (!validateScoreComponents(obj.components)) {
    return false;
  }

  // Validate applicableWeights
  if (!obj.applicableWeights || typeof obj.applicableWeights !== "object") {
    return false;
  }

  const weights = obj.applicableWeights as Record<string, unknown>;
  for (const [_key, value] of Object.entries(weights)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      return false;
    }
  }

  return true;
}

/**
 * Get a safe default ScoreComponents with all values set to 0.
 * Used as fallback when validation fails.
 */
export function getDefaultScoreComponents(): ScoreComponents {
  return {
    status: 0,
    tests: 0,
    criticalJudges: 0,
    nonCriticalJudges: 0,
    lint: 0,
    precision: 0,
    duration: 0,
    cost: 0,
    resolutionRate: 0,
    tokenEfficiency: 0,
    acceptanceRate: 0,
    categoryScore: 0,
    failToPassTests: 0,
    passToPassTests: 0,
  };
}
