import { promises as fs } from "node:fs";
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

/**
 * Qwen Code CLI 能力定义
 */
export const QWEN_CODE_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Qwen Code CLI headless mode with JSON output",
  authPrerequisites: ["Qwen Code CLI installed and configured with API keys."],
  tokenAvailability: "available",
  costAvailability: "available",
  traceRichness: "partial",
  configurableRuntime: { model: true, reasoningEffort: false },
  knownLimitations: [
    "Model selection requires environment configuration (QWEN_CODE_MODEL or settings file).",
    "Model parameter support depends on Qwen CLI version. Falls back to environment config if unsupported.",
    "Cost estimation based on published pricing and may vary.",
    "Output parsing depends on Qwen Code CLI JSON event compatibility."
  ]
};

/**
 * 解析 Qwen Code CLI 调用路径
 */
async function resolveQwenInvocation(): Promise<InvocationSpec> {
  // 支持环境变量覆盖
  if (process.env.AGENTARENA_QWEN_BIN?.trim()) {
    const command = process.env.AGENTARENA_QWEN_BIN.trim();
    return { command, argsPrefix: [], displayCommand: command };
  }

  // Try PATH first (works with nvm-windows, global installs, etc.)
  if (process.platform === "win32") {
    return {
      command: "qwen.cmd",
      argsPrefix: [],
      displayCommand: "qwen.cmd"
    };
  }

  return {
    command: "qwen",
    argsPrefix: [],
    displayCommand: "qwen"
  };
}

export { resolveQwenInvocation };

/**
 * 解析 Qwen Code 运行时配置
 */
async function resolveQwenRuntime(config: {
  requestedModel?: string;
  configSource?: string;
}): Promise<AgentResolvedRuntime> {
  const effectiveModel = config.requestedModel ?? process.env.QWEN_CODE_MODEL;
  const notes: string[] = [];

  if (config.requestedModel) {
    notes.push(`Model overridden via AgentArena config: ${config.requestedModel}`);
  } else if (process.env.QWEN_CODE_MODEL) {
    notes.push(`Using model from QWEN_CODE_MODEL: ${process.env.QWEN_CODE_MODEL}`);
  }

  return {
    effectiveModel,
    source: (config.configSource ?? (config.requestedModel ? "ui" : (process.env.QWEN_CODE_MODEL ? "env" : "cli-default"))) as AgentResolvedRuntime["source"],
    verification: config.requestedModel ? "inferred" : "unknown",
    notes: notes.length > 0 ? notes : ["Using Qwen Code CLI default configuration."]
  };
}

/**
 * Qwen 模型定价映射表 (每 1K tokens 的美元价格)
 */
const QWEN_PRICING: Record<string, { input: number; output: number }> = {
  "qwen-max": { input: 0.008, output: 0.012 },
  "qwen-max-latest": { input: 0.008, output: 0.012 },
  "qwen-plus": { input: 0.004, output: 0.006 },
  "qwen-plus-latest": { input: 0.004, output: 0.006 },
  "qwen-turbo": { input: 0.001, output: 0.002 },
  "qwen-turbo-latest": { input: 0.001, output: 0.002 }
};

function getModelPricing(modelName?: string): { input: number; output: number } {
  const normalized = modelName?.toLowerCase() ?? "qwen-max";
  return QWEN_PRICING[normalized] ?? QWEN_PRICING["qwen-max"];
}

/**
 * 解析 Qwen Code CLI 输出中的 token 使用统计
 */
function parseQwenOutput(
  stdout: string,
  stderr: string,
  _workspacePath: string,
  modelName?: string
): {
  tokenUsage: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  summary: string;
} {
  let tokenUsage = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;
  let summary = "";

  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Invalid JSON structure");
    }

    const jsonOutput = parsed as Record<string, unknown>;
    const stats = jsonOutput.stats;

    if (stats && typeof stats === "object" && "models" in stats) {
      const models = (stats as Record<string, unknown>).models;
      if (models && typeof models === "object") {
        for (const modelName of Object.keys(models)) {
          const modelStats = (models as Record<string, unknown>)[modelName];
          if (modelStats && typeof modelStats === "object") {
            const ms = modelStats as Record<string, unknown>;
            inputTokens += (ms.input as number) ?? (ms.prompt_tokens as number) ?? 0;
            outputTokens += (ms.output as number) ?? (ms.completion_tokens as number) ?? 0;
          }
        }
        tokenUsage = inputTokens + outputTokens;

        const pricing = getModelPricing(modelName);
        estimatedCostUsd = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
      }
    }

    // Extract summary from messages
    if (Array.isArray(jsonOutput.messages)) {
      const messages = jsonOutput.messages as Array<Record<string, unknown>>;
      // findLast not available in older ES targets, use filter + pop
      const assistantMessages = messages.filter(
        (msg) => (msg.type as string) === "assistant" || (msg.role as string) === "assistant"
      );
      const lastAssistant = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1] : undefined;
      if (lastAssistant?.content && typeof lastAssistant.content === "string") {
        summary = lastAssistant.content;
      }
    }
  } catch (_error) {
    // JSON parse failed, use fallback
    // Log JSON parse failure via trace (not console, to avoid leaking sensitive data)
    // Note: this function doesn't have access to context.trace, so we skip logging here
    // The caller (execute method) will handle logging via trace
    const lines = stdout.split("\n").filter(Boolean);
    summary = lines.slice(-5).join("\n");
  }

  if (!summary.trim()) {
    summary = stderr.trim() || "Qwen Code completed the task.";
  }

  return {
    tokenUsage,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    summary: summary.trim()
  };
}

/**
 * Qwen Code CLI Adapter
 */
export class QwenCodeAdapter implements AgentAdapter {
  readonly kind = "external" as const;
  readonly id = "qwen-code";
  readonly title = "Qwen Code CLI";
  readonly capability = QWEN_CODE_CAPABILITY;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await resolveQwenInvocation();
    const runtimeDefaults = await resolveQwenRuntime({
      requestedModel: options?.selection?.config?.model,
      configSource: options?.selection?.configSource
    });
    const versionProbe = await probeInvocationVersion(invocation, process.cwd());
    const resolvedRuntime: AgentResolvedRuntime = {
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
          "Qwen Code CLI is installed and responds to --help.",
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
        "Qwen Code CLI was found, but readiness could not be fully confirmed.",
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
    const metadataDir = path.join(context.workspacePath, "agentarena-qwen");
    const outputJsonPath = path.join(metadataDir, "qwen-output.json");
    await ensureDirectory(metadataDir);

    const prompt = buildAgentPrompt(context);
    const invocation = await resolveQwenInvocation();
    const resolvedRuntime = await resolveQwenRuntime({
      requestedModel: context.selection.config?.model,
      configSource: context.selection.configSource
    });
    const versionProbe = await probeInvocationVersion(invocation, context.workspacePath, context.environment);
    const runtimeWithVersion: AgentResolvedRuntime = {
      ...resolvedRuntime,
      effectiveAgentVersion: versionProbe.version ?? resolvedRuntime.effectiveAgentVersion,
      agentVersionSource: versionProbe.source !== "unknown"
        ? versionProbe.source
        : resolvedRuntime.agentVersionSource
    };

    // 构建 CLI 参数
    const args = [
      ...invocation.argsPrefix,
      "--prompt",
      prompt,
      "--output-format",
      "json"
    ];

    // If model is specified, try to pass it (may not be supported by all versions)
    // Note: --model flag support depends on Qwen CLI version.
    // If not supported, the CLI will use environment configuration (QWEN_CODE_MODEL).
    if (resolvedRuntime.effectiveModel) {
      args.push("--model", resolvedRuntime.effectiveModel);
    }

    await context.trace({
      type: "adapter.start",
      message: "Starting Qwen Code CLI adapter",
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
        message: "Failed to execute Qwen Code CLI",
        metadata: { error: errorMessage }
      });
      return {
        status: "failed",
        summary: `Qwen Code CLI execution failed: ${errorMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime: runtimeWithVersion
      };
    }

    // 保存原始输出用于调试
    await fs.writeFile(outputJsonPath, execution.stdout, "utf8").catch(() => {});

    // 解析 Qwen Code 输出
    const parsed = parseQwenOutput(
      execution.stdout,
      execution.stderr,
      context.workspacePath,
      resolvedRuntime.effectiveModel
    );

    // 检测变化的文件
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
      // git 不可用，忽略
    }

    let summary: string;
    if (execution.error) {
      summary = `Qwen Code CLI process error: ${execution.error}`;
    } else if (execution.timedOut) {
      summary = "Qwen Code CLI timed out before completing the task.";
    } else if (parsed.summary) {
      summary = parsed.summary;
    } else if (execution.exitCode === 0) {
      summary = "Qwen Code CLI completed the task.";
    } else {
      summary = `Qwen Code CLI failed with exit code ${execution.exitCode}.`;
    }

    await context.trace({
      type: "adapter.qwen-code.result",
      message: execution.exitCode === 0 ? "Qwen Code CLI finished successfully" : "Qwen Code CLI failed",
      metadata: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        signal: execution.signal,
        error: execution.error,
        tokenUsage: parsed.tokenUsage,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        estimatedCostUsd: parsed.estimatedCostUsd,
        changedFilesHint,
        resolvedRuntime: runtimeWithVersion,
        stderr: execution.stderr.trim()
      }
    });

    return {
      status: execution.exitCode === 0 && !execution.error ? "success" : "failed",
      summary,
      tokenUsage: parsed.tokenUsage,
      estimatedCostUsd: parsed.estimatedCostUsd,
      costKnown: true,
      changedFilesHint,
      resolvedRuntime: runtimeWithVersion
    };
  }
}
