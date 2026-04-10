import assert from "node:assert/strict";
import test from "node:test";
import { formatDecisionReport, generateDecisionReport } from "../packages/report/dist/index.js";

function createResult(agentId, overrides = {}) {
  return {
    agentId,
    displayLabel: overrides.displayLabel ?? agentId,
    status: overrides.status ?? "success",
    compositeScore: overrides.compositeScore,
    durationMs: overrides.durationMs ?? 1000,
    tokenUsage: overrides.tokenUsage ?? 100,
    estimatedCostUsd: overrides.estimatedCostUsd ?? 0.1,
    costKnown: overrides.costKnown ?? true,
    judgeResults: overrides.judgeResults ?? [],
    changedFiles: overrides.changedFiles ?? []
  };
}

function createRun(overrides = {}) {
  return {
    runId: "test-run",
    createdAt: "2026-04-01T00:00:00Z",
    repoPath: ".",
    outputPath: "./output",
    task: { id: "test-task", title: overrides.taskTitle ?? "Test Task" },
    results: overrides.results ?? []
  };
}

test("generateDecisionReport returns structured report", () => {
  const run = createRun({ results: [createResult("agent-a", { compositeScore: 85 })] });
  const report = generateDecisionReport(run);
  assert.ok(report.generatedAt);
  assert.ok(report.scenario);
  assert.ok(Array.isArray(report.recommendations));
  assert.ok(Array.isArray(report.keyInsights));
  assert.ok(Array.isArray(report.warnings));
  assert.ok(report.reproduceCommand);
});

test("generateDecisionReport recommends highest scoring agent", () => {
  const run = createRun({
    results: [
      createResult("agent-a", { compositeScore: 85, status: "success" }),
      createResult("agent-b", { compositeScore: 72, status: "success" })
    ]
  });
  const report = generateDecisionReport(run);
  assert.equal(report.recommendations[0].recommendation, "recommended");
  assert.equal(report.recommendations[0].agentId, "agent-a");
});

test("generateDecisionReport handles all failures", () => {
  const run = createRun({
    results: [
      createResult("agent-a", { status: "failed", compositeScore: 0 }),
      createResult("agent-b", { status: "failed", compositeScore: 0 })
    ]
  });
  const report = generateDecisionReport(run);
  assert.ok(report.recommendations.every(r => r.recommendation !== "recommended"));
  assert.ok(report.warnings.length > 0);
});

test("formatDecisionReport produces valid markdown", () => {
  const run = createRun({ results: [createResult("agent-a", { compositeScore: 85 })] });
  const report = generateDecisionReport(run);
  const md = formatDecisionReport(report);
  assert.ok(md.includes("AgentArena 决策报告"));
  assert.ok(md.includes("推荐方案"));
  assert.ok(md.includes("复现命令") || md.includes("reproduceCommand") || md.includes("agentarena run"));
});
