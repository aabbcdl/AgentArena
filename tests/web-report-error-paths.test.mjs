import assert from "node:assert/strict";
import test from "node:test";
import { getRunTrustSummary, getRunVerdict, getSelectionTrustSummary } from "../apps/web-report/src/view-model/comparison.js";
import { formatCompositeScore, getCompositeScoreDetails, getScoreWeightPreset } from "../apps/web-report/src/view-model/scoring.js";

function makeMockResult(overrides = {}) {
  return {
    agentId: "test-agent",
    baseAgentId: "test-agent",
    variantId: "default",
    displayLabel: "Test Agent",
    status: "success",
    durationMs: 5000,
    tokenUsage: 1000,
    estimatedCostUsd: 0.05,
    costKnown: true,
    changedFiles: [],
    judgeResults: [],
    ...overrides
  };
}

function makeMockRun(overrides = {}) {
  return {
    runId: "test-run",
    createdAt: new Date().toISOString(),
    task: { id: "test", title: "Test", prompt: "Fix it" },
    scoreMode: "practical",
    results: [makeMockResult()],
    ...overrides
  };
}

test("getCompositeScoreDetails handles result with no judge results", () => {
  const result = makeMockResult({ judgeResults: [] });
  const run = makeMockRun({ results: [result] });
  const weights = getScoreWeightPreset("practical");

  const details = getCompositeScoreDetails(result, run, weights);
  assert.ok(typeof details.total === "number");
  assert.ok(!Number.isNaN(details.total));
  assert.ok(details.total >= 0 && details.total <= 100);
});

test("getCompositeScoreDetails handles result with undefined tokenUsage", () => {
  const result = makeMockResult({ tokenUsage: undefined, costKnown: false });
  const run = makeMockRun({ results: [result] });
  const weights = getScoreWeightPreset("practical");

  const details = getCompositeScoreDetails(result, run, weights);
  assert.ok(typeof details.total === "number");
  assert.ok(!Number.isNaN(details.total));
});

test("getCompositeScoreDetails handles result with NaN durationMs", () => {
  const result = makeMockResult({ durationMs: NaN });
  const run = makeMockRun({ results: [result] });
  const weights = getScoreWeightPreset("practical");

  const details = getCompositeScoreDetails(result, run, weights);
  assert.ok(typeof details.total === "number");
  assert.ok(!Number.isNaN(details.total));
});

test("getCompositeScoreDetails handles result with negative durationMs", () => {
  const result = makeMockResult({ durationMs: -1000 });
  const run = makeMockRun({ results: [result] });
  const weights = getScoreWeightPreset("practical");

  const details = getCompositeScoreDetails(result, run, weights);
  assert.ok(typeof details.total === "number");
  assert.ok(details.total >= 0);
});

test("getCompositeScoreDetails handles failed result", () => {
  const result = makeMockResult({ status: "failed" });
  const run = makeMockRun({ results: [result] });
  const weights = getScoreWeightPreset("practical");

  const details = getCompositeScoreDetails(result, run, weights);
  assert.ok(typeof details.total === "number");
  assert.ok(details.total >= 0 && details.total <= 40, "Failed result should be in failed band");
});

test("formatCompositeScore handles null compositeScore", () => {
  const result = makeMockResult({ compositeScore: null });
  const run = makeMockRun({ results: [result] });

  const formatted = formatCompositeScore(result, run);
  assert.ok(typeof formatted === "string");
  assert.ok(!Number.isNaN(parseFloat(formatted)));
});

test("formatCompositeScore displays n/a for score-excluded results", () => {
  const result = makeMockResult({
    status: "failed",
    scoreExcluded: true,
    scoreExclusionReason: "Task pack does not match this repository."
  });
  const run = makeMockRun({ results: [result] });

  assert.equal(formatCompositeScore(result, run), "n/a");
});

test("getRunVerdict handles run with all failed results", () => {
  const run = makeMockRun({
    results: [
      makeMockResult({ agentId: "a1", status: "failed" }),
      makeMockResult({ agentId: "a2", status: "failed" })
    ]
  });

  const verdict = getRunVerdict(run);
  assert.ok(verdict);
  assert.equal(typeof verdict, "object");
  // With all failed results, bestAgent should still be determined (least-bad)
  assert.ok(verdict.bestAgent || verdict.fastest, "should identify a best agent or fastest even with all failed");
});

test("getRunVerdict handles run with single result", () => {
  const run = makeMockRun();
  const verdict = getRunVerdict(run);
  assert.ok(verdict);
  assert.ok(verdict.bestAgent || verdict.fastest);
  // Single result should be both best and fastest
  if (verdict.bestAgent) assert.equal(verdict.bestAgent.agentId, "test-agent");
});

test("getRunTrustSummary handles run with no results", () => {
  const run = makeMockRun({ results: [] });
  const summary = getRunTrustSummary(run);
  assert.ok(summary);
  assert.equal(summary.totalAgents, 0);
  assert.equal(summary.failedAgents, 0);
});

test("getRunTrustSummary handles run with missing cost data", () => {
  const run = makeMockRun({
    results: [
      makeMockResult({ costKnown: false, estimatedCostUsd: undefined }),
      makeMockResult({ agentId: "a2", costKnown: true, estimatedCostUsd: 0.1 })
    ]
  });

  const summary = getRunTrustSummary(run);
  assert.ok(summary);
  assert.ok(summary.missingCostCount >= 1);
});

test("getSelectionTrustSummary handles empty comparable runs", () => {
  const summary = getSelectionTrustSummary({
    comparableRuns: [],
    excludedRuns: [],
    runs: []
  });
  assert.ok(summary);
  assert.equal(summary.comparableRuns, 0);
  assert.equal(summary.excludedRuns, 0);
});

test("getScoreWeightPreset returns valid weights for all modes", () => {
  const modes = ["practical", "balanced", "issue-resolution", "efficiency-first", "rotating-tasks", "comprehensive"];

  for (const mode of modes) {
    const weights = getScoreWeightPreset(mode);
    assert.ok(weights, `Weights should exist for mode: ${mode}`);
    assert.ok(typeof weights === "object", `Weights should be an object for mode: ${mode}`);

    // All weight values should be non-negative numbers
    for (const [key, value] of Object.entries(weights)) {
      assert.ok(typeof value === "number", `Weight ${key} should be a number in mode ${mode}`);
      assert.ok(value >= 0, `Weight ${key} should be non-negative in mode ${mode}`);
    }
  }
});
