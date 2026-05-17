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

export async function readCodexConfigDefaults(): Promise<CodexConfigDefaults> {
  const configPath = path.join(
    process.env.USERPROFILE ?? process.env.HOME ?? os.homedir(),
    ".codex",
    "config.toml"
  );
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
}): Promise<AgentResolvedRuntime> {
  const requestedConfig = context.requestedConfig ?? {};
  const normalizedRequestedModel = normalizeModelName(requestedConfig.model);
  const normalizedRequestedEffort = normalizeReasoningEffort(requestedConfig.reasoningEffort);
  if (normalizedRequestedModel || normalizedRequestedEffort) {
    return {
      effectiveModel: normalizedRequestedModel,
      effectiveReasoningEffort: normalizedRequestedEffort,
      source: context.configSource ?? "ui",
      verification: "inferred",
      notes: ["Using explicit AgentArena Codex configuration."]
    };
  }

  const normalizedEnvModel = normalizeModelName(process.env.AGENTARENA_CODEX_MODEL);
  const normalizedEnvEffort = normalizeReasoningEffort(process.env.AGENTARENA_CODEX_REASONING_EFFORT);
  if (normalizedEnvModel || normalizedEnvEffort) {
    return {
      effectiveModel: normalizedEnvModel,
      effectiveReasoningEffort: normalizedEnvEffort,
      source: "env",
      verification: "inferred",
      notes: ["Using AGENTARENA_CODEX_* environment overrides."]
    };
  }

  const configDefaults = await readCodexConfigDefaults();
  const normalizedConfigModel = normalizeModelName(configDefaults.model);
  const normalizedConfigEffort = normalizeReasoningEffort(configDefaults.reasoningEffort);
  if (normalizedConfigModel || normalizedConfigEffort) {
    return {
      effectiveModel: normalizedConfigModel,
      effectiveReasoningEffort: normalizedConfigEffort,
      source: "codex-config",
      verification: "inferred",
      notes: ["Using defaults from ~/.codex/config.toml."]
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
