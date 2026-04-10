import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { InMemoryTraceRecorder, JsonlTraceRecorder } from "../packages/trace/dist/index.js";

function tempDir() {
  return path.join(tmpdir(), `agentarena-trace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

test("JsonlTraceRecorder records and reads events", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  await recorder.record({
    timestamp: "2026-01-01T00:00:00Z",
    agentId: "demo-fast",
    type: "info",
    message: "hello"
  });
  await recorder.record({
    timestamp: "2026-01-01T00:00:01Z",
    agentId: "demo-fast",
    type: "error",
    message: "oops"
  });

  const events = await recorder.readAll();
  assert.equal(events.length, 2);
  assert.equal(events[0].message, "hello");
  assert.equal(events[1].type, "error");

  // Cleanup
  await fs.rm(dir, { recursive: true, force: true });
});

test("JsonlTraceRecorder query filters by agentId and type", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  await recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "a", type: "info", message: "a-info" });
  await recorder.record({ timestamp: "2026-01-01T00:00:01Z", agentId: "b", type: "error", message: "b-error" });
  await recorder.record({ timestamp: "2026-01-01T00:00:02Z", agentId: "a", type: "error", message: "a-error" });

  const byAgent = await recorder.query({ filter: { agentId: "a" } });
  assert.equal(byAgent.length, 2);

  const byType = await recorder.query({ filter: { type: "error" } });
  assert.equal(byType.length, 2);

  const combined = await recorder.query({ filter: { agentId: "a", type: "error" } });
  assert.equal(combined.length, 1);
  assert.equal(combined[0].message, "a-error");

  await fs.rm(dir, { recursive: true, force: true });
});

test("JsonlTraceRecorder query supports limit, offset, and reverse", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  for (let i = 0; i < 5; i++) {
    await recorder.record({ timestamp: `2026-01-01T00:00:0${i}Z`, agentId: "a", type: "info", message: `msg-${i}` });
  }

  const limited = await recorder.query({ limit: 2 });
  assert.equal(limited.length, 2);
  assert.equal(limited[0].message, "msg-0");

  const offset = await recorder.query({ offset: 3 });
  assert.equal(offset.length, 2);
  assert.equal(offset[0].message, "msg-3");

  const reversed = await recorder.query({ reverse: true, limit: 2 });
  assert.equal(reversed[0].message, "msg-4");

  await fs.rm(dir, { recursive: true, force: true });
});

test("JsonlTraceRecorder getEventCount and getEventTypes", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  await recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "a", type: "info", message: "m1" });
  await recorder.record({ timestamp: "2026-01-01T00:00:01Z", agentId: "a", type: "error", message: "m2" });
  await recorder.record({ timestamp: "2026-01-01T00:00:02Z", agentId: "b", type: "info", message: "m3" });

  assert.equal(await recorder.getEventCount(), 3);
  assert.deepEqual(await recorder.getEventTypes(), ["error", "info"]);
  assert.deepEqual(await recorder.getAgentIds(), ["a", "b"]);

  await fs.rm(dir, { recursive: true, force: true });
});

test("JsonlTraceRecorder compress and readCompressed round-trips", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  await recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "a", type: "info", message: "compressed" });
  await recorder.record({ timestamp: "2026-01-01T00:00:01Z", agentId: "b", type: "error", message: "data" });

  const compressedPath = await recorder.compress();
  assert.ok(compressedPath.endsWith(".gz"));

  const events = await JsonlTraceRecorder.readCompressed(compressedPath);
  assert.equal(events.length, 2);
  assert.equal(events[0].message, "compressed");
  assert.equal(events[1].message, "data");

  await fs.rm(dir, { recursive: true, force: true });
});

test("JsonlTraceRecorder clear removes all events", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  await recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "a", type: "info", message: "m" });
  assert.equal(await recorder.getEventCount(), 1);

  await recorder.clear();
  const events = await recorder.readAll();
  assert.equal(events.length, 0);

  await fs.rm(dir, { recursive: true, force: true });
});

test("InMemoryTraceRecorder records, queries, and clears", async () => {
  const recorder = new InMemoryTraceRecorder();

  await recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "a", type: "info", message: "hello" });
  await recorder.recordBatch([
    { timestamp: "2026-01-01T00:00:01Z", agentId: "b", type: "error", message: "err1" },
    { timestamp: "2026-01-01T00:00:02Z", agentId: "a", type: "warn", message: "warn1" }
  ]);

  assert.equal(recorder.getEventCount(), 3);
  assert.deepEqual(recorder.getEventTypes(), ["error", "info", "warn"]);
  assert.deepEqual(recorder.getAgentIds(), ["a", "b"]);

  const filtered = recorder.query({ filter: { agentId: "a" } });
  assert.equal(filtered.length, 2);

  const reversed = recorder.query({ reverse: true, limit: 1 });
  assert.equal(reversed[0].message, "warn1");

  recorder.clear();
  assert.equal(recorder.getEventCount(), 0);
});

test("InMemoryTraceRecorder query filters by messageContains", () => {
  const recorder = new InMemoryTraceRecorder();
  recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "a", type: "info", message: "Hello World" });
  recorder.record({ timestamp: "2026-01-01T00:00:01Z", agentId: "a", type: "info", message: "Goodbye" });

  const results = recorder.query({ filter: { messageContains: "hello" } });
  assert.equal(results.length, 1);
  assert.equal(results[0].message, "Hello World");
});
