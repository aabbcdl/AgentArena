import { promises as fsPromises } from "node:fs";
import path from "node:path";
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
import { logger, type ToolCallRecord, writeExecutionEvidence } from "@agentarena/core";
import { CLAUDE_CODE_CAPABILITY, type InvocationSpec } from "./adapter-capabilities.js";
import { formatAdapterError } from "./adapter-diagnostics.js";
import { buildAgentPrompt, createPreflightResult, getChangedFilesFromGit, savePromptArtifact } from "./adapter-helpers.js";
import { getClaudeProviderProfileSecret } from "./claude-provider-profiles.js";
import {
  claudeIsolationArgsSupported,
  prepareClaudeRuntimeEnvironment
} from "./claude-runtime-environment.js";
import { probeClaudeLikeAuth, probeClaudeLikeAuthFast, probeHelp, probeInvocationVersion } from "./invocation-probes.js";
import { findExecutableOnPath, preflightTimeoutMs, type RunProcessCallbacks, transportTimeoutMs } from "./process-utils.js";
import { resolveClaudeRuntime } from "./runtime-resolution.js";
import {
  createClaudeTransportChain,
  shouldSkipClaudePermissions,
  type TransportChainResult
} from "./transport.js";

async function resolveClaudeInvocation(): Promise<InvocationSpec> {
  const configuredCommand = process.env.AGENTARENA_CLAUDE_BIN?.trim();
  const command =
    configuredCommand ||
    (process.platform === "win32"
      ? (await findExecutableOnPath(["claude.cmd", "claude.exe", "claude"])) ?? "claude"
      : "claude");
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
      const authProbe = await probeClaudeLikeAuth(invocation, process.cwd(), undefined, preflightTimeoutMs());
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
      executionEnvironment?: NodeJS.ProcessEnv;
      resolvedRuntime?: AgentResolvedRuntime;
      /** Whether this is a third-party provider (enables transport fallback) */
      isThirdPartyProvider?: boolean;
    }
  ): Promise<AdapterExecutionResult> {
    const prompt = buildAgentPrompt(context);
    await savePromptArtifact(prompt, context.workspacePath, context);
    const invocation = await this.resolveInvocation();
    const executionEnvironment = options?.executionEnvironment ?? {
      ...context.environment,
      ...options?.extraEnvironment
    };
    const versionProbe = await probeInvocationVersion(invocation, context.workspacePath, executionEnvironment);
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

    const activityCallbacks: RunProcessCallbacks | undefined = context.onActivity
      ? {
          onStdout: (chunk: string) => {
            for (const line of chunk.split(/\r?\n/).filter((value) => value.trim())) {
              context.onActivity?.(line, "stdout", 0);
            }
          },
          onStderr: (chunk: string) => {
            for (const line of chunk.split(/\r?\n/).filter((value) => value.trim())) {
              context.onActivity?.(line, "stderr", 0);
            }
          }
        }
      : undefined;

    let chainResult: TransportChainResult;
    try {
      chainResult = await transportChain.execute(
        prompt,
        context.workspacePath,
        executionEnvironment,
        context.signal,
        activityCallbacks
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
        message: `Transport fallback occurred: ${attempts.map(a => a.transportId).join(" -> ")}`,
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

    // Collect the changed-files hint from git so the runner can compute diff
    // precision. Mirrors base-cli-adapter; reliability is surfaced in the trace.
    const changed = await getChangedFilesFromGit(context.workspacePath);

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
        usedFallback,
        changedFilesHint: changed.files,
        changedFilesHintReliable: changed.reliable
      }
    });

    // Save stdout/stderr to files for debugging (legacy)
    try {
      const stdoutPath = context.workspacePath + "/agent-stdout.jsonl";
      await fsPromises.writeFile(stdoutPath, execution.stdout, "utf8");
      if (execution.stderr.trim()) {
        const stderrPath = context.workspacePath + "/agent-stderr.log";
        await fsPromises.writeFile(stderrPath, execution.stderr, "utf8");
      }
    } catch (writeError) {
      logger.debug("adapter", "artifact.write_failed", `Failed to write agent artifacts: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
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
    } catch (evidenceError) {
      logger.debug("adapter", "evidence.write_failed", `Failed to write execution evidence: ${evidenceError instanceof Error ? evidenceError.message : String(evidenceError)}`);
    }

    // Token usage is only trustworthy when: no transport fallback was used
    // (fallback transports may not surface token data), the count wasn't flagged
    // suspicious (result event seen but zero tokens), AND an authoritative
    // cumulative total was present (the "result" event; without it the
    // per-message sum can double-count cache-read tokens across turns).
    // Additionally, format mismatch (CLI changed event schema) makes all
    // parsed data untrustworthy.
    const tokenUsageReliable =
      !usedFallback &&
      !(parsed?.tokenCountSuspicious ?? false) &&
      !(parsed?.formatMismatch ?? false) &&
      !((parsed?.missingCriticalEvents?.length ?? 0) > 0) &&
      (parsed ? parsed.tokenUsageFromResultEvent !== false : true);

    const qualityWarnings: string[] = [];
    if (parsed?.formatMismatch) {
      qualityWarnings.push(
        `${this.title} output format changed — token usage, cost, and tool-call data may be inaccurate.`
      );
    }
    if (parsed?.missingCriticalEvents?.length) {
      qualityWarnings.push(
        `${this.title} missing critical events: ${parsed.missingCriticalEvents.join(", ")} — token and cost data may be incomplete.`
      );
    }
    const dataQualityWarning = qualityWarnings.length > 0 ? qualityWarnings.join(" ") : undefined;

    const hasMissingCritical = (parsed?.missingCriticalEvents?.length ?? 0) > 0;

    return {
      status,
      summary,
      tokenUsage: parsed?.tokenUsage ?? 0,
      estimatedCostUsd: parsed?.estimatedCostUsd ?? 0,
      costKnown: parsed?.costKnown ?? false,
      costQuality: hasMissingCritical ? "unavailable" : undefined,
      tokenUsageReliable,
      dataQualityWarning,
      missingCriticalEvents: parsed?.missingCriticalEvents,
      changedFilesHint: changed.files,
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
    let resolvedRuntime: AgentResolvedRuntime = resolved.runtime;

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

    if (!shouldSkipClaudePermissions()) {
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        "blocked",
        "Claude Code unattended permissions are not enabled for AgentArena tasks.",
        resolvedRuntime,
        invocation.displayCommand,
        [
          "Set AGENTARENA_SKIP_PERMISSIONS=1 before starting AgentArena to allow Claude Code to work without interactive approval prompts.",
          "This gives Claude Code the permissions of your local operating-system account, so only run trusted task packs and repositories."
        ]
      );
    }

    let prepared: Awaited<ReturnType<typeof prepareClaudeRuntimeEnvironment>>;
    try {
      prepared = await prepareClaudeRuntimeEnvironment({
        profileId: resolved.profile.id,
        requestedModel: options?.selection?.config.model ?? resolved.profile.primaryModel,
        baseEnvironment: process.env
      });
    } catch (error) {
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        "blocked",
        "Failed to prepare the Claude Code runtime environment.",
        resolvedRuntime,
        invocation.displayCommand,
        [error instanceof Error ? error.message : String(error)]
      );
    }

    let result: AdapterPreflightResult | undefined;
    let probeError: unknown;
    try {
      result = await (async () => {
        const probeWorkspace = prepared.runtimeRoot
          ? path.join(prepared.runtimeRoot, "workspace")
          : process.cwd();
        if (prepared.runtimeRoot) {
          try {
            await fsPromises.mkdir(probeWorkspace, { recursive: true });
          } catch (error) {
            return createPreflightResult(
              options?.selection,
              this.id,
              this.title,
              this.kind,
              this.capability,
              "blocked",
              "Failed to prepare the isolated Claude Code probe workspace.",
              resolvedRuntime,
              invocation.displayCommand,
              [error instanceof Error ? error.message : String(error)]
            );
          }
        }

        const versionProbe = await probeInvocationVersion(
          invocation,
          probeWorkspace,
          prepared.environment
        );
        resolvedRuntime = {
          ...resolved.runtime,
          effectiveAgentVersion:
            versionProbe.version ?? resolved.runtime.effectiveAgentVersion,
          agentVersionSource:
            versionProbe.source !== "unknown"
              ? versionProbe.source
              : resolved.runtime.agentVersionSource
        };

        const help = await probeHelp(invocation, probeWorkspace, prepared.environment);
        const helpOutput = `${help.stdout}\n${help.stderr}`;
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

        if (resolved.profile.kind !== "official" && !claudeIsolationArgsSupported(helpOutput)) {
          return createPreflightResult(
            options?.selection,
            this.id,
            this.title,
            this.kind,
            this.capability,
            "blocked",
            "This Claude Code version cannot guarantee isolated third-party Provider execution.",
            resolvedRuntime,
            invocation.displayCommand,
            ["Upgrade Claude Code to a version that supports --setting-sources and --strict-mcp-config."]
          );
        }

        if (options?.probeAuth) {
          if (resolved.profile.kind !== "official") {
            const fastResult = await probeClaudeLikeAuthFast(
              invocation,
              probeWorkspace,
              this.id,
              resolved.profile.id,
              prepared.environment,
              preflightTimeoutMs(),
              {
                endpoint: resolved.profile.baseUrl,
                useCache: true,
                forceProbe: false,
                extraArgs: prepared.extraArgs
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

          const authProbe = await probeClaudeLikeAuth(
            invocation,
            probeWorkspace,
            prepared.environment,
            preflightTimeoutMs(),
            prepared.extraArgs
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
      })();
    } catch (error) {
      probeError = error;
    }

    try {
      await prepared.cleanup();
    } catch (error) {
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        "blocked",
        "Failed to clean the isolated Claude Code runtime.",
        resolvedRuntime,
        invocation.displayCommand,
        [error instanceof Error ? error.message : String(error)]
      );
    }

    if (probeError !== undefined) {
      throw probeError;
    }
    if (result === undefined) {
      throw new Error("Claude Code preflight completed without a result.");
    }
    return result;
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const { runtime: runtimeBase, profile } = await resolveClaudeRuntime({
      requestedConfig: context.selection.config
    });
    if (!shouldSkipClaudePermissions()) {
      return {
        status: "failed",
        summary:
          "Claude Code unattended permissions are not enabled. Set AGENTARENA_SKIP_PERMISSIONS=1 before starting AgentArena, then retry the task.",
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime: runtimeBase
      };
    }
    const invocation = await this.resolveInvocation();
    let prepared: Awaited<ReturnType<typeof prepareClaudeRuntimeEnvironment>>;
    try {
      prepared = await prepareClaudeRuntimeEnvironment({
        profileId: profile.id,
        requestedModel: context.selection.config.model ?? profile.primaryModel,
        baseEnvironment: context.environment
      });
    } catch (error) {
      return {
        status: "failed",
        summary: `Failed to prepare Claude Code runtime: ${error instanceof Error ? error.message : String(error)}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime: runtimeBase
      };
    }

    let result: AdapterExecutionResult | undefined;
    let executionError: unknown;
    let resolvedRuntime: AgentResolvedRuntime = runtimeBase;
    try {
      result = await (async () => {
        if (profile.kind !== "official") {
          const help = await probeHelp(invocation, context.workspacePath, prepared.environment);
          if (help.exitCode !== 0 || !claudeIsolationArgsSupported(`${help.stdout}\n${help.stderr}`)) {
            return {
              status: "failed" as const,
              summary:
                "Claude Code cannot run this third-party Provider safely. Upgrade Claude Code to a version that supports isolated settings and strict MCP configuration.",
              tokenUsage: 0,
              estimatedCostUsd: 0,
              costKnown: false,
              changedFilesHint: [],
              resolvedRuntime: runtimeBase
            };
          }
        }

        const versionProbe = await probeInvocationVersion(
          invocation,
          context.workspacePath,
          prepared.environment
        );
        resolvedRuntime = {
          ...runtimeBase,
          effectiveModel: prepared.effectiveModel ?? runtimeBase.effectiveModel,
          effectiveAgentVersion:
            versionProbe.version ?? runtimeBase.effectiveAgentVersion,
          agentVersionSource:
            versionProbe.source !== "unknown"
              ? versionProbe.source
              : runtimeBase.agentVersionSource
        };
        const extraArgs = [
          ...prepared.extraArgs,
          ...(resolvedRuntime.effectiveModel ? ["--model", resolvedRuntime.effectiveModel] : [])
        ];
        const profileRiskNote =
          profile.kind === "official"
            ? "Using the current local Claude Code login and configuration."
            : "Using an isolated Claude Code configuration for a third-party Provider.";

        await context.trace({
          type: "adapter.claude.profile",
          message: profileRiskNote,
          metadata: {
            providerProfileId: profile.id,
            providerProfileName: profile.name,
            providerKind: profile.kind,
            runtimeMode: prepared.mode,
            configIsolated: prepared.mode === "third-party-isolated",
            effectiveModel: resolvedRuntime.effectiveModel
          }
        });

        const adapterResult = await this.executeClaudeLike(
          context,
          "adapter.claude.result",
          "Claude Code",
          {
            extraArgs,
            executionEnvironment: prepared.environment,
            resolvedRuntime,
            isThirdPartyProvider: profile.kind !== "official"
          }
        );

        return {
          ...adapterResult,
          summary:
            profile.kind === "official"
              ? adapterResult.summary
              : `${adapterResult.summary}\n\nThis result was produced through an isolated third-party Provider configuration.`,
          resolvedRuntime
        };
      })();
    } catch (error) {
      executionError = error;
    }

    try {
      await prepared.cleanup();
    } catch (error) {
      const cleanupMessage = error instanceof Error ? error.message : String(error);
      const executionMessage = executionError === undefined
        ? ""
        : ` The execution also failed: ${executionError instanceof Error ? executionError.message : String(executionError)}`;
      return {
        ...(result ?? {
          tokenUsage: 0,
          estimatedCostUsd: 0,
          costKnown: false,
          changedFilesHint: []
        }),
        status: "failed",
        summary: `Failed to clean the isolated Claude Code runtime: ${cleanupMessage}.${executionMessage}`,
        resolvedRuntime
      };
    }

    if (executionError !== undefined) {
      throw executionError;
    }
    if (result === undefined) {
      throw new Error("Claude Code execution completed without a result.");
    }
    return result;
  }
}

export { ClaudeLikeAdapter };
