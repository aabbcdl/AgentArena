import assert from "node:assert/strict";
import test from "node:test";

import {
  computeScoreComponents,
  getCompositeScoreDetails,
  normalizeApplicableWeights,
} from "../apps/web-report/dist/view-model/scoring.js";

function makeResult(overrides = {}) {
  return {
    status: "success",
    durationMs: 5000,
    judgeResults: [],
    ...overrides,
  };
}

function makeRun(overrides = {}) {
  return {
    task: { id: "test-task" },
    results: [],
    scoreWeights: {
      status: 10, tests: 25, criticalJudges: 20, nonCriticalJudges: 10,
      lint: 10, precision: 5, duration: 10, cost: 10,
    },
    ...overrides,
  };
}

test("computeScoreComponents returns all expected keys", () => {
  const result = makeResult();
  const run = makeRun();
  const components = computeScoreComponents(result, run);
  assert.ok("status" in components);
  assert.ok("tests" in components);
  assert.ok("criticalJudges" in components);
  assert.ok("nonCriticalJudges" in components);
  assert.ok("lint" in components);
  assert.ok("duration" in components);
  assert.ok("cost" in components);
  assert.ok("precision" in components);
});

test("computeScoreComponents: successful result with passing test judge", () => {
  const result = makeResult({
    judgeResults: [
      { type: "test-result", success: true, totalCount: 10, passedCount: 10, critical: true },
    ],
  });
  const components = computeScoreComponents(result, makeRun());
  assert.equal(components.tests, 1);
  assert.equal(components.criticalJudges, 1);
});

test("computeScoreComponents: partial test pass ratio", () => {
  const result = makeResult({
    judgeResults: [
      { type: "test-result", success: false, totalCount: 10, passedCount: 7, critical: true },
    ],
  });
  const components = computeScoreComponents(result, makeRun());
  assert.equal(components.tests, 0.7);
  assert.equal(components.criticalJudges, 0);
});

test("computeScoreComponents: lint judge with errors", () => {
  const result = makeResult({
    judgeResults: [
      { type: "lint-check", success: false, errorCount: 2, warningCount: 3, critical: false },
    ],
  });
  const components = computeScoreComponents(result, makeRun());
  assert.ok(components.lint > 0);
  assert.ok(components.lint < 1);
});

test("getCompositeScoreDetails: failed result stays in FAILED_SCORE_BAND [10, 40]", () => {
  const result = makeResult({ status: "failed" });
  const score = getCompositeScoreDetails(result, makeRun());
  assert.ok(score.total >= 10, `score ${score.total} should be >= 10`);
  assert.ok(score.total <= 40, `score ${score.total} should be <= 40`);
});

test("getCompositeScoreDetails: critical judge failure stays in [50, 70]", () => {
  const result = makeResult({
    judgeResults: [
      { type: "command", success: false, critical: true },
    ],
  });
  const score = getCompositeScoreDetails(result, makeRun());
  assert.ok(score.total >= 50, `score ${score.total} should be >= 50`);
  assert.ok(score.total <= 70, `score ${score.total} should be <= 70`);
});

test("getCompositeScoreDetails: successful run with all judges passing scores above 70", () => {
  const result = makeResult({
    durationMs: 3000,
    judgeResults: [
      { type: "test-result", success: true, totalCount: 5, passedCount: 5, critical: true },
      { type: "lint-check", success: true, errorCount: 0, warningCount: 0, critical: false },
    ],
  });
  const score = getCompositeScoreDetails(result, makeRun());
  assert.ok(score.total > 70, `score ${score.total} should be > 70`);
});

test("normalizeApplicableWeights excludes precision when no expectedChangedPaths", () => {
  const weights = { status: 10, tests: 25, precision: 5, duration: 10 };
  const result = makeResult();
  const run = makeRun({ task: { id: "t" } });
  const normalized = normalizeApplicableWeights(weights, result, run);
  assert.equal(normalized.precision, undefined);
});

test("normalizeApplicableWeights includes precision when expectedChangedPaths present", () => {
  const weights = { status: 10, tests: 25, precision: 5, duration: 10 };
  const result = makeResult();
  const run = makeRun({ task: { id: "t", expectedChangedPaths: ["src/**"] } });
  const normalized = normalizeApplicableWeights(weights, result, run);
  assert.ok(normalized.precision > 0);
});

test("normalizeApplicableWeights sums to 1", () => {
  const weights = { status: 10, tests: 25, criticalJudges: 20, lint: 10, duration: 10, cost: 10 };
  const result = makeResult();
  const run = makeRun();
  const normalized = normalizeApplicableWeights(weights, result, run);
  const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.001, `sum ${sum} should be ~1`);
});
