// Allow inline node -e in test fixture task packs. Production task packs
// should use script files; tests use inline scripts for brevity.
process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES = "1";

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ENTRY = path.join(REPO_ROOT, "packages", "cli", "dist", "index.js");

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function runCli(args, cwd, envOverrides = {}) {
  const cliPath = CLI_ENTRY;

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...envOverrides
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on("error", (error) => {
      reject(error);
    });
  });
}

async function getAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function startUiServer(cwd, extraArgs = [], envOverrides = {}) {
  const cliPath = CLI_ENTRY;
  const port = await getAvailablePort();
  // Pre-generate an explicit auth token to avoid stdout/file race conditions.
  // The CLI masks tokens in stdout for security, so parsing from stdout no longer works.
  const authToken = `test-token-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const child = spawn(process.execPath, [cliPath, "ui", "--host", "127.0.0.1", "--port", String(port), "--no-open", "--auth-token", authToken, ...extraArgs], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...envOverrides
    }
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const _started = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`UI server did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`)), 10000);
    const onData = () => {
      if (stdout.includes("auth_token_file=")) {
        clearTimeout(timeout);
        resolve(true);
      }
    };
    child.stdout.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`UI server exited early with code ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`)));
  });

  return {
    port,
    child,
    stdout,
    stderr,
    authToken,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  };
}

test("agentarena run exits with code 0 on successful benchmark", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output-success");
  const taskPath = path.join(tempDir, "task-success.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "cli-success",
    title: "CLI Success",
    prompt: "Run a passing benchmark",
    judges: [
      {
        id: "pass",
        type: "command",
        label: "Always pass",
        command: "node -e \"process.exit(0)\""
      }
    ]
  });

  const result = await runCli(
    ["run", "--repo", repoPath, "--task", taskPath, "--agents", "demo-fast", "--output", outputPath],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /AgentArena run complete/);

  const runDirs = await readdir(outputPath, { withFileTypes: true });
  assert.equal(runDirs.length, 1);
  assert.equal(runDirs[0].isDirectory(), true);
  assert.ok(await readFile(path.join(outputPath, runDirs[0].name, "summary.json"), "utf8"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena run --dry-run prints the plan without executing", { timeout: 30_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
    const repoPath = path.join(tempDir, "repo");
    const outputPath = path.join(tempDir, "output-dry");
    const taskPath = path.join(tempDir, "task-dry.json");

    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: "cli-dry",
      title: "CLI Dry",
      prompt: "Should not run",
      judges: [
        { id: "pass", type: "command", label: "Always pass", command: "node -e \"process.exit(0)\"" }
      ]
    });

    const result = await runCli(
      ["run", "--repo", repoPath, "--task", taskPath, "--agents", "demo-fast", "--output", outputPath, "--dry-run"],
      path.resolve(".")
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Dry run/);
    assert.match(result.stdout, /Agents:/);
    // Nothing executed, so no run directory should have been written.
    let outputExists = true;
    try { await readdir(outputPath); } catch { outputExists = false; }
    assert.equal(outputExists, false, "output dir must not exist after a dry run");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena run --agent-timeout validates and is accepted", { timeout: 30_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
    const repoPath = path.join(tempDir, "repo");
    const taskPath = path.join(tempDir, "task-to.json");
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: "cli-to",
      title: "CLI TO",
      prompt: "x",
      judges: [
        { id: "pass", type: "command", label: "p", command: "node -e \"process.exit(0)\"" }
      ]
    });

    // Valid value is accepted (paired with --dry-run so no agent executes).
    const ok = await runCli(
      ["run", "--repo", repoPath, "--task", taskPath, "--agents", "demo-fast", "--agent-timeout", "60000", "--dry-run"],
      path.resolve(".")
    );
    assert.equal(ok.code, 0);

    // Invalid value is rejected with a helpful message.
    const bad = await runCli(
      ["run", "--repo", repoPath, "--task", taskPath, "--agents", "demo-fast", "--agent-timeout", "0", "--dry-run"],
      path.resolve(".")
    );
    assert.notEqual(bad.code, 0);
    assert.match((bad.stderr || "") + (bad.stdout || ""), /--agent-timeout requires a positive number/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena run exits with code 1 on failed benchmark", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output-fail");
  const taskPath = path.join(tempDir, "task-fail.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "cli-fail",
    title: "CLI Fail",
    prompt: "Run a failing benchmark",
    judges: [
      {
        id: "fail",
        type: "command",
        label: "Always fail",
        command: "node -e \"process.exit(1)\""
      }
    ]
  });

  const result = await runCli(
    ["run", "--repo", repoPath, "--task", taskPath, "--agents", "demo-fast", "--output", outputPath],
    path.resolve(".")
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /status=failed/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena --version prints the version and exits 0", { timeout: 60_000 }, async () => {
  const result = await runCli(["--version"], path.resolve("."));

  assert.equal(result.code, 0);
  assert.match(result.stdout, /\d+\.\d+\.\d+/);
});

test("agentarena -V short flag prints the version and exits 0", { timeout: 60_000 }, async () => {
  const result = await runCli(["-V"], path.resolve("."));

  assert.equal(result.code, 0);
  assert.match(result.stdout, /\d+\.\d+\.\d+/);
  assert.doesNotMatch(result.stderr, /Unknown argument/);
});

test("agentarena doctor exits with code 0 in strict mode when all adapters are ready", { timeout: 60_000 }, async () => {
  const result = await runCli(
    ["doctor", "--agents", "demo-fast,demo-budget", "--strict"],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /✓ ready/);
});

test("agentarena doctor exits with code 1 in strict mode when any adapter is not ready", { timeout: 60_000 }, async () => {
  const result = await runCli(
    ["doctor", "--agents", "demo-fast,cursor", "--strict"],
    path.resolve("."),
    {
      AGENTARENA_CURSOR_BIN: path.join("Z:", "agentarena-missing", "cursor.cmd")
    }
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /cursor/);
  assert.match(result.stdout, /✗ missing|✗ blocked|≈ unverified/);
});

test("agentarena run can update snapshots from the CLI", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output-update");
  const taskPath = path.join(tempDir, "task-update.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "cli-update-snapshot",
    title: "CLI Update Snapshot",
    prompt: "Update snapshot",
    setupCommands: [
      {
        label: "Prepare snapshot files",
        command:
          "node -e \"const fs=require('node:fs');fs.mkdirSync('fixtures',{recursive:true});fs.writeFileSync('fixtures/actual.txt','after\\n');fs.writeFileSync('fixtures/expected.txt','before\\n');\""
      }
    ],
    judges: [
      {
        id: "snapshot-check",
        type: "snapshot",
        label: "Snapshot updates",
        path: "fixtures/actual.txt",
        snapshotPath: "fixtures/expected.txt"
      }
    ]
  });

  const result = await runCli(
    [
      "run",
      "--repo",
      repoPath,
      "--task",
      taskPath,
      "--agents",
      "demo-fast",
      "--output",
      outputPath,
      "--update-snapshots"
    ],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /status=success/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena run supports --cleanup-workspaces flag", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output-cleanup");
  const taskPath = path.join(tempDir, "task-cleanup.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "cli-cleanup",
    title: "CLI Cleanup",
    prompt: "Run with cleanup",
    judges: [
      {
        id: "pass",
        type: "command",
        label: "Always pass",
        command: "node -e \"process.exit(0)\""
      }
    ]
  });

  const result = await runCli(
    [
      "run",
      "--repo",
      repoPath,
      "--task",
      taskPath,
      "--agents",
      "demo-fast",
      "--output",
      outputPath,
      "--cleanup-workspaces"
    ],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /AgentArena run complete/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena ui creates Node-oriented adhoc taskpacks without fallback echo judges", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  // Create a package.json so language detection identifies this as a Node.js project
  await writeFile(path.join(tempDir, "package.json"), JSON.stringify({ name: "test", scripts: { build: "echo ok", test: "echo ok" } }), "utf8");
  await writeFile(path.join(tempDir, "README.md"), "# Test\n", "utf8");
  const server = await startUiServer(tempDir);

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/create-adhoc-taskpack`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(server.authToken ? { "Authorization": `Bearer ${server.authToken}` } : {})
      },
      body: JSON.stringify({ prompt: "Make one useful change." })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    const yaml = await readFile(payload.path, "utf8");

    assert.match(yaml, /type: test-result/);
    assert.match(yaml, /type: lint-check/);
    assert.match(yaml, /source: community/);
    assert.match(yaml, /repoTypes:\s*\n\s*- node-js/);
    assert.match(yaml, /tags:\s*\n\s*- adhoc\n\s*- custom\n\s*- node-js/);
    assert.match(yaml, /judgeRationale: These default checks assume a node-js repository with appropriate build, test, and lint commands\./);
    assert.match(yaml, /label: Node package manifest still exists/);
    assert.match(yaml, /label: Node project still builds/);
    assert.match(yaml, /label: Node tests still pass/);
    assert.match(yaml, /label: Node lint stays clean/);
    assert.doesNotMatch(yaml, /No build script/);
    assert.doesNotMatch(yaml, /No test script/);
  } finally {
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena ui rejects adhoc taskpack path traversal deletes", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  const server = await startUiServer(tempDir);
  const escapeTarget = path.join(tempDir, ".agentarena", "outside.yaml");

  await mkdir(path.dirname(escapeTarget), { recursive: true });
  await writeFile(escapeTarget, "outside: true\n", "utf8");

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/api/adhoc-taskpacks/${encodeURIComponent("../outside")}`,
      { method: "DELETE", headers: { ...(server.authToken ? { "Authorization": `Bearer ${server.authToken}` } : {}) } }
    );

    assert.equal(response.status, 400);
    assert.equal(await readFile(escapeTarget, "utf8"), "outside: true\n");
  } finally {
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena doctor supports JSON output", { timeout: 60_000 }, async () => {
  const result = await runCli(["doctor", "--agents", "demo-fast", "--json"], path.resolve("."));

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(Array.isArray(payload), true);
  assert.equal(payload[0].agentId, "demo-fast");
  assert.equal(payload[0].status, "ready");
  assert.equal(payload[0].capability.supportTier, "supported");
});

test("agentarena doctor reports codex runtime overrides", { timeout: 60_000 }, async () => {
  const result = await runCli(
    [
      "doctor",
      "--agents",
      "codex",
      "--codex-model",
      "gpt-5.4",
      "--codex-reasoning",
      "high",
      "--json"
    ],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload[0].baseAgentId, "codex");
  assert.equal(payload[0].resolvedRuntime.effectiveModel, "gpt-5.4");
  assert.equal(payload[0].resolvedRuntime.effectiveReasoningEffort, "high");
  assert.equal(payload[0].resolvedRuntime.source, "cli");
});

test("agentarena list-adapters supports JSON output", async () => {
  const result = await runCli(["list-adapters", "--json"], path.resolve("."));

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(Array.isArray(payload), true);
  assert.equal(payload.some((adapter) => adapter.id === "demo-fast"), true);
  assert.equal(payload.find((adapter) => adapter.id === "codex").capability.supportTier, "supported");
  assert.equal(payload.find((adapter) => adapter.id === "codex").capability.configurableRuntime.model, true);
});

test("agentarena init-taskpack writes a starter YAML file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
  const outputPath = path.join(tempDir, "agentarena.taskpack.yaml");

  const result = await runCli(
    ["init-taskpack", "--template", "snapshot", "--output", outputPath],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /AgentArena task pack created/);
  const content = await readFile(outputPath, "utf8");
  assert.match(content, /schemaVersion: agentarena\.taskpack\/v1/);
  assert.match(content, /type: snapshot/);
  assert.match(content, /expectedChangedPaths:/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena init-taskpack repo-health template includes structured quality judges", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
  const outputPath = path.join(tempDir, "agentarena.taskpack.yaml");

  const result = await runCli(
    ["init-taskpack", "--template", "repo-health", "--output", outputPath],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  const content = await readFile(outputPath, "utf8");
  assert.match(content, /type: test-result/);
  assert.match(content, /type: lint-check/);
  assert.match(content, /passOnNoTests: true/);
  assert.match(content, /expectedChangedPaths:/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena run supports JSON output", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output-json");
  const taskPath = path.join(tempDir, "task-json.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "cli-json",
    title: "CLI JSON",
    prompt: "Return JSON output",
    judges: [
      {
        id: "pass",
        type: "command",
        label: "Always pass",
        command: "node -e \"process.exit(0)\""
      }
    ]
  });

  const result = await runCli(
    [
      "run",
      "--repo",
      repoPath,
      "--task",
      taskPath,
      "--agents",
      "demo-fast",
      "--output",
      outputPath,
      "--json"
    ],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  // Extract the result JSON from stdout (may be preceded by log lines)
  const jsonStart = result.stdout.lastIndexOf("\n{");
  const jsonStr = jsonStart >= 0 ? result.stdout.slice(jsonStart + 1) : result.stdout;
  const payload = JSON.parse(jsonStr);
  assert.equal(payload.task.id, "cli-json");
  assert.equal(payload.results[0].agentId, "demo-fast");
  assert.equal(payload.results[0].baseAgentId, "demo-fast");
  assert.equal(payload.results[0].variantId, "demo-fast");
  assert.equal(payload.results[0].displayLabel, "Demo Fast");
  assert.equal(payload.results[0].judges.passed, 1);
  assert.match(payload.report.jsonPath, /summary\.json$/);
  assert.match(payload.report.badgePath, /badge\.json$/);
  assert.match(payload.report.prCommentPath, /pr-comment\.md$/);

  const summary = JSON.parse(await readFile(payload.report.jsonPath, "utf8"));
  assert.equal(summary.scoreMode, "practical");
  assert.equal(summary.scoreWeights.status, 0.24);
  assert.equal(typeof summary.results[0].compositeScore, "number");
  assert.equal(Array.isArray(summary.results[0].scoreReasons), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena run writes a trend.md when >=2 prior comparable runs exist", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
    const repoPath = path.join(tempDir, "repo");
    const outputPath = path.join(tempDir, "output-trend");
    const taskPath = path.join(tempDir, "task-trend.json");

    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");

    const taskId = "cli-trend";
    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: taskId,
      title: "CLI Trend",
      prompt: "Produce a trend report",
      judges: [
        {
          id: "pass",
          type: "command",
          label: "Always pass",
          command: "node -e \"process.exit(0)\""
        }
      ]
    });

    // Seed two prior comparable runs (same task id) as top-level *.json files in
    // the output root, which is exactly where the variance scan looks. These two
    // give comparableRuns.length === 2 (> 1), triggering the trend report.
    await mkdir(outputPath, { recursive: true });
    const seedRun = (runId, createdAt, score) => ({
      runId,
      createdAt,
      repoPath,
      outputPath: path.join(outputPath, runId),
      scoreMode: "practical",
      task: { id: taskId, title: "CLI Trend" },
      preflights: [],
      results: [
        {
          agentId: "demo-fast",
          baseAgentId: "demo-fast",
          variantId: "demo-fast",
          displayLabel: "Demo Fast",
          status: "success",
          compositeScore: score,
          durationMs: 1000,
          tokenUsage: 100,
          estimatedCostUsd: 0.08,
          costKnown: true,
          changedFiles: [],
          judgeResults: []
        }
      ]
    });
    await writeJson(path.join(outputPath, "prev-1.json"), seedRun("prev-1", "2026-01-01T00:00:00Z", 70));
    await writeJson(path.join(outputPath, "prev-2.json"), seedRun("prev-2", "2026-01-02T00:00:00Z", 75));

    const result = await runCli(
      ["run", "--repo", repoPath, "--task", taskPath, "--agents", "demo-fast", "--output", outputPath],
      path.resolve(".")
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Trend report:/);

    // Find the freshly created run subdir (the one that is not a seed JSON file).
    const entries = await readdir(outputPath, { withFileTypes: true });
    const runDir = entries.find((e) => e.isDirectory());
    assert.ok(runDir, "Expected a run output subdirectory");
    const trendContent = await readFile(path.join(outputPath, runDir.name, "trend.md"), "utf8");
    assert.match(trendContent, /Multi-Run Agent Comparison/);
    assert.match(trendContent, /Demo Fast/);
    // 2 seeded prior runs + 1 current run = 3 total runs aggregated.
    assert.match(trendContent, /\*\*Total Runs\*\*: 3/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena init-ci writes a benchmark workflow", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
  const workflowPath = path.join(tempDir, ".github", "workflows", "agentarena-benchmark.yml");

  const result = await runCli(
    [
      "init-ci",
      "--task",
      "agentarena.taskpack.yaml",
      "--agents",
      "demo-fast,codex",
      "--output",
      workflowPath
    ],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  const content = await readFile(workflowPath, "utf8");
  assert.match(content, /name: AgentArena Benchmark/);
  assert.match(content, /run --repo \. --task agentarena\.taskpack\.yaml --agents demo-fast,codex/);
  assert.match(content, /pr-comment\.md/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena init-ci supports nightly templates and custom output directories", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cli-"));
  try {
  const workflowPath = path.join(tempDir, ".github", "workflows", "agentarena-nightly.yml");

  const result = await runCli(
    [
      "init-ci",
      "--task",
      "examples/taskpacks/official/repo-health.yaml",
      "--agents",
      "demo-fast",
      "--output",
      workflowPath,
      "--ci-template",
      "nightly",
      "--ci-output-dir",
      ".agentarena/nightly"
    ],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  const content = await readFile(workflowPath, "utf8");
  assert.match(content, /name: AgentArena Nightly Benchmark/);
  assert.match(content, /schedule:/);
  assert.match(content, /doctor --agents demo-fast --probe-auth --strict --json > \.agentarena\/nightly\/doctor\.json/);
  assert.doesNotMatch(content, /Comment benchmark summary on PR/);
  assert.match(content, /cat \.agentarena\/nightly\/summary\.md >> "\$GITHUB_STEP_SUMMARY"/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena ui exposes metadata and adapter APIs", { timeout: 60_000 }, async () => {
  const server = await startUiServer(path.resolve("."));

  try {
    const infoResponse = await fetch(`http://127.0.0.1:${server.port}/api/ui-info`);
    const adaptersResponse = await fetch(`http://127.0.0.1:${server.port}/api/adapters`);
    const taskPacksResponse = await fetch(`http://127.0.0.1:${server.port}/api/taskpacks`);
    const runStatusResponse = await fetch(`http://127.0.0.1:${server.port}/api/run-status`);

    assert.equal(infoResponse.status, 200);
    assert.equal(adaptersResponse.status, 200);
    assert.equal(taskPacksResponse.status, 200);
    assert.equal(runStatusResponse.status, 200);

    const info = await infoResponse.json();
    const adapters = await adaptersResponse.json();
    const taskPacks = await taskPacksResponse.json();
    const runStatus = await runStatusResponse.json();

    assert.equal(info.mode, "local-service");
    assert.equal(typeof info.codexDefaults, "object");
    assert.ok("source" in info.codexDefaults);
    assert.equal(Array.isArray(adapters), true);
    assert.equal(adapters.some((adapter) => adapter.id === "demo-fast"), true);
    assert.equal(adapters.find((adapter) => adapter.id === "codex").capability.configurableRuntime.reasoningEffort, true);
    assert.equal(Array.isArray(taskPacks), true);
    assert.equal(typeof taskPacks[0].objective, "string");
    assert.equal(runStatus.state, "idle");
    assert.equal(runStatus.phase, "idle");
  } finally {
    await server.stop();
  }
});

test("agentarena ui exposes Claude provider profile APIs", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-ui-profiles-"));
  const registryPath = path.join(tempDir, "claude-provider-profiles.json");
  const server = await startUiServer(
    path.resolve("."),
    [],
    {
      AGENTARENA_CLAUDE_PROFILE_ROOT: tempDir,
      AGENTARENA_CLAUDE_PROFILES_FILE: registryPath,
      AGENTARENA_CLAUDE_SECRET_PREFIX: `AgentArena/test/${Date.now()}/`
    }
  );

  try {
    const profilesResponse = await fetch(`http://127.0.0.1:${server.port}/api/provider-profiles`, {
      headers: {
        ...(server.authToken ? { "Authorization": `Bearer ${server.authToken}` } : {})
      }
    });
    assert.equal(profilesResponse.status, 200);
    const initialProfiles = await profilesResponse.json();
    assert.equal(Array.isArray(initialProfiles), true);
    assert.equal(initialProfiles.some((profile) => profile.id === "claude-official"), true);

    const createResponse = await fetch(`http://127.0.0.1:${server.port}/api/provider-profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(server.authToken ? { "Authorization": `Bearer ${server.authToken}` } : {})
      },
      body: JSON.stringify({
        name: "NewAPI",
        kind: "anthropic-compatible",
        baseUrl: "https://api.example.com",
        apiFormat: "anthropic-messages",
        primaryModel: "gpt-5.4",
        _confirmBaseUrlRisk: true
      })
    });
    assert.equal(createResponse.status, 200);
    const createdPayload = await createResponse.json();
    assert.equal(createdPayload.profile.name, "NewAPI");
    assert.equal(createdPayload.profile.kind, "anthropic-compatible");

    const uiInfoResponse = await fetch(`http://127.0.0.1:${server.port}/api/ui-info`);
    assert.equal(uiInfoResponse.status, 200);
    const uiInfo = await uiInfoResponse.json();
    assert.equal(Array.isArray(uiInfo.claudeProviderProfiles), true);
    assert.equal(uiInfo.claudeProviderProfiles.some((profile) => profile.id === createdPayload.profile.id), true);

    const updateResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/provider-profiles/${encodeURIComponent(createdPayload.profile.id)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(server.authToken ? { "Authorization": `Bearer ${server.authToken}` } : {})
        },
        body: JSON.stringify({
          name: "NewAPI Updated",
          kind: "openai-proxy",
          baseUrl: "https://proxy.example.com/v1",
          apiFormat: "openai-chat-via-proxy",
          primaryModel: "gpt-5.4",
          _confirmBaseUrlRisk: true
        })
      }
    );
    assert.equal(updateResponse.status, 200);
    const updatedPayload = await updateResponse.json();
    assert.equal(updatedPayload.profile.name, "NewAPI Updated");
    assert.equal(updatedPayload.profile.kind, "openai-proxy");

    const deleteResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/provider-profiles/${encodeURIComponent(createdPayload.profile.id)}`,
      { method: "DELETE", headers: { ...(server.authToken ? { "Authorization": `Bearer ${server.authToken}` } : {}) } }
    );
    assert.equal(deleteResponse.status, 200);
    const deletedPayload = await deleteResponse.json();
    assert.equal(deletedPayload.profiles.some((profile) => profile.id === createdPayload.profile.id), false);
  } finally {
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena ui rejects oversized request bodies with 413", { timeout: 60_000 }, async () => {
  const server = await startUiServer(path.resolve("."));

  try {
    const oversizedBody = JSON.stringify({
      name: "x".repeat(1_100_000),
      kind: "anthropic-compatible",
      apiFormat: "anthropic-messages"
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/api/provider-profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(server.authToken ? { "Authorization": `Bearer ${server.authToken}` } : {})
      },
      body: oversizedBody
    });

    assert.equal(response.status, 413);
    const payload = await response.json();
    assert.equal(payload.error, "Request body too large.");
  } finally {
    await server.stop();
  }
});

test("agentarena ui cancels an active benchmark via API", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-ui-cancel-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-cancel.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# UI Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "ui-cancel",
    title: "UI Cancel",
    prompt: "Cancel a UI run.",
    teardownCommands: [
      {
        id: "cleanup",
        label: "cleanup marker",
        command: "node -e \"require('node:fs').writeFileSync('teardown-marker.txt','done')\""
      }
    ],
    judges: [
      {
        id: "pass",
        type: "command",
        label: "Always pass",
        command: "node -e \"process.exit(0)\""
      }
    ]
  });

  const server = await startUiServer(tempDir);

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(server.authToken ? { "Authorization": `Bearer ${server.authToken}` } : {})
      },
      body: JSON.stringify({
        repoPath,
        taskPath,
        outputPath,
        agents: [
          {
            baseAgentId: "demo-thorough",
            displayLabel: "Demo Thorough"
          }
        ],
        probeAuth: false,
        maxConcurrency: 1,
        cleanupWorkspaces: false
      })
    });

    assert.equal(response.status, 202);

    let runningStatus;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const statusResponse = await fetch(`http://127.0.0.1:${server.port}/api/run-status`);
      runningStatus = await statusResponse.json();
      if (runningStatus.state === "running") {
        break;
      }
    }

    assert.equal(runningStatus.state, "running");

    const cancelResponse = await fetch(`http://127.0.0.1:${server.port}/api/run/cancel`, {
      method: "POST",
      headers: {
        ...(server.authToken ? { "Authorization": `Bearer ${server.authToken}` } : {})
      }
    });
    assert.equal(cancelResponse.status, 200);
    const cancelPayload = await cancelResponse.json();
    assert.equal(cancelPayload.cancelled, true);

    let finalStatus;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const statusResponse = await fetch(`http://127.0.0.1:${server.port}/api/run-status`);
      finalStatus = await statusResponse.json();
      if (finalStatus.state === "cancelled") {
        break;
      }
    }

    assert.equal(finalStatus.state, "cancelled");
    assert.equal(finalStatus.phase, "idle");
    assert.ok(finalStatus.logs.some((entry) => /Cancellation requested by user/.test(entry.message)));
    assert.ok(finalStatus.logs.some((entry) => /Run cancelled/.test(entry.message)));
  } finally {
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena ui exposes run progress while a benchmark is active", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-ui-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-progress.json");
  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# UI Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "ui-progress",
    title: "UI Progress",
    prompt: "Run from UI with visible progress",
    judges: [
      {
        id: "slow-pass",
        type: "command",
        label: "Pass after a short delay",
        command: "node -e \"setTimeout(() => process.exit(0), 2000)\""
      }
    ]
  });

  const server = await startUiServer(tempDir);

  try {
    const runPromise = fetch(`http://127.0.0.1:${server.port}/api/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(server.authToken ? { "Authorization": `Bearer ${server.authToken}` } : {})
      },
      body: JSON.stringify({
        repoPath,
        taskPath,
        outputPath,
        agents: [
          {
            baseAgentId: "demo-fast",
            displayLabel: "Demo Fast"
          }
        ],
        probeAuth: false
      })
    });

    await new Promise((resolve) => setTimeout(resolve, 250));

    const statusResponse = await fetch(`http://127.0.0.1:${server.port}/api/run-status`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.state, "running");
    assert.notEqual(status.phase, "idle");
    assert.equal(status.repoPath, repoPath);
    assert.equal(status.taskPath, taskPath);
    assert.equal(Array.isArray(status.logs), true);
    assert.ok(status.logs.length >= 1);
    assert.match(status.logs[0].message, /Starting benchmark|Running preflight|Created run/);

    const response = await runPromise;
    assert.equal(response.status, 202);

    let finalStatus;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const pollResponse = await fetch(`http://127.0.0.1:${server.port}/api/run-status`);
      finalStatus = await pollResponse.json();
      if (finalStatus.state === "done" || finalStatus.state === "error") {
        break;
      }
    }
    assert.equal(finalStatus.state, "done");
    assert.ok(finalStatus.result);
  } finally {
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentarena ui can execute a benchmark via API", { timeout: 60_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-ui-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# UI Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "ui-run",
    title: "UI Run",
    prompt: "Run from UI",
    judges: [
      {
        id: "pass",
        type: "command",
        label: "Always pass",
        command: "node -e \"process.exit(0)\""
      }
    ]
  });

  const server = await startUiServer(tempDir);

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(server.authToken ? { "Authorization": `Bearer ${server.authToken}` } : {})
      },
      body: JSON.stringify({
        repoPath,
        taskPath,
        outputPath,
        agents: [
          {
            baseAgentId: "demo-fast",
            displayLabel: "Demo Fast"
          }
        ],
        probeAuth: false
      })
    });

    assert.equal(response.status, 202);

    let finalStatus;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const pollResponse = await fetch(`http://127.0.0.1:${server.port}/api/run-status`);
      finalStatus = await pollResponse.json();
      if (finalStatus.state === "done" || finalStatus.state === "error") {
        break;
      }
    }
    assert.equal(finalStatus.state, "done");
    const payload = finalStatus.result;
    assert.equal(payload.run.task.title, "UI Run");
    assert.equal(payload.run.results[0].agentId, "demo-fast");
    assert.equal(payload.run.results[0].displayLabel, "Demo Fast");
    assert.equal(typeof payload.markdown, "string");
    assert.match(payload.report.htmlPath, /report\.html$/);
  } finally {
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});
