import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeReport } from "../packages/report/dist/index.js";

test("writeReport sanitizes shareable output paths", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-report-"));
  const outputPath = path.join(tempDir, "run-output");

  const benchmarkRun = {
    runId: "run-1",
    createdAt: "2026-03-13T00:00:00.000Z",
    repoPath: "D:\\project\\AgentArena",
    outputPath,
    task: {
      schemaVersion: "repoarena.taskpack/v1",
      id: "demo",
      title: "Demo",
      prompt: "Prompt",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    },
    preflights: [
      {
        agentId: "demo-fast",
        agentTitle: "Demo Fast",
        adapterKind: "demo",
        status: "ready",
        summary: "Ready",
        command: "codex"
      }
    ],
    results: [
      {
        agentId: "demo-fast",
        agentTitle: "Demo Fast",
        adapterKind: "demo",
        preflight: {
          agentId: "demo-fast",
          agentTitle: "Demo Fast",
          adapterKind: "demo",
          status: "ready",
          summary: "Ready",
          command: "codex"
        },
        status: "success",
        summary: "Done",
        durationMs: 1000,
        tokenUsage: 100,
        estimatedCostUsd: 0.1,
        costKnown: true,
        changedFiles: ["repoarena-demo/demo-fast.md"],
        changedFilesHint: ["repoarena-demo/demo-fast.md"],
        setupResults: [],
        judgeResults: [
          {
            judgeId: "lint",
            label: "Lint",
            type: "command",
            command: "npm run lint",
            exitCode: 0,
            success: true,
            stdout: "",
            stderr: "",
            durationMs: 100,
            cwd: "C:\\temp\\workspace\\demo-fast"
          }
        ],
        teardownResults: [],
        tracePath: path.join(outputPath, "agents", "demo-fast", "trace.jsonl"),
        workspacePath: "C:\\temp\\workspace\\demo-fast",
        diff: {
          added: ["repoarena-demo/demo-fast.md"],
          changed: [],
          removed: []
        }
      }
    ]
  };

  const { jsonPath } = await writeReport(benchmarkRun);
  const summary = JSON.parse(await readFile(jsonPath, "utf8"));

  assert.equal(summary.repoPath, ".");
  assert.equal(summary.outputPath, ".");
  assert.equal(summary.preflights[0].command, undefined);
  assert.equal(summary.results[0].tracePath, "run/agents/demo-fast/trace.jsonl");
  assert.equal(summary.results[0].workspacePath, "workspace/demo-fast");
  assert.equal(summary.results[0].judgeResults[0].cwd, "workspace/demo-fast");

  await rm(tempDir, { recursive: true, force: true });
});
