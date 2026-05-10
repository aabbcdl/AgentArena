/**
 * Unit tests for API route handlers (api-routes.ts).
 *
 * These are pure functions that accept request data and return ApiResponse objects,
 * so they can be tested without starting an HTTP server.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdaptersList,
  handleAdhocTaskpacksList,
  handleCreateAdhocTaskpack,
  handlePreflight,
  handleProviderProfileCreate,
  handleProviderProfileDelete,
  handleProviderProfileSecret,
  handleProviderProfileUpdate,
  handleTaskpacksList,
  handleUiInfo,
} from "../packages/cli/dist/commands/api-routes.js";

// ─── handlePreflight tests ───

test("handlePreflight: returns 400 for invalid JSON", async () => {
  const res = await handlePreflight("not-json");
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("Invalid JSON"));
});

test("handlePreflight: returns 400 for missing baseAgentId", async () => {
  const res = await handlePreflight(JSON.stringify({ displayLabel: "Test" }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("baseAgentId"));
});

test("handlePreflight: returns 200 for valid demo-fast selection", async () => {
  const res = await handlePreflight(JSON.stringify({ baseAgentId: "demo-fast" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.status || body.preflight, "should return preflight result");
});

// ─── handleAdaptersList tests ───

test("handleAdaptersList: returns adapter list with demo adapters", async () => {
  const res = await handleAdaptersList();
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body), "should return an array");
  assert.ok(body.length > 0, "should have adapters");
  const demoFast = body.find((a) => a.id === "demo-fast");
  assert.ok(demoFast, "should include demo-fast adapter");
  assert.equal(demoFast.kind, "demo");
  assert.ok(demoFast.capability, "should include capability");
});

// ─── handleCreateAdhocTaskpack tests ───

test("handleCreateAdhocTaskpack: returns 400 for missing prompt", async () => {
  const res = await handleCreateAdhocTaskpack(JSON.stringify({ title: "Test" }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("prompt"));
});

test("handleCreateAdhocTaskpack: returns 400 for empty prompt", async () => {
  const res = await handleCreateAdhocTaskpack(JSON.stringify({ prompt: "   " }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("prompt"));
});

test("handleCreateAdhocTaskpack: returns 400 for invalid JSON", async () => {
  const res = await handleCreateAdhocTaskpack("not-json");
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("Invalid JSON"));
});

test("handleCreateAdhocTaskpack: creates adhoc taskpack with valid prompt", async () => {
  const res = await handleCreateAdhocTaskpack(JSON.stringify({
    prompt: "Fix the authentication bug",
    title: "Auth Fix"
  }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.id, "should return taskpack id");
  assert.ok(body.path, "should return taskpack path");
  assert.equal(body.title, "Auth Fix");
});

// ─── handleProviderProfileCreate tests ───

test("handleProviderProfileCreate: returns 400 for invalid JSON", async () => {
  const res = await handleProviderProfileCreate("not-json");
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("Invalid JSON"));
});

test("handleProviderProfileCreate: returns 400 for missing name", async () => {
  const res = await handleProviderProfileCreate(JSON.stringify({
    kind: "anthropic-compatible",
    apiFormat: "anthropic-messages"
  }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("name"));
});

test("handleProviderProfileCreate: returns 400 for missing kind", async () => {
  const res = await handleProviderProfileCreate(JSON.stringify({
    name: "Test",
    apiFormat: "anthropic-messages"
  }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("kind"));
});

test("handleProviderProfileCreate: returns 400 for missing apiFormat", async () => {
  const res = await handleProviderProfileCreate(JSON.stringify({
    name: "Test",
    kind: "anthropic-compatible"
  }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("apiFormat"));
});

// ─── handleProviderProfileUpdate tests ───

test("handleProviderProfileUpdate: returns 400 for invalid JSON", async () => {
  const res = await handleProviderProfileUpdate("some-id", "not-json");
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("Invalid JSON"));
});

// ─── handleProviderProfileSecret tests ───

test("handleProviderProfileSecret: returns 400 for invalid JSON", async () => {
  const res = await handleProviderProfileSecret("some-id", "not-json");
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("Invalid JSON"));
});

test("handleProviderProfileSecret: returns 400 for secret exceeding max length", async () => {
  const res = await handleProviderProfileSecret("some-id", JSON.stringify({ secret: "x".repeat(10001) }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("10,000"));
});

// ─── handleProviderProfileDelete tests ───

test("handleProviderProfileDelete: returns 403 for official profile deletion", async () => {
  const res = await handleProviderProfileDelete("claude-official");
  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.body);
  assert.ok(/cannot be deleted/i.test(body.error), "should contain 'cannot be deleted' in error");
});

// ─── handleAdhocTaskpacksList tests ───

test("handleAdhocTaskpacksList: returns array (empty or with items)", async () => {
  const res = await handleAdhocTaskpacksList();
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body), "should return an array");
});

// ─── handleTaskpacksList tests ───

test("handleTaskpacksList: returns taskpack list", async () => {
  const res = await handleTaskpacksList();
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body), "should return an array");
});

// ─── handleUiInfo tests ───

test("handleUiInfo: returns correct structure", async () => {
  const res = await handleUiInfo({ model: "test-model" }, "localhost", 4320, true);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.mode, "local-service");
  assert.ok(typeof body.repoPath === "string");
  assert.ok(Array.isArray(body.claudeProviderProfiles));
  assert.equal(body.authRequired, false, "localhost should not require auth");
});

test("handleUiInfo: authRequired is true for non-localhost", async () => {
  const res = await handleUiInfo({}, "0.0.0.0", 4320, false);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.authRequired, true, "non-localhost should require auth");
});
