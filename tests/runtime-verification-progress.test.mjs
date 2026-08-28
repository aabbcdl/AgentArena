import assert from "node:assert/strict";
import test from "node:test";
import {
  __runtimeVerificationProgressTestUtils,
  completeRuntimeVerificationProgress,
  getRuntimeVerificationProgress,
  markRuntimeVerificationStageComplete,
  markRuntimeVerificationStageStarted,
  startRuntimeVerificationProgress
} from "../packages/cli/dist/commands/runtime-verification-progress.js";

const startedAt = new Date().toISOString();

test("runtime verification progress tracks the current stage without exposing secrets", () => {
  __runtimeVerificationProgressTestUtils.clear();
  startRuntimeVerificationProgress("codex-local", "progress-123", startedAt);

  let progress = getRuntimeVerificationProgress("codex-local", "progress-123");
  assert.equal(progress?.state, "running");
  assert.deepEqual(progress?.stages.map((stage) => stage.status), ["pending", "pending", "pending"]);

  markRuntimeVerificationStageStarted("codex-local", "progress-123", "installation", startedAt);
  progress = getRuntimeVerificationProgress("codex-local", "progress-123");
  assert.equal(progress?.currentStage, "installation");
  assert.equal(progress?.stages[0].status, "running");

  markRuntimeVerificationStageComplete("codex-local", "progress-123", {
    stage: "installation",
    status: "passed",
    startedAt,
    durationMs: 12,
    summary: "CLI installation and version match the frozen launch."
  });
  progress = getRuntimeVerificationProgress("codex-local", "progress-123");
  assert.equal(progress?.stages[0].status, "passed");

  completeRuntimeVerificationProgress("codex-local", "progress-123", {
    schemaVersion: "agentarena.verification-receipt/v1",
    receiptId: "verification-progress",
    createdAt: startedAt,
    launchSpecHash: "launch-hash",
    profileId: "codex-local",
    profileRevision: 1,
    secretRevision: 1,
    installationFingerprint: "installation-fingerprint",
    harnessSnapshotId: "harness-snapshot",
    repositoryBaselineIdentity: "repository-baseline",
    readiness: "task-ready",
    stages: [
      { stage: "installation", status: "passed", startedAt, durationMs: 12, summary: "Installed." },
      { stage: "conversation", status: "passed", startedAt, durationMs: 20, summary: "Conversation passed." },
      { stage: "task", status: "passed", startedAt, durationMs: 30, summary: "Task passed." }
    ]
  });
  progress = getRuntimeVerificationProgress("codex-local", "progress-123");
  assert.equal(progress?.state, "completed");
  assert.equal(progress?.readiness, "task-ready");
  assert.doesNotMatch(JSON.stringify(progress), /secret|token|api[_-]?key/i);
  __runtimeVerificationProgressTestUtils.clear();
});
