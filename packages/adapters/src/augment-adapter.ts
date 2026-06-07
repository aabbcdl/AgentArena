import type {
  AdapterCapability,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { createCliAdapter } from "./base-cli-adapter.js";

export const AUGMENT_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Augment Code CLI headless mode",
  authPrerequisites: ["Augment CLI installed and authenticated with an API key."],
  tokenAvailability: "available",
  costAvailability: "unavailable",
  traceRichness: "partial",
  configurableRuntime: {
    model: true,
    reasoningEffort: false
  },
  knownLimitations: [
    "Augment CLI output format may change across releases.",
    "Token usage is best-effort and depends on JSON event compatibility.",
    "Changed files are inferred from workspace diff."
  ]
};

function parseAugmentTokenUsage(stdout: string): number {
  let tokenUsage = 0;

  const lines = stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.token_usage === "number") {
        tokenUsage = parsed.token_usage;
      } else if (typeof parsed.tokens === "number") {
        tokenUsage = parsed.tokens;
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }

  return tokenUsage;
}

function parseAugmentSummary(stdout: string, stderr: string, exitCode: number | null): string {
  let summary = "";

  const lines = stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      // Prefer explicit summary over message; don't let message override if summary is already set
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        summary = parsed.summary.trim();
      } else if (!summary && typeof parsed.message === "string" && parsed.message.trim()) {
        summary = parsed.message.trim();
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }

  if (summary) return summary;
  if (exitCode === 0) return "Augment Code completed the task.";
  return stderr.trim() || `Augment Code failed with exit code ${exitCode}.`;
}

export function createAugmentAdapter(): AgentAdapter {
  return createCliAdapter({
    id: "augment",
    title: "Augment Code",
    command: "augment",
    commandArgs: ["code", "--headless", "--"],
    capability: AUGMENT_CAPABILITY,
    binEnvVar: "AGENTARENA_AUGMENT_BIN",
    extraArgs: (runtime: AgentResolvedRuntime) =>
      runtime.effectiveModel ? ["--model", runtime.effectiveModel] : [],
    parseTokenUsage: parseAugmentTokenUsage,
    parseSummary: parseAugmentSummary
  });
}
