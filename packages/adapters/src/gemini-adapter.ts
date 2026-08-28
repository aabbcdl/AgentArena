import type {
  AdapterCapability,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { UNATTENDED_ACCESS_DISCLOSURE } from "./adapter-capabilities.js";
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
    UNATTENDED_ACCESS_DISCLOSURE,
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

function parseGeminiDataQualityWarning(stdout: string): string | undefined {
  const parsed = parseGeminiEvents(stdout);
  const warnings: string[] = [];
  if (parsed.formatMismatch) {
    warnings.push("Gemini CLI output format changed — token usage and cost data may be inaccurate.");
  }
  if (parsed.missingCriticalEvents.length > 0) {
    warnings.push(
      `Gemini CLI missing critical events: ${parsed.missingCriticalEvents.join(", ")} — token and cost data may be incomplete.`
    );
  }
  return warnings.length > 0 ? warnings.join(" ") : undefined;
}

export function createGeminiAdapter(): AgentAdapter {
  return createCliAdapter({
    id: "gemini-cli",
    title: "Gemini CLI",
    command: "gemini",
    commandArgs: ["--output-format", "json", "--yolo"],
    capability: GEMINI_CAPABILITY,
    binEnvVar: "AGENTARENA_GEMINI_BIN",
    extraArgs: (runtime: AgentResolvedRuntime) =>
      runtime.effectiveModel ? ["--model", runtime.effectiveModel] : [],
    parseTokenUsage: parseGeminiTokenUsage,
    parseSummary: parseGeminiSummary,
    parseDataQualityWarning: parseGeminiDataQualityWarning
  });
}
