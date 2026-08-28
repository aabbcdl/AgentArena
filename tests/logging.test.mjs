import assert from "node:assert/strict";
import test from "node:test";
import { createLogEntry, redactSensitiveStrings, redactSensitiveText } from "../packages/core/dist/index.js";

// All level/component values match the TypeScript types in
// packages/core/src/logging.ts:
//   LogLevel     = "DEBUG" | "INFO" | "WARN" | "ERROR"
//   LogComponent = "runner" | "server" | "trace" | "publish" | "judge" | "adapter" | "core"
// The previous version of these tests used lowercase "info"/"error" plus
// invented components ("agent", "auth", "system") that violate the contract —
// they passed only because the JS runtime doesn't enforce TS types, locking in
// log output with wrong casing.

test("createLogEntry creates a valid log entry", () => {
  const entry = createLogEntry(
    "INFO",
    "adapter",
    "execute",
    "Agent execution started",
    {
      runId: "test-run-123",
      agentId: "codex",
      variantId: "codex-gpt-4",
      metadata: { task: "repo-health" }
    }
  );

  assert.equal(entry.level, "INFO");
  assert.equal(entry.component, "adapter");
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
    "ERROR",
    "trace",
    "write",
    "Failed to write trace",
    { error }
  );

  assert.equal(entry.level, "ERROR");
  assert.equal(entry.component, "trace");
  assert.equal(entry.action, "write");
  assert.equal(entry.message, "Failed to write trace");
  assert.equal(entry.error.name, "Error");
  assert.equal(entry.error.message, "Test error");
  assert.ok(entry.error.stack);
});

test("createLogEntry redacts sensitive data", () => {
  const entry = createLogEntry(
    "INFO",
    "server",
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
  assert.notEqual(entry.metadata.password, "secret123");
  assert.ok(entry.metadata.password.includes("****") || entry.metadata.password === "***");
});

test("free-text redaction removes full credential values instead of preserving regex captures", () => {
  const openAiToken = ["sk-", "abcdefghijklmnopqrstuvwxyz", "123456"].join("");
  const githubToken = ["ghp_", "abcdefghijklmnopqrstuvwxyz", "123456"].join("");
  const knownProviderSecret = "provider-secret-without-a-known-prefix";
  const text = `Bearer ${openAiToken} api_key=${knownProviderSecret} github=${githubToken}`;

  const redacted = redactSensitiveText(text, [knownProviderSecret]);
  assert.doesNotMatch(redacted, new RegExp(openAiToken));
  assert.doesNotMatch(redacted, new RegExp(githubToken));
  assert.doesNotMatch(redacted, new RegExp(knownProviderSecret));
  assert.match(redacted, /Bearer \[redacted\]/);

  const nested = redactSensitiveStrings({ message: text, values: [knownProviderSecret] }, [knownProviderSecret]);
  assert.doesNotMatch(JSON.stringify(nested), /provider-secret-without-a-known-prefix/);
});

test("createLogEntry scrubs credential text from the message, error message, and stack", () => {
  const token = ["sk-", "abcdefghijklmnopqrstuvwxyz", "123456"].join("");
  const entry = createLogEntry(
    "ERROR",
    "adapter",
    "provider.failure",
    `Provider rejected token=${token}`,
    { error: new Error(`Provider rejected ${token}`) }
  );
  assert.doesNotMatch(JSON.stringify(entry), new RegExp(token));
});

test("createLogEntry works without optional fields", () => {
  const entry = createLogEntry(
    "WARN",
    "core",
    "startup",
    "System started"
  );

  assert.equal(entry.level, "WARN");
  assert.equal(entry.component, "core");
  assert.equal(entry.action, "startup");
  assert.equal(entry.message, "System started");
  assert.equal(entry.runId, undefined);
  assert.equal(entry.agentId, undefined);
  assert.equal(entry.variantId, undefined);
  assert.deepEqual(entry.metadata, undefined);
  assert.equal(entry.error, undefined);
});

test("createLogEntry supports every documented log level", () => {
  const levels = ["DEBUG", "INFO", "WARN", "ERROR"];
  for (const level of levels) {
    const entry = createLogEntry(level, "core", "test", "test message");
    assert.equal(entry.level, level);
  }
});

test("createLogEntry supports every documented component", () => {
  const components = ["runner", "server", "trace", "publish", "judge", "adapter", "core"];
  for (const component of components) {
    const entry = createLogEntry("INFO", component, "test", "test message");
    assert.equal(entry.component, component);
  }
});

test("createLogEntry preserves metadata across redaction depth limit", () => {
  // redactObject has a depth cap of 10; verify deeply nested non-sensitive
  // values survive at least to depth 5.
  const deep = { a: { b: { c: { d: { e: { value: "ok" } } } } } };
  const entry = createLogEntry("INFO", "core", "test", "deep nest", { metadata: deep });
  assert.equal(entry.metadata.a.b.c.d.e.value, "ok");
});

test("createLogEntry truncates arrays beyond 100 entries", () => {
  // redactObject slices arrays at 100 to keep log lines bounded.
  const big = { items: Array.from({ length: 250 }, (_, i) => i) };
  const entry = createLogEntry("INFO", "core", "test", "array cap", { metadata: big });
  assert.equal(entry.metadata.items.length, 100);
});
