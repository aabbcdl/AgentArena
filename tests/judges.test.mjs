// Allow inline node -e in test fixture task packs. Production task packs
// should use script files; tests use inline scripts for brevity.
process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES = "1";

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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

  const result = await runJudge(
    { id: "test-traversal", label: "Traversal", type: "file-exists", path: "../../etc/passwd" },
    workspace, ALLOWED_NAMES
  );

  assert.equal(result.success, false);
  assert.match(result.stderr, /path must stay inside the workspace/);

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

test(
  "command step resolves Windows npm .cmd shims without shell injection",
  { skip: process.platform !== "win32" ? "Windows-specific command shim behavior" : false },
  async () => {
    const workspace = await setupWorkspace();
    const shimDir = path.join(workspace, "shim bin");
    const capturePath = path.join(workspace, "capture.json");
    const markerPath = path.join(workspace, "injected.txt");
    const shimPath = path.join(shimDir, "npm.cmd");
    const scriptPath = path.join(shimDir, "npm-shim.mjs");

    try {
      await fs.mkdir(shimDir, { recursive: true });
      await fs.writeFile(
        scriptPath,
        [
          'import { writeFileSync } from "node:fs";',
          "writeFileSync(process.env.AGENTARENA_CAPTURE, JSON.stringify(process.argv.slice(2)), 'utf8');",
          "console.log('shim ok');",
        ].join("\n"),
        "utf8"
      );
      await fs.writeFile(shimPath, `@echo off\n"${process.execPath}" "${scriptPath}" %*\n`, "utf8");

      const markerArgPath = markerPath.replace(/\\/g, "/");
      const dangerousArg = `safe&echo injected>${markerArgPath}`;
      const result = await runCommandStep(
        {
          id: "npm-shim",
          label: "npm shim",
          command: `npm "${dangerousArg}" "plain arg"`,
          cwd: ".",
          timeoutMs: 10000,
          env: {
            PATH: shimDir,
            AGENTARENA_CAPTURE: capturePath
          }
        },
        workspace,
        []
      );

      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /shim ok/);
      assert.deepEqual(JSON.parse(await fs.readFile(capturePath, "utf8")), [dangerousArg, "plain arg"]);
      assert.equal(await fileExists(markerPath), false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }
);

test(
  "command step rejects Windows batch arguments that cmd.exe would expand",
  { skip: process.platform !== "win32" ? "Windows-specific command shim behavior" : false },
  async () => {
    const workspace = await setupWorkspace();
    const shimDir = path.join(workspace, "shim-bin");
    const shimPath = path.join(shimDir, "npm.cmd");
    const scriptPath = path.join(shimDir, "npm-shim.mjs");

    try {
      await fs.mkdir(shimDir, { recursive: true });
      await fs.writeFile(scriptPath, "console.log('should not run');\n", "utf8");
      await fs.writeFile(shimPath, `@echo off\n"${process.execPath}" "${scriptPath}" %*\n`, "utf8");

      const result = await runCommandStep(
        {
          id: "npm-expand",
          label: "npm expand",
          command: "npm \"a%PATH%b\"",
          cwd: ".",
          timeoutMs: 10000,
          env: { PATH: shimDir }
        },
        workspace,
        []
      );

      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /unsupported.*cmd\.exe/i);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }
);

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

test("judges can run concurrently in a shared workspace", async () => {
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
        command: "node -e \"(async()=>{const fs=require('node:fs');const end=Date.now()+2000;while(Date.now()<end){if(fs.existsSync('marker.txt'))process.exit(0);await new Promise(r=>setTimeout(r,50));}process.exit(1);})()\""
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

test("token-efficiency judge returns neutral score when no budget and no usage", async () => {
  const result = await runJudge(
    { id: "te-1", label: "TE no data", type: "token-efficiency" },
    ".",
    [],
    { tokenUsage: undefined, tokenBudget: undefined }
  );
  assert.equal(result.success, false);
  assert.ok(result.stdout.includes("Token usage data not available"));
});

test("token-efficiency judge calculates score within budget", async () => {
  const result = await runJudge(
    { id: "te-2", label: "TE within budget", type: "token-efficiency" },
    ".",
    [],
    { tokenUsage: 500, tokenBudget: 1000 }
  );
  assert.equal(result.success, true);
  assert.ok(result.stdout.includes("Token efficiency"));
  assert.ok(result.stdout.includes("100.0%") || result.stdout.includes("90.0%") || result.stdout.includes("80.0%"));
});

test("token-efficiency judge fails when over budget", async () => {
  const result = await runJudge(
    { id: "te-3", label: "TE over budget", type: "token-efficiency" },
    ".",
    [],
    { tokenUsage: 2000, tokenBudget: 1000 }
  );
  assert.equal(result.success, false);
  assert.ok(result.stdout.includes("Token efficiency"));
  assert.ok(result.stderr.includes("exceeded budget"));
});

test("token-efficiency judge handles zero budget gracefully", async () => {
  const result = await runJudge(
    { id: "te-4", label: "TE zero budget", type: "token-efficiency" },
    ".",
    [],
    { tokenUsage: 100, tokenBudget: 0 }
  );
  assert.equal(result.success, true);
  assert.ok(result.stdout.includes("neutral score"));
});

test("token-efficiency judge handles zero usage", async () => {
  const result = await runJudge(
    { id: "te-5", label: "TE zero usage", type: "token-efficiency" },
    ".",
    [],
    { tokenUsage: 0, tokenBudget: 1000 }
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

// A Jest-shaped report with per-assertion results. `extractTestDetails` reads
// testResults[].assertionResults[].{title,fullName,status}; the aggregate
// counters satisfy parseTestSummary. Statuses use the normalized "pass"/"fail"
// vocabulary the patch-validation judge compares against.
function jestReportJson({ assertions, numPassed, numFailed }) {
  const payload = {
    numTotalTests: assertions.length,
    numPassedTests: numPassed,
    numFailedTests: numFailed,
    numPendingTests: 0,
    success: numFailed === 0,
    testResults: [
      {
        assertionResults: assertions.map((a) => ({
          title: a.name,
          fullName: a.name,
          status: a.status
        }))
      }
    ]
  };
  return JSON.stringify(payload);
}

test("patch-validation judge populates failToPass/passToPass results with statuses", async () => {
  const workspace = await setupWorkspace();

  // f2p_a passes, f2p_b fails; p2p_a passes; p2p_missing is absent (→ error).
  const report = jestReportJson({
    assertions: [
      { name: "f2p_a", status: "pass" },
      { name: "f2p_b", status: "fail" },
      { name: "p2p_a", status: "pass" }
    ],
    numPassed: 2,
    numFailed: 1
  });

  const result = await runJudge(
    {
      id: "pv-results",
      label: "Patch validation results",
      type: "patch-validation",
      testSuite: `node -e "console.log(JSON.stringify(${JSON.stringify(report)}))"`,
      failToPassTests: ["f2p_a", "f2p_b"],
      passToPassTests: ["p2p_a", "p2p_missing"]
    },
    workspace,
    ALLOWED_NAMES
  );

  assert.equal(result.type, "patch-validation");
  assert.ok(Array.isArray(result.failToPassResults), "failToPassResults should be an array");
  assert.ok(Array.isArray(result.passToPassResults), "passToPassResults should be an array");

  assert.deepEqual(result.failToPassResults, [
    { test: "f2p_a", status: "pass" },
    { test: "f2p_b", status: "fail" }
  ]);
  // Missing test maps "not_found" → "error".
  assert.deepEqual(result.passToPassResults, [
    { test: "p2p_a", status: "pass" },
    { test: "p2p_missing", status: "error" }
  ]);

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
