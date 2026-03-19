import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildClaudeProviderEnvironment,
  deleteClaudeProviderProfile,
  getClaudeProviderProfileSecret,
  listClaudeProviderProfiles,
  saveClaudeProviderProfile,
  setClaudeProviderProfileSecret,
  supportsWindowsCredentialManager,
  writeClaudeWorkspaceSettings
} from "../packages/adapters/dist/claude-provider-profiles.js";
import { __testUtils, getAdapter, listAvailableAdapters } from "../packages/adapters/dist/index.js";

test("listAvailableAdapters exposes capability metadata", () => {
  const adapters = listAvailableAdapters();
  const codex = adapters.find((adapter) => adapter.id === "codex");
  const cursor = adapters.find((adapter) => adapter.id === "cursor");

  assert.ok(codex);
  assert.equal(codex.capability.supportTier, "supported");
  assert.equal(codex.capability.tokenAvailability, "available");
  assert.equal(codex.capability.costAvailability, "unavailable");

  assert.ok(cursor);
  assert.equal(cursor.capability.supportTier, "experimental");
  assert.match(cursor.capability.invocationMethod, /Cursor/i);
});

test("demo adapter execution returns normalized benchmark output", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-adapters-"));
  const workspacePath = path.join(tempDir, "workspace");
  await mkdir(workspacePath, { recursive: true });

  const adapter = getAdapter("demo-fast");
  const result = await adapter.execute({
    agentId: "demo-fast",
    repoPath: tempDir,
    workspacePath,
    environment: process.env,
    task: {
      schemaVersion: "repoarena.taskpack/v1",
      id: "demo-task",
      title: "Demo Task",
      prompt: "Create a minimal change.",
      envAllowList: [],
      setupCommands: [],
      judges: [],
      teardownCommands: []
    },
    trace: async () => {}
  });

  assert.equal(result.status, "success");
  assert.equal(result.costKnown, true);
  assert.equal(result.changedFilesHint.length > 0, true);
  assert.match(result.summary, /demo adapter path/i);

  await rm(tempDir, { recursive: true, force: true });
});

test("parseCodexEvents extracts file changes, tokens, and thread ids", () => {
  const stdout = [
    JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "file_change",
        changes: [{ path: "C:\\temp\\workspace\\src\\index.ts" }]
      }
    }),
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 10, cached_input_tokens: 5, output_tokens: 3 }
    }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Codex finished." }
    }),
    JSON.stringify({
      type: "turn.completed",
      model: "gpt-5.4",
      model_reasoning_effort: "high"
    })
  ].join("\n");

  const parsed = __testUtils.parseCodexEvents(stdout, "C:\\temp\\workspace");
  assert.deepEqual(parsed.changedFilesHint, ["src/index.ts"]);
  assert.equal(parsed.tokenUsage, 18);
  assert.equal(parsed.threadId, "thread-123");
  assert.equal(parsed.summaryFromEvents, "Codex finished.");
  assert.equal(parsed.resolvedRuntime?.effectiveModel, "gpt-5.4");
  assert.equal(parsed.resolvedRuntime?.effectiveReasoningEffort, "high");
  assert.equal(parsed.resolvedRuntime?.verification, "confirmed");
});

test("resolveCodexRuntime uses requested config before env and config defaults", async () => {
  const originalModel = process.env.REPOARENA_CODEX_MODEL;
  const originalReasoning = process.env.REPOARENA_CODEX_REASONING_EFFORT;
  const originalUserProfile = process.env.USERPROFILE;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-codex-home-"));
  const codexDir = path.join(homeDir, ".codex");
  await mkdir(codexDir, { recursive: true });
  process.env.USERPROFILE = homeDir;
  process.env.REPOARENA_CODEX_MODEL = "env-model";
  process.env.REPOARENA_CODEX_REASONING_EFFORT = "medium";

  try {
    const resolved = await __testUtils.resolveCodexRuntime({
      requestedConfig: {
        model: "ui-model",
        reasoningEffort: "high"
      },
      configSource: "ui"
    });
    assert.equal(resolved.effectiveModel, "ui-model");
    assert.equal(resolved.effectiveReasoningEffort, "high");
    assert.equal(resolved.source, "ui");
    assert.equal(resolved.verification, "inferred");
  } finally {
    if (originalModel === undefined) {
      delete process.env.REPOARENA_CODEX_MODEL;
    } else {
      process.env.REPOARENA_CODEX_MODEL = originalModel;
    }
    if (originalReasoning === undefined) {
      delete process.env.REPOARENA_CODEX_REASONING_EFFORT;
    } else {
      process.env.REPOARENA_CODEX_REASONING_EFFORT = originalReasoning;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("resolveCodexRuntime falls back from env to ~/.codex/config.toml", async () => {
  const originalModel = process.env.REPOARENA_CODEX_MODEL;
  const originalReasoning = process.env.REPOARENA_CODEX_REASONING_EFFORT;
  const originalUserProfile = process.env.USERPROFILE;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-codex-home-"));
  const codexDir = path.join(homeDir, ".codex");
  await mkdir(codexDir, { recursive: true });
  process.env.USERPROFILE = homeDir;

  try {
    process.env.REPOARENA_CODEX_MODEL = "env-model";
    process.env.REPOARENA_CODEX_REASONING_EFFORT = "low";
    let resolved = await __testUtils.resolveCodexRuntime({});
    assert.equal(resolved.effectiveModel, "env-model");
    assert.equal(resolved.effectiveReasoningEffort, "low");
    assert.equal(resolved.source, "env");

    delete process.env.REPOARENA_CODEX_MODEL;
    delete process.env.REPOARENA_CODEX_REASONING_EFFORT;
    await writeFile(
      path.join(codexDir, "config.toml"),
      'model = "config-model"\nmodel_reasoning_effort = "high"\n',
      "utf8"
    );

    resolved = await __testUtils.resolveCodexRuntime({});
    assert.equal(resolved.effectiveModel, "config-model");
    assert.equal(resolved.effectiveReasoningEffort, "high");
    assert.equal(resolved.source, "codex-config");
    assert.equal(resolved.verification, "inferred");
  } finally {
    if (originalModel === undefined) {
      delete process.env.REPOARENA_CODEX_MODEL;
    } else {
      process.env.REPOARENA_CODEX_MODEL = originalModel;
    }
    if (originalReasoning === undefined) {
      delete process.env.REPOARENA_CODEX_REASONING_EFFORT;
    } else {
      process.env.REPOARENA_CODEX_REASONING_EFFORT = originalReasoning;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("parseClaudeEvents normalizes token, cost, and error data", () => {
  const stdout = [
    JSON.stringify({
      session_id: "session-1",
      message: {
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          cache_creation_input_tokens: 1,
          cache_read_input_tokens: 2
        },
        content: [{ type: "text", text: "Intermediate update" }]
      }
    }),
    JSON.stringify({
      type: "result",
      total_cost_usd: 0.42,
      result: "Claude finished.",
      usage: {
        input_tokens: 7,
        output_tokens: 3,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1
      }
    }),
    JSON.stringify({
      type: "result",
      is_error: true,
      error: "permission_error",
      total_cost_usd: 0.11
    })
  ].join("\n");

  const parsed = __testUtils.parseClaudeEvents(stdout);
  assert.equal(parsed.sessionId, "session-1");
  assert.equal(parsed.summaryFromEvents, "Claude finished.");
  assert.equal(parsed.tokenUsage, 28);
  assert.equal(parsed.estimatedCostUsd, 0.11);
  assert.equal(parsed.costKnown, false);
  assert.equal(parsed.error, "permission_error");
});

test("Claude provider profiles persist metadata without leaking secrets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-claude-profiles-"));
  const registryPath = path.join(tempDir, "claude-provider-profiles.json");
  const originalRoot = process.env.REPOARENA_CLAUDE_PROFILE_ROOT;
  const originalFile = process.env.REPOARENA_CLAUDE_PROFILES_FILE;
  const originalPrefix = process.env.REPOARENA_CLAUDE_SECRET_PREFIX;
  process.env.REPOARENA_CLAUDE_PROFILE_ROOT = tempDir;
  process.env.REPOARENA_CLAUDE_PROFILES_FILE = registryPath;
  process.env.REPOARENA_CLAUDE_SECRET_PREFIX = `RepoArena/test/${Date.now()}/`;

  let profileId;
  try {
    const profile = await saveClaudeProviderProfile({
      name: "NewAPI",
      kind: "anthropic-compatible",
      homepage: "https://example.com",
      baseUrl: "https://api.example.com",
      apiFormat: "anthropic-messages",
      primaryModel: "gpt-5.4",
      extraEnv: {
        FOO: "bar"
      },
      notes: "test profile"
    });
    profileId = profile.id;

    if (supportsWindowsCredentialManager()) {
      await setClaudeProviderProfileSecret(profileId, "sk-test-provider-secret");
      assert.equal(await getClaudeProviderProfileSecret(profileId), "sk-test-provider-secret");
    }

    const listed = await listClaudeProviderProfiles();
    const saved = listed.find((entry) => entry.id === profileId);
    assert.ok(saved);
    assert.equal(saved.name, "NewAPI");
    assert.equal(saved.kind, "anthropic-compatible");
    assert.equal(saved.primaryModel, "gpt-5.4");
    assert.deepEqual(saved.riskFlags, ["third-party-provider", "compatibility-mode", "user-managed-secret"]);
    if (supportsWindowsCredentialManager()) {
      assert.equal(saved.secretStored, true);
    }

    const registryContents = await readFile(registryPath, "utf8");
    assert.doesNotMatch(registryContents, /sk-test-provider-secret/);
    assert.match(registryContents, /"name": "NewAPI"/);

    await deleteClaudeProviderProfile(profileId);
    const afterDelete = await listClaudeProviderProfiles();
    assert.equal(afterDelete.some((entry) => entry.id === profileId), false);
  } finally {
    if (profileId && supportsWindowsCredentialManager()) {
      try {
        await setClaudeProviderProfileSecret(profileId, "");
      } catch {}
    }
    if (originalRoot === undefined) {
      delete process.env.REPOARENA_CLAUDE_PROFILE_ROOT;
    } else {
      process.env.REPOARENA_CLAUDE_PROFILE_ROOT = originalRoot;
    }
    if (originalFile === undefined) {
      delete process.env.REPOARENA_CLAUDE_PROFILES_FILE;
    } else {
      process.env.REPOARENA_CLAUDE_PROFILES_FILE = originalFile;
    }
    if (originalPrefix === undefined) {
      delete process.env.REPOARENA_CLAUDE_SECRET_PREFIX;
    } else {
      process.env.REPOARENA_CLAUDE_SECRET_PREFIX = originalPrefix;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveClaudeRuntime and workspace settings respect provider profiles", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-claude-runtime-"));
  const registryPath = path.join(tempDir, "claude-provider-profiles.json");
  const workspacePath = path.join(tempDir, "workspace");
  const originalRoot = process.env.REPOARENA_CLAUDE_PROFILE_ROOT;
  const originalFile = process.env.REPOARENA_CLAUDE_PROFILES_FILE;
  const originalPrefix = process.env.REPOARENA_CLAUDE_SECRET_PREFIX;
  process.env.REPOARENA_CLAUDE_PROFILE_ROOT = tempDir;
  process.env.REPOARENA_CLAUDE_PROFILES_FILE = registryPath;
  process.env.REPOARENA_CLAUDE_SECRET_PREFIX = `RepoArena/test/${Date.now()}/`;

  let profileId;
  try {
    await mkdir(workspacePath, { recursive: true });
    const official = await __testUtils.resolveClaudeRuntime({
      requestedConfig: {}
    });
    assert.equal(official.profile.id, "claude-official");
    assert.equal(official.runtime.providerKind, "official");
    assert.equal(official.runtime.providerSource, "official-login");

    const profile = await saveClaudeProviderProfile({
      name: "Proxy OpenAI",
      kind: "openai-proxy",
      homepage: "https://proxy.example.com",
      baseUrl: "https://proxy.example.com/v1",
      apiFormat: "openai-chat-via-proxy",
      primaryModel: "gpt-5.4",
      defaultSonnetModel: "gpt-5.4-mini",
      extraEnv: {
        OPENAI_COMPAT_MODE: "1"
      }
    });
    profileId = profile.id;

    if (supportsWindowsCredentialManager()) {
      await setClaudeProviderProfileSecret(profileId, "sk-test-proxy-secret");
    }

    const resolved = await __testUtils.resolveClaudeRuntime({
      requestedConfig: {
        providerProfileId: profileId,
        model: "gpt-5.4"
      }
    });
    assert.equal(resolved.profile.id, profileId);
    assert.equal(resolved.runtime.providerProfileId, profileId);
    assert.equal(resolved.runtime.providerKind, "openai-proxy");
    assert.equal(resolved.runtime.providerSource, "profile-config");
    assert.equal(resolved.runtime.effectiveModel, "gpt-5.4");

    const providerEnvironment = await buildClaudeProviderEnvironment(profileId, "gpt-5.4");
    assert.equal(providerEnvironment.profile.id, profileId);
    assert.equal(providerEnvironment.effectiveModel, "gpt-5.4");
    assert.equal(providerEnvironment.environment.ANTHROPIC_BASE_URL, "https://proxy.example.com/v1");
    assert.equal(providerEnvironment.environment.ANTHROPIC_MODEL, "gpt-5.4");
    assert.equal(providerEnvironment.environment.OPENAI_COMPAT_MODE, "1");
    if (supportsWindowsCredentialManager()) {
      assert.equal(providerEnvironment.environment.ANTHROPIC_AUTH_TOKEN, "sk-test-proxy-secret");
    }

    const workspaceSettings = await writeClaudeWorkspaceSettings(workspacePath, profileId, "gpt-5.4");
    const settingsContent = JSON.parse(
      await readFile(path.join(workspacePath, ".claude", "settings.local.json"), "utf8")
    );
    assert.equal(workspaceSettings.profile.id, profileId);
    assert.equal(settingsContent.env.ANTHROPIC_BASE_URL, "https://proxy.example.com/v1");
    assert.equal(settingsContent.env.ANTHROPIC_MODEL, "gpt-5.4");
    assert.equal(settingsContent.env.OPENAI_COMPAT_MODE, "1");
    assert.equal(settingsContent.permissions.allow.length, 0);
    assert.equal(settingsContent.permissions.deny.length, 0);
  } finally {
    if (profileId && supportsWindowsCredentialManager()) {
      try {
        await setClaudeProviderProfileSecret(profileId, "");
      } catch {}
    }
    if (originalRoot === undefined) {
      delete process.env.REPOARENA_CLAUDE_PROFILE_ROOT;
    } else {
      process.env.REPOARENA_CLAUDE_PROFILE_ROOT = originalRoot;
    }
    if (originalFile === undefined) {
      delete process.env.REPOARENA_CLAUDE_PROFILES_FILE;
    } else {
      process.env.REPOARENA_CLAUDE_PROFILES_FILE = originalFile;
    }
    if (originalPrefix === undefined) {
      delete process.env.REPOARENA_CLAUDE_SECRET_PREFIX;
    } else {
      process.env.REPOARENA_CLAUDE_SECRET_PREFIX = originalPrefix;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
