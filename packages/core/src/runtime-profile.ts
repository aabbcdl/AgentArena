export const RUNTIME_PROFILE_SCHEMA_V1 = "agentarena.runtime-profile/v1" as const;

export type RuntimeAgentKind = "codex" | "claude-code";
export type RuntimeProfileMode = "inherit-local" | "managed-provider";
export type RuntimeProviderProtocol =
  | "openai-responses"
  | "openai-chat-completions"
  | "anthropic-messages"
  | "openai-chat-via-proxy";
export type RuntimeModelIdentitySource = "confirmed" | "declared" | "unknown";
export type RuntimeProfileRiskFlag =
  | "third-party-provider"
  | "compatibility-mode"
  | "user-managed-secret"
  | "base-url-redirects-traffic"
  | "background-incompatible";

export interface RuntimeProfileProvider {
  baseUrl?: string;
  protocol?: RuntimeProviderProtocol;
  requestedModel?: string;
  canonicalModelIdentity?: string;
  modelIdentitySource?: RuntimeModelIdentitySource;
  reasoningEffort?: string;
  modelMappings?: Record<string, string>;
  secretRef?: string;
}

export interface RuntimeProfile {
  schemaVersion: typeof RUNTIME_PROFILE_SCHEMA_V1;
  id: string;
  name: string;
  agentKind: RuntimeAgentKind;
  mode: RuntimeProfileMode;
  revision: number;
  secretRevision: number;
  commandPath?: string;
  provider?: RuntimeProfileProvider;
  extraEnv: Record<string, string>;
  riskFlags: RuntimeProfileRiskFlag[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  isBuiltIn?: boolean;
}

export interface PublicRuntimeProfileProvider extends Omit<RuntimeProfileProvider, "secretRef"> {}

export interface PublicRuntimeProfile
  extends Omit<RuntimeProfile, "provider" | "extraEnv"> {
  provider?: PublicRuntimeProfileProvider;
  extraEnvKeys: string[];
  secretStored: boolean;
}

const RUNTIME_PROFILE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SUPPORTED_RUNTIME_AGENTS = new Set<RuntimeAgentKind>(["codex", "claude-code"]);
const SUPPORTED_PROFILE_MODES = new Set<RuntimeProfileMode>(["inherit-local", "managed-provider"]);
const SUPPORTED_PROVIDER_PROTOCOLS = new Set<RuntimeProviderProtocol>([
  "openai-responses",
  "openai-chat-completions",
  "anthropic-messages",
  "openai-chat-via-proxy"
]);

export const RUNTIME_PROFILE_RESERVED_ENVIRONMENT_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_AWS_API_KEY",
  "ANTHROPIC_AWS_BASE_URL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_GOOGLE_CLOUD_BASE_URL",
  "ANTHROPIC_GOOGLE_CLOUD_PROJECT",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AZURE_CLIENT_SECRET",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_GATEWAY",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "COMSPEC",
  "HOME",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isIsoDate(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

export function isReservedRuntimeProfileEnvironmentKey(name: string): boolean {
  const normalized = name.trim().toUpperCase();
  return (
    RUNTIME_PROFILE_RESERVED_ENVIRONMENT_KEYS.has(normalized) ||
    /(?:^|_)(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|PRIVATE_KEY|PASSWORD|SECRET)$/.test(normalized)
  );
}

export function validateRuntimeProfile(value: unknown): string[] {
  if (!isRecord(value)) {
    return ["Runtime profile must be an object."];
  }

  const errors: string[] = [];
  if (value.schemaVersion !== RUNTIME_PROFILE_SCHEMA_V1) {
    errors.push(`schemaVersion must be ${RUNTIME_PROFILE_SCHEMA_V1}.`);
  }
  if (typeof value.id !== "string" || !RUNTIME_PROFILE_ID_PATTERN.test(value.id)) {
    errors.push("id must contain 1-64 lowercase letters, numbers, or hyphens.");
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    errors.push("name is required.");
  }
  if (!SUPPORTED_RUNTIME_AGENTS.has(value.agentKind as RuntimeAgentKind)) {
    errors.push("agentKind must be codex or claude-code.");
  }
  if (!SUPPORTED_PROFILE_MODES.has(value.mode as RuntimeProfileMode)) {
    errors.push("mode must be inherit-local or managed-provider.");
  }
  if (!isPositiveInteger(value.revision)) {
    errors.push("revision must be a positive integer.");
  }
  if (!isPositiveInteger(value.secretRevision)) {
    errors.push("secretRevision must be a positive integer.");
  }
  if (value.commandPath !== undefined && (typeof value.commandPath !== "string" || !value.commandPath.trim())) {
    errors.push("commandPath must be a non-empty string when provided.");
  }
  if (!isIsoDate(value.createdAt)) {
    errors.push("createdAt must be a valid timestamp.");
  }
  if (!isIsoDate(value.updatedAt)) {
    errors.push("updatedAt must be a valid timestamp.");
  }

  const extraEnv = value.extraEnv;
  if (!isRecord(extraEnv)) {
    errors.push("extraEnv must be an object.");
  } else {
    for (const [name, environmentValue] of Object.entries(extraEnv)) {
      if (!name.trim()) {
        errors.push("extraEnv keys cannot be empty.");
      } else if (isReservedRuntimeProfileEnvironmentKey(name)) {
        errors.push(`extraEnv cannot set reserved or sensitive field ${name}.`);
      }
      if (typeof environmentValue !== "string") {
        errors.push(`extraEnv.${name} must be a string.`);
      }
    }
  }

  if (!Array.isArray(value.riskFlags) || value.riskFlags.some((flag) => typeof flag !== "string")) {
    errors.push("riskFlags must be an array of strings.");
  }

  if (value.mode === "managed-provider") {
    if (!isRecord(value.provider)) {
      errors.push("provider is required for managed-provider profiles.");
    } else {
      const provider = value.provider;
      if (typeof provider.baseUrl !== "string" || !provider.baseUrl.trim()) {
        errors.push("provider.baseUrl is required for managed-provider profiles.");
      } else {
        try {
          const parsed = new URL(provider.baseUrl);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            errors.push("provider.baseUrl must use http or https.");
          }
        } catch {
          errors.push("provider.baseUrl must be a valid URL.");
        }
      }
      if (!SUPPORTED_PROVIDER_PROTOCOLS.has(provider.protocol as RuntimeProviderProtocol)) {
        errors.push("provider.protocol is not supported.");
      }
      if (typeof provider.requestedModel !== "string" || !provider.requestedModel.trim()) {
        errors.push("provider.requestedModel is required for managed-provider profiles.");
      }
      if (typeof provider.secretRef !== "string" || !provider.secretRef.trim()) {
        errors.push("provider.secretRef is required for managed-provider profiles.");
      }
      if (provider.modelMappings !== undefined) {
        if (!isRecord(provider.modelMappings)) {
          errors.push("provider.modelMappings must be an object when provided.");
        } else if (Object.values(provider.modelMappings).some((entry) => typeof entry !== "string")) {
          errors.push("provider.modelMappings values must be strings.");
        }
      }
    }
  }

  return errors;
}

export function toPublicRuntimeProfile(
  profile: RuntimeProfile,
  secretStored: boolean
): PublicRuntimeProfile {
  const { provider, extraEnv, ...rest } = profile;
  const publicProvider = provider
    ? (({ secretRef: _secretRef, ...safeProvider }) => safeProvider)(provider)
    : undefined;

  return {
    ...rest,
    provider: publicProvider,
    extraEnvKeys: Object.keys(extraEnv).sort((left, right) => left.localeCompare(right)),
    secretStored
  };
}
