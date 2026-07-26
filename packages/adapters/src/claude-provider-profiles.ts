/**
 * Claude Code provider profile management.
 *
 * Handles CRUD operations on a local JSON registry, secret storage
 * (Windows Credential Manager or AES-256-GCM encrypted file), and
 * workspace settings generation for provider-switched Claude Code runs.
 *
 * Structure:
 * - Types, constants, path resolution
 * - Registry file I/O (read/write JSON at ~/.config/agentarena/)
 * - Secret storage: delegated to secret-storage.ts
 * - Profile CRUD: save, get, list, delete, buildEnvironment
 * - Workspace settings writer (generates .claude/settings.json per run)
 *
 * Security model:
 * - baseUrl validated against ALLOWED_API_HOSTS (4 known providers)
 * - Private/loopback IPs blocked via isInternalUrl() (SSRF prevention)
 * - Unknown hosts require _confirmBaseUrlRisk acknowledgment
 * - Secrets are machine-bound: changing hostname or username silently
 *   invalidates encrypted secrets (logged via console.warn)
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ClaudeProviderProfile, ClaudeProviderRiskFlag } from "@agentarena/core";
import { getHealthCache, hasInternalDnsResolution, isInternalUrl, logger } from "@agentarena/core";
import {
  __secretStorageTestUtils,
  deleteSecret,
  getSecret,
  hasStoredSecret,
  setSecret,
  supportsWindowsCredentialManager,
  validateProfileId
} from "./secret-storage.js";

interface ProfileRegistryFile {
  schemaVersion: 1;
  profiles: ClaudeProviderProfile[];
}

export interface ClaudeProviderProfileInput {
  id?: string;
  name: string;
  kind: ClaudeProviderProfile["kind"];
  homepage?: string;
  baseUrl?: string;
  apiFormat: ClaudeProviderProfile["apiFormat"];
  primaryModel?: string;
  thinkingModel?: string;
  defaultHaikuModel?: string;
  defaultSonnetModel?: string;
  defaultOpusModel?: string;
  extraEnv?: Record<string, string>;
  writeCommonConfig?: boolean;
  notes?: string;
  _confirmBaseUrlRisk?: boolean;
  riskFlags?: ClaudeProviderRiskFlag[];
}

const RESERVED_PROVIDER_EXTRA_ENV_NAMES = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_MODEL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CONFIG_DIR",
  "COMSPEC",
  "HOME",
  "PATH",
  "PATHEXT",
  "PWD",
  "SHELL",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR"
]);

export function findReservedClaudeProviderEnvironmentKeys(
  extraEnv: Record<string, string> | undefined
): string[] {
  return Object.keys(extraEnv ?? {})
    .filter((key) => RESERVED_PROVIDER_EXTRA_ENV_NAMES.has(key.trim().toUpperCase()))
    .sort((left, right) => left.localeCompare(right));
}

function assertAllowedClaudeProviderEnvironment(extraEnv: Record<string, string> | undefined): void {
  const reservedKeys = findReservedClaudeProviderEnvironmentKeys(extraEnv);
  if (reservedKeys.length === 0) {
    return;
  }
  throw new Error(
    `Claude provider extraEnv cannot override reserved runtime fields: ${reservedKeys.join(", ")}. ` +
      "Use the dedicated provider fields for address, model, and secret settings."
  );
}

const BUILT_IN_OFFICIAL_PROFILE: ClaudeProviderProfile = {
  id: "claude-official",
  name: "Official",
  kind: "official",
  homepage: "https://www.anthropic.com/claude-code",
  apiFormat: "anthropic-messages",
  extraEnv: {},
  writeCommonConfig: true,
  riskFlags: [],
  isBuiltIn: true,
  secretStored: false
};

function defaultRiskFlags(kind: ClaudeProviderProfile["kind"]): ClaudeProviderRiskFlag[] {
  if (kind === "official") {
    return [];
  }

  return ["third-party-provider", "compatibility-mode", "user-managed-secret"];
}

function appDataRoot(): string {
  if (process.env.AGENTARENA_CLAUDE_PROFILE_ROOT?.trim()) {
    return process.env.AGENTARENA_CLAUDE_PROFILE_ROOT.trim();
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "AgentArena");
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "agentarena");
}

function registryPath(): string {
  if (process.env.AGENTARENA_CLAUDE_PROFILES_FILE?.trim()) {
    return process.env.AGENTARENA_CLAUDE_PROFILES_FILE.trim();
  }

  return path.join(appDataRoot(), "claude-provider-profiles.json");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


function normalizeProfile(profile: ClaudeProviderProfile): ClaudeProviderProfile {
  return {
    ...profile,
    homepage: profile.homepage?.trim() || undefined,
    baseUrl: profile.baseUrl?.trim() || undefined,
    primaryModel: profile.primaryModel?.trim() || undefined,
    thinkingModel: profile.thinkingModel?.trim() || undefined,
    defaultHaikuModel: profile.defaultHaikuModel?.trim() || undefined,
    defaultSonnetModel: profile.defaultSonnetModel?.trim() || undefined,
    defaultOpusModel: profile.defaultOpusModel?.trim() || undefined,
    notes: profile.notes?.trim() || undefined,
    extraEnv: Object.fromEntries(
      Object.entries(profile.extraEnv ?? {}).filter(([key, value]) => key.trim() && String(value).trim())
    ),
    riskFlags: profile.riskFlags.length > 0 ? profile.riskFlags : defaultRiskFlags(profile.kind)
  };
}

async function ensureRegistryDir(): Promise<void> {
  await fs.mkdir(path.dirname(registryPath()), { recursive: true });
}

// ---------------------------------------------------------------------------
// Section 1: Registry file I/O
// Reads/writes ~/.config/agentarena/claude-provider-profiles.json
// ---------------------------------------------------------------------------

async function readRegistry(): Promise<ProfileRegistryFile> {
  let rawRegistry: string;
  try {
    rawRegistry = await fs.readFile(registryPath(), "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return {
        schemaVersion: 1,
        profiles: []
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read Claude provider registry at ${registryPath()}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawRegistry);
  } catch {
    throw new Error(`Claude provider registry at ${registryPath()} is malformed JSON.`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Claude provider registry at ${registryPath()} must contain a JSON object.`);
  }

  const registry = parsed as Partial<ProfileRegistryFile>;
  return {
    schemaVersion: 1,
    profiles: Array.isArray(registry.profiles) ? registry.profiles.map(normalizeProfile) : []
  };
}

function tryReadRegistry(): Promise<ProfileRegistryFile> {
  return readRegistry().catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read Claude provider profiles: ${reason}`);
  });
}

async function writeRegistry(registry: ProfileRegistryFile): Promise<void> {
  await ensureRegistryDir();
  await fs.writeFile(registryPath(), JSON.stringify(registry, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Section 2: Secret storage — delegated to secret-storage.ts
// See secret-storage.ts for Windows Credential Manager and AES-256-GCM
// implementations. Re-exported here for backward compatibility.
// ---------------------------------------------------------------------------

export { supportsWindowsCredentialManager } from "./secret-storage.js";

export async function listClaudeProviderProfiles(): Promise<ClaudeProviderProfile[]> {
  const registry = await tryReadRegistry();
  const customProfiles = await Promise.all(
    registry.profiles.map(async (profile) => ({
      ...profile,
      isBuiltIn: false,
      secretStored: await hasStoredSecret(profile.id)
    }))
  );

  return [
    BUILT_IN_OFFICIAL_PROFILE,
    ...customProfiles.sort((left, right) => left.name.localeCompare(right.name))
  ];
}

export async function getClaudeProviderProfile(profileId?: string): Promise<ClaudeProviderProfile> {
  if (!profileId || profileId === BUILT_IN_OFFICIAL_PROFILE.id) {
    return BUILT_IN_OFFICIAL_PROFILE;
  }

  const profiles = await listClaudeProviderProfiles();
  const profile = profiles.find((entry) => entry.id === profileId);
  if (!profile) {
    throw new Error(`Unknown Claude provider profile "${profileId}".`);
  }

  return profile;
}

// ---------------------------------------------------------------------------
// Health-cache invalidation
//
// The Claude adapter caches preflight/auth verdicts in the HealthCache, keyed
// on (adapterId, providerId, endpoint) where endpoint is the profile baseUrl.
// When a profile's secret or baseUrl changes — or the profile is deleted — any
// cached verdict is stale and must be dropped, otherwise a fixed credential
// would still report the old "blocked" status (and vice versa).
// ---------------------------------------------------------------------------

const CLAUDE_ADAPTER_ID = "claude-code";

/**
 * Invalidate any cached health verdict for a Claude provider profile.
 *
 * Drops both the endpoint-specific cache key (matching what the adapter wrote
 * using the profile baseUrl) and the no-endpoint key, so the next preflight
 * re-probes with the updated configuration. Best-effort: cache failures are
 * logged but never block the profile operation.
 *
 * @param profileId - The provider profile ID.
 * @param endpoints - Candidate endpoints (baseUrls) whose keys should be dropped.
 */
async function invalidateProfileHealth(profileId: string, endpoints: Array<string | undefined>): Promise<void> {
  try {
    const cache = getHealthCache();
    // Always drop the no-endpoint key plus every provided endpoint key.
    const targets = new Set<string | undefined>([undefined, ...endpoints.map((value) => value?.trim() || undefined)]);
    for (const endpoint of targets) {
      await cache.invalidate(CLAUDE_ADAPTER_ID, profileId, endpoint);
    }
  } catch (error) {
    logger.warn(
      "adapter",
      "profile.health_invalidate_failed",
      `Failed to invalidate health cache for profile "${profileId}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Resolve a profile's current baseUrl from the registry (best-effort).
 * Used so secret/delete operations can invalidate the endpoint-specific key.
 */
async function lookupProfileBaseUrl(profileId: string): Promise<string | undefined> {
  try {
    const registry = await readRegistry();
    return registry.profiles.find((entry) => entry.id === profileId)?.baseUrl;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Section 3: Profile CRUD (save, get, list, delete, buildEnvironment)
// ---------------------------------------------------------------------------

export async function saveClaudeProviderProfile(input: ClaudeProviderProfileInput): Promise<ClaudeProviderProfile> {
  if (input.kind === "official") {
    throw new Error("The built-in official Claude profile cannot be replaced.");
  }

  assertAllowedClaudeProviderEnvironment(input.extraEnv);

  if (input.baseUrl && isInternalUrl(input.baseUrl)) {
    throw new Error("baseUrl cannot point to an internal/private address. This restriction prevents Server-Side Request Forgery (SSRF) attacks.");
  }

  // DNS rebinding guard: resolve the hostname and verify no resolved IP is
  // internal/private. Without this, an attacker could register a domain that
  // initially resolves to a public IP (passing isInternalUrl) but later resolves
  // to 127.0.0.1 at request time, bypassing the SSRF protection.
  // Skip when AGENTARENA_SKIP_DNS_CHECK=1 (test environments with captive DNS).
  if (input.baseUrl && process.env.AGENTARENA_SKIP_DNS_CHECK !== "1") {
    try {
      const isDnsInternal = await hasInternalDnsResolution(input.baseUrl);
      if (isDnsInternal) {
        throw new Error(
          `baseUrl "${input.baseUrl}" resolves to an internal/private IP address. ` +
          `This restriction prevents DNS rebinding SSRF attacks.`
        );
      }
    } catch (dnsError) {
      if (dnsError instanceof Error && dnsError.message.includes("resolves to an internal")) {
        throw dnsError;
      }
      // DNS resolution failure is treated as potentially internal (fail-safe)
      throw new Error(
        `baseUrl "${input.baseUrl}" failed DNS resolution. Cannot verify it does not point to an internal address.`
      );
    }
  }

  let effectiveRiskFlags: ClaudeProviderRiskFlag[] = [...(input.riskFlags ?? [])];
  if (input.baseUrl) {
    let parsedHost: string;
    try {
      parsedHost = new URL(input.baseUrl).hostname.toLowerCase();
    } catch {
      throw new Error(`baseUrl "${input.baseUrl}" is not a valid URL.`);
    }
    // Known API hosts that are pre-approved without risk flags.
    // MAINTENANCE: Add new hosts here when onboarding a new provider.
    // Unknown hosts are allowed but flagged with "baseUrl-redirects-traffic"
    // so the UI can display a warning to the user.
    const ALLOWED_API_HOSTS = new Set([
      "api.anthropic.com",       // Anthropic official
      "api.openai.com",          // OpenAI official
      "generativelanguage.googleapis.com",  // Google Gemini
      "dashscope.aliyuncs.com",  // Alibaba DashScope (Qwen)
      // 国内主流公共 API（均为公网可访问的官方端点，非内网服务）
      "api.stepfun.com",         // 阶跃星辰 StepFun
      "api.moonshot.cn",         // Moonshot AI（月之暗面）
      "open.bigmodel.cn",        // 智谱 GLM
      "api.minimax.chat",        // MiniMax
      "api.deepseek.com",        // DeepSeek
    ]);
    if (!ALLOWED_API_HOSTS.has(parsedHost)) {
      const riskFlag: ClaudeProviderRiskFlag = "baseUrl-redirects-traffic";
      // Unknown (non-allowlisted) hosts route Claude traffic to a third-party
      // server. Require explicit risk acknowledgment before persisting so the
      // caller cannot silently redirect credentials/traffic to an arbitrary
      // endpoint. The UI surfaces this as a confirmation step.
      if (!input._confirmBaseUrlRisk && !input.riskFlags?.includes(riskFlag)) {
        throw new Error(
          `baseUrl "${input.baseUrl}" points to a third-party server (${parsedHost}). ` +
            "Routing Claude traffic there can expose your credentials and data. " +
            "Confirm the risk to proceed."
        );
      }
      // Acknowledged: allow the host but persist the risk flag so the UI can
      // display a warning to the user.
      if (!input.riskFlags?.includes(riskFlag)) {
        effectiveRiskFlags = [...(input.riskFlags ?? []), riskFlag];
      }
    }
  }

  const registry = await tryReadRegistry();
  const id = input.id?.trim() || `${slugify(input.name) || "claude-profile"}-${randomUUID().slice(0, 6)}`;
  const profile = normalizeProfile({
    id,
    name: input.name.trim(),
    kind: input.kind,
    homepage: input.homepage,
    baseUrl: input.baseUrl,
    apiFormat: input.apiFormat,
    primaryModel: input.primaryModel,
    thinkingModel: input.thinkingModel,
    defaultHaikuModel: input.defaultHaikuModel,
    defaultSonnetModel: input.defaultSonnetModel,
    defaultOpusModel: input.defaultOpusModel,
    extraEnv: input.extraEnv ?? {},
    writeCommonConfig: input.writeCommonConfig ?? true,
    notes: input.notes,
    riskFlags: [...new Set([...defaultRiskFlags(input.kind), ...effectiveRiskFlags])],
    isBuiltIn: false,
    secretStored: false
  });

  const nextProfiles = registry.profiles.filter((entry) => entry.id !== id);
  const previousBaseUrl = registry.profiles.find((entry) => entry.id === id)?.baseUrl;
  nextProfiles.push(profile);
  await writeRegistry({
    schemaVersion: 1,
    profiles: nextProfiles
  });

  // Saving a profile may change its baseUrl or other auth-affecting fields, so
  // any cached health verdict (keyed on old or new baseUrl) is now stale.
  await invalidateProfileHealth(profile.id, [previousBaseUrl, profile.baseUrl]);

  return {
    ...profile,
    secretStored: await hasStoredSecret(profile.id)
  };
}

export async function deleteClaudeProviderProfile(profileId: string): Promise<void> {
  if (profileId === BUILT_IN_OFFICIAL_PROFILE.id) {
    throw new Error("The built-in official Claude profile cannot be deleted.");
  }

  const registry = await readRegistry();
  const removedBaseUrl = registry.profiles.find((entry) => entry.id === profileId)?.baseUrl;
  await writeRegistry({
    schemaVersion: 1,
    profiles: registry.profiles.filter((entry) => entry.id !== profileId)
  });

  await deleteSecret(profileId);

  // The profile is gone — drop any cached health verdict for it.
  await invalidateProfileHealth(profileId, [removedBaseUrl]);
}

export async function setClaudeProviderProfileSecret(profileId: string, secret: string): Promise<void> {
  if (profileId === BUILT_IN_OFFICIAL_PROFILE.id) {
    throw new Error("The built-in official Claude profile does not use a stored secret.");
  }

  const baseUrl = await lookupProfileBaseUrl(profileId);

  if (!secret.trim()) {
    await deleteSecret(profileId);
    await invalidateProfileHealth(profileId, [baseUrl]);
    return;
  }

  await setSecret(profileId, secret.trim());

  await invalidateProfileHealth(profileId, [baseUrl]);
}

export async function getClaudeProviderProfileSecret(profileId: string): Promise<string | null> {
  if (profileId === BUILT_IN_OFFICIAL_PROFILE.id) {
    return null;
  }

  return await getSecret(profileId);
}

export async function buildClaudeProviderEnvironment(
  profileId: string | undefined,
  requestedModel?: string
): Promise<{
  profile: ClaudeProviderProfile;
  environment: Record<string, string>;
  effectiveModel?: string;
}> {
  const profile = await getClaudeProviderProfile(profileId);
  assertAllowedClaudeProviderEnvironment(profile.extraEnv);
  const environment: Record<string, string> = {
    ...(profile.writeCommonConfig
      ? {
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: "6000"
        }
      : {}),
    ...profile.extraEnv
  };

  const effectiveModel = requestedModel?.trim() || profile.primaryModel?.trim() || undefined;

  if (profile.kind !== "official") {
    const secret = await getClaudeProviderProfileSecret(profile.id);
    if (!secret) {
      throw new Error(`Claude provider profile "${profile.name}" does not have a stored secret.`);
    }

    environment.ANTHROPIC_AUTH_TOKEN = secret;
    if (profile.baseUrl) {
      environment.ANTHROPIC_BASE_URL = profile.baseUrl;
    }
    if (profile.primaryModel) {
      environment.ANTHROPIC_MODEL = profile.primaryModel;
    }
    if (profile.defaultHaikuModel) {
      environment.ANTHROPIC_DEFAULT_HAIKU_MODEL = profile.defaultHaikuModel;
    }
    if (profile.defaultSonnetModel) {
      environment.ANTHROPIC_DEFAULT_SONNET_MODEL = profile.defaultSonnetModel;
    }
    if (profile.defaultOpusModel) {
      environment.ANTHROPIC_DEFAULT_OPUS_MODEL = profile.defaultOpusModel;
    }
  }

  return { profile, environment, effectiveModel };
}

export async function writeClaudeWorkspaceSettings(
  workspacePath: string,
  profileId: string | undefined,
  requestedModel?: string
): Promise<{
  profile: ClaudeProviderProfile;
  settingsPath: string;
  environment: Record<string, string>;
  effectiveModel?: string;
}> {
  const { profile, environment, effectiveModel } = await buildClaudeProviderEnvironment(profileId, requestedModel);
  const claudeDir = path.join(workspacePath, ".claude");
  const settingsPath = path.join(claudeDir, "settings.local.json");

  await fs.mkdir(claudeDir, { recursive: true });
  // Only write non-sensitive config (permissions). Secrets are passed via process environment.
  await fs.writeFile(
    settingsPath,
    JSON.stringify(
      {
        permissions: {
          allow: [],
          deny: []
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    profile,
    settingsPath,
    environment,
    effectiveModel
  };
}

export const __providerProfileTestUtils = {
  appDataRoot,
  registryPath,
  // Re-exposed from secret-storage.ts (where the helper now lives) so the
  // tracked provider-profiles.test.mjs, which reads it here, keeps passing
  // after the secret-storage extraction.
  secretTarget: __secretStorageTestUtils.secretTarget,
  supportsWindowsCredentialManager
};
