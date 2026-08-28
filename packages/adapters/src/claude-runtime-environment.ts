import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildClaudeProviderEnvironment,
  getClaudeProviderProfile
} from "./claude-provider-profiles.js";

export const CLAUDE_ISOLATION_ARGS = [
  "--setting-sources",
  "user",
  "--strict-mcp-config"
] as const;

export const CLAUDE_SAFE_UNATTENDED_ARGS = [
  "--permission-mode",
  "dontAsk"
] as const;

const HOST_CLAUDE_ENV_NAMES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_MODEL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR"
] as const;

const INHERITED_CLAUDE_ENV_NAMES = new Set([
  ...HOST_CLAUDE_ENV_NAMES,
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX"
]);

export type ClaudeRuntimeMode = "official-local" | "third-party-isolated";

export interface PreparedClaudeRuntimeEnvironment {
  mode: ClaudeRuntimeMode;
  environment: NodeJS.ProcessEnv;
  extraArgs: string[];
  effectiveModel?: string;
  runtimeRoot?: string;
  configDir?: string;
  cleanup: () => Promise<void>;
}

export interface PrepareClaudeRuntimeEnvironmentOptions {
  profileId?: string;
  requestedModel?: string;
  baseEnvironment: NodeJS.ProcessEnv;
  hostEnvironment?: NodeJS.ProcessEnv;
}

function copyOfficialHostEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  hostEnvironment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const environment = { ...baseEnvironment };
  for (const name of HOST_CLAUDE_ENV_NAMES) {
    const value = hostEnvironment[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return environment;
}

function removeInheritedClaudeEnvironment(baseEnvironment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(baseEnvironment).filter(([name]) => !INHERITED_CLAUDE_ENV_NAMES.has(name.toUpperCase()))
  );
}

export function claudeIsolationArgsSupported(helpOutput: string): boolean {
  return ["--setting-sources", "--strict-mcp-config", "--no-session-persistence"].every((flag) =>
    helpOutput.includes(flag)
  );
}

export function claudeSafeUnattendedArgsSupported(helpOutput: string): boolean {
  return ["--permission-mode", "dontAsk", "--no-session-persistence"].every((flag) =>
    helpOutput.includes(flag)
  );
}

export async function prepareClaudeRuntimeEnvironment(
  options: PrepareClaudeRuntimeEnvironmentOptions
): Promise<PreparedClaudeRuntimeEnvironment> {
  const profile = await getClaudeProviderProfile(options.profileId);
  const hostEnvironment = options.hostEnvironment ?? process.env;

  if (profile.kind === "official") {
    return {
      mode: "official-local",
      environment: copyOfficialHostEnvironment(options.baseEnvironment, hostEnvironment),
      extraArgs: [],
      effectiveModel: options.requestedModel?.trim() || profile.primaryModel?.trim() || undefined,
      cleanup: async () => {}
    };
  }

  const providerRuntime = await buildClaudeProviderEnvironment(profile.id, options.requestedModel);
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-claude-runtime-"));
  const configDir = runtimeRoot;
  let cleaned = false;

  return {
    mode: "third-party-isolated",
    environment: {
      ...removeInheritedClaudeEnvironment(options.baseEnvironment),
      ...providerRuntime.environment,
      CLAUDE_CONFIG_DIR: configDir
    },
    extraArgs: [...CLAUDE_ISOLATION_ARGS],
    effectiveModel: providerRuntime.effectiveModel,
    runtimeRoot,
    configDir,
    cleanup: async () => {
      if (cleaned) {
        return;
      }
      await fs.rm(runtimeRoot, { recursive: true, force: true });
      cleaned = true;
    }
  };
}
