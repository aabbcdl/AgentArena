// Allow inline node -e in test fixture task packs. Production task packs
// should use script files; tests use inline scripts for brevity.
process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES = "1";

import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateCsv, writeReport } from "../packages/report/dist/index.js";
import { runBenchmark } from "../packages/runner/dist/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_TASK = path.join(REPO_ROOT, "examples", "taskpacks", "demo-repo-health.json");

// ─── helpers ──────────────────────────────────────────────────────

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

// ─── 1. Full benchmark run ────────────────────────────────────────

test(
  "full benchmark run produces complete outputs with judge results and trace",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-integration-full-"));

    try {
      const result = await runBenchmark({
        repoPath: REPO_ROOT,
        taskPath: DEMO_TASK,
        agentIds: ["demo-fast"],
        outputPath: outputDir,
        cleanupWorkspaces: true
      });

      // Run-level metadata
      assert.ok(result.runId, "run should have a runId");
      assert.ok(result.createdAt, "run should have a createdAt timestamp");
      assert.ok(result.task, "run should include the task definition");
      assert.ok(result.outputPath, "run should have an outputPath");
      assert.equal(result.results.length, 1, "should produce exactly one result");

      const agentResult = result.results[0];

      // Agent result structure
      assert.equal(agentResult.agentId, "demo-fast");
      assert.equal(agentResult.status, "success");
      assert.ok(agentResult.durationMs > 0, "duration should be positive");
      assert.ok(agentResult.tokenUsage >= 0, "tokenUsage should be non-negative");
      assert.ok(Array.isArray(agentResult.changedFiles), "changedFiles should be an array");
      assert.ok(Array.isArray(agentResult.judgeResults), "judgeResults should be an array");
      assert.ok(agentResult.tracePath, "should have a trace path");
      assert.ok(agentResult.workspacePath, "should have a workspace path");

      // Judge results carry required fields
      for (const judge of agentResult.judgeResults) {
        assert.ok(judge.judgeId, "judge should have a judgeId");
        assert.ok(judge.label, "judge should have a label");
        assert.ok(judge.type, "judge should have a type");
        assert.equal(typeof judge.success, "boolean", "judge success should be boolean");
        assert.equal(typeof judge.durationMs, "number", "judge durationMs should be a number");
      }

      // Trace file exists and is non-empty JSONL
      const traceContent = await readFile(agentResult.tracePath, "utf8");
      assert.ok(traceContent.length > 0, "trace file should not be empty");
      const traceLines = traceContent.trim().split("\n").filter(Boolean);
      assert.ok(traceLines.length > 0, "trace should contain at least one event");

      // Output directory contains agent result data
      const agentDir = path.join(result.outputPath, "agents", "demo-fast");
      assert.ok(await fileExists(path.join(agentDir, "result.json")), "result.json should exist");
      assert.ok(await fileExists(path.join(agentDir, "trace.jsonl")), "trace.jsonl should exist");
    } finally {
      await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
  }
);

// ─── 2. Multi-agent comparison ────────────────────────────────────

test(
  "multi-agent comparison produces results for each adapter",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-integration-multi-"));

    try {
      const result = await runBenchmark({
        repoPath: REPO_ROOT,
        taskPath: DEMO_TASK,
        agentIds: ["demo-fast", "demo-thorough", "demo-budget"],
        outputPath: outputDir,
        cleanupWorkspaces: true
      });

      assert.equal(result.results.length, 3, "should have results for all three adapters");

      const agentIds = result.results.map((r) => r.agentId).sort();
      assert.deepEqual(agentIds, ["demo-budget", "demo-fast", "demo-thorough"]);

      // All should have valid terminal statuses
      for (const agentResult of result.results) {
        assert.ok(
          ["success", "failed"].includes(agentResult.status),
          `${agentResult.agentId} should have a valid status, got: ${agentResult.status}`
        );
        assert.ok(agentResult.judgeResults.length > 0, `${agentResult.agentId} should have judge results`);
        assert.ok(agentResult.durationMs >= 0, `${agentResult.agentId} should have duration`);
      }

      // Each agent gets its own output sub-directory
      for (const agentResult of result.results) {
        const agentDir = path.join(result.outputPath, "agents", agentResult.agentId);
        assert.ok(
          await fileExists(path.join(agentDir, "result.json")),
          `${agentResult.agentId} should have result.json`
        );
      }

      // Write comparison report and verify all formats
      const report = await writeReport(result);

      assert.ok(await fileExists(report.jsonPath), "summary.json should exist");
      assert.ok(await fileExists(report.htmlPath), "report.html should exist");
      assert.ok(await fileExists(report.markdownPath), "summary.md should exist");
      assert.ok(await fileExists(report.badgePath), "badge.json should exist");
      assert.ok(await fileExists(report.prCommentPath), "pr-comment.md should exist");

      // JSON summary contains all agents
      const summary = JSON.parse(await readFile(report.jsonPath, "utf8"));
      assert.equal(summary.results.length, 3, "summary should contain all three results");

      // Markdown mentions all agents
      const markdown = await readFile(report.markdownPath, "utf8");
      assert.match(markdown, /demo-fast/);
      assert.match(markdown, /demo-thorough/);
      assert.match(markdown, /demo-budget/);
    } finally {
      await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
  }
);

// ─── 3. Judge execution ──────────────────────────────────────────

test(
  "judges execute against agent workspaces and produce typed results",
  { timeout: 120_000 },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-integration-judges-"));
    const repoPath = path.join(tempDir, "repo");
    const outputPath = path.join(tempDir, "output");
    const taskPath = path.join(tempDir, "task.json");

    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Judge Integration Test\n", "utf8");
    await writeJson(path.join(repoPath, "package.json"), { name: "judge-integration", version: "0.0.0" });

    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: "judge-integration",
      title: "Judge Integration",
      prompt: "Create a benchmark marker file.",
      setupCommands: [
        {
          label: "Create fixture directory and files",
          command:
            'node -e "const fs=require(\'node:fs\');fs.mkdirSync(\'fixtures\',{recursive:true});fs.writeFileSync(\'fixtures/data.json\',JSON.stringify({ok:true,count:42}));fs.writeFileSync(\'fixtures/readme.txt\',\'hello world\');"'
        }
      ],
      judges: [
        {
          id: "file-exists-check",
          type: "file-exists",
          label: "Fixture data.json exists",
          path: "fixtures/data.json"
        },
        {
          id: "file-contains-check",
          type: "file-contains",
          label: "Readme contains hello",
          path: "fixtures/readme.txt",
          pattern: "hello"
        },
        {
          id: "json-value-check",
          type: "json-value",
          label: "Data JSON ok field is true",
          path: "fixtures/data.json",
          pointer: "/ok",
          expected: true
        },
        {
          id: "glob-check",
          type: "glob",
          label: "Fixture txt files exist",
          pattern: "fixtures/**/*.txt",
          minMatches: 1
        },
        {
          id: "command-check",
          type: "command",
          label: "Node process works",
          command: "node -e \"process.exit(0)\""
        }
      ],
      teardownCommands: [
        {
          label: "Remove fixtures",
          command: 'node -e "require(\'node:fs\').rmSync(\'fixtures\',{recursive:true,force:true})"'
        }
      ]
    });

    try {
      const result = await runBenchmark({
        repoPath,
        taskPath,
        agentIds: ["demo-fast"],
        outputPath
      });

      assert.equal(result.results[0].status, "success", "run should succeed");

      // Setup and teardown ran
      assert.ok(result.results[0].setupResults.length > 0, "should have setup results");
      assert.ok(result.results[0].teardownResults.length > 0, "should have teardown results");

      // All five judges executed
      const judgeResults = result.results[0].judgeResults;
      assert.equal(judgeResults.length, 5, "should have 5 judge results");

      const judgeTypes = judgeResults.map((j) => j.type).sort();
      assert.deepEqual(judgeTypes, ["command", "file-contains", "file-exists", "glob", "json-value"]);

      // Each judge should have passed
      for (const judge of judgeResults) {
        assert.equal(judge.success, true, `judge ${judge.judgeId} (${judge.type}) should pass`);
        assert.ok(judge.durationMs >= 0, `judge ${judge.judgeId} should have non-negative duration`);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
);

// ─── 4. Report outputs ───────────────────────────────────────────

test(
  "report generation produces HTML, MD, JSON, CSV and badge files with real content",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-integration-report-"));

    try {
      const benchmark = await runBenchmark({
        repoPath: REPO_ROOT,
        taskPath: DEMO_TASK,
        agentIds: ["demo-fast"],
        outputPath: outputDir
      });

      assert.equal(benchmark.results[0].status, "success", "benchmark should succeed");

      // Generate all report formats
      const report = await writeReport(benchmark);
      const csvContent = generateCsv(benchmark);

      // --- JSON summary ---
      assert.ok(await fileExists(report.jsonPath), "summary.json should exist");
      const summaryJson = JSON.parse(await readFile(report.jsonPath, "utf8"));
      assert.ok(summaryJson.runId, "JSON should contain runId");
      assert.ok(summaryJson.task, "JSON should contain task");
      assert.ok(Array.isArray(summaryJson.results), "JSON should contain results array");
      assert.ok(summaryJson.scoreMode, "JSON should contain scoreMode");
      assert.ok(summaryJson.scoreWeights, "JSON should contain scoreWeights");
      assert.ok(summaryJson.leaderboard, "JSON should contain leaderboard");

      // --- HTML report ---
      assert.ok(await fileExists(report.htmlPath), "report.html should exist");
      const html = await readFile(report.htmlPath, "utf8");
      assert.ok(html.length > 100, "HTML report should have substantial content");
      assert.match(html, /<html/i, "HTML should be a valid HTML document");
      assert.match(html, /AgentArena/i, "HTML should mention AgentArena");
      assert.match(html, /demo-fast/i, "HTML should mention the agent");

      // --- Markdown summary ---
      assert.ok(await fileExists(report.markdownPath), "summary.md should exist");
      const markdown = await readFile(report.markdownPath, "utf8");
      assert.ok(markdown.length > 50, "Markdown should have substantial content");
      assert.match(markdown, /# AgentArena/i, "Markdown should have a heading");
      assert.match(markdown, /demo-fast/i, "Markdown should mention the agent");
      assert.match(markdown, /Composite Score/i, "Markdown should report scores");

      // --- Badge JSON ---
      assert.ok(await fileExists(report.badgePath), "badge.json should exist");
      const badge = JSON.parse(await readFile(report.badgePath, "utf8"));
      assert.ok(badge.schemaVersion, "badge should have schemaVersion");
      assert.ok(badge.label, "badge should have a label");
      assert.ok(badge.message, "badge should have a message");
      assert.ok(badge.color, "badge should have a color");

      // --- PR comment ---
      assert.ok(await fileExists(report.prCommentPath), "pr-comment.md should exist");
      const prComment = await readFile(report.prCommentPath, "utf8");
      assert.ok(prComment.length > 50, "PR comment should have substantial content");
      assert.match(prComment, /## AgentArena/i, "PR comment should have a heading");

      // --- CSV (generated separately via generateCsv) ---
      assert.ok(typeof csvContent === "string", "CSV should be a string");
      assert.ok(csvContent.length > 0, "CSV should not be empty");
      const csvLines = csvContent.trim().split("\n");
      assert.ok(csvLines.length >= 2, "CSV should have at least a header and one data row");
      assert.match(csvLines[0], /Agent/i, "CSV header should contain 'Agent'");
      assert.match(csvLines[0], /Status/i, "CSV header should contain 'Status'");
      assert.match(csvLines[0], /Composite Score/i, "CSV header should contain 'Composite Score'");

      // Write CSV to disk and verify it is readable
      const csvPath = path.join(outputDir, "results.csv");
      await writeFile(csvPath, csvContent, "utf8");
      assert.ok(await fileExists(csvPath), "written CSV file should exist");
      const readBack = await readFile(csvPath, "utf8");
      assert.equal(readBack, csvContent, "CSV round-trip should be identical");
    } finally {
      await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
  }
);

// ─── 5. Cancellation ─────────────────────────────────────────────

test(
  "cancellation stops execution and produces cancelled status with cleanup",
  { timeout: 120_000 },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-integration-cancel-"));
    const repoPath = path.join(tempDir, "repo");
    const outputPath = path.join(tempDir, "output");
    const taskPath = path.join(tempDir, "task.json");

    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Cancel Test\n", "utf8");
    await writeJson(path.join(repoPath, "package.json"), { name: "cancel-test", version: "0.0.0" });

    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: "cancel-integration",
      title: "Cancel Integration",
      prompt: "Cancellation integration test.",
      setupCommands: [
        {
          label: "Create teardown probe",
          command:
            'node -e "require(\'node:fs\').writeFileSync(\'setup-marker.txt\',\'ready\')"'
        }
      ],
      teardownCommands: [
        {
          label: "Write teardown marker",
          command:
            'node -e "require(\'node:fs\').writeFileSync(\'teardown-marker.txt\',\'done\')"'
        }
      ],
      judges: [
        {
          id: "pass",
          type: "command",
          label: "Always pass",
          command: 'node -e "process.exit(0)"'
        }
      ]
    });

    try {
      const controller = new AbortController();
      const events = [];

      const benchmarkPromise = runBenchmark({
        repoPath,
        taskPath,
        agentIds: ["demo-thorough"],
        outputPath,
        cancellation: {
          signal: controller.signal,
          throwIfCancelled: () => {
            if (controller.signal.aborted) {
              throw new Error("cancelled");
            }
          }
        },
        onProgress: (event) => {
          events.push(event);
          if (event.phase === "agent-start") {
            setTimeout(() => controller.abort(), 1000);
          }
        }
      });

      const benchmark = await benchmarkPromise;
      const result = benchmark.results[0];

      // Agent should report cancelled
      assert.equal(result.status, "cancelled", "result status should be cancelled");

      // Teardown should still run after cancellation
      assert.ok(result.teardownResults.length > 0, "teardown should have executed");
      assert.equal(result.teardownResults[0].success, true, "teardown should succeed");

      // Teardown marker file should exist in workspace
      const teardownMarker = await readFile(
        path.join(result.workspacePath, "teardown-marker.txt"),
        "utf8"
      );
      assert.equal(teardownMarker, "done", "teardown marker should be written");

      // Progress events should include a cancellation message
      const cancelledEvents = events.filter(
        (e) => /cancelled/i.test(e.message)
      );
      assert.ok(cancelledEvents.length > 0, "should have at least one cancellation progress event");

      // A complete event should still fire
      const completeEvents = events.filter((e) => e.phase === "complete");
      assert.ok(completeEvents.length > 0, "complete phase should still fire after cancellation");
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
);

// ─── 6. Resume ───────────────────────────────────────────────────

test(
  "resume skips completed agents and runs only the remaining ones",
  { timeout: 120_000 },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-integration-resume-"));
    const repoPath = path.join(tempDir, "repo");
    const outputPath = path.join(tempDir, "output");
    const taskPath = path.join(tempDir, "task.json");

    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Resume Test\n", "utf8");
    await writeJson(path.join(repoPath, "package.json"), { name: "resume-test", version: "0.0.0" });

    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: "resume-integration",
      title: "Resume Integration",
      prompt: "Resume integration test.",
      judges: [
        {
          id: "pass",
          type: "command",
          label: "Always pass",
          command: 'node -e "process.exit(0)"'
        }
      ]
    });

    try {
      // Phase 1: Run only demo-fast
      const firstRun = await runBenchmark({
        repoPath,
        taskPath,
        agentIds: ["demo-fast"],
        outputPath,
        runId: "resume-integration-run"
      });

      assert.equal(firstRun.results.length, 1, "first run should have 1 result");
      assert.equal(firstRun.results[0].status, "success", "first run result should succeed");

      // Verify result.json was persisted
      const firstResultPath = path.join(
        firstRun.outputPath,
        "agents",
        "demo-fast",
        "result.json"
      );
      assert.ok(await fileExists(firstResultPath), "first run result.json should exist");

      // Mutate the persisted result to prove resume reads from disk
      const persisted = JSON.parse(await readFile(firstResultPath, "utf8"));
      persisted.summary = "RESUMED_SENTINEL";
      await writeFile(firstResultPath, JSON.stringify(persisted, null, 2), "utf8");

      // Phase 2: Resume, requesting demo-fast (already done) + demo-budget (new)
      const resumedRun = await runBenchmark({
        repoPath,
        taskPath,
        agentIds: ["demo-fast", "demo-budget"],
        outputPath,
        runId: "resume-integration-run",
        resumeFrom: firstRun.outputPath
      });

      assert.equal(resumedRun.results.length, 2, "resumed run should have 2 results");

      const fastResult = resumedRun.results.find((r) => r.variantId === "demo-fast");
      const budgetResult = resumedRun.results.find((r) => r.variantId === "demo-budget");

      assert.ok(fastResult, "demo-fast should be present in resumed results");
      assert.ok(budgetResult, "demo-budget should be present in resumed results");

      // demo-fast was resumed from disk (sentinel preserved)
      assert.equal(
        fastResult.summary,
        "RESUMED_SENTINEL",
        "resumed demo-fast should read persisted result"
      );

      // demo-budget was freshly executed
      assert.equal(budgetResult.status, "success", "demo-budget should have run successfully");
      assert.ok(budgetResult.durationMs > 0, "demo-budget should have positive duration");

      // Both should have persisted result files
      assert.ok(
        await fileExists(path.join(resumedRun.outputPath, "agents", "demo-budget", "result.json")),
        "demo-budget result.json should exist after resume"
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
);
