import assert from "node:assert/strict";
import test from "node:test";
import {
  getAgentTrendRows,
  getComparableRuns,
  getCrossRunCompareRows,
  getCrossRunRecommendation,
  getSelectionTrust,
  recordKey
} from "../apps/web-report/workbench/src/domain/compare.ts";
import { normalizeRun } from "../apps/web-report/workbench/src/domain/run.ts";

function result(overrides = {}) {
  return {
    agentId: "demo-fast",
    variantId: "demo-fast",
    displayLabel: "Demo Fast",
    status: "success",
    durationMs: 1200,
    tokenUsage: 100,
    estimatedCostUsd: 0.02,
    costKnown: true,
    changedFiles: ["src/a.ts"],
    judgeResults: [{ judgeId: "tests", label: "Tests", type: "test-result", success: true }],
    resolvedRuntime: { effectiveAgentVersion: "1.0" },
    ...overrides
  };
}

function run(overrides = {}) {
  return normalizeRun({
    runId: "run-001",
    createdAt: "2026-07-15T00:00:00.000Z",
    repository: { path: "D:/repo", revision: "abc123" },
    task: { id: "task-1", title: "Fix bug", schemaVersion: "agentarena.taskpack/v1" },
    scoreMode: "practical",
    results: [result()],
    ...overrides
  });
}

test("getComparableRuns matches same task and score mode only", () => {
  const base = run();
  const sameTask = run({ runId: "run-002", createdAt: "2026-07-16T00:00:00.000Z" });
  const otherTask = run({ runId: "run-003", task: { id: "task-2", title: "Other", schemaVersion: "agentarena.taskpack/v1" } });
  // Must use a real ScoreMode — phantom labels like "speed" normalize to practical.
  const otherMode = run({ runId: "run-004", scoreMode: "efficiency-first" });
  const phantomMode = run({ runId: "run-005", scoreMode: "speed" });

  const comparable = getComparableRuns([base, sameTask, otherTask, otherMode, phantomMode], base);
  // phantom "speed" collapses to practical and remains comparable by design.
  assert.deepEqual(comparable.map((item) => item.runId).sort(), ["run-001", "run-002", "run-005"]);
  assert.ok(!comparable.some((item) => item.runId === "run-004"));
});

test("getComparableRuns applies persisted judge and repository identities", () => {
  const identity = {
    taskIdentity: "task:a",
    judgeIdentity: "judge:a",
    repoBaselineIdentity: "repo:a"
  };
  const base = run({ fairComparison: identity });
  const same = run({ runId: "run-002", fairComparison: { ...identity } });
  const differentJudge = run({
    runId: "run-003",
    fairComparison: { ...identity, judgeIdentity: "judge:b" }
  });
  const differentRepo = run({
    runId: "run-004",
    fairComparison: { ...identity, repoBaselineIdentity: "repo:b" }
  });
  const legacy = run({ runId: "run-005", fairComparison: undefined });

  assert.deepEqual(
    getComparableRuns([base, same, differentJudge, differentRepo, legacy], base).map((item) => item.runId),
    ["run-001", "run-002", "run-005"]
  );
});

test("getAgentTrendRows orders by time and computes deltas", () => {
  const base = run({ results: [result({ variantId: "demo-fast", durationMs: 1000 })] });
  const later = run({
    runId: "run-002",
    createdAt: "2026-07-16T00:00:00.000Z",
    results: [result({ variantId: "demo-fast", durationMs: 1500, tokenUsage: 200 })]
  });

  const rows = getAgentTrendRows([base, later], base, recordKey(base.results[0]));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].durationDeltaMs, 500);
  assert.equal(rows[1].tokenDelta, 100);
  assert.equal(rows[0].durationDeltaMs, null);
});

test("getCrossRunCompareRows excludes non-comparable runs with reasons", () => {
  const base = run();
  const sameTask = run({ runId: "run-002", createdAt: "2026-07-16T00:00:00.000Z" });
  const otherTask = run({ runId: "run-003", task: { id: "task-2", title: "Other", schemaVersion: "agentarena.taskpack/v1" } });

  const comparison = getCrossRunCompareRows([base, sameTask, otherTask]);
  assert.equal(comparison.comparableRuns.length, 2);
  assert.equal(comparison.excludedRuns.length, 1);
  assert.deepEqual(comparison.excludedRuns[0].reasons, ["different-task"]);
  assert.equal(comparison.rows.length, 1);
  assert.equal(comparison.rows[0].agentId, "demo-fast");
});

test("getCrossRunRecommendation picks a successful agent and never a fully failed one", () => {
  const good = run({ results: [result({ variantId: "good", durationMs: 1000 })] });
  const bad = run({
    runId: "run-002",
    createdAt: "2026-07-16T00:00:00.000Z",
    task: { id: "task-1", title: "Fix bug", schemaVersion: "agentarena.taskpack/v1" },
    results: [result({ variantId: "bad", status: "failed", durationMs: 500, judgeResults: [] })]
  });

  const comparison = getCrossRunCompareRows([good, bad]);
  const recommendation = getCrossRunRecommendation(comparison);
  assert.ok(recommendation);
  assert.equal(recommendation.agentId, "good");

  const allFailed = getCrossRunCompareRows([bad]);
  assert.equal(getCrossRunRecommendation(allFailed), null);
});

test("getSelectionTrust flags low sample and exclusions as caution", () => {
  assert.equal(getSelectionTrust({ comparableRuns: 2, excludedRuns: 0, hasLegacyFallback: false }).level, "caution");
  assert.equal(getSelectionTrust({ comparableRuns: 3, excludedRuns: 0, hasLegacyFallback: false }).level, "strong");
  assert.equal(getSelectionTrust({ comparableRuns: 3, excludedRuns: 1, hasLegacyFallback: false }).level, "caution");
  assert.equal(getSelectionTrust({ comparableRuns: 3, excludedRuns: 0, hasLegacyFallback: true }).level, "caution");
});
