import assert from "node:assert/strict";
import test from "node:test";

import {
  filterApplicableWeights,
  migrateLegacyWeights,
  normalizeApplicableWeights,
  normalizeWeights,
} from "../packages/report/dist/score-weights.js";

function makeResult(overrides = {}) {
  return {
    agentId: "test",
    baseAgentId: "test",
    variantId: "default",
    displayLabel: "Test",
    status: "success",
    durationMs: 5000,
    tokenUsage: 1000,
    estimatedCostUsd: 0.05,
    costKnown: true,
    changedFiles: [],
    judgeResults: [],
    ...overrides,
  };
}

function makeRun(overrides = {}) {
  return {
    runId: "test",
    createdAt: new Date().toISOString(),
    task: { id: "test", title: "Test", prompt: "Fix it" },
    scoreMode: "practical",
    results: [makeResult()],
    ...overrides,
  };
}

// --- migrateLegacyWeights ---

test("migrateLegacyWeights splits judges key into critical and non-critical", () => {
  const result = migrateLegacyWeights({ judges: 0.6, tests: 0.4 });
  assert.ok(Math.abs(result.criticalJudges - 0.4) < 0.001);
  assert.ok(Math.abs(result.nonCriticalJudges - 0.2) < 0.001);
  assert.equal(result.tests, 0.4);
  assert.equal(result.judges, undefined);
});

test("migrateLegacyWeights does not overwrite existing criticalJudges", () => {
  const result = migrateLegacyWeights({ judges: 0.6, criticalJudges: 0.5, nonCriticalJudges: 0.3 });
  assert.equal(result.criticalJudges, 0.5);
  assert.equal(result.nonCriticalJudges, 0.3);
});

test("migrateLegacyWeights handles empty weights", () => {
  const result = migrateLegacyWeights({});
  assert.deepEqual(result, {});
});

test("migrateLegacyWeights passes through non-judges keys unchanged", () => {
  const result = migrateLegacyWeights({ tests: 0.5, lint: 0.3 });
  assert.equal(result.tests, 0.5);
  assert.equal(result.lint, 0.3);
});

// --- filterApplicableWeights ---

test("filterApplicableWeights removes precision when no expectedChangedPaths", () => {
  const result = filterApplicableWeights(
    { tests: 0.5, precision: 0.3, lint: 0.2 },
    makeResult({ judgeResults: [{ type: "test-result", success: true }] }),
    makeRun()
  );
  assert.equal(result.precision, undefined);
  assert.equal(result.tests, 0.5);
});

test("filterApplicableWeights keeps precision when expectedChangedPaths exist", () => {
  const run = makeRun();
  run.task.expectedChangedPaths = ["src/index.ts"];
  const result = filterApplicableWeights(
    { tests: 0.5, precision: 0.3, lint: 0.2 },
    makeResult(),
    run
  );
  assert.equal(result.precision, 0.3);
});

test("filterApplicableWeights removes tokenEfficiency when not set", () => {
  const result = filterApplicableWeights(
    { tests: 0.5, tokenEfficiency: 0.3 },
    makeResult(),
    makeRun()
  );
  assert.equal(result.tokenEfficiency, undefined);
});

test("filterApplicableWeights keeps tokenEfficiency when set", () => {
  const result = filterApplicableWeights(
    { tests: 0.5, tokenEfficiency: 0.3 },
    makeResult({ tokenEfficiencyScore: 0.8 }),
    makeRun()
  );
  assert.equal(result.tokenEfficiency, 0.3);
});

test("filterApplicableWeights removes resolutionRate when no sweBench", () => {
  const result = filterApplicableWeights(
    { tests: 0.5, resolutionRate: 0.3 },
    makeResult(),
    makeRun()
  );
  assert.equal(result.resolutionRate, undefined);
});

test("filterApplicableWeights keeps resolutionRate when sweBench present", () => {
  const result = filterApplicableWeights(
    { tests: 0.5, resolutionRate: 0.3 },
    makeResult({ sweBench: { resolutionRate: 0.9 } }),
    makeRun()
  );
  assert.equal(result.resolutionRate, 0.3);
});

// --- normalizeWeights ---

test("normalizeWeights scales weights to sum to 1.0", () => {
  const result = normalizeWeights({ a: 2, b: 3, c: 5 });
  assert.ok(Math.abs(result.a - 0.2) < 0.001);
  assert.ok(Math.abs(result.b - 0.3) < 0.001);
  assert.ok(Math.abs(result.c - 0.5) < 0.001);
});

test("normalizeWeights returns input unchanged when sum is 0", () => {
  const result = normalizeWeights({ a: 0, b: 0 });
  assert.equal(result.a, 0);
  assert.equal(result.b, 0);
});

test("normalizeWeights handles single key", () => {
  const result = normalizeWeights({ a: 5 });
  assert.equal(result.a, 1);
});

// --- normalizeApplicableWeights ---

test("normalizeApplicableWeights full pipeline: migrate + filter + normalize", () => {
  const weights = { judges: 0.6, tests: 0.4, precision: 0.2 };
  const result = normalizeApplicableWeights(weights, makeResult(), makeRun());
  // judges migrated to criticalJudges + nonCriticalJudges
  assert.equal(result.judges, undefined);
  // precision filtered out (no expectedChangedPaths)
  assert.equal(result.precision, undefined);
  // remaining keys normalized to sum to 1
  const sum = Object.values(result).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.001);
});
