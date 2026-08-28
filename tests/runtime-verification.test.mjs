import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyRuntimeVerificationFailure,
  findValidVerificationReceipt,
  getVerificationReceipt,
  listVerificationReceipts,
  resolveRuntimeLaunchSpec,
  saveVerificationReceipt,
  verifyRuntimeLaunch
} from "../packages/adapters/dist/index.js";
import {
  HARNESS_SNAPSHOT_SCHEMA_V1,
  INSTALLATION_SCHEMA_V1,
  isVerificationReceiptValid,
  RUNTIME_PROFILE_SCHEMA_V1
} from "../packages/core/dist/index.js";

const NOW = "2026-08-12T00:00:00.000Z";

async function createFakeCli(root) {
  const scriptPath = path.join(root, "verification-cli.mjs");
  await fs.writeFile(
    scriptPath,
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'const args = process.argv.slice(2);',
      'if (args.includes("--version")) { console.log("codex-cli 0.145.0"); process.exit(0); }',
      'if (process.env.AGENTARENA_FAKE_MUTATE_CODEX_HOME === "1") {',
      '  const codexHome = process.env.CODEX_HOME;',
      '  const configPath = path.join(codexHome, "config.toml");',
      '  const configBefore = fs.readFileSync(configPath, "utf8");',
      '  const capturePath = process.env.AGENTARENA_FAKE_CODEX_HOME_CAPTURE;',
      '  const captures = fs.existsSync(capturePath) ? JSON.parse(fs.readFileSync(capturePath, "utf8")) : [];',
      '  captures.push({ codexHome, configBefore, authExists: fs.existsSync(path.join(codexHome, "auth.json")) });',
      '  fs.writeFileSync(capturePath, JSON.stringify(captures), "utf8");',
      // biome-ignore lint/suspicious/noUselessEscapeInString: Escapes are part of the generated JavaScript fixture.
      '  fs.writeFileSync(configPath, configBefore + "\\n[projects.fixture]\\ntrust_level = \\\"trusted\\\"\\n", "utf8");',
      '}',
      'let prompt = "";',
      'for await (const chunk of process.stdin) prompt += chunk;',
      'const mode = process.env.AGENTARENA_FAKE_VERIFY_MODE ?? "success";',
      'const isTask = prompt.includes("agentarena-runtime-probe.txt");',
      'if (!isTask && mode === "conversation-401") { console.error("HTTP 401 authentication rejected"); process.exit(1); }',
      'if (!isTask && mode === "conversation-503-event") {',
      '  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "verification-session" }));',
      '  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "API Error: 503 No available accounts" }));',
      '  process.exit(0);',
      '}',
      'if (!isTask && mode === "conversation-503-route") {',
      '  const route = process.env.AGENTARENA_PRIVATE_BASE_URL;',
      '  const host = new URL(route).host;',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: The placeholders must remain in the generated JavaScript fixture.
      '  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: `API Error: 503 from ${route}; gateway ${host}; resolved 10.20.30.40:8081` }));',
      '  process.exit(0);',
      '}',
      'if (!isTask && mode === "conversation-503-override") {',
      '  const context = process.env.AGENTARENA_PUBLIC_CONTEXT;',
      '  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "sensitive-tool-metadata" }));',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: The placeholder must remain in the generated JavaScript fixture.
      '  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: `API Error: 503 for ${context}` }));',
      '  process.exit(0);',
      '}',
      'if (!isTask && mode === "conversation-disconnect-hang") {',
      '  console.error("stream disconnected before completion; reconnecting 1/5");',
      '  setTimeout(() => {}, 60000);',
      '  await new Promise(() => {});',
      '}',
      'const probeMatch = prompt.match(/agentarena-conversation:([a-z0-9-]+)/);',
      'const readyMatch = prompt.match(/agentarena-ready:([a-z0-9-]+)/);',
      'let result;',
      'if (isTask && readyMatch) {',
      '  fs.writeFileSync(path.join(process.cwd(), "agentarena-runtime-probe.txt"), "agentarena-ready:" + readyMatch[1] + "\\n", "utf8");',
      '  if (mode === "task-extra") fs.writeFileSync(path.join(process.cwd(), "unexpected.txt"), "unexpected\\n", "utf8");',
      '  result = JSON.stringify({ agentarena_task_probe: readyMatch[1] });',
      '} else {',
      '  result = JSON.stringify({ agentarena_probe: probeMatch?.[1] ?? "missing" });',
      '}',
      'const outputIndex = args.indexOf("--output-last-message");',
      'if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], result, "utf8");',
      'if (args.includes("exec")) {',
      '  console.log(JSON.stringify({ type: "thread.started", thread_id: "verification-thread" }));',
      '  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));',
      '} else {',
      '  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "verification-session" }));',
      '  console.log(JSON.stringify({ type: "result", subtype: "success", result, usage: { input_tokens: 1, output_tokens: 1 } }));',
      '}'
    ].join("\n"),
    "utf8"
  );
  return scriptPath;
}

function managedProfile(secretRef, extraEnv = {}) {
  return {
    schemaVersion: RUNTIME_PROFILE_SCHEMA_V1,
    id: "codex-verification",
    name: "Codex Verification",
    agentKind: "codex",
    mode: "managed-provider",
    revision: 2,
    secretRevision: 4,
    provider: {
      baseUrl: "https://provider.example.test/v1",
      protocol: "openai-responses",
      requestedModel: "gpt-verification",
      canonicalModelIdentity: "provider/gpt-verification",
      modelIdentitySource: "declared",
      secretRef
    },
    extraEnv,
    riskFlags: ["third-party-provider"],
    createdAt: NOW,
    updatedAt: NOW
  };
}

function createLaunch(
  scriptPath,
  secretRef,
  extraEnv = {},
  timeouts = { startupMs: 5_000, idleMs: 5_000, totalMs: 15_000 }
) {
  const installation = {
    schemaVersion: INSTALLATION_SCHEMA_V1,
    id: "codex-verification-installation",
    agentKind: "codex",
    executable: process.execPath,
    argsPrefix: [scriptPath],
    displayCommand: `${process.execPath} ${scriptPath}`,
    source: "explicit",
    version: "0.145.0",
    capabilities: { configOverrides: true, workspaceWrite: true },
    fingerprint: "installation:verification",
    discoveredAt: NOW
  };
  const harnessSnapshot = {
    schemaVersion: HARNESS_SNAPSHOT_SCHEMA_V1,
    snapshotId: "harness-snapshot:verification",
    agentKind: "codex",
    installationFingerprint: installation.fingerprint,
    hostEnvironmentSnapshotId: "host-environment:verification",
    repositoryBaselineIdentity: "repository:verification",
    entries: [],
    riskFlags: [],
    createdAt: NOW
  };
  return resolveRuntimeLaunchSpec({
    profile: managedProfile(secretRef, extraEnv),
    installation,
    harnessSnapshot,
    repositoryBaselineIdentity: "repository:verification",
    specId: "launch-verification",
    now: () => NOW,
    timeouts
  });
}

async function withVerificationFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-runtime-verification-"));
  const repositoryPath = path.join(root, "repository");
  const receiptRoot = path.join(root, "receipts");
  const previousRoot = process.env.AGENTARENA_VERIFICATION_ROOT;
  await fs.mkdir(repositoryPath, { recursive: true });
  await fs.writeFile(path.join(repositoryPath, "README.md"), "verification fixture\n", "utf8");
  process.env.AGENTARENA_VERIFICATION_ROOT = receiptRoot;
  try {
    const scriptPath = await createFakeCli(root);
    const secretRef = "runtime-profile/codex/codex-verification";
    const launchSpec = createLaunch(scriptPath, secretRef);
    await run({ root, repositoryPath, receiptRoot, scriptPath, secretRef, launchSpec });
  } finally {
    if (previousRoot === undefined) delete process.env.AGENTARENA_VERIFICATION_ROOT;
    else process.env.AGENTARENA_VERIFICATION_ROOT = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("three-stage verification reaches Task Ready only after the exact repository edit", async () => {
  await withVerificationFixture(async ({ repositoryPath, secretRef, launchSpec }) => {
    const receipt = await verifyRuntimeLaunch({
      launchSpec,
      repositoryPath,
      hostEnvironment: { ...process.env },
      runtimeSecretValues: { [secretRef]: "verification-secret-value" }
    });

    assert.equal(receipt.readiness, "task-ready");
    assert.deepEqual(receipt.stages.map((stage) => [stage.stage, stage.status]), [
      ["installation", "passed"],
      ["conversation", "passed"],
      ["task", "passed"]
    ]);
    assert.equal(receipt.launchSpecHash, launchSpec.launchSpecHash);
    assert.equal(isVerificationReceiptValid(receipt, launchSpec), true);
    assert.doesNotMatch(JSON.stringify(receipt), /verification-secret-value/);
  });
});

test("Codex verification contains CLI state writes in one disposable runtime Home", async () => {
  await withVerificationFixture(async ({ root, repositoryPath, secretRef, launchSpec }) => {
    const codexHome = path.join(root, "codex-home");
    const capturePath = path.join(root, "codex-home-capture.json");
    const sourceConfig = 'model = "fixture-model"\n';
    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(path.join(codexHome, "config.toml"), sourceConfig, "utf8");
    await fs.writeFile(path.join(codexHome, "auth.json"), '{"OPENAI_API_KEY":"must-not-be-inherited"}\n', "utf8");

    const receipt = await verifyRuntimeLaunch({
      launchSpec,
      repositoryPath,
      hostEnvironment: {
        ...process.env,
        CODEX_HOME: codexHome,
        AGENTARENA_FAKE_MUTATE_CODEX_HOME: "1",
        AGENTARENA_FAKE_CODEX_HOME_CAPTURE: capturePath
      },
      runtimeSecretValues: { [secretRef]: "verification-secret-value" }
    });

    assert.equal(receipt.readiness, "task-ready");
    assert.equal(await fs.readFile(path.join(codexHome, "config.toml"), "utf8"), sourceConfig);
    const captures = JSON.parse(await fs.readFile(capturePath, "utf8"));
    assert.equal(captures.length, 2);
    assert.equal(captures[0].codexHome, captures[1].codexHome);
    assert.notEqual(path.resolve(captures[0].codexHome), path.resolve(codexHome));
    assert.equal(captures[0].configBefore, sourceConfig);
    assert.equal(captures[0].authExists, false);
    await assert.rejects(fs.stat(captures[0].codexHome));
  });
});

test("installation success alone is reported as installed when conversation authentication fails", async () => {
  await withVerificationFixture(async ({ repositoryPath, secretRef, launchSpec }) => {
    const receipt = await verifyRuntimeLaunch({
      launchSpec,
      repositoryPath,
      hostEnvironment: { ...process.env, AGENTARENA_FAKE_VERIFY_MODE: "conversation-401" },
      runtimeSecretValues: { [secretRef]: "verification-secret-value" }
    });

    assert.equal(receipt.readiness, "installed");
    assert.equal(receipt.stages[0].status, "passed");
    assert.equal(receipt.stages[1].status, "failed");
    assert.equal(receipt.stages[1].errorCategory, "authentication-rejected");
    assert.equal(receipt.stages[2].status, "skipped");
  });
});

test("structured Provider errors override a zero CLI exit code", async () => {
  await withVerificationFixture(async ({ repositoryPath, secretRef, launchSpec }) => {
    const receipt = await verifyRuntimeLaunch({
      launchSpec,
      repositoryPath,
      hostEnvironment: { ...process.env, AGENTARENA_FAKE_VERIFY_MODE: "conversation-503-event" },
      runtimeSecretValues: { [secretRef]: "verification-secret-value" }
    });

    assert.equal(receipt.readiness, "installed");
    assert.equal(receipt.stages[1].status, "failed");
    assert.equal(receipt.stages[1].errorCategory, "provider-overloaded");
    assert.match(receipt.stages[1].details?.[0] ?? "", /503 No available accounts/);
    assert.doesNotMatch(JSON.stringify(receipt), /verification-session/);
    assert.equal(receipt.stages[2].status, "skipped");
  });
});

test("verification evidence redacts inherited routing environment values", async () => {
  await withVerificationFixture(async ({ repositoryPath, secretRef, launchSpec }) => {
    const privateRoute = "http://private-gateway.example.test:8081/v1";
    const receipt = await verifyRuntimeLaunch({
      launchSpec,
      repositoryPath,
      hostEnvironment: {
        ...process.env,
        AGENTARENA_FAKE_VERIFY_MODE: "conversation-503-route",
        AGENTARENA_PRIVATE_BASE_URL: privateRoute
      },
      runtimeSecretValues: { [secretRef]: "verification-secret-value" }
    });

    const serialized = JSON.stringify(receipt);
    assert.equal(receipt.stages[1].errorCategory, "provider-overloaded");
    assert.match(serialized, /503/);
    assert.doesNotMatch(serialized, /private-gateway\.example\.test|privateRoute|10\.20\.30\.40/);
    assert.match(serialized, /\[redacted environment\]/);
  });
});

test("verification evidence redacts every frozen LaunchSpec override value", async () => {
  await withVerificationFixture(async ({ repositoryPath, scriptPath, secretRef }) => {
    const overrideValue = "customer-visible-context-42";
    const launchSpec = createLaunch(scriptPath, secretRef, {
      AGENTARENA_FAKE_VERIFY_MODE: "conversation-503-override",
      AGENTARENA_PUBLIC_CONTEXT: overrideValue
    });
    const receipt = await verifyRuntimeLaunch({
      launchSpec,
      repositoryPath,
      hostEnvironment: { ...process.env },
      runtimeSecretValues: { [secretRef]: "verification-secret-value" }
    });

    const serialized = JSON.stringify(receipt);
    assert.equal(receipt.stages[1].errorCategory, "provider-overloaded");
    assert.match(serialized, /503/);
    assert.doesNotMatch(serialized, new RegExp(overrideValue));
    assert.match(serialized, /\[redacted environment\]/);
    assert.doesNotMatch(serialized, /sensitive-tool-metadata/);
  });
});

test("frozen verification stops an inactive Provider stream at the idle deadline", async () => {
  await withVerificationFixture(async ({ root, repositoryPath, scriptPath, secretRef }) => {
    const codexHome = path.join(root, "codex-home");
    await fs.mkdir(codexHome, { recursive: true });
    const launchSpec = createLaunch(
      scriptPath,
      secretRef,
      { AGENTARENA_FAKE_VERIFY_MODE: "conversation-disconnect-hang" },
      { startupMs: 5_000, idleMs: 250, totalMs: 5_000 }
    );
    const startedAt = Date.now();
    const receipt = await verifyRuntimeLaunch({
      launchSpec,
      repositoryPath,
      hostEnvironment: { ...process.env, CODEX_HOME: codexHome },
      runtimeSecretValues: { [secretRef]: "verification-secret-value" }
    });

    assert.equal(receipt.readiness, "installed");
    assert.equal(receipt.stages[1].status, "failed");
    assert.equal(receipt.stages[1].errorCategory, "provider-unreachable");
    assert.match(receipt.stages[1].details?.[0] ?? "", /stream disconnected/i);
    assert.equal(receipt.stages[2].status, "skipped");
    assert.ok(Date.now() - startedAt < 3_000, "verification should not wait for the total deadline");
  });
});

test("task verification rejects any unexpected workspace change", async () => {
  await withVerificationFixture(async ({ repositoryPath, secretRef, launchSpec }) => {
    const receipt = await verifyRuntimeLaunch({
      launchSpec,
      repositoryPath,
      hostEnvironment: { ...process.env, AGENTARENA_FAKE_VERIFY_MODE: "task-extra" },
      runtimeSecretValues: { [secretRef]: "verification-secret-value" }
    });

    assert.equal(receipt.readiness, "blocked");
    assert.equal(receipt.stages[2].status, "failed");
    assert.equal(receipt.stages[2].errorCategory, "unexpected-workspace-change");
  });
});

test("verification failure classification keeps operational causes distinct", () => {
  const cases = [
    ["HTTP 401 invalid token", "authentication-rejected"],
    ["HTTP 403 forbidden", "authentication-rejected"],
    ["HTTP 404 model gpt-x not found", "model-unavailable"],
    ["HTTP 429 quota exhausted", "quota-exhausted"],
    ["HTTP 429 too many requests", "provider-overloaded"],
    ["HTTP 503 service unavailable", "provider-overloaded"],
    ["getaddrinfo ENOTFOUND provider.test", "provider-unreachable"],
    ["permission denied in dontAsk mode", "permission-blocked"],
    ["invalid JSON protocol response", "protocol-mismatch"]
  ];
  for (const [message, category] of cases) {
    assert.equal(classifyRuntimeVerificationFailure({ stage: "conversation", message }), category, message);
  }
  assert.equal(
    classifyRuntimeVerificationFailure({ stage: "conversation", message: "timed out", timedOut: true }),
    "probe-timeout"
  );
  assert.equal(
    classifyRuntimeVerificationFailure({ stage: "task", message: "timed out", timedOut: true }),
    "task-timeout"
  );
  assert.equal(
    classifyRuntimeVerificationFailure({
      stage: "task",
      message: "stream disconnected before completion; reconnecting 1/5",
      timedOut: true
    }),
    "provider-unreachable"
  );
});

test("verification receipts persist redacted evidence and match only the exact LaunchSpec", async () => {
  await withVerificationFixture(async ({ receiptRoot, repositoryPath, secretRef, launchSpec }) => {
    const receipt = await verifyRuntimeLaunch({
      launchSpec,
      repositoryPath,
      hostEnvironment: { ...process.env },
      runtimeSecretValues: { [secretRef]: "verification-secret-value" }
    });
    await saveVerificationReceipt(receipt);

    assert.deepEqual(await getVerificationReceipt(receipt.receiptId), receipt);
    assert.equal((await listVerificationReceipts()).length, 1);
    assert.equal((await findValidVerificationReceipt(launchSpec))?.receiptId, receipt.receiptId);
    const changedSpec = resolveRuntimeLaunchSpec({
      profile: { ...managedProfile(secretRef), revision: 3 },
      installation: {
        schemaVersion: INSTALLATION_SCHEMA_V1,
        id: launchSpec.installation.id,
        agentKind: "codex",
        executable: launchSpec.command.executable,
        argsPrefix: launchSpec.command.argsPrefix,
        displayCommand: launchSpec.command.executable,
        source: "explicit",
        version: launchSpec.installation.version,
        capabilities: {},
        fingerprint: launchSpec.installation.fingerprint,
        discoveredAt: NOW
      },
      harnessSnapshot: {
        schemaVersion: HARNESS_SNAPSHOT_SCHEMA_V1,
        snapshotId: launchSpec.harnessSnapshotId,
        agentKind: "codex",
        installationFingerprint: launchSpec.installation.fingerprint,
        hostEnvironmentSnapshotId: "host-environment:verification",
        repositoryBaselineIdentity: launchSpec.repositoryBaselineIdentity,
        entries: [],
        riskFlags: [],
        createdAt: NOW
      },
      repositoryBaselineIdentity: launchSpec.repositoryBaselineIdentity,
      specId: "changed-launch",
      now: () => NOW
    });
    assert.equal(await findValidVerificationReceipt(changedSpec), undefined);

    const persisted = await fs.readFile(path.join(receiptRoot, "verification-receipts.json"), "utf8");
    assert.doesNotMatch(persisted, /verification-secret-value|secretRef|runtimeSecretValues/);
  });
});
