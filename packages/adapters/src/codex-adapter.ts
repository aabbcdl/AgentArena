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
import { parseCodexEvents } from "./event-parsers.js";
import { probeHelp, probeInvocationVersion } from "./invocation-probes.js";
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
    const invocation = await resolveCodexInvocation();
    const activeCodexHome = process.env.CODEX_HOME?.trim();
    const executionEnvironment = {
      ...context.environment,
      ...(activeCodexHome ? { CODEX_HOME: activeCodexHome } : {})
    };
    const sandboxMode = resolveCodexSandboxMode(context.environment);
    const args = [
      ...invocation.argsPrefix,
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      // Respect the resolved sandbox mode instead of always running yolo.
      // Only `danger-full-access` bypasses the seatbelt sandbox and approval
      // prompts; every other mode keeps the sandbox enabled for safer runs.
      ...(sandboxMode === "danger-full-access"
        ? ["--dangerously-bypass-approvals-and-sandbox"]
        : ["--sandbox", sandboxMode]),
      "--cd",
      context.workspacePath,
      "--output-last-message",
      outputLastMessagePath,
      "--json",
    ];
    const resolvedRuntime = await resolveCodexRuntime({
      requestedConfig: context.selection.config,
      configSource: context.selection.configSource
    });
    const versionProbe = await probeInvocationVersion(invocation, context.workspacePath, executionEnvironment);
    const runtimeWithVersion = {
      ...resolvedRuntime,
      effectiveAgentVersion: versionProbe.version ?? resolvedRuntime.effectiveAgentVersion,
      agentVersionSource: versionProbe.source !== "unknown"
        ? versionProbe.source
        : resolvedRuntime.agentVersionSource
    };
    let insertIndex = invocation.argsPrefix.length + 1;
    if (resolvedRuntime.effectiveReasoningEffort) {
      args.splice(insertIndex, 0, "-c", `model_reasoning_effort="${resolvedRuntime.effectiveReasoningEffort}"`);
      insertIndex += 2;
    }
    if (resolvedRuntime.effectiveModel) {
      args.splice(insertIndex, 0, "--model", resolvedRuntime.effectiveModel);
    }

    await context.trace({
      type: "adapter.start",
      message: "Starting Codex CLI adapter",
      metadata: {
        command: invocation.displayCommand,
        args,
        sandboxMode, // Configured sandbox mode (actual execution uses --dangerously-bypass-approvals-and-sandbox)
        requestedConfig: context.selection.config,
        resolvedRuntime: runtimeWithVersion
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

    let execution: Awaited<ReturnType<typeof runProcess>>;
    try {
      execution = await runProcess(
        invocation.command,
        args,
        context.workspacePath,
        agentTimeoutMs(),
        executionEnvironment,
        context.signal,
        prompt,
        activityCallbacks
      );
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
        threadId: parsed.threadId,
        tokenUsage: parsed.tokenUsage,
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
    const dataQualityWarning = qualityWarnings.length > 0 ? qualityWarnings.join(" ") : undefined;

    const hasMissingCritical = parsed.missingCriticalEvents.length > 0;

    return {
      status: execution.exitCode === 0 && !execution.error ? "success" : "failed",
      summary,
      tokenUsage: parsed.tokenUsage,
      estimatedCostUsd: 0,
      costKnown: false,
      costQuality: hasMissingCritical ? "unavailable" : undefined,
      changedFilesHint: parsed.changedFilesHint,
      dataQualityWarning,
      missingCriticalEvents: parsed.missingCriticalEvents.length > 0 ? parsed.missingCriticalEvents : undefined,
      tokenUsageReliable: dataQualityWarning ? false : undefined,
      resolvedRuntime: parsed.resolvedRuntime
        ? {
            effectiveModel: parsed.resolvedRuntime.effectiveModel ?? resolvedRuntime.effectiveModel,
            effectiveReasoningEffort:
              parsed.resolvedRuntime.effectiveReasoningEffort ?? resolvedRuntime.effectiveReasoningEffort,
            effectiveAgentVersion:
              parsed.resolvedRuntime.effectiveAgentVersion ?? runtimeWithVersion.effectiveAgentVersion,
            agentVersionSource:
              parsed.resolvedRuntime.agentVersionSource ?? runtimeWithVersion.agentVersionSource,
            source: "event-stream",
            verification: "confirmed",
            notes: runtimeWithVersion.notes
          }
        : runtimeWithVersion
    };
  }
}
