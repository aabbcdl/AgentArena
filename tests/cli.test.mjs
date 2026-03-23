import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const child = spawn(process.execPath, [cliPath, "ui", "--host", "127.0.0.1", "--port", String(port), "--no-open", ...extraArgs], {
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
      if (stdout.includes("RepoArena UI server running")) {
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
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  };
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

test("repoarena run supports --cleanup-workspaces flag", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-cli-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output-cleanup");
  const taskPath = path.join(tempDir, "task-cleanup.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
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
  assert.match(result.stdout, /RepoArena run complete/);

  await rm(tempDir, { recursive: true, force: true });
});

test("repoarena ui creates stricter adhoc taskpacks without fallback echo judges", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-cli-"));
  const server = await startUiServer(tempDir);

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/create-adhoc-taskpack`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ prompt: "Make one useful change." })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    const yaml = await readFile(payload.path, "utf8");

    assert.match(yaml, /type: test-result/);
    assert.match(yaml, /type: lint-check/);
    assert.match(yaml, /source: community/);
    assert.doesNotMatch(yaml, /No build script/);
    assert.doesNotMatch(yaml, /No test script/);
  } finally {
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("repoarena doctor supports JSON output", async () => {
  const result = await runCli(["doctor", "--agents", "demo-fast", "--json"], path.resolve("."));

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(Array.isArray(payload), true);
  assert.equal(payload[0].agentId, "demo-fast");
  assert.equal(payload[0].status, "ready");
  assert.equal(payload[0].capability.supportTier, "supported");
});

test("repoarena doctor reports codex runtime overrides", async () => {
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

test("repoarena list-adapters supports JSON output", async () => {
  const result = await runCli(["list-adapters", "--json"], path.resolve("."));

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(Array.isArray(payload), true);
  assert.equal(payload.some((adapter) => adapter.id === "demo-fast"), true);
  assert.equal(payload.find((adapter) => adapter.id === "codex").capability.supportTier, "supported");
  assert.equal(payload.find((adapter) => adapter.id === "codex").capability.configurableRuntime.model, true);
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
  assert.match(content, /expectedChangedPaths:/);

  await rm(tempDir, { recursive: true, force: true });
});

test("repoarena init-taskpack repo-health template includes structured quality judges", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-cli-"));
  const outputPath = path.join(tempDir, "repoarena.taskpack.yaml");

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
  assert.equal(payload.results[0].baseAgentId, "demo-fast");
  assert.equal(payload.results[0].variantId, "demo-fast");
  assert.equal(payload.results[0].displayLabel, "Demo Fast");
  assert.equal(payload.results[0].judges.passed, 1);
  assert.match(payload.report.jsonPath, /summary\.json$/);
  assert.match(payload.report.badgePath, /badge\.json$/);
  assert.match(payload.report.prCommentPath, /pr-comment\.md$/);

  const summary = JSON.parse(await readFile(payload.report.jsonPath, "utf8"));
  assert.equal(summary.scoreMode, "balanced");
  assert.equal(summary.scoreWeights.status, 0.3);
  assert.equal(typeof summary.results[0].compositeScore, "number");
  assert.equal(Array.isArray(summary.results[0].scoreReasons), true);

  await rm(tempDir, { recursive: true, force: true });
});

test("repoarena init-ci writes a benchmark workflow", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-cli-"));
  const workflowPath = path.join(tempDir, ".github", "workflows", "repoarena-benchmark.yml");

  const result = await runCli(
    [
      "init-ci",
      "--task",
      "repoarena.taskpack.yaml",
      "--agents",
      "demo-fast,codex",
      "--output",
      workflowPath
    ],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  const content = await readFile(workflowPath, "utf8");
  assert.match(content, /name: RepoArena Benchmark/);
  assert.match(content, /run --repo \. --task repoarena\.taskpack\.yaml --agents demo-fast,codex/);
  assert.match(content, /pr-comment\.md/);

  await rm(tempDir, { recursive: true, force: true });
});

test("repoarena init-ci supports nightly templates and custom output directories", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-cli-"));
  const workflowPath = path.join(tempDir, ".github", "workflows", "repoarena-nightly.yml");

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
      ".repoarena/nightly"
    ],
    path.resolve(".")
  );

  assert.equal(result.code, 0);
  const content = await readFile(workflowPath, "utf8");
  assert.match(content, /name: RepoArena Nightly Benchmark/);
  assert.match(content, /schedule:/);
  assert.match(content, /doctor --agents demo-fast --probe-auth --strict --json > \.repoarena\/nightly\/doctor\.json/);
  assert.doesNotMatch(content, /Comment benchmark summary on PR/);
  assert.match(content, /cat \.repoarena\/nightly\/summary\.md >> "\$GITHUB_STEP_SUMMARY"/);

  await rm(tempDir, { recursive: true, force: true });
});

test("repoarena ui exposes metadata and adapter APIs", async () => {
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

test("repoarena ui exposes Claude provider profile APIs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-ui-profiles-"));
  const registryPath = path.join(tempDir, "claude-provider-profiles.json");
  const server = await startUiServer(
    path.resolve("."),
    [],
    {
      REPOARENA_CLAUDE_PROFILE_ROOT: tempDir,
      REPOARENA_CLAUDE_PROFILES_FILE: registryPath,
      REPOARENA_CLAUDE_SECRET_PREFIX: `RepoArena/test/${Date.now()}/`
    }
  );

  try {
    const profilesResponse = await fetch(`http://127.0.0.1:${server.port}/api/provider-profiles`);
    assert.equal(profilesResponse.status, 200);
    const initialProfiles = await profilesResponse.json();
    assert.equal(Array.isArray(initialProfiles), true);
    assert.equal(initialProfiles.some((profile) => profile.id === "claude-official"), true);

    const createResponse = await fetch(`http://127.0.0.1:${server.port}/api/provider-profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "NewAPI",
        kind: "anthropic-compatible",
        baseUrl: "https://api.example.com",
        apiFormat: "anthropic-messages",
        primaryModel: "gpt-5.4"
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
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: "NewAPI Updated",
          kind: "openai-proxy",
          baseUrl: "https://proxy.example.com/v1",
          apiFormat: "openai-chat-via-proxy",
          primaryModel: "gpt-5.4"
        })
      }
    );
    assert.equal(updateResponse.status, 200);
    const updatedPayload = await updateResponse.json();
    assert.equal(updatedPayload.profile.name, "NewAPI Updated");
    assert.equal(updatedPayload.profile.kind, "openai-proxy");

    const deleteResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/provider-profiles/${encodeURIComponent(createdPayload.profile.id)}`,
      { method: "DELETE" }
    );
    assert.equal(deleteResponse.status, 200);
    const deletedPayload = await deleteResponse.json();
    assert.equal(deletedPayload.profiles.some((profile) => profile.id === createdPayload.profile.id), false);
  } finally {
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("repoarena ui rejects oversized request bodies with 413", async () => {
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
        "Content-Type": "application/json"
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

test("repoarena ui cancels an active benchmark via API", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-ui-cancel-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-cancel.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# UI Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
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

  const server = await startUiServer(path.resolve("."));

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
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
      method: "POST"
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

test("repoarena ui exposes run progress while a benchmark is active", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-ui-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-progress.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# UI Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
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

  const server = await startUiServer(path.resolve("."));

  try {
    const runPromise = fetch(`http://127.0.0.1:${server.port}/api/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
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

test("repoarena ui can execute a benchmark via API", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-ui-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# UI Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
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

  const server = await startUiServer(path.resolve("."));

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
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
