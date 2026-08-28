import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStrictHarnessComparison,
  inspectPlannedHarnessComparison,
  inspectStrictHarnessSample
} from "../apps/web-report/workbench/src/domain/harness-comparison.ts";
import { normalizeRun } from "../apps/web-report/workbench/src/domain/run.ts";

function result(variantId, baseAgentId, score, overrides = {}) {
  return {
    agentId: baseAgentId,
    baseAgentId,
    variantId,
    displayLabel: baseAgentId === "codex" ? "Codex Profile" : "Claude Profile",
    status: "success",
    durationMs: baseAgentId === "codex" ? 1200 : 1500,
    tokenUsage: baseAgentId === "codex" ? 100 : 120,
    estimatedCostUsd: 0.02,
    costKnown: true,
    compositeScore: score,
    changedFiles: ["src/a.ts"],
    judgeResults: [{ judgeId: "tests", label: "Tests", type: "test-result", success: true }],
    tracePath: `agents/${variantId}/trace.jsonl`,
    ...overrides
  };
}

function variant(agentKind, overrides = {}) {
  const codex = agentKind === "codex";
  return {
    order: codex ? 0 : 1,
    variantId: codex ? "codex-profile" : "claude-profile",
    agentKind,
    profileId: codex ? "codex-profile" : "claude-profile",
    profileRevision: 1,
    secretRevision: 1,
    launchSpecHash: `launch:${agentKind}`,
    verificationReceiptId: `receipt:${agentKind}`,
    installationFingerprint: `installation:${agentKind}`,
    installationVersion: "1.0.0",
    harnessSnapshotId: `harness:${agentKind}`,
    providerKind: codex ? "openai-responses" : "anthropic-messages",
    requestedModel: codex ? "vendor-alias-a" : "vendor-alias-b",
    canonicalModelIdentity: "vendor/model-v1",
    modelIdentitySource: "declared",
    reasoningEffort: "high",
    providerPolicyIdentity: "provider-policy:shared",
    modelParametersIdentity: "model-parameters:shared",
    permissionMode: codex ? "workspace-write" : "dontAsk",
    fullPermissionBypass: false,
    riskFlags: [],
    harnessDrift: {
      status: "unchanged",
      checkedAt: "2026-08-12T00:02:00.000Z",
      postRunSnapshotId: `harness:${agentKind}`,
      summary: "Harness inputs remained unchanged."
    },
    ...overrides
  };
}

function manifest(overrides = {}) {
  return {
    schemaVersion: "agentarena.job-manifest/v1",
    runId: "run-001",
    status: "completed",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:02:00.000Z",
    startedAt: "2026-08-12T00:00:10.000Z",
    finishedAt: "2026-08-12T00:02:00.000Z",
    repositoryBaselineIdentity: "repo:shared",
    taskIdentity: "task:shared",
    judgeIdentity: "judge:shared",
    scoreMode: "practical",
    variants: [variant("codex"), variant("claude-code")],
    ...overrides
  };
}

function run(overrides = {}) {
  const jobManifest = overrides.jobManifest ?? manifest();
  return normalizeRun({
    runId: jobManifest.runId,
    createdAt: jobManifest.createdAt,
    repository: { path: "D:/repo", revision: "abc123" },
    task: { id: "task-1", title: "Fix bug", schemaVersion: "agentarena.taskpack/v1" },
    scoreMode: jobManifest.scoreMode,
    fairComparison: {
      taskIdentity: jobManifest.taskIdentity,
      judgeIdentity: jobManifest.judgeIdentity,
      repoBaselineIdentity: jobManifest.repositoryBaselineIdentity
    },
    results: [
      result("codex-profile", "codex", 91),
      result("claude-profile", "claude-code", 82)
    ],
    ...overrides,
    jobManifest
  });
}

test("strict sample accepts only same-model, different-Harness, unchanged Manifest variants", () => {
  const inspected = inspectStrictHarnessSample(run());
  assert.deepEqual(inspected.reasons, []);
  assert.ok(inspected.sample);
  assert.equal(inspected.sample.canonicalModelIdentity, "vendor/model-v1");
  assert.equal(inspected.sample.modelIdentityEvidence, "declared");
  assert.deepEqual(inspected.sample.results.map((entry) => entry.agentKind), ["codex", "claude-code"]);
  assert.equal(inspected.sample.decision.winnerAgentKind, "codex");
});

test("planned comparison requires matching model, Provider policy, and model parameters", () => {
  const base = {
    agentKind: "codex",
    canonicalModelIdentity: "vendor/model-v1",
    modelIdentitySource: "confirmed",
    providerPolicyIdentity: "provider-policy:shared",
    modelParametersIdentity: "model-parameters:shared"
  };
  const matching = {
    ...base,
    agentKind: "claude-code"
  };

  assert.deepEqual(inspectPlannedHarnessComparison([base, matching]), {
    eligible: true,
    modelIdentityEvidence: "confirmed",
    reasons: []
  });

  const declared = inspectPlannedHarnessComparison([
    { ...base, modelIdentitySource: "declared" },
    { ...matching, modelIdentitySource: "declared" }
  ]);
  assert.equal(declared.eligible, true);
  assert.equal(declared.modelIdentityEvidence, "declared");

  const policyDrift = inspectPlannedHarnessComparison([
    base,
    { ...matching, providerPolicyIdentity: "provider-policy:other" }
  ]);
  assert.equal(policyDrift.eligible, false);
  assert.ok(policyDrift.reasons.includes("different-provider-policy"));

  const parameterDrift = inspectPlannedHarnessComparison([
    base,
    { ...matching, modelParametersIdentity: "model-parameters:other" }
  ]);
  assert.equal(parameterDrift.eligible, false);
  assert.ok(parameterDrift.reasons.includes("different-model-parameters"));
});

test("strict sample rejects unknown identity, same Harness, policy drift, parameter drift, and Harness drift", () => {
  const cases = [
    ["unknown-model-identity", [variant("codex", { modelIdentitySource: "unknown" }), variant("claude-code")]],
    ["different-harness-required", [variant("codex"), variant("codex", { variantId: "codex-two", profileId: "codex-two" })]],
    ["different-provider-policy", [variant("codex"), variant("claude-code", { providerPolicyIdentity: "provider-policy:other" })]],
    ["different-model-parameters", [variant("codex"), variant("claude-code", { modelParametersIdentity: "model-parameters:other" })]],
    ["harness-drift", [variant("codex"), variant("claude-code", { harnessDrift: { status: "changed", checkedAt: "2026-08-12T00:02:00.000Z", summary: "changed" } })]]
  ];

  for (const [reason, variants] of cases) {
    const inspected = inspectStrictHarnessSample(run({ jobManifest: manifest({ variants }) }));
    assert.equal(inspected.sample, null, reason);
    assert.ok(inspected.reasons.includes(reason), `${reason}: ${inspected.reasons.join(",")}`);
  }
});

test("strict sample requires completed JobManifest evidence and both persisted results", () => {
  const noManifest = normalizeRun({ runId: "legacy", results: [] });
  assert.deepEqual(inspectStrictHarnessSample(noManifest).reasons, ["missing-job-manifest"]);

  const running = inspectStrictHarnessSample(run({ jobManifest: manifest({ status: "running" }) }));
  assert.ok(running.reasons.includes("manifest-not-completed"));

  const missingResult = inspectStrictHarnessSample(run({ results: [result("codex-profile", "codex", 91)] }));
  assert.ok(missingResult.reasons.includes("missing-result"));
});

test("strict comparison cohorts use Manifest task, repository, judge, score, model, Provider, and parameters", () => {
  const base = run();
  const same = run({ jobManifest: manifest({ runId: "run-002", createdAt: "2026-08-13T00:00:00.000Z" }) });
  const differentTask = run({ jobManifest: manifest({ runId: "run-task", taskIdentity: "task:other" }) });
  const differentRepo = run({ jobManifest: manifest({ runId: "run-repo", repositoryBaselineIdentity: "repo:other" }) });
  const differentJudge = run({ jobManifest: manifest({ runId: "run-judge", judgeIdentity: "judge:other" }) });
  const differentScore = run({ jobManifest: manifest({ runId: "run-score", scoreMode: "balanced" }) });
  const differentModel = run({ jobManifest: manifest({ runId: "run-model", variants: [variant("codex"), variant("claude-code", { canonicalModelIdentity: "vendor/model-v2", modelParametersIdentity: "model-parameters:v2" })] }) });

  const comparison = buildStrictHarnessComparison([base, same, differentTask, differentRepo, differentJudge, differentScore, differentModel], base.runId);
  assert.equal(comparison.samples.length, 2);
  assert.deepEqual(comparison.samples.map((sample) => sample.run.runId), ["run-001", "run-002"]);
  assert.ok(comparison.excluded.some((entry) => entry.run.runId === "run-task" && entry.reasons.includes("different-task")));
  assert.ok(comparison.excluded.some((entry) => entry.run.runId === "run-repo" && entry.reasons.includes("different-repo-baseline")));
  assert.ok(comparison.excluded.some((entry) => entry.run.runId === "run-judge" && entry.reasons.includes("different-judge-logic")));
  assert.ok(comparison.excluded.some((entry) => entry.run.runId === "run-score" && entry.reasons.includes("different-score-mode")));
  assert.ok(comparison.excluded.some((entry) => entry.run.runId === "run-model" && entry.reasons.includes("different-model")));
});

test("single sample is run-scoped; repeated identical winners can report consistency", () => {
  const single = buildStrictHarnessComparison([run()]);
  assert.equal(single.conclusion.scope, "single-run");
  assert.equal(single.conclusion.stability, "not-applicable");
  assert.equal(single.conclusion.winnerAgentKind, "codex");

  const repeated = buildStrictHarnessComparison([
    run(),
    run({ jobManifest: manifest({ runId: "run-002", createdAt: "2026-08-13T00:00:00.000Z" }) }),
    run({ jobManifest: manifest({ runId: "run-003", createdAt: "2026-08-14T00:00:00.000Z" }) })
  ]);
  assert.equal(repeated.conclusion.scope, "repeated-samples");
  assert.equal(repeated.conclusion.stability, "consistent");
  assert.equal(repeated.conclusion.winnerAgentKind, "codex");
  assert.equal(repeated.rows.find((row) => row.agentKind === "codex").wins, 3);

  const partlyTied = buildStrictHarnessComparison([
    run(),
    run({
      jobManifest: manifest({ runId: "run-tie", createdAt: "2026-08-13T00:00:00.000Z" }),
      results: [result("codex-profile", "codex", 80), result("claude-profile", "claude-code", 80)]
    })
  ]);
  assert.equal(partlyTied.conclusion.stability, "inconclusive");
});

test("failed Harness never beats a successful Harness and tied evidence stays undecided", () => {
  const oneFailure = run({
    results: [
      result("codex-profile", "codex", 99, { status: "failed", scoreExcluded: true }),
      result("claude-profile", "claude-code", 70)
    ]
  });
  assert.equal(inspectStrictHarnessSample(oneFailure).sample.decision.winnerAgentKind, "claude-code");

  const tie = run({
    results: [result("codex-profile", "codex", 80), result("claude-profile", "claude-code", 80)]
  });
  const comparison = buildStrictHarnessComparison([tie]);
  assert.equal(comparison.conclusion.winnerAgentKind, null);
  assert.equal(comparison.conclusion.decision, "tie");
});
