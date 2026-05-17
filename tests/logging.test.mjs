import assert from "node:assert/strict";
import test from "node:test";
import { createLogEntry } from "../packages/core/dist/index.js";

test("createLogEntry creates a valid log entry", () => {
  const entry = createLogEntry(
    "info",
    "agent",
    "execute",
    "Agent execution started",
    {
      runId: "test-run-123",
      agentId: "codex",
      variantId: "codex-gpt-4",
      metadata: { task: "repo-health" }
    }
  );

  assert.equal(entry.level, "info");
  assert.equal(entry.component, "agent");
  assert.equal(entry.action, "execute");
  assert.equal(entry.message, "Agent execution started");
  assert.equal(entry.runId, "test-run-123");
  assert.equal(entry.agentId, "codex");
  assert.equal(entry.variantId, "codex-gpt-4");
  assert.deepEqual(entry.metadata, { task: "repo-health" });
  assert.ok(entry.timestamp);
});

test("createLogEntry handles errors", () => {
  const error = new Error("Test error");
  const entry = createLogEntry(
    "error",
    "trace",
    "write",
    "Failed to write trace",
    { error }
  );

  assert.equal(entry.level, "error");
  assert.equal(entry.component, "trace");
  assert.equal(entry.action, "write");
  assert.equal(entry.message, "Failed to write trace");
  assert.equal(entry.error, error);
});

test("createLogEntry redacts sensitive data", () => {
  const entry = createLogEntry(
    "info",
    "auth",
    "login",
    "User login",
    {
      metadata: {
        password: "secret123",
        token: "Bearer sk-12345",
        apiKey: "key-abc123",
        normal: "visible"
      }
    }
  );

  assert.equal(entry.metadata.normal, "visible");
  assert.ok(entry.metadata.password.includes("[REDACTED]") || entry.metadata.password === "[REDACTED]");
});

test("createLogEntry works without optional fields", () => {
  const entry = createLogEntry(
    "warn",
    "system",
    "startup",
    "System started"
  );

  assert.equal(entry.level, "warn");
  assert.equal(entry.component, "system");
  assert.equal(entry.action, "startup");
  assert.equal(entry.message, "System started");
  assert.equal(entry.runId, undefined);
  assert.equal(entry.agentId, undefined);
  assert.equal(entry.variantId, undefined);
  assert.deepEqual(entry.metadata, undefined);
  assert.equal(entry.error, undefined);
});

test("createLogEntry supports all log levels", () => {
  const levels = ["debug", "info", "warn", "error"];
  for (const level of levels) {
    const entry = createLogEntry(level, "test", "test", "test message");
    assert.equal(entry.level, level);
  }
});
