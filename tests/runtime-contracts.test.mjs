import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalRuntimeJson,
  createResolvedLaunchSpec,
  hashRuntimeIdentity,
  isVerificationReceiptValid,
  RESOLVED_LAUNCH_SPEC_SCHEMA_V1,
  RUNTIME_PROFILE_SCHEMA_V1,
  toPublicResolvedLaunchSpec,
  toPublicRuntimeProfile,
  validateRuntimeProfile
} from "../packages/core/dist/index.js";

function managedProfile(overrides = {}) {
  return {
    schemaVersion: RUNTIME_PROFILE_SCHEMA_V1,
    id: "codex-provider-one",
    name: "Provider One",
    agentKind: "codex",
    mode: "managed-provider",
    revision: 1,
    secretRevision: 1,
    provider: {
      baseUrl: "https://api.example.com/v1",
      protocol: "openai-responses",
      requestedModel: "gpt-5.4",
      secretRef: "runtime-profile/codex/codex-provider-one"
    },
    extraEnv: {},
    riskFlags: ["third-party-provider"],
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    ...overrides
  };
}

function launchDraft(overrides = {}) {
  return {
    schemaVersion: RESOLVED_LAUNCH_SPEC_SCHEMA_V1,
    specId: "launch-one",
    createdAt: "2026-08-12T00:00:00.000Z",
    agentKind: "codex",
    profile: {
      id: "codex-provider-one",
      revision: 1,
      secretRevision: 1
    },
    installation: {
      id: "codex-installation",
      fingerprint: "installation:one",
      version: "0.145.0"
    },
    harnessSnapshotId: "harness:one",
    repositoryBaselineIdentity: "repo:one",
    command: {
      executable: "C:/tools/codex.exe",
      argsPrefix: [],
      argsTemplate: ["exec", "--sandbox", "workspace-write", "--cd", "{{workspacePath}}", "-"]
    },
    environment: {
      inheritHost: true,
      overrides: {
        OPENAI_BASE_URL: "https://api.example.com/v1"
      },
      unset: [],
      secretBindings: [
        {
          environmentVariable: "OPENAI_API_KEY",
          secretRef: "runtime-profile/codex/codex-provider-one",
          secretRevision: 1
        }
      ]
    },
    runtime: {
      providerKind: "openai-compatible",
      requestedModel: "gpt-5.4",
      canonicalModelIdentity: "openai/gpt-5.4",
      modelIdentitySource: "declared",
      reasoningEffort: "high",
      providerPolicyIdentity: "provider-policy:one",
      modelParametersIdentity: "model-parameters:one"
    },
    permissions: {
      mode: "workspace-write",
      unattended: true,
      fullBypass: false
    },
    timeouts: {
      startupMs: 30_000,
      idleMs: 120_000,
      totalMs: 900_000
    },
    mutableBindings: ["workspacePath", "prompt", "outputPath", "sessionId"],
    ...overrides
  };
}

test("runtime profiles accept only the first-version Harnesses", () => {
  assert.deepEqual(validateRuntimeProfile(managedProfile()), []);
  assert.match(
    validateRuntimeProfile(managedProfile({ agentKind: "gemini-cli" }))[0],
    /codex|claude-code/i
  );
});

test("managed runtime profiles require Provider, model, and secret references", () => {
  const profile = managedProfile({
    provider: {
      baseUrl: "",
      protocol: "openai-responses",
      requestedModel: "",
      secretRef: ""
    }
  });
  const errors = validateRuntimeProfile(profile).join("\n");
  assert.match(errors, /baseUrl/);
  assert.match(errors, /requestedModel/);
  assert.match(errors, /secretRef/);
});

test("runtime profiles reject sensitive or runtime-control extra environment fields", () => {
  for (const key of [
    "OPENAI_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_AWS_BASE_URL",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AZURE_CLIENT_SECRET",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "PATH"
  ]) {
    const errors = validateRuntimeProfile(managedProfile({ extraEnv: { [key]: "must-not-persist" } }));
    assert.ok(errors.some((message) => message.includes(key)), `${key} should be rejected`);
  }
});

test("public runtime profiles expose environment keys but never their values", () => {
  const profile = managedProfile({ extraEnv: { PROVIDER_REGION: "private-region-value" } });
  const publicProfile = toPublicRuntimeProfile(profile, true);
  const serialized = JSON.stringify(publicProfile);

  assert.deepEqual(publicProfile.extraEnvKeys, ["PROVIDER_REGION"]);
  assert.equal(publicProfile.secretStored, true);
  assert.doesNotMatch(serialized, /private-region-value/);
  assert.doesNotMatch(serialized, /secretRef/);
});

test("public launch specs expose environment keys but never their values", () => {
  const launch = createResolvedLaunchSpec(launchDraft({
    environment: {
      ...launchDraft().environment,
      overrides: {
        OPENAI_BASE_URL: "https://private-provider.example/v1",
        PROVIDER_REGION: "private-region-value"
      }
    }
  }));
  const publicLaunch = toPublicResolvedLaunchSpec(launch);
  const serialized = JSON.stringify(publicLaunch);

  assert.deepEqual(publicLaunch.environment.overrideKeys, ["OPENAI_BASE_URL", "PROVIDER_REGION"]);
  assert.doesNotMatch(serialized, /private-provider|private-region-value|secretRef/);
});

test("canonical runtime identity is stable across object key insertion order", () => {
  const left = { beta: [3, { y: true, x: null }], alpha: "one" };
  const right = { alpha: "one", beta: [3, { x: null, y: true }] };

  assert.equal(canonicalRuntimeJson(left), canonicalRuntimeJson(right));
  assert.equal(hashRuntimeIdentity("test", left), hashRuntimeIdentity("test", right));
});

test("launch identity ignores record metadata but changes for behavioral fields", () => {
  const original = createResolvedLaunchSpec(launchDraft());
  const sameBehavior = createResolvedLaunchSpec(
    launchDraft({ specId: "launch-two", createdAt: "2026-08-13T00:00:00.000Z" })
  );
  const changedModel = createResolvedLaunchSpec(
    launchDraft({
      runtime: {
        ...launchDraft().runtime,
        requestedModel: "gpt-5.5"
      }
    })
  );
  const changedPermissions = createResolvedLaunchSpec(
    launchDraft({ permissions: { mode: "danger-full-access", unattended: true, fullBypass: true } })
  );
  const changedProviderPolicy = createResolvedLaunchSpec(
    launchDraft({
      runtime: {
        ...launchDraft().runtime,
        providerPolicyIdentity: "provider-policy:two"
      }
    })
  );

  assert.equal(original.launchSpecHash, sameBehavior.launchSpecHash);
  assert.notEqual(original.launchSpecHash, changedModel.launchSpecHash);
  assert.notEqual(original.launchSpecHash, changedPermissions.launchSpecHash);
  assert.notEqual(original.launchSpecHash, changedProviderPolicy.launchSpecHash);
});

test("verification receipts are valid only for the exact frozen identities", () => {
  const launch = createResolvedLaunchSpec(launchDraft());
  const receipt = {
    schemaVersion: "agentarena.verification-receipt/v1",
    receiptId: "receipt-one",
    createdAt: "2026-08-12T00:00:00.000Z",
    launchSpecHash: launch.launchSpecHash,
    profileId: launch.profile.id,
    profileRevision: launch.profile.revision,
    secretRevision: launch.profile.secretRevision,
    installationFingerprint: launch.installation.fingerprint,
    harnessSnapshotId: launch.harnessSnapshotId,
    repositoryBaselineIdentity: launch.repositoryBaselineIdentity,
    readiness: "task-ready",
    stages: []
  };

  assert.equal(isVerificationReceiptValid(receipt, launch), true);
  assert.equal(
    isVerificationReceiptValid({ ...receipt, secretRevision: receipt.secretRevision + 1 }, launch),
    false
  );
  assert.equal(
    isVerificationReceiptValid({ ...receipt, repositoryBaselineIdentity: "repo:changed" }, launch),
    false
  );
  assert.equal(
    isVerificationReceiptValid({ ...receipt, launchSpecHash: "launch:changed" }, launch),
    false
  );
});
