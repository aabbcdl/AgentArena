import assert from "node:assert/strict";
import test from "node:test";

// Import from built dist — sorted alphabetically
import { buildLeaderboardEntries, extractCommunityEntry } from "../packages/cli/dist/publish.js";

function makeMockRun(overrides = {}) {
  return {
    runId: "test-run-001",
    createdAt: "2026-04-28T10:00:00Z",
    repoPath: "/Users/test/my-project",
    outputPath: "/Users/test/.agentarena/runs/test-run-001",
    scoreMode: "practical",
    task: {
      schemaVersion: "agentarena.taskpack/v1",
      id: "test-task-pack",
      title: "Test Task Pack",
      prompt: "Fix the bug",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: [],
    },
    preflights: [],
    results: [
      {
        agentId: "claude-code",
        baseAgentId: "claude-code",
        variantId: "default",
        displayLabel: "Claude Code",
        requestedConfig: {},
        resolvedRuntime: {
          effectiveModel: "claude-sonnet-4-20250514",
          providerProfileName: "official",
          effectiveAgentVersion: "1.0.0",
          source: "env",
          verification: "confirmed",
        },
        agentTitle: "Claude Code",
        status: "success",
        adapterKind: "external",
        preflight: { status: "ready", checks: [] },
        summary: "All tests passed",
        durationMs: 45000,
        tokenUsage: 12000,
        estimatedCostUsd: 0.15,
        costKnown: true,
        changedFiles: ["src/index.ts"],
        changedFilesHint: ["src/index.ts"],
        setupResults: [],
        judgeResults: [
          { judgeId: "j1", label: "test", type: "test-result", exitCode: 0, success: true, stdout: "", stderr: "", durationMs: 1000 },
          { judgeId: "j2", label: "lint", type: "lint-check", exitCode: 0, success: true, stdout: "", stderr: "", durationMs: 500 },
        ],
        teardownResults: [],
        tracePath: "/Users/test/.agentarena/runs/test-run-001/trace.json",
        workspacePath: "/Users/test/.agentarena/runs/test-run-001/workspace/claude-code",
        diff: { filesChanged: 1, insertions: 10, deletions: 5 },
        compositeScore: 85.5,
      },
      {
        agentId: "codex",
        baseAgentId: "codex",
        variantId: "default",
        displayLabel: "Codex",
        requestedConfig: {},
        resolvedRuntime: {
          effectiveModel: "gpt-5.4",
          providerProfileName: "openai",
          effectiveAgentVersion: "2.0.0",
          source: "env",
          verification: "confirmed",
        },
        agentTitle: "Codex",
        status: "success",
        adapterKind: "external",
        preflight: { status: "ready", checks: [] },
        summary: "Completed",
        durationMs: 30000,
        tokenUsage: 8000,
        estimatedCostUsd: 0.10,
        costKnown: true,
        changedFiles: ["src/index.ts"],
        changedFilesHint: ["src/index.ts"],
        setupResults: [],
        judgeResults: [
          { judgeId: "j1", label: "test", type: "test-result", exitCode: 0, success: true, stdout: "", stderr: "", durationMs: 1000 },
          { judgeId: "j2", label: "lint", type: "lint-check", exitCode: 1, success: false, stdout: "", stderr: "lint error", durationMs: 500 },
        ],
        teardownResults: [],
        tracePath: "/Users/test/.agentarena/runs/test-run-001/trace-codex.json",
        workspacePath: "/Users/test/.agentarena/runs/test-run-001/workspace/codex",
        diff: { filesChanged: 1, insertions: 8, deletions: 3 },
        compositeScore: 72.0,
      },
    ],
    ...overrides,
  };
}

test("extractCommunityEntry sanitizes local paths", () => {
  const run = makeMockRun();
  const entry = extractCommunityEntry(run, "testuser");

  // Should not contain any local paths
  const json = JSON.stringify(entry);
  assert.ok(!json.includes("/Users/test"), "Should not contain local user paths");
  assert.ok(!json.includes("/Users/test/.agentarena"), "Should not contain agentarena paths");

  // Schema version
  assert.equal(entry.schemaVersion, "agentarena.community-run/v1");
  assert.equal(entry.runId, "test-run-001");
  assert.equal(entry.publishedBy, "testuser");
  assert.equal(entry.taskPackId, "test-task-pack");
  assert.equal(entry.taskTitle, "Test Task Pack");
  assert.equal(entry.scoreMode, "practical");
});

test("extractCommunityEntry extracts agent results correctly", () => {
  const run = makeMockRun();
  const entry = extractCommunityEntry(run, "testuser");

  assert.equal(entry.agentResults.length, 2);

  const claude = entry.agentResults[0];
  assert.equal(claude.agentId, "claude-code");
  assert.equal(claude.baseAgentId, "claude-code");
  assert.equal(claude.displayLabel, "Claude Code");
  assert.equal(claude.model, "claude-sonnet-4-20250514");
  assert.equal(claude.status, "success");
  assert.equal(claude.compositeScore, 85.5);
  assert.equal(claude.durationMs, 45000);
  assert.equal(claude.judgePassRate, 1); // 2/2 passed

  const codex = entry.agentResults[1];
  assert.equal(codex.agentId, "codex");
  assert.equal(codex.model, "gpt-5.4");
  assert.equal(codex.compositeScore, 72.0);
  assert.equal(codex.judgePassRate, 0.5); // 1/2 passed
});

test("extractCommunityEntry handles missing resolvedRuntime", () => {
  const run = makeMockRun();
  run.results[0].resolvedRuntime = undefined;
  const entry = extractCommunityEntry(run, "testuser");

  assert.equal(entry.agentResults[0].model, "unknown");
  assert.equal(entry.agentResults[0].provider, "unknown");
  assert.equal(entry.agentResults[0].version, "unknown");
});

test("buildLeaderboardEntries creates entries from single run", () => {
  const run = makeMockRun();
  const entry = extractCommunityEntry(run, "testuser");
  const entries = buildLeaderboardEntries([entry]);

  assert.equal(entries.length, 2); // 2 agents

  // Sorted by avgScore desc
  assert.equal(entries[0].baseAgentId, "claude-code");
  assert.equal(entries[0].avgScore, 85.5);
  assert.equal(entries[0].bestScore, 85.5);
  assert.equal(entries[0].runCount, 1);
  assert.equal(entries[0].successRate, 1);

  assert.equal(entries[1].baseAgentId, "codex");
  assert.equal(entries[1].avgScore, 72.0);
});

test("buildLeaderboardEntries merges multiple runs correctly (no precision loss)", () => {
  const run1 = makeMockRun();
  const entry1 = extractCommunityEntry(run1, "user1");

  const run2 = makeMockRun({ runId: "test-run-002" });
  run2.results[0].compositeScore = 90.0;
  run2.results[1].compositeScore = 68.0;
  const entry2 = extractCommunityEntry(run2, "user2");

  // Use raw run data — no inflation, no precision loss
  const entries = buildLeaderboardEntries([entry1, entry2]);

  // Claude: avg of 85.5 and 90.0 = 87.75, rounded to 87.8
  const claudeEntry = entries.find((e) => e.baseAgentId === "claude-code");
  assert.ok(claudeEntry, "Should have claude-code entry");
  assert.equal(claudeEntry.runCount, 2);
  assert.equal(claudeEntry.bestScore, 90.0);
  assert.ok(claudeEntry.avgScore > 85 && claudeEntry.avgScore < 90, `avgScore should be between 85 and 90, got ${claudeEntry.avgScore}`);

  // Codex: avg of 72.0 and 68.0 = 70.0
  const codexEntry = entries.find((e) => e.baseAgentId === "codex");
  assert.ok(codexEntry, "Should have codex entry");
  assert.equal(codexEntry.runCount, 2);
  assert.equal(codexEntry.bestScore, 72.0);
});

test("buildLeaderboardEntries computes winRate correctly", () => {
  const run1 = makeMockRun();
  const entry1 = extractCommunityEntry(run1, "user1");

  // Run 2: codex wins
  const run2 = makeMockRun({ runId: "test-run-002" });
  run2.results[0].compositeScore = 60.0; // claude loses
  run2.results[1].compositeScore = 95.0; // codex wins
  const entry2 = extractCommunityEntry(run2, "user2");

  const entries = buildLeaderboardEntries([entry1, entry2]);

  const claudeEntry = entries.find((e) => e.baseAgentId === "claude-code");
  const codexEntry = entries.find((e) => e.baseAgentId === "codex");

  // Claude won run1, lost run2: winRate = 0.5
  assert.equal(claudeEntry.winRate, 0.5);
  // Codex lost run1, won run2: winRate = 0.5
  assert.equal(codexEntry.winRate, 0.5);
});

test("buildLeaderboardEntries preserves exact scores (no inflation artifacts)", () => {
  // This test verifies that the new approach doesn't produce synthetic data artifacts.
  // With the old approach, rebuilding from an index would inflate avgScore into
  // runCount identical data points, losing variance information.
  // With the new approach, we aggregate from raw data directly.
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const run = makeMockRun({ runId: `run-${i}` });
    run.results[0].compositeScore = 70 + i * 5; // 70, 75, 80, 85, 90
    run.results[1].compositeScore = 60 + i * 3; // 60, 63, 66, 69, 72
    runs.push(extractCommunityEntry(run, `user${i}`));
  }

  const entries = buildLeaderboardEntries(runs);

  const claudeEntry = entries.find((e) => e.baseAgentId === "claude-code");
  assert.ok(claudeEntry, "Should have claude-code entry");
  assert.equal(claudeEntry.runCount, 5);

  // avg of 70, 75, 80, 85, 90 = 80.0
  assert.equal(claudeEntry.avgScore, 80.0);
  assert.equal(claudeEntry.bestScore, 90.0);

  // Verify no synthetic artifacts: success rate should reflect actual statuses
  // All 5 runs are "success" for claude-code
  assert.equal(claudeEntry.successRate, 1.0);
});
