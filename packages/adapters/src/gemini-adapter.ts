import type {
  AdapterCapability,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { createCliAdapter } from "./base-cli-adapter.js";
import { parseGeminiEvents } from "./event-parsers.js";

export const GEMINI_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Gemini CLI --output-format json mode",
  authPrerequisites: ["Gemini CLI installed and authenticated via Google account."],
  tokenAvailability: "available",
  costAvailability: "available",
  traceRichness: "partial",
  configurableRuntime: {
    model: true,
    reasoningEffort: false
  },
  knownLimitations: [
    "Gemini CLI JSON output format may change across versions.",
    "Changed files are inferred from workspace diff, not emitted directly by the adapter.",
    "Authentication relies on local gcloud or Google account login."
  ]
};

function parseGeminiTokenUsage(stdout: string): number {
  const parsed = parseGeminiEvents(stdout);
  return parsed.tokenUsage;
}

function parseGeminiSummary(stdout: string, stderr: string, exitCode: number | null): string {
  const parsed = parseGeminiEvents(stdout);
  if (parsed.summaryFromEvents) return parsed.summaryFromEvents;
  if (exitCode === 0) return "Gemini CLI completed without a final message.";
  return stderr.trim() || `Gemini CLI failed with exit code ${exitCode}.`;
}

export function createGeminiAdapter(): AgentAdapter {
  return createCliAdapter({
    id: "gemini-cli",
    title: "Gemini CLI",
    command: "gemini",
    commandArgs: ["--output-format", "json", "--permission-mode", "bypassPermissions"],
    capability: GEMINI_CAPABILITY,
    binEnvVar: "AGENTARENA_GEMINI_BIN",
    extraArgs: (runtime: AgentResolvedRuntime) =>
      runtime.effectiveModel ? ["--model", runtime.effectiveModel] : [],
    parseTokenUsage: parseGeminiTokenUsage,
    parseSummary: parseGeminiSummary
  });
}
