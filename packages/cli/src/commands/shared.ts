import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAvailableAdapters } from "@agentarena/adapters";
import { createAgentSelection } from "@agentarena/core";
import type { Locale as ReportLocale, writeReport } from "@agentarena/report";
import type { BenchmarkProgressEvent } from "@agentarena/runner";
import type { ParsedArgs } from "../args.js";

export const CLI_PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
export const WORKSPACE_ROOT = path.resolve(CLI_PACKAGE_ROOT, "..", "..");
export const OFFICIAL_TASKPACK_ROOT = path.join(
  WORKSPACE_ROOT,
  "examples",
  "taskpacks",
  "official"
);

export interface UiRunPayload {
  repoPath: string;
  taskPath: string;
  agents?: Array<{
    baseAgentId: string;
    variantId?: string;
    displayLabel?: string;
    config?: {
      model?: string;
      reasoningEffort?: string;
      providerProfileId?: string;
    };
    configSource?: "ui" | "cli";
  }>;
  agentIds?: string[];
  outputPath?: string;
  probeAuth?: boolean;
  updateSnapshots?: boolean;
  cleanupWorkspaces?: boolean;
  maxConcurrency?: number;
  scoreMode?: string;
  tokenBudget?: number;
}

export interface ParsedTaskPackMetadataFile {
  metadata?: {
    i18n?: unknown;
  };
}

export interface ParsedAdhocTaskPackFile {
  id?: unknown;
  title?: unknown;
  prompt?: unknown;
}

export function resolveReportLocale(value?: string): ReportLocale {
  return value === "zh-CN" ? "zh-CN" : "en";
}

export function normalizeCliSelections(
  parsed: ParsedArgs,
): import("@agentarena/core").AgentSelection[] {
  return parsed.agentIds.map((agentId) => {
    const adapter = listAvailableAdapters().find((entry) => entry.id === agentId);
    const config =
      agentId === "codex"
        ? {
            model: parsed.codexModel?.trim() || undefined,
            reasoningEffort: parsed.codexReasoning?.trim() || undefined,
          }
        : agentId === "claude-code"
          ? {
              model: parsed.claudeModel?.trim() || undefined,
              providerProfileId: parsed.claudeProfile?.trim() || undefined,
            }
          : agentId === "gemini-cli"
            ? { model: parsed.geminiModel?.trim() || undefined }
            : agentId === "aider"
              ? { model: parsed.aiderModel?.trim() || undefined }
              : agentId === "kilo-cli"
                ? { model: parsed.kiloModel?.trim() || undefined }
                : agentId === "opencode"
                  ? { model: parsed.opencodeModel?.trim() || undefined }
                  : agentId === "qwen-code"
                    ? { model: parsed.qwenModel?.trim() || undefined }
                    : agentId === "copilot"
                      ? { model: parsed.copilotModel?.trim() || undefined }
                      : {};

    return createAgentSelection({
      baseAgentId: agentId,
      displayLabel: adapter?.title ?? agentId,
      config,
      configSource:
        (agentId === "codex" && (config.model || config.reasoningEffort)) ||
        (agentId === "claude-code" &&
          (config.model || config.providerProfileId)) ||
        (agentId === "gemini-cli" && config.model) ||
        (agentId === "aider" && config.model) ||
        (agentId === "kilo-cli" && config.model) ||
        (agentId === "opencode" && config.model) ||
        (agentId === "qwen-code" && config.model) ||
        (agentId === "copilot" && config.model)
          ? "cli"
          : undefined,
    });
  });
}

export function normalizeUiSelections(payload: UiRunPayload): import("@agentarena/core").AgentSelection[] {
  if (payload.agents && payload.agents.length > 0) {
    return payload.agents.map((agent) =>
      createAgentSelection({
        baseAgentId: agent.baseAgentId,
        displayLabel: agent.displayLabel,
        config: agent.config,
        configSource: agent.configSource ?? "ui",
      }),
    );
  }

  return (payload.agentIds ?? []).map((agentId) =>
    createAgentSelection({
      baseAgentId: agentId,
      displayLabel:
        listAvailableAdapters().find((entry) => entry.id === agentId)?.title ??
        agentId,
    }),
  );
}

export type UiRunPhase =
  | BenchmarkProgressEvent["phase"]
  | "idle"
  | "benchmark";

export interface UiRunLogEntry {
  timestamp: string;
  phase: UiRunPhase;
  message: string;
  agentId?: string;
  variantId?: string;
  displayLabel?: string;
}

export interface UiRunStatus {
  state: "idle" | "running" | "done" | "error" | "cancelled" | "cancelling";
  phase: UiRunPhase | "starting" | "preflight" | "report";
  logs: UiRunLogEntry[];
  updatedAt: string;
  startedAt?: string;
  repoPath?: string;
  taskPath?: string;
  runId?: string;
  outputPath?: string;
  currentAgentId?: string;
  currentVariantId?: string;
  currentDisplayLabel?: string;
  result?: {
    run: unknown;
    markdown: string;
    report: Awaited<ReturnType<typeof writeReport>>;
  };
  error?: string;
}

export function getTierEmoji(tier: string): string {
  switch (tier) {
    case "supported":
      return "✅";
    case "experimental":
      return "⚠️";
    case "blocked":
      return "❌";
    default:
      return "❓";
  }
}

export function getAvailabilityEmoji(availability: string): string {
  switch (availability) {
    case "available":
      return "✅";
    case "estimated":
      return "≈";
    case "unavailable":
      return "❌";
    default:
      return "❓";
  }
}

interface GroupedItem<T> {
  tier: string;
  emoji: string;
  label: string;
  items: T[];
}

export function groupByTier<T extends { capability: { supportTier: string } }>(
  items: T[],
): GroupedItem<T>[] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const tier = item.capability.supportTier;
    if (!groups.has(tier)) {
      groups.set(tier, []);
    }
    groups.get(tier)?.push(item);
  }

  const tierOrder = ["supported", "experimental", "blocked"];
  const tierLabels = new Map([
    ["supported", "Supported Adapters"],
    ["experimental", "Experimental Adapters"],
    ["blocked", "Blocked Adapters"],
  ]);

  return tierOrder
    .filter((tier) => groups.has(tier))
    .map((tier) => ({
      tier,
      emoji: getTierEmoji(tier),
      label: tierLabels.get(tier) || `${tier} Adapters`,
      items: groups.get(tier) ?? [],
    }));
}

export async function hasAvailableAdapters(): Promise<boolean> {
  const adapters = listAvailableAdapters().filter((a) => a.kind !== "demo");
  if (adapters.length === 0) {
    return false;
  }
  for (const adapter of adapters) {
    try {
      const preflight = await adapter.preflight({ probeAuth: false });
      if (preflight.status !== "missing") {
        return true;
      }
    } catch {
      // continue
    }
  }
  return false;
}

export function showWelcomeMessage(): void {
  console.log("\n🎉 欢迎使用 AgentArena！");
  console.log("");
  console.log("快速开始：");
  console.log("  agentarena doctor    - 检查环境配置");
  console.log("  agentarena ui        - 启动 Web 界面");
  console.log("  agentarena run       - 开始基准测试");
  console.log("");
}
