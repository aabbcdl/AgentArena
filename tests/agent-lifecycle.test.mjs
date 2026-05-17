import assert from "node:assert/strict";
import test from "node:test";

// Test the exported types and constants from the runner package
import { DEFAULT_AGENT_CONCURRENCY } from "../packages/runner/dist/index.js";

test("DEFAULT_AGENT_CONCURRENCY is a positive number", () => {
  assert.ok(typeof DEFAULT_AGENT_CONCURRENCY === "number");
  assert.ok(DEFAULT_AGENT_CONCURRENCY > 0);
});

// Test the concurrency module
import { agentConcurrency, agentExecuteTimeoutMs, resolvePositiveInt } from "../packages/runner/dist/concurrency.js";

test("agentConcurrency returns a positive number", () => {
  const concurrency = agentConcurrency({});
  assert.ok(typeof concurrency === "number");
  assert.ok(concurrency > 0);
});

test("agentConcurrency respects maxConcurrency option", () => {
  const concurrency = agentConcurrency({ maxConcurrency: 5 });
  assert.equal(concurrency, 5);
});

test("agentExecuteTimeoutMs returns a positive number", () => {
  const timeout = agentExecuteTimeoutMs();
  assert.ok(typeof timeout === "number");
  assert.ok(timeout > 0);
});

test("resolvePositiveInt returns valid positive integers", () => {
  assert.equal(resolvePositiveInt("5", 1), 5);
  assert.equal(resolvePositiveInt("0", 1), 1); // Falls back to default for non-positive
  assert.equal(resolvePositiveInt("-1", 1), 1);
  assert.equal(resolvePositiveInt("abc", 1), 1);
  assert.equal(resolvePositiveInt(undefined, 1), 1);
});

// Test the result builder module
import { createBaseResult, createCancelledRunResult, createSkippedRunResult } from "../packages/runner/dist/result-builder.js";

function makePreflight() {
  return {
    agentId: "test-agent",
    baseAgentId: "test-agent",
    variantId: "test-agent__v1",
    displayLabel: "Test Agent",
    title: "Test Agent",
    kind: "external",
    status: "ready",
    summary: "Ready",
    command: "test",
    requestedConfig: {},
    resolvedRuntime: {},
    details: {}
  };
}

test("createBaseResult produces correct result structure", () => {
  const preflight = makePreflight();
  const result = createBaseResult({
    preflight,
    tracePath: "/tmp/trace.jsonl",
    workspacePath: "/tmp/workspace",
    status: "success",
    summary: "Test completed"
  });

  assert.equal(result.agentId, "test-agent");
  assert.equal(result.baseAgentId, "test-agent");
  assert.equal(result.variantId, "test-agent__v1");
  assert.equal(result.displayLabel, "Test Agent");
  assert.equal(result.status, "success");
  assert.equal(result.summary, "Test completed");
  assert.equal(result.tracePath, "/tmp/trace.jsonl");
  assert.equal(result.workspacePath, "/tmp/workspace");
});

test("createCancelledRunResult has cancelled status", () => {
  const preflight = makePreflight();
  const result = createCancelledRunResult(
    preflight,
    "/tmp/trace.jsonl",
    "/tmp/workspace",
    "Cancelled by user"
  );

  assert.equal(result.status, "cancelled");
  assert.equal(result.summary, "Cancelled by user");
});

test("createSkippedRunResult has failed status", () => {
  const preflight = makePreflight();
  const result = createSkippedRunResult(
    preflight,
    "/tmp/trace.jsonl",
    "/tmp/workspace"
  );

  assert.equal(result.status, "failed");
  assert.equal(result.summary, preflight.summary);
});

// Test the workspace module
import { formatErrorDetails, formatErrorMessage } from "../packages/runner/dist/workspace.js";

test("formatErrorMessage extracts message from Error", () => {
  const message = formatErrorMessage(new Error("test error"));
  assert.equal(message, "test error");
});

test("formatErrorMessage handles non-Error values", () => {
  const message = formatErrorMessage("string error");
  assert.equal(message, "string error");
});

test("formatErrorDetails returns structured error info", () => {
  const details = formatErrorDetails(new Error("test error"));
  assert.equal(details.message, "test error");
  assert.ok(details.stack !== undefined);
});

test("formatErrorDetails handles non-Error values", () => {
  const details = formatErrorDetails("string error");
  assert.equal(details.message, "string error");
  assert.equal(details.stack, undefined);
});

// Test the snapshot module
import { buildDiffPrecision } from "../packages/runner/dist/snapshot.js";

test("buildDiffPrecision returns undefined when no expected paths", () => {
  const result = buildDiffPrecision(undefined, ["src/index.ts"]);
  assert.equal(result, undefined);
});

test("buildDiffPrecision returns precision data when expected paths provided", () => {
  const result = buildDiffPrecision(["src/**"], ["src/index.ts", "src/utils.ts", "README.md"]);
  assert.ok(result !== undefined);
  assert.ok(typeof result.score === "number");
  assert.ok(typeof result.expectedScopeCount === "number");
  assert.ok(typeof result.totalChangedFiles === "number");
  assert.ok(Array.isArray(result.matchedFiles));
  assert.ok(Array.isArray(result.unexpectedFiles));
});
