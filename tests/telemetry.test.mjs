import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isTelemetryEnabled,
  recordTelemetryEvent,
} from "../packages/core/dist/telemetry.js";

const ENV_VAR = "AGENTARENA_TELEMETRY";
const FILE_VAR = "AGENTARENA_TELEMETRY_FILE";

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test("isTelemetryEnabled is OFF by default", () =>
  withEnv({ [ENV_VAR]: undefined }, () => {
    assert.equal(isTelemetryEnabled(), false);
  }));

test("isTelemetryEnabled is ON when env is 1 or true", async () => {
  await withEnv({ [ENV_VAR]: "1" }, () => assert.equal(isTelemetryEnabled(), true));
  await withEnv({ [ENV_VAR]: "true" }, () => assert.equal(isTelemetryEnabled(), true));
  await withEnv({ [ENV_VAR]: "0" }, () => assert.equal(isTelemetryEnabled(), false));
});

test("recordTelemetryEvent is a no-op when disabled (no file written)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aa-telemetry-"));
  const filePath = path.join(tmpDir, "telemetry.jsonl");
  await withEnv({ [ENV_VAR]: undefined, [FILE_VAR]: filePath }, async () => {
    await recordTelemetryEvent("app_opened", { a: 1 });
    // File should not exist because telemetry is disabled.
    await assert.rejects(fs.access(filePath), /ENOENT/);
  });
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("recordTelemetryEvent appends a JSONL line when enabled", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aa-telemetry-"));
  const filePath = path.join(tmpDir, "telemetry.jsonl");
  await withEnv({ [ENV_VAR]: "1", [FILE_VAR]: filePath }, async () => {
    await recordTelemetryEvent("run_started", { agentCount: 3, taskPackId: "demo" });
    await recordTelemetryEvent("run_completed", { outcome: "completed", successCount: 2, totalCount: 3 });

    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 2);

    const first = JSON.parse(lines[0]);
    assert.equal(first.schema, "agentarena.telemetry/v1");
    assert.equal(first.event, "run_started");
    assert.equal(first.props.agentCount, 3);
    assert.equal(first.props.taskPackId, "demo");
    assert.ok(first.sessionId, "sessionId should be present");
    assert.ok(first.installId, "installId should be present");
    assert.ok(first.ts, "timestamp should be present");

    const second = JSON.parse(lines[1]);
    assert.equal(second.event, "run_completed");
    assert.equal(second.props.outcome, "completed");
  });
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("recordTelemetryEvent redacts sensitive-looking keys", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aa-telemetry-"));
  const filePath = path.join(tmpDir, "telemetry.jsonl");
  await withEnv({ [ENV_VAR]: "1", [FILE_VAR]: filePath }, async () => {
    await recordTelemetryEvent("app_opened", { token: "sk-secret", password: "hunter2", safe: "ok" });
    const content = await fs.readFile(filePath, "utf8");
    const entry = JSON.parse(content.trim());
    assert.equal(entry.props.token, "****");
    assert.equal(entry.props.password, "****");
    assert.equal(entry.props.safe, "ok");
  });
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("recordTelemetryEvent never throws on write failure", async () => {
  // Point at an unwritable path inside a non-existent nested dir without
  // mkdir rights simulation is hard cross-platform; instead point the file
  // at a path whose parent is a file (causes ENOTDIR).
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aa-telemetry-"));
  const blockingFile = path.join(tmpDir, "blocker");
  await fs.writeFile(blockingFile, "x");
  const badPath = path.join(blockingFile, "telemetry.jsonl");
  await withEnv({ [ENV_VAR]: "1", [FILE_VAR]: badPath }, async () => {
    // Must not throw — telemetry failures are swallowed.
    await recordTelemetryEvent("app_opened", {});
    assert.ok(true, "did not throw");
  });
  await fs.rm(tmpDir, { recursive: true, force: true });
});


test("readTelemetrySummary returns only aggregate funnel, entry point, and integrity counts", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aa-telemetry-summary-"));
  const filePath = path.join(tmpDir, "telemetry.jsonl");
  try {
    await withEnv({ [ENV_VAR]: "1", [FILE_VAR]: filePath }, async () => {
      await recordTelemetryEvent("app_opened", { entryPoint: "workbench" });
      await recordTelemetryEvent("run_started", { entryPoint: "workbench-plan", taskPackId: "secret-task" });
      await recordTelemetryEvent("run_completed", { entryPoint: "workbench-plan", resultIntegrity: "complete", outcome: "completed" });
      await recordTelemetryEvent("result_viewed", { entryPoint: "workbench", resultIntegrity: "complete", token: "secret" });

      const telemetryModule = await import("../packages/core/dist/telemetry.js");
      assert.equal(typeof telemetryModule.readTelemetrySummary, "function");
      const summary = await telemetryModule.readTelemetrySummary();
      assert.deepEqual(summary.events, {
        app_opened: 1,
        run_started: 1,
        run_completed: 1,
        result_viewed: 1,
        preflight_completed: 0,
        evidence_opened: 0,
      });
      assert.equal(summary.entryPoints.workbench, 2);
      assert.equal(summary.entryPoints["workbench-plan"], 2);
      assert.equal(summary.resultIntegrity.complete, 2);
      assert.equal(JSON.stringify(summary).includes("secret-task"), false);
      assert.equal(JSON.stringify(summary).includes("secret"), false);
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
