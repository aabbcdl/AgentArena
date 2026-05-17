import path from "node:path";
import {
  type AdapterCapability,
  type AdapterExecutionContext,
  type AdapterPreflightOptions,
  type AgentAdapter,
  type AgentResolvedRuntime,
  ensureDirectory
} from "@agentarena/core";
import type { InvocationSpec } from "./adapter-capabilities.js";
import { createCliAdapter } from "./base-cli-adapter.js";
import { probeInvocationVersion } from "./invocation-probes.js";

export const COPILOT_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "GitHub Copilot CLI agent mode",
  authPrerequisites: ["GitHub CLI authenticated with Copilot access."],
  tokenAvailability: "unavailable",
  costAvailability: "unavailable",
  traceRichness: "minimal",
  configurableRuntime: { model: false, reasoningEffort: false },
  knownLimitations: [
    "Token usage is estimated using character count (1 token ≈ 4 chars) and may vary by ±50%.",
    "Estimation includes both prompt and output, but may overestimate due to non-LLM CLI output.",
    "Actual cost cannot be determined without API access.",
    "Cost estimates should only be used for rough comparison.",
    "Output parsing depends on Copilot CLI text compatibility."
  ]
};

function resolveCopilotRuntime(config: {
  requestedModel?: string;
  configSource?: string;
}): AgentResolvedRuntime {
  const notes: string[] = ["Using GitHub Copilot CLI default configuration."];
  if (config.requestedModel) {
    notes.push(`Model requested: ${config.requestedModel} (may not be supported by Copilot CLI)`);
  }

  return {
    effectiveModel: undefined,
    source: (config.configSource ?? "cli-default") as AgentResolvedRuntime["source"],
    verification: "unknown",
    notes
  };
}

function estimateTokenUsage(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters for English text
  // Filter out likely non-LLM content (progress bars, ANSI codes, etc.)
  const cleanedText = text
    .replace(/\r/g, "") // Remove carriage returns
    .replace(/[^\x20-\x7E\n]/g, "") // Keep only printable ASCII + newlines
    .split("\n")
    .filter(line => {
      // Skip lines that look like progress bars or terminal artifacts
      const trimmed = line.trim();
      if (trimmed.length === 0) return false;
      if (/^[█▓░▒▀▄■●▪▬►◄▲▼]+/.test(trimmed)) return false; // Progress bar chars
      if (/^\d+%/.test(trimmed)) return false; // Percentage lines
      if (/^\[.*\]/.test(trimmed) && trimmed.length < 50) return false; // Short bracket expressions
      return true;
    })
    .join("\n");

  return Math.ceil(cleanedText.length / 4);
}

async function copilotResolveRuntime(
  invocation: InvocationSpec,
  options: { selection?: AdapterPreflightOptions["selection"]; context?: AdapterExecutionContext }
): Promise<AgentResolvedRuntime> {
  const requestedModel = options.selection?.config?.model ?? options.context?.selection.config?.model;
  const configSource = options.selection?.configSource ?? options.context?.selection.configSource;
  const runtimeDefaults = resolveCopilotRuntime({ requestedModel, configSource });
  const versionProbe = await probeInvocationVersion(
    invocation,
    options.context?.workspacePath ?? process.cwd(),
    options.context?.environment
  );
  return {
    ...runtimeDefaults,
    effectiveAgentVersion: versionProbe.version ?? runtimeDefaults.effectiveAgentVersion,
    agentVersionSource: versionProbe.source !== "unknown"
      ? versionProbe.source
      : runtimeDefaults.agentVersionSource,
    notes: [
      ...(runtimeDefaults.notes ?? []),
      ...(versionProbe.note ? [versionProbe.note] : [])
    ]
  };
}

export function createCopilotAdapter(): AgentAdapter {
  return createCliAdapter({
    id: "copilot",
    title: "GitHub Copilot CLI",
    command: "copilot",
    commandArgs: ["agent", "-p"],
    capability: COPILOT_CAPABILITY,
    binEnvVar: "AGENTARENA_COPILOT_BIN",
    parseTokenUsage: (stdout: string) => estimateTokenUsage(stdout),
    extraArgs: () => ["--allow-all-tools"],
    beforeExecute: async (context: AdapterExecutionContext) => {
      const metadataDir = path.join(context.workspacePath, "agentarena-copilot");
      await ensureDirectory(metadataDir);
    },
    resolveRuntime: copilotResolveRuntime
  });
}
