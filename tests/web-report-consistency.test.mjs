import assert from "node:assert/strict";
import test from "node:test";
import { readRunFromFile } from "../apps/web-report/src/results/loaders.js";
import { getRunVerdict } from "../apps/web-report/src/view-model.js";
import { deriveRunOutcome, normalizeRun } from "../apps/web-report/workbench/src/domain/run.ts";

const SUMMARY_SCHEMA = "agentarena.summary/v1";

function judge(success = true) {
  return { judgeId: "tests", label: "Tests", type: "test-result", success };
}

function result(agentId, overrides = {}) {
  return {
    agentId,
    variantId: agentId,
    displayLabel: agentId,
    status: "success",
    durationMs: 1000,
    tokenUsage: 100,
    estimatedCostUsd: 0.04,
    costKnown: true,
    costQuality: "known",
    changedFiles: ["src/a.ts"],
    judgeResults: [judge(true)],
    tracePath: `agents/${agentId}/trace.jsonl`,
    ...overrides
  };
}

function run(overrides = {}) {
  return {
    artifactSchemaVersion: SUMMARY_SCHEMA,
    runId: "run-consistency",
    createdAt: "2026-07-18T00:00:00.000Z",
    repository: { path: "D:/repo", revision: "abc123" },
    task: { id: "task-consistency", title: "Consistency task", schemaVersion: "agentarena.taskpack/v1" },
    scoreMode: "practical",
    results: [result("good")],
    ...overrides
  };
}

function compare(runValue) {
  const legacyVerdict = getRunVerdict(runValue);
  const workbenchRun = normalizeRun(runValue);
  const workbenchOutcome = deriveRunOutcome(workbenchRun);
  return { legacyVerdict, workbenchRun, workbenchOutcome };
}

test("Legacy and Workbench agree on all-failed, partial, and cancelled conclusions", () => {
  const allFailed = compare(run({
    results: [result("failed-a", { status: "failed" }), result("failed-b", { status: "cancelled" })],
    state: "cancelled"
  }));
  assert.equal(allFailed.legacyVerdict.bestAgent, null);
  assert.equal(allFailed.legacyVerdict.fastest, null);
  assert.equal(allFailed.workbenchOutcome.winner, null);
  assert.equal(allFailed.workbenchOutcome.qualifiedResults.length, 0);
  assert.equal(allFailed.workbenchOutcome.execution, "cancelled");
  assert.equal(allFailed.workbenchOutcome.evaluation, "fail");

  const partial = compare(run({
    results: [result("good", { durationMs: 900 }), result("failed", { status: "failed" })]
  }));
  assert.equal(partial.legacyVerdict.bestAgent?.variantId, "good");
  assert.equal(partial.workbenchOutcome.winner?.variantId, "good");
  assert.equal(partial.workbenchOutcome.evaluation, "partial");
  assert.deepEqual(partial.workbenchOutcome.qualifiedResults.map((item) => item.variantId), ["good"]);
});

test("Legacy and Workbench surface unknown cost without inventing a cheapest result", () => {
  const { legacyVerdict, workbenchRun, workbenchOutcome } = compare(run({
    results: [result("unknown-cost", {
      estimatedCostUsd: undefined,
      costKnown: false,
      costQuality: "unavailable"
    })]
  }));

  assert.equal(legacyVerdict.lowestKnownCost, null);
  assert.equal(workbenchRun.results[0].estimatedCostUsd, null);
  assert.equal(workbenchRun.results[0].costQuality, "unavailable");
  assert.equal(workbenchOutcome.trust.level, "partial");
  assert.ok(workbenchRun.integrityReasons.includes("cost-unknown"));
});

test("Workbench marks partial integrity for unreliable tokens and data quality warnings", () => {
  const workbenchRun = normalizeRun(run({
    results: [result("dirty-tokens", {
      tokenUsage: 0,
      tokenUsageReliable: false,
      dataQualityWarning: "CLI output format changed — token usage may be inaccurate."
    })]
  }));

  assert.equal(workbenchRun.integrity, "partial");
  assert.ok(workbenchRun.integrityReasons.includes("token-unreliable"));
  assert.ok(workbenchRun.integrityReasons.includes("data-quality-warning"));
});

test("Workbench marks partial integrity when trace writes were dropped or failed", () => {
  const workbenchRun = normalizeRun(run({
    results: [result("trace-lossy", {
      traceWriteFailed: true,
      traceDroppedWrites: 3
    })]
  }));

  assert.equal(workbenchRun.integrity, "partial");
  assert.ok(workbenchRun.integrityReasons.includes("trace-incomplete"));
});

test("damaged summaries never become normal ranking results in either frontend", async () => {
  const damaged = run({ artifactSchemaVersion: "agentarena.summary/v999" });
  const workbenchRun = normalizeRun(damaged);
  const workbenchOutcome = deriveRunOutcome(workbenchRun);

  assert.equal(workbenchRun.integrity, "damaged");
  assert.equal(workbenchOutcome.winner, null);
  assert.equal(workbenchOutcome.qualifiedResults.length, 0);
  assert.equal(workbenchOutcome.evaluation, "incomplete");

  await assert.rejects(
    () => readRunFromFile({ name: "summary.json", text: async () => JSON.stringify(damaged) }, { localText: (_zh, en) => en }),
    /failed to parse/i
  );
});
