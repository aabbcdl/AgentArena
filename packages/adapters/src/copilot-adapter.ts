import path from "node:path";
import {
  type AdapterCapability,
  type AdapterExecutionContext,
  type AdapterExecutionResult,
  type AdapterPreflightOptions,
  type AdapterPreflightResult,
  type AgentAdapter,
  type AgentResolvedRuntime,
  ensureDirectory
} from "@agentarena/core";
import { agentTimeoutMs, runProcess } from "./process-utils.js";
import {
  buildAgentPrompt,
  createPreflightResult,
  type InvocationSpec,
  probeHelp,
  probeInvocationVersion
} from "./shared.js";

export const COPILOT_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "GitHub Copilot CLI agent mode",
  authPrerequisites: ["GitHub CLI authenticated with Copilot access."],
  tokenAvailability: "unavailable",
  costAvailability: "unavailable",
  traceRichness: "minimal",
  configurableRuntime: { model: false, reasoningEffort: false },
  knownLimitations: [
    "Token usage is estimated using character count (1 token ≈ 4 chars) and may vary by ±50%.",
    "Estimation includes both prompt and output, but may overestimate due to non-LLM CLI output.",
    "Actual cost cannot be determined without API access.",
    "Cost estimates should only be used for rough comparison.",
    "Output parsing depends on Copilot CLI text compatibility."
  ]
};

async function resolveCopilotInvocation(): Promise<InvocationSpec> {
  if (process.env.AGENTARENA_COPILOT_BIN?.trim()) {
    const command = process.env.AGENTARENA_COPILOT_BIN.trim();
    return { command, argsPrefix: [], displayCommand: command };
  }

  return {
    command: "copilot",
    argsPrefix: [],
    displayCommand: "copilot"
  };
}

async function resolveCopilotRuntime(config: {
  requestedModel?: string;
  configSource?: string;
}): Promise<AgentResolvedRuntime> {
  const notes: string[] = ["Using GitHub Copilot CLI default configuration."];
  if (config.requestedModel) {
    notes.push(`Model requested: ${config.requestedModel} (may not be supported by Copilot CLI)`);
  }

  return {
    effectiveModel: undefined,
    source: (config.configSource ?? "cli-default") as AgentResolvedRuntime["source"],
    verification: "unknown",
    notes
  };
}

function estimateTokenUsage(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters for English text
  // Filter out likely non-LLM content (progress bars, ANSI codes, etc.)
  const cleanedText = text
    .replace(/\r/g, "") // Remove carriage returns
    .replace(/[^\x20-\x7E\n]/g, "") // Keep only printable ASCII + newlines
    .split("\n")
    .filter(line => {
      // Skip lines that look like progress bars or terminal artifacts
      const trimmed = line.trim();
      if (trimmed.length === 0) return false;
      if (/^[█▓░▒▀▄■●▪▫▬►◄▲▼]+/.test(trimmed)) return false; // Progress bar chars
      if (/^\d+%/.test(trimmed)) return false; // Percentage lines
      if (/^\[.*\]/.test(trimmed) && trimmed.length < 50) return false; // Short bracket expressions
      return true;
    })
    .join("\n");

  return Math.ceil(cleanedText.length / 4);
}

export class CopilotAdapter implements AgentAdapter {
  readonly kind = "external" as const;
  readonly id = "copilot";
  readonly title = "GitHub Copilot CLI";
  readonly capability = COPILOT_CAPABILITY;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await resolveCopilotInvocation();
    const runtimeDefaults = await resolveCopilotRuntime({
      requestedModel: options?.selection?.config?.model,
      configSource: options?.selection?.configSource
    });
    const versionProbe = await probeInvocationVersion(invocation, process.cwd());
    const resolvedRuntime = {
      ...runtimeDefaults,
      effectiveAgentVersion: versionProbe.version ?? runtimeDefaults.effectiveAgentVersion,
      agentVersionSource: versionProbe.source !== "unknown"
        ? versionProbe.source
        : runtimeDefaults.agentVersionSource,
      notes: [
        ...(runtimeDefaults.notes ?? []),
        ...(versionProbe.note ? [versionProbe.note] : [])
      ]
    };

    try {
      const result = await probeHelp(invocation, process.cwd());

      if (result.timedOut) {
        return createPreflightResult(
          options?.selection,
          this.id,
          this.title,
          this.kind,
          this.capability,
          "blocked",
          "CLI help probe timed out.",
          resolvedRuntime,
          invocation.displayCommand,
          [result.stderr.trim()].filter(Boolean)
        );
      }

      if (result.error) {
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
          [result.error]
        );
      }

      if (result.exitCode === 0) {
        return createPreflightResult(
          options?.selection,
          this.id,
          this.title,
          this.kind,
          this.capability,
          "ready",
          "GitHub Copilot CLI is installed and responds to --help.",
          resolvedRuntime,
          invocation.displayCommand
        );
      }

      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        "unverified",
        "CLI was found, but readiness could not be fully confirmed.",
        resolvedRuntime,
        invocation.displayCommand,
        [result.stderr.trim()].filter(Boolean)
      );
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
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const metadataDir = path.join(context.workspacePath, "agentarena-copilot");
    await ensureDirectory(metadataDir);

    const prompt = buildAgentPrompt(context);
    const invocation = await resolveCopilotInvocation();
    const resolvedRuntime = await resolveCopilotRuntime({
      requestedModel: context.selection.config?.model,
      configSource: context.selection.configSource
    });
    const versionProbe = await probeInvocationVersion(invocation, context.workspacePath, context.environment);
    const runtimeWithVersion = {
      ...resolvedRuntime,
      effectiveAgentVersion: versionProbe.version ?? resolvedRuntime.effectiveAgentVersion,
      agentVersionSource: versionProbe.source !== "unknown"
        ? versionProbe.source
        : resolvedRuntime.agentVersionSource
    };

    const args = [
      ...invocation.argsPrefix,
      "agent",
      "-p",
      prompt,
      "--allow-all-tools"
    ];

    await context.trace({
      type: "adapter.start",
      message: "Starting GitHub Copilot CLI adapter",
      metadata: {
        command: invocation.displayCommand,
        args,
        requestedConfig: context.selection.config,
        resolvedRuntime: runtimeWithVersion
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
        message: "Failed to execute GitHub Copilot CLI",
        metadata: { error: errorMessage }
      });
      return {
        status: "failed",
        summary: `GitHub Copilot CLI execution failed: ${errorMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime: runtimeWithVersion
      };
    }

    // Detect changed files
    const changedFilesHint: string[] = [];
    try {
      const { execFileSync } = await import("node:child_process");
      const gitDiff = execFileSync("git", ["diff", "--name-only"], {
        cwd: context.workspacePath,
        encoding: "utf8"
      }).trim();
      if (gitDiff) {
        changedFilesHint.push(...gitDiff.split("\n").filter(Boolean));
      }
    } catch {
      // git not available
    }

    const tokenUsage = estimateTokenUsage(prompt) + estimateTokenUsage(execution.stdout);
    const summary = execution.stdout.trim() || "GitHub Copilot CLI completed the task.";

    await context.trace({
      type: "adapter.copilot.result",
      message: execution.exitCode === 0 ? "Copilot CLI finished" : "Copilot CLI failed",
      metadata: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        error: execution.error,
        tokenUsage,
        changedFilesHint,
        stderr: execution.stderr.trim()
      }
    });

    return {
      status: execution.exitCode === 0 && !execution.error ? "success" : "failed",
      summary,
      tokenUsage,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFilesHint,
      resolvedRuntime: runtimeWithVersion
    };
  }
}
