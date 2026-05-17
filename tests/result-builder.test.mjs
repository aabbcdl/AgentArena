import assert from "node:assert";
import { describe, it } from "node:test";
import { buildChangedFiles, createBaseResult, createCancellationSummary, createCancelledRunResult, createSkippedRunResult, mergeResolvedRuntime, summarizeCommandStepFailure } from "../packages/runner/dist/result-builder.js";

const mockPreflight = {
  agentId: "test-agent",
  baseAgentId: "test-base",
  variantId: "v1",
  displayLabel: "Test Agent",
  requestedConfig: {},
  resolvedRuntime: { source: "test", verification: "verified" },
  agentTitle: "Test Agent Title",
  adapterKind: "demo",
  summary: "Preflight passed",
  status: "ready"
};

describe("result-builder", () => {
  describe("createBaseResult", () => {
    it("creates result with minimal options", () => {
      const result = createBaseResult({
        preflight: mockPreflight,
        tracePath: "/path/to/trace",
        workspacePath: "/path/to/workspace"
      });

      assert.equal(result.agentId, "test-agent");
      assert.equal(result.status, "failed");
      assert.equal(result.tokenUsage, 0);
      assert.equal(result.estimatedCostUsd, 0);
      assert.deepEqual(result.diff, { added: [], changed: [], removed: [], skippedLargeFiles: [] });
    });

    it("creates result with custom options", () => {
      const result = createBaseResult({
        preflight: mockPreflight,
        tracePath: "/path/to/trace",
        workspacePath: "/path/to/workspace",
        status: "success",
        durationMs: 12345,
        tokenUsage: 1000,
        estimatedCostUsd: 0.05,
        costKnown: true
      });

      assert.equal(result.status, "success");
      assert.equal(result.durationMs, 12345);
      assert.equal(result.tokenUsage, 1000);
      assert.equal(result.estimatedCostUsd, 0.05);
      assert.equal(result.costKnown, true);
    });
  });

  describe("createCancelledRunResult", () => {
    it("creates cancelled result", () => {
      const result = createCancelledRunResult(
        mockPreflight,
        "/trace",
        "/workspace",
        "Cancelled during benchmark"
      );

      assert.equal(result.status, "cancelled");
      assert.equal(result.summary, "Cancelled during benchmark");
    });

    it("includes changed files from diff", () => {
      const result = createCancelledRunResult(
        mockPreflight,
        "/trace",
        "/workspace",
        "Cancelled",
        [],
        [],
        [],
        { added: ["file1.js"], changed: [], removed: ["file2.js"], skippedLargeFiles: [] }
      );

      assert.deepEqual(result.changedFiles, ["file1.js", "file2.js"]);
    });
  });

  describe("createSkippedRunResult", () => {
    it("creates skipped result with preflight summary", () => {
      const result = createSkippedRunResult(mockPreflight, "/trace", "/workspace");
      assert.equal(result.status, "failed");
      assert.equal(result.summary, "Preflight passed");
    });
  });

  describe("buildChangedFiles", () => {
    it("combines diff and hints", () => {
      const diff = { added: ["a.js"], changed: ["b.js"], removed: [], skippedLargeFiles: [] };
      const result = buildChangedFiles(diff, ["c.js"]);
      assert.deepEqual(result, ["a.js", "b.js", "c.js"]);
    });

    it("removes duplicates", () => {
      const diff = { added: ["a.js"], changed: [], removed: [], skippedLargeFiles: [] };
      const result = buildChangedFiles(diff, ["a.js", "b.js"]);
      assert.deepEqual(result, ["a.js", "b.js"]);
    });
  });

  describe("mergeResolvedRuntime", () => {
    it("merges primary and fallback", () => {
      const primary = { source: "primary", verification: "verified", notes: ["note1"] };
      const fallback = { source: "fallback", verification: "unknown", notes: ["note2"] };

      const result = mergeResolvedRuntime(primary, fallback);
      assert.equal(result?.source, "primary");
      assert.equal(result?.verification, "verified");
      assert.deepEqual(result?.notes, ["note2", "note1"]);
    });

    it("handles undefined inputs", () => {
      assert.equal(mergeResolvedRuntime(undefined, undefined), undefined);
      assert.ok(mergeResolvedRuntime({ source: "test", verification: "verified" }, undefined));
    });
  });

  describe("summarizeCommandStepFailure", () => {
    it("formats setup failure", () => {
      const result = summarizeCommandStepFailure("setup", {
        label: "npm install",
        exitCode: 1,
        command: "npm install",
        stdout: "",
        stderr: "",
        durationMs: 1000
      });

      assert.ok(result.includes("setup"));
      assert.ok(result.includes("npm install"));
      assert.ok(result.includes("1"));
    });
  });

  describe("createCancellationSummary", () => {
    it("formats cancellation message", () => {
      const result = createCancellationSummary("preflight");
      assert.ok(result.includes("preflight"));
      assert.ok(result.includes("cancelled"));
    });
  });
});