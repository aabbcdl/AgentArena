/**
 * Contract tests: stable JSON shapes exposed by UI HTTP handlers (api-routes).
 * If these fail, web-report or other clients likely need coordinated updates.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { handleAdaptersList, handleUiInfo } from "../packages/cli/dist/commands/api-routes.js";

/** Keys returned by handleUiInfo — consumed by web-report launcher / settings. */
const UI_INFO_STABLE_KEYS = [
  "mode",
  "repoPath",
  "defaultTaskPath",
  "defaultOutputPath",
  "codexDefaults",
  "claudeProviderProfiles",
  "riskNotice",
  "host",
  "port",
  "authRequired",
];

test("contract: handleUiInfo exposes stable keys", async () => {
  const res = await handleUiInfo({ model: "dummy" }, "127.0.0.1", 4320, true);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  for (const key of UI_INFO_STABLE_KEYS) {
    assert.ok(key in body, `missing stable key "${key}"`);
  }
  assert.equal(body.mode, "local-service");
  assert.ok(Array.isArray(body.claudeProviderProfiles));
});

test("contract: handleAdaptersList entries expose stable adapter fields", async () => {
  const res = await handleAdaptersList();
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body) && body.length > 0);
  const demo = body.find((a) => a.id === "demo-fast");
  assert.ok(demo, "expected demo-fast adapter");
  for (const key of ["id", "title", "kind", "capability"]) {
    assert.ok(key in demo, `adapter missing "${key}"`);
  }
});
