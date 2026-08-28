import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type AdapterExecutionContext,
  type AdapterExecutionResult,
  type AdapterPreflightOptions,
  type AdapterPreflightResult,
  type AgentAdapter,
  ensureDirectory,
} from "@agentarena/core";
import { CODEX_CAPABILITY, type InvocationSpec } from "./adapter-capabilities.js";
import { formatAdapterError } from "./adapter-diagnostics.js";
import { buildAgentPrompt, createPreflightResult, savePromptArtifact } from "./adapter-helpers.js";
import { prepareCodexRuntimeHome } from "./codex-runtime-home.js";
import { parseCodexEvents } from "./event-parsers.js";
import { probeHelp, probeInvocationVersion } from "./invocation-probes.js";
import {
  materializeRuntimeLaunchArguments,
  materializeRuntimeLaunchEnvironment,
  resolvedAgentRuntimeFromLaunchSpec
} from "./launch-resolver.js";
import { agentTimeoutMs, type RunProcessCallbacks, runProcess } from "./process-utils.js";
import { resolveCodexRuntime } from "./runtime-resolution.js";

async function resolveCodexInvocation(): Promise<InvocationSpec> {
  if (process.env.AGENTARENA_CODEX_BIN?.trim()) {
    const command = process.env.AGENTARENA_CODEX_BIN.trim();
    return { command, argsPrefix: [], displayCommand: command };
  }

  if (process.platform === "win32") {
    const scriptCandidates = [
      path.join(
        process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? "", "AppData", "Roaming"),
        "npm",
        "node_modules",
        "@openai",
        "codex",
        "bin",
        "codex.js"
      ),
      ...((process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((entry) => path.join(entry, "node_modules", "@openai", "codex", "bin", "codex.js")))
    ];

    for (const scriptPath of scriptCandidates) {
      try {
        await fs.access(scriptPath);
        return {
          command: process.execPath,
          argsPrefix: [scriptPath],
          displayCommand: `${process.execPath} ${scriptPath}`
        };
      } catch {
        // Try the next likely npm global location before falling back to the shim.
      }
    }

    return {
      command: "codex.cmd",
      argsPrefix: [],
      displayCommand: "codex.cmd"
    };
  }

  return {
    command: "codex",
    argsPrefix: [],
    displayCommand: "codex"
  };
}

export { resolveCodexInvocation };

const CODEX_SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"] as const;
type CodexSandboxMode = typeof CODEX_SANDBOX_MODES[number];

function isCodexSandboxMode(value: string): value is CodexSandboxMode {
  return CODEX_SANDBOX_MODES.includes(value as CodexSandboxMode);
}

export function resolveCodexSandboxMode(environment: NodeJS.ProcessEnv = process.env): CodexSandboxMode {
  const configured = environment.AGENTARENA_CODEX_SANDBOX?.trim();
  if (configured && isCodexSandboxMode(configured)) {
    return configured;
  }

  return process.platform === "win32" ? "danger-full-access" : "workspace-write";
}

export class CodexCliAdapter implements AgentAdapter {
  readonly kind = "external" as const;
  readonly id = "codex";
  readonly title = "Codex CLI";
  readonly capability = CODEX_CAPABILITY;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    if (options?.resolvedLaunchSpec) {
      const spec = options.resolvedLaunchSpec;
      if (spec.agentKind !== "codex") {
        return createPreflightResult(
          options.selection,
          this.id,
          this.title,
          this.kind,
          this.capability,
          "blocked",
          `Frozen LaunchSpec belongs to ${spec.agentKind}, not Codex.`,
          undefined,
          spec.command.executable
        );
      }
      const missingSecret = spec.environment.secretBindings.find(
        (binding) => !options.runtimeSecretValues?.[binding.secretRef]
      );
      return {
        ...createPreflightResult(
          options.selection,
          this.id,
          this.title,
          this.kind,
          this.capability,
          missingSecret ? "blocked" : "ready",
          missingSecret
            ? "The frozen Codex launch is missing its task-scoped Provider Secret."
            : "Task-ready frozen Codex launch accepted.",
          resolvedAgentRuntimeFromLaunchSpec(spec),
          spec.command.executable
        ),
        runtimeProfileId: spec.profile.id,
        launchSpecHash: spec.launchSpecHash
      };
    }
    const invocation = await resolveCodexInvocation();
    const runtimeDefaults = await resolveCodexRuntime({
      requestedConfig: options?.selection?.config,
      configSource: options?.selection?.configSource
    });
    const versionProbe = await probeInvocationVersion(invocation, process.cwd());
    const resolvedRuntime = {
      ...runtimeDefaults,
      effectiveAgentVersion: versionProbe.version,
      agentVersionSource: versionProbe.source,
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
          "CLI is installed and responds to --help.",
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
    const metadataDir = path.join(context.workspacePath, "agentarena-codex");
    const outputLastMessagePath = path.join(metadataDir, "codex-last-message.txt");
    await ensureDirectory(metadataDir);

    const prompt = buildAgentPrompt(context);
    await savePromptArtifact(prompt, context.workspacePath, context);
    const frozenSpec = context.resolvedLaunchSpec;
    if (frozenSpec && frozenSpec.agentKind !== "codex") {
      throw new Error(`Codex adapter cannot execute ${frozenSpec.agentKind} LaunchSpec ${frozenSpec.launchSpecHash}.`);
    }
    const invocation = frozenSpec
      ? {
          command: frozenSpec.command.executable,
          argsPrefix: [],
          displayCommand: frozenSpec.command.executable
        }
      : await resolveCodexInvocation();
    const executionEnvironment = frozenSpec
      ? await materializeRuntimeLaunchEnvironment(
          frozenSpec,
          context.environment,
          async (secretRef) => context.runtimeSecretValues?.[secretRef]
        )
      : {
          ...context.environment,
          ...(process.env.CODEX_HOME?.trim() ? { CODEX_HOME: process.env.CODEX_HOME.trim() } : {})
        };
    const sandboxMode = frozenSpec?.permissions.mode ?? resolveCodexSandboxMode(context.environment);
    const args = frozenSpec
      ? materializeRuntimeLaunchArguments(frozenSpec, {
          workspacePath: context.workspacePath,
          prompt,
          outputPath: outputLastMessagePath,
          sessionId: context.selection.variantId
        })
      : [
          ...invocation.argsPrefix,
          "exec",
          "--skip-git-repo-check",
          "--ephemeral",
          ...(sandboxMode === "danger-full-access"
            ? ["--dangerously-bypass-approvals-and-sandbox"]
            : ["--sandbox", sandboxMode]),
          "--cd",
          context.workspacePath,
          "--output-last-message",
          outputLastMessagePath,
          "--json"
        ];
    const resolvedRuntime = frozenSpec
      ? resolvedAgentRuntimeFromLaunchSpec(frozenSpec)
      : await resolveCodexRuntime({
          requestedConfig: context.selection.config,
          configSource: context.selection.configSource
        });
    const runtimeWithVersion = frozenSpec
      ? resolvedRuntime
      : await (async () => {
          const versionProbe = await probeInvocationVersion(invocation, context.workspacePath, executionEnvironment);
          return {
            ...resolvedRuntime,
            effectiveAgentVersion: versionProbe.version ?? resolvedRuntime.effectiveAgentVersion,
            agentVersionSource: versionProbe.source !== "unknown"
              ? versionProbe.source
              : resolvedRuntime.agentVersionSource
          };
        })();
    if (!frozenSpec) {
      let insertIndex = invocation.argsPrefix.length + 1;
      if (resolvedRuntime.effectiveReasoningEffort) {
        args.splice(insertIndex, 0, "-c", `model_reasoning_effort="${resolvedRuntime.effectiveReasoningEffort}"`);
        insertIndex += 2;
      }
      if (resolvedRuntime.effectiveModel) {
        args.splice(insertIndex, 0, "--model", resolvedRuntime.effectiveModel);
      }
    }

    await context.trace({
      type: "adapter.start",
      message: "Starting Codex CLI adapter",
      metadata: {
        command: invocation.displayCommand,
        args,
        sandboxMode,
        launchSpecHash: frozenSpec?.launchSpecHash,
        requestedConfig: context.selection.config,
        resolvedRuntime: runtimeWithVersion
      }
    });

    const activityCallbacks: RunProcessCallbacks | undefined = context.onActivity || frozenSpec
      ? {
          idleTimeoutMs: frozenSpec?.timeouts.idleMs,
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

    let execution: Awaited<ReturnType<typeof runProcess>>;
    try {
      const codexRuntimeHome = await prepareCodexRuntimeHome({
        environment: executionEnvironment,
        includeLocalAuth: frozenSpec?.runtime.providerKind !== undefined
          ? frozenSpec.runtime.providerKind === "inherited-local"
          : true
      });
      try {
        execution = await runProcess(
          invocation.command,
          args,
          context.workspacePath,
          frozenSpec?.timeouts.totalMs ?? agentTimeoutMs(),
          codexRuntimeHome.environment,
          context.signal,
          prompt,
          activityCallbacks
        );
      } finally {
        await codexRuntimeHome.cleanup();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const actionableMessage = formatAdapterError(errorMessage, "Codex CLI", "codex");
      await context.trace({
        type: "adapter.error",
        message: "Failed to execute Codex CLI",
        metadata: { error: actionableMessage }
      });
      return {
        status: "failed",
        summary: `Codex CLI execution failed: ${actionableMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime: runtimeWithVersion
      };
    }

    const parsed = parseCodexEvents(execution.stdout, context.workspacePath);
    const lastMessage = await fs.readFile(outputLastMessagePath, "utf8").catch(() => "");

    let summary: string;
    if (execution.error) {
      summary = `Codex CLI process error: ${execution.error}`;
    } else if (execution.timedOut) {
      summary = "Codex CLI timed out before producing a final message.";
    } else if (execution.exitCode !== 0 && parsed.failureMessage) {
      summary = `Codex CLI failed: ${formatAdapterError(parsed.failureMessage, "Codex CLI", "codex")}`;
    } else if (lastMessage.trim()) {
      summary = lastMessage.trim();
    } else if (parsed.summaryFromEvents) {
      summary = parsed.summaryFromEvents;
    } else if (execution.exitCode === 0) {
      summary = "Codex CLI completed without a final message.";
    } else {
      summary = `Codex CLI failed with exit code ${execution.exitCode}.`;
    }

    await context.trace({
      type: "adapter.codex.result",
      message: execution.exitCode === 0 ? "Codex CLI finished successfully" : "Codex CLI failed",
      metadata: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        signal: execution.signal,
        error: execution.error,
        cliError: execution.exitCode === 0 ? undefined : parsed.failureMessage,
        threadId: parsed.threadId,
        tokenUsage: parsed.tokenUsage,
        tokenUsageBreakdown: parsed.tokenUsageBreakdown,
        changedFilesHint: parsed.changedFilesHint,
        resolvedRuntime: parsed.resolvedRuntime ?? runtimeWithVersion,
        stderr: execution.stderr.trim()
      }
    });

    const qualityWarnings: string[] = [];
    if (parsed.formatMismatch) {
      qualityWarnings.push(
        "Codex CLI output format changed — token usage and changed-files data may be inaccurate."
      );
    }
    if (parsed.tokenCountSuspicious) {
      qualityWarnings.push(
        "Codex CLI reported turn completion with zero token usage — token counts may be inaccurate."
      );
    }
    if (parsed.missingCriticalEvents.length > 0) {
      qualityWarnings.push(
        `Codex CLI missing critical events: ${parsed.missingCriticalEvents.join(", ")} — token and cost data may be incomplete.`
      );
    }
    if (parsed.usageIncomplete) {
      qualityWarnings.push(
        "Codex CLI usage did not include a complete recognized breakdown — token and cost data are unavailable."
      );
    }
    const dataQualityWarning = qualityWarnings.length > 0 ? qualityWarnings.join(" ") : undefined;

    const executionSucceeded = execution.exitCode === 0 && !execution.error;

    return {
      status: executionSucceeded ? "success" : "failed",
      summary,
      tokenUsage: parsed.tokenUsage,
      tokenUsageBreakdown: parsed.tokenUsageBreakdown,
      estimatedCostUsd: 0,
      costKnown: false,
      // Codex CLI 0.145.0 does not report billing cost. Keep this explicit so
      // report consumers render unavailable/null instead of compatibility zero.
      costQuality: "unavailable",
      changedFilesHint: parsed.changedFilesHint,
      dataQualityWarning,
      missingCriticalEvents: parsed.missingCriticalEvents.length > 0 ? parsed.missingCriticalEvents : undefined,
      tokenUsageReliable: !executionSucceeded || dataQualityWarning ? false : undefined,
      resolvedRuntime: parsed.resolvedRuntime
        ? {
            effectiveModel: parsed.resolvedRuntime.effectiveModel ?? resolvedRuntime.effectiveModel,
            effectiveReasoningEffort:
              parsed.resolvedRuntime.effectiveReasoningEffort ?? resolvedRuntime.effectiveReasoningEffort,
            effectiveAgentVersion:
              parsed.resolvedRuntime.effectiveAgentVersion ?? runtimeWithVersion.effectiveAgentVersion,
            agentVersionSource:
              parsed.resolvedRuntime.agentVersionSource ?? runtimeWithVersion.agentVersionSource,
            ...(parsed.resolvedRuntime.effectiveModel
              ? { modelIdentitySource: "confirmed" as const }
              : runtimeWithVersion.modelIdentitySource
                ? { modelIdentitySource: runtimeWithVersion.modelIdentitySource }
                : {}),
            ...(parsed.resolvedRuntime.effectiveReasoningEffort
              ? { reasoningEffortSource: "confirmed" as const }
              : runtimeWithVersion.reasoningEffortSource
                ? { reasoningEffortSource: runtimeWithVersion.reasoningEffortSource }
                : {}),
            source: parsed.resolvedRuntime.effectiveModel || parsed.resolvedRuntime.effectiveReasoningEffort
              ? "event-stream"
              : runtimeWithVersion.source,
            verification: parsed.resolvedRuntime.effectiveModel || parsed.resolvedRuntime.effectiveReasoningEffort
              ? "confirmed"
              : runtimeWithVersion.verification,
            notes: runtimeWithVersion.notes
          }
        : runtimeWithVersion
    };
  }
}
