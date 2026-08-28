import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AdapterExecutionContext,
  AgentResolvedRuntime,
  ClaudeProviderProfile
} from "@agentarena/core";
import type { CodexConfigDefaults } from "./adapter-capabilities.js";
import { getClaudeProviderProfile } from "./claude-provider-profiles.js";

function normalizeModelName(model: string | null | undefined): string | undefined {
  if (model == null) {
    return undefined;
  }
  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveEffectiveModel(...candidates: (string | null | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const normalized = normalizeModelName(candidate);
    if (normalized != null) {
      return normalized;
    }
  }
  return undefined;
}

function normalizeReasoningEffort(effort: string | null | undefined): string | undefined {
  if (effort == null) {
    return undefined;
  }
  const trimmed = effort.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function readCodexConfigDefaults(
  environment: NodeJS.ProcessEnv = process.env
): Promise<CodexConfigDefaults> {
  const configuredCodexHome = environment.CODEX_HOME?.trim();
  const codexHome = configuredCodexHome
    ? path.resolve(configuredCodexHome)
    : path.join(environment.USERPROFILE ?? environment.HOME ?? os.homedir(), ".codex");
  const configPath = path.join(codexHome, "config.toml");
  try {
    const contents = await fs.readFile(configPath, "utf8");
    const model = contents.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1]?.trim();
    const reasoningEffort = contents
      .match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1]
      ?.trim();
    return {
      model: model || undefined,
      reasoningEffort: reasoningEffort || undefined
    };
  } catch {
    return {};
  }
}

export async function resolveCodexRuntime(context: {
  requestedConfig?: AdapterExecutionContext["selection"]["config"];
  configSource?: AdapterExecutionContext["selection"]["configSource"];
  environment?: NodeJS.ProcessEnv;
}): Promise<AgentResolvedRuntime> {
  const environment = context.environment ?? process.env;
  const requestedConfig = context.requestedConfig ?? {};
  const normalizedRequestedModel = normalizeModelName(requestedConfig.model);
  const normalizedRequestedEffort = normalizeReasoningEffort(requestedConfig.reasoningEffort);

  const normalizedEnvModel = normalizeModelName(environment.AGENTARENA_CODEX_MODEL);
  // Read the canonical env var first, fall back to the old name for backward compatibility.
  // The old name (AGENTARENA_CODEX_REASONING) was used in .env.example before 2026-06-07.
  let envReasoningEffort = environment.AGENTARENA_CODEX_REASONING_EFFORT;
  if (envReasoningEffort == null && environment.AGENTARENA_CODEX_REASONING) {
    if (environment === process.env) {
      process.emitWarning(
        "[agentarena] AGENTARENA_CODEX_REASONING is deprecated, use AGENTARENA_CODEX_REASONING_EFFORT instead"
      );
    }
    envReasoningEffort = environment.AGENTARENA_CODEX_REASONING;
  }
  const normalizedEnvEffort = normalizeReasoningEffort(envReasoningEffort);

  const configDefaults = await readCodexConfigDefaults(environment);
  const normalizedConfigModel = normalizeModelName(configDefaults.model);
  const normalizedConfigEffort = normalizeReasoningEffort(configDefaults.reasoningEffort);

  const effectiveModel = normalizedRequestedModel ?? normalizedEnvModel ?? normalizedConfigModel;
  const effectiveReasoningEffort = normalizedRequestedEffort ?? normalizedEnvEffort ?? normalizedConfigEffort;
  const modelIdentitySource = normalizedRequestedModel
    ? "declared" as const
    : normalizedEnvModel
      ? "inferred" as const
      : normalizedConfigModel
        ? "declared" as const
        : undefined;
  const reasoningEffortSource = normalizedRequestedEffort
    ? "declared" as const
    : normalizedEnvEffort
      ? "inferred" as const
      : normalizedConfigEffort
        ? "declared" as const
        : undefined;

  if (effectiveModel || effectiveReasoningEffort) {
    const source = normalizedRequestedModel || normalizedRequestedEffort
      ? context.configSource ?? "ui"
      : normalizedEnvModel || normalizedEnvEffort
        ? "env"
        : "codex-config";
    const notes = [
      ...(normalizedRequestedModel || normalizedRequestedEffort
        ? ["Using explicit AgentArena Codex configuration."]
        : []),
      ...(normalizedEnvModel || normalizedEnvEffort
        ? ["Using AGENTARENA_CODEX_* environment overrides."]
        : []),
      ...(normalizedConfigModel || normalizedConfigEffort
        ? ["Using defaults from the active Codex config.toml."]
        : [])
    ];
    return {
      effectiveModel,
      effectiveReasoningEffort,
      ...(modelIdentitySource ? { modelIdentitySource } : {}),
      ...(reasoningEffortSource ? { reasoningEffortSource } : {}),
      source,
      verification: "inferred",
      notes
    };
  }

  return {
    source: "cli-default",
    verification: "unknown",
    notes: ["Codex CLI default runtime could not be resolved from AgentArena, environment, or ~/.codex/config.toml."]
  };
}

export async function resolveClaudeRuntime(context: {
  requestedConfig?: AdapterExecutionContext["selection"]["config"];
}): Promise<{
  runtime: AgentResolvedRuntime;
  profile: ClaudeProviderProfile;
}> {
  const requestedConfig = context.requestedConfig ?? {};
  const profile = await getClaudeProviderProfile(requestedConfig.providerProfileId);
  const runtime: AgentResolvedRuntime = {
    effectiveModel: resolveEffectiveModel(requestedConfig.model, profile.primaryModel),
    effectiveReasoningEffort: undefined,
    ...(resolveEffectiveModel(requestedConfig.model, profile.primaryModel)
      ? { modelIdentitySource: "declared" as const }
      : {}),
    providerProfileId: profile.id,
    providerProfileName: profile.name,
    providerKind: profile.kind,
    providerSource: profile.kind === "official" ? "official-login" : "profile-config",
    source: profile.kind === "official" ? "official-login" : "profile-config",
    verification: "inferred",
    notes: [
      profile.kind === "official"
        ? "Using built-in official Claude Code profile."
        : "Using a provider-switched Claude Code profile."
    ]
  };

  return {
    runtime,
    profile
  };
}
