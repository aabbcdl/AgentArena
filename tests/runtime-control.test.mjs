import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  resolveRuntimeProfileLaunch,
  saveRuntimeProfile,
  setRuntimeProfileSecret
} from "../packages/adapters/dist/index.js";
import { toPublicResolvedLaunchSpec } from "../packages/core/dist/index.js";

async function withRuntimeControlFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-runtime-control-"));
  const repositoryPath = path.join(root, "repository");
  const cliPath = path.join(root, "fake-codex.mjs");
  const previous = Object.fromEntries(
    [
      "AGENTARENA_RUNTIME_PROFILE_ROOT",
      "AGENTARENA_RUNTIME_PROFILES_FILE",
      "AGENTARENA_RUNTIME_SECRET_BACKEND",
      "AGENTARENA_SKIP_DNS_CHECK"
    ].map((name) => [name, process.env[name]])
  );
  await fs.mkdir(repositoryPath, { recursive: true });
  await fs.writeFile(path.join(repositoryPath, "README.md"), "runtime control fixture\n", "utf8");
  await fs.writeFile(
    cliPath,
    [
      'const args = process.argv.slice(2);',
      'if (args.includes("--version")) console.log("codex-cli 0.145.0");',
      'else console.log("--config --sandbox workspace-write --json --output-last-message");'
    ].join("\n"),
    "utf8"
  );
  process.env.AGENTARENA_RUNTIME_PROFILE_ROOT = root;
  process.env.AGENTARENA_RUNTIME_PROFILES_FILE = path.join(root, "runtime-profiles.json");
  process.env.AGENTARENA_RUNTIME_SECRET_BACKEND = "file";
  process.env.AGENTARENA_SKIP_DNS_CHECK = "1";
  try {
    const profile = await saveRuntimeProfile({
      id: "codex-control",
      name: "Codex Control",
      agentKind: "codex",
      mode: "managed-provider",
      commandPath: cliPath,
      provider: {
        baseUrl: "https://provider.example.test/v1",
        protocol: "openai-responses",
        requestedModel: "gpt-control",
        canonicalModelIdentity: "provider/gpt-control",
        modelIdentitySource: "declared"
      },
      extraEnv: { PROVIDER_REGION: "test" },
      riskFlags: ["third-party-provider"],
      _confirmBaseUrlRisk: true
    });
    await setRuntimeProfileSecret(profile.id, "runtime-control-secret");
    await run({ root, repositoryPath, profile });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("runtime control resolves an unchanged Profile, installation, Harness, and repository to one stable launch", async () => {
  await withRuntimeControlFixture(async ({ root, repositoryPath, profile }) => {
    const options = {
      profileId: profile.id,
      repositoryPath,
      repositoryBaselineIdentity: "repository:control",
      homeDirectory: root,
      environment: { ...process.env, HOME: root, USERPROFILE: root },
      now: () => "2026-08-12T00:00:00.000Z"
    };
    const first = await resolveRuntimeProfileLaunch(options);
    const repeated = await resolveRuntimeProfileLaunch(options);

    assert.equal(first.launchSpec.launchSpecHash, repeated.launchSpec.launchSpecHash);
    assert.equal(first.installation.id, repeated.installation.id);
    assert.equal(first.profile.id, profile.id);
    assert.equal(first.launchSpec.profile.secretRevision, 2);
    assert.deepEqual(Object.values(first.runtimeSecretValues), ["runtime-control-secret"]);

    const publicSpec = toPublicResolvedLaunchSpec(first.launchSpec);
    const serialized = JSON.stringify(publicSpec);
    assert.doesNotMatch(serialized, /runtime-control-secret|runtime-profile\/codex/);
    assert.equal(publicSpec.environment.secretBindings[0].configured, true);
  });
});

test("runtime control refuses a managed Profile when its task-scoped Secret is unavailable", async () => {
  await withRuntimeControlFixture(async ({ root, repositoryPath, profile }) => {
    await setRuntimeProfileSecret(profile.id, "");
    await assert.rejects(
      resolveRuntimeProfileLaunch({
        profileId: profile.id,
        repositoryPath,
        repositoryBaselineIdentity: "repository:control",
        homeDirectory: root,
        environment: { ...process.env, HOME: root, USERPROFILE: root }
      }),
      /secret.*unavailable|secret.*required/i
    );
  });
});

test("runtime control snapshots inherited Codex defaults into the frozen launch", async () => {
  await withRuntimeControlFixture(async ({ root, repositoryPath }) => {
    const codexHome = path.join(root, "codex-home");
    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(
      path.join(codexHome, "config.toml"),
      'model = "fixture-model"\nmodel_reasoning_effort = "high"\n',
      "utf8"
    );
    const profile = await saveRuntimeProfile({
      id: "codex-local-override",
      name: "Codex Local Override",
      agentKind: "codex",
      mode: "inherit-local",
      commandPath: path.join(root, "fake-codex.mjs"),
      provider: {
        requestedModel: "fixture-model",
        canonicalModelIdentity: "fixture-model",
        modelIdentitySource: "declared"
      },
      extraEnv: {},
      riskFlags: []
    });

    const resolved = await resolveRuntimeProfileLaunch({
      profileId: profile.id,
      repositoryPath,
      repositoryBaselineIdentity: "repository:control",
      homeDirectory: root,
      environment: { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: codexHome },
      now: () => "2026-08-12T00:00:00.000Z",
      resolveSecrets: false
    });

    assert.equal(resolved.launchSpec.runtime.requestedModel, "fixture-model");
    assert.equal(resolved.launchSpec.runtime.reasoningEffort, "high");
    assert.equal(resolved.launchSpec.runtime.source, "ui");
    assert.match(JSON.stringify(resolved.launchSpec.command.argsTemplate), /model=\\"fixture-model\\"/);
    assert.match(JSON.stringify(resolved.launchSpec.command.argsTemplate), /model_reasoning_effort=\\"high\\"/);
  });
});
