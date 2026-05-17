/**
 * Contract tests: TraceEvent JSONL on disk (packages/core TraceEvent + packages/trace).
 * Ensures replay/load paths tolerate real-world files (including bad lines).
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { JsonlTraceRecorder } from "../packages/trace/dist/index.js";

test("contract: minimal TraceEvent round-trips through JSONL", async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "aa-trace-contract-"));
  const filePath = path.join(dir, "trace.jsonl");
  try {
    const recorder = new JsonlTraceRecorder(filePath);
    const minimal = {
      timestamp: "2026-01-01T00:00:00.000Z",
      agentId: "demo-fast",
      type: "info",
      message: "ping",
    };
    await recorder.record(minimal);
    const events = await recorder.readAll();
    assert.equal(events.length, 1);
    assert.deepEqual(
      {
        timestamp: events[0].timestamp,
        agentId: events[0].agentId,
        type: events[0].type,
        message: events[0].message,
      },
      minimal
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("contract: malformed JSONL lines are skipped on readAll", async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "aa-trace-contract-"));
  const filePath = path.join(dir, "trace.jsonl");
  try {
    await fs.writeFile(
      filePath,
      [
        '{"timestamp":"2026-01-01T00:00:00Z","agentId":"a","type":"info","message":"one"}',
        "not valid json {{{",
        '{"timestamp":"2026-01-01T00:00:01Z","agentId":"a","type":"info","message":"two"}',
        "",
      ].join("\n"),
      "utf8"
    );
    const recorder = new JsonlTraceRecorder(filePath);
    const events = await recorder.readAll();
    assert.equal(events.length, 2);
    assert.equal(events[0].message, "one");
    assert.equal(events[1].message, "two");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
