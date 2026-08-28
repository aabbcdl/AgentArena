import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveVerificationReceipt } from "../packages/adapters/dist/index.js";
import {
  handleRuntimeProfileCreate,
  handleRuntimeProfileDelete,
  handleRuntimeProfileSecret,
  handleRuntimeProfilesGet,
  handleRuntimeProfileUpdate,
  handleRuntimeProfileVerify,
  handleRuntimeProfileVerifyProgress
} from "../packages/cli/dist/commands/api-routes.js";
import { prepareUiRuntimeAdmission } from "../packages/cli/dist/commands/ui-runtime-admission.js";
import {
  createAgentSelection,
  VERIFICATION_RECEIPT_SCHEMA_V1
} from "../packages/core/dist/index.js";

async function createFakeCodex(root) {
  const scriptPath = path.join(root, "runtime-api-codex.mjs");
  await fs.writeFile(
    scriptPath,
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'const args = process.argv.slice(2);',
      'if (args.includes("--version")) { console.log("codex-cli 0.145.0"); process.exit(0); }',
      'if (args.includes("--help")) { console.log("--config --sandbox workspace-write --json --output-last-message"); process.exit(0); }',
      'let prompt = "";',
      'for await (const chunk of process.stdin) prompt += chunk;',
      'const isTask = prompt.includes("agentarena-runtime-probe.txt");',
      'const conversation = prompt.match(/agentarena-conversation:([a-z0-9-]+)/);',
      'const task = prompt.match(/agentarena-ready:([a-z0-9-]+)/);',
      'let result;',
      'if (isTask && task) {',
      '  fs.writeFileSync(path.join(process.cwd(), "agentarena-runtime-probe.txt"), "agentarena-ready:" + task[1] + "\\n", "utf8");',
      '  result = JSON.stringify({ agentarena_task_probe: task[1] });',
      '} else {',
      '  result = JSON.stringify({ agentarena_probe: conversation?.[1] ?? "missing" });',
      '}',
      'const outputIndex = args.indexOf("--output-last-message");',
      'if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], result, "utf8");',
      'console.log(JSON.stringify({ type: "thread.started", thread_id: "runtime-api" }));',
      'console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));'
    ].join("\n"),
    "utf8"
  );
  return scriptPath;
}

async function withRuntimeApiFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-runtime-api-"));
  const repositoryPath = path.join(root, "repository");
  const environmentNames = [
    "AGENTARENA_RUNTIME_PROFILE_ROOT",
    "AGENTARENA_RUNTIME_PROFILES_FILE",
    "AGENTARENA_RUNTIME_SECRET_BACKEND",
    "AGENTARENA_VERIFICATION_ROOT",
    "AGENTARENA_SKIP_DNS_CHECK",
    "HOME",
    "USERPROFILE"
  ];
  const previous = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  process.env.AGENTARENA_RUNTIME_PROFILE_ROOT = root;
  process.env.AGENTARENA_RUNTIME_PROFILES_FILE = path.join(root, "runtime-profiles.json");
  process.env.AGENTARENA_RUNTIME_SECRET_BACKEND = "file";
  process.env.AGENTARENA_VERIFICATION_ROOT = path.join(root, "verification");
  process.env.AGENTARENA_SKIP_DNS_CHECK = "1";
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  await fs.mkdir(repositoryPath, { recursive: true });
  await fs.writeFile(path.join(repositoryPath, "README.md"), "runtime API fixture\n", "utf8");
  try {
    await run({
      root,
      repositoryPath,
      commandPath: await createFakeCodex(root)
    });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

function profilePayload(commandPath) {
  return {
    id: "codex-api-profile",
    name: "Codex API Profile",
    agentKind: "codex",
    mode: "managed-provider",
    commandPath,
    provider: {
      baseUrl: "https://provider.example.test/v1",
      protocol: "openai-responses",
      requestedModel: "gpt-api",
      canonicalModelIdentity: "provider/gpt-api",
      modelIdentitySource: "declared"
    },
    extraEnv: { PROVIDER_REGION: "test-region" },
    riskFlags: ["third-party-provider"],
    secret: "runtime-api-secret",
    _confirmBaseUrlRisk: true
  };
}

test("runtime profile API supports Codex CRUD without returning secrets", async () => {
  await withRuntimeApiFixture(async ({ root, commandPath }) => {
    const created = await handleRuntimeProfileCreate(JSON.stringify(profilePayload(commandPath)));
    assert.equal(created.statusCode, 200);
    assert.doesNotMatch(created.body, /runtime-api-secret|secretRef|test-region/);
    let body = JSON.parse(created.body);
    assert.equal(body.profile.id, "codex-api-profile");
    assert.equal(body.profile.secretStored, true);
    assert.deepEqual(body.profile.extraEnvKeys, ["PROVIDER_REGION"]);

    const listed = await handleRuntimeProfilesGet();
    assert.equal(listed.statusCode, 200);
    assert.doesNotMatch(listed.body, /runtime-api-secret|secretRef|test-region/);
    body = JSON.parse(listed.body);
    assert.deepEqual(
      body.profiles.filter((profile) => profile.isBuiltIn).map((profile) => profile.id).sort(),
      ["claude-local", "codex-local"]
    );

    const updatedPayload = profilePayload(commandPath);
    updatedPayload.name = "Codex API Updated";
    delete updatedPayload.secret;
    const updated = await handleRuntimeProfileUpdate(
      "codex-api-profile",
      JSON.stringify(updatedPayload)
    );
    assert.equal(updated.statusCode, 200);
    body = JSON.parse(updated.body);
    assert.equal(body.profile.name, "Codex API Updated");
    assert.equal(body.profile.revision, 2);
    assert.equal(body.profile.secretRevision, 2);

    const secret = await handleRuntimeProfileSecret(
      "codex-api-profile",
      JSON.stringify({ secret: "runtime-api-secret-two" })
    );
    assert.equal(secret.statusCode, 200);
    assert.doesNotMatch(secret.body, /runtime-api-secret/);
    assert.equal(JSON.parse(secret.body).profile.secretRevision, 3);

    const persisted = await fs.readFile(path.join(root, "runtime-profiles.json"), "utf8");
    assert.doesNotMatch(persisted, /runtime-api-secret/);
    assert.match(persisted, /test-region/);

    const deleted = await handleRuntimeProfileDelete("codex-api-profile");
    assert.equal(deleted.statusCode, 200);
    assert.equal(JSON.parse(deleted.body).profiles.some((profile) => profile.id === "codex-api-profile"), false);
  });
});

test("runtime verification API persists a Task-ready receipt for the exact public LaunchSpec", async () => {
  await withRuntimeApiFixture(async ({ root, repositoryPath, commandPath }) => {
    const created = await handleRuntimeProfileCreate(JSON.stringify(profilePayload(commandPath)));
    assert.equal(created.statusCode, 200);

    const verified = await handleRuntimeProfileVerify(
      "codex-api-profile",
      JSON.stringify({ repositoryPath }),
      root
    );
    assert.equal(verified.statusCode, 200);
    assert.doesNotMatch(verified.body, /runtime-api-secret|secretRef/);
    const body = JSON.parse(verified.body);
    assert.equal(body.receipt.readiness, "task-ready");
    assert.equal(body.receipt.launchSpecHash, body.launchSpec.launchSpecHash);
    assert.deepEqual(body.receipt.stages.map((stage) => stage.status), ["passed", "passed", "passed"]);
    assert.equal(body.harness.snapshotId, body.launchSpec.harnessSnapshotId);

    const persisted = await fs.readFile(
      path.join(root, "verification", "verification-receipts.json"),
      "utf8"
    );
    assert.match(persisted, new RegExp(body.receipt.receiptId));
    assert.doesNotMatch(persisted, /runtime-api-secret|secretRef/);
  });
});

test("runtime verification API exposes live stage progress while the request is running", async () => {
  await withRuntimeApiFixture(async ({ root, repositoryPath, commandPath }) => {
    assert.equal(
      (await handleRuntimeProfileCreate(JSON.stringify(profilePayload(commandPath)))).statusCode,
      200
    );
    const progressId = "progress-api-123";
    const verification = handleRuntimeProfileVerify(
      "codex-api-profile",
      JSON.stringify({ repositoryPath, progressId }),
      root
    );
    let progress;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await handleRuntimeProfileVerifyProgress("codex-api-profile", progressId);
      if (response.statusCode === 200) {
        const nextProgress = JSON.parse(response.body);
        if (nextProgress.stages.some((stage) => stage.status === "running" || stage.status === "passed")) {
          progress = nextProgress;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(progress?.state, "running");
    assert.ok(progress?.stages.some((stage) => stage.status === "running" || stage.status === "passed"));

    const verified = await verification;
    assert.equal(verified.statusCode, 200);
    const finalProgress = await handleRuntimeProfileVerifyProgress("codex-api-profile", progressId);
    assert.equal(finalProgress.statusCode, 200);
    assert.equal(JSON.parse(finalProgress.body).state, "completed");
  });
});

test("runtime profile readiness projection reuses evidence without running model probes", async () => {
  await withRuntimeApiFixture(async ({ root, repositoryPath, commandPath }) => {
    assert.equal(
      (await handleRuntimeProfileCreate(JSON.stringify(profilePayload(commandPath)))).statusCode,
      200
    );

    const beforeVerification = await handleRuntimeProfilesGet(
      new URLSearchParams({ repositoryPath }),
      root
    );
    assert.equal(beforeVerification.statusCode, 200);
    assert.doesNotMatch(beforeVerification.body, /runtime-api-secret|secretRef|test-region/);
    let body = JSON.parse(beforeVerification.body);
    let projected = body.readiness.find((entry) => entry.profile.id === "codex-api-profile");
    assert.equal(projected.readiness, "installed");
    assert.equal(projected.receiptMatch, false);
    assert.deepEqual(projected.stages.map((stage) => stage.status), ["passed", "skipped", "skipped"]);
    await assert.rejects(
      fs.readFile(path.join(root, "verification", "verification-receipts.json"), "utf8"),
      /ENOENT/
    );

    assert.equal(
      (await handleRuntimeProfileVerify(
        "codex-api-profile",
        JSON.stringify({ repositoryPath }),
        root
      )).statusCode,
      200
    );
    const ready = await handleRuntimeProfilesGet(
      new URLSearchParams({ repositoryPath }),
      root
    );
    body = JSON.parse(ready.body);
    projected = body.readiness.find((entry) => entry.profile.id === "codex-api-profile");
    assert.equal(projected.readiness, "task-ready");
    assert.equal(projected.receiptMatch, true);

    await fs.writeFile(path.join(repositoryPath, "README.md"), "repository drift\n", "utf8");
    const changed = await handleRuntimeProfilesGet(
      new URLSearchParams({ repositoryPath }),
      root
    );
    projected = JSON.parse(changed.body).readiness.find(
      (entry) => entry.profile.id === "codex-api-profile"
    );
    assert.equal(projected.readiness, "changed");
    assert.equal(projected.failure.errorCategory, "harness-config-drift");
  });
});

test("runtime readiness projects the direct cause from a matching failed Receipt", async () => {
  await withRuntimeApiFixture(async ({ root, repositoryPath, commandPath }) => {
    assert.equal(
      (await handleRuntimeProfileCreate(JSON.stringify(profilePayload(commandPath)))).statusCode,
      200
    );
    const initial = JSON.parse((await handleRuntimeProfilesGet(
      new URLSearchParams({ repositoryPath }),
      root
    )).body);
    const projected = initial.readiness.find((entry) => entry.profile.id === "codex-api-profile");
    const spec = projected.launchSpec;
    await saveVerificationReceipt({
      schemaVersion: VERIFICATION_RECEIPT_SCHEMA_V1,
      receiptId: "failed-receipt",
      createdAt: "2026-08-13T00:00:00.000Z",
      launchSpecHash: spec.launchSpecHash,
      profileId: spec.profile.id,
      profileRevision: spec.profile.revision,
      secretRevision: spec.profile.secretRevision,
      installationFingerprint: spec.installation.fingerprint,
      harnessSnapshotId: spec.harnessSnapshotId,
      repositoryBaselineIdentity: spec.repositoryBaselineIdentity,
      readiness: "blocked",
      stages: [
        { stage: "installation", status: "passed", startedAt: "2026-08-13T00:00:00.000Z", durationMs: 1, summary: "Installed." },
        { stage: "conversation", status: "failed", startedAt: "2026-08-13T00:00:01.000Z", durationMs: 2, errorCategory: "provider-overloaded", summary: "API Error: 503 No available accounts" },
        { stage: "task", status: "skipped", startedAt: "2026-08-13T00:00:03.000Z", durationMs: 0, summary: "Skipped." }
      ]
    });

    const response = await handleRuntimeProfilesGet(
      new URLSearchParams({ repositoryPath }),
      root
    );
    const failed = JSON.parse(response.body).readiness.find(
      (entry) => entry.profile.id === "codex-api-profile"
    );
    assert.equal(failed.readiness, "blocked");
    assert.equal(failed.receiptMatch, true);
    assert.deepEqual(failed.failure, {
      errorCategory: "provider-overloaded",
      summary: "API Error: 503 No available accounts"
    });
  });
});

test("runtime verification API rejects repositories outside its workspace root", async () => {
  await withRuntimeApiFixture(async ({ root, repositoryPath, commandPath }) => {
    const created = await handleRuntimeProfileCreate(JSON.stringify(profilePayload(commandPath)));
    assert.equal(created.statusCode, 200);
    const rejected = await handleRuntimeProfileVerify(
      "codex-api-profile",
      JSON.stringify({ repositoryPath }),
      path.join(root, "different-root")
    );
    assert.equal(rejected.statusCode, 400);
    assert.match(JSON.parse(rejected.body).error, /workspace|repository/i);
  });
});

test("UI runtime admission re-resolves an exact Task-ready Receipt and rejects Profile drift", async () => {
  await withRuntimeApiFixture(async ({ root, repositoryPath, commandPath }) => {
    assert.equal(
      (await handleRuntimeProfileCreate(JSON.stringify(profilePayload(commandPath)))).statusCode,
      200
    );
    const verified = await handleRuntimeProfileVerify(
      "codex-api-profile",
      JSON.stringify({ repositoryPath }),
      root
    );
    assert.equal(verified.statusCode, 200);
    const verifiedBody = JSON.parse(verified.body);
    const selection = createAgentSelection({
      baseAgentId: "codex",
      runtimeProfileId: "codex-api-profile",
      launchSpecHash: verifiedBody.launchSpec.launchSpecHash,
      verificationReceiptId: verifiedBody.receipt.receiptId
    });

    const admitted = await prepareUiRuntimeAdmission([selection], repositoryPath, { ...process.env });
    assert.equal(admitted.selections[0].launchSpecHash, verifiedBody.launchSpec.launchSpecHash);
    assert.equal(admitted.selections[0].verificationReceiptId, verifiedBody.receipt.receiptId);
    assert.equal(
      admitted.runtimeBindings[selection.variantId].runtimeSecretValues[
        "runtime-profile/codex/codex-api-profile"
      ],
      "runtime-api-secret"
    );

    await assert.rejects(
      prepareUiRuntimeAdmission([
        createAgentSelection({
          baseAgentId: "codex",
          runtimeProfileId: "codex-api-profile",
          launchSpecHash: "launch-spec:stale",
          verificationReceiptId: verifiedBody.receipt.receiptId
        })
      ], repositoryPath, { ...process.env }),
      /LaunchSpec drift/i
    );
    await assert.rejects(
      prepareUiRuntimeAdmission([
        createAgentSelection({
          baseAgentId: "codex",
          runtimeProfileId: "codex-api-profile",
          launchSpecHash: verifiedBody.launchSpec.launchSpecHash,
          verificationReceiptId: "verification-stale"
        })
      ], repositoryPath, { ...process.env }),
      /stale verification receipt/i
    );

    const updatedPayload = profilePayload(commandPath);
    delete updatedPayload.secret;
    updatedPayload.notes = "profile revision changed after verification";
    assert.equal(
      (await handleRuntimeProfileUpdate("codex-api-profile", JSON.stringify(updatedPayload))).statusCode,
      200
    );
    await assert.rejects(
      prepareUiRuntimeAdmission([selection], repositoryPath, { ...process.env }),
      /Task-ready|Verify it again/i
    );
  });
});

test("UI runtime admission preserves legacy runs but rejects mixed frozen and legacy selections", async () => {
  await withRuntimeApiFixture(async ({ repositoryPath }) => {
    const demo = createAgentSelection({ baseAgentId: "demo-fast" });
    const legacy = await prepareUiRuntimeAdmission([demo], repositoryPath, { ...process.env });
    assert.equal(legacy.runtimeBindings, undefined);
    assert.deepEqual(legacy.selections, [demo]);

    const codex = createAgentSelection({
      baseAgentId: "codex",
      runtimeProfileId: "codex-local"
    });
    await assert.rejects(
      prepareUiRuntimeAdmission([codex, demo], repositoryPath, { ...process.env }),
      /cannot be mixed/i
    );
  });
});
