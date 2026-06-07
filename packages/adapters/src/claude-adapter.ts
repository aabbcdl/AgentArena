import type {
  AdapterCapability,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter,
  AgentResolvedRuntime,
  TraceEventType
} from "@agentarena/core";
import { type ToolCallRecord, writeExecutionEvidence } from "@agentarena/core";
import { CLAUDE_CODE_CAPABILITY, type InvocationSpec } from "./adapter-capabilities.js";
import { formatAdapterError } from "./adapter-diagnostics.js";
import { buildAgentPrompt, createPreflightResult, savePromptArtifact } from "./adapter-helpers.js";
import { getClaudeProviderProfileSecret, writeClaudeWorkspaceSettings } from "./claude-provider-profiles.js";
import { probeClaudeLikeAuth, probeClaudeLikeAuthFast, probeHelp, probeInvocationVersion } from "./invocation-probes.js";
import { preflightTimeoutMs, transportTimeoutMs } from "./process-utils.js";
import { resolveClaudeRuntime } from "./runtime-resolution.js";
import { createClaudeTransportChain, type TransportChainResult } from "./transport.js";

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
    eventType: TraceEventType,
    finishLabel: string,
    options?: {
      extraArgs?: string[];
      extraEnvironment?: NodeJS.ProcessEnv;
      resolvedRuntime?: AgentResolvedRuntime;
      /** Whether this is a third-party provider (enables transport fallback) */
      isThirdPartyProvider?: boolean;
    }
  ): Promise<AdapterExecutionResult> {
    const prompt = buildAgentPrompt(context);
    await savePromptArtifact(prompt, context.workspacePath, context);
    const invocation = await this.resolveInvocation();
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

    // Create transport chain with fallback for third-party providers
    const transportChain = createClaudeTransportChain(
      invocation,
      options?.isThirdPartyProvider ?? false,
      options?.extraArgs ?? [],
      { transportTimeoutMs: transportTimeoutMs(), logFallbacks: true }
    );

    const startedAt = Date.now();

    await context.trace({
      type: "adapter.start",
      message: `Starting ${this.title} adapter`,
      metadata: {
        command: invocation.displayCommand,
        transportChain: transportChain.transportIds,
        resolvedRuntime
      }
    });

    let chainResult: TransportChainResult;
    try {
      chainResult = await transportChain.execute(
        prompt,
        context.workspacePath,
        {
          ...context.environment,
          ...options?.extraEnvironment
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const actionableMessage = formatAdapterError(errorMessage, this.title, invocation.displayCommand);
      await context.trace({
        type: "adapter.error",
        message: `Failed to execute ${this.title}`,
        metadata: { error: actionableMessage }
      });
      return {
        status: "failed",
        summary: `${this.title} execution failed: ${actionableMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime
      };
    }

    const { result: transportResult, attempts, usedFallback } = chainResult;
    const execution = transportResult.processResult;
    const parsed = transportResult.parsed;

    // Emit tool_use trace events for each tool call detected
    if (parsed?.toolCalls) {
      for (const tc of parsed.toolCalls) {
        await context.trace({
          type: "adapter.tool_use",
          message: tc.name,
          metadata: { toolName: tc.name, input: tc.input }
        });
      }
    }

    // Emit transport fallback info if applicable
    if (usedFallback) {
      await context.trace({
        type: "adapter.transport_fallback",
        message: `Transport fallback occurred: ${attempts.map(a => a.transportId).join(" → ")}`,
        metadata: { attempts, finalTransport: transportResult.transportId }
      });
    }

    let summary: string;
    if (execution.error) {
      summary = `${this.title} process error: ${execution.error}`;
    } else if (execution.timedOut) {
      summary = `${this.title} timed out before producing a final message.`;
    } else if (parsed?.summary) {
      summary = parsed.summary;
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
        sessionId: parsed?.sessionId,
        tokenUsage: parsed?.tokenUsage ?? 0,
        estimatedCostUsd: parsed?.estimatedCostUsd ?? 0,
        costKnown: parsed?.costKnown ?? false,
        resolvedRuntime,
        parsedError: parsed?.error,
        stderr: execution.stderr.trim(),
        stdout: execution.stdout,
        workspacePath: context.workspacePath,
        transportUsed: transportResult.transportId,
        usedFallback
      }
    });

    // Save stdout/stderr to files for debugging (legacy)
    try {
      const fs = await import("node:fs/promises");
      const stdoutPath = context.workspacePath + "/agent-stdout.jsonl";
      await fs.default.writeFile(stdoutPath, execution.stdout, "utf8");
      if (execution.stderr.trim()) {
        const stderrPath = context.workspacePath + "/agent-stderr.log";
        await fs.default.writeFile(stderrPath, execution.stderr, "utf8");
      }
    } catch {
      // Best effort — don't fail the run if we can't write the file
    }

    // Write evidence for structured collection
    const status = execution.exitCode === 0 && !execution.error && !parsed?.error ? "success" as const : "failed" as const;
    try {
      const toolCallRecords: ToolCallRecord[] = (parsed?.toolCalls ?? []).map(tc => ({
        timestamp: new Date().toISOString(),
        name: tc.name,
        input: tc.input,
        success: true,
      }));

      await writeExecutionEvidence(
        { adapterId: this.id, workspacePath: context.workspacePath },
        {
          toolCalls: toolCallRecords,
          exitCode: execution.exitCode ?? -1,
          stdout: execution.stdout,
          stderr: execution.stderr,
          meta: {
            adapterId: this.id,
            startTime: new Date(startedAt).toISOString(),
            endTime: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            tokenUsage: parsed?.tokenUsage,
            estimatedCostUsd: parsed?.estimatedCostUsd,
            costKnown: parsed?.costKnown,
            sessionId: parsed?.sessionId,
            transportUsed: transportResult.transportId,
            usedFallback,
            status,
            summary,
          },
        }
      );
    } catch {
      // Best effort — don't fail the run if evidence writing fails
    }

    return {
      status,
      summary,
      tokenUsage: parsed?.tokenUsage ?? 0,
      estimatedCostUsd: parsed?.estimatedCostUsd ?? 0,
      costKnown: parsed?.costKnown ?? false,
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
      // Use fast probe with cache for third-party providers (they are more fragile)
      if (resolved.profile.kind !== "official") {
        const fastResult = await probeClaudeLikeAuthFast(
          invocation,
          process.cwd(),
          this.id,
          resolved.profile.id,
          {
            ...process.env,
            ...(await writeClaudeWorkspaceSettings(
              process.cwd(),
              resolved.profile.id,
              options?.selection?.config.model ?? resolved.profile.primaryModel
            ).then(r => r.environment).catch(() => ({})))
          },
          preflightTimeoutMs(),
          {
            useCache: true,
            forceProbe: false,
          }
        );
        return createPreflightResult(
          options?.selection,
          this.id,
          this.title,
          this.kind,
          this.capability,
          fastResult.status,
          fastResult.summary,
          resolvedRuntime,
          invocation.displayCommand,
          fastResult.details
        );
      }

      // Official provider: use standard probe
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
      resolvedRuntime: runtime,
      isThirdPartyProvider: profile.kind !== "official"
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
