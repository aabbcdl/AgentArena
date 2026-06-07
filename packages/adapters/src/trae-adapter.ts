import type {
  AdapterCapability,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { createCliAdapter } from "./base-cli-adapter.js";

export const TRAE_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Trae CLI headless mode",
  authPrerequisites: ["Trae CLI installed and authenticated."],
  tokenAvailability: "available",
  costAvailability: "unavailable",
  traceRichness: "partial",
  configurableRuntime: {
    model: true,
    reasoningEffort: false
  },
  knownLimitations: [
    "Trae CLI output format may change across releases.",
    "Token usage is best-effort and depends on JSON event compatibility.",
    "Changed files are inferred from workspace diff."
  ]
};

function parseTraeTokenUsage(stdout: string): number {
  let inputTokens = 0;
  let outputTokens = 0;

  const lines = stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type === "usage") {
        if (typeof parsed.input_tokens === "number") inputTokens = parsed.input_tokens;
        if (typeof parsed.output_tokens === "number") outputTokens = parsed.output_tokens;
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }

  return inputTokens + outputTokens;
}

function parseTraeSummary(stdout: string, stderr: string, exitCode: number | null): string {
  let summary = "";

  const lines = stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        summary = parsed.summary.trim();
      }
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        summary = parsed.message.trim();
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }

  if (summary) return summary;
  if (exitCode === 0) return "Trae completed the task.";
  return stderr.trim() || `Trae failed with exit code ${exitCode}.`;
}

export function createTraeAdapter(): AgentAdapter {
  return createCliAdapter({
    id: "trae",
    title: "Trae",
    command: "trae",
    commandArgs: ["--headless", "--output-format", "json"],
    capability: TRAE_CAPABILITY,
    binEnvVar: "AGENTARENA_TRAE_BIN",
    extraArgs: (runtime: AgentResolvedRuntime) =>
      runtime.effectiveModel ? ["--model", runtime.effectiveModel] : [],
    parseTokenUsage: parseTraeTokenUsage,
    parseSummary: parseTraeSummary
  });
}
