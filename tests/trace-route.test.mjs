import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleTraceGet, parseTrace, validateTraceQuery } from "../packages/cli/dist/commands/api-routes/trace.js";

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-trace-test-"));
  const traceDir = path.join(root, ".agentarena", "runs", "run-1", "agents", "agent-a");
  await fs.mkdir(traceDir, { recursive: true });
  const lines = [
    { agentId: "agent-a", runId: "run-1", timestamp: "2026-07-15T08:00:01.000Z", type: "adapter.start", message: "start" },
    { agentId: "agent-a", runId: "run-1", timestamp: "2026-07-15T08:00:02.000Z", type: "adapter.tool_use", message: "read" },
    { agentId: "agent-a", runId: "run-1", timestamp: "2026-07-15T08:00:03.000Z", type: "adapter.error", message: "boom", metadata: {} }
  ];
  await fs.writeFile(path.join(traceDir, "trace.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return root;
}

test("validateTraceQuery rejects empty and unsafe ids", () => {
  assert.equal(validateTraceQuery(null, "agent-a"), null);
  assert.equal(validateTraceQuery("run-1", null), null);
  assert.equal(validateTraceQuery("../escape", "agent-a"), null);
  assert.equal(validateTraceQuery("run-1", "a/b"), null);
  assert.deepEqual(validateTraceQuery("run-1", "agent-a"), { runId: "run-1", variantId: "agent-a" });
});

test("parseTrace tolerates blank and malformed lines", () => {
  const text = '\n{"type":"a","timestamp":"t1"}\nnot-json\n{"type":"b","timestamp":"t2"}\n';
  const events = parseTrace(text);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "a");
});

test("handleTraceGet returns parsed events for an existing trace", async () => {
  const root = await makeWorkspace();
  try {
    const res = await handleTraceGet(root, "run-1", "agent-a");
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.runId, "run-1");
    assert.equal(body.variantId, "agent-a");
    assert.equal(body.totalEvents, 3);
    assert.equal(body.returnedEvents, 3);
    assert.equal(body.truncated, false);
    assert.equal(body.events.length, 3);
    assert.equal(body.events[2].type, "adapter.error");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("handleTraceGet returns 404 when trace is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-trace-test-"));
  try {
    const res = await handleTraceGet(root, "run-x", "agent-a");
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, "trace-missing");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("handleTraceGet returns 400 for unsafe query", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-trace-test-"));
  try {
    const res = await handleTraceGet(root, "../etc", "agent-a");
    assert.equal(res.statusCode, 400);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("handleTraceGet rejects paths that escape the workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-trace-test-"));
  try {
    const linkDir = path.join(root, ".agentarena", "runs", "run-1", "agents");
    await fs.mkdir(linkDir, { recursive: true });
    const outsideParent = path.join(root, "..");
    const link = path.join(linkDir, "agent-a");
    await fs.symlink(outsideParent, link);
    const res = await handleTraceGet(root, "run-1", "agent-a");
    assert.ok(res.statusCode === 403 || res.statusCode === 404, `expected 403/404, got ${res.statusCode}`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("handleTraceGet truncates very large traces", async () => {
  const root = await makeWorkspace();
  try {
    const traceDir = path.join(root, ".agentarena", "runs", "run-big", "agents", "agent-a");
    await fs.mkdir(traceDir, { recursive: true });
    const lines = [];
    for (let i = 0; i < 12_000; i++) {
      lines.push(JSON.stringify({ agentId: "agent-a", runId: "run-big", timestamp: `2026-07-15T08:00:${(i % 60).toString().padStart(2, "0")}.000Z`, type: "adapter.tool_use", message: `event ${i}` }));
    }
    await fs.writeFile(path.join(traceDir, "trace.jsonl"), lines.join("\n") + "\n");
    const res = await handleTraceGet(root, "run-big", "agent-a");
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.totalEvents, 12_000);
    assert.equal(body.truncated, true);
    assert.equal(body.returnedEvents, 10_000);
    assert.equal(body.events.length, 10_000);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("handleTraceGet does not mark an exactly full page as truncated", async () => {
  const root = await makeWorkspace();
  try {
    const traceDir = path.join(root, ".agentarena", "runs", "run-exact", "agents", "agent-a");
    await fs.mkdir(traceDir, { recursive: true });
    const lines = [];
    for (let i = 0; i < 10_000; i++) {
      lines.push(JSON.stringify({ agentId: "agent-a", runId: "run-exact", timestamp: "2026-07-15T08:00:00.000Z", type: "adapter.tool_use", message: `event ${i}` }));
    }
    await fs.writeFile(path.join(traceDir, "trace.jsonl"), lines.join("\n") + "\n");
    const res = await handleTraceGet(root, "run-exact", "agent-a");
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.totalEvents, 10_000);
    assert.equal(body.returnedEvents, 10_000);
    assert.equal(body.truncated, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
