import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SCORE_WEIGHTS, computeScoreComponents as frontendComputeScoreComponents, normalizeApplicableWeights as frontendNormalizeApplicableWeights, getCompositeScoreDetails, getScoreWeightPreset } from "../apps/web-report/src/view-model/scoring.js";
import { getDefaultWeights } from "../packages/core/dist/index.js";
import { computeScoreComponents as backendComputeScoreComponents, normalizeApplicableWeights as backendNormalizeApplicableWeights, CRITICAL_FAIL_SCORE_BAND, computeCompositeScore, enrichRunWithScores, FAILED_SCORE_BAND } from "../packages/report/dist/index.js";

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
    sweBench: overrides.sweBench,
    cursorBench: overrides.cursorBench,
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
      schemaVersion: "agentarena.taskpack/v1",
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
    sweBench: { resolutionRate: 1.0 },
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
    sweBench: { resolutionRate: 0.0 },
    judgeResults: []
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "issue-resolution");
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
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
    judgeResults: [{ type: "test-result", success: true }]
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run, undefined, "efficiency-first");
  assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
  // With low token efficiency, score should be lower than perfect
  assert.ok(score < 90, `Score should be lower with poor token efficiency, got ${score}`);
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
    sweBench: { resolutionRate: 1.0 },
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
    sweBench: { resolutionRate: 1.0 },
    durationMs: 1000,
    estimatedCostUsd: 0.1,
    costKnown: true,
    judgeResults: []
  });
  const resultLow = createResult({
    status: "success",
    sweBench: { resolutionRate: 0.0 },
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
    cursorBench: { acceptanceRate: 1.0 },
    durationMs: 1000,
    estimatedCostUsd: 0.1,
    costKnown: true,
    judgeResults: []
  });
  const resultLow = createResult({
    status: "success",
    cursorBench: { acceptanceRate: 0.0 },
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

// ---------------------------------------------------------------------------
// Frontend–backend scoring consistency tests
// ---------------------------------------------------------------------------

test("backend and frontend computeScoreComponents produce identical results", () => {
  const result = createResult({
    status: "success",
    durationMs: 2000,
    estimatedCostUsd: 0.10,
    costKnown: true,
    judgeResults: [
      { success: true, critical: true },
      { success: false, critical: true },
      { success: true, critical: false },
      { success: true, type: "test-result", totalCount: 10, passedCount: 8, failedCount: 2 },
      { success: true, type: "lint-check", errorCount: 3, warningCount: 1 },
      { success: true, type: "patch-validation" }
    ]
  });
  const run = createRun({ results: [result] });

  const backendComponents = backendComputeScoreComponents(result, run);
  const frontendDetails = frontendComputeScoreComponents(result, run);

  // Compare each component key
  const keys = ["status", "tests", "criticalJudges", "nonCriticalJudges", "lint", "precision", "duration", "cost"];
  for (const key of keys) {
    assert.ok(
      Math.abs(backendComponents[key] - frontendDetails[key]) < 0.001,
      `Component '${key}' mismatch: backend=${backendComponents[key]} frontend=${frontendDetails[key]}`
    );
  }
});

test("backend and frontend computeCompositeScore produce identical scores", () => {
  const result = createResult({
    status: "success",
    durationMs: 1500,
    estimatedCostUsd: 0.08,
    costKnown: true,
    judgeResults: [
      { success: true, critical: true },
      { success: true, type: "test-result", totalCount: 5, passedCount: 4, failedCount: 1 },
      { success: true, type: "lint-check", errorCount: 0, warningCount: 2 }
    ]
  });
  const otherResult = createResult({ durationMs: 800, estimatedCostUsd: 0.02, costKnown: true });
  const run = createRun({ results: [result, otherResult], expectedChangedPaths: ["src/a.ts"] });

  const backendScore = computeCompositeScore(result, run, undefined, "practical");
  const frontendScore = getCompositeScoreDetails(result, run, getScoreWeightPreset("practical")).total;

  assert.ok(
    Math.abs(backendScore - frontendScore) < 0.2,
    `Score mismatch: backend=${backendScore} frontend=${frontendScore}`
  );
});

test("frontend SCORE_WEIGHT_PRESETS match backend getDefaultWeights for all modes", () => {
  const modes = ["practical", "balanced", "issue-resolution", "efficiency-first", "rotating-tasks", "comprehensive"];
  for (const mode of modes) {
    const backendWeights = getDefaultWeights(mode);
    const frontendWeights = getScoreWeightPreset(mode);
    for (const key of Object.keys(backendWeights)) {
      assert.ok(
        Math.abs(backendWeights[key] - (frontendWeights[key] ?? 0)) < 0.001,
        `Weight mismatch for mode='${mode}' key='${key}': backend=${backendWeights[key]} frontend=${frontendWeights[key] ?? 0}`
      );
    }
    // Also verify no extra keys in frontend
    for (const key of Object.keys(frontendWeights)) {
      assert.ok(
        key in backendWeights,
        `Extra key '${key}' in frontend preset '${mode}' not present in backend`
      );
    }
  }
});

test("frontend DEFAULT_SCORE_WEIGHTS matches backend practical mode", () => {
  const backendPractical = getDefaultWeights("practical");
  for (const key of Object.keys(backendPractical)) {
    assert.ok(
      Math.abs(backendPractical[key] - (DEFAULT_SCORE_WEIGHTS[key] ?? 0)) < 0.001,
      `Default weight mismatch for key='${key}': backend=${backendPractical[key]} frontend=${DEFAULT_SCORE_WEIGHTS[key] ?? 0}`
    );
  }
});

// ---------------------------------------------------------------------------
// Legacy judges key migration tests
// ---------------------------------------------------------------------------

test("normalizeApplicableWeights migrates legacy 'judges' key to criticalJudges/nonCriticalJudges", () => {
  const result = createResult({
    status: "success",
    durationMs: 1000,
    estimatedCostUsd: 0.05,
    costKnown: true,
    judgeResults: [{ type: "test-result", success: true, critical: true }, { success: true }]
  });
  const run = createRun({ results: [result] });

  const legacyWeights = { status: 0.2, tests: 0.2, judges: 0.15, duration: 0.25, cost: 0.2 };

  // Backend migration
  const backendResult = backendNormalizeApplicableWeights(legacyWeights, result, run);
  assert.ok(!("judges" in backendResult), "Backend should not contain legacy 'judges' key");
  assert.ok("criticalJudges" in backendResult, "Backend should contain 'criticalJudges' key");
  assert.ok("nonCriticalJudges" in backendResult, "Backend should contain 'nonCriticalJudges' key");
  // 0.15 split 2:1 → criticalJudges=0.10, nonCriticalJudges=0.05
  assert.ok(Math.abs(backendResult.criticalJudges - 0.10) < 0.001, `Expected criticalJudges≈0.10, got ${backendResult.criticalJudges}`);
  assert.ok(Math.abs(backendResult.nonCriticalJudges - 0.05) < 0.001, `Expected nonCriticalJudges≈0.05, got ${backendResult.nonCriticalJudges}`);

  // Frontend migration
  const frontendResult = frontendNormalizeApplicableWeights(legacyWeights, result, run);
  assert.ok(!("judges" in frontendResult), "Frontend should not contain legacy 'judges' key");
  assert.ok("criticalJudges" in frontendResult, "Frontend should contain 'criticalJudges' key");
  assert.ok("nonCriticalJudges" in frontendResult, "Frontend should contain 'nonCriticalJudges' key");
  assert.ok(Math.abs(frontendResult.criticalJudges - 0.10) < 0.001, `Expected criticalJudges≈0.10, got ${frontendResult.criticalJudges}`);
  assert.ok(Math.abs(frontendResult.nonCriticalJudges - 0.05) < 0.001, `Expected nonCriticalJudges≈0.05, got ${frontendResult.nonCriticalJudges}`);
});

test("normalizeApplicableWeights does not overwrite existing criticalJudges when migrating 'judges'", () => {
  const result = createResult({
    status: "success",
    durationMs: 1000,
    estimatedCostUsd: 0.05,
    costKnown: true,
    judgeResults: [{ type: "test-result", success: true }]
  });
  const run = createRun({ results: [result] });

  // Both judges AND criticalJudges specified — criticalJudges should be kept from explicit key,
  // and only nonCriticalJudges should come from judges migration (1/3 of 0.15 = 0.05)
  // Pre-normalization: { status: 0.2, tests: 0.2, criticalJudges: 0.12, nonCriticalJudges: 0.05, duration: 0.18, cost: 0.15 }
  // Sum = 0.90, so after normalization criticalJudges = 0.12/0.90 = 0.1333
  const weights = { status: 0.2, tests: 0.2, judges: 0.15, criticalJudges: 0.12, duration: 0.18, cost: 0.15 };
  const backendResult = backendNormalizeApplicableWeights(weights, result, run);
  // After normalization: 0.12 / (0.2+0.2+0.12+0.05+0.18+0.15) = 0.12/0.90 ≈ 0.1333
  assert.ok(Math.abs(backendResult.criticalJudges - 0.1333) < 0.01, `Expected criticalJudges≈0.1333 (normalized), got ${backendResult.criticalJudges}`);
  // nonCriticalJudges from judges migration: 0.05/0.90 ≈ 0.0556
  assert.ok(Math.abs(backendResult.nonCriticalJudges - 0.0556) < 0.01, `Expected nonCriticalJudges≈0.0556 (normalized), got ${backendResult.nonCriticalJudges}`);
  // Legacy 'judges' key should be gone
  assert.ok(!("judges" in backendResult), "Legacy 'judges' key should be removed");
});

// ---------------------------------------------------------------------------
// Score band boundary tests
// ---------------------------------------------------------------------------

test("FAILED_SCORE_BAND: failed run score is within [10, 40]", () => {
  const result = createResult({
    status: "error",
    durationMs: 1000,
    estimatedCostUsd: 0,
    costKnown: false,
    judgeResults: []
  });
  const run = createRun({ results: [result] });

  const score = computeCompositeScore(result, run);
  assert.ok(score >= FAILED_SCORE_BAND.min, `Score ${score} below min ${FAILED_SCORE_BAND.min}`);
  assert.ok(score <= FAILED_SCORE_BAND.max, `Score ${score} above max ${FAILED_SCORE_BAND.max}`);
});

test("FAILED_SCORE_BAND: failed run with fast duration and low cost still capped at 40", () => {
  const fastResult = createResult({ status: "error", durationMs: 100 });
  const cheapResult = createResult({ status: "success", durationMs: 500, estimatedCostUsd: 0.01, costKnown: true });
  const run = createRun({ results: [fastResult, cheapResult] });

  const score = computeCompositeScore(fastResult, run);
  assert.ok(score <= FAILED_SCORE_BAND.max, `Even fast failed run should not exceed ${FAILED_SCORE_BAND.max}, got ${score}`);
});

test("CRITICAL_FAIL_SCORE_BAND: critical judge failure produces score in [50, 70]", () => {
  const result = createResult({
    status: "success",
    durationMs: 1000,
    estimatedCostUsd: 0.05,
    costKnown: true,
    judgeResults: [
      { success: false, critical: true, type: "security" },
      { success: true, type: "test-result", totalCount: 5, passedCount: 5, failedCount: 0 }
    ]
  });
  const otherResult = createResult({ durationMs: 800, estimatedCostUsd: 0.02, costKnown: true });
  const run = createRun({ results: [result, otherResult] });

  const score = computeCompositeScore(result, run);
  assert.ok(score >= CRITICAL_FAIL_SCORE_BAND.min, `Score ${score} below min ${CRITICAL_FAIL_SCORE_BAND.min}`);
  assert.ok(score <= CRITICAL_FAIL_SCORE_BAND.max, `Score ${score} above max ${CRITICAL_FAIL_SCORE_BAND.max}`);
});

test("CRITICAL_FAIL_SCORE_BAND: all non-critical passed but critical failed still in band", () => {
  const result = createResult({
    status: "success",
    durationMs: 500,
    estimatedCostUsd: 0.01,
    costKnown: true,
    judgeResults: [
      { success: false, critical: true },
      { success: true, type: "test-result", totalCount: 10, passedCount: 10, failedCount: 0 },
      { success: true, type: "lint-check", errorCount: 0, warningCount: 0 }
    ]
  });
  const otherResult = createResult({ durationMs: 400, estimatedCostUsd: 0.005, costKnown: true });
  const run = createRun({ results: [result, otherResult] });

  const score = computeCompositeScore(result, run);
  assert.ok(score >= CRITICAL_FAIL_SCORE_BAND.min, `Score ${score} should be >= ${CRITICAL_FAIL_SCORE_BAND.min}`);
  assert.ok(score <= CRITICAL_FAIL_SCORE_BAND.max, `Score ${score} should be <= ${CRITICAL_FAIL_SCORE_BAND.max}`);
});

test("Successful run with no critical judge failures scores above CRITICAL_FAIL_SCORE_BAND max", () => {
  const result = createResult({
    status: "success",
    durationMs: 500,
    estimatedCostUsd: 0.01,
    costKnown: true,
    judgeResults: [
      { success: true, critical: true },
      { success: true, type: "test-result", totalCount: 5, passedCount: 5, failedCount: 0 },
      { success: true, type: "lint-check", errorCount: 0, warningCount: 0 }
    ]
  });
  const otherResult = createResult({ durationMs: 400, estimatedCostUsd: 0.005, costKnown: true });
  const run = createRun({ results: [result, otherResult] });

  const score = computeCompositeScore(result, run);
  assert.ok(score > CRITICAL_FAIL_SCORE_BAND.max, `Fully successful run should score > ${CRITICAL_FAIL_SCORE_BAND.max}, got ${score}`);
});

// --- enrichRunWithScores ---

test("enrichRunWithScores defaults scoreMode to practical when missing", () => {
  const run = createRun({});
  delete run.scoreMode;
  const enriched = enrichRunWithScores(run);
  assert.equal(enriched.scoreMode, "practical");
});

test("enrichRunWithScores validates scoreMode and rejects invalid values", () => {
  const run = createRun({ scoreMode: "invalid-mode" });
  const enriched = enrichRunWithScores(run);
  assert.equal(enriched.scoreMode, "practical", "Invalid scoreMode should default to practical");
});

test("enrichRunWithScores preserves valid scoreMode", () => {
  const run = createRun({ scoreMode: "balanced" });
  const enriched = enrichRunWithScores(run);
  assert.equal(enriched.scoreMode, "balanced");
});

test("enrichRunWithScores provides default scoreWeights when missing", () => {
  const run = createRun({});
  delete run.scoreWeights;
  const enriched = enrichRunWithScores(run);
  assert.ok(enriched.scoreWeights, "should provide default weights");
  assert.equal(typeof enriched.scoreWeights, "object");
});

test("enrichRunWithScores provides default scoreScope", () => {
  const run = createRun({});
  const enriched = enrichRunWithScores(run);
  assert.equal(enriched.scoreScope, "run-local");
});

test("enrichRunWithScores provides default scoreValidityNote", () => {
  const run = createRun({});
  const enriched = enrichRunWithScores(run);
  assert.ok(enriched.scoreValidityNote);
  assert.ok(enriched.scoreValidityNote.includes("local rankings"));
});

test("enrichRunWithScores computes compositeScore for each result", () => {
  const result = createResult({ durationMs: 100, estimatedCostUsd: 0.001, costKnown: true });
  const run = createRun({ results: [result] });
  const enriched = enrichRunWithScores(run);
  assert.equal(typeof enriched.results[0].compositeScore, "number");
  assert.ok(!Number.isNaN(enriched.results[0].compositeScore));
});

test("enrichRunWithScores computes scoreReasons for each result", () => {
  const result = createResult();
  const run = createRun({ results: [result] });
  const enriched = enrichRunWithScores(run);
  assert.ok(Array.isArray(enriched.results[0].scoreReasons));
});
