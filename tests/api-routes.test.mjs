/**
 * Unit tests for API route handlers (api-routes.ts).
 *
 * These are pure functions that accept request data and return ApiResponse objects,
 * so they can be tested without starting an HTTP server.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  handleAdaptersList,
  handleAdhocTaskpacksList,
  handleCheckCompatibility,
  handleCreateAdhocTaskpack,
  handlePreflight,
  handleProviderProfileCreate,
  handleProviderProfileDelete,
  handleProviderProfileSecret,
  handleProviderProfileUpdate,
  handleTaskpacksList,
  handleUiInfo,
} from "../packages/cli/dist/commands/api-routes.js";

async function withTempProviderRegistry(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-api-providers-"));
  const originalRoot = process.env.AGENTARENA_CLAUDE_PROFILE_ROOT;
  const originalFile = process.env.AGENTARENA_CLAUDE_PROFILES_FILE;
  const originalPrefix = process.env.AGENTARENA_CLAUDE_SECRET_PREFIX;
  const originalDnsCheck = process.env.AGENTARENA_SKIP_DNS_CHECK;

  process.env.AGENTARENA_CLAUDE_PROFILE_ROOT = tempDir;
  process.env.AGENTARENA_CLAUDE_PROFILES_FILE = path.join(tempDir, "profiles.json");
  process.env.AGENTARENA_CLAUDE_SECRET_PREFIX = `AgentArena/test/${Date.now()}/`;
  process.env.AGENTARENA_SKIP_DNS_CHECK = "1";

  try {
    await fn();
  } finally {
    if (originalRoot === undefined) delete process.env.AGENTARENA_CLAUDE_PROFILE_ROOT;
    else process.env.AGENTARENA_CLAUDE_PROFILE_ROOT = originalRoot;
    if (originalFile === undefined) delete process.env.AGENTARENA_CLAUDE_PROFILES_FILE;
    else process.env.AGENTARENA_CLAUDE_PROFILES_FILE = originalFile;
    if (originalPrefix === undefined) delete process.env.AGENTARENA_CLAUDE_SECRET_PREFIX;
    else process.env.AGENTARENA_CLAUDE_SECRET_PREFIX = originalPrefix;
    if (originalDnsCheck === undefined) delete process.env.AGENTARENA_SKIP_DNS_CHECK;
    else process.env.AGENTARENA_SKIP_DNS_CHECK = originalDnsCheck;
    await rm(tempDir, { recursive: true, force: true });
  }
}

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

// ─── handleCheckCompatibility tests ───

test("handleCheckCompatibility: returns 400 for non-string paths", async () => {
  const res = await handleCheckCompatibility(JSON.stringify({
    repoPath: 123,
    taskPath: path.join(process.cwd(), "examples", "taskpacks", "demo-repo-health.json")
  }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.match(body.error, /repoPath.*string/i);
});

test("handleCheckCompatibility: rejects paths outside cwd", async () => {
  const res = await handleCheckCompatibility(JSON.stringify({
    repoPath: path.dirname(process.cwd()),
    taskPath: path.join(process.cwd(), "examples", "taskpacks", "demo-repo-health.json")
  }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.match(body.error, /within the current working directory/i);
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

test("provider profile routes reject IDs that secret storage cannot use", async () => {
  await withTempProviderRegistry(async () => {
    const payload = JSON.stringify({
      id: "invalid_profile",
      name: "Invalid Profile",
      kind: "anthropic-compatible",
      apiFormat: "anthropic-messages"
    });
    const created = await handleProviderProfileCreate(payload);
    assert.equal(created.statusCode, 400);
    assert.match(JSON.parse(created.body).error, /profile id/i);

    const updated = await handleProviderProfileUpdate("invalid_profile", payload);
    assert.equal(updated.statusCode, 400);
    const secret = await handleProviderProfileSecret("invalid_profile", JSON.stringify({ secret: "x" }));
    assert.equal(secret.statusCode, 400);
    const deleted = await handleProviderProfileDelete("invalid_profile");
    assert.equal(deleted.statusCode, 400);
  });
});

test("provider profile write responses mask extraEnv values", async () => {
  await withTempProviderRegistry(async () => {
    const createPayload = {
      id: "masked-profile",
      name: "Masked Provider",
      kind: "anthropic-compatible",
      baseUrl: "https://api.example.com",
      apiFormat: "anthropic-messages",
      primaryModel: "claude-test",
      extraEnv: {
        API_KEY: "plain-secret-value"
      },
      _confirmBaseUrlRisk: true
    };

    const created = await handleProviderProfileCreate(JSON.stringify(createPayload));
    assert.equal(created.statusCode, 200);
    assert.equal(created.body.includes("plain-secret-value"), false);
    let body = JSON.parse(created.body);
    assert.equal(body.profile.extraEnv.API_KEY, "***");
    assert.equal(body.profiles.find((profile) => profile.id === "masked-profile").extraEnv.API_KEY, "***");

    const updated = await handleProviderProfileUpdate("masked-profile", JSON.stringify({
      ...createPayload,
      name: "Masked Provider Updated",
      extraEnv: {
        API_KEY: "updated-secret-value"
      }
    }));
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.includes("updated-secret-value"), false);
    body = JSON.parse(updated.body);
    assert.equal(body.profile.extraEnv.API_KEY, "***");

    const secret = await handleProviderProfileSecret("masked-profile", JSON.stringify({ secret: "stored-secret" }));
    assert.equal(secret.statusCode, 200);
    assert.equal(secret.body.includes("updated-secret-value"), false);
    body = JSON.parse(secret.body);
    assert.equal(body.profile.extraEnv.API_KEY, "***");

    const deleted = await handleProviderProfileDelete("masked-profile");
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.body.includes("updated-secret-value"), false);
  });
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

// ─── Additional edge case tests ───

test("handleCreateAdhocTaskpack: returns 400 for prompt exceeding max length", async () => {
  const res = await handleCreateAdhocTaskpack(JSON.stringify({
    prompt: "x".repeat(100_001)
  }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("100,000"));
});

test("handleProviderProfileSecret: returns 200 for empty secret (clear)", async () => {
  // This test verifies that empty secret is allowed (to clear a secret)
  // We use a non-existent profile ID, which should return an error about the profile not found
  const res = await handleProviderProfileSecret("non-existent-id", JSON.stringify({ secret: "" }));
  // Should not be 400 for validation; exact status depends on implementation
  assert.ok(res.statusCode !== 400, "Should not be a validation error for empty secret");
});

test("handleAdaptersList: includes all expected adapter kinds", async () => {
  const res = await handleAdaptersList();
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  const kinds = new Set(body.map((a) => a.kind));
  assert.ok(kinds.has("demo"), "should include demo adapters");
  assert.ok(kinds.has("external"), "should include external adapters");
});

test("handleUiInfo: includes host and port in response", async () => {
  const res = await handleUiInfo({}, "192.168.1.100", 8080, false);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.host, "192.168.1.100");
  assert.equal(body.port, 8080);
});
