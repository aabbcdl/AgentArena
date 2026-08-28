import {
  isScoreMode,
  SCORE_MODES,
  type ScoreMode
} from "@agentarena/core/scoring-weights";
import type { Locale } from "../types";

export { isScoreMode, SCORE_MODES, type ScoreMode };

/** Canonical invalid-mode fallback — matches runner and enrichRunWithScores. */
export const DEFAULT_SCORE_MODE: ScoreMode = "practical";

/**
 * Normalize historical or dirty scoreMode strings so compare/history grouping
 * never treats phantom modes (correctness/speed/cost) as distinct contracts.
 */
export function normalizeScoreMode(value: unknown): ScoreMode {
  return isScoreMode(value) ? value : DEFAULT_SCORE_MODE;
}

const MODE_LABELS: Record<ScoreMode, { "zh-CN": string; en: string }> = {
  practical: {
    "zh-CN": "实用 (默认) — 正确性优先，兼顾效率",
    en: "Practical (default) — correctness first, efficiency second"
  },
  balanced: {
    "zh-CN": "平衡 — 正确性与效率并重",
    en: "Balanced — equal emphasis on correctness and efficiency"
  },
  "issue-resolution": {
    "zh-CN": "问题修复 — 强调是否真正修好问题",
    en: "Issue resolution — emphasizes whether the issue was fixed"
  },
  "efficiency-first": {
    "zh-CN": "效率优先 — 强调 token 与成本",
    en: "Efficiency first — emphasizes tokens and cost"
  },
  "rotating-tasks": {
    "zh-CN": "轮换任务 — 抑制任务熟悉度带来的分数膨胀",
    en: "Rotating tasks — reduces score inflation from task familiarity"
  },
  comprehensive: {
    "zh-CN": "综合评估 — 各维度尽量均衡",
    en: "Comprehensive — balanced signal across dimensions"
  }
};

export function labelScoreMode(locale: Locale, mode: string): string {
  const normalized = normalizeScoreMode(mode);
  return MODE_LABELS[normalized][locale === "zh-CN" ? "zh-CN" : "en"];
}
