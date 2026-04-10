import type {
  AdapterCapability,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { parseGeminiEvents } from "./event-parsers.js";
import { agentTimeoutMs, runProcess } from "./process-utils.js";
import {
  buildAgentPrompt,
  createPreflightResult,
  type InvocationSpec,
  probeHelp,
  probeInvocationVersion
} from "./shared.js";

const GEMINI_CAPABILITY: AdapterCapability = {
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

async function resolveGeminiInvocation(): Promise<InvocationSpec> {
  const command = process.env.AGENTARENA_GEMINI_BIN?.trim() || "gemini";
  return {
    command,
    argsPrefix: [],
    displayCommand: command
  };
}

export { GEMINI_CAPABILITY, resolveGeminiInvocation };

export class GeminiCliAdapter implements AgentAdapter {
  readonly kind = "external" as const;
  readonly id = "gemini-cli";
  readonly title = "Gemini CLI";
  readonly capability = GEMINI_CAPABILITY;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await resolveGeminiInvocation();
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
    const invocation = await resolveGeminiInvocation();
    const args = [
      ...invocation.argsPrefix,
      "--output-format",
      "json",
      "--permission-mode",
      "bypassPermissions",
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
      message: "Starting Gemini CLI adapter",
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
        message: "Failed to execute Gemini CLI",
        metadata: { error: errorMessage }
      });
      return {
        status: "failed",
        summary: `Gemini CLI execution failed: ${errorMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime
      };
    }

    const parsed = parseGeminiEvents(execution.stdout);

    let summary: string;
    if (execution.error) {
      summary = `Gemini CLI process error: ${execution.error}`;
    } else if (execution.timedOut) {
      summary = "Gemini CLI timed out before producing a final message.";
    } else if (parsed.summaryFromEvents) {
      summary = parsed.summaryFromEvents;
    } else if (execution.exitCode === 0) {
      summary = "Gemini CLI completed without a final message.";
    } else {
      summary = `Gemini CLI failed with exit code ${execution.exitCode}.`;
    }

    await context.trace({
      type: "adapter.gemini.result",
      message: execution.exitCode === 0 ? "Gemini CLI finished successfully" : "Gemini CLI failed",
      metadata: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        signal: execution.signal,
        error: execution.error,
        tokenUsage: parsed.tokenUsage,
        estimatedCostUsd: parsed.estimatedCostUsd,
        costKnown: parsed.costKnown,
        resolvedRuntime,
        stderr: execution.stderr.trim()
      }
    });

    return {
      status: execution.exitCode === 0 && !execution.error ? "success" : "failed",
      summary,
      tokenUsage: parsed.tokenUsage,
      estimatedCostUsd: parsed.estimatedCostUsd,
      costKnown: parsed.costKnown,
      changedFilesHint: [],
      resolvedRuntime
    };
  }
}
