import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type UiAuthTokenSource = "cli" | "local-env" | "env" | "generated" | "unknown";
export type UiAuthMode = "password" | "token";

export const UI_AUTH_PASSWORD_MIN_LENGTH = 4;
export const UI_AUTH_PASSWORD_MAX_LENGTH = 128;

const UI_AUTH_PASSWORD_VERSION = 1;
const UI_AUTH_PASSWORD_ALGORITHM = "scrypt";
const UI_AUTH_PASSWORD_KEY_LENGTH = 32;
const UI_AUTH_PASSWORD_SALT_BYTES = 16;

export interface UiAuthPasswordRecord {
  version: 1;
  algorithm: "scrypt";
  salt: string;
  digest: string;
}

export interface ResolvedUiAuthToken {
  token: string;
  source: Exclude<UiAuthTokenSource, "unknown">;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/**
 * Resolve UI credentials without making a weak token the default.
 * The local-development variable intentionally wins over the legacy generic
 * variable so an explicit `AGENTARENA_LOCAL_AUTH_TOKEN=admin` is predictable.
 */
export function resolveUiAuthToken(
  cliToken: string | undefined,
  environment: Record<string, string | undefined>,
  generate: () => string
): ResolvedUiAuthToken {
  const fromCli = nonEmpty(cliToken);
  if (fromCli) return { token: fromCli, source: "cli" };

  const fromLocalEnvironment = nonEmpty(environment.AGENTARENA_LOCAL_AUTH_TOKEN);
  if (fromLocalEnvironment) return { token: fromLocalEnvironment, source: "local-env" };

  const fromEnvironment = nonEmpty(environment.AGENTARENA_AUTH_TOKEN);
  if (fromEnvironment) return { token: fromEnvironment, source: "env" };

  return { token: generate(), source: "generated" };
}

/**
 * Use one token file per listener. A shared `last-auth-token` file lets a
 * parallel test or second local service overwrite the credentials for the
 * service a user is currently viewing.
 */
export function uiAuthTokenFilePath(workspacePath: string, port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid UI port for auth token file: ${port}`);
  }
  return path.join(workspacePath, ".agentarena", `last-auth-token-${port}`);
}

export function uiAuthPasswordFilePath(workspacePath: string): string {
  return path.join(workspacePath, ".agentarena", "ui-auth.json");
}

export function validateUiAuthPassword(password: string): string {
  const normalized = password.trim();
  if (normalized.length < UI_AUTH_PASSWORD_MIN_LENGTH) {
    throw new Error(`Local service password must be at least ${UI_AUTH_PASSWORD_MIN_LENGTH} characters.`);
  }
  if (normalized.length > UI_AUTH_PASSWORD_MAX_LENGTH) {
    throw new Error(`Local service password must be at most ${UI_AUTH_PASSWORD_MAX_LENGTH} characters.`);
  }
  return normalized;
}

function derivePasswordDigest(password: string, salt: string): Buffer {
  return scryptSync(password, Buffer.from(salt, "base64url"), UI_AUTH_PASSWORD_KEY_LENGTH);
}

export function createUiAuthPasswordRecord(password: string): UiAuthPasswordRecord {
  const normalized = validateUiAuthPassword(password);
  const salt = randomBytes(UI_AUTH_PASSWORD_SALT_BYTES).toString("base64url");
  return {
    version: UI_AUTH_PASSWORD_VERSION,
    algorithm: UI_AUTH_PASSWORD_ALGORITHM,
    salt,
    digest: derivePasswordDigest(normalized, salt).toString("base64url")
  };
}

export function verifyUiAuthPassword(record: UiAuthPasswordRecord | null, password: string): boolean {
  if (
    !record ||
    record.version !== UI_AUTH_PASSWORD_VERSION ||
    record.algorithm !== UI_AUTH_PASSWORD_ALGORITHM ||
    typeof record.salt !== "string" ||
    typeof record.digest !== "string"
  ) {
    return false;
  }

  const normalized = password.trim();
  if (!normalized) return false;
  try {
    const expected = Buffer.from(record.digest, "base64url");
    const actual = derivePasswordDigest(normalized, record.salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function uiAuthValuesMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  const maxLength = Math.max(expectedBuffer.length, providedBuffer.length, 1);
  const paddedExpected = Buffer.alloc(maxLength);
  const paddedProvided = Buffer.alloc(maxLength);
  expectedBuffer.copy(paddedExpected);
  providedBuffer.copy(paddedProvided);
  return timingSafeEqual(paddedExpected, paddedProvided);
}

function isUiAuthPasswordRecord(value: unknown): value is UiAuthPasswordRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<UiAuthPasswordRecord>;
  return record.version === UI_AUTH_PASSWORD_VERSION
    && record.algorithm === UI_AUTH_PASSWORD_ALGORITHM
    && typeof record.salt === "string"
    && typeof record.digest === "string";
}

export async function readUiAuthPassword(filePath: string): Promise<UiAuthPasswordRecord | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isUiAuthPasswordRecord(parsed)) {
      throw new Error("invalid shape");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw new Error(`Invalid local service auth configuration at ${filePath}.`);
  }
}

export async function writeUiAuthPassword(filePath: string, password: string): Promise<UiAuthPasswordRecord> {
  const record = createUiAuthPasswordRecord(password);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(temporaryPath, 0o600).catch(() => {});
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return record;
}
