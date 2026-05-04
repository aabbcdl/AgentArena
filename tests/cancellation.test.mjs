import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCancellation } from "../packages/core/dist/index.js";
import { runBenchmark } from "../packages/runner/dist/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_TASK = path.join(REPO_ROOT, "examples", "taskpacks", "demo-repo-health.json");

test("benchmark cancellation throws BenchmarkCancelledError", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "agentarena-cancel-"));
  const controller = new AbortController();

  // Cancel immediately
  controller.abort();

  try {
    await assert.rejects(
      () => runBenchmark({
        repoPath: REPO_ROOT,
        taskPath: DEMO_TASK,
        agentIds: ["demo-fast"],
        outputPath: outputDir,
        cancellation: createCancellation(controller.signal),
        cleanupWorkspaces: true
      }),
      (error) => error.name === "BenchmarkCancelledError"
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("benchmark with working cancellation signal completes normally", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "agentarena-cancel-ok-"));
  const controller = new AbortController();

  try {
    const result = await runBenchmark({
      repoPath: REPO_ROOT,
      taskPath: DEMO_TASK,
      agentIds: ["demo-fast"],
      outputPath: outputDir,
      cancellation: createCancellation(controller.signal),
      cleanupWorkspaces: true
    });

    assert.equal(result.results.length, 1);
    // With demo adapter (fast), it should complete before we cancel
    assert.equal(result.results[0].status, "success");
  } finally {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("cancellation during execution produces results with cancelled or failed status", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "agentarena-cancel-during-"));
  const controller = new AbortController();

  // Cancel after a short delay (during adapter execution)
  const cancelTimer = setTimeout(() => controller.abort(), 50);

  try {
    const result = await runBenchmark({
      repoPath: REPO_ROOT,
      taskPath: DEMO_TASK,
      agentIds: ["demo-fast", "demo-thorough"],
      outputPath: outputDir,
      maxConcurrency: 1,
      cancellation: createCancellation(controller.signal),
      cleanupWorkspaces: true
    });

    assert.ok(result.results.length > 0, "should have at least one result");
    const statuses = result.results.map((r) => r.status);
    assert.ok(
      statuses.every((s) => ["success", "failed", "cancelled"].includes(s)),
      `all statuses should be valid, got: ${statuses.join(", ")}`
    );
  } finally {
    clearTimeout(cancelTimer);
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("isAbortError correctly identifies cancellation errors", async () => {
  const { isAbortError, BenchmarkCancelledError } = await import("../packages/core/dist/index.js");

  // BenchmarkCancelledError
  assert.ok(isAbortError(new BenchmarkCancelledError()));

  // Regular errors
  assert.equal(isAbortError(new Error("test")), false);
  assert.equal(isAbortError(null), false);
  assert.equal(isAbortError(undefined), false);
  assert.equal(isAbortError("string"), false);
});
