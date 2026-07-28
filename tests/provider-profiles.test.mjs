import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Import from built dist
import {
  __providerProfileTestUtils,
  deleteClaudeProviderProfile,
  getClaudeProviderProfile,
  getClaudeProviderProfileSecret,
  listClaudeProviderProfiles,
  saveClaudeProviderProfile,
  setClaudeProviderProfileSecret,
} from "../packages/adapters/dist/claude-provider-profiles.js";
import { validateClaudeProviderProfileId } from "../packages/adapters/dist/provider-profile-id.js";

const { appDataRoot, registryPath, secretTarget } = __providerProfileTestUtils;

// ─── Unit tests for internal helpers (via test utils) ───

test("appDataRoot uses AGENTARENA_CLAUDE_PROFILE_ROOT env when set", () => {
  const original = process.env.AGENTARENA_CLAUDE_PROFILE_ROOT;
  process.env.AGENTARENA_CLAUDE_PROFILE_ROOT = "/custom/root";
  try {
    assert.equal(appDataRoot(), "/custom/root");
  } finally {
    if (original) {
      process.env.AGENTARENA_CLAUDE_PROFILE_ROOT = original;
    } else {
      delete process.env.AGENTARENA_CLAUDE_PROFILE_ROOT;
    }
  }
});

test("appDataRoot falls back to platform default", () => {
  const original = process.env.AGENTARENA_CLAUDE_PROFILE_ROOT;
  delete process.env.AGENTARENA_CLAUDE_PROFILE_ROOT;
  try {
    const root = appDataRoot();
    assert.ok(root.length > 0, "appDataRoot should not be empty");
    // On any platform, it should be an absolute path
    if (process.platform === "win32") {
      assert.ok(root.includes("AgentArena"), "Windows path should contain AgentArena");
    } else {
      assert.ok(root.includes("agentarena"), "Unix path should contain agentarena");
    }
  } finally {
    if (original) {
      process.env.AGENTARENA_CLAUDE_PROFILE_ROOT = original;
    }
  }
});

test("secretTarget constructs correct path with profile ID", () => {
  const target = secretTarget("my-profile");
  assert.ok(target.includes("my-profile"), "secret target should contain profile ID");
});

test("secretTarget rejects invalid profile IDs", () => {
  assert.throws(() => secretTarget(""), /invalid profile id/i);
  assert.throws(() => secretTarget("../etc/passwd"), /invalid profile id/i);
  assert.throws(() => secretTarget("has spaces"), /invalid profile id/i);
  assert.throws(() => secretTarget("a".repeat(100)), /invalid profile id/i);
});

test("secretTarget accepts valid profile IDs", () => {
  // Single char
  assert.doesNotThrow(() => secretTarget("a"));
  // Alphanumeric with hyphens
  assert.doesNotThrow(() => secretTarget("my-profile-123"));
  // Long but within limit
  assert.doesNotThrow(() => secretTarget("a".repeat(64)));
});

test("provider profile ID validation is canonical across storage and CRUD", () => {
  assert.equal(validateClaudeProviderProfileId("valid-profile-1"), null);
  assert.match(validateClaudeProviderProfileId("invalid_profile"), /start and end|hyphens/i);
  assert.match(validateClaudeProviderProfileId("-invalid"), /start and end/i);
  assert.match(validateClaudeProviderProfileId("invalid-"), /start and end/i);
  assert.match(validateClaudeProviderProfileId("a".repeat(65)), /maximum 64/i);
});

// ─── Integration tests for profile CRUD ───
// These tests use a temporary directory to avoid polluting the real registry.

async function withTempRoot(fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-test-"));
  const originalRoot = process.env.AGENTARENA_CLAUDE_PROFILE_ROOT;
  const originalFile = process.env.AGENTARENA_CLAUDE_PROFILES_FILE;
  const originalDnsCheck = process.env.AGENTARENA_SKIP_DNS_CHECK;
  process.env.AGENTARENA_CLAUDE_PROFILE_ROOT = tmpDir;
  process.env.AGENTARENA_CLAUDE_PROFILES_FILE = path.join(tmpDir, "claude-provider-profiles.json");
  process.env.AGENTARENA_SKIP_DNS_CHECK = "1";
  try {
    await fn(tmpDir);
  } finally {
    process.env.AGENTARENA_CLAUDE_PROFILE_ROOT = originalRoot ?? "";
    if (!originalRoot) delete process.env.AGENTARENA_CLAUDE_PROFILE_ROOT;
    process.env.AGENTARENA_CLAUDE_PROFILES_FILE = originalFile ?? "";
    if (!originalFile) delete process.env.AGENTARENA_CLAUDE_PROFILES_FILE;
    if (originalDnsCheck === undefined) delete process.env.AGENTARENA_SKIP_DNS_CHECK;
    else process.env.AGENTARENA_SKIP_DNS_CHECK = originalDnsCheck;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

test("listClaudeProviderProfiles returns built-in official profile", async () => {
  await withTempRoot(async () => {
    const profiles = await listClaudeProviderProfiles();
    const official = profiles.find((p) => p.id === "claude-official");
    assert.ok(official, "Should include built-in official profile");
    assert.equal(official.kind, "official");
    assert.equal(official.isBuiltIn, true);
  });
});

test("saveClaudeProviderProfile creates a new profile", async () => {
  await withTempRoot(async () => {
    const profile = await saveClaudeProviderProfile({
      name: "Test Provider",
      kind: "anthropic-compatible",
      apiFormat: "anthropic-messages",
    });

    assert.ok(profile.id, "Should have an auto-generated ID");
    assert.equal(profile.name, "Test Provider");
    assert.equal(profile.kind, "anthropic-compatible");
    assert.equal(profile.isBuiltIn, false);
    assert.ok(profile.riskFlags.length > 0, "Non-official profiles should have risk flags");
  });
});

test("saveClaudeProviderProfile rejects invalid explicit IDs before persistence", async () => {
  await withTempRoot(async () => {
    await assert.rejects(
      () => saveClaudeProviderProfile({
        id: "invalid_profile",
        name: "Invalid ID",
        kind: "anthropic-compatible",
        apiFormat: "anthropic-messages",
      }),
      /invalid profile id/i
    );
    await assert.rejects(() => fs.access(registryPath()), { code: "ENOENT" });
  });
});

test("listClaudeProviderProfiles removes historical invalid IDs without hiding valid profiles", async () => {
  await withTempRoot(async () => {
    const validProfile = {
      id: "valid-history",
      name: "Valid History",
      kind: "anthropic-compatible",
      apiFormat: "anthropic-messages",
      extraEnv: {},
      writeCommonConfig: true,
      riskFlags: ["third-party-provider"],
      isBuiltIn: false,
      secretStored: false
    };
    await fs.writeFile(
      registryPath(),
      JSON.stringify({
        schemaVersion: 1,
        profiles: [
          validProfile,
          { ...validProfile, id: "invalid_history", name: "Invalid History" }
        ]
      }),
      "utf8"
    );

    const profiles = await listClaudeProviderProfiles();
    assert.ok(profiles.some((profile) => profile.id === "valid-history"));
    assert.equal(profiles.some((profile) => profile.id === "invalid_history"), false);

    const repaired = JSON.parse(await fs.readFile(registryPath(), "utf8"));
    assert.deepEqual(repaired.profiles.map((profile) => profile.id), ["valid-history"]);
  });
});

test("provider registry recovers an interrupted atomic replacement before reading", async () => {
  await withTempRoot(async () => {
    const backupPath = path.join(
      path.dirname(registryPath()),
      `.${path.basename(registryPath())}.bak`
    );
    const recoveredProfile = {
      id: "recovered-profile",
      name: "Recovered Profile",
      kind: "anthropic-compatible",
      apiFormat: "anthropic-messages",
      extraEnv: {},
      writeCommonConfig: true,
      riskFlags: ["third-party-provider"],
      isBuiltIn: false,
      secretStored: false
    };
    await fs.writeFile(
      backupPath,
      JSON.stringify({ schemaVersion: 1, profiles: [recoveredProfile] }),
      "utf8"
    );

    const profiles = await listClaudeProviderProfiles();
    assert.ok(profiles.some((profile) => profile.id === "recovered-profile"));
    await fs.access(registryPath());
    await assert.rejects(() => fs.access(backupPath), { code: "ENOENT" });

    await saveClaudeProviderProfile({
      id: "new-profile",
      name: "New Profile",
      kind: "anthropic-compatible",
      apiFormat: "anthropic-messages"
    });
    const persisted = JSON.parse(await fs.readFile(registryPath(), "utf8"));
    assert.deepEqual(
      persisted.profiles.map((profile) => profile.id).sort(),
      ["new-profile", "recovered-profile"]
    );
  });
});

test("saveClaudeProviderProfile rejects official kind", async () => {
  await withTempRoot(async () => {
    await assert.rejects(
      () => saveClaudeProviderProfile({
        name: "Fake Official",
        kind: "official",
        apiFormat: "anthropic-messages",
      }),
      /cannot be replaced/i
    );
  });
});

test("saveClaudeProviderProfile rejects extraEnv keys that could break runtime isolation", async () => {
  await withTempRoot(async () => {
    await assert.rejects(
      () => saveClaudeProviderProfile({
        name: "Unsafe Provider",
        kind: "anthropic-compatible",
        apiFormat: "anthropic-messages",
        extraEnv: {
          CLAUDE_CONFIG_DIR: "C:/reuse-personal-config",
          ANTHROPIC_AUTH_TOKEN: "shadow-token"
        }
      }),
      /CLAUDE_CONFIG_DIR.*ANTHROPIC_AUTH_TOKEN|ANTHROPIC_AUTH_TOKEN.*CLAUDE_CONFIG_DIR/i
    );
  });
});

test("saveClaudeProviderProfile rejects internal baseUrl (SSRF protection)", async () => {
  await withTempRoot(async () => {
    await assert.rejects(
      () => saveClaudeProviderProfile({
        name: "Internal",
        kind: "anthropic-compatible",
        apiFormat: "anthropic-messages",
        baseUrl: "http://127.0.0.1:8080",
      }),
      /internal|private|ssrf/i
    );

    await assert.rejects(
      () => saveClaudeProviderProfile({
        name: "Internal 2",
        kind: "anthropic-compatible",
        apiFormat: "anthropic-messages",
        baseUrl: "http://localhost:3000/api",
      }),
      /internal|private|ssrf/i
    );
  });
});

test("saveClaudeProviderProfile requires risk confirmation for unknown baseUrl", async () => {
  await withTempRoot(async () => {
    // Without _confirmBaseUrlRisk, should throw
    await assert.rejects(
      () => saveClaudeProviderProfile({
        name: "Unknown Provider",
        kind: "anthropic-compatible",
        apiFormat: "anthropic-messages",
        baseUrl: "https://some-unknown-api.example.com/v1",
      }),
      /third-party server/i
    );

    // With _confirmBaseUrlRisk, should succeed
    const profile = await saveClaudeProviderProfile({
      name: "Unknown Provider",
      kind: "anthropic-compatible",
      apiFormat: "anthropic-messages",
      baseUrl: "https://some-unknown-api.example.com/v1",
      _confirmBaseUrlRisk: true,
    });

    assert.ok(
      profile.riskFlags.includes("baseUrl-redirects-traffic"),
      "Should add baseUrl-redirects-traffic risk flag"
    );
  });
});

test("saveClaudeProviderProfile rejects invalid baseUrl", async () => {
  await withTempRoot(async () => {
    // "not-a-valid-url" is caught by the SSRF check (isInternalUrl) before
    // URL parsing, because it has no protocol and is treated as a hostname.
    // Use a clearly-malformed URL to trigger the URL parsing error.
    await assert.rejects(
      () => saveClaudeProviderProfile({
        name: "Bad URL",
        kind: "anthropic-compatible",
        apiFormat: "anthropic-messages",
        baseUrl: ":::not-valid",
      }),
      /not a valid url|internal|private|ssrf/i
    );
  });
});

test("deleteClaudeProviderProfile removes profile and secret", async () => {
  await withTempRoot(async () => {
    const profile = await saveClaudeProviderProfile({
      name: "To Delete",
      kind: "anthropic-compatible",
      apiFormat: "anthropic-messages",
    });

    await deleteClaudeProviderProfile(profile.id);

    const profiles = await listClaudeProviderProfiles();
    const found = profiles.find((p) => p.id === profile.id);
    assert.equal(found, undefined, "Profile should be deleted");
  });
});

test("deleteClaudeProviderProfile rejects deleting official profile", async () => {
  await withTempRoot(async () => {
    await assert.rejects(
      () => deleteClaudeProviderProfile("claude-official"),
      /cannot be deleted/i
    );
  });
});

// ─── Secret storage tests ───

test("setClaudeProviderProfileSecret stores and retrieves secret (file backend)", async () => {
  // Force file backend by ensuring we're not on win32 or by setting env
  if (process.platform !== "win32") {
    await withTempRoot(async () => {
      const profile = await saveClaudeProviderProfile({
        name: "Secret Test",
        kind: "anthropic-compatible",
        apiFormat: "anthropic-messages",
      });

      await setClaudeProviderProfileSecret(profile.id, "sk-test-12345");

      const secret = await getClaudeProviderProfileSecret(profile.id);
      assert.equal(secret, "sk-test-12345", "Should retrieve the stored secret");
    });
  }
});

test("setClaudeProviderProfileSecret with empty string deletes secret", async () => {
  if (process.platform !== "win32") {
    await withTempRoot(async () => {
      const profile = await saveClaudeProviderProfile({
        name: "Delete Secret Test",
        kind: "anthropic-compatible",
        apiFormat: "anthropic-messages",
      });

      await setClaudeProviderProfileSecret(profile.id, "sk-test-12345");
      await setClaudeProviderProfileSecret(profile.id, "");

      const secret = await getClaudeProviderProfileSecret(profile.id);
      assert.equal(secret, null, "Empty string should delete the secret");
    });
  }
});

test("setClaudeProviderProfileSecret rejects official profile", async () => {
  await withTempRoot(async () => {
    await assert.rejects(
      () => setClaudeProviderProfileSecret("claude-official", "sk-test"),
      /does not use a stored secret/i
    );
  });
});

test("getClaudeProviderProfileSecret returns null for official profile", async () => {
  await withTempRoot(async () => {
    const secret = await getClaudeProviderProfileSecret("claude-official");
    assert.equal(secret, null);
  });
});

// ─── Profile retrieval tests ───

test("getClaudeProviderProfile returns official profile for undefined id", async () => {
  await withTempRoot(async () => {
    const profile = await getClaudeProviderProfile(undefined);
    assert.equal(profile.id, "claude-official");
  });
});

test("getClaudeProviderProfile throws for unknown profile id", async () => {
  await withTempRoot(async () => {
    await assert.rejects(
      () => getClaudeProviderProfile("nonexistent-profile"),
      /unknown/i
    );
  });
});

test("listClaudeProviderProfiles includes secretStored status", async () => {
  if (process.platform !== "win32") {
    await withTempRoot(async () => {
      const profile = await saveClaudeProviderProfile({
        name: "Status Test",
        kind: "anthropic-compatible",
        apiFormat: "anthropic-messages",
      });

      // Before setting secret
      let profiles = await listClaudeProviderProfiles();
      let found = profiles.find((p) => p.id === profile.id);
      assert.equal(found.secretStored, false, "secretStored should be false initially");

      // After setting secret
      await setClaudeProviderProfileSecret(profile.id, "sk-test-abc");
      profiles = await listClaudeProviderProfiles();
      found = profiles.find((p) => p.id === profile.id);
      assert.equal(found.secretStored, true, "secretStored should be true after setting secret");
    });
  }
});

test("saveClaudeProviderProfile normalizes whitespace in fields", async () => {
  await withTempRoot(async () => {
    const profile = await saveClaudeProviderProfile({
      name: "  Whitespace Test  ",
      kind: "anthropic-compatible",
      apiFormat: "anthropic-messages",
      // Use a known API host to avoid the third-party risk flag requirement
      baseUrl: "  https://api.anthropic.com  ",
      notes: "  some notes  ",
      _confirmBaseUrlRisk: true,
    });

    assert.equal(profile.name, "Whitespace Test", "Name should be trimmed");
    assert.equal(profile.baseUrl, "https://api.anthropic.com", "baseUrl should be trimmed");
    assert.equal(profile.notes, "some notes", "notes should be trimmed");
  });
});

test("saveClaudeProviderProfile filters empty extraEnv entries", async () => {
  await withTempRoot(async () => {
    const profile = await saveClaudeProviderProfile({
      name: "Env Test",
      kind: "anthropic-compatible",
      apiFormat: "anthropic-messages",
      extraEnv: {
        VALID_KEY: "valid_value",
        "": "empty_key",
        EMPTY_VALUE: "",
        ANOTHER: "value",
      },
    });

    const keys = Object.keys(profile.extraEnv);
    assert.ok(keys.includes("VALID_KEY"), "Should keep non-empty key-value pairs");
    assert.ok(keys.includes("ANOTHER"), "Should keep non-empty key-value pairs");
    assert.ok(!keys.includes(""), "Should remove empty keys");
    assert.ok(!keys.includes("EMPTY_VALUE"), "Should remove empty values");
  });
});
