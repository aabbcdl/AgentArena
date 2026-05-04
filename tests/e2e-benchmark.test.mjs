import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runBenchmark } from "../packages/runner/dist/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_TASK = path.join(REPO_ROOT, "examples", "taskpacks", "demo-repo-health.json");

test("demo-fast adapter runs end-to-end with correct results", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "agentarena-e2e-"));

  try {
    const result = await runBenchmark({
      repoPath: REPO_ROOT,
      taskPath: DEMO_TASK,
      agentIds: ["demo-fast"],
      outputPath: outputDir,
      cleanupWorkspaces: true
    });

    // Verify run structure
    assert.ok(result.runId, "should have runId");
    assert.ok(result.createdAt, "should have createdAt");
    assert.ok(result.task, "should have task");
    assert.equal(result.results.length, 1, "should have 1 result");

    const agentResult = result.results[0];
    assert.equal(agentResult.agentId, "demo-fast");
    assert.equal(agentResult.status, "success");
    assert.ok(agentResult.durationMs > 0, "duration should be positive");
    assert.ok(agentResult.tokenUsage > 0, "tokenUsage should be positive");
    assert.ok(agentResult.changedFiles.length > 0, "should have changed files");
    assert.ok(agentResult.judgeResults.length > 0, "should have judge results");
    assert.ok(agentResult.tracePath, "should have trace path");
    assert.ok(agentResult.workspacePath, "should have workspace path");

    // Verify judge results
    for (const judge of agentResult.judgeResults) {
      assert.ok(judge.judgeId, "judge should have id");
      assert.ok(judge.label, "judge should have label");
      assert.ok(judge.type, "judge should have type");
      assert.ok(typeof judge.success === "boolean", "judge should have boolean success");
      assert.ok(typeof judge.durationMs === "number", "judge should have durationMs");
    }

    // Verify trace file exists
    const traceContent = await readFile(agentResult.tracePath, "utf8");
    assert.ok(traceContent.length > 0, "trace file should not be empty");
    const traceLines = traceContent.trim().split("\n").filter(Boolean);
    assert.ok(traceLines.length > 0, "trace should have events");
  } finally {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("multiple demo adapters produce comparative results", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "agentarena-e2e-multi-"));

  try {
    const result = await runBenchmark({
      repoPath: REPO_ROOT,
      taskPath: DEMO_TASK,
      agentIds: ["demo-fast", "demo-thorough", "demo-budget"],
      outputPath: outputDir,
      cleanupWorkspaces: true
    });

    assert.equal(result.results.length, 3, "should have 3 results");

    const statuses = result.results.map((r) => r.status);
    assert.ok(statuses.every((s) => s === "success" || s === "failed"), "all should have valid status");

    // All should have judge results
    for (const agentResult of result.results) {
      assert.ok(agentResult.judgeResults.length > 0, `${agentResult.agentId} should have judges`);
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
});
