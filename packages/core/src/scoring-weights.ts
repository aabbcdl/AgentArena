/**
 * Score weight presets for AgentArena benchmark scoring.
 *
 * These constants are the single source of truth for default weight values.
 * The frontend (view-model/scoring.js) mirrors these values in
 * SCORE_WEIGHT_PRESETS for display and dynamic re-scoring.
 *
 * When adding or changing presets, update BOTH this file AND
 * apps/web-report/src/view-model/scoring.js.
 */

const PRACTICAL_WEIGHTS = {
  status: 0.24,
  tests: 0.26,
  criticalJudges: 0.20,
  nonCriticalJudges: 0.08,
  precision: 0.05,
  lint: 0.03,
  duration: 0.08,
  cost: 0.06
};

const BALANCED_WEIGHTS = {
  status: 0.30,
  tests: 0.25,
  criticalJudges: 0.10,
  nonCriticalJudges: 0.05,
  lint: 0.10,
  precision: 0.10,
  duration: 0.06,
  cost: 0.04
};

const ISSUE_RESOLUTION_WEIGHTS = {
  status: 0.15,
  resolutionRate: 0.45,
  failToPassTests: 0.20,
  passToPassTests: 0.15,
  duration: 0.05
};

const EFFICIENCY_FIRST_WEIGHTS = {
  status: 0.20,
  tests: 0.15,
  criticalJudges: 0.15,
  tokenEfficiency: 0.25,
  acceptanceRate: 0.10,
  duration: 0.10,
  cost: 0.05
};

const ROTATING_TASKS_WEIGHTS = {
  status: 0.20,
  tests: 0.20,
  criticalJudges: 0.20,
  categoryScore: 0.20,
  duration: 0.10,
  cost: 0.10
};

const COMPREHENSIVE_WEIGHTS = {
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
};

export function getDefaultWeights(scoreMode: string): Record<string, number> {
  switch (scoreMode) {
    case "balanced":
      return BALANCED_WEIGHTS;
    case "issue-resolution":
      return ISSUE_RESOLUTION_WEIGHTS;
    case "efficiency-first":
      return EFFICIENCY_FIRST_WEIGHTS;
    case "rotating-tasks":
      return ROTATING_TASKS_WEIGHTS;
    case "comprehensive":
      return COMPREHENSIVE_WEIGHTS;
    default:
      return PRACTICAL_WEIGHTS;
  }
}
