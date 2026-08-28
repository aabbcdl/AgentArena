import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, isApiErrorStatus } from "../apps/web-report/workbench/src/api/client.ts";
import { adapterTrialStatusLabel, adapterTrialStatusTone, deriveAdapterTrialStatus } from "../apps/web-report/workbench/src/domain/adapter-trial.ts";
import { formatUserError, toUserError } from "../apps/web-report/workbench/src/domain/errors.ts";
import {
  isComingSoonAdapter,
  labelExecution,
  labelPhase,
  labelRunState,
  labelTrustReason
} from "../apps/web-report/workbench/src/domain/labels.ts";
import { classifyLogLine, compactLogMessage } from "../apps/web-report/workbench/src/domain/logs.ts";
import { buildPilotDiagnostics, PILOT_DIAGNOSTICS_SCHEMA, pilotDiagnosticsMarkdown } from "../apps/web-report/workbench/src/domain/pilot-diagnostics.ts";
import { assessResultEvidence, runtimeEvidence } from "../apps/web-report/workbench/src/domain/result-insights.ts";
import {
  comparisonExclusionReasons,
  deriveRunOutcome,
  normalizeRun,
  runIdentityKey
} from "../apps/web-report/workbench/src/domain/run.ts";
import { mergeFreshRunStatus, mergeRunStatus } from "../apps/web-report/workbench/src/domain/run-status.ts";
import {
  runtimeProfileLabel,
  runtimeReadinessLabel,
  runtimeStageSummary
} from "../apps/web-report/workbench/src/domain/runtime-profile.ts";
import {
  DEFAULT_SCORE_MODE,
  normalizeScoreMode,
  SCORE_MODES
} from "../apps/web-report/workbench/src/domain/score-mode.ts";
import { createViewTelemetryDeduper } from "../apps/web-report/workbench/src/domain/telemetry.ts";
import { buildTimeline, categorizeEvent, groupEventsIntoSteps, safeCategoryClass, summarizeEvent } from "../apps/web-report/workbench/src/domain/trace.ts";
import { resolveTaskRepositorySource } from "../apps/web-report/workbench/src/types.ts";
import { getRunScoreMode } from "../packages/report/dist/report-helpers.js";

function result(overrides = {}) {
  return {
    agentId: "demo-fast",
    variantId: "demo-fast",
    displayLabel: "Demo Fast",
    status: "success",
    durationMs: 1200,
    tokenUsage: 100,
    estimatedCostUsd: 0.02,
    costKnown: true,
    changedFiles: ["src/a.ts"],
    judgeResults: [{ judgeId: "tests", label: "Tests", type: "test-result", success: true }],
    tracePath: "agents/demo-fast/trace.jsonl",
    ...overrides
  };
}

function run(overrides = {}) {
  return {
    runId: "run-001",
    createdAt: "2026-07-15T00:00:00.000Z",
    repository: { path: "D:/repo", revision: "abc123" },
    task: { id: "task-1", title: "Fix bug", schemaVersion: "agentarena.taskpack/v1" },
    scoreMode: "practical",
    results: [result()],
    ...overrides
  };
}

test("Workbench API errors preserve HTTP status for auth recovery", () => {
  const error = new ApiError("Authentication required", 401);

  assert.equal(error.status, 401);
  assert.equal(isApiErrorStatus(error, 401), true);
  assert.equal(isApiErrorStatus(error, 403), false);
  assert.equal(isApiErrorStatus(new Error("Authentication required"), 401), false);
});

test("adapter trial status never promotes unverified or blocked adapters to ready", () => {
  const adapter = { id: "codex", title: "Codex CLI", kind: "external", capability: { supportTier: "supported" } };
  const unverified = deriveAdapterTrialStatus(adapter, {
    id: "codex",
    displayName: "Codex CLI",
    installed: true,
    version: "1.0.0",
    configExists: true,
    configFilesFound: [],
    configFilesMissing: [],
    status: "unverified",
    detail: "CLI was found but auth was not verified"
  });
  assert.equal(unverified.status, "unverified");
  assert.equal(adapterTrialStatusTone(unverified.status), "warning");
  assert.equal(adapterTrialStatusLabel("en", unverified.status), "Unverified");

  const blocked = deriveAdapterTrialStatus(
    { ...adapter, capability: { supportTier: "blocked" } },
    undefined
  );
  assert.equal(blocked.status, "blocked");
  assert.equal(adapterTrialStatusTone(blocked.status), "danger");
});

test("task-ready status requires a matching three-stage runtime receipt", () => {
  const adapter = { id: "codex", title: "Codex CLI", kind: "external", capability: { supportTier: "supported" } };
  const detection = {
    id: "codex",
    displayName: "Codex CLI",
    installed: true,
    version: "1.2.3",
    configExists: true,
    configFilesFound: [],
    configFilesMissing: []
  };
  const profile = {
    id: "codex-local",
    name: "Codex",
    agentKind: "codex",
    mode: "inherit-local",
    revision: 1,
    secretRevision: 1,
    extraEnvKeys: [],
    riskFlags: [],
    secretStored: false
  };
  const base = { profile, receiptMatch: false, stages: [] };
  assert.equal(deriveAdapterTrialStatus(adapter, detection, [{ ...base, readiness: "changed" }]).status, "blocked");
  assert.equal(deriveAdapterTrialStatus(adapter, detection, [{ ...base, readiness: "task-ready" }]).status, "installed");
  assert.equal(deriveAdapterTrialStatus(adapter, detection, [{ ...base, readiness: "task-ready", receiptMatch: true }]).status, "task-ready");
});

test("pilot diagnostics bundle is versioned and omits secrets, prompts, and absolute paths", () => {
  const bundle = buildPilotDiagnostics({
    uiInfo: {
      version: { version: "0.1.0", buildNumber: 24, gitCommit: "abc123" },
      nodeMajor: 22,
      platform: "win32",
      telemetryEnabled: false
    },
    adapters: [{ id: "codex", title: "Codex", kind: "external", capability: { supportTier: "supported" } }],
    detectedAgents: [{ id: "codex", displayName: "Codex", installed: true, version: "1.0.0", configExists: true, configFilesFound: [], configFilesMissing: [], detail: "C:\\Users\\secret\\token" }],
    runtimeProfiles: [],
    runtimeReadiness: [],
    taskPacks: [{ id: "repo-health", path: "C:\\repo\\task.yaml", lifecycle: "core", repoSource: "builtin://nodejs-core", compatibility: { status: "compatible" }, prompt: "do not export this" }],
    taskPath: "C:\\repo\\task.yaml",
    telemetrySummary: { enabled: false, totalEvents: 0, events: {}, entryPoints: {}, resultIntegrity: {}, outcomes: {} },
    runs: [],
    runStatus: { state: "idle", phase: "idle", logs: [] },
    locale: "en"
  }, "2026-08-21T00:00:00.000Z");
  const serialized = JSON.stringify(bundle);
  assert.equal(bundle.schema, PILOT_DIAGNOSTICS_SCHEMA);
  assert.equal(bundle.taskPack.repoType, "builtin");
  assert.equal(serialized.includes("token"), false);
  assert.equal(serialized.includes("C:\\Users"), false);
  assert.equal(serialized.includes("do not export"), false);
  assert.match(pilotDiagnosticsMarkdown(bundle, "en"), /schema: agentarena\.pilot-diagnostics\/v1/);
});

test("runtime profile presentation localizes built-in labels without rewriting user data", () => {
  const builtIn = {
    id: "codex-local",
    name: "Current local Codex setup",
    agentKind: "codex",
    mode: "inherit-local",
    revision: 1,
    secretRevision: 1,
    extraEnvKeys: [],
    riskFlags: [],
    secretStored: false,
    isBuiltIn: true
  };
  const custom = { ...builtIn, id: "custom", name: "My Codex", isBuiltIn: false };

  assert.equal(runtimeProfileLabel("zh-CN", builtIn), "当前本地 Codex 配置");
  assert.equal(runtimeProfileLabel("en", builtIn), "Current local Codex setup");
  assert.equal(runtimeProfileLabel("zh-CN", custom), "My Codex");
  assert.equal(runtimeReadinessLabel("zh-CN", "task-ready"), "任务可用");
  assert.equal(runtimeReadinessLabel("en", "changed"), "Changed");
});

test("runtime stage presentation localizes predictable status while preserving English diagnostics", () => {
  const failedStage = {
    stage: "conversation",
    status: "failed",
    startedAt: "2026-08-14T00:00:00.000Z",
    durationMs: 10,
    summary: "API Error: 503 No available accounts"
  };

  assert.equal(runtimeStageSummary("zh-CN", failedStage), "真实 Provider 对话未通过，请查看下方诊断。");
  assert.equal(runtimeStageSummary("en", failedStage), failedStage.summary);
});

test("live log presentation removes terminal noise and emphasizes actionable events", () => {
  assert.equal(compactLogMessage("\u001b[31mError:\trequest failed\u001b[0m"), "Error: request failed");
  assert.equal(classifyLogLine("apply_patch updated src/app.ts"), "tool");
  assert.equal(classifyLogLine("warning: retrying after timeout", { stream: "stderr" }), "warning");
  assert.equal(classifyLogLine("fatal: permission denied", { stream: "stderr" }), "error");
  assert.equal(classifyLogLine("report completed", { phase: "report" }), "phase");
});

test("normalizeRun preserves runtime identity, usage breakdown, score evidence, and task difficulty", () => {
  const normalized = normalizeRun(run({
    task: {
      id: "task-1",
      title: "Repair config",
      schemaVersion: "agentarena.taskpack/v1",
      metadata: { difficulty: "easy", objective: "Repair one invalid value", judgeRationale: "A deterministic fixture" }
    },
    results: [result({
      tokenUsage: 2800,
      tokenUsageBreakdown: {
        inputTokens: 1500,
        outputTokens: 800,
        reasoningTokens: 120,
        cacheReadTokens: 500,
        cacheWriteTokens: 0
      },
      scoreComponents: { tests: 1, precision: 0.9 },
      scoreReasons: ["all critical judges passed"],
      resolvedRuntime: {
        effectiveModel: "o3",
        effectiveReasoningEffort: "medium",
        modelIdentitySource: "confirmed",
        reasoningEffortSource: "confirmed",
        source: "event-stream",
        verification: "confirmed"
      }
    })]
  }));

  assert.equal(normalized.task.difficulty, "easy");
  assert.equal(normalized.task.objective, "Repair one invalid value");
  assert.equal(normalized.results[0].tokenUsageBreakdown?.reasoningTokens, 120);
  assert.deepEqual(normalized.results[0].scoreComponents, { tests: 1, precision: 0.9 });
  assert.deepEqual(normalized.results[0].scoreReasons, ["all critical judges passed"]);
  assert.equal(runtimeEvidence(normalized.results[0], "model"), "confirmed");
  assert.deepEqual(assessResultEvidence(normalized, normalized.results[0]).reasons, [
    "easy-task",
    "single-sample"
  ]);
});

test("adhoc generated checks are marked as basic evidence and excluded from comparison", () => {
  const resolvedRuntime = {
    effectiveModel: "gpt-5.4",
    modelIdentitySource: "confirmed",
    source: "event-stream",
    verification: "confirmed",
  };
  const normalized = normalizeRun(run({
    task: {
      id: "adhoc-task-1",
      title: "Custom task",
      schemaVersion: "agentarena.taskpack/v1",
      metadata: { tags: ["adhoc", "custom"] },
    },
    fairComparison: {
      taskIdentity: "task:adhoc-task-1",
      judgeIdentity: "judge:generated",
      repoBaselineIdentity: "repo:one",
    },
    results: [
      result({ variantId: "a", resolvedRuntime }),
      result({ variantId: "b", resolvedRuntime }),
    ],
  }));

  const assessment = assessResultEvidence(normalized, normalized.results[0]);
  assert.equal(assessment.level, "limited");
  assert.ok(assessment.reasons.includes("basic-generated-checks"));
  assert.equal(assessment.comparable, false);
});

test("all-failed workbench outcome never awards a winner", () => {
  const normalized = normalizeRun(run({
    results: [
      result({ agentId: "a", variantId: "a", status: "failed", judgeResults: [] }),
      result({ agentId: "b", variantId: "b", status: "error", judgeResults: [] })
    ]
  }));
  const outcome = deriveRunOutcome(normalized);

  assert.equal(outcome.execution, "completed");
  assert.equal(outcome.evaluation, "fail");
  assert.equal(outcome.winner, null);
  assert.equal(outcome.qualifiedResults.length, 0);
});

test("mixed outcome ranks only successful evaluated agents", () => {
  const normalized = normalizeRun(run({
    results: [
      result({ agentId: "good", variantId: "good", compositeScore: 88 }),
      result({ agentId: "bad", variantId: "bad", status: "failed", compositeScore: 99 })
    ]
  }));
  const outcome = deriveRunOutcome(normalized);

  assert.equal(outcome.evaluation, "partial");
  assert.equal(outcome.winner?.variantId, "good");
  assert.deepEqual(outcome.qualifiedResults.map((item) => item.variantId), ["good"]);
});

test("unknown cost and missing trace are explicit instead of zero", () => {
  const normalized = normalizeRun(run({
    results: [result({ estimatedCostUsd: undefined, costKnown: false, tracePath: undefined })]
  }));
  const outcome = deriveRunOutcome(normalized);

  assert.equal(normalized.results[0].estimatedCostUsd, null);
  assert.equal(normalized.results[0].traceAvailability, "missing");
  assert.equal(outcome.trust.level, "degraded");
  assert.ok(outcome.trust.reasons.includes("cost-unknown"));
  assert.ok(outcome.trust.reasons.includes("trace-missing"));
});

test("estimated cost is explicit and does not become known billing", () => {
  const normalized = normalizeRun(run({ results: [result({ costKnown: false, costQuality: "estimated", estimatedCostUsd: 0.08 })] }));
  assert.equal(normalized.results[0].costQuality, "estimated");
  assert.equal(normalized.results[0].costKnown, false);
  assert.equal(normalized.results[0].estimatedCostUsd, 0.08);
  assert.ok(normalized.integrityReasons.includes("cost-estimated"));
});

test("run identity key binds run, agent and source", () => {
  const normalized = normalizeRun(run({ source: { kind: "imported", label: "folder import" } }));
  assert.equal(runIdentityKey(normalized, "demo-fast"), "run-001::demo-fast::imported");
});

test("normalizeRun preserves the repository source used by a task", () => {
  const normalized = normalizeRun(run({
    task: {
      id: "task-1",
      title: "Fix bug",
      schemaVersion: "agentarena.taskpack/v1",
      repoSource: "builtin://nodejs-app"
    }
  }));

  assert.equal(normalized.task.repoSource, "builtin://nodejs-app");
});

test("normalizeRun exposes the fair-comparison repository baseline when revision is absent", () => {
  const normalized = normalizeRun(run({
    repository: { path: "D:/repo" },
    fairComparison: {
      taskIdentity: "task:one",
      judgeIdentity: "judge:one",
      repoBaselineIdentity: "repo:baseline-one"
    }
  }));

  assert.equal(normalized.repository.revision, "repo:baseline-one");
});

test("workbench resolves builtin and user repository sources explicitly", () => {
  assert.deepEqual(resolveTaskRepositorySource({ repoSource: "builtin://nodejs-app" }, "D:/repo"), {
    kind: "builtin",
    value: "builtin://nodejs-app"
  });
  assert.deepEqual(resolveTaskRepositorySource({ repoSource: "user" }, "D:/repo"), {
    kind: "user",
    value: "D:/repo"
  });
  assert.deepEqual(resolveTaskRepositorySource({}, "D:/repo"), {
    kind: "user",
    value: "D:/repo"
  });
});

test("comparison excludes different task, revision and score mode", () => {
  const base = normalizeRun(run());
  const candidate = normalizeRun(run({
    runId: "run-002",
    repository: { path: "D:/repo", revision: "def456" },
    task: { id: "task-2", title: "Other task", schemaVersion: "agentarena.taskpack/v1" },
    scoreMode: "efficiency-first"
  }));

  assert.deepEqual(comparisonExclusionReasons(base, candidate), [
    "different-task",
    "different-revision",
    "different-score-mode"
  ]);
});

test("workbench comparison uses persisted fair-comparison metadata", () => {
  const identity = {
    taskIdentity: "task:a",
    judgeIdentity: "judge:a",
    repoBaselineIdentity: "repo:a"
  };
  const base = normalizeRun(run({ fairComparison: identity }));
  const same = normalizeRun(run({ runId: "run-002", fairComparison: { ...identity } }));
  const differentJudge = normalizeRun(run({
    runId: "run-003",
    fairComparison: { ...identity, judgeIdentity: "judge:b" }
  }));
  const differentRepo = normalizeRun(run({
    runId: "run-004",
    fairComparison: { ...identity, repoBaselineIdentity: "repo:b" }
  }));
  const legacy = normalizeRun(run({ runId: "run-005", fairComparison: undefined }));

  assert.deepEqual(base.fairComparison, identity);
  assert.deepEqual(comparisonExclusionReasons(base, same), []);
  assert.deepEqual(comparisonExclusionReasons(base, differentJudge), ["different-judge-logic"]);
  assert.deepEqual(comparisonExclusionReasons(base, differentRepo), ["different-repo-baseline"]);
  assert.deepEqual(comparisonExclusionReasons(base, legacy), []);
});

test("invalid imported payload is marked damaged without inventing results", () => {
  const normalized = normalizeRun({ runId: "broken", results: "not-an-array" });
  const outcome = deriveRunOutcome(normalized);

  assert.equal(normalized.integrity, "damaged");
  assert.deepEqual(normalized.results, []);
  assert.equal(outcome.evaluation, "incomplete");
  assert.equal(outcome.winner, null);
});

// ─── Trace domain (Phase 9) ───

function event(overrides = {}) {
  return {
    agentId: "demo-thorough",
    timestamp: "2026-07-15T08:00:01.000Z",
    type: "adapter.start",
    message: "Starting adapter",
    ...overrides
  };
}

test("categorizeEvent maps adapter/setup/judge/preflight prefixes", () => {
  assert.equal(categorizeEvent(event({ type: "setup.finish" })), "setup");
  assert.equal(categorizeEvent(event({ type: "teardown.cleanup" })), "teardown");
  assert.equal(categorizeEvent(event({ type: "judge.tests" })), "judge");
  assert.equal(categorizeEvent(event({ type: "adapter.tool_use" })), "agent");
  assert.equal(categorizeEvent(event({ type: "snapshot.write" })), "snapshot");
  assert.equal(categorizeEvent(event({ type: "preflight.result" })), "preflight");
  assert.equal(categorizeEvent(event({ type: "something.else" })), "other");
});

test("summarizeEvent prefixes type and truncates long messages", () => {
  assert.equal(summarizeEvent(event({ message: "hello world" })), "[adapter.start] hello world");
  assert.equal(summarizeEvent(event({ message: "x".repeat(300) })).length, "[adapter.start] ".length + 200);
  assert.equal(summarizeEvent(event({ message: undefined })), "[adapter.start]");
});

test("groupEventsIntoSteps splits on category change and time gap", () => {
  const steps = groupEventsIntoSteps([
    event({ timestamp: "2026-07-15T08:00:01.000Z", type: "adapter.start" }),
    event({ timestamp: "2026-07-15T08:00:01.050Z", type: "adapter.tool_use", message: "read" }),
    event({ timestamp: "2026-07-15T08:00:05.000Z", type: "judge.tests", message: "check" })
  ], 100);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].events.length, 2);
  assert.equal(steps[0].category, "agent");
  assert.equal(steps[1].category, "judge");
  assert.match(steps[0].summary, /\+1 more/);
});

test("buildTimeline computes metadata and error counts", () => {
  const timeline = buildTimeline([
    event({ timestamp: "2026-07-15T08:00:01.000Z", type: "adapter.start" }),
    event({ timestamp: "2026-07-15T08:00:02.000Z", type: "adapter.error", message: "boom", metadata: {} }),
    event({ timestamp: "2026-07-15T08:00:09.500Z", type: "judge.tests" })
  ]);
  assert.equal(timeline.metadata.totalEvents, 3);
  assert.equal(timeline.metadata.errorCount, 1);
  assert.equal(timeline.metadata.agentId, "demo-thorough");
  assert.equal(timeline.metadata.durationMs, 8500);
  assert.equal(timeline.metadata.eventTypes["adapter.start"], 1);
});

test("buildTimeline handles empty event list", () => {
  const timeline = buildTimeline([]);
  assert.equal(timeline.steps.length, 0);
  assert.equal(timeline.metadata.totalEvents, 0);
  assert.equal(timeline.metadata.agentId, "unknown");
});

test("safeCategoryClass rejects unsafe input", () => {
  assert.equal(safeCategoryClass("agent"), "agent");
  assert.equal(safeCategoryClass("bad<class"), "other");
});


test("normalizeRun reads persisted file diffs when present", () => {
  const normalized = normalizeRun(run({
    results: [result({
      changedFiles: ["src/a.ts", "src/b.ts"],
      fileDiffs: [
        { path: "src/a.ts", text: "--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new" },
        { path: "src/b.ts", hunks: ["@@ -1 +1 @@", "-x", "+y"] }
      ]
    })]
  }));
  const fileDiffs = normalized.results[0].fileDiffs;
  assert.equal(fileDiffs.length, 2);
  assert.equal(fileDiffs[0].path, "src/a.ts");
  assert.ok(fileDiffs[0].text.includes("+new"));
  assert.deepEqual(fileDiffs[1].hunks, ["@@ -1 +1 @@", "-x", "+y"]);
});

test("normalizeRun degrades to file list when no diffs stored", () => {
  const normalized = normalizeRun(run({ results: [result({ changedFiles: ["src/a.ts"] })] }));
  assert.equal(normalized.results[0].fileDiffs, undefined);
  assert.deepEqual(normalized.results[0].changedFiles, ["src/a.ts"]);
});


test("workbench telemetry deduplicates page opens and result views", () => {
  const tracker = createViewTelemetryDeduper();
  assert.equal(tracker.markAppOpened(), true);
  assert.equal(tracker.markAppOpened(), false);
  assert.equal(tracker.markResultViewed("run-a"), true);
  assert.equal(tracker.markResultViewed("run-a"), false);
  assert.equal(tracker.markResultViewed("run-b"), true);
});

test("trust and execution labels are localized without raw codes", () => {
  assert.equal(labelTrustReason("zh-CN", "legacy-artifact"), "结果使用兼容旧产物格式");
  assert.equal(labelTrustReason("en", "cost-estimated"), "Some costs are estimated");
  assert.equal(labelExecution("zh-CN", "completed"), "已完成");
  assert.equal(labelRunState("zh-CN", "cancelling"), "正在取消");
  assert.equal(labelPhase("en", "preflight"), "Preflight");
  assert.equal(isComingSoonAdapter("Windsurf (Codeium) - Coming Soon"), true);
  assert.equal(isComingSoonAdapter("Codex CLI"), false);
});

test("network failures map to user-facing offline copy", () => {
  const zh = toUserError(new TypeError("Failed to fetch"), "zh-CN");
  assert.match(zh.message, /本地服务不可用/);
  assert.equal(zh.detail, "Failed to fetch");
  assert.match(formatUserError(new Error("NetworkError when attempting to fetch resource."), "en"), /Local service is unavailable/);
});

test("repoPath cwd restriction maps to actionable user copy", () => {
  const zh = toUserError(new Error("repoPath must be within the current working directory."), "zh-CN");
  assert.match(zh.message, /工作目录/);
  const en = toUserError(new Error("repoPath must be within the current working directory."), "en");
  assert.match(en.message, /working directory/i);
});

test("normalizeScoreMode maps phantom Workbench modes to practical", () => {
  assert.equal(normalizeScoreMode("speed"), DEFAULT_SCORE_MODE);
  assert.equal(normalizeScoreMode("cost"), DEFAULT_SCORE_MODE);
  assert.equal(normalizeScoreMode("correctness"), DEFAULT_SCORE_MODE);
  assert.equal(normalizeScoreMode("practical"), "practical");
  assert.equal(normalizeScoreMode("efficiency-first"), "efficiency-first");
  assert.ok(SCORE_MODES.includes("balanced"));
});

test("normalizeRun and compare collapse dirty historical scoreMode labels", () => {
  const base = normalizeRun(run({ scoreMode: "speed" }));
  const peer = normalizeRun(run({ runId: "run-002", scoreMode: "practical" }));
  assert.equal(base.scoreMode, "practical");
  assert.deepEqual(comparisonExclusionReasons(base, peer), []);
});

test("getRunScoreMode falls back to practical for invalid modes", () => {
  assert.equal(getRunScoreMode({ scoreMode: "speed" }), "practical");
  assert.equal(getRunScoreMode({}), "practical");
  assert.equal(getRunScoreMode({ scoreMode: "balanced" }), "balanced");
});

test("workbench telemetry deduplicates evidence opens", () => {
  const tracker = createViewTelemetryDeduper();
  assert.equal(tracker.markEvidenceOpened("run-a"), true);
  assert.equal(tracker.markEvidenceOpened("run-a"), false);
  assert.equal(tracker.markEvidenceOpened("run-b"), true);
});

test("run status rejects stale snapshots without dropping timestamp-free progress", () => {
  const running = {
    state: "running",
    phase: "starting",
    logs: [{ message: "accepted" }],
    updatedAt: "2026-08-12T00:00:02.000Z"
  };
  const staleIdle = {
    state: "idle",
    phase: "idle",
    logs: [],
    updatedAt: "2026-08-12T00:00:01.000Z"
  };

  assert.equal(mergeFreshRunStatus(running, staleIdle), running);
  assert.deepEqual(mergeFreshRunStatus(running, { phase: "preflight" }), {
    ...running,
    phase: "preflight"
  });
  assert.deepEqual(mergeRunStatus(running, { snapshot: { finished: 1 } }).snapshot, { finished: 1 });
});
