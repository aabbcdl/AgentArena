import assert from "node:assert/strict";
import test from "node:test";
import { listAvailableAdapters } from "../packages/adapters/dist/index.js";

test("Qwen Code adapter is registered", () => {
  const adapters = listAvailableAdapters();
  const qwen = adapters.find((a) => a.id === "qwen-code");
  assert.ok(qwen, "Qwen Code adapter should be registered");
  assert.equal(qwen.title, "Qwen Code CLI");
  assert.equal(qwen.capability.supportTier, "experimental");
  assert.equal(qwen.capability.tokenAvailability, "available");
  assert.equal(qwen.capability.costAvailability, "available");
});

test("GitHub Copilot adapter is registered", () => {
  const adapters = listAvailableAdapters();
  const copilot = adapters.find((a) => a.id === "copilot");
  assert.ok(copilot, "GitHub Copilot adapter should be registered");
  assert.equal(copilot.title, "GitHub Copilot CLI");
  assert.equal(copilot.capability.supportTier, "experimental");
  assert.equal(copilot.capability.tokenAvailability, "unavailable");
});

test("Windsurf adapter is registered as blocked", () => {
  const adapters = listAvailableAdapters();
  const windsurf = adapters.find((a) => a.id === "windsurf");
  assert.ok(windsurf, "Windsurf adapter should be registered");
  assert.ok(
    windsurf.title.includes("Coming Soon"),
    `Windsurf title should include 'Coming Soon', got: "${windsurf.title}"`
  );
  assert.equal(windsurf.capability.supportTier, "blocked");
  assert.equal(windsurf.capability.tokenAvailability, "unavailable");
});

test("All new adapters have complete capability metadata", () => {
  const adapters = listAvailableAdapters();
  const newAdapterIds = ["qwen-code", "copilot", "windsurf"];

  for (const adapterId of newAdapterIds) {
    const adapter = adapters.find((a) => a.id === adapterId);
    assert.ok(adapter, `Adapter ${adapterId} should exist`);
    assert.ok(adapter.capability.invocationMethod, `${adapterId} should have invocationMethod`);
    assert.ok(
      Array.isArray(adapter.capability.authPrerequisites),
      `${adapterId} should have authPrerequisites array`
    );
    assert.ok(
      ["available", "estimated", "unavailable"].includes(adapter.capability.tokenAvailability),
      `${adapterId} should have valid tokenAvailability, got: ${adapter.capability.tokenAvailability}`
    );
    assert.ok(
      ["full", "partial", "minimal"].includes(adapter.capability.traceRichness),
      `${adapterId} should have valid traceRichness, got: ${adapter.capability.traceRichness}`
    );
    assert.ok(
      Array.isArray(adapter.capability.knownLimitations),
      `${adapterId} should have knownLimitations array`
    );
    assert.ok(
      adapter.capability.knownLimitations.length > 0,
      `${adapterId} should have at least one known limitation`
    );
  }
});

test("Qwen Code adapter has configurable model support", () => {
  const adapters = listAvailableAdapters();
  const qwen = adapters.find((a) => a.id === "qwen-code");
  assert.ok(qwen, "Qwen Code adapter should exist");
  assert.equal(
    qwen.capability.configurableRuntime.model,
    true,
    "Qwen Code should support model configuration"
  );
});

test("GitHub Copilot adapter has no configurable runtime", () => {
  const adapters = listAvailableAdapters();
  const copilot = adapters.find((a) => a.id === "copilot");
  assert.ok(copilot, "Copilot adapter should exist");
  assert.equal(
    copilot.capability.configurableRuntime.model,
    false,
    "Copilot should not support model configuration"
  );
});
