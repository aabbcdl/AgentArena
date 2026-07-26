import type {
  AdapterCapability,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { UNATTENDED_ACCESS_DISCLOSURE } from "./adapter-capabilities.js";
import { createCliAdapter } from "./base-cli-adapter.js";

export const OPENCODE_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "OpenCode CLI headless mode",
  authPrerequisites: ["OpenCode CLI installed and configured with an LLM provider."],
  tokenAvailability: "available",
  costAvailability: "unavailable",
  traceRichness: "partial",
  configurableRuntime: {
    model: true,
    reasoningEffort: false
  },
  knownLimitations: [
    UNATTENDED_ACCESS_DISCLOSURE,
    "OpenCode CLI is an emerging tool with evolving interfaces.",
    "Token usage and cost are not reported by the CLI.",
    "Changed files are inferred from workspace diff, not emitted directly by the adapter."
  ]
};

export function createOpencodeAdapter(): AgentAdapter {
  return createCliAdapter({
    id: "opencode",
    title: "OpenCode",
    command: "opencode",
    commandArgs: ["-p"],
    capability: OPENCODE_CAPABILITY,
    binEnvVar: "AGENTARENA_OPENCODE_BIN",
    extraArgs: (runtime: AgentResolvedRuntime) =>
      runtime.effectiveModel ? ["--model", runtime.effectiveModel] : []
  });
}
