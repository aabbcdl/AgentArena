import assert from "node:assert/strict";
import test from "node:test";
import { createResultLoaders } from "../apps/web-report/src/results/loaders.js";
import { TraceReplayer } from "../apps/web-report/src/trace-replay-bridge.js";

test("summary fixtures can include fair comparison metadata", () => {
  const summary = {
    runId: "run-1",
    createdAt: "2026-04-21T00:00:00.000Z",
    fairComparison: {
      taskIdentity: "task:test-task",
      judgeIdentity: "judge:abc123",
      repoBaselineIdentity: "repo:def456"
    },
    task: {
      id: "test-task",
      title: "Test Task",
      schemaVersion: "agentarena.taskpack/v1"
    },
    results: []
  };

  assert.equal(summary.fairComparison.taskIdentity, "task:test-task");
  assert.equal(summary.fairComparison.judgeIdentity, "judge:abc123");
  assert.equal(summary.fairComparison.repoBaselineIdentity, "repo:def456");
});

function createVirtualFile({ name, webkitRelativePath, text = "" }) {
  return {
    name,
    webkitRelativePath,
    async text() {
      return text;
    }
  };
}

test("folder loader attaches trace file handles to run results", async () => {
  const state = {};
  let capturedRuns = [];

  const summary = {
    runId: "run-1",
    results: [
      {
        agentId: "agent-a",
        tracePath: "run/agents/agent-a/trace.jsonl"
      }
    ]
  };

  const summaryFile = createVirtualFile({
    name: "summary.json",
    webkitRelativePath: "batch-1/summary.json",
    text: JSON.stringify(summary)
  });
  const traceFile = createVirtualFile({
    name: "trace.jsonl",
    webkitRelativePath: "batch-1/run/agents/agent-a/trace.jsonl",
    text: [
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00.000Z",
        agentId: "agent-a",
        runId: "run-1",
        type: "adapter.start",
        message: "hello"
      })
    ].join("\n")
  });

  const loaders = createResultLoaders({
    state,
    localText: (_zh, en) => en,
    render: () => {},
    renderMarkdownPanel: () => {},
    applySingleRun: () => {},
    applyRuns: (runs) => {
      capturedRuns = runs;
    },
    showLoading: () => {},
    hideLoading: () => {},
    showError: (message) => {
      throw new Error(`unexpected loader error: ${message}`);
    }
  });

  await loaders.handleFolderSelection({
    target: {
      files: [summaryFile, traceFile]
    }
  });

  assert.equal(capturedRuns.length, 1);
  const loadedRun = capturedRuns[0];
  assert.equal(loadedRun.results[0].tracePath, "run/agents/agent-a/trace.jsonl");
  assert.equal(loadedRun.results[0].traceFile, traceFile);
});

test("folder loader surfaces missing and corrupt summary errors in the loader area", async () => {
  const inlineErrors = [];
  const globalErrors = [];
  const loaders = createResultLoaders({
    state: {},
    localText: (_zh, en) => en,
    render: () => {},
    renderMarkdownPanel: () => {},
    applySingleRun: () => {},
    applyRuns: () => {
      throw new Error("invalid folders must not produce runs");
    },
    showLoading: () => {},
    hideLoading: () => {},
    showError: (message) => globalErrors.push(message),
    showResultLoaderError: (message) => inlineErrors.push(message),
    clearResultLoaderError: () => {}
  });

  await loaders.handleFolderSelection({ target: { files: [] } });
  await loaders.handleFolderSelection({
    target: {
      files: [
        createVirtualFile({
          name: "summary.json",
          webkitRelativePath: "broken/summary.json",
          text: "{partial"
        })
      ]
    }
  });

  assert.equal(inlineErrors.length, 2);
  assert.equal(globalErrors.length, 2);
  assert.match(inlineErrors[0], /No summary\.json file/i);
  assert.match(inlineErrors[1], /failed to parse/i);
  assert.deepEqual(inlineErrors, globalErrors);
});

test("folder loader rejects unsupported summary artifact schemas", async () => {
  const errors = [];
  const loaders = createResultLoaders({
    state: {},
    localText: (_zh, en) => en,
    render: () => {},
    renderMarkdownPanel: () => {},
    applySingleRun: () => {},
    applyRuns: () => {
      throw new Error("invalid summaries must not produce runs");
    },
    showLoading: () => {},
    hideLoading: () => {},
    showError: (message) => errors.push(message),
    showResultLoaderError: (message) => errors.push(message),
    clearResultLoaderError: () => {}
  });

  await loaders.handleFolderSelection({
    target: {
      files: [
        createVirtualFile({
          name: "summary.json",
          webkitRelativePath: "unsupported/summary.json",
          text: JSON.stringify({
            artifactSchemaVersion: "agentarena.summary/v0",
            runId: "run-1",
            results: []
          })
        })
      ]
    }
  });

  assert.equal(errors.length, 2);
  assert.match(errors[0], /failed to parse/i);
  assert.match(errors[1], /failed to parse/i);
});

test("trace replay bridge supports Blob/File sources", async () => {
  const ndjson = [
    JSON.stringify({
      timestamp: "2026-01-01T00:00:00.000Z",
      agentId: "agent-a",
      runId: "run-1",
      type: "adapter.start",
      message: "start"
    }),
    JSON.stringify({
      timestamp: "2026-01-01T00:00:00.150Z",
      agentId: "agent-a",
      runId: "run-1",
      type: "adapter.finish",
      message: "finish"
    })
  ].join("\n");

  const replaySource = new Blob([ndjson], { type: "text/plain" });
  const replayer = new TraceReplayer(replaySource);
  const timeline = await replayer.buildTimeline({ stepWindowMs: 100 });

  assert.equal(timeline.metadata.totalEvents, 2);
  assert.equal(timeline.metadata.agentId, "agent-a");
  assert.ok(timeline.steps.length >= 2);
});
