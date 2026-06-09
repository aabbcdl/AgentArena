import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeReport } from "../packages/report/dist/index.js";

const demoCapability = {
  supportTier: "supported",
  invocationMethod: "Built-in AgentArena demo adapter",
  authPrerequisites: [],
  tokenAvailability: "estimated",
  costAvailability: "estimated",
  traceRichness: "partial",
  configurableRuntime: {
    model: false,
    reasoningEffort: false
  },
  knownLimitations: ["Synthetic metrics"]
};

function createPreflight(overrides = {}) {
  return {
    agentId: overrides.agentId ?? "demo-fast",
    baseAgentId: overrides.baseAgentId ?? overrides.agentId ?? "demo-fast",
    variantId: overrides.variantId ?? overrides.agentId ?? "demo-fast",
    displayLabel: overrides.displayLabel ?? overrides.agentTitle ?? "Demo Fast",
    requestedConfig: overrides.requestedConfig ?? {},
    resolvedRuntime: overrides.resolvedRuntime,
    agentTitle: overrides.agentTitle ?? "Demo Fast",
    adapterKind: overrides.adapterKind ?? "demo",
    status: overrides.status ?? "ready",
    summary: overrides.summary ?? "Ready",
    capability: overrides.capability ?? demoCapability,
    command: overrides.command,
    details: overrides.details
  };
}

function createResult(outputPath, overrides = {}) {
  const agentId = overrides.agentId ?? "demo-fast";
  return {
    agentId,
    baseAgentId: overrides.baseAgentId ?? agentId,
    variantId: overrides.variantId ?? agentId,
    displayLabel: overrides.displayLabel ?? overrides.agentTitle ?? agentId,
    requestedConfig: overrides.requestedConfig ?? {},
    resolvedRuntime: overrides.resolvedRuntime,
    agentTitle: overrides.agentTitle ?? agentId,
    adapterKind: overrides.adapterKind ?? "demo",
    preflight: overrides.preflight ?? createPreflight(overrides),
    status: overrides.status ?? "success",
    summary: overrides.summary ?? "Done",
    durationMs: overrides.durationMs ?? 1000,
    tokenUsage: overrides.tokenUsage ?? 100,
    estimatedCostUsd: overrides.estimatedCostUsd ?? 0,
    costKnown: overrides.costKnown ?? false,
    changedFiles: overrides.changedFiles ?? [],
    changedFilesHint: overrides.changedFilesHint ?? overrides.changedFiles ?? [],
    setupResults: overrides.setupResults ?? [],
    judgeResults: overrides.judgeResults ?? [],
    teardownResults: overrides.teardownResults ?? [],
    tracePath: overrides.tracePath ?? path.join(outputPath, "agents", agentId, "trace.jsonl"),
    workspacePath: overrides.workspacePath ?? `C:\\temp\\workspace\\${agentId}`,
    diff: overrides.diff ?? {
      added: [],
      changed: [],
      removed: []
    },
    scoreExcluded: overrides.scoreExcluded,
    scoreExclusionReason: overrides.scoreExclusionReason,
    failureCategory: overrides.failureCategory
  };
}

test("writeReport sanitizes shareable output paths", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-report-"));
  const outputPath = path.join(tempDir, "run-output");

  const benchmarkRun = {
    runId: "run-1",
    createdAt: "2026-03-13T00:00:00.000Z",
    repoPath: "D:\\project\\AgentArena",
    outputPath,
    task: {
      schemaVersion: "agentarena.taskpack/v1",
      id: "demo",
      title: "Demo",
      prompt: "Prompt",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    },
    preflights: [
      createPreflight({
        command: "codex"
      })
    ],
    results: [
      createResult(outputPath, {
        estimatedCostUsd: 0.1,
        costKnown: true,
        changedFiles: ["agentarena-demo/demo-fast.md"],
        judgeResults: [
          {
            judgeId: "lint",
            label: "Lint",
            type: "file-contains",
            target: "README.md",
            expectation: "AgentArena",
            exitCode: 0,
            success: true,
            stdout: "Matched content in README.md.",
            stderr: "",
            durationMs: 100,
            cwd: "C:\\temp\\workspace\\demo-fast"
          }
        ],
        diff: {
          added: ["agentarena-demo/demo-fast.md"],
          changed: [],
          removed: []
        }
      })
    ]
  };

  const { jsonPath, markdownPath, badgePath, prCommentPath } = await writeReport(benchmarkRun);
  const summary = JSON.parse(await readFile(jsonPath, "utf8"));
  const markdown = await readFile(markdownPath, "utf8");
  const badge = JSON.parse(await readFile(badgePath, "utf8"));
  const prComment = await readFile(prCommentPath, "utf8");

  assert.equal(summary.repoPath, ".");
  assert.equal(summary.outputPath, ".");
  assert.equal(summary.scoreMode, "practical");
  assert.equal(summary.scoreWeights.status, 0.24);
  assert.equal(summary.preflights[0].command, "codex");
  assert.equal(summary.results[0].tracePath, "run/agents/demo-fast/trace.jsonl");
  assert.equal(summary.results[0].workspacePath, "workspace/demo-fast");
  assert.equal(typeof summary.results[0].compositeScore, "number");
  assert.equal(Array.isArray(summary.results[0].scoreReasons), true);
  assert.equal(summary.results[0].judgeResults[0].cwd, "workspace/demo-fast");
  assert.equal(summary.results[0].judgeResults[0].target, "README.md");
  assert.match(markdown, /# AgentArena Summary/);
  assert.match(markdown, /- Score Mode: `practical`/);
  assert.match(markdown, /- Score Weights: `\{"status":0\.24,"tests":0\.26/);
  assert.match(markdown, /- Success Rate: `1\/1`/);
  assert.match(markdown, /- Badge Endpoint: `badge\.json`/);
  assert.match(markdown, /## Capability Matrix/);
  assert.match(markdown, /\| Variant \| Base Agent \| Provider \| Provider Kind \| Model \| Reasoning \| Version \| Verification \| Status \| Score \| Duration \| Tokens \| Cost \| Changed Files \| Judges \| Tests \| Lint \| Diff Precision \|/);
  assert.match(markdown, /`run\/agents\/demo-fast\/trace\.jsonl`/);
  assert.match(markdown, /- Composite Score: \d+\.\d/);
  assert.match(markdown, /- Provider Identity: provider=official \| kind=.*?\| provider source=.*?/);
  assert.match(markdown, /target=README\.md/);
  assert.doesNotMatch(markdown, /C:\\temp\\workspace/);
  assert.equal(badge.label, "AgentArena");
  assert.equal(badge.message, "1/1 passing");
  assert.match(prComment, /## AgentArena Benchmark/);
  assert.match(prComment, /Score mode: `practical`/);
  assert.match(prComment, /Score weights: `\{"status":0\.24,"tests":0\.26/);
  assert.match(prComment, /Overview: `1\/1` passing \| Failed: `0` \| Total Tokens: `100` \| Known Cost: `\$0\.10`/);
  assert.match(prComment, /### Review Table/);
  assert.match(prComment, /\| Attention \| Variant \| Base Agent \| Provider \| Provider Kind \| Model \| Reasoning \| Version \| Verification \| Tier \| Preflight \| Run \| Score \| Duration \| Tokens \| Cost \| Judges \| Tests \| Lint \| Diff Precision \| Files \| Notes \|/);
  assert.match(prComment, /\| ok \| demo-fast \| demo-fast \| official \|.*?\|.*?\| default \|.*?\|.*?\/.*?\| supported \| ready \| success \| \d+\.\d \| 1\.00s \| 100 \| \$0\.10 \| 1\/1 \| n\/a \| n\/a \| n\/a \| 1 \| ready \|/);
  assert.match(prComment, /### Review Focus/);
  assert.match(prComment, /- No warnings or failures in this run\./);
  assert.match(prComment, /### Artifacts/);
  assert.match(prComment, /`report\.html`/);

  const html = await readFile(path.join(outputPath, "report.html"), "utf8");
  assert.match(html, /Score mode: practical \| Score weights: \{&quot;status&quot;:0\.24,&quot;tests&quot;:0\.26/);

  await rm(tempDir, { recursive: true, force: true });
});

test("writeReport includes a failure summary section for failed agents", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-report-"));
  const outputPath = path.join(tempDir, "run-output");

  const benchmarkRun = {
    runId: "run-2",
    createdAt: "2026-03-13T00:00:00.000Z",
    repoPath: "D:\\project\\AgentArena",
    outputPath,
    task: {
      schemaVersion: "agentarena.taskpack/v1",
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
      createResult(outputPath, {
        agentId: "demo-fail",
        agentTitle: "Demo Fail",
        displayLabel: "Demo Fail",
        status: "failed",
        summary: "Judge failures detected",
        tokenUsage: 50,
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
        ]
      })
    ]
  };

  const { markdownPath, prCommentPath } = await writeReport(benchmarkRun);
  const markdown = await readFile(markdownPath, "utf8");
  const prComment = await readFile(prCommentPath, "utf8");

  assert.match(markdown, /## Failures/);
  assert.match(markdown, /`demo-fail`: Judge failures detected/);
  assert.match(markdown, /Cause: Validation failed after the agent ran: 1 judge\(s\) failed\./);
  assert.match(markdown, /Fix: Fix the code or task pack until every failed judge passes when run manually\./);
  assert.match(markdown, /Failure Diagnosis/);
  assert.match(markdown, /judge `Snapshot Check` \(snapshot\) target=fixtures\/actual\.txt expect=matches fixtures\/expected\.txt/);
  assert.match(prComment, /### Review Focus/);
  assert.match(prComment, /- result `demo-fail`: Judge failures detected/);
  assert.match(prComment, /cause: Validation failed after the agent ran: 1 judge\(s\) failed\./);
  assert.match(prComment, /fix: Fix the code or task pack until every failed judge passes when run manually\./);
  assert.match(prComment, /judge `Snapshot Check` \(snapshot\) target=fixtures\/actual\.txt expect=matches fixtures\/expected\.txt/);
  assert.match(prComment, /\| fail \| Demo Fail \| demo-fail \| official \|.*?\|.*?\| default \|.*?\|.*?\/.*?\| supported \| failed \| failed \| \d+\.\d \| 1\.00s \| 50 \| n\/a \| 0\/1 \| n\/a \| n\/a \| n\/a \| 0 \| Judge failures detected \|/);

  await rm(tempDir, { recursive: true, force: true });
});

test("writeReport diagnoses setup failures with task pack commands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-report-setup-"));
  const outputPath = path.join(tempDir, "run-output");

  const benchmarkRun = {
    runId: "run-setup",
    createdAt: "2026-03-13T00:00:00.000Z",
    repoPath: "D:\\project\\AgentArena",
    outputPath,
    task: {
      schemaVersion: "agentarena.taskpack/v1",
      id: "python-api",
      title: "Python API",
      prompt: "Prompt",
      envAllowList: [],
      setupCommands: [
        {
          id: "install-deps",
          label: "Install dependencies",
          command: "pip install -r requirements.txt",
          timeoutMs: 120000,
          envAllowList: []
        }
      ],
      judges: [],
      teardownCommands: []
    },
    preflights: [],
    results: [
      createResult(outputPath, {
        agentId: "demo-setup-fail",
        displayLabel: "Demo Setup Fail",
        status: "failed",
        summary: "setup command \"Install dependencies\" failed with exit code 1.",
        scoreExcluded: true,
        scoreExclusionReason: "Task setup failed before the agent started.",
        failureCategory: "task-pack",
        setupResults: [
          {
            stepId: "install-deps",
            label: "Install dependencies",
            command: "[redacted]",
            exitCode: 1,
            success: false,
            stdout: "[redacted]",
            stderr: "[redacted]",
            durationMs: 10,
            cwd: "workspace/demo-setup-fail"
          }
        ]
      })
    ]
  };

  const { markdownPath, prCommentPath } = await writeReport(benchmarkRun);
  const markdown = await readFile(markdownPath, "utf8");
  const prComment = await readFile(prCommentPath, "utf8");

  assert.match(markdown, /Cause: Setup failed before the agent started: Install dependencies\./);
  assert.match(markdown, /Evidence: Setup command: pip install -r requirements\.txt/);
  assert.match(markdown, /Fix: Use a repository that matches the task pack/);
  assert.match(markdown, /Composite Score: n\/a/);
  assert.match(prComment, /\| fail \| Demo Setup Fail .*?\| failed \| failed \| n\/a \|/);
  assert.match(prComment, /fix: Use a repository that matches the task pack/);

  await rm(tempDir, { recursive: true, force: true });
});

test("writeReport explains missing local node tools as task-pack environment issues", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-report-local-tool-"));
  const outputPath = path.join(tempDir, "run-output");

  const benchmarkRun = {
    runId: "run-local-tool",
    createdAt: "2026-03-13T00:00:00.000Z",
    repoPath: "D:\\project\\AgentArena",
    outputPath,
    task: {
      schemaVersion: "agentarena.taskpack/v1",
      id: "react-bugfix",
      title: "React Bugfix",
      prompt: "Prompt",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    },
    preflights: [],
    results: [
      createResult(outputPath, {
        agentId: "demo-local-tool",
        displayLabel: "Demo Local Tool",
        status: "failed",
        summary: "Done",
        judgeResults: [
          {
            judgeId: "tests-pass",
            label: "All tests pass",
            type: "test-result",
            exitCode: 1,
            success: false,
            stdout: "",
            stderr: "npm ERR! could not determine executable to run\ncommand: npx --no-install jest",
            durationMs: 10,
            command: "npx --no-install jest --json",
            cwd: "workspace/demo-local-tool"
          }
        ]
      })
    ]
  };

  const { markdownPath } = await writeReport(benchmarkRun);
  const markdown = await readFile(markdownPath, "utf8");

  assert.match(markdown, /Validation could not run because the task pack depends on local project tools/);
  assert.match(markdown, /Prepare dependencies before benchmarking/);

  await rm(tempDir, { recursive: true, force: true });
});

test("writeReport respects zh-CN locale", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-report-locale-"));
  const outputPath = path.join(tempDir, "run-output");

  const benchmarkRun = {
    runId: "run-zh",
    createdAt: "2026-03-13T00:00:00.000Z",
    repoPath: "D:\\project\\AgentArena",
    outputPath,
    task: {
      schemaVersion: "agentarena.taskpack/v1",
      id: "demo-zh",
      title: "演示",
      prompt: "演示提示词",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    },
    preflights: [createPreflight({ command: "codex" })],
    results: [createResult(outputPath)]
  };

  const { htmlPath, markdownPath, prCommentPath } = await writeReport(benchmarkRun, { locale: "zh-CN" });
  const html = await readFile(htmlPath, "utf8");
  const markdown = await readFile(markdownPath, "utf8");
  const prComment = await readFile(prCommentPath, "utf8");

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /AgentArena 报告/);
  assert.match(markdown, /# AgentArena 摘要/);
  assert.match(prComment, /## AgentArena 评审摘要/);

  await rm(tempDir, { recursive: true, force: true });
});

test("writeReport includes preflight warnings in PR comments", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-report-"));
  const outputPath = path.join(tempDir, "run-output");

  const benchmarkRun = {
    runId: "run-3",
    createdAt: "2026-03-13T00:00:00.000Z",
    repoPath: "D:\\project\\AgentArena",
    outputPath,
    task: {
      schemaVersion: "agentarena.taskpack/v1",
      id: "demo-warning",
      title: "Demo Warning",
      prompt: "Prompt",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    },
    preflights: [
      createPreflight({
        agentId: "cursor",
        agentTitle: "Cursor",
        displayLabel: "Cursor",
        adapterKind: "cursor",
        status: "unverified",
        summary: "CLI found but auth not verified",
        capability: {
          ...demoCapability,
          supportTier: "experimental"
        }
      })
    ],
    results: [
      createResult(outputPath, {
        agentId: "cursor",
        agentTitle: "Cursor",
        displayLabel: "Cursor",
        adapterKind: "cursor",
        preflight: createPreflight({
          agentId: "cursor",
          agentTitle: "Cursor",
          displayLabel: "Cursor",
          adapterKind: "cursor",
          status: "unverified",
          summary: "CLI found but auth not verified",
          capability: {
            ...demoCapability,
            supportTier: "experimental"
          }
        }),
        status: "failed",
        summary: "Skipped because auth was not verified",
        durationMs: 0,
        tokenUsage: 0
      })
    ]
  };

  const { prCommentPath } = await writeReport(benchmarkRun);
  const prComment = await readFile(prCommentPath, "utf8");

  assert.match(prComment, /### Review Focus/);
  assert.match(prComment, /- preflight `cursor` \(experimental\): unverified - CLI found but auth not verified/);
  assert.match(prComment, /\| fail \| Cursor \| cursor \| official \|.*?\|.*?\| default \|.*?\|.*?\/.*?\| experimental \| unverified \| failed \| \d+\.\d \| 0ms \| 0 \| n\/a \| 0\/0 \| n\/a \| n\/a \| n\/a \| 0 \| Skipped because auth was not verified \|/);

  await rm(tempDir, { recursive: true, force: true });
});

test("writeReport handles empty results array", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-report-empty-"));
  const outputPath = path.join(tempDir, "run-output");

  const benchmarkRun = {
    runId: "run-empty",
    createdAt: "2026-03-20T00:00:00.000Z",
    repoPath: ".",
    outputPath,
    task: {
      schemaVersion: "agentarena.taskpack/v1",
      id: "empty-task",
      title: "Empty Task",
      prompt: "Nothing to do",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    },
    preflights: [],
    results: []
  };

  const { htmlPath, jsonPath, markdownPath, badgePath, prCommentPath } = await writeReport(benchmarkRun);

  assert.ok(htmlPath.endsWith("report.html"));
  assert.ok(jsonPath.endsWith("summary.json"));

  const summary = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(summary.results.length, 0);

  const badge = JSON.parse(await readFile(badgePath, "utf8"));
  assert.equal(badge.message, "0/0 passing");
  assert.equal(badge.color, "lightgrey");

  const markdown = await readFile(markdownPath, "utf8");
  assert.match(markdown, /Success Rate: `0\/0`/);

  const prComment = await readFile(prCommentPath, "utf8");
  assert.match(prComment, /No warnings or failures in this run/);

  await rm(tempDir, { recursive: true, force: true });
});
