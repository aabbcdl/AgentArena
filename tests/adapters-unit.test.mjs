import assert from "node:assert/strict";
import test from "node:test";

import { __testUtils } from "../packages/adapters/dist/index.js";

const {
  parseCodexEvents,
  parseClaudeEvents,
  parseGeminiEvents,
  agentTimeoutMs,
  formatTimeoutMessage,
  terminateProcessTree,
  readCodexConfigDefaults
} = __testUtils;

test("agentTimeoutMs returns a positive number", () => {
  const timeout = agentTimeoutMs();
  assert.ok(typeof timeout === "number");
  assert.ok(timeout > 0);
});

test("agentTimeoutMs respects AGENTARENA_AGENT_TIMEOUT_MS env var", () => {
  const original = process.env.AGENTARENA_AGENT_TIMEOUT_MS;
  try {
    process.env.AGENTARENA_AGENT_TIMEOUT_MS = "30000";
    const timeout = agentTimeoutMs();
    assert.equal(timeout, 30000);
  } finally {
    if (original !== undefined) {
      process.env.AGENTARENA_AGENT_TIMEOUT_MS = original;
    } else {
      delete process.env.AGENTARENA_AGENT_TIMEOUT_MS;
    }
  }
});

test("formatTimeoutMessage produces human-readable message", () => {
  const message = formatTimeoutMessage(60000);
  assert.ok(message.includes("60000"));
  assert.ok(message.includes("timed out"));
});

test("terminateProcessTree handles invalid PID gracefully", async () => {
  // Should not throw for invalid PID
  await terminateProcessTree(0);
  await terminateProcessTree(-1);
});

test("terminateProcessTree handles non-existent PID gracefully", async () => {
  // Use a PID that's very unlikely to exist
  await terminateProcessTree(999999999);
});

// Test event parsing
test("parseClaudeEvents handles empty input", () => {
  const result = parseClaudeEvents("");
  assert.ok(typeof result === "object");
  assert.ok(typeof result.tokenUsage === "number");
  assert.ok(typeof result.estimatedCostUsd === "number");
  assert.ok(typeof result.costKnown === "boolean");
});

test("parseClaudeEvents parses valid JSON events", () => {
  const input = JSON.stringify({ type: "assistant", message: { content: "hello" } });
  const result = parseClaudeEvents(input);
  assert.ok(typeof result === "object");
  assert.ok(typeof result.tokenUsage === "number");
});

test("parseCodexEvents handles empty input", () => {
  const result = parseCodexEvents("");
  assert.ok(typeof result === "object");
  assert.ok(typeof result.tokenUsage === "number");
});

test("parseGeminiEvents handles empty input", () => {
  const result = parseGeminiEvents("");
  assert.ok(typeof result === "object");
  assert.ok(typeof result.tokenUsage === "number");
});

// Test runtime resolution
test("readCodexConfigDefaults returns an object", async () => {
  const defaults = await readCodexConfigDefaults();
  assert.ok(typeof defaults === "object");
  assert.ok(defaults !== null);
});
