import assert from "node:assert/strict";
import test from "node:test";
import { computeCompositeScore } from "../packages/report/dist/index.js";

function createResult(overrides = {}) {
  return {
    agentId: "test-agent",
    baseAgentId: overrides.baseAgentId ?? "test-agent",
    variantId: overrides.variantId ?? "test-agent",
    displayLabel: overrides.displayLabel ?? "Test Agent",
    agentTitle: overrides.agentTitle ?? "Test Agent",
    adapterKind: overrides.adapterKind ?? "demo",
    preflight: overrides.preflight,
    requestedConfig: overrides.requestedConfig ?? {},
    resolvedRuntime: overrides.resolvedRuntime,
    status: overrides.status ?? "success",
    durationMs: overrides.durationMs ?? 1000,
    tokenUsage: overrides.tokenUsage ?? 100,
    estimatedCostUsd: overrides.estimatedCostUsd ?? 0.1,
    costKnown: overrides.costKnown ?? true,
    changedFiles: overrides.changedFiles ?? [],
    changedFilesHint: overrides.changedFilesHint ?? [],
    setupResults: overrides.setupResults ?? [],
    judgeResults: overrides.judgeResults ?? [],
    teardownResults: overrides.teardownResults ?? [],
    tracePath: overrides.tracePath ?? "trace.jsonl",
    workspacePath: overrides.workspacePath ?? "workspace",
    diff: overrides.diff ?? { added: [], changed: [], removed: [] },
    resolutionRate: overrides.resolutionRate,
    tokenEfficiencyScore: overrides.tokenEfficiencyScore,
    acceptanceRate: overrides.acceptanceRate,
    ...overrides
  };
}

function createRun(overrides = {}) {
  return {
    runId: "test-run",
    createdAt: "2026-04-01T00:00:00Z",
    repoPath: ".",
    outputPath: "./output",
    scoreMode: overrides.scoreMode ?? "practical",
    scoreWeights: overrides.scoreWeights,
    task: {
      id: "test-task",
      title: "Test Task",
      prompt: "Test prompt",
      schemaVersion: "repoarena.taskpack/v1",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: [],
      expectedChangedPaths: overrides.expectedChangedPaths,
      ...overrides.task
    },
    results: overrides.results ?? [],
    preflights: overrides.preflights ?? [],
    ...overrides
  };
}

test("computeCompositeScore works with issue-resolution mode", () => {
  const result = createResult({
    status: "success",
    resolutionRate: 1.0,
    judgeResults: [
      {
        judgeId: "patch-validation",
        label: "Issue resolved",
        type: "patch-validation",
        target: "test",
        expectation: "pass",
        exitCode: 0,
        success: true,
        stdout: "",
        stderr: "",
        durationMs: 100,
        critical: true,
        testSuite: "npm test",
        failToPassTests: ["test/bug-fix.test.js"],
        passToPassTests: ["test/**/*.test.js"]
      }
    ]
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "issue-resolution");
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
  // With full resolution rate and critical judge passing, score should be decent
  assert.ok(score >= 60, `Score should be reasonable with full resolution, got ${score}`);
});

test("computeCompositeScore works with issue-resolution mode - failed resolution", () => {
  const result = createResult({
    status: "success",
    resolutionRate: 0.0,
    judgeResults: []
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "issue-resolution");
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
  // With zero resolution rate, score should be relatively low
  assert.ok(score < 60, `Score should be lower with zero resolution, got ${score}`);
});

test("computeCompositeScore works with efficiency-first mode", () => {
  const result = createResult({
    status: "success",
    tokenEfficiencyScore: 0.9,
    tokenUsage: 5000,
    judgeResults: []
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "efficiency-first");
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
});

test("computeCompositeScore works with efficiency-first mode - low token efficiency", () => {
  const result = createResult({
    status: "success",
    tokenEfficiencyScore: 0.2,
    tokenUsage: 50000,
    judgeResults: []
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "efficiency-first");
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
  // With low token efficiency, score should be lower
  assert.ok(score < 70, `Score should be lower with poor token efficiency, got ${score}`);
});

test("computeCompositeScore works with rotating-tasks mode", () => {
  const result = createResult({
    status: "success",
    judgeResults: []
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "rotating-tasks");
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
});

test("computeCompositeScore works with comprehensive mode", () => {
  const result = createResult({
    status: "success",
    resolutionRate: 1.0,
    tokenEfficiencyScore: 0.8,
    judgeResults: []
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "comprehensive");
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
});

test("computeCompositeScore handles failed run gracefully", () => {
  const result = createResult({ status: "failed" });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "comprehensive");
  assert.ok(score < 50, `Failed run score should be low, got ${score}`);
  assert.ok(score >= 0, `Score should not be negative, got ${score}`);
});

test("computeCompositeScore handles critical judge failure", () => {
  const result = createResult({
    status: "success",
    judgeResults: [
      {
        judgeId: "critical-test",
        label: "Critical Test",
        type: "command",
        target: "test",
        expectation: "pass",
        exitCode: 1,
        success: false,
        stdout: "",
        stderr: "Test failed",
        durationMs: 100,
        critical: true
      }
    ]
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "practical");
  // Critical judge failure should cap score between 50-70
  assert.ok(score >= 50 && score <= 70, `Critical failure score should be 50-70, got ${score}`);
});

test("computeCompositeScore with custom weights", () => {
  const result = createResult({
    status: "success",
    judgeResults: []
  });
  const run = createRun({ results: [] });
  const customWeights = { status: 0.5, tests: 0.5 };

  const score = computeCompositeScore(result, run, customWeights);
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100 with custom weights, got ${score}`);
});

test("computeCompositeScore with balanced mode", () => {
  const result = createResult({
    status: "success",
    judgeResults: []
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "balanced");
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
});

test("computeCompositeScore defaults to practical mode", () => {
  const result = createResult({
    status: "success",
    judgeResults: []
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "unknown-mode");
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
});

test("computeCompositeScore handles empty results array", () => {
  const result = createResult({ status: "success" });
  const run = createRun({ results: [] });

  // Should not throw even with empty results
  const score = computeCompositeScore(result, run);
  assert.ok(typeof score === "number", `Score should be a number, got ${typeof score}`);
});

test("computeCompositeScore resolution rate affects score in issue-resolution mode", () => {
  const resultHigh = createResult({
    status: "success",
    resolutionRate: 1.0,
    durationMs: 1000,
    estimatedCostUsd: 0.1,
    costKnown: true,
    judgeResults: []
  });
  const resultLow = createResult({
    status: "success",
    resolutionRate: 0.0,
    durationMs: 1000,
    estimatedCostUsd: 0.1,
    costKnown: true,
    judgeResults: []
  });
  const run = createRun({
    results: [resultHigh, resultLow]
  });

  const scoreHigh = computeCompositeScore(resultHigh, run, undefined, "issue-resolution");
  const scoreLow = computeCompositeScore(resultLow, run, undefined, "issue-resolution");

  assert.ok(
    scoreHigh > scoreLow,
    `Higher resolution rate should yield higher score: ${scoreHigh} vs ${scoreLow}`
  );
});

test("computeCompositeScore token efficiency affects score in efficiency-first mode", () => {
  const resultHigh = createResult({
    status: "success",
    tokenEfficiencyScore: 1.0,
    durationMs: 1000,
    estimatedCostUsd: 0.1,
    costKnown: true,
    judgeResults: []
  });
  const resultLow = createResult({
    status: "success",
    tokenEfficiencyScore: 0.0,
    durationMs: 1000,
    estimatedCostUsd: 0.1,
    costKnown: true,
    judgeResults: []
  });
  const run = createRun({
    results: [resultHigh, resultLow]
  });

  const scoreHigh = computeCompositeScore(resultHigh, run, undefined, "efficiency-first");
  const scoreLow = computeCompositeScore(resultLow, run, undefined, "efficiency-first");

  assert.ok(
    scoreHigh > scoreLow,
    `Higher token efficiency should yield higher score: ${scoreHigh} vs ${scoreLow}`
  );
});

test("computeCompositeScore with expectedChangedPaths enables precision scoring", () => {
  const result = createResult({
    status: "success",
    changedFiles: ["src/index.ts", "README.md"],
    diff: {
      added: ["src/index.ts"],
      changed: ["README.md"],
      removed: []
    },
    diffPrecision: { score: 1.0 },
    judgeResults: []
  });
  const run = createRun({
    results: [result],
    expectedChangedPaths: ["src/index.ts", "README.md"]
  });

  const score = computeCompositeScore(result, run, undefined, "practical");
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
});

test("computeCompositeScore acceptance rate affects efficiency-first mode", () => {
  const resultHigh = createResult({
    status: "success",
    acceptanceRate: 1.0,
    durationMs: 1000,
    estimatedCostUsd: 0.1,
    costKnown: true,
    judgeResults: []
  });
  const resultLow = createResult({
    status: "success",
    acceptanceRate: 0.0,
    durationMs: 1000,
    estimatedCostUsd: 0.1,
    costKnown: true,
    judgeResults: []
  });
  const run = createRun({
    results: [resultHigh, resultLow]
  });

  const scoreHigh = computeCompositeScore(resultHigh, run, undefined, "efficiency-first");
  const scoreLow = computeCompositeScore(resultLow, run, undefined, "efficiency-first");

  assert.ok(
    scoreHigh > scoreLow,
    `Higher acceptance rate should yield higher score: ${scoreHigh} vs ${scoreLow}`
  );
});
