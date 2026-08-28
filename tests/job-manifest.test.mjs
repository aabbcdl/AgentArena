import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveRuntimeLaunchSpec } from "../packages/adapters/dist/index.js";
import {
  createAgentSelection,
  HARNESS_SNAPSHOT_SCHEMA_V1,
  INSTALLATION_SCHEMA_V1,
  RUNTIME_PROFILE_SCHEMA_V1,
  VERIFICATION_RECEIPT_SCHEMA_V1
} from "../packages/core/dist/index.js";
import {
  createJobManifest,
  markJobManifestInterrupted,
  readJobManifest,
  repositoryIdentity,
  runBenchmark,
  updateJobManifestHarnessDrift,
  updateJobManifestStatus,
  writeJobManifest
} from "../packages/runner/dist/index.js";
import { prepareWorkspace } from "../packages/runner/dist/workspace-prep.js";

const NOW = "2026-08-12T00:00:00.000Z";

function createFrozenRuntime(scriptPath, repositoryBaselineIdentity) {
  const profile = {
    schemaVersion: RUNTIME_PROFILE_SCHEMA_V1,
    id: "codex-job-manifest",
    name: "Codex Job Manifest",
    agentKind: "codex",
    mode: "managed-provider",
    revision: 3,
    secretRevision: 5,
    commandPath: scriptPath,
    provider: {
      baseUrl: "https://provider.example.test/v1",
      protocol: "openai-responses",
      requestedModel: "gpt-job-manifest",
      canonicalModelIdentity: "provider/gpt-job-manifest",
      modelIdentitySource: "declared",
      reasoningEffort: "high",
      secretRef: "runtime-profile/codex/codex-job-manifest"
    },
    extraEnv: {},
    riskFlags: ["third-party-provider"],
    createdAt: NOW,
    updatedAt: NOW
  };
  const installation = {
    schemaVersion: INSTALLATION_SCHEMA_V1,
    id: "codex-installation-job-manifest",
    agentKind: "codex",
    executable: process.execPath,
    argsPrefix: [scriptPath],
    displayCommand: `${process.execPath} ${scriptPath}`,
    source: "explicit",
    version: "0.145.0",
    capabilities: { configOverrides: true, workspaceWrite: true },
    fingerprint: "installation:job-manifest",
    discoveredAt: NOW
  };
  const harnessSnapshot = {
    schemaVersion: HARNESS_SNAPSHOT_SCHEMA_V1,
    snapshotId: "harness-snapshot:job-manifest",
    agentKind: "codex",
    installationFingerprint: installation.fingerprint,
    hostEnvironmentSnapshotId: "host-environment:job-manifest",
    repositoryBaselineIdentity,
    entries: [],
    riskFlags: ["inherits-user-harness"],
    createdAt: NOW
  };
  const launchSpec = resolveRuntimeLaunchSpec({
    profile,
    installation,
    harnessSnapshot,
    repositoryBaselineIdentity,
    specId: "launch-job-manifest",
    now: () => NOW,
    timeouts: { startupMs: 5_000, idleMs: 5_000, totalMs: 15_000 }
  });
  const receipt = {
    schemaVersion: VERIFICATION_RECEIPT_SCHEMA_V1,
    receiptId: "verification-job-manifest",
    createdAt: NOW,
    launchSpecHash: launchSpec.launchSpecHash,
    profileId: profile.id,
    profileRevision: profile.revision,
    secretRevision: profile.secretRevision,
    installationFingerprint: installation.fingerprint,
    harnessSnapshotId: harnessSnapshot.snapshotId,
    repositoryBaselineIdentity,
    readiness: "task-ready",
    stages: [
      { stage: "installation", status: "passed", startedAt: NOW, durationMs: 1, summary: "installed" },
      { stage: "conversation", status: "passed", startedAt: NOW, durationMs: 1, summary: "conversation" },
      { stage: "task", status: "passed", startedAt: NOW, durationMs: 1, summary: "task" }
    ]
  };
  return { launchSpec, receipt, harnessSnapshot };
}

async function createFakeCodex(root) {
  const scriptPath = path.join(root, "job-manifest-codex.mjs");
  await fs.writeFile(
    scriptPath,
    [
      'import fs from "node:fs";',
      'const args = process.argv.slice(2);',
      'if (process.env.AGENTARENA_CODEX_PROVIDER_KEY !== "job-manifest-secret") {',
      '  console.error("task-scoped secret missing"); process.exit(9);',
      '}',
      'let prompt = "";',
      'for await (const chunk of process.stdin) prompt += chunk;',
      'fs.writeFileSync("done.txt", "done\\n", "utf8");',
      'const outputIndex = args.indexOf("--output-last-message");',
      'if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], "completed job-manifest-secret", "utf8");',
      'console.error("provider diagnostic token=job-manifest-secret");',
      'console.log(JSON.stringify({ type: "thread.started", thread_id: "job-manifest-secret" }));',
      'console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 3, output_tokens: 2 } }));'
    ].join("\n"),
    "utf8"
  );
  return scriptPath;
}

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-job-manifest-"));
  const repoPath = path.join(root, "repo");
  const outputPath = path.join(root, "output");
  const taskPath = path.join(root, "task.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.writeFile(path.join(repoPath, "README.md"), "job manifest fixture\n", "utf8");
  await fs.writeFile(
    taskPath,
    JSON.stringify({
      schemaVersion: "agentarena.taskpack/v1",
      id: "job-manifest-task",
      title: "Job Manifest Task",
      prompt: "Create done.txt containing done followed by one newline.",
      judges: [{
        id: "done-file",
        type: "command",
        label: "done file exists",
        command: "node -e \"const fs=require('node:fs');process.exit(fs.readFileSync('done.txt','utf8')==='done\\n'?0:1)\""
      }]
    }),
    "utf8"
  );
  return { root, repoPath, outputPath, taskPath, scriptPath: await createFakeCodex(root) };
}

test("JobManifest persists only redacted runtime identity and supports terminal transitions", async () => {
  const fixture = await createFixture();
  try {
    const baseline = repositoryIdentity(fixture.repoPath);
    const { launchSpec, receipt, harnessSnapshot } = createFrozenRuntime(fixture.scriptPath, baseline);
    const selection = createAgentSelection({
      baseAgentId: "codex",
      displayLabel: "Codex Frozen",
      runtimeProfileId: launchSpec.profile.id,
      launchSpecHash: launchSpec.launchSpecHash,
      verificationReceiptId: receipt.receiptId
    });
    const manifest = createJobManifest({
      runId: "job-manifest-unit",
      status: "running",
      repositoryBaselineIdentity: baseline,
      taskIdentity: "task:unit",
      judgeIdentity: "judge:unit",
      scoreMode: "practical",
      selections: [selection],
      runtimeBindings: {
        [selection.variantId]: {
          launchSpec,
          verificationReceipt: receipt,
          runtimeSecretValues: {
            "runtime-profile/codex/codex-job-manifest": "job-manifest-secret"
          },
          harnessRiskFlags: harnessSnapshot.riskFlags,
          hostEnvironment: { ...process.env }
        }
      },
      now: () => NOW
    });
    await fs.mkdir(fixture.outputPath, { recursive: true });
    await writeJobManifest(fixture.outputPath, manifest);

    const serialized = await fs.readFile(path.join(fixture.outputPath, "job-manifest.json"), "utf8");
    assert.doesNotMatch(serialized, /job-manifest-secret|secretRef|runtimeSecretValues|hostEnvironment/);
    assert.match(serialized, new RegExp(launchSpec.launchSpecHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(manifest.variants[0].providerPolicyIdentity, launchSpec.runtime.providerPolicyIdentity);
    assert.equal(manifest.variants[0].modelParametersIdentity, launchSpec.runtime.modelParametersIdentity);
    assert.equal((await readJobManifest(fixture.outputPath)).status, "running");

    const completed = await updateJobManifestStatus(fixture.outputPath, "completed", () => "2026-08-12T00:01:00.000Z");
    assert.equal(completed.status, "completed");
    assert.equal(completed.finishedAt, "2026-08-12T00:01:00.000Z");

    const drifted = await updateJobManifestHarnessDrift(fixture.outputPath, [{
      variantId: selection.variantId,
      evidence: {
        status: "changed",
        checkedAt: "2026-08-12T00:02:00.000Z",
        postRunSnapshotId: "harness-snapshot:changed",
        summary: "Harness changed."
      }
    }]);
    assert.equal(drifted.variants[0].harnessDrift.status, "changed");
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("runBenchmark writes a running Manifest before the first frozen Agent starts", async () => {
  const fixture = await createFixture();
  const previousEval = process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES;
  process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES = "1";
  try {
    const baseline = repositoryIdentity(fixture.repoPath);
    const { launchSpec, receipt, harnessSnapshot } = createFrozenRuntime(fixture.scriptPath, baseline);
    const selection = createAgentSelection({
      baseAgentId: "codex",
      displayLabel: "Codex Frozen",
      runtimeProfileId: launchSpec.profile.id,
      launchSpecHash: launchSpec.launchSpecHash,
      verificationReceiptId: receipt.receiptId
    });
    const runtimeBindings = {
      [selection.variantId]: {
        launchSpec,
        verificationReceipt: receipt,
        runtimeSecretValues: {
          "runtime-profile/codex/codex-job-manifest": "job-manifest-secret"
        },
        harnessRiskFlags: harnessSnapshot.riskFlags,
        hostEnvironment: { ...process.env }
      }
    };
    let manifestAtAgentStart;
    const benchmark = await runBenchmark({
      runId: "job-manifest-integration",
      repoPath: fixture.repoPath,
      taskPath: fixture.taskPath,
      agentIds: ["codex"],
      agents: [selection],
      runtimeBindings,
      outputPath: fixture.outputPath,
      maxConcurrency: 1,
      onProgress: async (event) => {
        if (event.phase === "agent-start") {
          manifestAtAgentStart = await readJobManifest(
            path.join(fixture.outputPath, "job-manifest-integration")
          );
        }
      }
    });

    assert.equal(manifestAtAgentStart?.status, "running");
    assert.equal(benchmark.results[0].status, "success");
    assert.equal(benchmark.jobManifest?.status, "completed");
    assert.equal((await readJobManifest(benchmark.outputPath)).status, "completed");
    assert.equal(benchmark.jobManifest?.variants[0].launchSpecHash, launchSpec.launchSpecHash);
    assert.equal(benchmark.jobManifest?.variants[0].harnessDrift?.status, "check-failed");
    const resultArtifact = JSON.parse(await fs.readFile(
      path.join(benchmark.outputPath, "agents", selection.variantId, "result.json"),
      "utf8"
    ));
    assert.equal(resultArtifact.preflight.runtimeProfileId, launchSpec.profile.id);
    assert.equal(resultArtifact.preflight.launchSpecHash, launchSpec.launchSpecHash);
    assert.equal(resultArtifact.preflight.verificationReceiptId, receipt.receiptId);
    assert.doesNotMatch(JSON.stringify(resultArtifact), /job-manifest-secret/);
    assert.match(resultArtifact.summary, /\[redacted\]/);
    const trace = await fs.readFile(path.join(benchmark.outputPath, "agents", selection.variantId, "trace.jsonl"), "utf8");
    assert.doesNotMatch(trace, /job-manifest-secret/);
    const traceEvents = trace.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(traceEvents.some((event) => event.metadata?.launchSpecHash === resultArtifact.preflight.launchSpecHash));
  } finally {
    if (previousEval === undefined) delete process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES;
    else process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES = previousEval;
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("runBenchmark rejects a frozen launch without an exact Task-ready Receipt", async () => {
  const fixture = await createFixture();
  try {
    const baseline = repositoryIdentity(fixture.repoPath);
    const { launchSpec, receipt, harnessSnapshot } = createFrozenRuntime(fixture.scriptPath, baseline);
    const selection = createAgentSelection({
      baseAgentId: "codex",
      runtimeProfileId: launchSpec.profile.id,
      launchSpecHash: launchSpec.launchSpecHash,
      verificationReceiptId: receipt.receiptId
    });
    await assert.rejects(
      runBenchmark({
        runId: "job-manifest-rejected",
        repoPath: fixture.repoPath,
        taskPath: fixture.taskPath,
        agentIds: ["codex"],
        agents: [selection],
        outputPath: fixture.outputPath,
        runtimeBindings: {
          [selection.variantId]: {
            launchSpec,
            verificationReceipt: { ...receipt, readiness: "installed" },
            runtimeSecretValues: {},
            harnessRiskFlags: harnessSnapshot.riskFlags,
            hostEnvironment: { ...process.env }
          }
        }
      }),
      /Task-ready|verification receipt/i
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("runBenchmark cleans its temporary workspace when frozen admission fails after preparation", async () => {
  const fixture = await createFixture();
  const runId = `job-manifest-admission-cleanup-${process.pid}-${Date.now()}`;
  const prefix = `agentarena-workspaces-${runId}-`;
  const matchingWorkspaces = async () => (await fs.readdir(os.tmpdir()))
    .filter((entry) => entry.startsWith(prefix))
    .sort();
  try {
    const before = await matchingWorkspaces();
    const selection = createAgentSelection({
      baseAgentId: "codex",
      runtimeProfileId: "missing-profile",
      launchSpecHash: "launch-spec:missing",
      verificationReceiptId: "verification-missing"
    });
    await assert.rejects(
      runBenchmark({
        runId,
        repoPath: fixture.repoPath,
        taskPath: fixture.taskPath,
        agentIds: ["codex"],
        agents: [selection],
        runtimeBindings: {},
        outputPath: fixture.outputPath
      }),
      /no frozen runtime binding/i
    );
    assert.deepEqual(await matchingWorkspaces(), before);
  } finally {
    for (const entry of await matchingWorkspaces()) {
      await fs.rm(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("prepareWorkspace cleans its temporary root when output initialization fails", async () => {
  const fixture = await createFixture();
  const runId = `job-manifest-prep-cleanup-${process.pid}-${Date.now()}`;
  const prefix = `agentarena-workspaces-${runId}-`;
  const outputBlocker = path.join(fixture.root, "output-blocker");
  const matchingWorkspaces = async () => (await fs.readdir(os.tmpdir()))
    .filter((entry) => entry.startsWith(prefix))
    .sort();
  try {
    await fs.writeFile(outputBlocker, "not a directory\n", "utf8");
    const before = await matchingWorkspaces();
    await assert.rejects(
      prepareWorkspace({
        runId,
        repoPath: fixture.repoPath,
        outputPath: path.join(outputBlocker, "runs")
      })
    );
    assert.deepEqual(await matchingWorkspaces(), before);
  } finally {
    for (const entry of await matchingWorkspaces()) {
      await fs.rm(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("service recovery marks a running JobManifest as interrupted", async () => {
  const fixture = await createFixture();
  try {
    const outputPath = path.join(fixture.outputPath, "interrupted-run");
    await fs.mkdir(outputPath, { recursive: true });
    const baseline = repositoryIdentity(fixture.repoPath);
    const { launchSpec, receipt, harnessSnapshot } = createFrozenRuntime(fixture.scriptPath, baseline);
    const selection = createAgentSelection({
      baseAgentId: "codex",
      runtimeProfileId: launchSpec.profile.id,
      launchSpecHash: launchSpec.launchSpecHash,
      verificationReceiptId: receipt.receiptId
    });
    await writeJobManifest(outputPath, createJobManifest({
      runId: "interrupted-run",
      status: "running",
      repositoryBaselineIdentity: baseline,
      taskIdentity: "task:interrupted",
      judgeIdentity: "judge:interrupted",
      scoreMode: "practical",
      selections: [selection],
      runtimeBindings: {
        [selection.variantId]: {
          launchSpec,
          verificationReceipt: receipt,
          runtimeSecretValues: {
            "runtime-profile/codex/codex-job-manifest": "must-not-persist"
          },
          harnessRiskFlags: harnessSnapshot.riskFlags,
          hostEnvironment: {}
        }
      },
      now: () => NOW
    }));

    const interrupted = await markJobManifestInterrupted(outputPath, () => "2026-08-12T00:02:00.000Z");
    assert.equal(interrupted?.status, "interrupted");
    assert.equal((await readJobManifest(outputPath)).status, "interrupted");
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
