// Allow inline node -e in test fixture task packs. Production task packs
// should use script files; tests use inline scripts for brevity.
process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES = "1";

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { AgentLogStore } from "../packages/core/dist/index.js";
import { CRITICAL_FAIL_SCORE_BAND, computeCompositeScore } from "../packages/report/dist/index.js";
import { checkTaskCompatibility, runAgent, runBenchmark } from "../packages/runner/dist/index.js";
import { loadTaskPack } from "../packages/taskpacks/dist/index.js";

const require = createRequire(import.meta.url);
const nodeFs = require("node:fs").promises;
const execFileAsync = promisify(execFile);

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}


test("runBenchmark passes only allowlisted env vars to setup, judges, teardown, and agents", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });

  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  process.env.AGENTARENA_ALLOWED_TEST = "visible";
  process.env.AGENTARENA_BLOCKED_TEST = "hidden";

  try {
    await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "env-demo",
    title: "Env Demo",
    prompt: "Create a benchmark note.",
    envAllowList: ["AGENTARENA_ALLOWED_TEST"],
    setupCommands: [
      {
        label: "Write allowed env marker",
        command:
          "node -e \"const fs=require('node:fs');fs.writeFileSync('env-setup.txt',(process.env.AGENTARENA_ALLOWED_TEST||'')+'|'+(process.env.AGENTARENA_BLOCKED_TEST||''))\""
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

  const trace = await readFile(path.join(benchmark.outputPath, "agents", "demo-fast", "trace.jsonl"), "utf8");
  assert.match(trace, /setup\.finish/);
  assert.match(trace, /teardown\.finish/);

  await rm(tempDir, { recursive: true, force: true });
  } finally {
    delete process.env.AGENTARENA_ALLOWED_TEST;
    delete process.env.AGENTARENA_BLOCKED_TEST;
  }
});

test("runBenchmark supports step-level env allowlists and inline overrides", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });

  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  process.env.AGENTARENA_STEP_ONLY = "step-visible";
  process.env.AGENTARENA_SHOULD_STAY_BLOCKED = "blocked";

  try {
    await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "step-env-demo",
    title: "Step Env Demo",
    prompt: "Create a benchmark note.",
    envAllowList: [],
    setupCommands: [
      {
        label: "Write step env marker",
        envAllowList: ["AGENTARENA_STEP_ONLY"],
        env: {
          AGENTARENA_INLINE_SETUP: "inline-setup"
        },
        command:
          "node -e \"const fs=require('node:fs');fs.writeFileSync('step-env-setup.txt',[(process.env.AGENTARENA_STEP_ONLY||''),(process.env.AGENTARENA_INLINE_SETUP||''),(process.env.AGENTARENA_SHOULD_STAY_BLOCKED||'')].join('|'))\""
      }
    ],
    judges: [
      {
        id: "step-env-judge",
        type: "command",
        label: "Step env is available only where configured",
        envAllowList: ["AGENTARENA_STEP_ONLY"],
        env: {
          AGENTARENA_INLINE_JUDGE: "inline-judge"
        },
        command:
          "node -e \"const fs=require('node:fs');const setup=fs.readFileSync('step-env-setup.txt','utf8');const judge=[(process.env.AGENTARENA_STEP_ONLY||''),(process.env.AGENTARENA_INLINE_JUDGE||''),(process.env.AGENTARENA_SHOULD_STAY_BLOCKED||'')].join('|');process.exit(setup==='step-visible|inline-setup|'&&judge==='step-visible|inline-judge|' ? 0 : 1)\""
      }
    ],
    teardownCommands: [
      {
        label: "Cleanup step env marker",
        env: {
          AGENTARENA_INLINE_TEARDOWN: "inline-teardown"
        },
        command:
          "node -e \"const fs=require('node:fs');const value=(process.env.AGENTARENA_INLINE_TEARDOWN||'')+'|'+(process.env.AGENTARENA_STEP_ONLY||'');if(value!=='inline-teardown|'){process.exit(1)}fs.rmSync('step-env-setup.txt',{force:true})\""
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
  } finally {
    delete process.env.AGENTARENA_STEP_ONLY;
    delete process.env.AGENTARENA_SHOULD_STAY_BLOCKED;
  }
});

test("runBenchmark executes setup and teardown commands in declaration order", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });

  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "ordered-hooks",
    title: "Ordered Hooks",
    prompt: "Run ordered setup and teardown hooks.",
    setupCommands: [
      {
        label: "Create initial marker",
        command:
          "node -e \"setTimeout(()=>{require('node:fs').writeFileSync('order.txt','first\\n')},500)\" // 500ms delay to test hook ordering"
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });

  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "builtin-judges",
    title: "Built-in Judges",
    prompt: "Run file and JSON assertions.",
    setupCommands: [
      {
        label: "Prepare fixture files",
        command:
          "node -e \"const fs=require('node:fs');fs.mkdirSync('fixtures/nested',{recursive:true});fs.writeFileSync('fixtures/note.txt','hello agentarena');fs.writeFileSync('fixtures/nested/extra.txt','extra');fs.writeFileSync('fixtures/config.json',JSON.stringify({enabled:true,name:'agentarena'}));\""
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
        label: "Fixture note mentions agentarena",
        path: "fixtures/note.txt",
        pattern: "agentarena"
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });

  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "advanced-judges",
    title: "Advanced Judges",
    prompt: "Run snapshot and schema assertions.",
    setupCommands: [
      {
        label: "Prepare snapshot fixtures",
        command:
          "node -e \"const fs=require('node:fs');fs.mkdirSync('fixtures',{recursive:true});fs.writeFileSync('fixtures/actual.txt','hello snapshot\\n');fs.writeFileSync('fixtures/expected.txt','hello snapshot\\n');fs.writeFileSync('fixtures/config.json',JSON.stringify({enabled:true,name:'agentarena'}));fs.writeFileSync('fixtures/schema.json',JSON.stringify({type:'object',required:['enabled','name'],properties:{enabled:{type:'boolean'},name:{type:'string'}}}));\""
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

test("runBenchmark parses structured test/lint judges and excludes tool artifacts from diff precision", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
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
          "node -e \"const fs=require('node:fs');fs.mkdirSync('.agentarena',{recursive:true});fs.writeFileSync('.agentarena/test-results.json', JSON.stringify({success:true,numTotalTests:3,numPassedTests:2,numFailedTests:0,numPendingTests:1,numTodoTests:0}));\"",
        reportFile: ".agentarena/test-results.json"
      },
      {
        id: "lint-json",
        type: "lint-check",
        label: "Structured lint results",
        command:
          "node -e \"const fs=require('node:fs');fs.mkdirSync('.agentarena',{recursive:true});fs.writeFileSync('.agentarena/lint-results.json', JSON.stringify([{filePath:'README.md',errorCount:0,warningCount:1,messages:[{severity:1,message:'warn'}]}]));\"",
        reportFile: ".agentarena/lint-results.json",
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
  assert.equal(benchmark.results[0].diffPrecision?.score, 0);
  assert.equal(benchmark.results[0].diffPrecision?.totalChangedFiles, 0);

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark can update snapshot files when enabled", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
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
  // Only check the content, not caring about line endings
  assert.ok(
    updatedSnapshot.includes("new value"),
    `expected snapshot to contain "new value", got: ${JSON.stringify(updatedSnapshot)}`
  );

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark cleans up workspaces when cleanupWorkspaces is enabled", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
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

test("runBenchmark records a non-critical judge failure as partial validation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  try {
    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: "exit-code-demo",
      title: "Exit Code Demo",
      prompt: "Test handling of non-zero exit codes.",
      judges: [
        {
          id: "fail",
          type: "command",
          label: "Always fail",
          command: "node -e \"process.exit(1)\""
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
    assert.equal(benchmark.results[0].executionStatus, "completed");
    assert.equal(benchmark.results[0].validationStatus, "partial");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runBenchmark cancellation signal is propagated and recorded in progress events", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  try {
    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: "cancel-prop-demo",
      title: "Cancel Propagation Demo",
      prompt: "Test cancellation propagation.",
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
      agentIds: ["demo-fast"],
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
          setTimeout(() => controller.abort(), 50);
        }
      }
    });

    const benchmark = await benchmarkPromise;
    assert.equal(benchmark.results[0].status, "cancelled");
    assert.ok(events.some((event) => /cancelled/i.test(event.message)));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runBenchmark records non-critical validation independently for each agent", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  try {
    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: "batch-isolation-demo",
      title: "Batch Isolation Demo",
      prompt: "Test that one agent failure does not affect others.",
      judges: [
        {
          id: "fail",
          type: "command",
          label: "Always fail",
          command: "node -e \"process.exit(1)\""
        }
      ]
    });

    const benchmark = await runBenchmark({
      repoPath,
      taskPath,
      agentIds: ["demo-fast", "demo-thorough"],
      outputPath
    });

    assert.equal(benchmark.results.length, 2);
    assert.ok(benchmark.results.every((result) => result.status === "success"));
    assert.ok(benchmark.results.every((result) => result.executionStatus === "completed"));
    assert.ok(benchmark.results.every((result) => result.validationStatus === "partial"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runBenchmark isolates workspace roots when concurrent runs reuse the same runId", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPathA = path.join(tempDir, "output-a");
  const outputPathB = path.join(tempDir, "output-b");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });
  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "shared-run-id",
    title: "Shared Run Id",
    prompt: "Create a benchmark note.",
    setupCommands: [],
    judges: [],
    teardownCommands: []
  });

  const [firstRun, secondRun] = await Promise.all([
    runBenchmark({
      repoPath,
      taskPath,
      agentIds: ["demo-fast"],
      outputPath: outputPathA,
      runId: "shared-run",
      cleanupWorkspaces: true
    }),
    runBenchmark({
      repoPath,
      taskPath,
      agentIds: ["demo-fast"],
      outputPath: outputPathB,
      runId: "shared-run",
      cleanupWorkspaces: true
    })
  ]);

  assert.notEqual(firstRun.results[0].workspacePath, secondRun.results[0].workspacePath);
  assert.match(firstRun.results[0].workspacePath, /agentarena-workspaces-shared-run-/);
  assert.match(secondRun.results[0].workspacePath, /agentarena-workspaces-shared-run-/);

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark resumes completed agent results from a run directory", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });
  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "resume-demo",
    title: "Resume Demo",
    prompt: "Create a benchmark note.",
    judges: [
      {
        id: "pass",
        type: "command",
        label: "Always pass",
        command: "node -e \"process.exit(0)\""
      }
    ]
  });

  const firstRun = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath,
    runId: "resume-run"
  });

  const fastResultPath = path.join(firstRun.outputPath, "agents", "demo-fast", "result.json");
  const persistedFastResult = JSON.parse(await readFile(fastResultPath, "utf8"));
  persistedFastResult.summary = "RESUMED_SENTINEL";
  await writeFile(fastResultPath, JSON.stringify(persistedFastResult, null, 2), "utf8");

  const resumedRun = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast", "demo-budget"],
    outputPath,
    runId: "resume-run",
    resumeFrom: firstRun.outputPath
  });

  assert.equal(resumedRun.results.length, 2);
  const fast = resumedRun.results.find((result) => result.variantId === "demo-fast");
  const budget = resumedRun.results.find((result) => result.variantId === "demo-budget");
  assert.ok(fast);
  assert.ok(budget);
  assert.equal(fast.summary, "RESUMED_SENTINEL");
  assert.equal(budget.status, "success");
  assert.ok(await readFile(path.join(resumedRun.outputPath, "agents", "demo-budget", "result.json"), "utf8"));

  await rm(tempDir, { recursive: true, force: true });
});


test("runBenchmark stops and preserves the previous result when persistence fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");
  const runId = "atomic-agent-result";
  const resultPath = path.join(outputPath, runId, "agents", "demo-fast", "result.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(taskPath, { schemaVersion: "agentarena.taskpack/v1", id: "atomic-result-demo", title: "Atomic Result Demo", prompt: "Create a benchmark note.", judges: [{ id: "pass", type: "command", label: "Always pass", command: "node -e \"process.exit(0)\"" }] });
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify({ previous: true }), "utf8");

  const originalOpen = nodeFs.open;
  nodeFs.open = async (filePath, ...args) => {
    const handle = await originalOpen(filePath, ...args);
    if (
      path.dirname(path.resolve(String(filePath))) === path.dirname(path.resolve(resultPath)) &&
      path.basename(String(filePath)).startsWith(".result.json.tmp.")
    ) {
      return {
        async write() {
          await handle.write("{partial", null, "utf8");
          throw new Error("simulated interrupted result write");
        },
        sync: () => handle.sync(),
        close: () => handle.close()
      };
    }
    return handle;
  };

  try {
    await assert.rejects(
      () => runBenchmark({
        repoPath,
        taskPath,
        agentIds: ["demo-fast", "demo-budget"],
        outputPath,
        runId,
        maxConcurrency: 1,
        cleanupWorkspaces: true
      }),
      /Failed to persist resumable result for Demo Fast.*simulated interrupted result write/i
    );
  } finally {
    nodeFs.open = originalOpen;
  }

  try {
    const persisted = JSON.parse(await readFile(resultPath, "utf8"));
    assert.deepEqual(persisted, { previous: true });
    const files = await nodeFs.readdir(path.dirname(resultPath));
    assert.deepEqual(files.filter((name) => name.includes(".tmp.") || name.endsWith(".bak")), []);
    await assert.rejects(() => readFile(path.join(outputPath, runId, "agents", "demo-budget", "result.json")), /ENOENT/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runBenchmark refuses to resume a corrupt per-agent result instead of rerunning it", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const resumePath = path.join(outputPath, "corrupt-resume");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(taskPath, { schemaVersion: "agentarena.taskpack/v1", id: "corrupt-resume-demo", title: "Corrupt Resume Demo", prompt: "Create a benchmark note.", judges: [] });
  await mkdir(path.join(resumePath, "agents", "demo-fast"), { recursive: true });
  await writeJson(path.join(resumePath, "run-state.json"), { taskId: "corrupt-resume-demo" });
  await writeFile(path.join(resumePath, "agents", "demo-fast", "result.json"), "{partial", "utf8");

  try {
    await assert.rejects(
      () => runBenchmark({
        repoPath,
        taskPath,
        agentIds: ["demo-fast"],
        outputPath,
        runId: "new-run",
        resumeFrom: resumePath,
        cleanupWorkspaces: true
      }),
      /Cannot resume.*demo-fast.*corrupt|malformed/i
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runBenchmark aborts adapter execution when agent timeout elapses", async () => {

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");
  const previousTimeout = process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS;

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });
  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "agent-timeout",
    title: "Agent Timeout",
    prompt: "Create a benchmark note.",
    setupCommands: [],
    judges: [],
    teardownCommands: []
  });

  // Short timeout to test timeout handling; demo adapter completes in ~100ms
  process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS = "50";

  try {
    const benchmark = await runBenchmark({
      repoPath,
      taskPath,
      agentIds: ["demo-fast"],
      outputPath
    });

    assert.equal(benchmark.results[0].status, "failed");
    assert.match(benchmark.results[0].summary, /timed out/i);
    assert.deepEqual(benchmark.results[0].changedFiles, []);

    const trace = await readFile(path.join(benchmark.outputPath, "agents", "demo-fast", "trace.jsonl"), "utf8");
    assert.match(trace, /execution timed out/i);
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS;
    } else {
      process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS = previousTimeout;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runBenchmark preserves workspaces when cleanupWorkspaces is not set", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
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
    schemaVersion: "agentarena.taskpack/v1",
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

test("runBenchmark rejects a user repository link outside the allowed root", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-root-"));
  const workspace = path.join(tempDir, "workspace");
  const outsideRepo = path.join(tempDir, "outside-repo");
  const repoLink = path.join(workspace, "repo-link");
  const taskPath = path.join(workspace, "task.json");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(outsideRepo, { recursive: true });
    await writeFile(path.join(outsideRepo, "README.md"), "# Outside Repo\n", "utf8");
    await symlink(outsideRepo, repoLink, linkType);
    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: "user-repo-root-escape",
      title: "User Repo Root Escape",
      prompt: "Do not run outside the allowed root.",
      judges: []
    });

    await assert.rejects(
      () => runBenchmark({
        repoPath: repoLink,
        userRepoRoot: workspace,
        taskPath,
        agentIds: ["demo-fast"],
        outputPath: path.join(workspace, "output")
      }),
      /outside the allowed user repository root/i
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runBenchmark rejects a builtin repository link outside the configured builtin root", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-root-"));
  const workspace = path.join(tempDir, "workspace");
  const builtinRoot = path.join(workspace, "builtin-repos");
  const outsideRepo = path.join(tempDir, "outside-builtin");
  const taskPath = path.join(workspace, "task.json");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  try {
    await mkdir(builtinRoot, { recursive: true });
    await mkdir(outsideRepo, { recursive: true });
    await writeFile(path.join(outsideRepo, "README.md"), "# Outside Builtin\n", "utf8");
    await symlink(outsideRepo, path.join(builtinRoot, "escape"), linkType);
    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: "builtin-repo-root-escape",
      title: "Builtin Repo Root Escape",
      prompt: "Do not run outside the builtin root.",
      repoSource: "builtin://escape",
      judges: []
    });

    await assert.rejects(
      () => runBenchmark({
        repoPath: workspace,
        taskPath,
        agentIds: ["demo-fast"],
        outputPath: path.join(workspace, "output"),
        builtinReposRoot: builtinRoot
      }),
      /outside the configured builtin repository root/i
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runBenchmark emits onProgress events", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
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

test("runBenchmark emits agent activity events when enabled", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task.json");

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Activity Events\n", "utf8");
    await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

    await writeJson(taskPath, {
      schemaVersion: "agentarena.taskpack/v1",
      id: "activity-progress-demo",
      title: "Activity Progress Demo",
      prompt: "Emit progress activity.",
      judges: []
    });

    const events = [];
    await runBenchmark({
      repoPath,
      taskPath,
      agentIds: ["demo-fast"],
      outputPath,
      enableActivityEvents: true,
      onProgress: (event) => {
        events.push(event);
      }
    });

    const activityEvents = events.filter((event) => event.phase === "agent-activity");
    assert.ok(activityEvents.length > 0, "Should emit at least one agent activity event");
    assert.equal(activityEvents[0].variantId, "demo-fast");
    assert.equal(activityEvents[0].stream, "stdout");
    assert.equal(typeof activityEvents[0].seq, "number");
    assert.equal(typeof activityEvents[0].line, "string");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runBenchmark returns cancelled results and still runs teardown after abort", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-cancel.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
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
        // Abort shortly after scheduling so faster machines cannot finish the
        // demo adapter before the cancellation reaches it.
        setTimeout(() => controller.abort(), 50);
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

test("runBenchmark tokenBudget option overrides task.metadata for tokenEfficiencyScore", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-budget.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  // Metadata budget is tiny (1 token) -> efficiency would be ~0 without override.
  // The CLI override budget is huge -> efficiency should clamp to 1.0, proving
  // options.tokenBudget overrides task.metadata.tokenBudget.
  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "token-budget-demo",
    title: "Token Budget Demo",
    prompt: "Test token budget override.",
    metadata: {
      source: "official",
      owner: "test",
      repoTypes: ["node-js"],
      tags: ["test"],
      dependencies: [],
      tokenBudget: 1
    },
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
    tokenBudget: 10_000_000
  });

  const result = benchmark.results[0];
  assert.equal(result.status, "success");
  assert.equal(
    result.tokenEfficiencyScore,
    1,
    "CLI tokenBudget override should yield a full efficiency score (1.0)"
  );
});

test("runBenchmark without tokenBudget option keeps task.metadata budget for scoring", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-budget-meta.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Temp Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "temp-repo", version: "0.0.0" });

  // Tiny metadata budget, no CLI override -> efficiency must be < 1.0.
  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "token-budget-meta-demo",
    title: "Token Budget Meta Demo",
    prompt: "Test token budget metadata fallback.",
    metadata: {
      source: "official",
      owner: "test",
      repoTypes: ["node-js"],
      tags: ["test"],
      dependencies: [],
      tokenBudget: 1
    },
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

  const result = benchmark.results[0];
  assert.equal(result.status, "success");
  assert.ok(
    typeof result.tokenEfficiencyScore === "number" && result.tokenEfficiencyScore < 1,
    "Without CLI override, the tiny metadata budget should produce efficiency < 1.0"
  );
});

test("runBenchmark surfaces a non-fatal task compatibility warning without throwing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-incompat.json");

  // Repo intentionally has NO package.json and NO build/lint scripts, so the
  // compatibility checker flags the task as partially compatible ("warning").
  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Bare Repo\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "incompat-demo",
    title: "Incompatible Demo",
    prompt: "Task that needs scripts the repo does not provide.",
    judges: [
      {
        id: "needs-build",
        type: "compilation",
        label: "Project compiles"
      },
      {
        id: "needs-fixture",
        type: "file-exists",
        label: "Fixture file present",
        path: "fixtures/required-by-task.txt"
      }
    ]
  });

  const events = [];
  // Must not throw despite the incompatibility 鈥?the run proceeds as before.
  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath,
    onProgress: (event) => {
      events.push(event);
    }
  });

  // The run completed (did not hard-fail on the compatibility signal).
  assert.equal(benchmark.results.length, 1);

  // A compatibility warning was surfaced via progress metadata.
  const compatEvent = events.find(
    (event) => event.metadata?.compatibility
  );
  assert.ok(compatEvent, "Expected a progress event carrying compatibility metadata");
  assert.equal(compatEvent.metadata.compatibility.status, "warning");
  assert.ok(
    Array.isArray(compatEvent.metadata.compatibility.checks) &&
      compatEvent.metadata.compatibility.checks.length > 0,
    "Compatibility metadata should include the individual checks"
  );
  assert.ok(
    compatEvent.metadata.compatibility.failedChecks.length > 0,
    "Compatibility metadata should list the failed/warned checks"
  );
  assert.match(compatEvent.message, /compatibility warning/i);

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark skips incompatible task packs without scoring agents", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Node Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "node-repo", version: "0.0.0" });

  const events = [];
  const benchmark = await runBenchmark({
    repoPath,
    taskPath: path.resolve("examples/taskpacks/official/python-api.yaml"),
    agentIds: ["demo-fast"],
    outputPath,
    onProgress: (event) => {
      events.push(event);
    }
  });

  assert.equal(benchmark.taskCompatibility?.status, "incompatible");
  assert.equal(benchmark.results.length, 1);
  assert.equal(benchmark.results[0].status, "failed");
  assert.equal(benchmark.results[0].scoreExcluded, true);
  assert.equal(benchmark.results[0].failureCategory, "task-pack");
  assert.match(benchmark.results[0].summary, /not runnable/i);
  assert.ok(
    !events.some((event) => event.phase === "agent-start"),
    "incompatible task should stop before agent execution"
  );

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark skips no-install node tool checks that would force dependency installs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-no-install.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Node Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "node-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "needs-local-jest",
    title: "Needs Local Jest",
    prompt: "Fix a test.",
    metadata: {
      source: "official",
      owner: "test",
      repoTypes: ["node"],
      tags: ["test"],
      dependencies: ["npm"]
    },
    judges: [
      {
        id: "tests-pass",
        type: "test-result",
        label: "All tests pass",
        command: "npx --no-install jest --json --outputFile=.agentarena/test-results.json",
        reportFile: ".agentarena/test-results.json"
      }
    ]
  });

  const events = [];
  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath,
    onProgress: (event) => {
      events.push(event);
    }
  });

  assert.equal(benchmark.taskCompatibility?.status, "incompatible");
  assert.match(benchmark.taskCompatibility.checks.find((check) => check.status === "fail")?.message ?? "", /force the agent to install dependencies/i);
  assert.equal(benchmark.results[0].scoreExcluded, true);
  assert.equal(benchmark.results[0].failureCategory, "task-pack");
  assert.ok(
    !events.some((event) => event.phase === "agent-start"),
    "no-install local tool mismatch should stop before agent execution"
  );

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark treats multiple repoTypes as alternatives", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-multi-repotypes.json");

  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# Node Repo\n", "utf8");
  await writeJson(path.join(repoPath, "package.json"), { name: "node-repo", version: "0.0.0" });

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "multi-repotypes",
    title: "Multi Repo Types",
    prompt: "Make a small docs improvement.",
    metadata: {
      source: "official",
      owner: "test",
      repoTypes: ["node-js", "python", "go", "java"],
      tags: ["docs"],
      dependencies: []
    },
    judges: [
      {
        id: "readme-exists",
        type: "file-exists",
        label: "README exists",
        path: "README.md"
      }
    ]
  });

  const benchmark = await runBenchmark({
    repoPath,
    taskPath,
    agentIds: ["demo-fast"],
    outputPath
  });

  assert.notEqual(benchmark.taskCompatibility?.status, "incompatible");
  assert.equal(benchmark.results[0].scoreExcluded, undefined);

  await rm(tempDir, { recursive: true, force: true });
});

test("runBenchmark reports a passing compatibility check for a compatible task", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-runner-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const taskPath = path.join(tempDir, "task-compat.json");

  // Builtin repo source short-circuits to "compatible" in the checker.
  const builtinRepoPath = path.join(tempDir, "builtin-repos", "node-starter");
  await mkdir(builtinRepoPath, { recursive: true });
  await writeFile(path.join(builtinRepoPath, "README.md"), "# Builtin\n", "utf8");
  await writeJson(path.join(builtinRepoPath, "package.json"), { name: "b", version: "0.0.0" });
  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "README.md"), "# User\n", "utf8");

  await writeJson(taskPath, {
    schemaVersion: "agentarena.taskpack/v1",
    id: "compat-demo",
    title: "Compatible Demo",
    prompt: "A builtin-repo task.",
    repoSource: "builtin://node-starter",
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
    builtinReposRoot: path.join(tempDir, "builtin-repos"),
    onProgress: (event) => {
      events.push(event);
    }
  });

  const compatEvent = events.find(
    (event) => event.metadata?.compatibility
  );
  assert.ok(compatEvent, "Expected a compatibility progress event");
  assert.equal(compatEvent.metadata.compatibility.status, "compatible");
  assert.equal(compatEvent.metadata.compatibility.failedChecks.length, 0);

  await rm(tempDir, { recursive: true, force: true });
});

test("checkTaskCompatibility accepts official task-pack inline node checks that normal runs allow", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-compat-official-"));
  const repoPath = path.join(tempDir, "repo");
  const originalAllowEval = process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES;

  try {
    delete process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES;
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Node Repo\n", "utf8");
    await writeJson(path.join(repoPath, "package.json"), { name: "node-repo", version: "0.0.0" });

    const task = await loadTaskPack(path.resolve("examples/taskpacks/official/small-refactor.yaml"));
    const compatibility = await checkTaskCompatibility(task, repoPath);

    assert.notEqual(compatibility.status, "incompatible");
    assert.equal(
      compatibility.checks.some((check) => check.label.includes("inline eval") && check.status === "fail"),
      false
    );
  } finally {
    if (originalAllowEval === undefined) delete process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES;
    else process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES = originalAllowEval;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("checkTaskCompatibility reads package.json files with a UTF-8 BOM", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-compat-bom-"));
  const repoPath = path.join(tempDir, "repo");

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Node Repo\n", "utf8");
    await writeFile(
      path.join(repoPath, "package.json"),
      `\uFEFF${JSON.stringify({ name: "node-repo", version: "0.0.0", scripts: { test: "node test.js" } })}`,
      "utf8"
    );

    const task = {
      schemaVersion: "agentarena.taskpack/v1",
      id: "bom-package-json",
      title: "BOM Package JSON",
      prompt: "Run tests.",
      envAllowList: [],
      setupCommands: [],
      judges: [
        {
          id: "tests-pass",
          type: "command",
          label: "npm test",
          command: "npm test"
        }
      ],
      teardownCommands: []
    };

    const compatibility = await checkTaskCompatibility(task, repoPath);

    assert.notEqual(compatibility.status, "incompatible");
    assert.equal(
      compatibility.checks.some((check) => check.label.includes("npm script: test") && check.status === "fail"),
      false
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runAgent falls back to prompt.txt when adapter.prompt trace omits the full prompt", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-prompt-fallback-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const workspaceRootPath = path.join(tempDir, "workspaces");
  const fullPrompt = "FULL PROMPT FROM FILE";

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Prompt Fallback\n", "utf8");

    const task = {
      schemaVersion: "agentarena.taskpack/v1",
      id: "prompt-fallback",
      title: "Prompt Fallback",
      prompt: "Verify prompt fallback.",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    };
    const capability = {
      supportTier: "supported",
      invocationMethod: "test",
      authPrerequisites: [],
      tokenAvailability: "available",
      costAvailability: "available",
      traceRichness: "partial",
      knownLimitations: []
    };
    const adapter = {
      id: "prompt-test",
      title: "Prompt Test",
      kind: "external",
      capability,
      async preflight() {
        throw new Error("not used");
      },
      async execute(context) {
        await writeFile(path.join(context.workspacePath, "prompt.txt"), fullPrompt, "utf8");
        await context.trace({
          type: "adapter.prompt",
          message: "Prompt metadata without full prompt",
          metadata: { promptLength: fullPrompt.length, promptPreview: fullPrompt.slice(0, 8) }
        });
        return {
          status: "success",
          summary: "done",
          tokenUsage: 1,
          estimatedCostUsd: 0,
          costKnown: true,
          changedFilesHint: []
        };
      }
    };
    const preflight = {
      agentId: "prompt-test",
      baseAgentId: "prompt-test",
      variantId: "prompt-test",
      displayLabel: "Prompt Test",
      requestedConfig: {},
      agentTitle: "Prompt Test",
      adapterKind: "external",
      status: "ready",
      summary: "ready",
      capability,
      adapter
    };

    const result = await runAgent(repoPath, outputPath, workspaceRootPath, task, preflight, {});

    assert.equal(result.status, "success");
    assert.equal(result.assembledPrompt, fullPrompt);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runAgent captures file diffs before teardown modifies the workspace", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-pre-teardown-diff-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const workspaceRootPath = path.join(tempDir, "workspaces");

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "baseline\n", "utf8");
    await execFileAsync("git", ["init"], { cwd: repoPath });
    await execFileAsync("git", ["config", "user.email", "agentarena@example.test"], { cwd: repoPath });
    await execFileAsync("git", ["config", "user.name", "AgentArena Test"], { cwd: repoPath });
    await execFileAsync("git", ["add", "README.md"], { cwd: repoPath });
    await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: repoPath });

    const task = {
      schemaVersion: "agentarena.taskpack/v1",
      id: "pre-teardown-diff",
      title: "Pre-teardown diff",
      prompt: "Modify README.",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: [{
        id: "rewrite-readme",
        label: "Rewrite README during teardown",
        command: "node -e \"require('node:fs').writeFileSync('README.md', 'teardown output\\\\n')\""
      }]
    };
    const capability = {
      supportTier: "supported",
      invocationMethod: "test",
      authPrerequisites: [],
      tokenAvailability: "available",
      costAvailability: "available",
      traceRichness: "partial",
      knownLimitations: []
    };
    const adapter = {
      id: "pre-teardown-diff-test",
      title: "Pre-teardown diff test",
      kind: "external",
      capability,
      async preflight() {
        throw new Error("not used");
      },
      async execute(context) {
        await writeFile(path.join(context.workspacePath, "README.md"), "agent output\n", "utf8");
        return {
          status: "success",
          summary: "done",
          tokenUsage: 1,
          estimatedCostUsd: 0,
          costKnown: true,
          changedFilesHint: ["README.md"]
        };
      }
    };
    const preflight = {
      agentId: adapter.id,
      baseAgentId: adapter.id,
      variantId: adapter.id,
      displayLabel: adapter.title,
      requestedConfig: {},
      agentTitle: adapter.title,
      adapterKind: adapter.kind,
      status: "ready",
      summary: "ready",
      capability,
      adapter
    };

    const result = await runAgent(repoPath, outputPath, workspaceRootPath, task, preflight, {});

    assert.equal(result.status, "success");
    assert.equal(result.teardownResults[0].success, true);
    assert.equal(await readFile(path.join(result.workspacePath, "README.md"), "utf8"), "teardown output\n");
    const readmeDiff = result.fileDiffs?.find((entry) => entry.path === "README.md");
    assert.ok(readmeDiff, "README diff should be persisted");
    assert.match(readmeDiff.text, /\+agent output/);
    assert.doesNotMatch(readmeDiff.text, /teardown output/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runAgent captures activity lines in the log store and failure tail", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-activity-"));
  const repoPath = path.join(tempDir, "repo");
  const outputPath = path.join(tempDir, "output");
  const workspaceRootPath = path.join(tempDir, "workspaces");

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Activity Capture\n", "utf8");

    const task = {
      schemaVersion: "agentarena.taskpack/v1",
      id: "activity-capture",
      title: "Activity Capture",
      prompt: "Emit live activity.",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    };
    const capability = {
      supportTier: "supported",
      invocationMethod: "test",
      authPrerequisites: [],
      tokenAvailability: "available",
      costAvailability: "available",
      traceRichness: "partial",
      knownLimitations: []
    };
    const adapter = {
      id: "activity-test",
      title: "Activity Test",
      kind: "external",
      capability,
      async preflight() {
        throw new Error("not used");
      },
      async execute(context) {
        context.onActivity?.("stdout line", "stdout", 0);
        context.onActivity?.("stderr line", "stderr", 0);
        return {
          status: "failed",
          summary: "failed intentionally",
          tokenUsage: 1,
          estimatedCostUsd: 0,
          costKnown: true,
          changedFilesHint: []
        };
      }
    };
    const preflight = {
      agentId: "activity-test",
      baseAgentId: "activity-test",
      variantId: "activity-test",
      displayLabel: "Activity Test",
      requestedConfig: {},
      agentTitle: "Activity Test",
      adapterKind: "external",
      status: "ready",
      summary: "ready",
      capability,
      adapter
    };
    const agentLogStore = new AgentLogStore(10);
    const events = [];

    const result = await runAgent(repoPath, outputPath, workspaceRootPath, task, preflight, {
      enableActivityEvents: true,
      agentLogStore,
      nextActivitySeq: (() => {
        let seq = 0;
        return () => seq++;
      })(),
      onActivity: (line, stream, seq) => {
        events.push({ line, stream, seq });
      }
    });

    assert.equal(result.status, "failed");
    assert.deepEqual(
      agentLogStore.get("activity-test").map((line) => [line.seq, line.stream, line.text]),
      [
        [0, "stdout", "stdout line"],
        [1, "stderr", "stderr line"]
      ]
    );
    assert.deepEqual(events.map((event) => [event.seq, event.stream, event.line]), [
      [0, "stdout", "stdout line"],
      [1, "stderr", "stderr line"]
    ]);
    assert.deepEqual(result.failureTail, [
      "[stdout] stdout line",
      "[stderr] stderr line"
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runAgent separates completed execution from judge validation outcomes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-validation-status-"));
  const repoPath = path.join(tempDir, "repo");
  const capability = {
    supportTier: "supported",
    invocationMethod: "test",
    authPrerequisites: [],
    tokenAvailability: "available",
    costAvailability: "available",
    traceRichness: "partial",
    knownLimitations: []
  };
  const adapter = {
    id: "validation-status-test",
    title: "Validation Status Test",
    kind: "external",
    capability,
    async preflight() {
      throw new Error("not used");
    },
    async execute() {
      return {
        status: "success",
        summary: "agent completed",
        tokenUsage: 1,
        estimatedCostUsd: 0,
        costKnown: true,
        changedFilesHint: []
      };
    }
  };
  const preflight = {
    agentId: "validation-status-test",
    baseAgentId: "validation-status-test",
    variantId: "validation-status-test",
    displayLabel: "Validation Status Test",
    requestedConfig: {},
    agentTitle: "Validation Status Test",
    adapterKind: "external",
    status: "ready",
    summary: "ready",
    capability,
    adapter
  };

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Validation Status\n", "utf8");

    const runCase = async (critical, suffix) => {
      const task = {
        schemaVersion: "agentarena.taskpack/v1",
        id: `validation-status-${suffix}`,
        title: "Validation Status",
        prompt: "Complete successfully, then fail a judge.",
        envAllowList: [],
        setupCommands: [],
        judges: [{
          id: `failing-${suffix}`,
          type: "command",
          label: `Failing ${suffix}`,
          command: "node -e \"process.exit(1)\"",
          critical
        }],
        teardownCommands: []
      };
      const result = await runAgent(
        repoPath,
        path.join(tempDir, `output-${suffix}`),
        path.join(tempDir, `workspaces-${suffix}`),
        task,
        preflight,
        {}
      );
      return { result, task };
    };

    const nonCritical = await runCase(false, "non-critical");
    assert.equal(nonCritical.result.status, "success");
    assert.equal(nonCritical.result.executionStatus, "completed");
    assert.equal(nonCritical.result.validationStatus, "partial");

    const critical = await runCase(true, "critical");
    assert.equal(critical.result.status, "failed");
    assert.equal(critical.result.executionStatus, "completed");
    assert.equal(critical.result.validationStatus, "failed");

    const score = computeCompositeScore(critical.result, {
      runId: "validation-status-score",
      createdAt: "2026-07-28T00:00:00.000Z",
      repoPath,
      outputPath: path.join(tempDir, "score"),
      task: critical.task,
      preflights: [preflight],
      results: [critical.result]
    });
    assert.ok(score >= CRITICAL_FAIL_SCORE_BAND.min);
    assert.ok(score <= CRITICAL_FAIL_SCORE_BAND.max);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("runBenchmark rejects resume results when task inputs change despite matching task id", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-resume-fingerprint-"));
  const repoPath = path.join(tempDir, "repo");
  const firstOutput = path.join(tempDir, "first");
  const secondOutput = path.join(tempDir, "second");
  const taskPath = path.join(tempDir, "task.json");
  await mkdir(repoPath, { recursive: true });
  await writeJson(path.join(repoPath, "package.json"), { name: "resume-fingerprint", version: "1.0.0" });
  const baseTask = {
    schemaVersion: "agentarena.taskpack/v1",
    id: "same-task-id",
    title: "Fingerprint Demo",
    prompt: "Original prompt",
    envAllowList: [],
    setupCommands: [],
    judges: [],
    teardownCommands: []
  };
  try {
    await writeJson(taskPath, baseTask);
    const first = await runBenchmark({ repoPath, taskPath, agentIds: ["demo-fast"], outputPath: firstOutput, cleanupWorkspaces: true });
    await writeJson(taskPath, { ...baseTask, prompt: "Changed prompt", judges: [{ id: "must-fail", type: "command", label: "Must fail", command: "node -e \"process.exit(1)\"" }] });
    const second = await runBenchmark({ repoPath, taskPath, agentIds: ["demo-fast"], outputPath: secondOutput, resumeFrom: first.outputPath, cleanupWorkspaces: true });
    assert.equal(second.results[0].judgeResults.length, 1);
    assert.equal(second.results[0].status, "success");
    assert.equal(second.results[0].executionStatus, "completed");
    assert.equal(second.results[0].validationStatus, "partial");
    assert.equal(second.results[0].judgeResults[0].success, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("changePolicy uses real snapshots and becomes a critical completion gate", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-change-policy-"));
  const repoPath = path.join(tempDir, "repo");
  await mkdir(path.join(repoPath, "src"), { recursive: true });
  await writeFile(path.join(repoPath, "src", "main.js"), "module.exports = 1;\n", "utf8");
  await writeFile(path.join(repoPath, "README.md"), "baseline\n", "utf8");

  const capability = {
    supportTier: "supported",
    invocationMethod: "test",
    authPrerequisites: [],
    tokenAvailability: "available",
    costAvailability: "available",
    traceRichness: "partial",
    knownLimitations: []
  };
  const task = {
    schemaVersion: "agentarena.taskpack/v1",
    id: "change-policy-runner",
    title: "Change policy runner",
    prompt: "Make the scoped change.",
    envAllowList: [],
    setupCommands: [],
    judges: [],
    teardownCommands: [],
    changePolicy: {
      requireAgentChange: true,
      allowedPaths: ["src/main.js"],
      minChangedFiles: 1,
      maxChangedFiles: 1
    }
  };

  async function runCase(mode) {
    const adapter = {
      id: `policy-${mode}`,
      title: `Policy ${mode}`,
      kind: "external",
      capability,
      async preflight() { throw new Error("not used"); },
      async execute(context) {
        if (mode === "allowed") {
          await writeFile(path.join(context.workspacePath, "src", "main.js"), "module.exports = 2;\n", "utf8");
        } else if (mode === "forbidden") {
          await writeFile(path.join(context.workspacePath, "README.md"), "agent changed the wrong file\n", "utf8");
        }
        return {
          status: "success",
          summary: "done",
          tokenUsage: 1,
          estimatedCostUsd: 0,
          costKnown: true,
          changedFilesHint: ["src/main.js"]
        };
      }
    };
    const preflight = {
      agentId: adapter.id,
      baseAgentId: adapter.id,
      variantId: adapter.id,
      displayLabel: adapter.title,
      requestedConfig: {},
      agentTitle: adapter.title,
      adapterKind: adapter.kind,
      status: "ready",
      summary: "ready",
      capability,
      adapter
    };
    return runAgent(
      repoPath,
      path.join(tempDir, `output-${mode}`),
      path.join(tempDir, `workspace-${mode}`),
      task,
      preflight,
      {}
    );
  }

  try {
    const noOp = await runCase("noop");
    const noOpPolicy = noOp.judgeResults.find((judge) => judge.judgeId === "agentarena-change-policy");
    assert.equal(noOp.changedFiles.length, 0);
    assert.equal(noOpPolicy?.success, false);
    assert.equal(noOp.status, "failed");

    const allowed = await runCase("allowed");
    const allowedPolicy = allowed.judgeResults.find((judge) => judge.judgeId === "agentarena-change-policy");
    assert.deepEqual(allowed.changedFiles, ["src/main.js"]);
    assert.equal(allowedPolicy?.success, true);
    assert.equal(allowed.status, "success");

    const forbidden = await runCase("forbidden");
    const forbiddenPolicy = forbidden.judgeResults.find((judge) => judge.judgeId === "agentarena-change-policy");
    assert.deepEqual(forbidden.changedFiles, ["README.md"]);
    assert.equal(forbiddenPolicy?.success, false);
    assert.equal(forbidden.status, "failed");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
