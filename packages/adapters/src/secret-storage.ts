/**
 * Secret storage for provider profile credentials.
 *
 * Extracted from claude-provider-profiles.ts to isolate crypto, PowerShell,
 * and file I/O concerns from profile CRUD logic.
 *
 * Backends:
 * - Windows: PasswordVault via PowerShell (Credential Manager)
 * - Other platforms: AES-256-GCM encrypted file with machine-bound key
 *
 * Security model:
 * - Machine-bound key derived from hostname + username (scrypt)
 * - Changing hostname or username silently invalidates encrypted secrets
 * - Windows Credential Manager stores secrets in the user's Windows profile
 */

import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "@agentarena/core";
import { assertClaudeProviderProfileId } from "./provider-profile-id.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

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

function secretTarget(profileId: string): string {
  assertClaudeProviderProfileId(profileId);
  const prefix = process.env.AGENTARENA_CLAUDE_SECRET_PREFIX?.trim() || "AgentArena/claude-profile/";
  return `${prefix}${profileId}`;
}

function secretDirectory(): string {
  return path.join(appDataRoot(), "secrets");
}

function secretFilePath(profileId: string): string {
  assertClaudeProviderProfileId(profileId);
  return path.join(secretDirectory(), `${profileId}.secret`);
}

// ---------------------------------------------------------------------------
// PowerShell helpers (Windows Credential Manager)
// ---------------------------------------------------------------------------

function powershellExecutable(): string {
  return process.platform === "win32" ? "powershell.exe" : "powershell";
}

function powershellEnvironment(): NodeJS.ProcessEnv {
  // Package-manager metadata and HOME can change Windows Runtime credential
  // context. Keep the PowerShell child tied to the host Windows profile.
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(?:home|npm_|pnpm_)/iu.test(key))
  );
}

function encodeForPowerShell(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/**
 * Run a PowerShell script and parse its JSON output.
 *
 * SECURITY: The script is encoded as Base64 UTF-16LE for -EncodedCommand,
 * which eliminates shell injection risk through script content. The user-
 * provided data (target, password) is Base64-encoded within the script and
 * decoded at runtime inside PowerShell, so special characters cannot break
 * out of string interpolation.
 */
async function runPowerShellJson(script: string): Promise<unknown> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return await new Promise((resolve, reject) => {
    execFile(
      powershellExecutable(),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, env: powershellEnvironment() },
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
// Windows Credential Manager backend
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

function warnWindowsSecretFallback(): void {
  logger.warn(
    "adapter",
    "profile.secret_backend_fallback",
    "Windows Credential Manager is unavailable; using the encrypted file backend"
  );
}

async function setSecretWithFallback(profileId: string, secret: string): Promise<void> {
  try {
    await setSecretWindows(profileId, secret);
    return;
  } catch {
    warnWindowsSecretFallback();
  }
  await setSecretFile(profileId, secret);
}

async function getSecretWithFallback(profileId: string): Promise<string | null> {
  try {
    const systemSecret = await getSecretWindows(profileId);
    if (systemSecret !== null) return systemSecret;
  } catch {
    warnWindowsSecretFallback();
  }
  return await getSecretFile(profileId);
}

async function deleteSecretWithFallback(profileId: string): Promise<void> {
  try {
    await deleteSecretWindows(profileId);
  } catch {
    warnWindowsSecretFallback();
  }
  await deleteSecretFile(profileId);
}

// ---------------------------------------------------------------------------
// AES-256-GCM file-based backend (non-Windows)
// ---------------------------------------------------------------------------

const SECRET_ENCRYPTION_MARKER = "ENC1:";

/**
 * Derive a machine-bound encryption key from hostname + username.
 *
 * THREAT MODEL:
 * - Protects secrets at rest on shared filesystems (NFS, cloud drives)
 * - Does NOT protect against local privilege escalation (key derivation
 *   inputs are publicly known: hostname and username)
 * - Does NOT protect against a process running as the same user
 *
 * CAVEAT: Renaming the machine or user account silently invalidates all
 * encrypted secrets. The getSecretFile() function catches the decryption
 * failure and logs a warning, but does NOT auto-recover.
 *
 * Algorithm: scrypt (memory-hard KDF) with default parameters.
 * Salt: agentarena-secret-${hostname}-${username}
 * Output: 32-byte key for AES-256-GCM
 */
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
    logger.warn("adapter", "profile.decrypt_failed", `Failed to decrypt secret: decryption error (possible machine-key mismatch)`);
    return null;
  }
}

async function setSecretFile(profileId: string, secret: string): Promise<void> {
  await fs.mkdir(secretDirectory(), { recursive: true });
  const filePath = secretFilePath(profileId);
  const encrypted = encryptSecret(secret.trim());
  await fs.writeFile(filePath, `${encrypted}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(filePath, 0o600).catch((err) => {
    logger.debug("adapter", "profile.chmod_failed", `chmod 0o600 failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/**
 * Read a secret from the file-based storage backend.
 *
 * FORMAT MIGRATION HISTORY (newest first):
 * 1. ENC1: prefix — AES-256-GCM encrypted, machine-bound key (current)
 * 2. Valid Base64 — decoded and used (legacy, auto-detected)
 * 3. Raw plaintext — used as-is (oldest legacy, no encoding)
 *
 * The fallback chain reads the file once and tries each format in order.
 * New secrets are always written in ENC1 format via setSecretFile().
 */
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
      logger.debug("adapter", "profile.secret_decode", `Base64 decode failed for profile "${profileId}"; falling back to raw value`);
    }
    return raw || null;
  } catch {
    return null;
  }
}

async function deleteSecretFile(profileId: string): Promise<void> {
  await fs.rm(secretFilePath(profileId), { force: true });
}

// ---------------------------------------------------------------------------
// Public API: platform-dispatched secret operations
// ---------------------------------------------------------------------------

export async function hasStoredSecret(profileId: string): Promise<boolean> {
  if (process.platform === "win32") {
    return (await getSecretWithFallback(profileId)) !== null;
  }

  return (await getSecretFile(profileId)) !== null;
}

/**
 * @deprecated Always returns `true`. Profile secret storage now works on every
 * platform (Windows Credential Manager, macOS Keychain, encrypted file
 * fallback), so the predicate has no remaining purpose. Callers using this
 * as a feature gate are dead branches — remove or replace with explicit
 * platform checks where actually needed.
 */
export function supportsWindowsCredentialManager(): boolean {
  return true;
}

export async function setSecret(profileId: string, secret: string): Promise<void> {
  if (process.platform === "win32") {
    await setSecretWithFallback(profileId, secret);
  } else {
    await setSecretFile(profileId, secret);
  }
}

export async function getSecret(profileId: string): Promise<string | null> {
  return process.platform === "win32"
    ? await getSecretWithFallback(profileId)
    : await getSecretFile(profileId);
}

export async function deleteSecret(profileId: string): Promise<void> {
  if (process.platform === "win32") {
    await deleteSecretWithFallback(profileId);
  } else {
    await deleteSecretFile(profileId);
  }
}

function assertRuntimeSecretRef(secretRef: string): void {
  if (!/^(?:runtime-profile\/(?:codex|claude-code)\/[a-z0-9-]+|legacy-claude\/[a-z0-9-]+)$/.test(secretRef)) {
    throw new Error(`Invalid runtime secret reference "${secretRef}".`);
  }
}

function runtimeSecretStorageId(secretRef: string): string {
  assertRuntimeSecretRef(secretRef);
  return `runtime-${createHash("sha256").update(secretRef).digest("hex").slice(0, 40)}`;
}

function useRuntimeSecretFileBackend(): boolean {
  const configured = process.env.AGENTARENA_RUNTIME_SECRET_BACKEND?.trim().toLowerCase();
  if (configured && configured !== "file" && configured !== "system") {
    throw new Error("AGENTARENA_RUNTIME_SECRET_BACKEND must be file or system when set.");
  }
  return configured === "file" || (configured !== "system" && process.platform !== "win32");
}

export async function hasStoredRuntimeSecret(secretRef: string): Promise<boolean> {
  return (await getRuntimeSecret(secretRef)) !== null;
}

export async function setRuntimeSecret(secretRef: string, secret: string): Promise<void> {
  const storageId = runtimeSecretStorageId(secretRef);
  if (useRuntimeSecretFileBackend()) {
    await setSecretFile(storageId, secret);
    return;
  }
  await setSecretWithFallback(storageId, secret);
}

export async function getRuntimeSecret(secretRef: string): Promise<string | null> {
  const storageId = runtimeSecretStorageId(secretRef);
  return useRuntimeSecretFileBackend()
    ? await getSecretFile(storageId)
    : await getSecretWithFallback(storageId);
}

export async function deleteRuntimeSecret(secretRef: string): Promise<void> {
  const storageId = runtimeSecretStorageId(secretRef);
  if (useRuntimeSecretFileBackend()) {
    await deleteSecretFile(storageId);
    return;
  }
  await deleteSecretWithFallback(storageId);
}

export const __secretStorageTestUtils = {
  appDataRoot,
  secretTarget,
  runtimeSecretStorageId
};
