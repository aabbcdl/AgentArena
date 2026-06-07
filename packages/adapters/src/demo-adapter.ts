import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter
} from "@agentarena/core";
import { DEMO_CAPABILITY, type DemoProfile } from "./adapter-capabilities.js";
import { createPreflightResult } from "./adapter-helpers.js";
import { buildDemoSummary, computeTokenUsage, writeDemoArtifacts } from "./demo-helpers.js";
import { getAdaptersPackageVersion } from "./invocation-probes.js";
import { sleep } from "./process-utils.js";

export class DemoAdapter implements AgentAdapter {
  readonly kind = "demo" as const;
  readonly capability = DEMO_CAPABILITY;

  constructor(readonly id: string, readonly title: string, private readonly profile: DemoProfile) {}

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const version = await getAdaptersPackageVersion();
    return createPreflightResult(
      options?.selection,
      this.id,
      this.title,
      this.kind,
      this.capability,
      "ready",
      "Built-in demo adapter is always available.",
      {
        effectiveAgentVersion: version,
        agentVersionSource: version ? "builtin" : "unknown",
        source: "ui",
        verification: "inferred",
        notes: ["Built-in demo adapter does not execute a real model."]
      }
    );
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    // Emit standardized adapter.start event
    await context.trace({
      type: "adapter.start",
      message: `Starting ${this.title}`,
      metadata: {
        repoPath: context.repoPath,
        workspacePath: context.workspacePath
      }
    });

    await sleep(this.profile.delayMs, context.signal);

    const changedFilesHint = await writeDemoArtifacts(context, this.profile);
    const summary = buildDemoSummary(context, this.profile);
    const tokenUsage = computeTokenUsage(context.task.prompt, this.profile);
    const version = await getAdaptersPackageVersion();

    // Emit standardized adapter.file_change events
    for (const filePath of changedFilesHint) {
      await context.trace({
        type: "adapter.file_change",
        message: `Created ${filePath}`,
        metadata: { path: filePath, action: "create" }
      });
    }

    // Emit standardized adapter.usage event
    await context.trace({
      type: "adapter.usage",
      message: `Token usage: ${tokenUsage}`,
      metadata: { inputTokens: Math.round(tokenUsage * 0.6), outputTokens: Math.round(tokenUsage * 0.4) }
    });

    // Emit standardized adapter.result event
    await context.trace({
      type: "adapter.result",
      message: summary,
      metadata: {
        tokenUsage,
        estimatedCostUsd: this.profile.estimatedCostUsd
      }
    });

    return {
      status: "success",
      summary,
      tokenUsage,
      estimatedCostUsd: this.profile.estimatedCostUsd,
      costKnown: true,
      changedFilesHint,
      resolvedRuntime: {
        effectiveAgentVersion: version,
        agentVersionSource: version ? "builtin" : "unknown",
        source: "ui",
        verification: "inferred",
        notes: ["Built-in demo adapter does not execute a real model."]
      }
    };
  }
}
