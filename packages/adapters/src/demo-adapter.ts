import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter
} from "@repoarena/core";
import { sleep } from "./process-utils.js";
import {
  buildDemoSummary,
  computeTokenUsage,
  createPreflightResult,
  DEMO_CAPABILITY,
  type DemoProfile,
  getAdaptersPackageVersion,
  writeDemoArtifacts
} from "./shared.js";

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

    await context.trace({
      type: "adapter.write",
      message: `Created ${changedFilesHint.length} demo artifact(s)`,
      metadata: {
        changedFilesHint
      }
    });

    await context.trace({
      type: "adapter.finish",
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
