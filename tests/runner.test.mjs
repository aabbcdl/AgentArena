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
