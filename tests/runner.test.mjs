import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runBenchmark } from "../packages/runner/dist/index.js";

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("runBenchmark passes only allowlisted env vars to setup, judges, teardown, and agents", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });

  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  process.env.REPOARENA_ALLOWED_TEST = "visible";
  process.env.REPOARENA_BLOCKED_TEST = "hidden";

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "env-demo",
    title: "Env Demo",
    prompt: "Create a benchmark note.",
    envAllowList: ["REPOARENA_ALLOWED_TEST"],
    setupCommands: [
      {
        label: "Write allowed env marker",
        command:
          "node -e \"const fs=require('node:fs');fs.writeFileSync('env-setup.txt',(process.env.REPOARENA_ALLOWED_TEST||'')+'|'+(process.env.REPOARENA_BLOCKED_TEST||''))\""
      }
    ],
    judges: [
      {
        id: "allowed-env-only",
        type: "command",
        label: "Only allowlisted env is present",
        command:
          "node -e \"const fs=require('node:fs');const value=fs.readFileSync('env-setup.txt','utf8');process.exit(value==='visible|' ? 0 : 1)\""
      }
    ],
    teardownCommands: [
      {
        label: "Remove env marker",
        command: "node -e \"require('node:fs').rmSync('env-setup.txt',{force:true})\""
      }
    ]
  });

  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath
  });

  assert.equal(benchmark.results[0].status, "success");
  assert.equal(benchmark.results[0].setupResults[0].success, true);
  assert.equal(benchmark.results[0].judgeResults[0].success, true);
  assert.equal(benchmark.results[0].teardownResults[0].success, true);

  const trace = await readFile(path.join(outputPath, "agents", "demo-fast", "trace.jsonl"), "utf8");
  assert.match(trace, /setup\.finish/);
  assert.match(trace, /teardown\.finish/);

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark supports step-level env allowlists and inline overrides", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });

  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  process.env.REPOARENA_STEP_ONLY = "step-visible";
  process.env.REPOARENA_SHOULD_STAY_BLOCKED = "blocked";

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "step-env-demo",
    title: "Step Env Demo",
    prompt: "Create a benchmark note.",
    envAllowList: [],
    setupCommands: [
      {
        label: "Write step env marker",
        envAllowList: ["REPOARENA_STEP_ONLY"],
        env: {
          REPOARENA_INLINE_SETUP: "inline-setup"
        },
        command:
          "node -e \"const fs=require('node:fs');fs.writeFileSync('step-env-setup.txt',[(process.env.REPOARENA_STEP_ONLY||''),(process.env.REPOARENA_INLINE_SETUP||''),(process.env.REPOARENA_SHOULD_STAY_BLOCKED||'')].join('|'))\""
      }
    ],
    judges: [
      {
        id: "step-env-judge",
        type: "command",
        label: "Step env is available only where configured",
        envAllowList: ["REPOARENA_STEP_ONLY"],
        env: {
          REPOARENA_INLINE_JUDGE: "inline-judge"
        },
        command:
          "node -e \"const fs=require('node:fs');const setup=fs.readFileSync('step-env-setup.txt','utf8');const judge=[(process.env.REPOARENA_STEP_ONLY||''),(process.env.REPOARENA_INLINE_JUDGE||''),(process.env.REPOARENA_SHOULD_STAY_BLOCKED||'')].join('|');process.exit(setup==='step-visible|inline-setup|'&&judge==='step-visible|inline-judge|' ? 0 : 1)\""
      }
    ],
    teardownCommands: [
      {
        label: "Cleanup step env marker",
        env: {
          REPOARENA_INLINE_TEARDOWN: "inline-teardown"
        },
        command:
          "node -e \"const fs=require('node:fs');const value=(process.env.REPOARENA_INLINE_TEARDOWN||'')+'|'+(process.env.REPOARENA_STEP_ONLY||'');if(value!=='inline-teardown|'){process.exit(1)}fs.rmSync('step-env-setup.txt',{force:true})\""
      }
    ]
  });

  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath
  });

  assert.equal(benchmark.results[0].status, "success");
  assert.equal(benchmark.results[0].setupResults[0].success, true);
  assert.equal(benchmark.results[0].judgeResults[0].success, true);
  assert.equal(benchmark.results[0].teardownResults[0].success, true);

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark executes setup and teardown commands in declaration order", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });

  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "ordered-hooks",
    title: "Ordered Hooks",
    prompt: "Run ordered setup and teardown hooks.",
    setupCommands: [
      {
        label: "Create initial marker",
        command:
          "node -e \"setTimeout(()=>{require('node:fs').writeFileSync('order.txt','first\\n')},150)\""
      },
      {
        label: "Append second marker",
        command:
          "node -e \"const fs=require('node:fs');if(!fs.existsSync('order.txt'))process.exit(1);fs.appendFileSync('order.txt','second\\n')\""
      }
    ],
    judges: [
      {
        id: "ordered-judge",
        type: "command",
        label: "Setup commands ran in order",
        command:
          "node -e \"const fs=require('node:fs');process.exit(fs.readFileSync('order.txt','utf8')==='first\\nsecond\\n' ? 0 : 1)\""
      }
    ],
    teardownCommands: [
      {
        label: "Create teardown marker",
        command:
          "node -e \"setTimeout(()=>{require('node:fs').writeFileSync('cleanup.txt','cleanup-1\\n')},150)\""
      },
      {
        label: "Validate teardown order and cleanup",
        command:
          "node -e \"const fs=require('node:fs');if(!fs.existsSync('cleanup.txt'))process.exit(1);fs.appendFileSync('cleanup.txt','cleanup-2\\n');const value=fs.readFileSync('cleanup.txt','utf8');if(value!=='cleanup-1\\ncleanup-2\\n')process.exit(1);fs.rmSync('cleanup.txt',{force:true});fs.rmSync('order.txt',{force:true})\""
      }
    ]
  });

  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath
  });

  assert.equal(benchmark.results[0].status, "success");
  assert.equal(benchmark.results[0].setupResults[0].success, true);
  assert.equal(benchmark.results[0].setupResults[1].success, true);
  assert.equal(benchmark.results[0].judgeResults[0].success, true);
  assert.equal(benchmark.results[0].teardownResults[0].success, true);
  assert.equal(benchmark.results[0].teardownResults[1].success, true);

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark supports built-in file, glob, count, and json judges", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });

  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "builtin-judges",
    title: "Built-in Judges",
    prompt: "Run file and JSON assertions.",
    setupCommands: [
      {
        label: "Prepare fixture files",
        command:
          "node -e \"const fs=require('node:fs');fs.mkdirSync('fixtures/nested',{recursive:true});fs.writeFileSync('fixtures/note.txt','hello repoarena');fs.writeFileSync('fixtures/nested/extra.txt','extra');fs.writeFileSync('fixtures/config.json',JSON.stringify({enabled:true,name:'repoarena'}));\""
      }
    ],
    judges: [
      {
        id: "note-exists",
        type: "file-exists",
        label: "Fixture note exists",
        path: "fixtures/note.txt"
      },
      {
        id: "note-contains",
        type: "file-contains",
        label: "Fixture note mentions repoarena",
        path: "fixtures/note.txt",
        pattern: "repoarena"
      },
      {
        id: "config-enabled",
        type: "json-value",
        label: "Fixture config is enabled",
        path: "fixtures/config.json",
        pointer: "/enabled",
        expected: true
      },
      {
        id: "fixture-glob",
        type: "glob",
        label: "Fixture txt files exist",
        pattern: "fixtures/**/*.txt",
        minMatches: 2
      },
      {
        id: "fixture-count",
        type: "file-count",
        label: "Fixture txt file count matches",
        pattern: "fixtures/**/*.txt",
        equals: 2
      }
    ],
    teardownCommands: [
      {
        label: "Cleanup fixtures",
        command: "node -e \"require('node:fs').rmSync('fixtures',{recursive:true,force:true})\""
      }
    ]
  });

  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath
  });

  assert.equal(benchmark.results[0].status, "success");
  assert.deepEqual(
    benchmark.results[0].judgeResults.map((judge) => judge.type),
    ["file-exists", "file-contains", "json-value", "glob", "file-count"]
  );
  assert.equal(benchmark.results[0].judgeResults.every((judge) => judge.success), true);

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark supports snapshot and json-schema judges", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });

  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "advanced-judges",
    title: "Advanced Judges",
    prompt: "Run snapshot and schema assertions.",
    setupCommands: [
      {
        label: "Prepare snapshot fixtures",
        command:
          "node -e \"const fs=require('node:fs');fs.mkdirSync('fixtures',{recursive:true});fs.writeFileSync('fixtures/actual.txt','hello snapshot\\n');fs.writeFileSync('fixtures/expected.txt','hello snapshot\\n');fs.writeFileSync('fixtures/config.json',JSON.stringify({enabled:true,name:'repoarena'}));fs.writeFileSync('fixtures/schema.json',JSON.stringify({type:'object',required:['enabled','name'],properties:{enabled:{type:'boolean'},name:{type:'string'}}}));\""
      }
    ],
    judges: [
      {
        id: "snapshot-check",
        type: "snapshot",
        label: "Snapshot matches",
        path: "fixtures/actual.txt",
        snapshotPath: "fixtures/expected.txt"
      },
      {
        id: "schema-check",
        type: "json-schema",
        label: "Schema validates config",
        path: "fixtures/config.json",
        schemaPath: "fixtures/schema.json"
      }
    ],
    teardownCommands: [
      {
        label: "Cleanup advanced fixtures",
        command: "node -e \"require('node:fs').rmSync('fixtures',{recursive:true,force:true})\""
      }
    ]
  });

  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath
  });

  assert.equal(benchmark.results[0].status, "success");
  assert.deepEqual(
    benchmark.results[0].judgeResults.map((judge) => judge.type),
    ["snapshot", "json-schema"]
  );
  assert.equal(benchmark.results[0].judgeResults.every((judge) => judge.success), true);

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark parses structured test/lint judges and computes diff precision", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "structured-quality-signals",
    title: "Structured Quality Signals",
    prompt: "Produce a demo change and emit structured judge reports.",
    expectedChangedPaths: ["**/*"],
    judges: [
      {
        id: "tests-json",
        type: "test-result",
        label: "Structured test results",
        command:
          "node -e \"const fs=require('node:fs');fs.mkdirSync('.repoarena',{recursive:true});fs.writeFileSync('.repoarena/test-results.json', JSON.stringify({success:true,numTotalTests:3,numPassedTests:2,numFailedTests:0,numPendingTests:1,numTodoTests:0}));\"",
        reportFile: ".repoarena/test-results.json"
      },
      {
        id: "lint-json",
        type: "lint-check",
        label: "Structured lint results",
        command:
          "node -e \"const fs=require('node:fs');fs.mkdirSync('.repoarena',{recursive:true});fs.writeFileSync('.repoarena/lint-results.json', JSON.stringify([{filePath:'README.md',errorCount:0,warningCount:1,messages:[{severity:1,message:'warn'}]}]));\"",
        reportFile: ".repoarena/lint-results.json",
        maxWarnings: 1
      }
    ]
  });

  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath
  });

  assert.equal(benchmark.results[0].status, "success");
  assert.equal(benchmark.results[0].judgeResults[0].type, "test-result");
  assert.equal(benchmark.results[0].judgeResults[0].passedCount, 2);
  assert.equal(benchmark.results[0].judgeResults[0].totalCount, 3);
  assert.equal(benchmark.results[0].judgeResults[1].type, "lint-check");
  assert.equal(benchmark.results[0].judgeResults[1].errorCount, 0);
  assert.equal(benchmark.results[0].judgeResults[1].warningCount, 1);
  assert.equal(benchmark.results[0].diffPrecision?.score, 1);

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark can update snapshot files when enabled", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "update-snapshot",
    title: "Update Snapshot",
    prompt: "Refresh snapshot fixture.",
    setupCommands: [
      {
        label: "Prepare mismatched snapshot",
        command:
          "node -e \"const fs=require('node:fs');fs.mkdirSync('fixtures',{recursive:true});fs.writeFileSync('fixtures/actual.txt','new value\\n');fs.writeFileSync('fixtures/expected.txt','old value\\n');\""
      }
    ],
    judges: [
      {
        id: "snapshot-check",
        type: "snapshot",
        label: "Snapshot can be updated",
        path: "fixtures/actual.txt",
        snapshotPath: "fixtures/expected.txt"
      }
    ]
  });

  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath,
    updateSnapshots: true
  });

  assert.equal(benchmark.results[0].status, "success");
  assert.match(benchmark.results[0].judgeResults[0].stdout, /Updated snapshot/);
  const workspaceRoot = benchmark.results[0].workspacePath;
  const updatedSnapshot = await readFile(path.join(workspaceRoot, "fixtures", "expected.txt"), "utf8");
  assert.equal(updatedSnapshot, "new value\n");

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark cleans up workspaces when cleanupWorkspaces is enabled", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "cleanup-demo",
    title: "Cleanup Demo",
    prompt: "Test workspace cleanup.",
    judges: [
      {
        id: "pass",
        type: "command",
        label: "Always pass",
        command: "node -e \"process.exit(0)\""
      }
    ]
  });

  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath,
    cleanupWorkspaces: true
  });

  assert.equal(benchmark.results[0].status, "success");

  // Workspace directory should have been cleaned up
  const { stat } = await import("node:fs/promises");
  let workspaceExists = true;
  try {
    await stat(benchmark.results[0].workspacePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      workspaceExists = false;
    }
  }
  assert.equal(workspaceExists, false, "Workspace should be cleaned up");

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark preserves workspaces when cleanupWorkspaces is not set", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "no-cleanup-demo",
    title: "No Cleanup Demo",
    prompt: "Test workspace preserved.",
    judges: [
      {
        id: "pass",
        type: "command",
        label: "Always pass",
        command: "node -e \"process.exit(0)\""
      }
    ]
  });

  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath
  });

  assert.equal(benchmark.results[0].status, "success");

  // Workspace directory should still exist
  const { stat } = await import("node:fs/promises");
  const workspaceStat = await stat(benchmark.results[0].workspacePath);
  assert.equal(workspaceStat.isDirectory(), true, "Workspace should be preserved");

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark uses builtin repo when task has repoSource", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const builtinRepoPath = path.join(tempDir, "builtin-repos", "node-starter");
  const userRepoPath = path.join(tempDir, "user-repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(builtinRepoPath, { recursive: true });
  await mkdir(userRepoPath, { recursive: true });
  await writeFile(path.join(builtinRepoPath, "README.md"), "# Builtin Repo\n", "utf8");
  await writeJson(path.join(builtinRepoPath, "package.json"), { name: "builtin-repo", version: "0.0.0" });
  await writeFile(path.join(userRepoPath, "README.md"), "# User Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "builtin-repo-demo",
    title: "Builtin Repo Demo",
    prompt: "Test builtin repo source.",
    repoSource: "builtin://node-starter",
    judges: [
      {
        id: "check-builtin",
        type: "file-contains",
        label: "README is from builtin repo",
        path: "README.md",
        pattern: "Builtin Repo"
      }
    ]
  });

  const benchmark = await runBenchmark({
    repoPath: userRepoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath,
    builtinReposRoot: path.join(tempDir, "builtin-repos")
  });

  assert.equal(benchmark.results[0].status, "success");
  assert.equal(benchmark.results[0].judgeResults[0].success, true);

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark emits onProgress events", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "progress-demo",
    title: "Progress Demo",
    prompt: "Test progress events.",
    judges: [
      {
        id: "pass",
        type: "command",
        label: "Always pass",
        command: "node -e \"process.exit(0)\""
      }
    ]
  });

  const events = [];
  await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath,
    onProgress: (event) => {
      events.push(event);
    }
  });

  const phases = events.map((e) => e.phase);
  assert.ok(phases.includes("starting"), "Should have starting event");
  assert.ok(phases.includes("preflight"), "Should have preflight event");
  assert.ok(phases.includes("agent-start"), "Should have agent-start event");
  assert.ok(phases.includes("agent-finish"), "Should have agent-finish event");
  assert.ok(phases.includes("complete"), "Should have complete event");

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark returns cancelled results and still runs teardown after abort", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-cancel.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "repoarena.taskpack/v1",
    id: "cancel-demo",
    title: "Cancel Demo",
    prompt: "Cancel a benchmark while the agent is running.",
    teardownCommands: [
      {
        id: "teardown-marker",
        label: "Write teardown marker",
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
        setTimeout(() => controller.abort(), 100);
      }
    }
  });

  const benchmark = await benchmarkPromise;
  const result = benchmark.results[0];

  assert.equal(result.status, "cancelled");
  assert.equal(result.teardownResults.length, 1);
  assert.equal(result.teardownResults[0].success, true);
  const teardownMarker = await readFile(path.join(result.workspacePath, "teardown-marker.txt"), "utf8");
  assert.equal(teardownMarker, "done");
  assert.ok(events.some((event) => event.phase === "complete" && /cancelled/i.test(event.message)));

  await rm(tempDir, { recursive: true, force: true });
});
