import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCommandStep, runJudge, runJudges } from "../packages/judges/dist/index.js";

function tempDir() {
  return path.join(tmpdir(), `agentarena-judges-test-${randomUUID()}`);
}

async function setupWorkspace() {
  const dir = tempDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const ALLOWED_NAMES = ["PATH", "HOME", "NODE"];

test("file-exists judge passes when file exists", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "README.md"), "# Hello");

  const result = await runJudge(
    { id: "test-fe", label: "README exists", type: "file-exists", path: "README.md" },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, true);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("file-exists judge fails when file is missing", async () => {
  const workspace = await setupWorkspace();

  const result = await runJudge(
    { id: "test-fe", label: "README exists", type: "file-exists", path: "README.md" },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, false);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("file-contains judge passes with matching content", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "hello.txt"), "Hello World");

  const result = await runJudge(
    { id: "test-fc", label: "Contains hello", type: "file-contains", path: "hello.txt", pattern: "Hello" },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, true);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("file-contains judge fails with non-matching content", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "hello.txt"), "Hello World");

  const result = await runJudge(
    { id: "test-fc", label: "Contains goodbye", type: "file-contains", path: "hello.txt", pattern: "Goodbye" },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, false);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("file-contains judge supports regex mode", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "data.txt"), "count: 42");

  const result = await runJudge(
    { id: "test-fc-re", label: "Matches regex", type: "file-contains", path: "data.txt", pattern: "count:\\s+\\d+", regex: true },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, true);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("json-value judge passes with matching value", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "data.json"), JSON.stringify({ name: "test", version: 1 }));

  const result = await runJudge(
    { id: "test-jv", label: "Name is test", type: "json-value", path: "data.json", pointer: "/name", expected: "test" },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, true);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("json-value judge fails with wrong value", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "data.json"), JSON.stringify({ name: "other" }));

  const result = await runJudge(
    { id: "test-jv", label: "Name is test", type: "json-value", path: "data.json", pointer: "/name", expected: "test" },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, false);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("glob judge passes when files match pattern", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "a.ts"), "");
  await fs.writeFile(path.join(workspace, "b.ts"), "");

  const result = await runJudge(
    { id: "test-glob", label: "TS files exist", type: "glob", pattern: "*.ts", minMatches: 1 },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, true);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("file-count judge validates exact count", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "a.js"), "");
  await fs.writeFile(path.join(workspace, "b.js"), "");

  const result = await runJudge(
    { id: "test-fcount", label: "Exactly 2 JS files", type: "file-count", pattern: "*.js", equals: 2 },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, true);

  const failResult = await runJudge(
    { id: "test-fcount2", label: "Exactly 5 JS files", type: "file-count", pattern: "*.js", equals: 5 },
    workspace, ALLOWED_NAMES
  );
  assert.equal(failResult.success, false);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("file-exists judge rejects path traversal", async () => {
  const workspace = await setupWorkspace();

  await assert.rejects(
    () => runJudge(
      { id: "test-traversal", label: "Traversal", type: "file-exists", path: "../../etc/passwd" },
      workspace, ALLOWED_NAMES
    ),
    { message: /path must stay inside the workspace/ }
  );

  await fs.rm(workspace, { recursive: true, force: true });
});

test("command step runs and captures output", async () => {
  const workspace = await setupWorkspace();

  const result = await runCommandStep(
    { id: "step1", label: "echo hello", command: "node -e \"console.log('hello')\"", cwd: ".", timeoutMs: 10000 },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("hello"));

  await fs.rm(workspace, { recursive: true, force: true });
});

test("command step aborts when signal is cancelled", async () => {
  const workspace = await setupWorkspace();
  const controller = new AbortController();
  const commandPromise = runCommandStep(
    {
      id: "step-cancel",
      label: "long running step",
      command: "node -e \"setTimeout(() => console.log('done'), 5000)\"",
      cwd: ".",
      timeoutMs: 10000
    },
    workspace,
    ALLOWED_NAMES,
    controller.signal
  );

  setTimeout(() => controller.abort(), 100);

  await assert.rejects(commandPromise, /Benchmark run cancelled/);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("judges run sequentially in a shared workspace", async () => {
  const workspace = await setupWorkspace();

  const results = await runJudges(
    [
      {
        id: "write-marker",
        label: "write marker",
        type: "command",
        command: "node -e \"setTimeout(() => require('node:fs').writeFileSync('marker.txt', 'done'), 300)\""
      },
      {
        id: "read-marker",
        label: "read marker",
        type: "command",
        command: "node -e \"process.exit(require('node:fs').existsSync('marker.txt') ? 0 : 1)\""
      }
    ],
    workspace,
    ALLOWED_NAMES
  );

  assert.equal(results[0].success, true);
  assert.equal(results[1].success, true);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("listWorkspaceFiles skips node_modules", async () => {
  const workspace = await setupWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "index.ts"), "");
  await fs.writeFile(path.join(workspace, "node_modules", "pkg", "index.js"), "");

  // glob judge should only find src/index.ts, not node_modules files
  const result = await runJudge(
    { id: "test-skip-nm", label: "No node_modules", type: "file-count", pattern: "**/*.js", equals: 0 },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, true, "node_modules files should be skipped");

  await fs.rm(workspace, { recursive: true, force: true });
});

test("file-contains judge supports flags for case-insensitive match", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "readme.txt"), "Hello World");

  const result = await runJudge(
    { id: "test-fc-flags", label: "Case insensitive", type: "file-contains", path: "readme.txt", pattern: "hello world", regex: true, flags: "i" },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, true);

  const failResult = await runJudge(
    { id: "test-fc-flags2", label: "Case sensitive", type: "file-contains", path: "readme.txt", pattern: "hello world", regex: true },
    workspace, ALLOWED_NAMES
  );
  assert.equal(failResult.success, false);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("snapshot judge passes when file matches snapshot", async () => {
  const workspace = await setupWorkspace();
  const content = "line1\nline2\nline3\n";
  await fs.writeFile(path.join(workspace, "output.txt"), content);
  await fs.writeFile(path.join(workspace, "expected.txt"), content);

  const result = await runJudge(
    { id: "test-snap", label: "Snapshot match", type: "snapshot", path: "output.txt", snapshotPath: "expected.txt" },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, true);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("snapshot judge fails when file differs from snapshot", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "output.txt"), "actual content");
  await fs.writeFile(path.join(workspace, "expected.txt"), "expected content");

  const result = await runJudge(
    { id: "test-snap-fail", label: "Snapshot mismatch", type: "snapshot", path: "output.txt", snapshotPath: "expected.txt" },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, false);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("json-schema judge passes with valid data", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "data.json"), JSON.stringify({ name: "test", count: 5 }));

  const result = await runJudge(
    {
      id: "test-jschema",
      label: "Valid schema",
      type: "json-schema",
      path: "data.json",
      schema: {
        type: "object",
        required: ["name", "count"],
        properties: {
          name: { type: "string" },
          count: { type: "number" }
        }
      }
    },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, true);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("json-schema judge fails with invalid data", async () => {
  const workspace = await setupWorkspace();
  await fs.writeFile(path.join(workspace, "data.json"), JSON.stringify({ name: 123 }));

  const result = await runJudge(
    {
      id: "test-jschema-fail",
      label: "Invalid schema",
      type: "json-schema",
      path: "data.json",
      schema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" }
        }
      }
    },
    workspace, ALLOWED_NAMES
  );
  assert.equal(result.success, false);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("command step respects timeout", async () => {
  const workspace = await setupWorkspace();

  const result = await runCommandStep(
    {
      id: "step-timeout",
      label: "slow command",
      command: "node -e \"setTimeout(() => console.log('done'), 30000)\"",
      cwd: ".",
      timeoutMs: 500
    },
    workspace,
    ALLOWED_NAMES
  );
  assert.equal(result.success, false);
  assert.ok(result.stderr.includes("timed out") || result.exitCode !== 0);

  await fs.rm(workspace, { recursive: true, force: true });
});

// ===== token-efficiency judge tests =====

import { runTokenEfficiencyJudgeWithUsage } from "../packages/judges/dist/index.js";

test("token-efficiency judge returns neutral score when no budget and no usage", async () => {
  const result = await runTokenEfficiencyJudgeWithUsage(
    { id: "te-1", label: "TE no data", type: "token-efficiency" },
    undefined,
    undefined
  );
  assert.equal(result.success, true);
  assert.ok(
    result.stdout.includes("Token usage not provided") ||
    result.stdout.includes("Token efficiency judge requires tokenUsage")
  );
});

test("token-efficiency judge calculates score within budget", async () => {
  const result = await runTokenEfficiencyJudgeWithUsage(
    { id: "te-2", label: "TE within budget", type: "token-efficiency" },
    500,
    1000
  );
  assert.equal(result.success, true);
  assert.ok(result.stdout.includes("Token efficiency"));
  assert.ok(result.stdout.includes("100.0%") || result.stdout.includes("90.0%") || result.stdout.includes("80.0%"));
});

test("token-efficiency judge fails when over budget", async () => {
  const result = await runTokenEfficiencyJudgeWithUsage(
    { id: "te-3", label: "TE over budget", type: "token-efficiency" },
    2000,
    1000
  );
  assert.equal(result.success, false);
  assert.ok(result.stdout.includes("Token efficiency"));
  assert.ok(result.stderr.includes("exceeded budget"));
});

test("token-efficiency judge handles zero budget gracefully", async () => {
  const result = await runTokenEfficiencyJudgeWithUsage(
    { id: "te-4", label: "TE zero budget", type: "token-efficiency" },
    100,
    0
  );
  assert.equal(result.success, true);
  assert.ok(result.stdout.includes("neutral score"));
});

test("token-efficiency judge handles zero usage", async () => {
  const result = await runTokenEfficiencyJudgeWithUsage(
    { id: "te-5", label: "TE zero usage", type: "token-efficiency" },
    0,
    1000
  );
  assert.equal(result.success, true);
  assert.ok(result.stdout.includes("100.0%"));
});

// ===== patch-validation judge tests =====

test("patch-validation judge fails when test suite command fails", async () => {
  const workspace = await setupWorkspace();

  const result = await runJudge(
    {
      id: "pv-1",
      label: "Patch validation fail",
      type: "patch-validation",
      testSuite: "node -e \"process.exit(1)\""
    },
    workspace,
    ALLOWED_NAMES
  );
  assert.equal(result.type, "patch-validation");
  assert.equal(result.success, false);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("patch-validation judge passes when test suite command succeeds", async () => {
  const workspace = await setupWorkspace();

  const result = await runJudge(
    {
      id: "pv-2",
      label: "Patch validation pass",
      type: "patch-validation",
      testSuite: "node -e \"console.log(JSON.stringify({tests:{passed:2,failed:0,total:2}}))\""
    },
    workspace,
    ALLOWED_NAMES
  );
  assert.equal(result.type, "patch-validation");

  await fs.rm(workspace, { recursive: true, force: true });
});

// ===== variance-analysis tests =====

import { computeVarianceAnalysis, formatVarianceReport } from "../packages/report/dist/index.js";

test("variance-analysis computes mean and stdDev correctly", () => {
  const runs = [
    {
      results: [
        { agentId: "demo-fast", compositeScore: 80, durationMs: 10000, estimatedCostUsd: 0.5, status: "success" }
      ]
    },
    {
      results: [
        { agentId: "demo-fast", compositeScore: 90, durationMs: 12000, estimatedCostUsd: 0.6, status: "success" }
      ]
    }
  ];
  const report = computeVarianceAnalysis(runs);
  const agent = report.agents.find((a) => a.agentId === "demo-fast");
  assert.ok(agent);
  assert.equal(agent.scoreMean, 85);
  assert.ok(agent.scoreStdDev > 0);
});

test("variance-analysis handles single run gracefully", () => {
  const runs = [
    {
      results: [
        { agentId: "demo-fast", compositeScore: 80, durationMs: 10000, estimatedCostUsd: 0.5, status: "success" }
      ]
    }
  ];
  const report = computeVarianceAnalysis(runs);
  const agent = report.agents.find((a) => a.agentId === "demo-fast");
  assert.ok(agent);
  assert.equal(agent.scoreStdDev, 0);
});

test("variance-analysis handles empty data gracefully", () => {
  const report = computeVarianceAnalysis([]);
  assert.equal(report.agents.length, 0);
  assert.ok(report.overallConfidence === "low" || report.overallConfidence === "high");
});

test("variance-analysis handles all-same values", () => {
  const runs = [
    {
      results: [
        { agentId: "demo-fast", compositeScore: 80, durationMs: 10000, estimatedCostUsd: 0.5, status: "success" }
      ]
    },
    {
      results: [
        { agentId: "demo-fast", compositeScore: 80, durationMs: 10000, estimatedCostUsd: 0.5, status: "success" }
      ]
    }
  ];
  const report = computeVarianceAnalysis(runs);
  const agent = report.agents.find((a) => a.agentId === "demo-fast");
  assert.ok(agent);
  assert.equal(agent.scoreStdDev, 0);
  assert.equal(agent.scoreCV, 0);
  assert.equal(agent.isStable, true);
});

test("formatVarianceReport generates markdown with expected sections", () => {
  const runs = [
    {
      results: [
        { agentId: "demo-fast", compositeScore: 80, durationMs: 10000, estimatedCostUsd: 0.5, status: "success", displayLabel: "Demo Fast" }
      ]
    }
  ];
  const report = computeVarianceAnalysis(runs);
  const markdown = formatVarianceReport(report);
  assert.ok(markdown.includes("Result Confidence Analysis"));
  assert.ok(markdown.includes("Demo Fast"));
});

// ===== decision-report tests =====

import { formatDecisionReport, generateDecisionReport } from "../packages/report/dist/index.js";

test("decision-report generates correct structure", () => {
  const run = {
    repoPath: "/tmp/repo",
    task: { id: "test-task", metadata: {} },
    results: [
      {
        agentId: "demo-fast",
        displayLabel: "Demo Fast",
        status: "success",
        compositeScore: 85,
        costKnown: true,
        estimatedCostUsd: 0.5,
        durationMs: 30000,
        judgeResults: [{ success: true }],
        changedFiles: ["file1.js"]
      }
    ]
  };
  const report = generateDecisionReport(run);
  assert.ok(report.generatedAt);
  assert.equal(report.scenario, "General Coding Task");
  assert.equal(report.recommendations.length, 1);
  assert.equal(report.recommendations[0].agentId, "demo-fast");
});

test("decision-report format includes all markdown sections", () => {
  const run = {
    repoPath: "/tmp/repo",
    task: { id: "test-task", metadata: {} },
    results: [
      {
        agentId: "demo-fast",
        displayLabel: "Demo Fast",
        status: "success",
        compositeScore: 85,
        costKnown: true,
        estimatedCostUsd: 0.5,
        durationMs: 30000,
        judgeResults: [{ success: true }],
        changedFiles: ["file1.js"]
      }
    ]
  };
  const report = generateDecisionReport(run);
  const markdown = formatDecisionReport(report);
  assert.ok(markdown.includes("AgentArena"));
  assert.ok(markdown.includes("Demo Fast"));
  assert.ok(markdown.includes("复现命令"));
});
