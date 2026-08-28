import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hasInternalDnsResolution,
  isInternalUrl,
  isReservedRuntimeProfileEnvironmentKey,
  logger,
  type PublicRuntimeProfile,
  RUNTIME_PROFILE_SCHEMA_V1,
  type RuntimeAgentKind,
  type RuntimeProfile,
  type RuntimeProfileProvider,
  type RuntimeProfileRiskFlag,
  recoverAtomicFile,
  toPublicRuntimeProfile,
  validateRuntimeProfile,
  writeJsonAtomic
} from "@agentarena/core";
import {
  deleteRuntimeSecret,
  deleteSecret,
  getRuntimeSecret,
  getSecret,
  hasStoredRuntimeSecret,
  hasStoredSecret,
  setRuntimeSecret
} from "./secret-storage.js";

const RUNTIME_PROFILE_REGISTRY_SCHEMA_V1 = "agentarena.runtime-profile-registry/v1" as const;
const RUNTIME_PROFILE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const KNOWN_PROVIDER_HOSTS = new Set([
  "api.anthropic.com",
  "api.openai.com",
  "generativelanguage.googleapis.com",
  "dashscope.aliyuncs.com",
  "api.stepfun.com",
  "api.moonshot.cn",
  "open.bigmodel.cn",
  "api.minimax.chat",
  "api.deepseek.com"
]);

interface RuntimeProfileRegistryFile {
  schemaVersion: typeof RUNTIME_PROFILE_REGISTRY_SCHEMA_V1;
  profiles: RuntimeProfile[];
  legacyClaudeMigrations: Record<string, string>;
  deletedLegacyClaudeIds: string[];
}

interface LegacyClaudeProviderProfile {
  id?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  apiFormat?: unknown;
  primaryModel?: unknown;
  thinkingModel?: unknown;
  defaultHaikuModel?: unknown;
  defaultSonnetModel?: unknown;
  defaultOpusModel?: unknown;
  extraEnv?: unknown;
  notes?: unknown;
  riskFlags?: unknown;
}

export interface RuntimeProfileInput {
  id?: string;
  name: string;
  agentKind: RuntimeAgentKind;
  mode: RuntimeProfile["mode"];
  commandPath?: string;
  provider?: Omit<RuntimeProfileProvider, "secretRef">;
  extraEnv?: Record<string, string>;
  riskFlags?: RuntimeProfileRiskFlag[];
  notes?: string;
  _confirmBaseUrlRisk?: boolean;
}

const BUILT_IN_PROFILES: RuntimeProfile[] = [
  {
    schemaVersion: RUNTIME_PROFILE_SCHEMA_V1,
    id: "codex-local",
    name: "Current local Codex setup",
    agentKind: "codex",
    mode: "inherit-local",
    revision: 1,
    secretRevision: 1,
    extraEnv: {},
    riskFlags: [],
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    isBuiltIn: true
  },
  {
    schemaVersion: RUNTIME_PROFILE_SCHEMA_V1,
    id: "claude-local",
    name: "Current local Claude setup",
    agentKind: "claude-code",
    mode: "inherit-local",
    revision: 1,
    secretRevision: 1,
    extraEnv: {},
    riskFlags: [],
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    isBuiltIn: true
  }
];

let registryMutationTail: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function appDataRoot(): string {
  if (process.env.AGENTARENA_RUNTIME_PROFILE_ROOT?.trim()) {
    return process.env.AGENTARENA_RUNTIME_PROFILE_ROOT.trim();
  }
  if (process.env.AGENTARENA_CLAUDE_PROFILE_ROOT?.trim()) {
    return process.env.AGENTARENA_CLAUDE_PROFILE_ROOT.trim();
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "AgentArena");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "agentarena");
}

function registryPath(): string {
  return process.env.AGENTARENA_RUNTIME_PROFILES_FILE?.trim() || path.join(appDataRoot(), "runtime-profiles.json");
}

function legacyClaudeRegistryPath(): string {
  return process.env.AGENTARENA_CLAUDE_PROFILES_FILE?.trim() || path.join(appDataRoot(), "claude-provider-profiles.json");
}

function emptyRegistry(): RuntimeProfileRegistryFile {
  return {
    schemaVersion: RUNTIME_PROFILE_REGISTRY_SCHEMA_V1,
    profiles: [],
    legacyClaudeMigrations: {},
    deletedLegacyClaudeIds: []
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function assertRuntimeProfileId(profileId: string): void {
  if (!RUNTIME_PROFILE_ID_PATTERN.test(profileId)) {
    throw new Error(`Invalid runtime profile ID "${profileId}".`);
  }
}

function profilePrefix(agentKind: RuntimeAgentKind): string {
  return agentKind === "codex" ? "codex" : "claude";
}

function generateProfileId(agentKind: RuntimeAgentKind, name: string, existingIds: Set<string>): string {
  const prefix = profilePrefix(agentKind);
  const base = `${prefix}-${slugify(name) || "provider"}`.slice(0, 56).replace(/-+$/, "");
  if (!existingIds.has(base) && !BUILT_IN_PROFILES.some((profile) => profile.id === base)) {
    return base;
  }
  return `${base.slice(0, 51).replace(/-+$/, "")}-${randomUUID().slice(0, 8)}`;
}

function runtimeSecretRef(agentKind: RuntimeAgentKind, profileId: string): string {
  return `runtime-profile/${agentKind}/${profileId}`;
}

function legacySecretRef(profileId: string): string {
  return `legacy-claude/${profileId}`;
}

function legacyIdFromSecretRef(secretRef: string | undefined): string | undefined {
  return secretRef?.startsWith("legacy-claude/") ? secretRef.slice("legacy-claude/".length) : undefined;
}

function normalizeExtraEnvironment(extraEnv: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(extraEnv ?? {})
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key, value]) => key && value)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeProvider(provider: RuntimeProfileInput["provider"] | undefined): RuntimeProfileInput["provider"] {
  if (!provider) return undefined;
  return {
    ...provider,
    baseUrl: provider.baseUrl?.trim() || undefined,
    requestedModel: provider.requestedModel?.trim() || undefined,
    canonicalModelIdentity: provider.canonicalModelIdentity?.trim() || undefined,
    reasoningEffort: provider.reasoningEffort?.trim() || undefined,
    modelMappings: provider.modelMappings
      ? Object.fromEntries(
          Object.entries(provider.modelMappings)
            .map(([key, value]) => [key.trim(), value.trim()] as const)
            .filter(([key, value]) => key && value)
            .sort(([left], [right]) => left.localeCompare(right))
        )
      : undefined
  };
}

async function validateProviderAddress(input: RuntimeProfileInput): Promise<RuntimeProfileRiskFlag[]> {
  const riskFlags = new Set(input.riskFlags ?? []);
  const baseUrl = input.provider?.baseUrl?.trim();
  if (!baseUrl) return [...riskFlags];

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Provider baseUrl "${baseUrl}" is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Provider baseUrl must use http or https.");
  }
  if (isInternalUrl(baseUrl)) {
    throw new Error(`Provider baseUrl "${baseUrl}" points to an internal or private address (SSRF risk).`);
  }
  if (process.env.AGENTARENA_SKIP_DNS_CHECK !== "1" && (await hasInternalDnsResolution(baseUrl))) {
    throw new Error(`Provider baseUrl "${baseUrl}" resolves to an internal or private address (SSRF risk).`);
  }
  if (!KNOWN_PROVIDER_HOSTS.has(parsed.hostname.toLowerCase())) {
    if (!input._confirmBaseUrlRisk && !riskFlags.has("base-url-redirects-traffic")) {
      throw new Error(
        `Provider baseUrl "${baseUrl}" routes traffic to a third-party server. Confirm the risk to proceed.`
      );
    }
    riskFlags.add("base-url-redirects-traffic");
  }
  return [...riskFlags];
}

async function readRegistryFile(): Promise<RuntimeProfileRegistryFile> {
  await recoverAtomicFile(registryPath());
  let raw: string;
  try {
    raw = await fs.readFile(registryPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyRegistry();
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Runtime profile registry at ${registryPath()} is malformed JSON.`);
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== RUNTIME_PROFILE_REGISTRY_SCHEMA_V1) {
    throw new Error(`Runtime profile registry at ${registryPath()} has an unsupported schema.`);
  }

  const profiles = Array.isArray(parsed.profiles)
    ? parsed.profiles.filter((profile): profile is RuntimeProfile => {
        if (!isRecord(profile) || typeof profile.id !== "string") return false;
        const errors = validateRuntimeProfile(profile);
        if (errors.length > 0) {
          logger.warn(
            "adapter",
            "runtime_profile.invalid_skipped",
            `Ignoring invalid runtime profile "${profile.id}": ${errors.join(" ")}`
          );
          return false;
        }
        return !profile.isBuiltIn;
      })
    : [];

  return {
    schemaVersion: RUNTIME_PROFILE_REGISTRY_SCHEMA_V1,
    profiles,
    legacyClaudeMigrations: isRecord(parsed.legacyClaudeMigrations)
      ? Object.fromEntries(
          Object.entries(parsed.legacyClaudeMigrations).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : {},
    deletedLegacyClaudeIds: Array.isArray(parsed.deletedLegacyClaudeIds)
      ? parsed.deletedLegacyClaudeIds.filter((entry): entry is string => typeof entry === "string")
      : []
  };
}

async function writeRegistryFile(registry: RuntimeProfileRegistryFile): Promise<void> {
  await fs.mkdir(path.dirname(registryPath()), { recursive: true });
  await writeJsonAtomic(registryPath(), registry);
}

async function readLegacyClaudeProfiles(): Promise<LegacyClaudeProviderProfile[]> {
  let raw: string;
  try {
    raw = await fs.readFile(legacyClaudeRegistryPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as { profiles?: unknown };
    return Array.isArray(parsed.profiles)
      ? parsed.profiles.filter((entry): entry is LegacyClaudeProviderProfile => isRecord(entry))
      : [];
  } catch {
    logger.warn(
      "adapter",
      "runtime_profile.legacy_registry_invalid",
      `Legacy Claude provider registry at ${legacyClaudeRegistryPath()} is malformed; migration was skipped.`
    );
    return [];
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function legacyExtraEnvironment(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, entry]) => [key.trim(), entry.trim()] as const)
      .filter(([key, entry]) => key && entry && !isReservedRuntimeProfileEnvironmentKey(key))
  );
}

function migrateLegacyProfile(
  legacy: LegacyClaudeProviderProfile,
  migratedId: string,
  timestamp: string
): RuntimeProfile | undefined {
  const legacyId = stringValue(legacy.id);
  const name = stringValue(legacy.name);
  const baseUrl = stringValue(legacy.baseUrl);
  const requestedModel = stringValue(legacy.primaryModel);
  if (!legacyId || !RUNTIME_PROFILE_ID_PATTERN.test(legacyId) || !name || !baseUrl || !requestedModel) {
    return undefined;
  }

  const modelMappings = Object.fromEntries(
    [
      ["haiku", stringValue(legacy.defaultHaikuModel)],
      ["sonnet", stringValue(legacy.defaultSonnetModel)],
      ["opus", stringValue(legacy.defaultOpusModel)],
      ["thinking", stringValue(legacy.thinkingModel)]
    ].filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
  const legacyRiskFlags = Array.isArray(legacy.riskFlags)
    ? legacy.riskFlags.filter((flag): flag is string => typeof flag === "string")
    : [];
  const riskFlags = new Set<RuntimeProfileRiskFlag>(["third-party-provider", "user-managed-secret"]);
  if (legacyRiskFlags.includes("compatibility-mode")) riskFlags.add("compatibility-mode");
  if (legacyRiskFlags.includes("baseUrl-redirects-traffic")) riskFlags.add("base-url-redirects-traffic");

  return {
    schemaVersion: RUNTIME_PROFILE_SCHEMA_V1,
    id: migratedId,
    name,
    agentKind: "claude-code",
    mode: "managed-provider",
    revision: 1,
    secretRevision: 1,
    provider: {
      baseUrl,
      protocol: legacy.apiFormat === "openai-chat-via-proxy" ? "openai-chat-via-proxy" : "anthropic-messages",
      requestedModel,
      modelIdentitySource: "unknown",
      modelMappings: Object.keys(modelMappings).length > 0 ? modelMappings : undefined,
      secretRef: legacySecretRef(legacyId)
    },
    extraEnv: legacyExtraEnvironment(legacy.extraEnv),
    riskFlags: [...riskFlags],
    notes: stringValue(legacy.notes),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function migrateLegacyClaudeProfiles(registry: RuntimeProfileRegistryFile): Promise<boolean> {
  const legacyProfiles = await readLegacyClaudeProfiles();
  if (legacyProfiles.length === 0) return false;

  let changed = false;
  const existingIds = new Set([...BUILT_IN_PROFILES.map((profile) => profile.id), ...registry.profiles.map((profile) => profile.id)]);
  const deletedIds = new Set(registry.deletedLegacyClaudeIds);
  const timestamp = new Date().toISOString();
  for (const legacy of legacyProfiles) {
    const legacyId = stringValue(legacy.id);
    if (!legacyId || deletedIds.has(legacyId) || registry.legacyClaudeMigrations[legacyId]) continue;

    let migratedId = `claude-${legacyId}`.slice(0, 64).replace(/-+$/, "");
    if (!RUNTIME_PROFILE_ID_PATTERN.test(migratedId) || existingIds.has(migratedId)) {
      migratedId = generateProfileId("claude-code", stringValue(legacy.name) ?? legacyId, existingIds);
    }
    const profile = migrateLegacyProfile(legacy, migratedId, timestamp);
    if (!profile) continue;
    registry.profiles.push(profile);
    registry.legacyClaudeMigrations[legacyId] = migratedId;
    existingIds.add(migratedId);
    changed = true;
  }
  return changed;
}

async function readRegistryWithMigration(): Promise<RuntimeProfileRegistryFile> {
  const registry = await readRegistryFile();
  if (await migrateLegacyClaudeProfiles(registry)) {
    await writeRegistryFile(registry);
  }
  return registry;
}

async function withRegistryMutation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = registryMutationTail;
  let release: () => void = () => {};
  registryMutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function hasProfileSecret(profile: RuntimeProfile): Promise<boolean> {
  const secretRef = profile.provider?.secretRef;
  if (!secretRef) return false;
  const legacyId = legacyIdFromSecretRef(secretRef);
  return legacyId ? await hasStoredSecret(legacyId) : await hasStoredRuntimeSecret(secretRef);
}

async function readProfileSecret(profile: RuntimeProfile): Promise<string | null> {
  const secretRef = profile.provider?.secretRef;
  if (!secretRef) return null;
  const legacyId = legacyIdFromSecretRef(secretRef);
  return legacyId ? await getSecret(legacyId) : await getRuntimeSecret(secretRef);
}

export async function listRuntimeProfiles(): Promise<RuntimeProfile[]> {
  const registry = await withRegistryMutation(readRegistryWithMigration);
  return [
    ...BUILT_IN_PROFILES.map((profile) => structuredClone(profile)),
    ...registry.profiles
      .map((profile) => structuredClone(profile))
      .sort((left, right) => left.name.localeCompare(right.name))
  ];
}

export async function listPublicRuntimeProfiles(): Promise<PublicRuntimeProfile[]> {
  const profiles = await listRuntimeProfiles();
  return await Promise.all(
    profiles.map(async (profile) => toPublicRuntimeProfile(profile, await hasProfileSecret(profile)))
  );
}

export async function getRuntimeProfile(profileId: string): Promise<RuntimeProfile> {
  assertRuntimeProfileId(profileId);
  const profile = (await listRuntimeProfiles()).find((entry) => entry.id === profileId);
  if (!profile) throw new Error(`Unknown runtime profile "${profileId}".`);
  return profile;
}

export async function getDefaultRuntimeProfile(agentKind: RuntimeAgentKind): Promise<RuntimeProfile> {
  return await getRuntimeProfile(agentKind === "codex" ? "codex-local" : "claude-local");
}

export async function saveRuntimeProfile(input: RuntimeProfileInput): Promise<RuntimeProfile> {
  return await withRegistryMutation(async () => {
    const registry = await readRegistryWithMigration();
    const existingIds = new Set([...BUILT_IN_PROFILES.map((profile) => profile.id), ...registry.profiles.map((profile) => profile.id)]);
    const id = input.id?.trim() || generateProfileId(input.agentKind, input.name, existingIds);
    assertRuntimeProfileId(id);
    if (BUILT_IN_PROFILES.some((profile) => profile.id === id)) {
      throw new Error(`Built-in runtime profile "${id}" cannot be replaced.`);
    }
    if (!id.startsWith(`${profilePrefix(input.agentKind)}-`)) {
      throw new Error(`Runtime profile ID "${id}" must start with ${profilePrefix(input.agentKind)}-.`);
    }

    const existing = registry.profiles.find((profile) => profile.id === id);
    if (existing && existing.agentKind !== input.agentKind) {
      throw new Error(`Runtime profile "${id}" belongs to ${existing.agentKind}, not ${input.agentKind}.`);
    }
    const timestamp = new Date().toISOString();
    const provider = normalizeProvider(input.provider);
    if (input.mode === "inherit-local" && (provider?.baseUrl || provider?.protocol)) {
      throw new Error("Inherited-local runtime profiles may override a model, but cannot configure Provider routing.");
    }
    const localProvider = provider
      ? {
          ...(provider.requestedModel ? { requestedModel: provider.requestedModel } : {}),
          ...(provider.canonicalModelIdentity ? { canonicalModelIdentity: provider.canonicalModelIdentity } : {}),
          ...(provider.modelIdentitySource ? { modelIdentitySource: provider.modelIdentitySource } : {}),
          ...(provider.reasoningEffort ? { reasoningEffort: provider.reasoningEffort } : {}),
          ...(provider.modelMappings ? { modelMappings: provider.modelMappings } : {})
        }
      : undefined;
    const effectiveRiskFlags = await validateProviderAddress({
      ...input,
      provider: input.mode === "managed-provider" ? provider : undefined
    });
    const profile: RuntimeProfile = {
      schemaVersion: RUNTIME_PROFILE_SCHEMA_V1,
      id,
      name: input.name.trim(),
      agentKind: input.agentKind,
      mode: input.mode,
      revision: (existing?.revision ?? 0) + 1,
      secretRevision: existing?.secretRevision ?? 1,
      commandPath: input.commandPath?.trim() || undefined,
      provider:
        input.mode === "managed-provider"
          ? {
              ...provider,
              secretRef: existing?.provider?.secretRef ?? runtimeSecretRef(input.agentKind, id)
            }
          : localProvider,
      extraEnv: input.extraEnv === undefined
        ? { ...(existing?.extraEnv ?? {}) }
        : normalizeExtraEnvironment(input.extraEnv),
      riskFlags: [...new Set(effectiveRiskFlags)].sort(),
      notes: input.notes?.trim() || undefined,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    const errors = validateRuntimeProfile(profile);
    if (errors.length > 0) {
      throw new Error(`Invalid runtime profile: ${errors.join(" ")}`);
    }

    registry.profiles = [...registry.profiles.filter((entry) => entry.id !== id), profile];
    await writeRegistryFile(registry);
    return structuredClone(profile);
  });
}

export async function setRuntimeProfileSecret(profileId: string, secret: string): Promise<RuntimeProfile> {
  return await withRegistryMutation(async () => {
    const registry = await readRegistryWithMigration();
    const profile = registry.profiles.find((entry) => entry.id === profileId);
    if (!profile) throw new Error(`Unknown managed runtime profile "${profileId}".`);
    const secretRef = profile.provider?.secretRef;
    if (profile.mode !== "managed-provider" || !secretRef) {
      throw new Error(`Runtime profile "${profileId}" does not use an AgentArena-managed secret.`);
    }

    const previousSecret = await readProfileSecret(profile);
    const nextSecret = secret.trim();
    const legacyId = legacyIdFromSecretRef(secretRef);
    const nextSecretRef = legacyId ? runtimeSecretRef(profile.agentKind, profile.id) : secretRef;
    try {
      if (nextSecret) await setRuntimeSecret(nextSecretRef, nextSecret);
      else await deleteRuntimeSecret(nextSecretRef);

      const updated: RuntimeProfile = {
        ...profile,
        provider: { ...profile.provider, secretRef: nextSecretRef },
        secretRevision: profile.secretRevision + 1,
        updatedAt: new Date().toISOString()
      };
      registry.profiles = registry.profiles.map((entry) => (entry.id === profileId ? updated : entry));
      await writeRegistryFile(registry);
      if (legacyId) await deleteSecret(legacyId).catch(() => {});
      return structuredClone(updated);
    } catch (error) {
      if (previousSecret) await setRuntimeSecret(nextSecretRef, previousSecret).catch(() => {});
      else await deleteRuntimeSecret(nextSecretRef).catch(() => {});
      throw error;
    }
  });
}

export async function getRuntimeProfileSecret(profileId: string): Promise<string | null> {
  assertRuntimeProfileId(profileId);
  const registry = await withRegistryMutation(readRegistryWithMigration);
  const profile = registry.profiles.find((entry) => entry.id === profileId);
  return profile ? await readProfileSecret(profile) : null;
}

export async function deleteRuntimeProfile(profileId: string): Promise<void> {
  await withRegistryMutation(async () => {
    if (BUILT_IN_PROFILES.some((profile) => profile.id === profileId)) {
      throw new Error(`Built-in runtime profile "${profileId}" cannot be deleted.`);
    }
    const registry = await readRegistryWithMigration();
    const profile = registry.profiles.find((entry) => entry.id === profileId);
    if (!profile) throw new Error(`Unknown runtime profile "${profileId}".`);

    const secretRef = profile.provider?.secretRef;
    const legacyId = legacyIdFromSecretRef(secretRef);
    if (secretRef) {
      if (legacyId) await deleteSecret(legacyId);
      else await deleteRuntimeSecret(secretRef);
    }
    if (legacyId) {
      registry.deletedLegacyClaudeIds = [...new Set([...registry.deletedLegacyClaudeIds, legacyId])].sort();
    }
    registry.profiles = registry.profiles.filter((entry) => entry.id !== profileId);
    await writeRegistryFile(registry);
  });
}

export const __runtimeProfileRegistryTestUtils = {
  appDataRoot,
  registryPath,
  legacyClaudeRegistryPath,
  runtimeSecretRef
};
