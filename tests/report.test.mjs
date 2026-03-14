import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeReport } from "../packages/report/dist/index.js";

const demoCapability = {
  supportTier: "supported",
  invocationMethod: "Built-in RepoArena demo adapter",
  authPrerequisites: [],
  tokenAvailability: "estimated",
  costAvailability: "estimated",
  traceRichness: "partial",
  knownLimitations: ["Synthetic metrics"]
};

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
        capability: demoCapability,
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
          capability: demoCapability,
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
            type: "file-contains",
            target: "README.md",
            expectation: "RepoArena",
            exitCode: 0,
            success: true,
            stdout: "Matched content in README.md.",
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

  const { jsonPath, markdownPath, badgePath, prCommentPath } = await writeReport(benchmarkRun);
  const summary = JSON.parse(await readFile(jsonPath, "utf8"));
  const markdown = await readFile(markdownPath, "utf8");
  const badge = JSON.parse(await readFile(badgePath, "utf8"));
  const prComment = await readFile(prCommentPath, "utf8");

  assert.equal(summary.repoPath, ".");
  assert.equal(summary.outputPath, ".");
  assert.equal(summary.preflights[0].command, undefined);
  assert.equal(summary.results[0].tracePath, "run/agents/demo-fast/trace.jsonl");
  assert.equal(summary.results[0].workspacePath, "workspace/demo-fast");
  assert.equal(summary.results[0].judgeResults[0].cwd, "workspace/demo-fast");
  assert.equal(summary.results[0].judgeResults[0].target, "README.md");
  assert.match(markdown, /# RepoArena Summary/);
  assert.match(markdown, /- Success Rate: `1\/1`/);
  assert.match(markdown, /- Badge Endpoint: `badge\.json`/);
  assert.match(markdown, /## Capability Matrix/);
  assert.match(markdown, /\| Agent \| Status \| Duration \| Tokens \| Cost \| Changed Files \| Judges \|/);
  assert.match(markdown, /`run\/agents\/demo-fast\/trace\.jsonl`/);
  assert.match(markdown, /target=README\.md/);
  assert.doesNotMatch(markdown, /C:\\temp\\workspace/);
  assert.equal(badge.label, "RepoArena");
  assert.equal(badge.message, "1/1 passing");
  assert.match(prComment, /## RepoArena Benchmark/);
  assert.match(prComment, /Overview: `1\/1` passing \| Failed: `0` \| Tokens: `100` \| Known Cost: `\$0\.10`/);
  assert.match(prComment, /\| Agent \| Tier \| Preflight \| Run \| Duration \| Tokens \| Cost \| Judges \| Files \|/);
  assert.match(prComment, /\*\*Artifacts\*\*/);
  assert.match(prComment, /`report\.html`/);

  await rm(tempDir, { recursive: true, force: true });
});

test("writeReport includes a failure summary section for failed agents", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-report-"));
  const outputPath = path.join(tempDir, "run-output");

  const benchmarkRun = {
    runId: "run-2",
    createdAt: "2026-03-13T00:00:00.000Z",
    repoPath: "D:\\project\\AgentArena",
    outputPath,
    task: {
      schemaVersion: "repoarena.taskpack/v1",
      id: "demo-failure",
      title: "Demo Failure",
      prompt: "Prompt",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    },
    preflights: [],
    results: [
      {
        agentId: "demo-fail",
        agentTitle: "Demo Fail",
        adapterKind: "demo",
        preflight: {
          agentId: "demo-fail",
          agentTitle: "Demo Fail",
          adapterKind: "demo",
          status: "ready",
          capability: demoCapability,
          summary: "Ready"
        },
        status: "failed",
        summary: "Judge failures detected",
        durationMs: 1000,
        tokenUsage: 50,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFiles: [],
        changedFilesHint: [],
        setupResults: [],
        judgeResults: [
          {
            judgeId: "snapshot",
            label: "Snapshot Check",
            type: "snapshot",
            target: "fixtures/actual.txt",
            expectation: "matches fixtures/expected.txt",
            exitCode: 1,
            success: false,
            stdout: "",
            stderr: "Snapshot mismatch",
            durationMs: 100
          }
        ],
        teardownResults: [],
        tracePath: path.join(outputPath, "agents", "demo-fail", "trace.jsonl"),
        workspacePath: "C:\\temp\\workspace\\demo-fail",
        diff: {
          added: [],
          changed: [],
          removed: []
        }
      }
    ]
  };

  const { markdownPath, prCommentPath } = await writeReport(benchmarkRun);
  const markdown = await readFile(markdownPath, "utf8");
  const prComment = await readFile(prCommentPath, "utf8");

  assert.match(markdown, /## Failures/);
  assert.match(markdown, /`demo-fail`: Judge failures detected/);
  assert.match(markdown, /judge `Snapshot Check` \(snapshot\) target=fixtures\/actual\.txt expect=matches fixtures\/expected\.txt/);
  assert.match(prComment, /\*\*Failures\*\*/);
  assert.match(prComment, /`demo-fail`: Judge failures detected/);
  assert.match(prComment, /judge `Snapshot Check` \(snapshot\) target=fixtures\/actual\.txt expect=matches fixtures\/expected\.txt/);

  await rm(tempDir, { recursive: true, force: true });
});

test("writeReport includes preflight warnings in PR comments", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-report-"));
  const outputPath = path.join(tempDir, "run-output");

  const benchmarkRun = {
    runId: "run-3",
    createdAt: "2026-03-13T00:00:00.000Z",
    repoPath: "D:\\project\\AgentArena",
    outputPath,
    task: {
      schemaVersion: "repoarena.taskpack/v1",
      id: "demo-warning",
      title: "Demo Warning",
      prompt: "Prompt",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    },
    preflights: [
      {
        agentId: "cursor",
        agentTitle: "Cursor",
        adapterKind: "cursor",
        status: "unverified",
        summary: "CLI found but auth not verified",
        capability: {
          ...demoCapability,
          supportTier: "experimental"
        }
      }
    ],
    results: [
      {
        agentId: "cursor",
        agentTitle: "Cursor",
        adapterKind: "cursor",
        preflight: {
          agentId: "cursor",
          agentTitle: "Cursor",
          adapterKind: "cursor",
          status: "unverified",
          capability: {
            ...demoCapability,
            supportTier: "experimental"
          },
          summary: "CLI found but auth not verified"
        },
        status: "failed",
        summary: "Skipped because auth was not verified",
        durationMs: 0,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFiles: [],
        changedFilesHint: [],
        setupResults: [],
        judgeResults: [],
        teardownResults: [],
        tracePath: path.join(outputPath, "agents", "cursor", "trace.jsonl"),
        workspacePath: "C:\\temp\\workspace\\cursor",
        diff: {
          added: [],
          changed: [],
          removed: []
        }
      }
    ]
  };

  const { prCommentPath } = await writeReport(benchmarkRun);
  const prComment = await readFile(prCommentPath, "utf8");

  assert.match(prComment, /\*\*Preflight Warnings\*\*/);
  assert.match(prComment, /`cursor` \(experimental\): unverified - CLI found but auth not verified/);

  await rm(tempDir, { recursive: true, force: true });
});
