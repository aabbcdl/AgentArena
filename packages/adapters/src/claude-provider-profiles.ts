import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ClaudeProviderProfile, ClaudeProviderRiskFlag } from "@repoarena/core";

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
  if (process.env.REPOARENA_CLAUDE_PROFILE_ROOT?.trim()) {
    return process.env.REPOARENA_CLAUDE_PROFILE_ROOT.trim();
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "RepoArena");
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "repoarena");
}

function registryPath(): string {
  if (process.env.REPOARENA_CLAUDE_PROFILES_FILE?.trim()) {
    return process.env.REPOARENA_CLAUDE_PROFILES_FILE.trim();
  }

  return path.join(appDataRoot(), "claude-provider-profiles.json");
}

function secretTarget(profileId: string): string {
  const prefix = process.env.REPOARENA_CLAUDE_SECRET_PREFIX?.trim() || "RepoArena/claude-profile/";
  return `${prefix}${profileId}`;
}

function secretDirectory(): string {
  return path.join(appDataRoot(), "secrets");
}

function secretFilePath(profileId: string): string {
  return path.join(secretDirectory(), `${profileId}.secret`);
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

async function readRegistry(): Promise<ProfileRegistryFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath(), "utf8")) as ProfileRegistryFile;
    return {
      schemaVersion: 1,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles.map(normalizeProfile) : []
    };
  } catch {
    return {
      schemaVersion: 1,
      profiles: []
    };
  }
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
  const command = `${script}\n`;
  return await new Promise((resolve, reject) => {
    execFile(
      powershellExecutable(),
      ["-NoProfile", "-NonInteractive", "-Command", command],
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
        } catch (parseError) {
          reject(new Error(`Failed to parse PowerShell JSON output: ${trimmed}`));
        }
      }
    );
  });
}

async function setSecretWindows(profileId: string, secret: string): Promise<void> {
  const target = secretTarget(profileId);
  const resource = encodeForPowerShell(target);
  const password = encodeForPowerShell(secret);
  const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
$resource = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${resource}'))
$user = 'repoarena'
$password = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${password}'))
try {
  try {
    $existing = $vault.Retrieve($resource, $user)
    $existing.RetrievePassword()
    $vault.Remove($existing)
  } catch {}
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
$user = 'repoarena'
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
$user = 'repoarena'
try {
  $credential = $vault.Retrieve($resource, $user)
  $credential.RetrievePassword()
  $vault.Remove($credential)
} catch {}
@{ ok = $true } | ConvertTo-Json -Compress
`;
  await runPowerShellJson(script);
}

async function setSecretFile(profileId: string, secret: string): Promise<void> {
  await fs.mkdir(secretDirectory(), { recursive: true });
  const filePath = secretFilePath(profileId);
  await fs.writeFile(filePath, `${secret.trim()}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(filePath, 0o600).catch(() => {});
}

async function getSecretFile(profileId: string): Promise<string | null> {
  try {
    return (await fs.readFile(secretFilePath(profileId), "utf8")).trim() || null;
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
  // RepoArena now supports profile secret storage on every platform.
  return true;
}

export async function listClaudeProviderProfiles(): Promise<ClaudeProviderProfile[]> {
  const registry = await readRegistry();
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

export async function saveClaudeProviderProfile(input: ClaudeProviderProfileInput): Promise<ClaudeProviderProfile> {
  if (input.kind === "official") {
    throw new Error("The built-in official Claude profile cannot be replaced.");
  }

  const registry = await readRegistry();
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
    riskFlags: defaultRiskFlags(input.kind),
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
  await fs.writeFile(
    settingsPath,
    JSON.stringify(
      {
        env: environment,
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
