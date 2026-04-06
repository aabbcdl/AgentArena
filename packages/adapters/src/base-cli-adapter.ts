import path from "node:path";
import {
  type AdapterExecutionContext,
  type AdapterExecutionResult,
  type AdapterPreflightOptions,
  type AdapterPreflightResult,
  type AgentAdapter,
  type AgentResolvedRuntime,
  type AdapterCapability
} from "@repoarena/core";
import { agentTimeoutMs, runProcess } from "./process-utils.js";
import {
  buildAgentPrompt,
  createPreflightResult,
  type InvocationSpec,
  probeHelp,
  probeInvocationVersion
} from "./shared.js";

/**
 * Configuration for creating a CLI-based agent adapter.
 */
export interface CliAdapterConfig {
  /** Unique adapter ID (e.g. "qwen-code", "copilot") */
  id: string;
  /** Display name (e.g. "Qwen Code CLI") */
  title: string;
  /** CLI command name (e.g. "qwen", "copilot") */
  command: string;
  /** CLI arguments for headless execution (e.g. ["--prompt", "--output-format", "json"]) */
  commandArgs: string[];
  /** Capability metadata for this adapter */
  capability: AdapterCapability;
  /** Environment variable for custom binary path (e.g. "REPOARENA_QWEN_BIN") */
  binEnvVar?: string;
  /** Extract token usage from stdout (returns 0 if not parseable) */
  parseTokenUsage?: (stdout: string) => number;
  /** Extract summary from stdout */
  parseSummary?: (stdout: string, stderr: string, exitCode: number | null) => string;
  /** Additional args to append (e.g. model selection) */
  extraArgs?: (runtime: AgentResolvedRuntime) => string[];
}

/**
 * Create a CLI-based agent adapter from configuration.
 * 
 * This factory eliminates ~500 lines of repetitive code across
 * qwen-adapter.ts, copilot-adapter.ts, and similar adapters.
 */
export function createCliAdapter(config: CliAdapterConfig): AgentAdapter {
  return new BaseCliAdapterImpl(config);
}

class BaseCliAdapterImpl implements AgentAdapter {
  readonly kind = "external" as const;
  
  constructor(private readonly config: CliAdapterConfig) {}

  get id(): string { return this.config.id; }
  get title(): string { return this.config.title; }
  get capability(): AdapterCapability { return this.config.capability; }

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await this.resolveInvocation();
    const versionProbe = await probeInvocationVersion(invocation, process.cwd());
    const resolvedRuntime = {
      effectiveAgentVersion: versionProbe.version,
      agentVersionSource: versionProbe.source !== "unknown" ? versionProbe.source : undefined,
      source: "cli-default" as const,
      verification: "inferred" as const,
      notes: versionProbe.note ? [versionProbe.note] : []
    };

    try {
      const result = await probeHelp(invocation, process.cwd());
      if (result.timedOut) {
        return createPreflightResult(options?.selection, this.id, this.title, this.kind, this.capability,
          "blocked", "CLI help probe timed out.", resolvedRuntime, invocation.displayCommand, [result.stderr.trim()].filter(Boolean));
      }
      if (result.error) {
        return createPreflightResult(options?.selection, this.id, this.title, this.kind, this.capability,
          "missing", "CLI could not be launched.", resolvedRuntime, invocation.displayCommand, [result.error]);
      }
      if (result.exitCode === 0) {
        return createPreflightResult(options?.selection, this.id, this.title, this.kind, this.capability,
          "ready", `${this.title} is installed and responds to --help.`, resolvedRuntime, invocation.displayCommand);
      }
      return createPreflightResult(options?.selection, this.id, this.title, this.kind, this.capability,
        "unverified", "CLI found, but readiness could not be fully confirmed.", resolvedRuntime, invocation.displayCommand, [result.stderr.trim()].filter(Boolean));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createPreflightResult(options?.selection, this.id, this.title, this.kind, this.capability,
        "missing", "CLI could not be launched.", resolvedRuntime, invocation.displayCommand, [message]);
    }
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const invocation = await this.resolveInvocation();
    const prompt = buildAgentPrompt(context);
    const runtime = await this.resolveRuntime(context);

    const args = [
      ...invocation.argsPrefix,
      ...this.config.commandArgs,
      prompt,
      ...(this.config.extraArgs?.(runtime) ?? [])
    ];

    await context.trace({
      type: "adapter.start",
      message: `Starting ${this.title} adapter`,
      metadata: { command: invocation.displayCommand, args }
    });

    let execution: Awaited<ReturnType<typeof runProcess>>;
    try {
      execution = await runProcess(invocation.command, args, context.workspacePath, agentTimeoutMs(), context.environment, context.signal);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await context.trace({ type: "adapter.error", message: `Failed to execute ${this.title}`, metadata: { error: errorMessage } });
      return { status: "failed", summary: `${this.title} execution failed: ${errorMessage}`, tokenUsage: 0, estimatedCostUsd: 0, costKnown: false, changedFilesHint: [], resolvedRuntime: runtime };
    }

    const tokenUsage = this.config.parseTokenUsage?.(execution.stdout) ?? 0;
    const summary = this.config.parseSummary
      ? this.config.parseSummary(execution.stdout, execution.stderr, execution.exitCode)
      : execution.stdout.trim() || `${this.title} completed the task.`;

    // Detect changed files via git
    const changedFilesHint: string[] = [];
    try {
      const { execSync } = await import("node:child_process");
      const gitDiff = execSync("git diff --name-only", { cwd: context.workspacePath, encoding: "utf8" }).trim();
      if (gitDiff) changedFilesHint.push(...gitDiff.split("\n").filter(Boolean));
    } catch { /* git not available */ }

    await context.trace({
      type: "adapter.finish",
      message: execution.exitCode === 0 && !execution.error ? `${this.title} finished` : `${this.title} failed`,
      metadata: { exitCode: execution.exitCode, tokenUsage, changedFilesHint }
    });

    return {
      status: execution.exitCode === 0 && !execution.error ? "success" : "failed",
      summary,
      tokenUsage,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFilesHint,
      resolvedRuntime: runtime
    };
  }

  private async resolveInvocation(): Promise<InvocationSpec> {
    const { binEnvVar, command } = this.config;
    if (binEnvVar && process.env[binEnvVar]?.trim()) {
      const cmd = process.env[binEnvVar]!.trim();
      return { command: cmd, argsPrefix: [], displayCommand: cmd };
    }
    if (process.platform === "win32") {
      return { command: `${command}.cmd`, argsPrefix: [], displayCommand: `${command}.cmd` };
    }
    return { command, argsPrefix: [], displayCommand: command };
  }

  private async resolveRuntime(context: AdapterExecutionContext): Promise<AgentResolvedRuntime> {
    const invocation = await this.resolveInvocation();
    const versionProbe = await probeInvocationVersion(invocation, context.workspacePath, context.environment);
    return {
      effectiveModel: context.selection.config?.model,
      effectiveAgentVersion: versionProbe.version,
      agentVersionSource: versionProbe.source !== "unknown" ? versionProbe.source : undefined,
      source: (context.selection.configSource ?? "cli-default") as AgentResolvedRuntime["source"],
      verification: "inferred",
      notes: []
    };
  }
}
