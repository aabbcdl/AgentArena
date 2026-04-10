import type {
  AdapterCapability,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { getClaudeProviderProfileSecret, writeClaudeWorkspaceSettings } from "./claude-provider-profiles.js";
import { parseClaudeEvents } from "./event-parsers.js";
import { agentTimeoutMs, runProcess } from "./process-utils.js";
import {
  buildAgentPrompt,
  CLAUDE_CODE_CAPABILITY,
  createPreflightResult,
  type InvocationSpec,
  probeClaudeLikeAuth,
  probeClaudeProfileAuth,
  probeHelp,
  probeInvocationVersion,
  resolveClaudeRuntime
} from "./shared.js";

async function resolveClaudeInvocation(): Promise<InvocationSpec> {
  const command = process.env.AGENTARENA_CLAUDE_BIN?.trim() || "claude";
  return {
    command,
    argsPrefix: [],
    displayCommand: command
  };
}

export { resolveClaudeInvocation };

abstract class ClaudeLikeAdapter implements AgentAdapter {
  abstract readonly id: string;
  abstract readonly title: string;
  abstract readonly kind: "external";
  abstract readonly capability: AdapterCapability;
  protected abstract resolveInvocation(): Promise<InvocationSpec>;
  abstract execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult>;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await this.resolveInvocation();
    const versionProbe = await probeInvocationVersion(invocation, process.cwd());
    const resolvedRuntime = versionProbe.version
      ? {
          effectiveAgentVersion: versionProbe.version,
          agentVersionSource: versionProbe.source,
          source: "unknown" as const,
          verification: "inferred" as const
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

    if (options?.probeAuth) {
      const authProbe = await probeClaudeLikeAuth(invocation, process.cwd());
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        authProbe.status,
        authProbe.summary,
        resolvedRuntime,
        invocation.displayCommand,
        authProbe.details
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

  protected async executeClaudeLike(
    context: AdapterExecutionContext,
    eventType: string,
    finishLabel: string,
    options?: {
      extraArgs?: string[];
      extraEnvironment?: NodeJS.ProcessEnv;
      resolvedRuntime?: AgentResolvedRuntime;
    }
  ): Promise<AdapterExecutionResult> {
    const prompt = buildAgentPrompt(context);
    const invocation = await this.resolveInvocation();
    const args = [
      ...invocation.argsPrefix,
      ...(options?.extraArgs ?? []),
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      "--no-session-persistence",
      prompt
    ];
    const versionProbe = await probeInvocationVersion(invocation, context.workspacePath, {
      ...context.environment,
      ...options?.extraEnvironment
    });
    const resolvedRuntime = {
      ...(options?.resolvedRuntime ?? {
        source: "unknown" as const,
        verification: "unknown" as const
      }),
      effectiveAgentVersion:
        versionProbe.version ?? options?.resolvedRuntime?.effectiveAgentVersion,
      agentVersionSource:
        versionProbe.source !== "unknown"
          ? versionProbe.source
          : options?.resolvedRuntime?.agentVersionSource
    };

    await context.trace({
      type: "adapter.start",
      message: `Starting ${this.title} adapter`,
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
        {
          ...context.environment,
          ...options?.extraEnvironment
        },
        context.signal
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await context.trace({
        type: "adapter.error",
        message: `Failed to execute ${this.title}`,
        metadata: { error: errorMessage }
      });
      return {
        status: "failed",
        summary: `${this.title} execution failed: ${errorMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime
      };
    }

    const parsed = parseClaudeEvents(execution.stdout);

    let summary: string;
    if (execution.error) {
      summary = `${this.title} process error: ${execution.error}`;
    } else if (execution.timedOut) {
      summary = `${this.title} timed out before producing a final message.`;
    } else if (parsed.summaryFromEvents) {
      summary = parsed.summaryFromEvents;
    } else if (execution.exitCode === 0) {
      summary = `${this.title} completed without a final message.`;
    } else {
      summary = `${this.title} failed with exit code ${execution.exitCode}.`;
    }

    await context.trace({
      type: eventType,
      message: execution.exitCode === 0 ? `${finishLabel} finished` : `${finishLabel} failed`,
      metadata: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        signal: execution.signal,
        error: execution.error,
        sessionId: parsed.sessionId,
        tokenUsage: parsed.tokenUsage,
        estimatedCostUsd: parsed.estimatedCostUsd,
        costKnown: parsed.costKnown,
        resolvedRuntime,
        parsedError: parsed.error,
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

export class ClaudeCodeAdapter extends ClaudeLikeAdapter {
  readonly kind = "external" as const;
  readonly id = "claude-code";
  readonly title = "Claude Code";
  readonly capability = CLAUDE_CODE_CAPABILITY;

  protected async resolveInvocation(): Promise<InvocationSpec> {
    return await resolveClaudeInvocation();
  }

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await this.resolveInvocation();
    const resolved = await resolveClaudeRuntime({
      requestedConfig: options?.selection?.config
    });
    const versionProbe = await probeInvocationVersion(invocation, process.cwd());
    const resolvedRuntime = {
      ...resolved.runtime,
      effectiveAgentVersion:
        versionProbe.version ?? resolved.runtime.effectiveAgentVersion,
      agentVersionSource:
        versionProbe.source !== "unknown"
          ? versionProbe.source
          : resolved.runtime.agentVersionSource
    };

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

    if (resolved.profile.kind !== "official" && !(await getClaudeProviderProfileSecret(resolved.profile.id))) {
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        "blocked",
        `Provider profile "${resolved.profile.name}" does not have a stored secret.`,
        resolvedRuntime,
        invocation.displayCommand,
        ["Store a secret for this profile before running Claude Code against a third-party provider."]
      );
    }

    if (options?.probeAuth) {
      const authProbe =
        resolved.profile.kind === "official"
          ? await probeClaudeLikeAuth(invocation, process.cwd())
          : await probeClaudeProfileAuth(
              invocation,
              resolved.profile.id,
              options?.selection?.config.model ?? resolved.profile.primaryModel
            );
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        authProbe.status,
        authProbe.summary,
        resolvedRuntime,
        invocation.displayCommand,
        authProbe.details
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
    const { runtime: runtimeBase, profile } = await resolveClaudeRuntime({
      requestedConfig: context.selection.config
    });
    const providerRuntime = await writeClaudeWorkspaceSettings(
      context.workspacePath,
      profile.id,
      context.selection.config.model ?? profile.primaryModel
    );
    const invocation = await this.resolveInvocation();
    const versionProbe = await probeInvocationVersion(invocation, context.workspacePath, {
      ...context.environment,
      ...providerRuntime.environment
    });
    const runtime = {
      ...runtimeBase,
      effectiveAgentVersion:
        versionProbe.version ?? runtimeBase.effectiveAgentVersion,
      agentVersionSource:
        versionProbe.source !== "unknown"
          ? versionProbe.source
          : runtimeBase.agentVersionSource
    };
    const extraArgs = runtime.effectiveModel ? ["--model", runtime.effectiveModel] : [];
    const profileRiskNote =
      profile.kind === "official"
        ? "Using Claude Code official profile without a third-party provider override."
        : "This result was produced through a provider-switched Claude Code configuration.";

    await context.trace({
      type: "adapter.claude.profile",
      message: profileRiskNote,
      metadata: {
        providerProfileId: profile.id,
        providerProfileName: profile.name,
        providerKind: profile.kind,
        settingsPath: providerRuntime.settingsPath,
        effectiveModel: runtime.effectiveModel
      }
    });

    const result = await this.executeClaudeLike(context, "adapter.claude.result", "Claude Code", {
      extraArgs,
      extraEnvironment: providerRuntime.environment,
      resolvedRuntime: runtime
    });

    return {
      ...result,
      summary:
        profile.kind === "official"
          ? result.summary
          : `${result.summary}\n\nThis result was produced through a provider-switched Claude Code configuration.`,
      resolvedRuntime: runtime
    };
  }
}

export { ClaudeLikeAdapter };
