import assert from "node:assert/strict";
import test from "node:test";

import { generateConclusion } from "../packages/report/dist/conclusion.js";

function makeResult(overrides) {
  return {
    agentId: "test-agent",
    displayLabel: "Test Agent",
    baseAgentId: "test-agent",
    status: "success",
    summary: "All judges passed",
    compositeScore: 85,
    durationMs: 5000,
    tokenUsage: 1000,
    estimatedCostUsd: 0.01,
    costKnown: true,
    judgeResults: [
      { id: "j1", type: "command", label: "Test", success: true, durationMs: 100 },
    ],
    preflight: { status: "ready", summary: "OK", capability: { invocationMethod: "cli", supportTier: "experimental", traceRichness: "full", tokenAvailability: "reported", costAvailability: "reported", knownLimitations: [] } },
    ...overrides,
  };
}

function makeRun(results) {
  return {
    runId: "test-run",
    createdAt: "2026-01-01T00:00:00Z",
    repoPath: ".",
    outputPath: "./output",
    task: { id: "test", title: "Test" },
    results,
    scoreMode: "practical",
    scoreWeights: {},
  };
}

test("generateConclusion: all failed", () => {
  const run = makeRun([
    makeResult({ status: "failed", summary: "Judge failures detected", compositeScore: 0, judgeResults: [] }),
  ]);
  const conclusion = generateConclusion(run);
  assert.equal(conclusion.category, "all-failed");
  assert.match(conclusion.verdict, /No valid results/);
  assert.match(conclusion.explanation, /Judge failures detected/);
});

test("generateConclusion: single success", () => {
  const run = makeRun([makeResult({ compositeScore: 92 })]);
  const conclusion = generateConclusion(run);
  assert.equal(conclusion.category, "single-success");
  assert.match(conclusion.verdict, /score 92/);
  assert.match(conclusion.explanation, /1\/1/);
  assert.match(conclusion.explanation, /one run cannot establish a model capability ranking/);
  assert.match(conclusion.nextStep, /two explicit model\/reasoning profiles/);
});

test("generateConclusion: partial success", () => {
  const run = makeRun([
    makeResult({ agentId: "a1", displayLabel: "Agent A", compositeScore: 80 }),
    makeResult({ agentId: "a2", displayLabel: "Agent B", status: "failed", compositeScore: 0, judgeResults: [] }),
  ]);
  const conclusion = generateConclusion(run);
  assert.equal(conclusion.category, "partial-success");
  assert.match(conclusion.verdict, /Agent A/);
  assert.match(conclusion.verdict, /1 agent\(s\) failed/);
});

test("generateConclusion: multi success", () => {
  const run = makeRun([
    makeResult({ agentId: "a1", displayLabel: "Agent A", compositeScore: 90 }),
    makeResult({ agentId: "a2", displayLabel: "Agent B", compositeScore: 70 }),
  ]);
  const conclusion = generateConclusion(run);
  assert.equal(conclusion.category, "multi-success");
  assert.match(conclusion.verdict, /Agent A/);
  assert.match(conclusion.explanation, /All 2 agents/);
});

test("generateConclusion: Chinese language", () => {
  const run = makeRun([
    makeResult({ status: "failed", summary: "timeout", compositeScore: 0, judgeResults: [] }),
  ]);
  const conclusion = generateConclusion(run, "zh-CN");
  assert.equal(conclusion.category, "all-failed");
  assert.match(conclusion.verdict, /本轮无有效结果/);
  assert.match(conclusion.nextStep, /建议/);
});

test("generateConclusion: timeout detection", () => {
  const run = makeRun([
    makeResult({ status: "failed", summary: "execution timed out", compositeScore: 0, judgeResults: [] }),
  ]);
  const conclusion = generateConclusion(run);
  assert.match(conclusion.nextStep, /Probe auth/);
});
