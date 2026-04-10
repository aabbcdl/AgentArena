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

export const TRAE_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Trae CLI headless mode",
  authPrerequisites: ["Trae CLI installed and authenticated."],
  tokenAvailability: "available",
  costAvailability: "unavailable",
  traceRichness: "partial",
  configurableRuntime: {
    model: true,
    reasoningEffort: false
  },
  knownLimitations: [
    "Trae CLI output format may change across releases.",
    "Token usage is best-effort and depends on JSON event compatibility.",
    "Changed files are inferred from workspace diff."
  ]
};

async function resolveTraeInvocation(): Promise<InvocationSpec> {
  const configured = process.env.AGENTARENA_TRAE_BIN?.trim();
  if (configured) {
    return { command: configured, argsPrefix: [], displayCommand: configured };
  }

  if (process.platform === "win32") {
    return { command: "trae.cmd", argsPrefix: [], displayCommand: "trae.cmd" };
  }

  return { command: "trae", argsPrefix: [], displayCommand: "trae" };
}

function resolveTraeRuntime(config: {
  requestedModel?: string;
  configSource?: string;
}): AgentResolvedRuntime {
  const effectiveModel = config.requestedModel ?? process.env.AGENTARENA_TRAE_MODEL?.trim();
  const notes: string[] = [];

  if (config.requestedModel) {
    notes.push(`Model overridden via AgentArena config: ${config.requestedModel}`);
  } else if (effectiveModel) {
    notes.push(`Using model from AGENTARENA_TRAE_MODEL: ${effectiveModel}`);
  } else {
    notes.push("Using Trae CLI default configuration.");
  }

  return {
    effectiveModel,
    source: (config.configSource ??
      (config.requestedModel
        ? "ui"
        : effectiveModel
          ? "env"
          : "cli-default")) as AgentResolvedRuntime["source"],
    verification: effectiveModel ? "inferred" : "unknown",
    notes
  };
}

function parseTraeOutput(stdout: string): {
  tokenUsage: number;
  summary: string;
  changedFiles: string[];
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let summary = "";
  let changedFiles: string[] = [];

  const lines = stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type === "usage") {
        if (typeof parsed.input_tokens === "number") inputTokens = parsed.input_tokens;
        if (typeof parsed.output_tokens === "number") outputTokens = parsed.output_tokens;
      }
      if (parsed.type === "files_changed" && Array.isArray(parsed.files)) {
        changedFiles = parsed.files.filter((value): value is string => typeof value === "string");
      }
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        summary = parsed.summary.trim();
      }
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        summary = parsed.message.trim();
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }

  return {
    tokenUsage: inputTokens + outputTokens,
    summary,
    changedFiles
  };
}

export { resolveTraeInvocation };

export class TraeAdapter implements AgentAdapter {
  readonly kind = "external" as const;
  readonly id = "trae";
  readonly title = "Trae";
  readonly capability = TRAE_CAPABILITY;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await resolveTraeInvocation();
    const runtimeDefaults = resolveTraeRuntime({
      requestedModel: options?.selection?.config?.model,
      configSource: options?.selection?.configSource
    });
    const versionProbe = await probeInvocationVersion(invocation, process.cwd());
    const resolvedRuntime: AgentResolvedRuntime = {
      ...runtimeDefaults,
      effectiveAgentVersion: versionProbe.version ?? runtimeDefaults.effectiveAgentVersion,
      agentVersionSource:
        versionProbe.source !== "unknown" ? versionProbe.source : runtimeDefaults.agentVersionSource,
      notes: [...(runtimeDefaults.notes ?? []), ...(versionProbe.note ? [versionProbe.note] : [])]
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
          "Trae CLI is installed and responds to --help.",
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
        "CLI found, but readiness could not be fully confirmed.",
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
    const prompt = buildAgentPrompt(context);
    const invocation = await resolveTraeInvocation();
    const resolvedRuntime = resolveTraeRuntime({
      requestedModel: context.selection.config?.model,
      configSource: context.selection.configSource
    });
    const versionProbe = await probeInvocationVersion(invocation, context.workspacePath, context.environment);
    const runtimeWithVersion: AgentResolvedRuntime = {
      ...resolvedRuntime,
      effectiveAgentVersion: versionProbe.version ?? resolvedRuntime.effectiveAgentVersion,
      agentVersionSource:
        versionProbe.source !== "unknown" ? versionProbe.source : resolvedRuntime.agentVersionSource,
      notes: [...(resolvedRuntime.notes ?? []), ...(versionProbe.note ? [versionProbe.note] : [])]
    };

    const args = [...invocation.argsPrefix, "--headless", "--output-format", "json", prompt];
    const environment = {
      ...context.environment,
      ...(runtimeWithVersion.effectiveModel ? { TRAE_MODEL: runtimeWithVersion.effectiveModel } : {})
    };

    await context.trace({
      type: "adapter.start",
      message: "Starting Trae adapter",
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
        environment,
        context.signal
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await context.trace({
        type: "adapter.error",
        message: "Failed to execute Trae CLI",
        metadata: { error: errorMessage }
      });
      return {
        status: "failed",
        summary: `Trae execution failed: ${errorMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime: runtimeWithVersion
      };
    }

    const parsed = parseTraeOutput(execution.stdout);
    const changedFilesHint: string[] = [...parsed.changedFiles];

    if (changedFilesHint.length === 0) {
      try {
        const { execSync } = await import("node:child_process");
        const gitDiff = execSync("git diff --name-only", {
          cwd: context.workspacePath,
          encoding: "utf8"
        }).trim();
        if (gitDiff) {
          changedFilesHint.push(...gitDiff.split("\n").filter(Boolean));
        }
      } catch {
        // Ignore git diff failures.
      }
    }

    const summary =
      execution.exitCode === 0 && !execution.error
        ? parsed.summary || "Trae completed the task."
        : parsed.summary || execution.stderr.trim() || `Trae failed with exit code ${execution.exitCode}.`;

    await context.trace({
      type: "adapter.trae.result",
      message: execution.exitCode === 0 ? "Trae finished" : "Trae failed",
      metadata: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        error: execution.error,
        tokenUsage: parsed.tokenUsage,
        changedFilesHint,
        stderr: execution.stderr.trim()
      }
    });

    return {
      status: execution.exitCode === 0 && !execution.error ? "success" : "failed",
      summary,
      tokenUsage: parsed.tokenUsage,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFilesHint,
      resolvedRuntime: runtimeWithVersion
    };
  }
}
