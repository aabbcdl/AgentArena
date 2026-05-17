/**
 * Contract tests: publish/community payloads vs @agentarena/core types.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { extractCommunityEntry } from "../packages/cli/dist/publish.js";

function makeMinimalRun() {
  return {
    runId: "contract-run",
    createdAt: "2026-05-01T00:00:00Z",
    repoPath: "/tmp/repo",
    outputPath: "/tmp/out",
    scoreMode: "practical",
    task: {
      schemaVersion: "agentarena.taskpack/v1",
      id: "task-1",
      title: "T",
      prompt: "p",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: [],
    },
    preflights: [],
    results: [
      {
        agentId: "demo-fast",
        baseAgentId: "demo-fast",
        variantId: "default",
        displayLabel: "Demo",
        requestedConfig: {},
        resolvedRuntime: {
          effectiveModel: "m",
          providerProfileName: "p",
          effectiveAgentVersion: "1",
          source: "env",
          verification: "confirmed",
        },
        agentTitle: "Demo",
        status: "success",
        adapterKind: "demo",
        preflight: { status: "ready", checks: [] },
        summary: "ok",
        durationMs: 1,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: true,
        changedFiles: [],
        changedFilesHint: [],
        setupResults: [],
        judgeResults: [],
        teardownResults: [],
        tracePath: "/tmp/trace.jsonl",
        workspacePath: "/tmp/ws",
        diff: { filesChanged: 0, insertions: 0, deletions: 0 },
        compositeScore: 50,
      },
    ],
  };
}

const RUN_ENTRY_KEYS = [
  "schemaVersion",
  "runId",
  "publishedAt",
  "publishedBy",
  "taskPackId",
  "taskTitle",
  "scoreMode",
  "agentResults",
];

const AGENT_RESULT_KEYS = [
  "agentId",
  "baseAgentId",
  "variantId",
  "displayLabel",
  "model",
  "provider",
  "version",
  "status",
  "compositeScore",
  "durationMs",
  "tokenUsage",
  "estimatedCostUsd",
  "costKnown",
  "judgePassRate",
];

test("contract: extractCommunityEntry matches CommunityRunEntry field set", () => {
  const entry = extractCommunityEntry(makeMinimalRun(), "tester");
  for (const key of RUN_ENTRY_KEYS) {
    assert.ok(key in entry, `CommunityRunEntry missing "${key}"`);
  }
  assert.equal(entry.schemaVersion, "agentarena.community-run/v1");
  assert.equal(entry.agentResults.length, 1);
  const ar = entry.agentResults[0];
  for (const key of AGENT_RESULT_KEYS) {
    assert.ok(key in ar, `CommunityAgentResult missing "${key}"`);
  }
});
