import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function runCli(args, cwd, envOverrides = {}) {
  const cliPath = path.resolve("packages/cli/dist/index.js");

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

test("repoarena run exits with code 0 on successful benchmark", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-cli-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output-success");
  const taskPath = path.join(tempDir, "task-success.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
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
  assert.match(result.stdout, /RepoArena run complete/);

  await rm(tempDir, { recursive: true, force: true });
});

test("repoarena run exits with code 1 on failed benchmark", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-cli-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output-fail");
  const taskPath = path.join(tempDir, "task-fail.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
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

  await rm(tempDir, { recursive: true, force: true });
});

test("repoarena doctor exits with code 0 in strict mode when all adapters are ready", async () => {
  const result = await runCli(
    ["doctor", "--agents", "demo-fast,demo-budget", "--strict"],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /status=ready/);
});

test("repoarena doctor exits with code 1 in strict mode when any adapter is not ready", async () => {
  const result = await runCli(
    ["doctor", "--agents", "demo-fast,cursor", "--strict"],
    path.resolve("."),
    {
      REPOARENA_CURSOR_BIN: path.join("Z:", "repoarena-missing", "cursor.cmd")
    }
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /- cursor/);
  assert.match(result.stdout, /status=missing|status=blocked|status=unverified/);
});

test("repoarena run can update snapshots from the CLI", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-cli-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output-update");
  const taskPath = path.join(tempDir, "task-update.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
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

  await rm(tempDir, { recursive: true, force: true });
});

test("repoarena doctor supports JSON output", async () => {
  const result = await runCli(["doctor", "--agents", "demo-fast", "--json"], path.resolve("."));

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(Array.isArray(payload), true);
  assert.equal(payload[0].agentId, "demo-fast");
  assert.equal(payload[0].status, "ready");
});

test("repoarena list-adapters supports JSON output", async () => {
  const result = await runCli(["list-adapters", "--json"], path.resolve("."));

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(Array.isArray(payload), true);
  assert.equal(payload.some((adapter) => adapter.id === "demo-fast"), true);
});

test("repoarena init-taskpack writes a starter YAML file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-cli-"));
  const outputPath = path.join(tempDir, "repoarena.taskpack.yaml");

  const result = await runCli(
    ["init-taskpack", "--template", "snapshot", "--output", outputPath],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /RepoArena task pack created/);
  const content = await readFile(outputPath, "utf8");
  assert.match(content, /schemaVersion: repoarena\.taskpack\/v1/);
  assert.match(content, /type: snapshot/);

  await rm(tempDir, { recursive: true, force: true });
});

test("repoarena run supports JSON output", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-cli-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output-json");
  const taskPath = path.join(tempDir, "task-json.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
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
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.task.id, "cli-json");
  assert.equal(payload.results[0].agentId, "demo-fast");
  assert.equal(payload.results[0].judges.passed, 1);
  assert.match(payload.report.jsonPath, /summary\.json$/);

  await rm(tempDir, { recursive: true, force: true });
});
