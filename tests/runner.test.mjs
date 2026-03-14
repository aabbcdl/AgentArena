import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
