import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SUMMARY_ARTIFACT_SCHEMA,
  TRACE_ARTIFACT_SCHEMA,
  validateSummaryArtifact,
  validateTraceEvent,
} from "../packages/core/dist/index.js";
import { JsonlTraceRecorder } from "../packages/trace/dist/index.js";

test("summary artifact validation accepts current and legacy formats but rejects unsupported versions", () => {
  assert.deepEqual(validateSummaryArtifact({ artifactSchemaVersion: SUMMARY_ARTIFACT_SCHEMA, runId: "r", results: [] }).errors, []);
  assert.equal(validateSummaryArtifact({ runId: "legacy", results: [] }).legacy, true);
  assert.equal(validateSummaryArtifact({ artifactSchemaVersion: "agentarena.summary/v99", runId: "r", results: [] }).ok, false);
});

test("trace recorder writes schema version and validator rejects malformed events", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentarena-trace-schema-"));
  const tracePath = path.join(dir, "trace.jsonl");
  try {
    const recorder = new JsonlTraceRecorder(tracePath);
    await recorder.record({ timestamp: new Date().toISOString(), agentId: "a", type: "adapter.start", message: "start" });
    await recorder.close();
    const event = JSON.parse((await readFile(tracePath, "utf8")).trim());
    assert.equal(event.schemaVersion, TRACE_ARTIFACT_SCHEMA);
    assert.equal(validateTraceEvent(event).ok, true);
    assert.equal(validateTraceEvent({ schemaVersion: TRACE_ARTIFACT_SCHEMA, type: "adapter.start" }).ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
