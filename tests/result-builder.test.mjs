import assert from "node:assert";
import { describe, it } from "node:test";
import { buildFinalResult } from "../packages/runner/dist/result-assembly.js";
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

    it("preserves estimated cost quality without treating it as known billing", () => {
      const result = createBaseResult({
        preflight: mockPreflight,
        tracePath: "/path/to/trace",
        workspacePath: "/path/to/workspace",
        estimatedCostUsd: 0.08,
        costKnown: false,
        costQuality: "estimated"
      });

      assert.equal(result.estimatedCostUsd, 0.08);
      assert.equal(result.costKnown, false);
      assert.equal(result.costQuality, "estimated");
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
        costKnown: true,
        diffReliable: false
      });

      assert.equal(result.status, "success");
      assert.equal(result.durationMs, 12345);
      assert.equal(result.tokenUsage, 1000);
      assert.equal(result.estimatedCostUsd, 0.05);
      assert.equal(result.costKnown, true);
      assert.equal(result.diffReliable, false);
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

// ---------------------------------------------------------------------------
// A4: tokenUsageReliable guards tokenEfficiencyScore in buildFinalResult
// ---------------------------------------------------------------------------

describe("buildFinalResult tokenUsageReliable handling", () => {
  function makeContext(tokenBudget) {
    return {
      adapter: { title: "Test Adapter", kind: "external" },
      workspacePath: "/workspace",
      tracePath: "/trace",
      task: { id: "t", metadata: tokenBudget === undefined ? {} : { tokenBudget } }
    };
  }

  function makeAdapterResult(overrides = {}) {
    return {
      status: "success",
      summary: "done",
      tokenUsage: 1000,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFilesHint: [],
      ...overrides
    };
  }

  function build(adapterResult, tokenBudget) {
    return buildFinalResult(
      mockPreflight,
      makeContext(tokenBudget),
      adapterResult,
      undefined, // adapterError
      Date.now() - 1000, // startedAt
      [], // setupResults
      [], // judgeResults
      [], // teardownResults
      { added: [], changed: [], removed: [], skippedLargeFiles: [] }, // diff
      [], // changedFiles
      undefined, // diffPrecision
      false, // cancelled
      true // success
    );
  }

  it("does NOT compute tokenEfficiencyScore when tokenUsageReliable is false", () => {
    const result = build(makeAdapterResult({ tokenUsageReliable: false }), 2000);
    assert.equal(result.tokenUsageReliable, false);
    assert.equal(result.tokenEfficiencyScore, undefined);
  });

  it("computes tokenEfficiencyScore when tokenUsageReliable is true", () => {
    const result = build(makeAdapterResult({ tokenUsageReliable: true }), 2000);
    assert.equal(result.tokenUsageReliable, true);
    // budget 2000 / usage 1000 = 2, clamped to 1
    assert.equal(result.tokenEfficiencyScore, 1);
  });

  it("computes tokenEfficiencyScore when reliability is unspecified (legacy → treated reliable)", () => {
    const result = build(makeAdapterResult(), 4000);
    assert.equal(result.tokenUsageReliable, undefined);
    // budget 4000 / usage 1000 = 4, clamped to 1
    assert.equal(result.tokenEfficiencyScore, 1);
  });
});

// ---------------------------------------------------------------------------
// R-01: dataQualityWarning propagates from adapterResult to AgentRunResult
// ---------------------------------------------------------------------------

describe("buildFinalResult dataQualityWarning propagation", () => {
  function makeContext() {
    return {
      adapter: { title: "Test Adapter", kind: "external" },
      workspacePath: "/workspace",
      tracePath: "/trace",
      task: { id: "t", metadata: {} }
    };
  }

  function makeAdapterResult(overrides = {}) {
    return {
      status: "success",
      summary: "done",
      tokenUsage: 1000,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFilesHint: [],
      ...overrides
    };
  }

  function build(adapterResult, diffReliable = true) {
    return buildFinalResult(
      mockPreflight,
      makeContext(),
      adapterResult,
      undefined, // adapterError
      Date.now() - 1000, // startedAt
      [], // setupResults
      [], // judgeResults
      [], // teardownResults
      { added: [], changed: [], removed: [], skippedLargeFiles: [] }, // diff
      [], // changedFiles
      undefined, // diffPrecision
      false, // cancelled
      true, // success
      undefined, // assembledPrompt
      diffReliable
    );
  }

  it("propagates dataQualityWarning from adapterResult to final result", () => {
    const warning = "CLI output format changed — data may be inaccurate.";
    const result = build(makeAdapterResult({ dataQualityWarning: warning }));
    assert.equal(result.dataQualityWarning, warning);
  });

  it("leaves dataQualityWarning undefined when adapterResult has none", () => {
    const result = build(makeAdapterResult());
    assert.equal(result.dataQualityWarning, undefined);
  });

  it("propagates diff reliability to the final result", () => {
    const result = build(makeAdapterResult(), false);
    assert.equal(result.diffReliable, false);
  });

  it("propagates dataQualityWarning alongside tokenUsageReliable: false", () => {
    // Adapters set both when a format mismatch is detected.
    const result = build(makeAdapterResult({
      dataQualityWarning: "format mismatch",
      tokenUsageReliable: false
    }));
    assert.equal(result.dataQualityWarning, "format mismatch");
    assert.equal(result.tokenUsageReliable, false);
    assert.equal(result.tokenEfficiencyScore, undefined, "Unreliable tokens must not produce an efficiency score");
  });

  it("createBaseResult passes dataQualityWarning through directly", () => {
    const result = createBaseResult({
      preflight: mockPreflight,
      tracePath: "/trace",
      workspacePath: "/workspace",
      dataQualityWarning: "direct warning"
    });
    assert.equal(result.dataQualityWarning, "direct warning");
  });

  it("createBaseResult passes trace integrity fields through directly", () => {
    const result = createBaseResult({
      preflight: mockPreflight,
      tracePath: "/trace",
      workspacePath: "/workspace",
      traceWriteFailed: true,
      traceDroppedWrites: 7
    });
    assert.equal(result.traceWriteFailed, true);
    assert.equal(result.traceDroppedWrites, 7);
  });
});