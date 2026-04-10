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

export const AUGMENT_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Augment Code CLI headless mode",
  authPrerequisites: ["Augment CLI installed and authenticated with an API key."],
  tokenAvailability: "available",
  costAvailability: "unavailable",
  traceRichness: "partial",
  configurableRuntime: {
    model: true,
    reasoningEffort: false
  },
  knownLimitations: [
    "Augment CLI output format may change across releases.",
    "Token usage is best-effort and depends on JSON event compatibility.",
    "Changed files are inferred from workspace diff."
  ]
};

async function resolveAugmentInvocation(): Promise<InvocationSpec> {
  const configured = process.env.AGENTARENA_AUGMENT_BIN?.trim();
  if (configured) {
    return { command: configured, argsPrefix: [], displayCommand: configured };
  }

  if (process.platform === "win32") {
    return { command: "augment.cmd", argsPrefix: [], displayCommand: "augment.cmd" };
  }

  return { command: "augment", argsPrefix: [], displayCommand: "augment" };
}

function resolveAugmentRuntime(config: {
  requestedModel?: string;
  configSource?: string;
}): AgentResolvedRuntime {
  const effectiveModel = config.requestedModel ?? process.env.AGENTARENA_AUGMENT_MODEL?.trim();
  const notes: string[] = [];

  if (config.requestedModel) {
    notes.push(`Model overridden via AgentArena config: ${config.requestedModel}`);
  } else if (effectiveModel) {
    notes.push(`Using model from AGENTARENA_AUGMENT_MODEL: ${effectiveModel}`);
  } else {
    notes.push("Using Augment CLI default configuration.");
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

function parseAugmentOutput(stdout: string): {
  tokenUsage: number;
  summary: string;
  changedFiles: string[];
} {
  let tokenUsage = 0;
  let summary = "";
  let changedFiles: string[] = [];

  const lines = stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        summary = parsed.summary.trim();
      }
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        summary = parsed.message.trim();
      }
      if (typeof parsed.token_usage === "number") {
        tokenUsage = parsed.token_usage;
      }
      if (typeof parsed.tokens === "number") {
        tokenUsage = parsed.tokens;
      }
      if (Array.isArray(parsed.changed_files)) {
        changedFiles = parsed.changed_files.filter((value): value is string => typeof value === "string");
      }
      if (Array.isArray(parsed.files_changed)) {
        changedFiles = parsed.files_changed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }

  return {
    tokenUsage,
    summary,
    changedFiles
  };
}

export { resolveAugmentInvocation };

export class AugmentAdapter implements AgentAdapter {
  readonly kind = "external" as const;
  readonly id = "augment";
  readonly title = "Augment Code";
  readonly capability = AUGMENT_CAPABILITY;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await resolveAugmentInvocation();
    const runtimeDefaults = resolveAugmentRuntime({
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
          "Augment CLI is installed and responds to --help.",
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
    const invocation = await resolveAugmentInvocation();
    const resolvedRuntime = resolveAugmentRuntime({
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

    const args = [...invocation.argsPrefix, "code", "--headless"];
    if (runtimeWithVersion.effectiveModel) {
      args.push("--model", runtimeWithVersion.effectiveModel);
    }
    args.push("--", prompt);

    await context.trace({
      type: "adapter.start",
      message: "Starting Augment Code adapter",
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
        message: "Failed to execute Augment Code CLI",
        metadata: { error: errorMessage }
      });
      return {
        status: "failed",
        summary: `Augment Code execution failed: ${errorMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime: runtimeWithVersion
      };
    }

    const parsed = parseAugmentOutput(execution.stdout);
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
        ? parsed.summary || "Augment Code completed the task."
        : parsed.summary || execution.stderr.trim() || `Augment Code failed with exit code ${execution.exitCode}.`;

    await context.trace({
      type: "adapter.augment.result",
      message: execution.exitCode === 0 ? "Augment Code finished" : "Augment Code failed",
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
