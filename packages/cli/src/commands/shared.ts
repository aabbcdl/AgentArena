import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAvailableAdapters } from "@agentarena/adapters";
import { createAgentSelection, type ScoreMode } from "@agentarena/core";
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
  scoreMode?: ScoreMode;
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

/**
 * Registry: maps agent IDs to their config extractors.
 * Each extractor reads agent-specific CLI flags from `parsed` and returns a config object.
 * Adding a new agent adapter = adding one entry here.
 */
const AGENT_CONFIG_EXTRACTORS: Record<string, (parsed: ParsedArgs) => Record<string, string | undefined>> = {
  codex: (p) => ({
    model: p.codexModel?.trim() || undefined,
    reasoningEffort: p.codexReasoning?.trim() || undefined,
  }),
  "claude-code": (p) => ({
    model: p.claudeModel?.trim() || undefined,
    providerProfileId: p.claudeProfile?.trim() || undefined,
  }),
  "gemini-cli": (p) => ({ model: p.geminiModel?.trim() || undefined }),
  aider: (p) => ({ model: p.aiderModel?.trim() || undefined }),
  "kilo-cli": (p) => ({ model: p.kiloModel?.trim() || undefined }),
  opencode: (p) => ({ model: p.opencodeModel?.trim() || undefined }),
  "qwen-code": (p) => ({ model: p.qwenModel?.trim() || undefined }),
  copilot: (p) => ({ model: p.copilotModel?.trim() || undefined }),
};

/** Returns true if the config has at least one defined value (user specified CLI flags). */
function hasConfigValues(config: Record<string, string | undefined>): boolean {
  return Object.values(config).some((v) => v !== undefined);
}

export function normalizeCliSelections(
  parsed: ParsedArgs,
): import("@agentarena/core").AgentSelection[] {
  return parsed.agentIds.map((agentId) => {
    const adapter = listAvailableAdapters().find((entry) => entry.id === agentId);
    const extractor = AGENT_CONFIG_EXTRACTORS[agentId];
    const config = extractor ? extractor(parsed) : {};

    return createAgentSelection({
      baseAgentId: agentId,
      displayLabel: adapter?.title ?? agentId,
      config,
      configSource: hasConfigValues(config) ? "cli" : undefined,
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

/**
 * Map UiRunStatus (the live in-memory shape with optional `result`) into the
 * persisted UiRunState shape. Replaces unsafe `as import("@agentarena/core").UiRunState`
 * casts at multiple callsites — those would silently bypass any future drift between
 * the two interfaces. The `result` blob is intentionally dropped because the
 * persisted state file should stay small.
 */
export function toUiRunState(status: UiRunStatus): import("@agentarena/core").UiRunState {
  // Phase narrowing: UiRunStatus.phase includes "starting"|"preflight"|"report"
  // which UiRunState.phase also accepts; the union is compatible at runtime
  // but TS doesn't always infer through the `|` alias, so we narrow explicitly.
  const phase: import("@agentarena/core").UiRunPhase =
    status.phase === "idle" || status.phase === "starting" ||
    status.phase === "preflight" || status.phase === "benchmark" ||
    status.phase === "report" ? status.phase : "idle";

  return {
    state: status.state,
    phase,
    logs: status.logs.map((l) => ({
      timestamp: l.timestamp,
      phase: l.phase as import("@agentarena/core").UiRunPhase,
      message: l.message,
      ...(l.agentId !== undefined ? { agentId: l.agentId } : {}),
      ...(l.variantId !== undefined ? { variantId: l.variantId } : {}),
      ...(l.displayLabel !== undefined ? { displayLabel: l.displayLabel } : {}),
    })),
    updatedAt: status.updatedAt,
    ...(status.startedAt !== undefined ? { startedAt: status.startedAt } : {}),
    ...(status.repoPath !== undefined ? { repoPath: status.repoPath } : {}),
    ...(status.taskPath !== undefined ? { taskPath: status.taskPath } : {}),
    ...(status.runId !== undefined ? { runId: status.runId } : {}),
    ...(status.outputPath !== undefined ? { outputPath: status.outputPath } : {}),
    ...(status.currentAgentId !== undefined ? { currentAgentId: status.currentAgentId } : {}),
    ...(status.currentVariantId !== undefined ? { currentVariantId: status.currentVariantId } : {}),
    ...(status.currentDisplayLabel !== undefined ? { currentDisplayLabel: status.currentDisplayLabel } : {}),
    ...(status.error !== undefined ? { error: status.error } : {}),
  };
}

/** Inverse of toUiRunState — rebuild a UiRunStatus from persisted state. */
export function fromUiRunState(state: import("@agentarena/core").UiRunState): UiRunStatus {
  return {
    state: state.state,
    phase: state.phase,
    logs: state.logs.map((l) => ({
      timestamp: l.timestamp,
      phase: l.phase as UiRunPhase,
      message: l.message,
      ...(l.agentId !== undefined ? { agentId: l.agentId } : {}),
      ...(l.variantId !== undefined ? { variantId: l.variantId } : {}),
      ...(l.displayLabel !== undefined ? { displayLabel: l.displayLabel } : {}),
    })),
    updatedAt: state.updatedAt,
    ...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
    ...(state.repoPath !== undefined ? { repoPath: state.repoPath } : {}),
    ...(state.taskPath !== undefined ? { taskPath: state.taskPath } : {}),
    ...(state.runId !== undefined ? { runId: state.runId } : {}),
    ...(state.outputPath !== undefined ? { outputPath: state.outputPath } : {}),
    ...(state.currentAgentId !== undefined ? { currentAgentId: state.currentAgentId } : {}),
    ...(state.currentVariantId !== undefined ? { currentVariantId: state.currentVariantId } : {}),
    ...(state.currentDisplayLabel !== undefined ? { currentDisplayLabel: state.currentDisplayLabel } : {}),
    ...(state.error !== undefined ? { error: state.error } : {}),
  };
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
  console.log("\n🎉 Welcome to AgentArena! / 欢迎使用 AgentArena！");
  console.log("");
  console.log("Quick start / 快速开始：");
  console.log("  agentarena doctor             Check environment / 检查环境配置");
  console.log("  agentarena list-adapters      See available adapters / 查看可用适配器");
  console.log("  agentarena ui                 Start web UI / 启动 Web 界面");
  console.log("  agentarena run --help         Run a benchmark / 运行基准测试");
  console.log("");
  console.log("First time? Install an adapter first:");
  console.log("  npm install -g @openai/codex@latest    (for Codex)");
  console.log("  npm install -g @anthropic-ai/claude-code  (for Claude Code)");
  console.log("  Then run: agentarena doctor --probe-auth");
  console.log("");
}
