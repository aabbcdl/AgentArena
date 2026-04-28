import { promises as fs } from "node:fs";
import path from "node:path";
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

const AIDER_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Aider CLI --yes mode",
  authPrerequisites: ["Aider installed and configured with an LLM provider API key."],
  tokenAvailability: "available",
  costAvailability: "unavailable",
  traceRichness: "partial",
  configurableRuntime: {
    model: true,
    reasoningEffort: false
  },
  knownLimitations: [
    "Aider does not report token usage or cost natively.",
    "Changed files are inferred from workspace diff, not emitted directly by the adapter.",
    "Aider relies on git for change tracking; non-git workspaces may have incomplete results."
  ]
};

async function resolveAiderInvocation(): Promise<InvocationSpec> {
  const command = process.env.AGENTARENA_AIDER_BIN?.trim() || "aider";
  return {
    command,
    argsPrefix: [],
    displayCommand: command
  };
}

export { AIDER_CAPABILITY, resolveAiderInvocation };

export class AiderAdapter implements AgentAdapter {
  readonly kind = "external" as const;
  readonly id = "aider";
  readonly title = "Aider";
  readonly capability = AIDER_CAPABILITY;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await resolveAiderInvocation();
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
    const invocation = await resolveAiderInvocation();

    // Aider requires a git repository; initialize one if needed
    const gitDir = path.join(context.workspacePath, ".git");
    try {
      const stat = await fs.stat(gitDir);
      // Check if .git is a valid directory (not a broken symlink or file)
      if (!stat.isDirectory()) {
        throw new Error(".git exists but is not a directory");
      }
    } catch {
      // Initialize git repo, but handle gracefully if git is not installed
      const gitResult = await runProcess("git", ["init"], context.workspacePath, 30_000, context.environment);
      if (gitResult.exitCode !== 0) {
        console.warn(`Warning: Could not initialize git in workspace. Aider may not work correctly: ${gitResult.stderr}`);
      }
    }

    const args = [
      ...invocation.argsPrefix,
      "--yes",
      "--no-auto-commits",
      "--message",
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
      message: "Starting Aider adapter",
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
        message: "Failed to execute Aider",
        metadata: { error: errorMessage }
      });
      return {
        status: "failed",
        summary: `Aider execution failed: ${errorMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime
      };
    }

    let summary: string;
    if (execution.error) {
      summary = `Aider process error: ${execution.error}`;
    } else if (execution.timedOut) {
      summary = "Aider timed out before completing the task.";
    } else if (execution.exitCode === 0) {
      const output = execution.stdout.trim();
      summary = output || "Aider completed the task.";
    } else {
      summary = `Aider failed with exit code ${execution.exitCode}.`;
    }

    await context.trace({
      type: "adapter.aider.result",
      message: execution.exitCode === 0 ? "Aider finished successfully" : "Aider failed",
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
