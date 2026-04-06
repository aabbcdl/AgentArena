import assert from "node:assert/strict";
import test from "node:test";
import { computeVarianceAnalysis, formatVarianceReport } from "../packages/report/dist/index.js";

function createResult(agentId, overrides = {}) {
  return {
    agentId,
    displayLabel: overrides.displayLabel ?? agentId,
    status: overrides.status ?? "success",
    compositeScore: overrides.compositeScore ?? 80,
    durationMs: overrides.durationMs ?? 1000,
    estimatedCostUsd: overrides.estimatedCostUsd ?? 0.1,
    costKnown: overrides.costKnown ?? true,
    judgeResults: overrides.judgeResults ?? []
  };
}

function createRun(overrides = {}) {
  return {
    runId: overrides.runId ?? "test-run",
    createdAt: "2026-04-01T00:00:00Z",
    repoPath: ".",
    outputPath: "./output",
    task: { id: overrides.taskId ?? "test-task", title: "Test" },
    results: overrides.results ?? []
  };
}

test("computeVarianceAnalysis returns stats for each agent", () => {
  const runs = [
    createRun({ results: [createResult("agent-a", { compositeScore: 80 })] }),
    createRun({ results: [createResult("agent-a", { compositeScore: 85 })] }),
    createRun({ results: [createResult("agent-a", { compositeScore: 82 })] })
  ];
  const report = computeVarianceAnalysis(runs);
  assert.equal(report.agents.length, 1);
  assert.equal(report.agents[0].agentId, "agent-a");
  assert.ok(report.agents[0].scoreMean > 0);
});

test("computeVarianceAnalysis warns when run count is low", () => {
  const runs = [
    createRun({ results: [createResult("agent-a", { compositeScore: 80 })] })
  ];
  const report = computeVarianceAnalysis(runs);
  assert.ok(report.warnings.length > 0);
  assert.ok(report.warnings.some(w => w.includes("run")));
});

test("formatVarianceReport produces valid markdown", () => {
  const runs = [
    createRun({ results: [createResult("agent-a", { compositeScore: 80 })] }),
    createRun({ results: [createResult("agent-a", { compositeScore: 85 })] })
  ];
  const report = computeVarianceAnalysis(runs);
  const md = formatVarianceReport(report);
  assert.ok(md.includes("结果可信度分析"));
  assert.ok(md.includes("Agent"));
});
