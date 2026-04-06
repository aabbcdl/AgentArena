import {
  type AdapterExecutionContext,
  type AdapterExecutionResult,
  type AdapterPreflightOptions,
  type AdapterPreflightResult,
  type AgentAdapter,
  type AdapterCapability
} from "@repoarena/core";
import { createPreflightResult, getAdaptersPackageVersion } from "./shared.js";

export const WINDSURF_CAPABILITY: AdapterCapability = {
  supportTier: "blocked",
  invocationMethod: "Windsurf IDE (CLI not yet available)",
  authPrerequisites: ["Windsurf CLI (pending release)"],
  tokenAvailability: "unavailable",
  costAvailability: "unavailable",
  traceRichness: "minimal",
  knownLimitations: [
    "Windsurf does not provide a public CLI for automation yet.",
    "This adapter is a placeholder and will report blocked status.",
    "Windsurf adapter will be enabled once CLI support is available. Check https://docs.windsurf.com for updates.",
    "When CLI becomes available, this adapter will need to be reimplemented with actual execute logic."
  ]
};

export class WindsurfAdapter implements AgentAdapter {
  readonly kind = "external" as const;
  readonly id = "windsurf";
  readonly title = "Windsurf (Codeium) - Coming Soon";
  readonly capability = WINDSURF_CAPABILITY;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const version = await getAdaptersPackageVersion();
    return createPreflightResult(
      options?.selection,
      this.id,
      this.title,
      this.kind,
      this.capability,
      "blocked",
      "Windsurf CLI is not available yet. Windsurf has not released a public CLI for automation. Check https://docs.windsurf.com for updates.",
      {
        effectiveAgentVersion: version,
        agentVersionSource: "builtin",
        source: "cli-default",
        verification: "inferred",
        notes: [
          "Windsurf does not provide a public CLI for automation yet.",
          "This adapter is a placeholder and will report blocked status.",
          "Windsurf adapter will be enabled once CLI support is available."
        ]
      }
    );
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    return {
      status: "failed",
      summary: "Windsurf CLI is not available. Windsurf has not released a public CLI for automation. Please check https://docs.windsurf.com for CLI availability updates.",
      tokenUsage: 0,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFilesHint: [],
      resolvedRuntime: {
        source: "cli-default",
        verification: "unknown",
        notes: WINDSURF_CAPABILITY.knownLimitations
      }
    };
  }
}
