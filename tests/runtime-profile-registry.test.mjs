import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  __runtimeProfileRegistryTestUtils,
  deleteRuntimeProfile,
  getRuntimeProfile,
  getRuntimeProfileSecret,
  listPublicRuntimeProfiles,
  listRuntimeProfiles,
  saveRuntimeProfile,
  setRuntimeProfileSecret
} from "../packages/adapters/dist/index.js";

async function withTempRegistry(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-runtime-profiles-"));
  const keys = [
    "AGENTARENA_RUNTIME_PROFILE_ROOT",
    "AGENTARENA_RUNTIME_PROFILES_FILE",
    "AGENTARENA_RUNTIME_SECRET_BACKEND",
    "AGENTARENA_CLAUDE_PROFILE_ROOT",
    "AGENTARENA_CLAUDE_PROFILES_FILE",
    "AGENTARENA_SKIP_DNS_CHECK"
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.AGENTARENA_RUNTIME_PROFILE_ROOT = root;
  process.env.AGENTARENA_RUNTIME_PROFILES_FILE = path.join(root, "runtime-profiles.json");
  process.env.AGENTARENA_RUNTIME_SECRET_BACKEND = "file";
  process.env.AGENTARENA_CLAUDE_PROFILE_ROOT = root;
  process.env.AGENTARENA_CLAUDE_PROFILES_FILE = path.join(root, "claude-provider-profiles.json");
  process.env.AGENTARENA_SKIP_DNS_CHECK = "1";

  try {
    await run(root);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

function managedInput(agentKind, overrides = {}) {
  return {
    name: agentKind === "codex" ? "Codex Provider" : "Claude Provider",
    agentKind,
    mode: "managed-provider",
    provider: {
      baseUrl: "https://api.openai.com/v1",
      protocol: agentKind === "codex" ? "openai-responses" : "anthropic-messages",
      requestedModel: agentKind === "codex" ? "gpt-5.4" : "claude-sonnet-4-5",
      canonicalModelIdentity: "shared/test-model",
      modelIdentitySource: "declared"
    },
    extraEnv: { PROVIDER_REGION: "test" },
    _confirmBaseUrlRisk: true,
    ...overrides
  };
}

test("runtime registry always exposes Codex and Claude local profiles", async () => {
  await withTempRegistry(async () => {
    const profiles = await listRuntimeProfiles();
    assert.deepEqual(
      profiles.map((profile) => [profile.id, profile.agentKind, profile.mode, profile.isBuiltIn]),
      [
        ["codex-local", "codex", "inherit-local", true],
        ["claude-local", "claude-code", "inherit-local", true]
      ]
    );
  });
});

test("runtime registry persists managed Codex and Claude profiles", async () => {
  await withTempRegistry(async () => {
    const codex = await saveRuntimeProfile(managedInput("codex"));
    const claude = await saveRuntimeProfile(managedInput("claude-code"));

    assert.match(codex.id, /^codex-/);
    assert.match(claude.id, /^claude-/);
    assert.equal(codex.revision, 1);
    assert.equal(claude.revision, 1);

    const persisted = await listRuntimeProfiles();
    assert.ok(persisted.some((profile) => profile.id === codex.id));
    assert.ok(persisted.some((profile) => profile.id === claude.id));

    const raw = await fs.readFile(__runtimeProfileRegistryTestUtils.registryPath(), "utf8");
    assert.doesNotMatch(raw, /api-key-value|auth-token-value/);
  });
});

test("runtime registry persists local model and reasoning overrides without Provider routing", async () => {
  await withTempRegistry(async () => {
    const profile = await saveRuntimeProfile({
      id: "codex-local-model",
      name: "Codex Local Model",
      agentKind: "codex",
      mode: "inherit-local",
      provider: {
        requestedModel: "gpt-5.6-luna",
        canonicalModelIdentity: "gpt-5.6-luna",
        modelIdentitySource: "declared",
        reasoningEffort: "max"
      },
      extraEnv: {},
      riskFlags: []
    });

    assert.deepEqual(profile.provider, {
      requestedModel: "gpt-5.6-luna",
      canonicalModelIdentity: "gpt-5.6-luna",
      modelIdentitySource: "declared",
      reasoningEffort: "max"
    });
    const publicProfile = (await listPublicRuntimeProfiles()).find((entry) => entry.id === profile.id);
    assert.deepEqual(publicProfile.provider, profile.provider);
    assert.equal(publicProfile.secretStored, false);
  });
});

test("profile and secret edits increment independent revisions", async () => {
  await withTempRegistry(async () => {
    const created = await saveRuntimeProfile(managedInput("codex"));
    const edited = await saveRuntimeProfile(
      managedInput("codex", {
        id: created.id,
        name: "Renamed Codex Provider"
      })
    );

    assert.equal(edited.revision, 2);
    assert.equal(edited.secretRevision, 1);

    const withSecret = await setRuntimeProfileSecret(created.id, "api-key-value");
    assert.equal(withSecret.revision, 2);
    assert.equal(withSecret.secretRevision, 2);
    assert.equal(await getRuntimeProfileSecret(created.id), "api-key-value");

    const publicProfile = (await listPublicRuntimeProfiles()).find((profile) => profile.id === created.id);
    assert.equal(publicProfile.secretStored, true);
    assert.deepEqual(publicProfile.extraEnvKeys, ["PROVIDER_REGION"]);
    assert.doesNotMatch(JSON.stringify(publicProfile), /api-key-value|secretRef/);
  });
});

test("profile updates preserve hidden extra environment values unless explicitly replaced", async () => {
  await withTempRegistry(async () => {
    const created = await saveRuntimeProfile(managedInput("codex"));
    const updateWithoutEnvironment = managedInput("codex", {
      id: created.id,
      name: "Renamed without environment payload"
    });
    delete updateWithoutEnvironment.extraEnv;

    const preserved = await saveRuntimeProfile(updateWithoutEnvironment);
    assert.deepEqual(preserved.extraEnv, { PROVIDER_REGION: "test" });

    const cleared = await saveRuntimeProfile(managedInput("codex", {
      id: created.id,
      extraEnv: {}
    }));
    assert.deepEqual(cleared.extraEnv, {});
  });
});

test("runtime profile save rejects reserved environment fields and internal Provider URLs", async () => {
  await withTempRegistry(async () => {
    await assert.rejects(
      () => saveRuntimeProfile(managedInput("codex", { extraEnv: { OPENAI_API_KEY: "bad" } })),
      /OPENAI_API_KEY/
    );
    await assert.rejects(
      () => saveRuntimeProfile(managedInput("claude-code", {
        provider: {
          ...managedInput("claude-code").provider,
          baseUrl: "http://127.0.0.1:8080"
        }
      })),
      /internal|private|ssrf/i
    );
  });
});

test("legacy Claude profiles migrate idempotently without rewriting the legacy registry", async () => {
  await withTempRegistry(async () => {
    const legacyPath = __runtimeProfileRegistryTestUtils.legacyClaudeRegistryPath();
    const legacy = {
      schemaVersion: 1,
      profiles: [
        {
          id: "legacy-one",
          name: "Legacy One",
          kind: "anthropic-compatible",
          baseUrl: "https://api.anthropic.com",
          apiFormat: "anthropic-messages",
          primaryModel: "claude-sonnet-4-5",
          defaultSonnetModel: "claude-sonnet-4-5",
          extraEnv: { LEGACY_REGION: "one" },
          writeCommonConfig: true,
          notes: "keep me",
          riskFlags: ["third-party-provider", "user-managed-secret"]
        }
      ]
    };
    await fs.writeFile(legacyPath, JSON.stringify(legacy, null, 2), "utf8");
    const before = await fs.readFile(legacyPath);

    const first = await listRuntimeProfiles();
    const second = await listRuntimeProfiles();
    const migrated = first.find((profile) => profile.id === "claude-legacy-one");

    assert.ok(migrated);
    assert.equal(migrated.agentKind, "claude-code");
    assert.equal(migrated.provider.requestedModel, "claude-sonnet-4-5");
    assert.equal(migrated.provider.secretRef, "legacy-claude/legacy-one");
    assert.equal(second.filter((profile) => profile.id === "claude-legacy-one").length, 1);
    assert.deepEqual(await fs.readFile(legacyPath), before);
  });
});

test("deleting a managed profile removes only AgentArena profile data", async () => {
  await withTempRegistry(async (root) => {
    const userCodexConfig = path.join(root, "user-config.toml");
    const userClaudeSettings = path.join(root, "user-settings.json");
    await fs.writeFile(userCodexConfig, "model = 'keep'\n", "utf8");
    await fs.writeFile(userClaudeSettings, '{"keep":true}\n', "utf8");
    const codexBefore = await fs.readFile(userCodexConfig);
    const claudeBefore = await fs.readFile(userClaudeSettings);

    const profile = await saveRuntimeProfile(managedInput("claude-code"));
    await setRuntimeProfileSecret(profile.id, "auth-token-value");
    await deleteRuntimeProfile(profile.id);

    await assert.rejects(() => getRuntimeProfile(profile.id), /unknown/i);
    assert.equal(await getRuntimeProfileSecret(profile.id), null);
    assert.deepEqual(await fs.readFile(userCodexConfig), codexBefore);
    assert.deepEqual(await fs.readFile(userClaudeSettings), claudeBefore);
  });
});
