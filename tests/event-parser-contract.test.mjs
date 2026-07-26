/**
 * Contract tests for event parsers.
 *
 * These tests validate that parsers correctly extract data from sample CLI output.
 * If a CLI updates its output format, these tests will fail — update the fixtures
 * AND docs/adr/ADR-001-adapter-cli-contract.md when that happens.
 *
 * @see docs/adr/ADR-001-adapter-cli-contract.md
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// We need to import from the built output since the source is TypeScript.
// The test runner runs after `pnpm build`, so dist/ should exist.
import { parseCodexEvents, parseStreamJsonEvents } from "../packages/adapters/dist/event-parsers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures", "event-parsers");

function loadFixture(name) {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

describe("event-parser contracts", () => {
  describe("parseCodexEvents", () => {
    it("extracts thread_id from thread.started event", () => {
      const stdout = loadFixture("codex-sample.jsonl");
      const result = parseCodexEvents(stdout, "/workspace");
      assert.equal(result.threadId, "thread_abc123");
    });

    it("extracts summary from agent_message event", () => {
      const stdout = loadFixture("codex-sample.jsonl");
      const result = parseCodexEvents(stdout, "/workspace");
      assert.ok(result.summaryFromEvents?.includes("analyze the codebase"));
    });

    it("extracts changed files from file_change event", () => {
      const stdout = loadFixture("codex-sample.jsonl");
      const result = parseCodexEvents(stdout, "/workspace");
      assert.ok(result.changedFilesHint.length > 0, `Expected changed files, got: ${JSON.stringify(result.changedFilesHint)}`);
    });

    it("extracts token usage from turn.completed event", () => {
      const stdout = loadFixture("codex-sample.jsonl");
      const result = parseCodexEvents(stdout, "/workspace");
      // 1500 + 500 + 800 = 2800
      assert.equal(result.tokenUsage, 2800);
      assert.equal(result.tokenCountSuspicious, false, "Normal output should not be flagged");
    });

    it("extracts runtime info from nested string values", () => {
      const stdout = loadFixture("codex-sample.jsonl");
      const result = parseCodexEvents(stdout, "/workspace");
      assert.equal(result.resolvedRuntime?.effectiveModel, "o3");
      assert.equal(result.resolvedRuntime?.effectiveReasoningEffort, "medium");
    });

    it("warns when turn.completed events produce zero tokens", () => {
      // Simulate a CLI that changed its field names
      const brokenOutput = '{"type":"turn.completed","usage":{"prompt_tokens":100,"completion_tokens":50}}\n';
      const result = parseCodexEvents(brokenOutput, "/workspace");
      assert.equal(result.tokenUsage, 0, "Should be 0 because field names don't match");
      assert.equal(result.tokenCountSuspicious, true, "Should flag suspicious token count");
      // Adapter consumers must treat this as tokenUsageReliable: false (codex-adapter).
      assert.equal(result.formatMismatch, false, "field rename alone is not a majority schema mismatch");
    });

    it("handles empty stdout gracefully", () => {
      const result = parseCodexEvents("", "/workspace");
      assert.equal(result.tokenUsage, 0);
      assert.deepEqual(result.changedFilesHint, []);
      assert.equal(result.threadId, undefined);
    });

    it("handles ANSI-polluted stdout", () => {
      const ansiLine = '\x1b[32m{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":50}}\x1b[0m\n';
      const result = parseCodexEvents(ansiLine, "/workspace");
      assert.equal(result.tokenUsage, 150);
    });

    it("does NOT flag formatMismatch when all events are recognized", () => {
      const stdout = loadFixture("codex-sample.jsonl");
      const result = parseCodexEvents(stdout, "/workspace");
      assert.equal(result.formatMismatch, false, "Recognized events should not trigger formatMismatch");
    });

    it("flags formatMismatch when majority of typed events are unrecognized", () => {
      // Simulate a CLI that renamed its event types.
      // 3 unrecognized typed events + 0 recognized → ratio = 1.0 ≥ 0.5
      const changedSchema = [
        '{"type":"thread.begin","thread_id":"t1"}',
        '{"type":"item.finished","item":{"type":"message","text":"hi"}}',
        '{"type":"turn.done","usage":{"in_tokens":100,"out_tokens":50}}',
      ].join("\n") + "\n";
      const result = parseCodexEvents(changedSchema, "/workspace");
      assert.equal(result.formatMismatch, true, "Unrecognized event types should trigger formatMismatch");
    });

    it("does NOT flag formatMismatch when unrecognized events are the minority", () => {
      // 2 recognized (thread.started, turn.completed) + 1 unrecognized → ratio = 1/3 < 0.5
      const mixed = [
        '{"type":"thread.started","thread_id":"t1"}',
        '{"type":"unknown.event","foo":"bar"}',
        '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}',
      ].join("\n") + "\n";
      const result = parseCodexEvents(mixed, "/workspace");
      assert.equal(result.formatMismatch, false, "Minority unrecognized events should not trigger formatMismatch");
    });

    it("treats normal Codex lifecycle events as compatible", () => {
      const stdout = [
        '{"type":"thread.started","thread_id":"t1"}',
        '{"type":"turn.started"}',
        '{"type":"item.started","item":{"type":"agent_message"}}',
        '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
        '{"type":"item.completed","item":{"type":"reasoning","text":"internal"}}',
        '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":3}}'
      ].join("\n") + "\n";
      const result = parseCodexEvents(stdout, "/workspace");
      assert.equal(result.formatMismatch, false);
      assert.equal(result.tokenUsage, 15);
      assert.equal(result.summaryFromEvents, "done");
    });

    it("does NOT flag formatMismatch when no typed events are present", () => {
      // JSON lines without a `type` field should not count toward the ratio.
      const noTypes = '{"foo":"bar","usage":{"input_tokens":10}}\n';
      const result = parseCodexEvents(noTypes, "/workspace");
      assert.equal(result.formatMismatch, false, "No typed events → no formatMismatch");
    });
  });

  describe("parseStreamJsonEvents (Claude/Gemini)", () => {
    it("extracts session_id", () => {
      const stdout = loadFixture("claude-sample.jsonl");
      const result = parseStreamJsonEvents(stdout, "test");
      assert.equal(result.sessionId, "sess_xyz789");
    });

    it("extracts summary from message content", () => {
      const stdout = loadFixture("claude-sample.jsonl");
      const result = parseStreamJsonEvents(stdout, "test");
      assert.ok(result.summaryFromEvents?.includes("type error"));
    });

    it("extracts tool calls", () => {
      const stdout = loadFixture("claude-sample.jsonl");
      const result = parseStreamJsonEvents(stdout, "test");
      assert.equal(result.toolCalls.length, 1);
      assert.equal(result.toolCalls[0].name, "Edit");
    });

    it("uses result event token count (replaces running total)", () => {
      const stdout = loadFixture("claude-sample.jsonl");
      const result = parseStreamJsonEvents(stdout, "test");
      // result event: 2000 + 600 + 100 + 300 = 3000
      assert.equal(result.tokenUsage, 3000);
      assert.equal(result.tokenCountSuspicious, false, "Normal output should not be flagged");
      assert.equal(result.tokenUsageFromResultEvent, true, "Authoritative result event was present");
    });

    it("extracts cost from result event", () => {
      const stdout = loadFixture("claude-sample.jsonl");
      const result = parseStreamJsonEvents(stdout, "test");
      assert.equal(result.estimatedCostUsd, 0.042);
      assert.equal(result.costKnown, true);
    });

    it("handles missing result event (falls back to per-message total)", () => {
      // Only the assistant message, no result event
      const partial = '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}],"usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}\n';
      const result = parseStreamJsonEvents(partial, "test");
      assert.equal(result.tokenUsage, 150);
      // No authoritative result event → the per-message sum is not trustworthy.
      assert.equal(result.tokenUsageFromResultEvent, false, "No result event seen");
    });

    it("warns when result event produces zero tokens", () => {
      const broken = '{"type":"result","result":"done","total_cost_usd":0,"usage":{"prompt_tokens":100}}\n';
      const result = parseStreamJsonEvents(broken, "test");
      assert.equal(result.tokenUsage, 0, "Should be 0 because field names don't match");
      assert.equal(result.tokenCountSuspicious, true, "Should flag suspicious token count");
    });

    it("extracts error from result event", () => {
      const errorLine = '{"type":"result","is_error":true,"error":"Rate limit exceeded","total_cost_usd":0,"usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}\n';
      const result = parseStreamJsonEvents(errorLine, "test");
      assert.equal(result.error, "Rate limit exceeded");
    });

    it("handles empty stdout gracefully", () => {
      const result = parseStreamJsonEvents("", "test");
      assert.equal(result.tokenUsage, 0);
      assert.equal(result.estimatedCostUsd, 0);
      assert.equal(result.sessionId, undefined);
    });

    it("does NOT flag formatMismatch when all events are recognized", () => {
      const stdout = loadFixture("claude-sample.jsonl");
      const result = parseStreamJsonEvents(stdout, "test");
      assert.equal(result.formatMismatch, false, "Recognized events should not trigger formatMismatch");
    });

    it("flags formatMismatch when majority of typed events are unrecognized", () => {
      // Simulate a Claude CLI that renamed its event types.
      // 3 unrecognized typed events + 0 recognized → ratio = 1.0 ≥ 0.5
      const changedSchema = [
        '{"type":"assistant_message","content":"hi"}',
        '{"type":"final_result","cost_usd":0.01}',
        '{"type":"tool_invocation","name":"Edit"}',
      ].join("\n") + "\n";
      const result = parseStreamJsonEvents(changedSchema, "test");
      assert.equal(result.formatMismatch, true, "Unrecognized event types should trigger formatMismatch");
    });

    it("does NOT flag formatMismatch when unrecognized events are the minority", () => {
      // 2 recognized (type:"result") + 1 unrecognized → ratio = 1/3 < 0.5
      // Note: lines without a `type` field don't count toward totalTypedEvents,
      // so we use two result events to ensure the ratio stays below threshold.
      const mixed = [
        '{"type":"result","result":"done","total_cost_usd":0,"usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}',
        '{"type":"result","result":"done2","total_cost_usd":0,"usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}',
        '{"type":"unknown.event","foo":"bar"}',
      ].join("\n") + "\n";
      const result = parseStreamJsonEvents(mixed, "test");
      assert.equal(result.formatMismatch, false, "Minority unrecognized events should not trigger formatMismatch");
    });
  });
});
