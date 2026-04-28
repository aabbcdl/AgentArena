import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTraceTimeline, InMemoryTraceRecorder, JsonlTraceRecorder, loadTraceEvents, TraceReplayer } from "../packages/trace/dist/index.js";

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

test("TraceReplayer loads and sorts events chronologically", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  // Record events out of order
  await recorder.record({ timestamp: "2026-01-01T00:00:02Z", agentId: "demo-fast", type: "adapter.finish", message: "done" });
  await recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "demo-fast", type: "adapter.start", message: "starting" });
  await recorder.record({ timestamp: "2026-01-01T00:00:01Z", agentId: "demo-fast", type: "adapter.info", message: "working" });

  const replayer = new TraceReplayer(filePath);
  const events = await replayer.loadEvents();

  assert.equal(events.length, 3);
  // Should be sorted by timestamp
  assert.equal(events[0].type, "adapter.start");
  assert.equal(events[1].type, "adapter.info");
  assert.equal(events[2].type, "adapter.finish");

  await fs.rm(dir, { recursive: true, force: true });
});

test("TraceReplayer builds timeline with grouped steps", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  await recorder.record({ timestamp: "2026-01-01T00:00:00.000Z", agentId: "demo-fast", type: "setup.start", message: "setup" });
  await recorder.record({ timestamp: "2026-01-01T00:00:00.050Z", agentId: "demo-fast", type: "setup.finish", message: "done" });
  await recorder.record({ timestamp: "2026-01-01T00:00:01.000Z", agentId: "demo-fast", type: "adapter.start", message: "agent" });
  await recorder.record({ timestamp: "2026-01-01T00:00:01.050Z", agentId: "demo-fast", type: "adapter.finish", message: "done" });

  const timeline = await buildTraceTimeline(filePath, { stepWindowMs: 100 });

  assert.ok(timeline.steps.length >= 2, "Should have at least 2 steps (setup and agent)");
  assert.equal(timeline.metadata.totalEvents, 4);
  assert.equal(timeline.metadata.agentId, "demo-fast");
  assert.ok(timeline.metadata.durationMs > 0);

  await fs.rm(dir, { recursive: true, force: true });
});

test("TraceReplayer stepByStep iterator yields all steps", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  await recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "a", type: "setup.start", message: "s1" });
  await recorder.record({ timestamp: "2026-01-01T00:00:01Z", agentId: "a", type: "adapter.start", message: "a1" });
  await recorder.record({ timestamp: "2026-01-01T00:00:02Z", agentId: "a", type: "judge.finish", message: "j1" });

  const replayer = new TraceReplayer(filePath);
  const steps = [];
  for await (const step of replayer.stepByStep()) {
    steps.push(step);
  }

  assert.ok(steps.length >= 3, "Should yield at least 3 steps");
  assert.equal(steps[0].category, "setup");
  assert.equal(steps[1].category, "agent");
  assert.equal(steps[2].category, "judge");

  await fs.rm(dir, { recursive: true, force: true });
});

test("TraceReplayer.compare identifies differences between timelines", async () => {
  const dir = tempDir();
  const firstPath = path.join(dir, "first.jsonl");
  const secondPath = path.join(dir, "second.jsonl");

  const firstRecorder = new JsonlTraceRecorder(firstPath);
  const secondRecorder = new JsonlTraceRecorder(secondPath);

  // First run: setup + agent + judge (with unique messages)
  await firstRecorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "a", type: "setup.start", message: "setup run 1" });
  await firstRecorder.record({ timestamp: "2026-01-01T00:00:01Z", agentId: "a", type: "adapter.start", message: "agent run 1" });
  await firstRecorder.record({ timestamp: "2026-01-01T00:00:02Z", agentId: "a", type: "judge.finish", message: "judge run 1" });

  // Second run: setup + agent (no judge) + teardown (with unique messages)
  await secondRecorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "b", type: "setup.start", message: "setup run 2" });
  await secondRecorder.record({ timestamp: "2026-01-01T00:00:01Z", agentId: "b", type: "adapter.start", message: "agent run 2" });
  await secondRecorder.record({ timestamp: "2026-01-01T00:00:02Z", agentId: "b", type: "teardown.finish", message: "teardown run 2" });

  const comparison = await TraceReplayer.compare(firstPath, secondPath);

  assert.equal(comparison.summary.firstEventCount, 3);
  assert.equal(comparison.summary.secondEventCount, 3);
  // With correct content-based comparison, different messages mean different steps
  assert.equal(comparison.onlyInFirst.length, 3, "First run has all unique steps");
  assert.equal(comparison.onlyInSecond.length, 3, "Second run has all unique steps");
  assert.equal(comparison.inBoth.length, 0, "No steps in common due to different content");
  // Verify categories are still captured in summary
  assert.ok(comparison.summary.uniqueEventTypesInFirst.includes("judge"), "Judge category in first");
  assert.ok(comparison.summary.uniqueEventTypesInSecond.includes("teardown"), "Teardown category in second");

  await fs.rm(dir, { recursive: true, force: true });
});

test("TraceReplayer.getTraceSummary returns quick diagnostics", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  await recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "demo-fast", type: "adapter.start", message: "start" });
  await recorder.record({ timestamp: "2026-01-01T00:00:01Z", agentId: "demo-fast", type: "adapter.error", message: "fail", metadata: { error: "timeout" } });

  const replayer = new TraceReplayer(filePath);
  const summary = await replayer.getTraceSummary();

  assert.ok(summary !== null);
  assert.equal(summary.agentId, "demo-fast");
  assert.equal(summary.totalEvents, 2);
  assert.equal(summary.errorCount, 1);
  assert.ok(summary.durationMs > 0);
  assert.ok(summary.categories.agent > 0);

  await fs.rm(dir, { recursive: true, force: true });
});

test("TraceReplayer.extractJudgeRelevantEvents categorizes events", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  await recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "a", type: "setup.start", message: "setup" });
  await recorder.record({ timestamp: "2026-01-01T00:00:01Z", agentId: "a", type: "adapter.start", message: "agent" });
  await recorder.record({ timestamp: "2026-01-01T00:00:02Z", agentId: "a", type: "adapter.error", message: "fail", metadata: { error: "timeout" } });
  await recorder.record({ timestamp: "2026-01-01T00:00:03Z", agentId: "a", type: "judge.finish", message: "judge" });
  await recorder.record({ timestamp: "2026-01-01T00:00:04Z", agentId: "a", type: "teardown.finish", message: "teardown" });

  const replayer = new TraceReplayer(filePath);
  const { judgeEvents, setupEvents, teardownEvents, agentExecutionEvents, errorEvents } =
    await replayer.extractJudgeRelevantEvents();

  assert.equal(judgeEvents.length, 1);
  assert.equal(setupEvents.length, 1);
  assert.equal(teardownEvents.length, 1);
  assert.equal(agentExecutionEvents.length, 2);
  assert.equal(errorEvents.length, 1);

  await fs.rm(dir, { recursive: true, force: true });
});

test("loadTraceEvents convenience function works", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  await recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "a", type: "info", message: "test" });

  const events = await loadTraceEvents(filePath);
  assert.equal(events.length, 1);
  assert.equal(events[0].message, "test");

  await fs.rm(dir, { recursive: true, force: true });
});

test("TraceFilter supports runId filtering", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "trace.jsonl");
  const recorder = new JsonlTraceRecorder(filePath);

  await recorder.record({ timestamp: "2026-01-01T00:00:00Z", agentId: "a", runId: "run-1", type: "info", message: "r1" });
  await recorder.record({ timestamp: "2026-01-01T00:00:01Z", agentId: "b", runId: "run-2", type: "info", message: "r2" });

  const run1Events = await recorder.query({ filter: { runId: "run-1" } });
  assert.equal(run1Events.length, 1);
  assert.equal(run1Events[0].message, "r1");

  const run2Events = await recorder.query({ filter: { runId: "run-2" } });
  assert.equal(run2Events.length, 1);
  assert.equal(run2Events[0].message, "r2");

  await fs.rm(dir, { recursive: true, force: true });
});
