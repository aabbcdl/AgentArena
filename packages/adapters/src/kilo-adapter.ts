import type {
  AdapterCapability,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { UNATTENDED_ACCESS_DISCLOSURE } from "./adapter-capabilities.js";
import { createCliAdapter } from "./base-cli-adapter.js";

export const KILO_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Kilo CLI headless mode",
  authPrerequisites: ["Kilo CLI installed and authenticated with an API key."],
  tokenAvailability: "available",
  costAvailability: "unavailable",
  traceRichness: "partial",
  configurableRuntime: {
    model: true,
    reasoningEffort: false
  },
  knownLimitations: [
    UNATTENDED_ACCESS_DISCLOSURE,
    "Kilo CLI is relatively new and may have unstable output format.",
    "Token usage and cost are not reported by the CLI.",
    "Changed files are inferred from workspace diff, not emitted directly by the adapter."
  ]
};

export function createKiloAdapter(): AgentAdapter {
  return createCliAdapter({
    id: "kilo-cli",
    title: "Kilo CLI",
    command: "kilo",
    commandArgs: ["-p"],
    capability: KILO_CAPABILITY,
    binEnvVar: "AGENTARENA_KILO_BIN",
    extraArgs: (runtime: AgentResolvedRuntime) =>
      runtime.effectiveModel ? ["--model", runtime.effectiveModel] : []
  });
}
