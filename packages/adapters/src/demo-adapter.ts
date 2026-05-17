import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter
} from "@agentarena/core";
import { DEMO_CAPABILITY, type DemoProfile } from "./adapter-capabilities.js";
import type { AdapterEvent } from "./adapter-events.js";
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
    const startEvent: AdapterEvent = {
      type: "adapter.start",
      timestamp: new Date().toISOString()
    };
    await context.trace({
      type: startEvent.type,
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
      const fileEvent: AdapterEvent = {
        type: "adapter.file_change",
        path: filePath,
        action: "create",
        timestamp: new Date().toISOString()
      };
      await context.trace({
        type: fileEvent.type,
        message: `Created ${filePath}`,
        metadata: { path: filePath, action: "create" }
      });
    }

    // Emit standardized adapter.usage event
    const usageEvent: AdapterEvent = {
      type: "adapter.usage",
      inputTokens: Math.round(tokenUsage * 0.6),
      outputTokens: Math.round(tokenUsage * 0.4),
      timestamp: new Date().toISOString()
    };
    await context.trace({
      type: usageEvent.type,
      message: `Token usage: ${tokenUsage}`,
      metadata: { inputTokens: usageEvent.inputTokens, outputTokens: usageEvent.outputTokens }
    });

    // Emit standardized adapter.result event
    const resultEvent: AdapterEvent = {
      type: "adapter.result",
      status: "success",
      summary,
      totalCostUsd: this.profile.estimatedCostUsd,
      timestamp: new Date().toISOString()
    };
    await context.trace({
      type: resultEvent.type,
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
