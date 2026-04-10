import type {
  AdapterCapability,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { agentTimeoutMs, runProcess } from "./process-utils.js";
import {
  buildAgentPrompt,
  createPreflightResult,
  type InvocationSpec,
  probeHelp,
  probeInvocationVersion
} from "./shared.js";

const OPENCODE_CAPABILITY: AdapterCapability = {
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
    "OpenCode CLI is an emerging tool with evolving interfaces.",
    "Token usage and cost are not reported by the CLI.",
    "Changed files are inferred from workspace diff, not emitted directly by the adapter."
  ]
};

async function resolveOpencodeInvocation(): Promise<InvocationSpec> {
  const command = process.env.AGENTARENA_OPENCODE_BIN?.trim() || "opencode";
  return {
    command,
    argsPrefix: [],
    displayCommand: command
  };
}

export { OPENCODE_CAPABILITY, resolveOpencodeInvocation };

export class OpencodeAdapter implements AgentAdapter {
  readonly kind = "external" as const;
  readonly id = "opencode";
  readonly title = "OpenCode";
  readonly capability = OPENCODE_CAPABILITY;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await resolveOpencodeInvocation();
    const versionProbe = await probeInvocationVersion(invocation, process.cwd());
    const resolvedRuntime = versionProbe.version
      ? {
          effectiveAgentVersion: versionProbe.version,
          agentVersionSource: versionProbe.source,
          source: (versionProbe.source !== "unknown" ? versionProbe.source : "cli-default") as AgentResolvedRuntime["source"],
          verification: "confirmed" as AgentResolvedRuntime["verification"]
        }
      : undefined;

    try {
      const help = await probeHelp(invocation, process.cwd());
      if (help.exitCode !== 0) {
        return createPreflightResult(
          options?.selection,
          this.id,
          this.title,
          this.kind,
          this.capability,
          "missing",
          "CLI did not respond successfully to --help.",
          resolvedRuntime,
          invocation.displayCommand,
          [help.stderr.trim()].filter(Boolean)
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        "missing",
        "CLI could not be launched.",
        resolvedRuntime,
        invocation.displayCommand,
        [message]
      );
    }

    return createPreflightResult(
      options?.selection,
      this.id,
      this.title,
      this.kind,
      this.capability,
      "unverified",
      "CLI is installed. Authentication was not probed in this run.",
      resolvedRuntime,
      invocation.displayCommand
    );
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const prompt = buildAgentPrompt(context);
    const invocation = await resolveOpencodeInvocation();
    const args = [
      ...invocation.argsPrefix,
      "-p",
      prompt
    ];
    const versionProbe = await probeInvocationVersion(invocation, context.workspacePath, context.environment);
    const resolvedRuntime: AgentResolvedRuntime = {
      effectiveModel: context.selection.config.model,
      source: (versionProbe.source !== "unknown" ? versionProbe.source : "cli-default") as AgentResolvedRuntime["source"],
      verification: versionProbe.version ? "confirmed" : "unknown",
      effectiveAgentVersion: versionProbe.version,
      agentVersionSource: versionProbe.source !== "unknown" ? versionProbe.source : undefined
    };

    if (context.selection.config.model) {
      args.splice(invocation.argsPrefix.length, 0, "--model", context.selection.config.model);
    }

    await context.trace({
      type: "adapter.start",
      message: "Starting OpenCode adapter",
      metadata: {
        command: invocation.displayCommand,
        args,
        resolvedRuntime
      }
    });

    let execution: Awaited<ReturnType<typeof runProcess>>;
    try {
      execution = await runProcess(
        invocation.command,
        args,
        context.workspacePath,
        agentTimeoutMs(),
        context.environment,
        context.signal
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await context.trace({
        type: "adapter.error",
        message: "Failed to execute OpenCode",
        metadata: { error: errorMessage }
      });
      return {
        status: "failed",
        summary: `OpenCode execution failed: ${errorMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime
      };
    }

    let summary: string;
    if (execution.error) {
      summary = `OpenCode process error: ${execution.error}`;
    } else if (execution.timedOut) {
      summary = "OpenCode timed out before completing the task.";
    } else if (execution.exitCode === 0) {
      const output = execution.stdout.trim();
      summary = output || "OpenCode completed the task.";
    } else {
      summary = `OpenCode failed with exit code ${execution.exitCode}.`;
    }

    await context.trace({
      type: "adapter.opencode.result",
      message: execution.exitCode === 0 ? "OpenCode finished successfully" : "OpenCode failed",
      metadata: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        signal: execution.signal,
        error: execution.error,
        resolvedRuntime,
        stderr: execution.stderr.trim()
      }
    });

    return {
      status: execution.exitCode === 0 && !execution.error ? "success" : "failed",
      summary,
      tokenUsage: 0,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFilesHint: [],
      resolvedRuntime
    };
  }
}
