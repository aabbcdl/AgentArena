import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  captureHarnessSnapshot,
  discoverRuntimeInstallation,
  getAdapter,
  materializeRuntimeLaunchArguments,
  materializeRuntimeLaunchEnvironment,
  resolvedAgentRuntimeFromLaunchSpec,
  resolveRuntimeLaunchSpec
} from "../packages/adapters/dist/index.js";
import {
  HARNESS_SNAPSHOT_SCHEMA_V1,
  INSTALLATION_SCHEMA_V1,
  RUNTIME_PROFILE_SCHEMA_V1
} from "../packages/core/dist/index.js";

const NOW = "2026-08-12T00:00:00.000Z";

function installation(agentKind, overrides = {}) {
  return {
    schemaVersion: INSTALLATION_SCHEMA_V1,
    id: `${agentKind}-installation`,
    agentKind,
    executable: agentKind === "codex" ? "C:/tools/codex.exe" : "C:/tools/claude.exe",
    argsPrefix: [],
    displayCommand: agentKind === "codex" ? "C:/tools/codex.exe" : "C:/tools/claude.exe",
    source: "explicit",
    version: agentKind === "codex" ? "0.145.0" : "2.1.226",
    capabilities: {},
    fingerprint: `${agentKind}-installation:fingerprint`,
    discoveredAt: NOW,
    ...overrides
  };
}

function snapshot(agentKind, installationFingerprint) {
  return {
    schemaVersion: HARNESS_SNAPSHOT_SCHEMA_V1,
    snapshotId: `${agentKind}-harness:snapshot`,
    agentKind,
    installationFingerprint,
    hostEnvironmentSnapshotId: "host-environment:snapshot",
    repositoryBaselineIdentity: "repository:baseline",
    entries: [],
    riskFlags: [],
    createdAt: NOW
  };
}

function localProfile(agentKind) {
  return {
    schemaVersion: RUNTIME_PROFILE_SCHEMA_V1,
    id: agentKind === "codex" ? "codex-local" : "claude-local",
    name: agentKind === "codex" ? "Current local Codex setup" : "Current local Claude setup",
    agentKind,
    mode: "inherit-local",
    revision: 1,
    secretRevision: 1,
    extraEnv: {},
    riskFlags: [],
    createdAt: NOW,
    updatedAt: NOW,
    isBuiltIn: true
  };
}

function managedProfile(agentKind) {
  const codex = agentKind === "codex";
  return {
    schemaVersion: RUNTIME_PROFILE_SCHEMA_V1,
    id: codex ? "codex-managed" : "claude-managed",
    name: codex ? "Managed Codex" : "Managed Claude",
    agentKind,
    mode: "managed-provider",
    revision: 2,
    secretRevision: 3,
    provider: {
      baseUrl: "https://provider.example.test/v1",
      protocol: codex ? "openai-responses" : "anthropic-messages",
      requestedModel: codex ? "gpt-shared" : "claude-shared",
      canonicalModelIdentity: "provider/shared-model",
      modelIdentitySource: "declared",
      reasoningEffort: "high",
      modelMappings: codex
        ? undefined
        : {
            haiku: "claude-haiku-routed",
            sonnet: "claude-sonnet-routed",
            opus: "claude-opus-routed"
          },
      secretRef: codex
        ? "runtime-profile/codex/codex-managed"
        : "runtime-profile/claude-code/claude-managed"
    },
    extraEnv: { PROVIDER_REGION: "test-region" },
    riskFlags: ["third-party-provider"],
    createdAt: NOW,
    updatedAt: NOW
  };
}

function probeFixture(version, help) {
  return async (_invocation, args) => ({
    exitCode: 0,
    stdout: args.includes("--version") ? version : help,
    stderr: ""
  });
}

test("Codex capability discovery reads exec help for structured output flags", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-runtime-codex-help-"));
  try {
    const codexJs = path.join(root, "codex.js");
    await fs.writeFile(codexJs, "console.log('codex fixture')\n", "utf8");
    const calls = [];
    const discovered = await discoverRuntimeInstallation({
      agentKind: "codex",
      commandPath: codexJs,
      platform: "win32",
      nodeExecutable: "C:/runtime/node.exe",
      now: () => NOW,
      probe: async (_invocation, args) => {
        calls.push(args.slice(-2));
        if (args.includes("--version")) {
          return { exitCode: 0, stdout: "codex-cli 0.145.0", stderr: "" };
        }
        if (args.includes("exec")) {
          return {
            exitCode: 0,
            stdout: "--json --output-last-message --sandbox workspace-write",
            stderr: ""
          };
        }
        return { exitCode: 0, stdout: "--config --sandbox", stderr: "" };
      }
    });

    assert.ok(calls.some((args) => args[0] === "exec" && args[1] === "--help"));
    assert.equal(discovered.capabilities.configOverrides, true);
    assert.equal(discovered.capabilities.jsonEvents, true);
    assert.equal(discovered.capabilities.outputLastMessage, true);
    assert.equal(discovered.capabilities.workspaceWrite, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Codex installation probes use a disposable CODEX_HOME and clean it up", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-runtime-installation-home-"));
  const sourceHome = path.join(root, "source-codex-home");
  const capturePath = path.join(root, "capture.json");
  const scriptPath = path.join(root, "probe-codex.mjs");
  try {
    await fs.mkdir(sourceHome, { recursive: true });
    await fs.writeFile(path.join(sourceHome, "config.toml"), 'model = "fixture-model"\n', "utf8");
    await fs.writeFile(path.join(sourceHome, "auth.json"), '{"tokens":{"access_token":"fixture"}}\n', "utf8");
    await fs.writeFile(
      scriptPath,
      [
        'import fs from "node:fs";',
        'const capturePath = process.env.AGENTARENA_CAPTURE_PATH;',
        'const captures = fs.existsSync(capturePath) ? JSON.parse(fs.readFileSync(capturePath, "utf8")) : [];',
        'captures.push(process.env.CODEX_HOME);',
        'fs.writeFileSync(capturePath, JSON.stringify(captures), "utf8");',
        'const args = process.argv.slice(2);',
        'if (args.includes("--version")) console.log("codex-cli 0.145.0");',
        'else if (args.includes("exec")) console.log("--json --output-last-message --sandbox workspace-write");',
        'else console.log("--config --sandbox");'
      ].join("\n"),
      "utf8"
    );

    await discoverRuntimeInstallation({
      agentKind: "codex",
      commandPath: scriptPath,
      environment: {
        ...process.env,
        CODEX_HOME: sourceHome,
        AGENTARENA_CAPTURE_PATH: capturePath
      },
      platform: process.platform,
      nodeExecutable: process.execPath,
      now: () => NOW
    });

    const captures = JSON.parse(await fs.readFile(capturePath, "utf8"));
    assert.equal(captures.length, 3);
    assert.ok(captures.every((value) => typeof value === "string" && value !== sourceHome));
    for (const value of captures) {
      assert.equal(await fs.access(value).then(() => true).catch(() => false), false);
    }
    assert.equal(await fs.readFile(path.join(sourceHome, "config.toml"), "utf8"), 'model = "fixture-model"\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("installation discovery resolves explicit Windows shims, PowerShell, Node entries, and PATH deterministically", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-runtime-installation-"));
  try {
    const codexCmd = path.join(root, "codex.cmd");
    const claudePs1 = path.join(root, "claude.ps1");
    const codexJs = path.join(root, "codex.js");
    await fs.writeFile(codexCmd, "@echo off\r\nnode codex.js %*\r\n", "utf8");
    await fs.writeFile(claudePs1, "node claude.js @args\n", "utf8");
    await fs.writeFile(codexJs, "console.log('codex fixture')\n", "utf8");

    const probe = probeFixture(
      "codex-cli 0.145.0",
      "--config --sandbox --json --output-last-message"
    );
    const explicitCmd = await discoverRuntimeInstallation({
      agentKind: "codex",
      commandPath: codexCmd,
      environment: { PATH: root, PATHEXT: ".CMD;.PS1;.EXE" },
      platform: "win32",
      now: () => NOW,
      probe
    });
    const explicitPowerShell = await discoverRuntimeInstallation({
      agentKind: "claude-code",
      commandPath: claudePs1,
      environment: { PATH: root, PATHEXT: ".CMD;.PS1;.EXE" },
      platform: "win32",
      now: () => NOW,
      probe: probeFixture("2.1.226 (Claude Code)", "--setting-sources --permission-mode --output-format")
    });
    const explicitNode = await discoverRuntimeInstallation({
      agentKind: "codex",
      commandPath: codexJs,
      environment: { PATH: root },
      platform: "win32",
      nodeExecutable: "C:/runtime/node.exe",
      now: () => NOW,
      probe
    });
    const fromPath = await discoverRuntimeInstallation({
      agentKind: "codex",
      environment: { PATH: root, PATHEXT: ".CMD;.PS1;.EXE" },
      platform: "win32",
      now: () => NOW,
      probe
    });

    assert.equal(explicitCmd.executable, codexCmd);
    assert.deepEqual(explicitCmd.argsPrefix, []);
    assert.equal(explicitCmd.source, "explicit");
    assert.match(explicitPowerShell.executable, /powershell(?:\.exe)?$/i);
    assert.deepEqual(explicitPowerShell.argsPrefix.slice(-2), ["-File", claudePs1]);
    assert.equal(explicitNode.executable, "C:/runtime/node.exe");
    assert.deepEqual(explicitNode.argsPrefix, [codexJs]);
    assert.equal(fromPath.executable, codexCmd);
    assert.equal(fromPath.source, "path");
    assert.equal(fromPath.version, "0.145.0");
    assert.equal(fromPath.capabilities.configOverrides, true);
    assert.equal(fromPath.fingerprint, explicitCmd.fingerprint);
    assert.equal(
      fromPath.id,
      explicitCmd.id,
      "the same installation fingerprint must resolve to a stable installation ID"
    );

    const profile = localProfile("codex");
    const firstSnapshot = snapshot("codex", explicitCmd.fingerprint);
    const repeatedSnapshot = snapshot("codex", fromPath.fingerprint);
    const firstSpec = resolveRuntimeLaunchSpec({
      profile,
      installation: explicitCmd,
      harnessSnapshot: firstSnapshot,
      repositoryBaselineIdentity: "repository:baseline",
      now: () => NOW,
      specId: "first-resolution"
    });
    const repeatedSpec = resolveRuntimeLaunchSpec({
      profile,
      installation: fromPath,
      harnessSnapshot: repeatedSnapshot,
      repositoryBaselineIdentity: "repository:baseline",
      now: () => NOW,
      specId: "repeated-resolution"
    });
    assert.equal(
      repeatedSpec.launchSpecHash,
      firstSpec.launchSpecHash,
      "re-resolving unchanged runtime inputs must preserve the LaunchSpec hash"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("installation discovery unwraps known Windows npm shims to safe package entry points", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-runtime-npm-shims-"));
  try {
    const codexCmd = path.join(root, "codex.cmd");
    const codexEntry = path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js");
    const claudeCmd = path.join(root, "claude.cmd");
    const claudeEntry = path.join(root, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    await fs.mkdir(path.dirname(codexEntry), { recursive: true });
    await fs.mkdir(path.dirname(claudeEntry), { recursive: true });
    await fs.writeFile(codexCmd, '@echo off\r\nnode "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n', "utf8");
    await fs.writeFile(codexEntry, "console.log('codex fixture')\n", "utf8");
    await fs.writeFile(claudeCmd, '@echo off\r\n"%~dp0\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe" %*\r\n', "utf8");
    await fs.writeFile(claudeEntry, "claude fixture\n", "utf8");

    const codex = await discoverRuntimeInstallation({
      agentKind: "codex",
      environment: { PATH: root, PATHEXT: ".CMD;.EXE" },
      platform: "win32",
      nodeExecutable: "C:/runtime/node.exe",
      now: () => NOW,
      probe: probeFixture("codex-cli 0.145.0", "--config --sandbox --json --output-last-message")
    });
    const claude = await discoverRuntimeInstallation({
      agentKind: "claude-code",
      environment: { PATH: root, PATHEXT: ".CMD;.EXE" },
      platform: "win32",
      nodeExecutable: "C:/runtime/node.exe",
      now: () => NOW,
      probe: probeFixture("2.1.226 (Claude Code)", "--setting-sources --permission-mode dontAsk --output-format stream-json --no-session-persistence")
    });

    assert.equal(codex.executable, "C:/runtime/node.exe");
    assert.deepEqual(codex.argsPrefix, [codexEntry]);
    assert.equal(claude.executable, claudeEntry);
    assert.deepEqual(claude.argsPrefix, []);

    const firstFingerprint = codex.fingerprint;
    await fs.appendFile(codexCmd, "rem wrapper changed\r\n", "utf8");
    const changed = await discoverRuntimeInstallation({
      agentKind: "codex",
      environment: { PATH: root, PATHEXT: ".CMD;.EXE" },
      platform: "win32",
      nodeExecutable: "C:/runtime/node.exe",
      now: () => NOW,
      probe: probeFixture("codex-cli 0.145.0", "--config --sandbox --json --output-last-message")
    });
    assert.notEqual(changed.fingerprint, firstFingerprint, "the npm shim remains part of installation identity");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Codex local launch inherits user Harness while enforcing bounded unattended execution", () => {
  const install = installation("codex");
  const spec = resolveRuntimeLaunchSpec({
    profile: localProfile("codex"),
    installation: install,
    harnessSnapshot: snapshot("codex", install.fingerprint),
    repositoryBaselineIdentity: "repository:baseline",
    now: () => NOW,
    specId: "codex-local-spec"
  });
  const serializedArgs = JSON.stringify(spec.command.argsTemplate);

  assert.equal(spec.environment.inheritHost, true);
  assert.equal(spec.environment.unset.includes("CODEX_HOME"), false);
  assert.equal(Object.hasOwn(spec.environment.overrides, "CODEX_HOME"), false);
  assert.match(serializedArgs, /approval_policy/);
  assert.match(serializedArgs, /never/);
  assert.match(serializedArgs, /skip-git-repo-check/);
  assert.doesNotMatch(serializedArgs, /codexWorkspaceTrustOverride|trust_level|projects=/);
  const expectedMode = process.platform === "win32" ? "danger-full-access" : "workspace-write";
  if (process.platform === "win32") {
    assert.match(serializedArgs, /dangerously-bypass-approvals-and-sandbox/);
  } else {
    assert.match(serializedArgs, /workspace-write/);
    assert.doesNotMatch(serializedArgs, /dangerously-bypass|ignore-user-config|ignore-rules/);
  }
  assert.deepEqual(spec.permissions, {
    mode: expectedMode,
    unattended: true,
    fullBypass: process.platform === "win32"
  });
});

test("Codex inherited launch freezes the resolved model and reasoning effort", () => {
  const install = installation("codex");
  const spec = resolveRuntimeLaunchSpec({
    profile: localProfile("codex"),
    installation: install,
    harnessSnapshot: snapshot("codex", install.fingerprint),
    repositoryBaselineIdentity: "repository:baseline",
    codexRuntime: {
      effectiveModel: "gpt-5.6-luna",
      effectiveReasoningEffort: "max",
      modelIdentitySource: "declared",
      reasoningEffortSource: "declared",
      source: "codex-config",
      verification: "inferred"
    },
    now: () => NOW,
    specId: "codex-local-resolved-runtime-spec"
  });

  assert.match(JSON.stringify(spec.command.argsTemplate), /model=\\"gpt-5\.6-luna\\"/);
  assert.match(JSON.stringify(spec.command.argsTemplate), /model_reasoning_effort=\\"max\\"/);
  assert.equal(spec.runtime.requestedModel, "gpt-5.6-luna");
  assert.equal(spec.runtime.canonicalModelIdentity, "gpt-5.6-luna");
  assert.equal(spec.runtime.modelIdentitySource, "declared");
  assert.equal(spec.runtime.reasoningEffort, "max");
  assert.equal(spec.runtime.source, "codex-config");

  const resolved = resolvedAgentRuntimeFromLaunchSpec(spec);
  assert.equal(resolved.effectiveModel, "gpt-5.6-luna");
  assert.equal(resolved.effectiveReasoningEffort, "max");
  assert.equal(resolved.modelIdentitySource, "declared");
  assert.equal(resolved.reasoningEffortSource, "declared");
  assert.equal(resolved.source, "codex-config");
});

test("Codex managed Provider is expressed only through task arguments and a secret binding", () => {
  const install = installation("codex");
  const spec = resolveRuntimeLaunchSpec({
    profile: managedProfile("codex"),
    installation: install,
    harnessSnapshot: snapshot("codex", install.fingerprint),
    repositoryBaselineIdentity: "repository:baseline",
    now: () => NOW,
    specId: "codex-managed-spec"
  });
  const serialized = JSON.stringify(spec);

  assert.match(serialized, /model_provider/);
  assert.match(serialized, /model_providers\.agentarena\.base_url/);
  assert.match(serialized, /model_providers\.agentarena\.env_key/);
  assert.match(serialized, /wire_api/);
  assert.match(serialized, /gpt-shared/);
  assert.deepEqual(spec.environment.secretBindings, [
    {
      environmentVariable: "AGENTARENA_CODEX_PROVIDER_KEY",
      secretRef: "runtime-profile/codex/codex-managed",
      secretRevision: 3
    }
  ]);
  assert.doesNotMatch(serialized, /fixture-secret-value/);
  assert.match(spec.runtime.providerPolicyIdentity, /^provider-policy:/);
  assert.match(spec.runtime.modelParametersIdentity, /^model-parameters:/);
});

test("fairness identities normalize Harness-specific protocols and model aliases", () => {
  const codexInstall = installation("codex");
  const claudeInstall = installation("claude-code");
  const claudeProfile = managedProfile("claude-code");
  const codexSpec = resolveRuntimeLaunchSpec({
    profile: managedProfile("codex"),
    installation: codexInstall,
    harnessSnapshot: snapshot("codex", codexInstall.fingerprint),
    repositoryBaselineIdentity: "repository:baseline",
    now: () => NOW
  });
  const claudeSpec = resolveRuntimeLaunchSpec({
    profile: {
      ...claudeProfile,
      provider: { ...claudeProfile.provider, modelMappings: undefined }
    },
    installation: claudeInstall,
    harnessSnapshot: snapshot("claude-code", claudeInstall.fingerprint),
    repositoryBaselineIdentity: "repository:baseline",
    now: () => NOW
  });

  assert.notEqual(codexSpec.runtime.requestedModel, claudeSpec.runtime.requestedModel);
  assert.notEqual(codexSpec.runtime.providerKind, claudeSpec.runtime.providerKind);
  assert.equal(codexSpec.runtime.providerPolicyIdentity, claudeSpec.runtime.providerPolicyIdentity);
  assert.equal(codexSpec.runtime.modelParametersIdentity, claudeSpec.runtime.modelParametersIdentity);
});

test("fairness identities include task-scoped Provider environment and explicit model routing", () => {
  const install = installation("claude-code");
  const baseProfile = managedProfile("claude-code");
  const resolve = (profile) => resolveRuntimeLaunchSpec({
    profile,
    installation: install,
    harnessSnapshot: snapshot("claude-code", install.fingerprint),
    repositoryBaselineIdentity: "repository:baseline",
    now: () => NOW
  });
  const base = resolve(baseProfile);
  const reorderedEnvironment = resolve({
    ...baseProfile,
    extraEnv: { ZONE: "one", PROVIDER_REGION: "test-region" }
  });
  const sameEnvironmentDifferentOrder = resolve({
    ...baseProfile,
    extraEnv: { PROVIDER_REGION: "test-region", ZONE: "one" }
  });
  const changedEnvironment = resolve({
    ...baseProfile,
    extraEnv: { PROVIDER_REGION: "other-region" }
  });
  const changedMapping = resolve({
    ...baseProfile,
    provider: {
      ...baseProfile.provider,
      modelMappings: { ...baseProfile.provider.modelMappings, sonnet: "claude-sonnet-other" }
    }
  });

  assert.equal(
    reorderedEnvironment.runtime.providerPolicyIdentity,
    sameEnvironmentDifferentOrder.runtime.providerPolicyIdentity
  );
  assert.notEqual(base.runtime.providerPolicyIdentity, changedEnvironment.runtime.providerPolicyIdentity);
  assert.notEqual(base.runtime.modelParametersIdentity, changedMapping.runtime.modelParametersIdentity);
});

test("Claude local and managed launches preserve normal setting sources without a full permission bypass", () => {
  for (const profile of [localProfile("claude-code"), managedProfile("claude-code")]) {
    const install = installation("claude-code");
    const spec = resolveRuntimeLaunchSpec({
      profile,
      installation: install,
      harnessSnapshot: snapshot("claude-code", install.fingerprint),
      repositoryBaselineIdentity: "repository:baseline",
      now: () => NOW,
      specId: `${profile.id}-spec`
    });
    const serializedArgs = JSON.stringify(spec.command.argsTemplate);

    assert.match(serializedArgs, /setting-sources/);
    assert.match(serializedArgs, /user,project,local/);
    assert.match(serializedArgs, /permission-mode/);
    assert.match(serializedArgs, /dontAsk/);
    assert.doesNotMatch(serializedArgs, /strict-mcp-config|dangerously-skip-permissions/);
    assert.equal(spec.environment.unset.includes("CLAUDE_CONFIG_DIR"), false);
    assert.equal(Object.hasOwn(spec.environment.overrides, "CLAUDE_CONFIG_DIR"), false);
    assert.equal(spec.permissions.fullBypass, false);

    if (profile.mode === "managed-provider") {
      assert.equal(spec.environment.overrides.ANTHROPIC_BASE_URL, profile.provider.baseUrl);
      assert.equal(spec.environment.overrides.ANTHROPIC_MODEL, profile.provider.requestedModel);
      assert.equal(spec.environment.overrides.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-sonnet-routed");
      assert.equal(spec.environment.secretBindings[0].environmentVariable, "ANTHROPIC_AUTH_TOKEN");
    }
  }
});

test("Harness snapshots track inherited user and repository configuration without serializing contents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-harness-snapshot-"));
  const repositoryPath = path.join(root, "repository");
  const homeDirectory = path.join(root, "home");
  const projectCodex = path.join(repositoryPath, ".codex");
  const projectClaude = path.join(repositoryPath, ".claude");
  const userCodex = path.join(homeDirectory, ".codex");
  const userSkill = path.join(homeDirectory, ".agents", "skills", "fixture");
  try {
    await fs.mkdir(projectCodex, { recursive: true });
    await fs.mkdir(projectClaude, { recursive: true });
    await fs.mkdir(userCodex, { recursive: true });
    await fs.mkdir(userSkill, { recursive: true });
    await fs.writeFile(path.join(repositoryPath, "AGENTS.md"), "repository instructions", "utf8");
    await fs.writeFile(path.join(repositoryPath, ".mcp.json"), '{"secret":"mcp-secret-value"}', "utf8");
    await fs.writeFile(path.join(projectCodex, "config.toml"), 'notify = ["project-secret-value"]\n', "utf8");
    await fs.writeFile(path.join(projectClaude, "settings.json"), '{"hooks":{"before":"fixture"}}', "utf8");
    await fs.writeFile(path.join(userCodex, "config.toml"), 'model = "fixture-model"\napi_key = "config-secret-value"\n', "utf8");
    await fs.writeFile(path.join(userCodex, "AGENTS.override.md"), "user override one", "utf8");
    await fs.writeFile(path.join(userSkill, "SKILL.md"), "fixture skill body", "utf8");

    const install = installation("codex");
    const options = {
      agentKind: "codex",
      installation: install,
      repositoryPath,
      repositoryBaselineIdentity: "repository:baseline",
      homeDirectory,
      environment: {
        PATH: "fixture-path",
        CODEX_HOME: userCodex,
        SERVICE_TOKEN: "environment-secret-value"
      },
      now: () => NOW
    };
    const first = await captureHarnessSnapshot(options);
    const second = await captureHarnessSnapshot(options);
    await fs.writeFile(path.join(userCodex, "AGENTS.override.md"), "user override two", "utf8");
    const overrideChanged = await captureHarnessSnapshot(options);
    await fs.writeFile(path.join(projectCodex, "config.toml"), 'notify = ["changed-project-secret-value"]\n', "utf8");
    const changed = await captureHarnessSnapshot(options);
    const serialized = JSON.stringify(first);

    assert.equal(first.snapshotId, second.snapshotId);
    assert.notEqual(first.snapshotId, overrideChanged.snapshotId);
    assert.notEqual(first.snapshotId, changed.snapshotId);
    assert.ok(first.entries.some((entry) => entry.path === "project:AGENTS.md"));
    assert.equal(first.entries.some((entry) => entry.path === "project:.mcp.json"), false);
    assert.ok(first.entries.some((entry) => entry.path === "project:.codex/config.toml"));
    assert.ok(first.entries.some((entry) => entry.path === "user:.codex/config.toml"));
    assert.ok(first.entries.some((entry) => entry.path === "user:.codex/AGENTS.override.md"));
    assert.ok(first.entries.some((entry) => entry.path === "user:.agents/skills/fixture/SKILL.md"));
    assert.doesNotMatch(
      serialized,
      /project-secret-value|config-secret-value|environment-secret-value|fixture skill body|repository instructions/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Harness snapshots ignore volatile launcher metadata while retaining behavioral environment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-harness-environment-"));
  const repositoryPath = path.join(root, "repository");
  const homeDirectory = path.join(root, "home");
  try {
    await fs.mkdir(repositoryPath, { recursive: true });
    await fs.mkdir(homeDirectory, { recursive: true });
    const install = installation("codex");
    const capture = (environment) => captureHarnessSnapshot({
      agentKind: "codex",
      installation: install,
      repositoryPath,
      repositoryBaselineIdentity: "repository:baseline",
      homeDirectory,
      environment,
      now: () => NOW
    });

    const first = await capture({
      PATH: "fixture-path",
      CODEX_THREAD_ID: "thread-one",
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "launcher-one",
      CODEX_PERMISSION_PROFILE: "workspace-write"
    });
    const newLauncherSession = await capture({
      PATH: "fixture-path",
      CODEX_THREAD_ID: "thread-two",
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "launcher-two",
      CODEX_PERMISSION_PROFILE: "workspace-write"
    });
    const changedPermissions = await capture({
      PATH: "fixture-path",
      CODEX_THREAD_ID: "thread-two",
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "launcher-two",
      CODEX_PERMISSION_PROFILE: "danger-full-access"
    });

    assert.equal(first.snapshotId, newLauncherSession.snapshotId);
    assert.notEqual(first.snapshotId, changedPermissions.snapshotId);
    assert.equal(first.entries.some((entry) => /CODEX_THREAD_ID|CODEX_INTERNAL_ORIGINATOR_OVERRIDE/.test(entry.path ?? "")), false);
    assert.equal(first.entries.some((entry) => entry.path === "environment:CODEX_PERMISSION_PROFILE"), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Claude state snapshots ignore unrelated usage churn but retain current-project Harness settings", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-harness-claude-state-"));
  const repositoryPath = path.join(root, "repository");
  const homeDirectory = path.join(root, "home");
  const statePath = path.join(homeDirectory, ".claude.json");
  try {
    await fs.mkdir(repositoryPath, { recursive: true });
    await fs.mkdir(homeDirectory, { recursive: true });
    const repositoryKey = path.resolve(repositoryPath);
    const state = (numStartups, currentAllowedTools, unrelatedLastCost) => ({
      numStartups,
      cachedGrowthBookFeatures: { transient_rollout: numStartups % 2 === 0 },
      activeProviderProfileId: "local-profile",
      oauthAccount: { accountUuid: "account-one", organizationUuid: "org-one", profileFetchedAt: numStartups },
      mcpServers: { shared: { command: "shared-mcp", env: { MCP_TOKEN: "mcp-secret-value" } } },
      projects: {
        [repositoryKey]: {
          allowedTools: currentAllowedTools,
          mcpServers: { project: { command: "project-mcp" } },
          lastCost: numStartups
        },
        "D:/unrelated-repository": {
          allowedTools: ["Unrelated"],
          lastCost: unrelatedLastCost
        }
      }
    });
    const capture = () => captureHarnessSnapshot({
      agentKind: "claude-code",
      installation: installation("claude-code"),
      repositoryPath,
      repositoryBaselineIdentity: "repository:baseline",
      homeDirectory,
      environment: { PATH: "fixture-path" },
      now: () => NOW
    });

    await fs.writeFile(statePath, JSON.stringify(state(1, ["Read"], 1)), "utf8");
    const first = await capture();
    await fs.writeFile(statePath, JSON.stringify(state(2, ["Read"], 999)), "utf8");
    const usageChurn = await capture();
    await fs.writeFile(statePath, JSON.stringify(state(3, ["Read", "Edit"], 1000)), "utf8");
    const changedHarness = await capture();

    assert.equal(first.snapshotId, usageChurn.snapshotId);
    assert.notEqual(first.snapshotId, changedHarness.snapshotId);
    assert.doesNotMatch(JSON.stringify(first), /mcp-secret-value/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Harness snapshots scope user state to the selected Harness", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-harness-scope-"));
  const repositoryPath = path.join(root, "repository");
  const homeDirectory = path.join(root, "home");
  const codexConfig = path.join(homeDirectory, ".codex", "config.toml");
  const claudeSettings = path.join(homeDirectory, ".claude", "settings.json");
  try {
    await fs.mkdir(repositoryPath, { recursive: true });
    await fs.mkdir(path.dirname(codexConfig), { recursive: true });
    await fs.mkdir(path.dirname(claudeSettings), { recursive: true });
    await fs.writeFile(codexConfig, 'model = "codex-one"\n', "utf8");
    await fs.writeFile(claudeSettings, '{"model":"claude-one"}', "utf8");

    const captureCodex = () => captureHarnessSnapshot({
      agentKind: "codex",
      installation: installation("codex"),
      repositoryPath,
      repositoryBaselineIdentity: "repository:baseline",
      homeDirectory,
      environment: {
        PATH: "fixture-path",
        CODEX_HOME: path.join(homeDirectory, ".codex"),
        CLAUDE_CONFIG_DIR: path.join(homeDirectory, ".claude"),
        OPENAI_BASE_URL: "https://codex.example/v1",
        ANTHROPIC_BASE_URL: "https://claude.example/v1"
      },
      now: () => NOW
    });

    const first = await captureCodex();
    await fs.writeFile(claudeSettings, '{"model":"claude-two"}', "utf8");
    const unrelatedClaudeChange = await captureCodex();
    await fs.writeFile(codexConfig, 'model = "codex-two"\n', "utf8");
    const codexChange = await captureCodex();

    assert.equal(first.snapshotId, unrelatedClaudeChange.snapshotId);
    assert.notEqual(first.snapshotId, codexChange.snapshotId);
    assert.equal(first.entries.some((entry) => entry.path === "user:.claude/settings.json"), false);
    assert.equal(first.entries.some((entry) => entry.path === "environment:ANTHROPIC_BASE_URL"), false);
    assert.equal(first.entries.some((entry) => entry.path === "environment:CLAUDE_CONFIG_DIR"), false);
    assert.equal(first.entries.some((entry) => entry.path === "environment:CODEX_HOME"), true);
    assert.equal(first.entries.some((entry) => entry.path === "environment:OPENAI_BASE_URL"), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Harness snapshots ignore Codex project trust churn but retain behavioral config changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-harness-codex-trust-"));
  const repositoryPath = path.join(root, "repository");
  const homeDirectory = path.join(root, "home");
  const codexHome = path.join(homeDirectory, ".codex");
  const configPath = path.join(codexHome, "config.toml");
  const baseConfig = [
    'model = "fixture-model"',
    '',
    '[projects."C:/existing"]',
    'trust_level = "trusted"',
    ''
  ].join("\n");
  try {
    await fs.mkdir(repositoryPath, { recursive: true });
    await fs.mkdir(codexHome, { recursive: true });
    const capture = () => captureHarnessSnapshot({
      agentKind: "codex",
      installation: installation("codex"),
      repositoryPath,
      repositoryBaselineIdentity: "repository:baseline",
      homeDirectory,
      environment: { PATH: "fixture-path", CODEX_HOME: codexHome },
      now: () => NOW
    });

    await fs.writeFile(configPath, baseConfig, "utf8");
    const first = await capture();
    await fs.writeFile(
      configPath,
      `${baseConfig}\n[projects.'C:/another-repository']\ntrust_level = "trusted"\n`,
      "utf8"
    );
    const trustChurn = await capture();
    await fs.writeFile(
      configPath,
      `${baseConfig.replace('fixture-model', 'changed-model')}\n[projects.'C:/another-repository']\ntrust_level = "trusted"\n`,
      "utf8"
    );
    const modelChanged = await capture();
    await fs.writeFile(
      configPath,
      `${baseConfig}\n[projects.'C:/another-repository']\ntrust_level = "trusted"\ntool_policy = "changed"\n`,
      "utf8"
    );
    const projectBehaviorChanged = await capture();

    assert.equal(first.snapshotId, trustChurn.snapshotId);
    assert.notEqual(first.snapshotId, modelChanged.snapshotId);
    assert.notEqual(first.snapshotId, projectBehaviorChanged.snapshotId);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Harness snapshots track stable Codex credential identity without token-refresh churn", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-harness-codex-auth-"));
  const repositoryPath = path.join(root, "repository");
  const homeDirectory = path.join(root, "home");
  const codexHome = path.join(homeDirectory, ".codex");
  const authPath = path.join(codexHome, "auth.json");
  try {
    await fs.mkdir(repositoryPath, { recursive: true });
    await fs.mkdir(codexHome, { recursive: true });
    const authState = (accountId, accessToken) => ({
      auth_mode: "chatgpt",
      tokens: {
        account_id: accountId,
        access_token: accessToken,
        refresh_token: `refresh-${accessToken}`
      },
      last_refresh: accessToken
    });
    const capture = () => captureHarnessSnapshot({
      agentKind: "codex",
      installation: installation("codex"),
      repositoryPath,
      repositoryBaselineIdentity: "repository:baseline",
      homeDirectory,
      environment: { PATH: "fixture-path", CODEX_HOME: codexHome },
      now: () => NOW
    });

    await fs.writeFile(authPath, JSON.stringify(authState("account-one", "token-one")), "utf8");
    const first = await capture();
    await fs.writeFile(authPath, JSON.stringify(authState("account-one", "token-two")), "utf8");
    const refreshed = await capture();
    await fs.writeFile(authPath, JSON.stringify(authState("account-two", "token-three")), "utf8");
    const switchedAccount = await capture();

    assert.equal(first.snapshotId, refreshed.snapshotId);
    assert.notEqual(first.snapshotId, switchedAccount.snapshotId);
    assert.equal(first.entries.some((entry) => entry.path === "user:.codex/auth.json"), true);
    assert.doesNotMatch(JSON.stringify(first), /token-one|refresh-token-one|account-one/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Harness snapshots invalidate local Codex readiness when an API key changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-harness-codex-api-key-"));
  const repositoryPath = path.join(root, "repository");
  const homeDirectory = path.join(root, "home");
  const codexHome = path.join(homeDirectory, ".codex");
  const authPath = path.join(codexHome, "auth.json");
  try {
    await fs.mkdir(repositoryPath, { recursive: true });
    await fs.mkdir(codexHome, { recursive: true });
    const capture = () => captureHarnessSnapshot({
      agentKind: "codex",
      installation: installation("codex"),
      repositoryPath,
      repositoryBaselineIdentity: "repository:baseline",
      homeDirectory,
      environment: { PATH: "fixture-path", CODEX_HOME: codexHome },
      now: () => NOW
    });

    await fs.writeFile(authPath, JSON.stringify({ OPENAI_API_KEY: "api-key-one" }), "utf8");
    const first = await capture();
    await fs.writeFile(authPath, JSON.stringify({ OPENAI_API_KEY: "api-key-two" }), "utf8");
    const changed = await capture();

    assert.notEqual(first.snapshotId, changed.snapshotId);
    assert.doesNotMatch(JSON.stringify(first), /api-key-one/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("managed Provider snapshots ignore host credentials that the LaunchSpec removes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-harness-managed-env-"));
  const repositoryPath = path.join(root, "repository");
  const homeDirectory = path.join(root, "home");
  try {
    await fs.mkdir(repositoryPath, { recursive: true });
    await fs.mkdir(homeDirectory, { recursive: true });
    const capture = (profileMode, apiKey) => captureHarnessSnapshot({
      agentKind: "codex",
      profileMode,
      installation: installation("codex"),
      repositoryPath,
      repositoryBaselineIdentity: "repository:baseline",
      homeDirectory,
      environment: { PATH: "fixture-path", OPENAI_API_KEY: apiKey },
      now: () => NOW
    });

    const inheritedFirst = await capture("inherit-local", "local-key-one");
    const inheritedChanged = await capture("inherit-local", "local-key-two");
    const managedFirst = await capture("managed-provider", "ignored-key-one");
    const managedChanged = await capture("managed-provider", "ignored-key-two");

    assert.notEqual(inheritedFirst.snapshotId, inheritedChanged.snapshotId);
    assert.equal(managedFirst.snapshotId, managedChanged.snapshotId);
    assert.equal(managedFirst.entries.some((entry) => entry.path === "environment:OPENAI_API_KEY"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("managed Provider snapshots ignore inherited local authentication files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-harness-managed-auth-"));
  const repositoryPath = path.join(root, "repository");
  const homeDirectory = path.join(root, "home");
  const codexHome = path.join(homeDirectory, ".codex");
  const authPath = path.join(codexHome, "auth.json");
  try {
    await fs.mkdir(repositoryPath, { recursive: true });
    await fs.mkdir(codexHome, { recursive: true });
    const capture = () => captureHarnessSnapshot({
      agentKind: "codex",
      profileMode: "managed-provider",
      installation: installation("codex"),
      repositoryPath,
      repositoryBaselineIdentity: "repository:baseline",
      homeDirectory,
      environment: { PATH: "fixture-path", CODEX_HOME: codexHome },
      now: () => NOW
    });

    await fs.writeFile(authPath, JSON.stringify({ OPENAI_API_KEY: "ignored-key-one" }), "utf8");
    const first = await capture();
    await fs.writeFile(authPath, JSON.stringify({ OPENAI_API_KEY: "ignored-key-two" }), "utf8");
    const changed = await capture();

    assert.equal(first.snapshotId, changed.snapshotId);
    assert.equal(first.entries.some((entry) => entry.path === "user:.codex/auth.json"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("launch argument materialization binds runtime paths without changing the frozen spec", () => {
  const install = installation("codex");
  const spec = resolveRuntimeLaunchSpec({
    profile: localProfile("codex"),
    installation: install,
    harnessSnapshot: snapshot("codex", install.fingerprint),
    repositoryBaselineIdentity: "repository:baseline",
    now: () => NOW,
    specId: "codex-bindings-spec"
  });
  const before = JSON.stringify(spec);
  const args = materializeRuntimeLaunchArguments(spec, {
    workspacePath: "C:/work/repository",
    prompt: "fixture prompt",
    outputPath: "C:/work/output.txt",
    sessionId: "fixture-session"
  });

  assert.ok(args.includes("C:/work/repository"));
  assert.ok(args.includes("C:/work/output.txt"));
  assert.equal(args.some((entry) => entry.includes("{{")), false);
  assert.equal(JSON.stringify(spec), before);
  assert.equal(Object.isFrozen(spec), true);
});

test("Codex launch skips the git repository check without injecting workspace trust", () => {
  const install = installation("codex");
  const spec = resolveRuntimeLaunchSpec({
    profile: localProfile("codex"),
    installation: install,
    harnessSnapshot: snapshot("codex", install.fingerprint),
    repositoryBaselineIdentity: "repository:baseline",
    now: () => NOW,
    specId: "codex-trust-spec"
  });
  const workspacePath = `C:\\work\\Agent"Arena's\\repository`;
  const args = materializeRuntimeLaunchArguments(spec, {
    workspacePath,
    prompt: "fixture prompt",
    outputPath: "C:/work/output.txt",
    sessionId: "fixture-session"
  });
  const serializesWorkspaceTrust = (entry) =>
    entry.includes("codexWorkspaceTrustOverride") ||
    entry.includes("trust_level") ||
    entry.startsWith("projects=");

  assert.ok(spec.command.argsTemplate.includes("--skip-git-repo-check"));
  assert.equal(spec.command.argsTemplate.some(serializesWorkspaceTrust), false);
  assert.equal(args.some(serializesWorkspaceTrust), false);
});

test("launch environment materialization injects Secrets only in memory", async () => {
  const install = installation("codex");
  const spec = resolveRuntimeLaunchSpec({
    profile: managedProfile("codex"),
    installation: install,
    harnessSnapshot: snapshot("codex", install.fingerprint),
    repositoryBaselineIdentity: "repository:baseline",
    now: () => NOW,
    specId: "codex-secret-spec"
  });
  const serializedBefore = JSON.stringify(spec);
  const environment = await materializeRuntimeLaunchEnvironment(
    spec,
    { PATH: "fixture-path", REMOVE_ME: "old-value" },
    async (secretRef, secretRevision) => {
      assert.equal(secretRef, "runtime-profile/codex/codex-managed");
      assert.equal(secretRevision, 3);
      return "fixture-secret-value";
    }
  );

  assert.equal(environment.PATH, "fixture-path");
  assert.equal(environment.PROVIDER_REGION, "test-region");
  assert.equal(environment.AGENTARENA_CODEX_PROVIDER_KEY, "fixture-secret-value");
  assert.equal(JSON.stringify(spec), serializedBefore);
  assert.doesNotMatch(serializedBefore, /fixture-secret-value/);
});

test("managed Provider launches remove inherited routing credentials without dropping ordinary environment", async () => {
  const codexProfile = managedProfile("codex");
  const claudeProfile = managedProfile("claude-code");
  const codexInstall = installation("codex");
  const claudeInstall = installation("claude-code");
  const codexSpec = resolveRuntimeLaunchSpec({
    profile: codexProfile,
    installation: codexInstall,
    harnessSnapshot: snapshot("codex", codexInstall.fingerprint),
    repositoryBaselineIdentity: "repository:baseline",
    now: () => NOW
  });
  const claudeSpec = resolveRuntimeLaunchSpec({
    profile: claudeProfile,
    installation: claudeInstall,
    harnessSnapshot: snapshot("claude-code", claudeInstall.fingerprint),
    repositoryBaselineIdentity: "repository:baseline",
    now: () => NOW
  });

  const inherited = {
    PATH: "fixture-path",
    KEEP_ME: "ordinary-value",
    OPENAI_API_KEY: "inherited-openai-key",
    OPENAI_BASE_URL: "https://inherited-openai.example/v1",
    ANTHROPIC_API_KEY: "inherited-anthropic-key",
    ANTHROPIC_AUTH_TOKEN: "inherited-anthropic-token",
    ANTHROPIC_BASE_URL: "https://inherited-anthropic.example/v1",
    ANTHROPIC_MODEL: "inherited-model",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "inherited-sonnet",
    CLAUDE_CODE_OAUTH_TOKEN: "inherited-oauth",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_FOUNDRY: "1",
    CLAUDE_CODE_USE_VERTEX: "1"
  };
  const codexEnvironment = await materializeRuntimeLaunchEnvironment(
    codexSpec,
    inherited,
    async () => "managed-codex-secret"
  );
  const claudeEnvironment = await materializeRuntimeLaunchEnvironment(
    claudeSpec,
    inherited,
    async () => "managed-claude-secret"
  );

  assert.equal(codexEnvironment.KEEP_ME, "ordinary-value");
  assert.equal(codexEnvironment.OPENAI_API_KEY, undefined);
  assert.equal(codexEnvironment.OPENAI_BASE_URL, undefined);
  assert.equal(codexEnvironment.AGENTARENA_CODEX_PROVIDER_KEY, "managed-codex-secret");

  assert.equal(claudeEnvironment.KEEP_ME, "ordinary-value");
  assert.equal(claudeEnvironment.ANTHROPIC_API_KEY, undefined);
  assert.equal(claudeEnvironment.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(claudeEnvironment.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(claudeEnvironment.CLAUDE_CODE_USE_FOUNDRY, undefined);
  assert.equal(claudeEnvironment.CLAUDE_CODE_USE_VERTEX, undefined);
  assert.equal(claudeEnvironment.ANTHROPIC_AUTH_TOKEN, "managed-claude-secret");
  assert.equal(claudeEnvironment.ANTHROPIC_BASE_URL, claudeProfile.provider.baseUrl);
  assert.equal(claudeEnvironment.ANTHROPIC_MODEL, claudeProfile.provider.requestedModel);
  assert.equal(claudeEnvironment.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-sonnet-routed");
});

async function createAdapterFixture(root) {
  const scriptPath = path.join(root, "runtime-shim.mjs");
  const capturePath = path.join(root, "capture.json");
  await fs.writeFile(
    scriptPath,
    [
      'import fs from "node:fs";',
      'const args = process.argv.slice(2);',
      'let stdin = "";',
      'for await (const chunk of process.stdin) stdin += chunk;',
      'const capture = { args, stdin, secret: process.env.AGENTARENA_CODEX_PROVIDER_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN };',
      'fs.writeFileSync(process.env.AGENTARENA_RUNTIME_CAPTURE, JSON.stringify(capture), "utf8");',
      'const outputIndex = args.indexOf("--output-last-message");',
      'if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], "fixture completed", "utf8");',
      'if (args.includes("exec")) {',
      '  console.log(JSON.stringify({ type: "thread.started", thread_id: "fixture-thread" }));',
      '  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 2, output_tokens: 3 } }));',
      '} else {',
      '  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "fixture-session" }));',
      '  console.log(JSON.stringify({ type: "result", subtype: "success", result: "fixture completed", total_cost_usd: 0.01, usage: { input_tokens: 2, output_tokens: 3 } }));',
      '}'
    ].join("\n"),
    "utf8"
  );
  return { scriptPath, capturePath };
}

function adapterContext(agentKind, workspacePath, environment, resolvedLaunchSpec, runtimeSecretValues = {}) {
  return {
    agentId: agentKind === "codex" ? "codex" : "claude-code",
    selection: {
      baseAgentId: agentKind === "codex" ? "codex" : "claude-code",
      variantId: `${agentKind}-frozen`,
      displayLabel: `${agentKind} frozen`,
      config: agentKind === "claude-code" ? { providerProfileId: "claude-official" } : {},
      configSource: "test"
    },
    repoPath: workspacePath,
    workspacePath,
    environment,
    resolvedLaunchSpec,
    runtimeSecretValues,
    task: {
      schemaVersion: "agentarena.taskpack/v1",
      id: `${agentKind}-frozen-task`,
      title: "Frozen launch task",
      prompt: "Make the fixture change.",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    }
  };
}

test("Codex adapter executes the frozen Spec instead of re-resolving legacy sandbox configuration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-codex-frozen-"));
  try {
    const { scriptPath, capturePath } = await createAdapterFixture(root);
    const install = installation("codex", {
      executable: process.execPath,
      argsPrefix: [scriptPath],
      displayCommand: `${process.execPath} ${scriptPath}`
    });
    const spec = resolveRuntimeLaunchSpec({
      profile: localProfile("codex"),
      installation: install,
      harnessSnapshot: snapshot("codex", install.fingerprint),
      repositoryBaselineIdentity: "repository:baseline",
      now: () => NOW,
      specId: "codex-adapter-spec"
    });
    const traces = [];
    const context = adapterContext(
      "codex",
      root,
      {
        ...process.env,
        AGENTARENA_RUNTIME_CAPTURE: capturePath,
        AGENTARENA_CODEX_SANDBOX: "danger-full-access"
      },
      spec
    );
    context.trace = async (event) => traces.push(event);

    const result = await getAdapter("codex").execute(context);
    const capture = JSON.parse(await fs.readFile(capturePath, "utf8"));
    const serializedTrace = JSON.stringify(traces);

    assert.equal(result.status, "success");
    if (process.platform === "win32") {
      assert.ok(capture.args.includes("--dangerously-bypass-approvals-and-sandbox"));
    } else {
      assert.ok(capture.args.includes("workspace-write"));
    }
    assert.ok(capture.args.some((entry) => entry.includes("approval_policy")));
    assert.equal(
      capture.args.includes("--dangerously-bypass-approvals-and-sandbox"),
      process.platform === "win32"
    );
    assert.equal(capture.stdin.includes("Make the fixture change."), true);
    assert.match(serializedTrace, new RegExp(spec.launchSpecHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Claude adapter executes a frozen dontAsk Spec without the legacy full-permission gate", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-claude-frozen-"));
  const previousSkipPermissions = process.env.AGENTARENA_SKIP_PERMISSIONS;
  try {
    delete process.env.AGENTARENA_SKIP_PERMISSIONS;
    const { scriptPath, capturePath } = await createAdapterFixture(root);
    const profile = managedProfile("claude-code");
    const install = installation("claude-code", {
      executable: process.execPath,
      argsPrefix: [scriptPath],
      displayCommand: `${process.execPath} ${scriptPath}`
    });
    const spec = resolveRuntimeLaunchSpec({
      profile,
      installation: install,
      harnessSnapshot: snapshot("claude-code", install.fingerprint),
      repositoryBaselineIdentity: "repository:baseline",
      now: () => NOW,
      specId: "claude-adapter-spec"
    });
    const traces = [];
    const context = adapterContext(
      "claude-code",
      root,
      { ...process.env, AGENTARENA_RUNTIME_CAPTURE: capturePath },
      spec,
      { [profile.provider.secretRef]: "fixture-secret-value" }
    );
    context.trace = async (event) => traces.push(event);

    const result = await getAdapter("claude-code").execute(context);
    const capture = JSON.parse(await fs.readFile(capturePath, "utf8"));
    const serializedTrace = JSON.stringify(traces);

    assert.equal(result.status, "success");
    assert.ok(capture.args.includes("dontAsk"));
    assert.ok(capture.args.includes("user,project,local"));
    assert.equal(capture.args.includes("--dangerously-skip-permissions"), false);
    assert.equal(capture.args.includes("--strict-mcp-config"), false);
    assert.equal(capture.secret, "fixture-secret-value");
    assert.doesNotMatch(serializedTrace, /fixture-secret-value/);
    assert.match(serializedTrace, new RegExp(spec.launchSpecHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    if (previousSkipPermissions === undefined) delete process.env.AGENTARENA_SKIP_PERMISSIONS;
    else process.env.AGENTARENA_SKIP_PERMISSIONS = previousSkipPermissions;
    await fs.rm(root, { recursive: true, force: true });
  }
});
