import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  enrichRunWithScores,
  formatDecisionReport,
  generateConclusion,
  generateCsv,
  generateDecisionReport,
  writeReport
} from "../packages/report/dist/index.js";

// ---------------------------------------------------------------------------
// Shared mock fixtures
// ---------------------------------------------------------------------------

const DEMO_CAPABILITY = {
  supportTier: "supported",
  invocationMethod: "Built-in AgentArena demo adapter",
  authPrerequisites: [],
  tokenAvailability: "estimated",
  costAvailability: "estimated",
  traceRichness: "partial",
  configurableRuntime: { model: false, reasoningEffort: false },
  knownLimitations: ["Synthetic metrics"]
};

function createPreflight(overrides = {}) {
  return {
    agentId: overrides.agentId ?? "demo-fast",
    baseAgentId: overrides.baseAgentId ?? overrides.agentId ?? "demo-fast",
    variantId: overrides.variantId ?? overrides.agentId ?? "demo-fast",
    displayLabel: overrides.displayLabel ?? overrides.agentTitle ?? "Demo Fast",
    requestedConfig: overrides.requestedConfig ?? {},
    resolvedRuntime: overrides.resolvedRuntime,
    agentTitle: overrides.agentTitle ?? "Demo Fast",
    adapterKind: overrides.adapterKind ?? "demo",
    status: overrides.status ?? "ready",
    summary: overrides.summary ?? "Ready",
    capability: overrides.capability ?? DEMO_CAPABILITY,
    command: overrides.command,
    details: overrides.details
  };
}

function createResult(outputPath, overrides = {}) {
  const agentId = overrides.agentId ?? "demo-fast";
  return {
    agentId,
    baseAgentId: overrides.baseAgentId ?? agentId,
    variantId: overrides.variantId ?? agentId,
    displayLabel: overrides.displayLabel ?? overrides.agentTitle ?? agentId,
    requestedConfig: overrides.requestedConfig ?? {},
    resolvedRuntime: overrides.resolvedRuntime,
    agentTitle: overrides.agentTitle ?? agentId,
    adapterKind: overrides.adapterKind ?? "demo",
    preflight: overrides.preflight ?? createPreflight(overrides),
    status: overrides.status ?? "success",
    summary: overrides.summary ?? "Done",
    durationMs: overrides.durationMs ?? 1000,
    tokenUsage: overrides.tokenUsage ?? 100,
    estimatedCostUsd: overrides.estimatedCostUsd ?? 0,
    costKnown: overrides.costKnown ?? false,
    costQuality: overrides.costQuality,
    tokenUsageReliable: overrides.tokenUsageReliable,
    dataQualityWarning: overrides.dataQualityWarning,
    changedFiles: overrides.changedFiles ?? [],
    changedFilesHint: overrides.changedFilesHint ?? overrides.changedFiles ?? [],
    setupResults: overrides.setupResults ?? [],
    judgeResults: overrides.judgeResults ?? [],
    teardownResults: overrides.teardownResults ?? [],
    tracePath: overrides.tracePath ?? path.join(outputPath, "agents", agentId, "trace.jsonl"),
    workspacePath: overrides.workspacePath ?? path.join(os.tmpdir(), "workspace", agentId),
    diff: overrides.diff ?? { added: [], changed: [], removed: [] },
    scoreExcluded: overrides.scoreExcluded,
    scoreExclusionReason: overrides.scoreExclusionReason,
    failureCategory: overrides.failureCategory,
    compositeScore: overrides.compositeScore
  };
}

function createRun(outputPath, overrides = {}) {
  return {
    runId: overrides.runId ?? "test-run-1",
    createdAt: overrides.createdAt ?? "2026-06-11T00:00:00.000Z",
    repoPath: overrides.repoPath ?? "/tmp/test-repo",
    outputPath,
    scoreMode: overrides.scoreMode ?? "balanced",
    scoreWeights: overrides.scoreWeights,
    scoreScope: overrides.scoreScope,
    scoreValidityNote: overrides.scoreValidityNote,
    task: overrides.task ?? {
      schemaVersion: "agentarena.taskpack/v1",
      id: "test-task",
      title: "Test Task",
      prompt: "Write a hello world program",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    },
    preflights: overrides.preflights ?? [],
    results: overrides.results ?? []
  };
}

// Multi-agent fixture: two agents, one passes all judges, one fails
function createMultiAgentFixture(outputPath) {
  return createRun(outputPath, {
    preflights: [
      createPreflight({ agentId: "agent-a", agentTitle: "Agent A" }),
      createPreflight({ agentId: "agent-b", agentTitle: "Agent B" })
    ],
    results: [
      createResult(outputPath, {
        agentId: "agent-a",
        agentTitle: "Agent A",
        displayLabel: "Agent A",
        status: "success",
        compositeScore: 85,
        estimatedCostUsd: 0.15,
        costKnown: true,
        tokenUsage: 200,
        durationMs: 5000,
        changedFiles: ["src/index.ts"],
        judgeResults: [
          {
            judgeId: "tests",
            label: "Unit Tests",
            type: "test-result",
            exitCode: 0,
            success: true,
            stdout: "All 10 tests passed",
            stderr: "",
            durationMs: 3000,
            totalCount: 10,
            passedCount: 10
          },
          {
            judgeId: "lint",
            label: "Lint Check",
            type: "lint-check",
            exitCode: 0,
            success: true,
            stdout: "",
            stderr: "",
            durationMs: 500,
            errorCount: 0,
            warningCount: 0
          }
        ],
        diff: { added: ["src/index.ts"], changed: [], removed: [] }
      }),
      createResult(outputPath, {
        agentId: "agent-b",
        agentTitle: "Agent B",
        displayLabel: "Agent B",
        status: "failed",
        compositeScore: 30,
        estimatedCostUsd: 0.05,
        costKnown: true,
        tokenUsage: 80,
        durationMs: 2000,
        changedFiles: [],
        judgeResults: [
          {
            judgeId: "tests",
            label: "Unit Tests",
            type: "test-result",
            exitCode: 1,
            success: false,
            stdout: "3 tests failed",
            stderr: "FAIL src/index.test.ts",
            durationMs: 1500
          }
        ],
        diff: { added: [], changed: [], removed: [] }
      })
    ]
  });
}

// ---------------------------------------------------------------------------
// 1. HTML Template Tests
// ---------------------------------------------------------------------------

test("HTML output contains expected sections", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-html-"));
  const outputPath = path.join(tempDir, "output");

  const run = createMultiAgentFixture(outputPath);
  const { htmlPath } = await writeReport(run);
  const html = await readFile(htmlPath, "utf8");

  // Basic HTML structure
  assert.match(html, /<!doctype html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<\/html>/);

  // Title contains task name
  assert.match(html, /AgentArena Report/);

  // Contains summary stats section
  assert.match(html, /Score mode/);
  assert.match(html, /Score weights/);

  // Contains adapter preflight section
  assert.match(html, /Adapter Preflight/);

  // Contains benchmark results section
  assert.match(html, /Benchmark Results/);

  // Contains agent card details
  assert.match(html, /Agent A/);
  assert.match(html, /Agent B/);
  assert.match(html, /Composite Score/);
  assert.match(html, /Duration/);
  assert.match(html, /Tokens/);

  // Contains judge results
  assert.match(html, /Unit Tests/);
  assert.match(html, /Lint Check/);
  assert.match(html, /Judges/);

  // Contains file diff info
  assert.match(html, /Added/);
  assert.match(html, /Changed/);
  assert.match(html, /Removed/);

  // Contains prompt in footer
  assert.match(html, /Write a hello world program/);

  // Security: CSP nonce present
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /nonce-/);

  await rm(tempDir, { recursive: true, force: true });
});

test("HTML output renders zh-CN locale correctly", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-html-zh-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [createPreflight()],
    results: [createResult(outputPath)]
  });
  const { htmlPath } = await writeReport(run, { locale: "zh-CN" });
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /AgentArena 报告/);
  assert.match(html, /适配器预检/);
  assert.match(html, /跑分结果/);

  await rm(tempDir, { recursive: true, force: true });
});

test("HTML output contains stat blocks for each agent", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-html-stats-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [createPreflight({ agentId: "agent-x", agentTitle: "Agent X" })],
    results: [
      createResult(outputPath, {
        agentId: "agent-x",
        agentTitle: "Agent X",
        displayLabel: "Agent X",
        estimatedCostUsd: 0.42,
        costKnown: true,
        durationMs: 12000,
        tokenUsage: 500
      })
    ]
  });

  const { htmlPath } = await writeReport(run);
  const html = await readFile(htmlPath, "utf8");

  // Stats grid entries
  assert.match(html, /Status/);
  assert.match(html, /Composite Score/);
  assert.match(html, /Duration/);
  assert.match(html, /Tokens/);
  assert.match(html, /Cost/);
  assert.match(html, /Tests/);
  assert.match(html, /Lint/);
  assert.match(html, /Diff Precision/);

  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2. Markdown Template Tests
// ---------------------------------------------------------------------------

test("Markdown output has correct structure and content", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-md-"));
  const outputPath = path.join(tempDir, "output");

  const run = createMultiAgentFixture(outputPath);
  const { markdownPath } = await writeReport(run);
  const md = await readFile(markdownPath, "utf8");

  // Title
  assert.match(md, /# AgentArena Summary/);

  // Metadata
  assert.match(md, /- Run ID:/);
  assert.match(md, /- Created At:/);
  assert.match(md, /- Task:.*Test Task/);
  assert.match(md, /- Score Mode:.*balanced/);
  assert.match(md, /- Score Weights:/);
  assert.match(md, /- Repository:/);
  assert.match(md, /- Success Rate:.*1\/2/);
  assert.match(md, /- Failed:.*1/);
  assert.match(md, /- Total Tokens:/);
  assert.match(md, /Known Cost:/);
  assert.match(md, /- Badge Endpoint:.*badge\.json/);

  // Sections
  assert.match(md, /## Adapter Preflight/);
  assert.match(md, /## Results/);

  // Results table headers
  assert.match(md, /\| Variant \| Base Agent \| Provider \|/);
  assert.match(md, /\| Status/);
  assert.match(md, /\| Score/);
  assert.match(md, /\| Duration/);
  assert.match(md, /\| Tokens/);
  assert.match(md, /\| Judges/);

  // Agent entries in table
  assert.match(md, /Agent A/);
  assert.match(md, /Agent B/);

  // Failure section present because one agent failed
  assert.match(md, /## Failures/);
  assert.match(md, /agent-b/);

  // Per-agent detail sections
  assert.match(md, /### Agent A/);
  assert.match(md, /### Agent B/);
  assert.match(md, /- Composite Score:/);
  assert.match(md, /- Judges:/);
  assert.match(md, /- Trace:/);

  // Prompt section
  assert.match(md, /## Prompt/);
  assert.match(md, /Write a hello world program/);

  await rm(tempDir, { recursive: true, force: true });
});

test("Markdown and HTML surface dataQualityWarning", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-quality-"));
  const outputPath = path.join(tempDir, "output");
  const warning = "Codex CLI reported turn completion with zero token usage — token counts may be inaccurate.";

  const run = createRun(outputPath, {
    preflights: [createPreflight({ agentId: "agent-a", agentTitle: "Agent A" })],
    results: [
      createResult(outputPath, {
        agentId: "agent-a",
        agentTitle: "Agent A",
        displayLabel: "Agent A",
        dataQualityWarning: warning,
        tokenUsageReliable: false
      })
    ]
  });
  const { markdownPath, htmlPath } = await writeReport(run);
  const md = await readFile(markdownPath, "utf8");
  const html = await readFile(htmlPath, "utf8");

  assert.match(md, /## Data Quality Warnings/);
  assert.match(md, /Agent A/);
  assert.ok(md.includes(warning));
  assert.match(html, /Data quality:/);
  assert.ok(html.includes(warning));

  await rm(tempDir, { recursive: true, force: true });
});

test("Markdown output has no failures section when all agents pass", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-md-nofail-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [createPreflight()],
    results: [createResult(outputPath)]
  });
  const { markdownPath } = await writeReport(run);
  const md = await readFile(markdownPath, "utf8");

  assert.doesNotMatch(md, /## Failures/);
  assert.match(md, /Success Rate:.*1\/1/);
  assert.match(md, /Failed:.*0/);

  await rm(tempDir, { recursive: true, force: true });
});

test("Markdown renders zh-CN locale", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-md-zh-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [createPreflight()],
    results: [createResult(outputPath)]
  });
  const { markdownPath } = await writeReport(run, { locale: "zh-CN" });
  const md = await readFile(markdownPath, "utf8");

  assert.match(md, /# AgentArena 摘要/);
  assert.match(md, /评分模式/);
  assert.match(md, /成功率/);
  assert.match(md, /适配器预检/);
  assert.match(md, /结果/);

  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 3. JSON Summary Tests
// ---------------------------------------------------------------------------

test("JSON summary has correct schema and required fields", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-json-"));
  const outputPath = path.join(tempDir, "output");

  const run = createMultiAgentFixture(outputPath);
  const { jsonPath } = await writeReport(run);
  const summary = JSON.parse(await readFile(jsonPath, "utf8"));

  // Top-level required fields
  assert.equal(typeof summary.runId, "string");
  assert.equal(typeof summary.createdAt, "string");
  assert.equal(summary.repoPath, ".");
  assert.equal(summary.outputPath, ".");
  assert.ok(summary.task);
  assert.equal(summary.task.id, "test-task");
  assert.equal(summary.task.title, "Test Task");
  assert.ok(Array.isArray(summary.preflights));
  assert.ok(Array.isArray(summary.results));

  // Score metadata present
  assert.equal(summary.scoreMode, "balanced");
  assert.ok(summary.scoreWeights);
  assert.equal(typeof summary.scoreWeights, "object");

  // Leaderboard structure
  assert.ok(summary.leaderboard);
  assert.equal(typeof summary.leaderboard.taskId, "string");
  assert.equal(typeof summary.leaderboard.scoreMode, "string");
  assert.equal(typeof summary.leaderboard.comparableRunCount, "number");
  assert.ok(Array.isArray(summary.leaderboard.rows));
  assert.ok(Array.isArray(summary.leaderboard.comparabilityRules));

  // core writeAtomic must not leave fixed-name .tmp siblings
  const outputEntries = await readdir(outputPath);
  assert.equal(
    outputEntries.filter((name) => name.includes(".tmp")).length,
    0,
    "writeReport must not leave temporary files next to artifacts"
  );

  // Result schema
  const r1 = summary.results[0];
  assert.equal(typeof r1.agentId, "string");
  assert.equal(typeof r1.status, "string");
  assert.equal(typeof r1.durationMs, "number");
  assert.equal(typeof r1.tokenUsage, "number");
  assert.ok(Array.isArray(r1.judgeResults));
  assert.ok(Array.isArray(r1.changedFiles));
  assert.ok(r1.diff);
  assert.ok(Array.isArray(r1.diff.added));
  assert.ok(Array.isArray(r1.diff.changed));
  assert.ok(Array.isArray(r1.diff.removed));

  // Paths are sanitized
  assert.doesNotMatch(JSON.stringify(summary), /[A-Z]:\\temp\\/);
  assert.equal(r1.tracePath, "run/agents/agent-a/trace.jsonl");

  // Composite score present (enriched)
  assert.equal(typeof r1.compositeScore, "number");
  assert.ok(Array.isArray(r1.scoreReasons));

  await rm(tempDir, { recursive: true, force: true });
});

test("JSON summary includes all result fields for multi-agent run", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-json-multi-"));
  const outputPath = path.join(tempDir, "output");

  const run = createMultiAgentFixture(outputPath);
  const { jsonPath } = await writeReport(run);
  const summary = JSON.parse(await readFile(jsonPath, "utf8"));

  assert.equal(summary.results.length, 2);
  assert.equal(summary.results[0].agentId, "agent-a");
  assert.equal(summary.results[0].status, "success");
  assert.equal(summary.results[1].agentId, "agent-b");
  assert.equal(summary.results[1].status, "failed");

  // Judge results preserved
  assert.equal(summary.results[0].judgeResults.length, 2);
  assert.equal(summary.results[0].judgeResults[0].label, "Unit Tests");
  assert.equal(summary.results[0].judgeResults[0].success, true);

  // Cost data
  assert.equal(summary.results[0].costKnown, true);
  assert.equal(summary.results[0].estimatedCostUsd, 0.15);

  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 4. CSV Export Tests
// ---------------------------------------------------------------------------

test("CSV export has correct headers and data rows", () => {
  const run = createMultiAgentFixture("/tmp/csv-test");
  enrichRunWithScores(run);
  const csv = generateCsv(run);

  const lines = csv.trim().split("\n");

  // Header row
  const headers = lines[0].split(",");
  assert.ok(headers.includes("Agent"));
  assert.ok(headers.includes("Base Agent"));
  assert.ok(headers.includes("Variant"));
  assert.ok(headers.includes("Status"));
  assert.ok(headers.includes("Composite Score"));
  assert.ok(headers.includes("Duration (ms)"));
  assert.ok(headers.includes("Token Usage"));
  assert.ok(headers.includes("Cost (USD)"));
  assert.ok(headers.includes("Cost Known"));
  assert.ok(headers.includes("Files Changed"));
  assert.ok(headers.includes("Judges Passed"));
  assert.ok(headers.includes("Judges Total"));
  assert.ok(headers.includes("Test Pass Rate"));
  assert.ok(headers.includes("Lint Errors"));
  assert.ok(headers.includes("Model"));
  assert.ok(headers.includes("Version"));
  assert.ok(headers.includes("Provider"));

  // Two data rows (one per agent)
  assert.equal(lines.length, 3); // header + 2 data rows + trailing newline already trimmed

  // First data row: agent-a (success)
  const rowA = lines[1].split(",");
  assert.ok(rowA[0].includes("Agent A") || rowA[0] === "Agent A");
  assert.ok(rowA.includes("success"));
  assert.ok(rowA.includes("yes")); // costKnown

  // Second data row: agent-b (failed)
  const rowB = lines[2].split(",");
  assert.ok(rowB[0].includes("Agent B") || rowB[0] === "Agent B");
  assert.ok(rowB.includes("failed"));
});

test("CSV export handles missing cost data", () => {
  const run = createRun("/tmp/csv-test-cost", {
    results: [
      createResult("/tmp/csv-test-cost", {
        agentId: "no-cost-agent",
        displayLabel: "No Cost Agent",
        costKnown: false,
        estimatedCostUsd: 0
      })
    ]
  });
  enrichRunWithScores(run);
  const csv = generateCsv(run);

  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 2); // header + 1 row

  // "n/a" for cost when costKnown is false
  const dataRow = lines[1];
  assert.ok(dataRow.includes("n/a"));
  assert.ok(dataRow.includes("no")); // costKnown = "no"
});

test("CSV export escapes commas in fields", () => {
  const run = createRun("/tmp/csv-escape", {
    results: [
      createResult("/tmp/csv-escape", {
        agentId: "agent-comma",
        displayLabel: "Agent, With Comma",
        status: "success"
      })
    ]
  });
  enrichRunWithScores(run);
  const csv = generateCsv(run);

  // The display label with a comma should be quoted
  assert.ok(csv.includes('"Agent, With Comma"'));
});

test("CSV export handles empty results", () => {
  const run = createRun("/tmp/csv-empty", { results: [] });
  const csv = generateCsv(run);

  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 1); // only header row
});

// --- CSV Formula Injection Protection ---

test("CSV export prefixes formula-trigger characters with single quote", () => {
  const run = createRun("/tmp/csv-injection", {
    results: [
      createResult("/tmp/csv-injection", {
        agentId: "agent-equals",
        displayLabel: "=HYPERLINK(\"https://evil.com\",\"Click\")",
        status: "success"
      }),
      createResult("/tmp/csv-injection", {
        agentId: "agent-plus",
        displayLabel: "+1+1",
        status: "success"
      }),
      createResult("/tmp/csv-injection", {
        agentId: "agent-minus",
        displayLabel: "-1+1",
        status: "success"
      }),
      createResult("/tmp/csv-injection", {
        agentId: "agent-at",
        displayLabel: "@SUM(A1:A2)",
        status: "success"
      })
    ]
  });
  enrichRunWithScores(run);
  const csv = generateCsv(run);

  // Each formula-trigger character at the start of a field should be prefixed with '
  assert.ok(csv.includes("'=HYPERLINK"), "CSV should prefix = with single quote");
  assert.ok(csv.includes("'+1+1"), "CSV should prefix + with single quote");
  assert.ok(csv.includes("'-1+1"), "CSV should prefix - with single quote");
  assert.ok(csv.includes("'@SUM(A1:A2)"), "CSV should prefix @ with single quote");
});

test("CSV export does not prefix normal text", () => {
  const run = createRun("/tmp/csv-normal", {
    results: [
      createResult("/tmp/csv-normal", {
        agentId: "normal-agent",
        displayLabel: "Normal Agent Name",
        status: "success"
      })
    ]
  });
  enrichRunWithScores(run);
  const csv = generateCsv(run);

  // Normal text should not have a single-quote prefix
  assert.ok(!csv.includes("'Normal Agent Name"), "CSV should not prefix normal text");
});

// ---------------------------------------------------------------------------
// 5. Badge Generation Tests
// ---------------------------------------------------------------------------

test("badge JSON has correct schema", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-badge-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [createPreflight()],
    results: [createResult(outputPath)]
  });
  const { badgePath } = await writeReport(run);
  const badge = JSON.parse(await readFile(badgePath, "utf8"));

  assert.equal(typeof badge.schemaVersion, "number");
  assert.equal(badge.schemaVersion, 1);
  assert.equal(typeof badge.label, "string");
  assert.equal(badge.label, "AgentArena");
  assert.equal(typeof badge.message, "string");
  assert.equal(typeof badge.color, "string");

  // All passing
  assert.match(badge.message, /1\/1 passing/);
  assert.equal(badge.color, "2f6945");

  await rm(tempDir, { recursive: true, force: true });
});

test("badge shows all-passing color for successful run", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-badge-allpass-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [
      createPreflight({ agentId: "a" }),
      createPreflight({ agentId: "b" })
    ],
    results: [
      createResult(outputPath, { agentId: "a", status: "success" }),
      createResult(outputPath, { agentId: "b", status: "success" })
    ]
  });
  const { badgePath } = await writeReport(run);
  const badge = JSON.parse(await readFile(badgePath, "utf8"));

  assert.equal(badge.message, "2/2 passing");
  assert.equal(badge.color, "2f6945");

  await rm(tempDir, { recursive: true, force: true });
});

test("badge shows partial-passing color for mixed results", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-badge-mixed-"));
  const outputPath = path.join(tempDir, "output");

  const run = createMultiAgentFixture(outputPath);
  const { badgePath } = await writeReport(run);
  const badge = JSON.parse(await readFile(badgePath, "utf8"));

  assert.equal(badge.message, "1/2 passing");
  assert.equal(badge.color, "8d6715");

  await rm(tempDir, { recursive: true, force: true });
});

test("badge shows failing color when all fail", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-badge-fail-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [createPreflight()],
    results: [createResult(outputPath, { status: "failed" })]
  });
  const { badgePath } = await writeReport(run);
  const badge = JSON.parse(await readFile(badgePath, "utf8"));

  assert.equal(badge.message, "0/1 passing");
  assert.equal(badge.color, "8f3426");

  await rm(tempDir, { recursive: true, force: true });
});

test("badge shows lightgrey for empty results", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-badge-empty-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, { results: [] });
  const { badgePath } = await writeReport(run);
  const badge = JSON.parse(await readFile(badgePath, "utf8"));

  assert.equal(badge.message, "0/0 passing");
  assert.equal(badge.color, "lightgrey");

  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 6. Decision Report Tests
// ---------------------------------------------------------------------------

test("generateDecisionReport returns full structured report", () => {
  const run = createRun("/tmp/decision-test", {
    results: [
      createResult("/tmp/decision-test", {
        agentId: "agent-a",
        displayLabel: "Agent A",
        compositeScore: 85,
        status: "success",
        estimatedCostUsd: 0.2,
        costKnown: true,
        durationMs: 8000
      })
    ]
  });

  const report = generateDecisionReport(run);

  assert.ok(report.generatedAt);
  assert.equal(typeof report.scenario, "string");
  assert.ok(Array.isArray(report.recommendations));
  assert.ok(Array.isArray(report.teamEstimates));
  assert.ok(Array.isArray(report.keyInsights));
  assert.ok(Array.isArray(report.warnings));
  assert.ok(Array.isArray(report.failureDiagnostics));
  assert.equal(typeof report.reproduceCommand, "string");
  assert.ok(report.reproduceCommand.includes("agentarena run"));
});

test("generateDecisionReport recommends highest scoring agent", () => {
  const run = createRun("/tmp/decision-rec", {
    results: [
      createResult("/tmp/decision-rec", { agentId: "fast-agent", displayLabel: "Fast Agent", compositeScore: 60, status: "success", estimatedCostUsd: 0.05, costKnown: true, durationMs: 3000 }),
      createResult("/tmp/decision-rec", { agentId: "best-agent", displayLabel: "Best Agent", compositeScore: 90, status: "success", estimatedCostUsd: 0.3, costKnown: true, durationMs: 15000 }),
      createResult("/tmp/decision-rec", { agentId: "worst-agent", displayLabel: "Worst Agent", compositeScore: 25, status: "success", estimatedCostUsd: 0.1, costKnown: true, durationMs: 5000 })
    ]
  });

  const report = generateDecisionReport(run);

  // Highest score is rank 1, recommended
  assert.equal(report.recommendations[0].agentId, "best-agent");
  assert.equal(report.recommendations[0].recommendation, "recommended");
  assert.equal(report.recommendations[0].rank, 1);

  // Second highest is alternative
  const second = report.recommendations.find(r => r.agentId === "fast-agent");
  assert.ok(second);
  assert.equal(second.recommendation, "alternative");

  // Lowest score is not-recommended
  const worst = report.recommendations.find(r => r.agentId === "worst-agent");
  assert.ok(worst);
  assert.equal(worst.recommendation, "not-recommended");
});

test("generateDecisionReport handles all failures with warnings", () => {
  const run = createRun("/tmp/decision-allfail", {
    results: [
      createResult("/tmp/decision-allfail", { agentId: "a", displayLabel: "A", status: "failed", compositeScore: 0, summary: "Agent timed out" }),
      createResult("/tmp/decision-allfail", { agentId: "b", displayLabel: "B", status: "failed", compositeScore: 0, summary: "Agent crashed" })
    ]
  });

  const report = generateDecisionReport(run);

  // All not-recommended
  assert.ok(report.recommendations.every(r => r.recommendation !== "recommended"));

  // Warnings present
  assert.ok(report.warnings.length > 0);
  assert.ok(report.warnings.some(w => /fail/i.test(w)));

  // Failure diagnostics
  assert.equal(report.failureDiagnostics.length, 2);
});

test("generateDecisionReport computes team cost estimates", () => {
  const run = createRun("/tmp/decision-cost", {
    results: [
      createResult("/tmp/decision-cost", { agentId: "cheap", displayLabel: "Cheap", compositeScore: 70, status: "success", estimatedCostUsd: 0.05, costKnown: true }),
      createResult("/tmp/decision-cost", { agentId: "expensive", displayLabel: "Expensive", compositeScore: 90, status: "success", estimatedCostUsd: 0.5, costKnown: true })
    ]
  });

  const report = generateDecisionReport(run, { teamSize: 10, dailyRuns: 5 });

  assert.equal(report.teamEstimates.length, 2);

  // Cheapest first
  assert.equal(report.teamEstimates[0].agentId, "cheap");
  assert.ok(report.teamEstimates[0].monthlyCost < report.teamEstimates[1].monthlyCost);

  // Cost per run matches input
  assert.equal(report.teamEstimates[0].costPerRun, 0.05);
  assert.equal(report.teamEstimates[1].costPerRun, 0.5);

  // Monthly cost = costPerRun * teamSize * dailyRuns * 22 working days
  assert.equal(report.teamEstimates[0].monthlyCost, 0.05 * 10 * 5 * 22);
});

test("generateDecisionReport extracts key insights", () => {
  const run = createRun("/tmp/decision-insights", {
    results: [
      createResult("/tmp/decision-insights", { agentId: "fast", displayLabel: "Fast", compositeScore: 80, status: "success", durationMs: 5000, costKnown: true, estimatedCostUsd: 0.1 }),
      createResult("/tmp/decision-insights", { agentId: "slow", displayLabel: "Slow", compositeScore: 65, status: "success", durationMs: 55000, costKnown: true, estimatedCostUsd: 0.3 })
    ]
  });

  const report = generateDecisionReport(run);

  assert.ok(report.keyInsights.length > 0);
  // Should mention highest scoring agent
  assert.ok(report.keyInsights.some(i => /Fast/i.test(i) && /80/.test(i)));
});

test("formatDecisionReport produces valid markdown with recommendations", () => {
  const run = createRun("/tmp/decision-fmt", {
    results: [
      createResult("/tmp/decision-fmt", { agentId: "agent-x", displayLabel: "Agent X", compositeScore: 85, status: "success", estimatedCostUsd: 0.1, costKnown: true, durationMs: 8000 })
    ]
  });

  const report = generateDecisionReport(run);
  const md = formatDecisionReport(report, "en");

  assert.match(md, /# AgentArena Decision Report/);
  assert.match(md, /Generated/);
  assert.match(md, /Scenario/);
  assert.match(md, /Recommendations/);
  assert.match(md, /Agent X/);
  assert.match(md, /recommended/);
  assert.match(md, /Success rate/);
  assert.match(md, /Avg cost/);
  assert.match(md, /Avg duration/);
  assert.match(md, /Confidence/);
  assert.match(md, /agentarena run/);
});

test("formatDecisionReport includes failure diagnostics", () => {
  const run = createRun("/tmp/decision-diag", {
    results: [
      createResult("/tmp/decision-diag", {
        agentId: "fail-agent",
        displayLabel: "Fail Agent",
        status: "failed",
        compositeScore: 0,
        summary: "Agent timed out before producing a final message."
      })
    ]
  });

  const report = generateDecisionReport(run);
  const md = formatDecisionReport(report, "en");

  assert.match(md, /Failure diagnosis/);
  assert.match(md, /Cause:/);
  assert.match(md, /Fix:/);
});

test("formatDecisionReport renders zh-CN locale", () => {
  const run = createRun("/tmp/decision-zh", {
    results: [
      createResult("/tmp/decision-zh", { agentId: "a", displayLabel: "A", compositeScore: 70, status: "success", costKnown: true, estimatedCostUsd: 0.1 })
    ]
  });

  const report = generateDecisionReport(run);
  const md = formatDecisionReport(report, "zh-CN");

  assert.match(md, /AgentArena 决策报告/);
  assert.match(md, /推荐方案/);
  assert.match(md, /复现命令/);
});

// ---------------------------------------------------------------------------
// 7. Conclusion Tests
// ---------------------------------------------------------------------------

test("generateConclusion returns all-failed category when no agents succeed", () => {
  const run = {
    runId: "conc-test",
    createdAt: "2026-06-11T00:00:00Z",
    repoPath: ".",
    outputPath: "/tmp/conc",
    task: { id: "t", title: "T", prompt: "P" },
    preflights: [],
    results: [
      createResult("/tmp/conc", { agentId: "a", status: "failed", summary: "Agent timed out" }),
      createResult("/tmp/conc", { agentId: "b", status: "failed", summary: "Agent timed out" })
    ]
  };

  const conclusion = generateConclusion(run);
  assert.equal(conclusion.category, "all-failed");
  assert.ok(conclusion.verdict.includes("No valid results"));
  assert.ok(conclusion.explanation.length > 0);
  assert.ok(conclusion.nextStep.length > 0);
});

test("generateConclusion returns single-success for one passing agent", () => {
  const run = {
    runId: "conc-single",
    createdAt: "2026-06-11T00:00:00Z",
    repoPath: ".",
    outputPath: "/tmp/conc",
    task: { id: "t", title: "T", prompt: "P" },
    preflights: [],
    results: [
      createResult("/tmp/conc", {
        agentId: "solo",
        displayLabel: "Solo Agent",
        status: "success",
        compositeScore: 75,
        judgeResults: [
          { judgeId: "j", label: "J", type: "test-result", exitCode: 0, success: true, stdout: "", stderr: "", durationMs: 100 }
        ]
      })
    ]
  };

  const conclusion = generateConclusion(run);
  assert.equal(conclusion.category, "single-success");
  assert.ok(conclusion.verdict.includes("Solo Agent"));
  assert.ok(conclusion.verdict.includes("75"));
});

test("generateConclusion returns multi-success for multiple passing agents", () => {
  const run = {
    runId: "conc-multi",
    createdAt: "2026-06-11T00:00:00Z",
    repoPath: ".",
    outputPath: "/tmp/conc",
    task: { id: "t", title: "T", prompt: "P" },
    preflights: [],
    results: [
      createResult("/tmp/conc", { agentId: "a", displayLabel: "Agent A", status: "success", compositeScore: 90 }),
      createResult("/tmp/conc", { agentId: "b", displayLabel: "Agent B", status: "success", compositeScore: 70 })
    ]
  };

  const conclusion = generateConclusion(run);
  assert.equal(conclusion.category, "multi-success");
  assert.ok(conclusion.verdict.includes("Agent A"));
  assert.ok(conclusion.verdict.includes("90"));
});

test("generateConclusion returns partial-success for mixed results", () => {
  const run = {
    runId: "conc-partial",
    createdAt: "2026-06-11T00:00:00Z",
    repoPath: ".",
    outputPath: "/tmp/conc",
    task: { id: "t", title: "T", prompt: "P" },
    preflights: [],
    results: [
      createResult("/tmp/conc", { agentId: "winner", displayLabel: "Winner", status: "success", compositeScore: 80 }),
      createResult("/tmp/conc", { agentId: "loser", displayLabel: "Loser", status: "failed", compositeScore: 0 })
    ]
  };

  const conclusion = generateConclusion(run);
  assert.equal(conclusion.category, "partial-success");
  assert.ok(conclusion.verdict.includes("Winner"));
});

test("generateConclusion zh-CN locale produces Chinese verdict", () => {
  const run = {
    runId: "conc-zh",
    createdAt: "2026-06-11T00:00:00Z",
    repoPath: ".",
    outputPath: "/tmp/conc",
    task: { id: "t", title: "T", prompt: "P" },
    preflights: [],
    results: [
      createResult("/tmp/conc", { agentId: "a", displayLabel: "Agent A", status: "success", compositeScore: 80 })
    ]
  };

  const conclusion = generateConclusion(run, "zh-CN");
  assert.ok(conclusion.verdict.includes("Agent A"));
  assert.ok(conclusion.category === "single-success");
});

// ---------------------------------------------------------------------------
// 8. Edge Case Tests
// ---------------------------------------------------------------------------

test("all report outputs generated for empty results run", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-edge-empty-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [],
    results: []
  });

  const { htmlPath, jsonPath, markdownPath, badgePath, prCommentPath } = await writeReport(run);

  // All files created
  const html = await readFile(htmlPath, "utf8");
  const json = JSON.parse(await readFile(jsonPath, "utf8"));
  const md = await readFile(markdownPath, "utf8");
  const badge = JSON.parse(await readFile(badgePath, "utf8"));
  const prComment = await readFile(prCommentPath, "utf8");

  // HTML renders without errors
  assert.match(html, /AgentArena Report/);
  assert.match(html, /<\/html>/);

  // JSON has zero results
  assert.equal(json.results.length, 0);

  // Markdown shows 0/0 success rate
  assert.match(md, /Success Rate:.*0\/0/);

  // Badge shows 0/0
  assert.equal(badge.message, "0/0 passing");
  assert.equal(badge.color, "lightgrey");

  // PR comment is present
  assert.match(prComment, /AgentArena Benchmark/);

  await rm(tempDir, { recursive: true, force: true });
});

test("single agent run generates valid outputs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-edge-single-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [createPreflight({ agentId: "solo", agentTitle: "Solo Agent" })],
    results: [
      createResult(outputPath, {
        agentId: "solo",
        agentTitle: "Solo Agent",
        displayLabel: "Solo Agent",
        status: "success",
        compositeScore: 75,
        estimatedCostUsd: 0.1,
        costKnown: true,
        tokenUsage: 150,
        durationMs: 8000,
        changedFiles: ["README.md"],
        judgeResults: [
          {
            judgeId: "file-check",
            label: "File Exists",
            type: "file-exists",
            target: "README.md",
            exitCode: 0,
            success: true,
            stdout: "File exists",
            stderr: "",
            durationMs: 10
          }
        ],
        diff: { added: ["README.md"], changed: [], removed: [] }
      })
    ]
  });

  const { jsonPath, markdownPath, badgePath, prCommentPath } = await writeReport(run);

  const json = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(json.results.length, 1);
  assert.equal(json.results[0].agentId, "solo");
  assert.equal(json.results[0].status, "success");
  assert.equal(typeof json.results[0].compositeScore, "number");

  const badge = JSON.parse(await readFile(badgePath, "utf8"));
  assert.equal(badge.message, "1/1 passing");
  assert.equal(badge.color, "2f6945");

  const md = await readFile(markdownPath, "utf8");
  assert.match(md, /Solo Agent/);
  assert.match(md, /Success Rate:.*1\/1/);

  const prComment = await readFile(prCommentPath, "utf8");
  assert.match(prComment, /1\/1.*passing/);

  await rm(tempDir, { recursive: true, force: true });
});

test("all-failed agents run generates proper failure diagnostics", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-edge-allfail-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [
      createPreflight({ agentId: "fail-a", agentTitle: "Fail A" }),
      createPreflight({ agentId: "fail-b", agentTitle: "Fail B" })
    ],
    results: [
      createResult(outputPath, {
        agentId: "fail-a",
        agentTitle: "Fail A",
        displayLabel: "Fail A",
        status: "failed",
        summary: "Agent timed out before producing a final message.",
        compositeScore: 20,
        judgeResults: []
      }),
      createResult(outputPath, {
        agentId: "fail-b",
        agentTitle: "Fail B",
        displayLabel: "Fail B",
        status: "failed",
        summary: "Agent crashed with exit code 1",
        compositeScore: 15,
        judgeResults: []
      })
    ]
  });

  const { jsonPath, markdownPath, badgePath, prCommentPath } = await writeReport(run);

  const json = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(json.results.length, 2);
  assert.ok(json.results.every(r => r.status === "failed"));

  const badge = JSON.parse(await readFile(badgePath, "utf8"));
  assert.equal(badge.message, "0/2 passing");
  assert.equal(badge.color, "8f3426");

  const md = await readFile(markdownPath, "utf8");
  assert.match(md, /## Failures/);
  assert.match(md, /fail-a/);
  assert.match(md, /fail-b/);

  const prComment = await readFile(prCommentPath, "utf8");
  assert.match(prComment, /### Review Focus/);
  assert.match(prComment, /fail-a/);

  await rm(tempDir, { recursive: true, force: true });
});

test("score-excluded results show n/a score and exclusion reason", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-edge-excluded-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [],
    results: [
      createResult(outputPath, {
        agentId: "excluded-agent",
        displayLabel: "Excluded Agent",
        status: "failed",
        summary: "Task setup failed",
        scoreExcluded: true,
        scoreExclusionReason: "Task setup failed before the agent started.",
        failureCategory: "task-pack",
        setupResults: [
          {
            stepId: "install",
            label: "Install deps",
            command: "[redacted]",
            exitCode: 1,
            success: false,
            stdout: "[redacted]",
            stderr: "[redacted]",
            durationMs: 10,
            cwd: "workspace/excluded-agent"
          }
        ]
      })
    ]
  });

  const { jsonPath, markdownPath } = await writeReport(run);

  const json = JSON.parse(await readFile(jsonPath, "utf8"));
  const result = json.results[0];
  assert.equal(result.scoreExcluded, true);
  assert.equal(result.scoreExclusionReason, "Task setup failed before the agent started.");

  const md = await readFile(markdownPath, "utf8");
  assert.match(md, /Composite Score: n\/a/);

  await rm(tempDir, { recursive: true, force: true });
});

test("missing cost data renders n/a in all output formats", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-edge-nocost-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [createPreflight()],
    results: [
      createResult(outputPath, {
        costKnown: false,
        estimatedCostUsd: 0,
        tokenUsage: 50
      })
    ]
  });

  const { jsonPath, markdownPath, badgePath } = await writeReport(run);

  const json = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(json.results[0].costKnown, false);

  const md = await readFile(markdownPath, "utf8");
  // Cost should show n/a when costKnown is false
  assert.match(md, /n\/a/);

  const badge = JSON.parse(await readFile(badgePath, "utf8"));
  assert.equal(badge.message, "1/1 passing");

  await rm(tempDir, { recursive: true, force: true });
});

test("estimated cost is marked and excluded from known totals", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-edge-estimated-cost-"));
  const outputPath = path.join(tempDir, "output");
  const run = createRun(outputPath, {
    preflights: [createPreflight()],
    results: [createResult(outputPath, { costKnown: false, costQuality: "estimated", estimatedCostUsd: 0.08 })]
  });
  const reportHelpers = await import("../packages/report/dist/report-helpers.js");
  assert.equal(reportHelpers.summarizeRun(run).knownCostUsd, 0);
  const { markdownPath, htmlPath } = await writeReport(run);
  const markdown = await readFile(markdownPath, "utf8");
  const html = await readFile(htmlPath, "utf8");
  assert.match(markdown, /\u2248\$0\.08/);
  assert.match(html, /\u2248\$0\.08/);
  const decision = generateDecisionReport(run, { teamSize: 3, dailyRuns: 7 });
  const decisionMarkdown = formatDecisionReport(decision, "en");
  assert.match(decisionMarkdown, /Avg cost.*\u2248\$0\.08\/run/);
  assert.doesNotMatch(decisionMarkdown, /undefined\/100/);
  assert.equal(decision.teamEstimates.length, 0);
  await rm(tempDir, { recursive: true, force: true });
});

test("writeReport produces all five output paths", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-edge-paths-"));
  const outputPath = path.join(tempDir, "output");

  const run = createRun(outputPath, {
    preflights: [createPreflight()],
    results: [createResult(outputPath)]
  });

  const result = await writeReport(run);

  assert.ok(result.htmlPath.endsWith("report.html"));
  assert.ok(result.jsonPath.endsWith("summary.json"));
  assert.ok(result.markdownPath.endsWith("summary.md"));
  assert.ok(result.badgePath.endsWith("badge.json"));
  assert.ok(result.prCommentPath.endsWith("pr-comment.md"));

  await rm(tempDir, { recursive: true, force: true });
});
