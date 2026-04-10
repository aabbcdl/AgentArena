import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type AdapterExecutionContext,
  type AdapterExecutionResult,
  type AdapterPreflightOptions,
  type AdapterPreflightResult,
  type AgentAdapter,
  ensureDirectory
} from "@agentarena/core";
import { parseCodexEvents } from "./event-parsers.js";
import { agentTimeoutMs, runProcess } from "./process-utils.js";
import {
  buildAgentPrompt,
  CODEX_CAPABILITY,
  createPreflightResult,
  type InvocationSpec,
  probeHelp,
  probeInvocationVersion,
  resolveCodexRuntime
} from "./shared.js";

async function resolveCodexInvocation(): Promise<InvocationSpec> {
  if (process.env.AGENTARENA_CODEX_BIN?.trim()) {
    const command = process.env.AGENTARENA_CODEX_BIN.trim();
    return { command, argsPrefix: [], displayCommand: command };
  }

  if (process.platform === "win32") {
    const scriptPath = path.join(
      process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? "", "AppData", "Roaming"),
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js"
    );

    try {
      await fs.access(scriptPath);
      return {
        command: process.execPath,
        argsPrefix: [scriptPath],
        displayCommand: `${process.execPath} ${scriptPath}`
      };
    } catch {
      return {
        command: "codex.cmd",
        argsPrefix: [],
        displayCommand: "codex.cmd"
      };
    }
  }

  return {
    command: "codex",
    argsPrefix: [],
    displayCommand: "codex"
  };
}

export { resolveCodexInvocation };

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
    const metadataDir = path.join(context.workspacePath, "agentarena-demo");
    const outputLastMessagePath = path.join(metadataDir, "codex-last-message.txt");
    await ensureDirectory(metadataDir);

    const prompt = buildAgentPrompt(context);
    const invocation = await resolveCodexInvocation();
    const args = [
      ...invocation.argsPrefix,
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "workspace-write",
      "--cd",
      context.workspacePath,
      "--output-last-message",
      outputLastMessagePath,
      "--json",
      prompt
    ];
    const resolvedRuntime = await resolveCodexRuntime({
      requestedConfig: context.selection.config,
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
    if (resolvedRuntime.effectiveReasoningEffort) {
      args.splice(
        invocation.argsPrefix.length + 1,
        0,
        "-c",
        `model_reasoning_effort="${resolvedRuntime.effectiveReasoningEffort}"`
      );
    }
    if (resolvedRuntime.effectiveModel) {
      args.splice(invocation.argsPrefix.length + 1, 0, "--model", resolvedRuntime.effectiveModel);
    }

    await context.trace({
      type: "adapter.start",
      message: "Starting Codex CLI adapter",
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
        message: "Failed to execute Codex CLI",
        metadata: { error: errorMessage }
      });
      return {
        status: "failed",
        summary: `Codex CLI execution failed: ${errorMessage}`,
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

    return {
      status: execution.exitCode === 0 && !execution.error ? "success" : "failed",
      summary,
      tokenUsage: parsed.tokenUsage,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFilesHint: parsed.changedFilesHint,
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
