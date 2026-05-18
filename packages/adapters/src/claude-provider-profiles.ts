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
 * - Secret storage: Windows uses PasswordVault via PowerShell,
 *   other platforms use AES-256-GCM with machine-bound key (hostname + username)
 * - Profile CRUD: save, get, list, delete, buildEnvironment
 * - Workspace settings writer (generates .claude/settings.json per run)
 *
 * Security model:
 * - baseUrl validated against ALLOWED_API_HOSTS (4 known providers)
 * - Private/loopback IPs blocked via isInternalUrl() (SSRF prevention)
 * - Unknown hosts require _confirmBaseUrlRisk acknowledgment
 * - Secrets are machine-bound: changing hostname or username silently
 *   invalidates encrypted secrets (logged via console.warn)
 *
 * Why one file: crypto, PowerShell, and file I/O are tightly coupled to
 * the profile lifecycle. Splitting creates circular deps between the
 * secret layer and the profile layer.
 */
import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ClaudeProviderProfile, ClaudeProviderRiskFlag } from "@agentarena/core";
import { isInternalUrl } from "@agentarena/core";

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

function secretTarget(profileId: string): string {
  validateProfileId(profileId);
  const prefix = process.env.AGENTARENA_CLAUDE_SECRET_PREFIX?.trim() || "AgentArena/claude-profile/";
  return `${prefix}${profileId}`;
}

function secretDirectory(): string {
  return path.join(appDataRoot(), "secrets");
}

function secretFilePath(profileId: string): string {
  validateProfileId(profileId);
  return path.join(secretDirectory(), `${profileId}.secret`);
}

function validateProfileId(profileId: string): void {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}[a-zA-Z0-9]$/.test(profileId) &&
    !/^[a-zA-Z0-9]$/.test(profileId)
  ) {
    throw new Error(
      `Invalid profile ID: "${profileId}". Must contain only alphanumeric characters and hyphens.`
    );
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function defaultRiskFlags(kind: ClaudeProviderProfile["kind"]): ClaudeProviderRiskFlag[] {
  if (kind === "official") {
    return [];
  }

  return ["third-party-provider", "compatibility-mode", "user-managed-secret"];
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

function powershellExecutable(): string {
  return process.platform === "win32" ? "powershell.exe" : "powershell";
}

function encodeForPowerShell(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

async function runPowerShellJson(script: string): Promise<unknown> {
  // Encode the entire script as Base64 UTF-16LE for -EncodedCommand,
  // eliminating any risk of shell injection through script content.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return await new Promise((resolve, reject) => {
    execFile(
      powershellExecutable(),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || stdout.trim() || error.message));
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(trimmed));
        } catch (_parseError) {
          reject(new Error(`Failed to parse PowerShell JSON output: ${trimmed}`));
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Section 2: Secret storage (Windows Credential Manager / AES-256-GCM)
// ---------------------------------------------------------------------------

async function setSecretWindows(profileId: string, secret: string): Promise<void> {
  const target = secretTarget(profileId);
  const resource = encodeForPowerShell(target);
  const password = encodeForPowerShell(secret);
  const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
$resource = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${resource}'))
$user = 'agentarena'
$password = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${password}'))
try {
  try {
    $existing = $vault.Retrieve($resource, $user)
    $existing.RetrievePassword()
    $vault.Remove($existing)
  } catch {
    Write-Verbose "No existing credential to remove for $resource"
  }
  $credential = New-Object Windows.Security.Credentials.PasswordCredential($resource, $user, $password)
  $vault.Add($credential)
  @{ ok = $true } | ConvertTo-Json -Compress
} catch {
  throw $_
}
`;
  await runPowerShellJson(script);
}

async function getSecretWindows(profileId: string): Promise<string | null> {
  const target = secretTarget(profileId);
  const resource = encodeForPowerShell(target);
  const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
$resource = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${resource}'))
$user = 'agentarena'
try {
  $credential = $vault.Retrieve($resource, $user)
  $credential.RetrievePassword()
  @{ secret = $credential.Password } | ConvertTo-Json -Compress
} catch {
  @{ secret = $null } | ConvertTo-Json -Compress
}
`;
  const result = (await runPowerShellJson(script)) as { secret?: string | null } | null;
  return result?.secret ?? null;
}

async function deleteSecretWindows(profileId: string): Promise<void> {
  const target = secretTarget(profileId);
  const resource = encodeForPowerShell(target);
  const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
$resource = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${resource}'))
$user = 'agentarena'
try {
  $credential = $vault.Retrieve($resource, $user)
  $credential.RetrievePassword()
  $vault.Remove($credential)
} catch {
  Write-Verbose "No existing credential to remove for $resource"
}
@{ ok = $true } | ConvertTo-Json -Compress
`;
  await runPowerShellJson(script);
}

const SECRET_ENCRYPTION_MARKER = "ENC1:";

function deriveMachineKey(): Buffer {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const salt = `agentarena-secret-${hostname}-${username}`;
  return scryptSync(hostname + username, salt, 32);
}

function encryptSecret(plaintext: string): string {
  const key = deriveMachineKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return SECRET_ENCRYPTION_MARKER + Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptSecret(encrypted: string): string | null {
  if (!encrypted.startsWith(SECRET_ENCRYPTION_MARKER)) return null;
  try {
    const data = Buffer.from(encrypted.slice(SECRET_ENCRYPTION_MARKER.length), "base64");
    const iv = data.subarray(0, 16);
    const authTag = data.subarray(16, 32);
    const ciphertext = data.subarray(32);
    const key = deriveMachineKey();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  } catch {
    return null;
  }
}

async function setSecretFile(profileId: string, secret: string): Promise<void> {
  await fs.mkdir(secretDirectory(), { recursive: true });
  const filePath = secretFilePath(profileId);
  const encrypted = encryptSecret(secret.trim());
  await fs.writeFile(filePath, `${encrypted}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(filePath, 0o600).catch(() => {});
}

async function getSecretFile(profileId: string): Promise<string | null> {
  try {
    const raw = (await fs.readFile(secretFilePath(profileId), "utf8")).trim();
    if (!raw) return null;
    if (raw.startsWith(SECRET_ENCRYPTION_MARKER)) {
      const decrypted = decryptSecret(raw);
      if (decrypted === null) {
        // biome-ignore lint/suspicious/noConsole: security diagnostic for failed decryption
        console.warn(
          `[agentarena] Failed to decrypt secret for profile "${profileId}". ` +
          `The secret was encrypted on a different machine (hostname+username derived key). ` +
          `Please re-set the secret using: agentarena ui → Provider Profiles → Set Secret`
        );
        return null;
      }
      return decrypted;
    }
    try {
      const decoded = Buffer.from(raw, "base64").toString("utf8");
      if (Buffer.from(decoded, "utf8").toString("base64") === raw) {
        return decoded || null;
      }
    } catch {
      // Fall through to return raw value for legacy plaintext files
    }
    return raw || null;
  } catch {
    return null;
  }
}

async function deleteSecretFile(profileId: string): Promise<void> {
  await fs.rm(secretFilePath(profileId), { force: true });
}

async function hasStoredSecret(profileId: string): Promise<boolean> {
  if (process.platform === "win32") {
    return (await getSecretWindows(profileId)) !== null;
  }

  return (await getSecretFile(profileId)) !== null;
}

export function supportsWindowsCredentialManager(): boolean {
  // Legacy public helper kept for compatibility with existing callers/tests.
  // AgentArena now supports profile secret storage on every platform, even if the backend differs.
  return true;
}

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
// Section 3: Profile CRUD (save, get, list, delete, buildEnvironment)
// ---------------------------------------------------------------------------

export async function saveClaudeProviderProfile(input: ClaudeProviderProfileInput): Promise<ClaudeProviderProfile> {
  if (input.kind === "official") {
    throw new Error("The built-in official Claude profile cannot be replaced.");
  }

  if (input.baseUrl && isInternalUrl(input.baseUrl)) {
    throw new Error("baseUrl cannot point to an internal/private address. This restriction prevents Server-Side Request Forgery (SSRF) attacks.");
  }

  if (input.baseUrl) {
    let parsedHost: string;
    try {
      parsedHost = new URL(input.baseUrl).hostname.toLowerCase();
    } catch {
      throw new Error(`baseUrl "${input.baseUrl}" is not a valid URL.`);
    }
    const ALLOWED_API_HOSTS = new Set([
      "api.anthropic.com",
      "api.openai.com",
      "generativelanguage.googleapis.com",
      "dashscope.aliyuncs.com"
    ]);
    if (!ALLOWED_API_HOSTS.has(parsedHost)) {
      const riskFlag: ClaudeProviderRiskFlag = "baseUrl-redirects-traffic";
      if (!input._confirmBaseUrlRisk) {
        throw new Error(
          `baseUrl "${input.baseUrl}" points to a host that is not in the known API provider list. ` +
          `This means your API key will be sent to a third-party server. ` +
          `If you trust this provider, set _confirmBaseUrlRisk: true to acknowledge the risk. ` +
          `Known hosts: ${[...ALLOWED_API_HOSTS].join(", ")}`
        );
      }
      if (!input.riskFlags?.includes(riskFlag)) {
        input.riskFlags = [...(input.riskFlags ?? []), riskFlag];
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
    riskFlags: [...new Set([...defaultRiskFlags(input.kind), ...(input.riskFlags ?? [])])],
    isBuiltIn: false,
    secretStored: false
  });

  const nextProfiles = registry.profiles.filter((entry) => entry.id !== id);
  nextProfiles.push(profile);
  await writeRegistry({
    schemaVersion: 1,
    profiles: nextProfiles
  });

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
  await writeRegistry({
    schemaVersion: 1,
    profiles: registry.profiles.filter((entry) => entry.id !== profileId)
  });

  if (process.platform === "win32") {
    await deleteSecretWindows(profileId);
  } else {
    await deleteSecretFile(profileId);
  }
}

export async function setClaudeProviderProfileSecret(profileId: string, secret: string): Promise<void> {
  if (profileId === BUILT_IN_OFFICIAL_PROFILE.id) {
    throw new Error("The built-in official Claude profile does not use a stored secret.");
  }

  if (!secret.trim()) {
    if (process.platform === "win32") {
      await deleteSecretWindows(profileId);
    } else {
      await deleteSecretFile(profileId);
    }
    return;
  }

  if (process.platform === "win32") {
    await setSecretWindows(profileId, secret.trim());
  } else {
    await setSecretFile(profileId, secret.trim());
  }
}

export async function getClaudeProviderProfileSecret(profileId: string): Promise<string | null> {
  if (profileId === BUILT_IN_OFFICIAL_PROFILE.id) {
    return null;
  }

  return process.platform === "win32"
    ? await getSecretWindows(profileId)
    : await getSecretFile(profileId);
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
  secretTarget,
  supportsWindowsCredentialManager
};
