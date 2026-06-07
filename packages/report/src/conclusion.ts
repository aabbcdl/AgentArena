/**
 * One-line conclusion generator for benchmark runs.
 *
 * Takes a scored run and produces a human-readable conclusion
 * that directly answers "what should I pick?" or "what went wrong?".
 */

import type { ScoredRun } from "./report-helpers.js";

export interface RunConclusion {
  /** Short verdict line (1 sentence) */
  verdict: string;
  /** Longer explanation (2-3 sentences) */
  explanation: string;
  /** Actionable next step */
  nextStep: string;
  /** Classification */
  category: "all-failed" | "partial-success" | "single-success" | "multi-success";
}

/**
 * Generate a one-line conclusion from a scored run.
 * This is the "decision card" that answers the user's core question.
 */
export function generateConclusion(run: ScoredRun, language: "en" | "zh-CN" = "en"): RunConclusion {
  const results = run.results;
  const successResults = results.filter(r => r.status === "success");
  const failedResults = results.filter(r => r.status !== "success");

  // All failed
  if (successResults.length === 0) {
    return generateAllFailedConclusion(failedResults, language);
  }

  // Single agent, succeeded
  if (results.length === 1 && successResults.length === 1) {
    return generateSingleSuccessConclusion(successResults[0], language);
  }

  // Multiple agents, some succeeded
  if (successResults.length > 0 && failedResults.length > 0) {
    return generatePartialSuccessConclusion(successResults, failedResults, language);
  }

  // All succeeded
  return generateMultiSuccessConclusion(successResults, language);
}

function generateAllFailedConclusion(
  failedResults: ScoredRun["results"],
  language: "en" | "zh-CN"
): RunConclusion {
  // Find the most common failure reason
  const errorCounts = new Map<string, number>();
  for (const r of failedResults) {
    const error = r.summary || r.status || "unknown";
    errorCounts.set(error, (errorCounts.get(error) ?? 0) + 1);
  }
  const sortedEntries = [...errorCounts.entries()].sort((a: [string, number], b: [string, number]) => b[1] - a[1]);
  const mostCommonError = sortedEntries[0]?.[0] ?? "unknown";

  const isTimeout = mostCommonError.toLowerCase().includes("timeout") || mostCommonError.toLowerCase().includes("timed out");
  const isAuth = mostCommonError.toLowerCase().includes("auth") || mostCommonError.toLowerCase().includes("probe");

  if (language === "zh-CN") {
    const reason = isTimeout ? "鉴权探测超时" : isAuth ? "鉴权失败" : "运行失败";
    return {
      verdict: `本轮无有效结果——全部 ${failedResults.length} 个 Agent ${reason}`,
      explanation: `所有 Agent 均未能完成任务。最常见的问题是：${mostCommonError}。`,
      nextStep: isTimeout
        ? "建议：确认 Agent 服务正在运行，或关闭「运行前先探测鉴权」后重试。"
        : isAuth
          ? "建议：检查 API Key 配置，或在 Provider 编辑弹窗中验证凭据。"
          : "建议：查看下方失败详情，确认 Agent 配置是否正确。",
      category: "all-failed"
    };
  }

  const reason = isTimeout ? "authentication probe timed out" : isAuth ? "authentication failed" : "failed";
  return {
    verdict: `No valid results — all ${failedResults.length} agent(s) ${reason}`,
    explanation: `All agents failed to complete the task. Most common issue: ${mostCommonError}.`,
    nextStep: isTimeout
      ? "Try: confirm the agent service is running, or disable 'Probe auth before run' and retry."
      : isAuth
        ? "Try: check your API key configuration or verify credentials in the provider editor."
        : "Try: review the failure details below to verify your agent configuration.",
    category: "all-failed"
  };
}

function generateSingleSuccessConclusion(
  result: ScoredRun["results"][number],
  language: "en" | "zh-CN"
): RunConclusion {
  const score = result.compositeScore?.toFixed(0) ?? "?";
  const passRate = result.judgeResults.length > 0
    ? `${result.judgeResults.filter((j) => j.success).length}/${result.judgeResults.length}`
    : "N/A";
  const duration = result.durationMs ? formatDurationShort(result.durationMs) : "N/A";

  if (language === "zh-CN") {
    return {
      verdict: `${result.displayLabel || result.agentId} 完成任务，综合分 ${score}`,
      explanation: `通过率 ${passRate}，耗时 ${duration}。单 Agent 基线测试通过。`,
      nextStep: "再加一个 Agent 跑一次，即可解锁对比功能，看到谁更强。",
      category: "single-success"
    };
  }

  return {
    verdict: `${result.displayLabel || result.agentId} completed the task — score ${score}`,
    explanation: `Pass rate ${passRate}, duration ${duration}. Single-agent baseline test passed.`,
    nextStep: "Add another agent to unlock comparison and see which setup performs better.",
    category: "single-success"
  };
}

function generatePartialSuccessConclusion(
  successResults: ScoredRun["results"],
  failedResults: ScoredRun["results"],
  language: "en" | "zh-CN"
): RunConclusion {
  const best = [...successResults].sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0))[0];
  const score = best.compositeScore?.toFixed(0) ?? "?";
  const failedNames = failedResults.map(r => r.displayLabel || r.agentId).join(", ");

  if (language === "zh-CN") {
    return {
      verdict: `${best.displayLabel || best.agentId} 综合最优（${score} 分），${failedResults.length} 个 Agent 失败`,
      explanation: `${successResults.length} 个 Agent 成功完成任务，${failedResults.length} 个失败（${failedNames}）。`,
      nextStep: `推荐使用 ${best.displayLabel || best.agentId}。失败的 Agent 需要检查配置。`,
      category: "partial-success"
    };
  }

  return {
    verdict: `${best.displayLabel || best.agentId} is the top performer (${score}), ${failedResults.length} agent(s) failed`,
    explanation: `${successResults.length} agent(s) succeeded, ${failedResults.length} failed (${failedNames}).`,
    nextStep: `Recommend using ${best.displayLabel || best.agentId}. Failed agents need configuration review.`,
    category: "partial-success"
  };
}

function generateMultiSuccessConclusion(
  successResults: ScoredRun["results"],
  language: "en" | "zh-CN"
): RunConclusion {
  const sorted = [...successResults].sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
  const best = sorted[0];
  const second = sorted[1];
  const scoreDiff = second ? ((best.compositeScore ?? 0) - (second.compositeScore ?? 0)).toFixed(0) : "0";

  if (language === "zh-CN") {
    const comparison = second
      ? `领先第二名 ${second.displayLabel || second.agentId} ${scoreDiff} 分`
      : "";
    return {
      verdict: `${best.displayLabel || best.agentId} 综合最优（${best.compositeScore?.toFixed(0)} 分）${comparison ? `，${comparison}` : ""}`,
      explanation: `${successResults.length} 个 Agent 全部成功完成任务。`,
      nextStep: `推荐使用 ${best.displayLabel || best.agentId}。可切换评分预设查看不同权重下的排名变化。`,
      category: "multi-success"
    };
  }

  const comparison = second
    ? `leading ${second.displayLabel || second.agentId} by ${scoreDiff} points`
    : "";
  return {
    verdict: `${best.displayLabel || best.agentId} is the top performer (${best.compositeScore?.toFixed(0)})${comparison ? `, ${comparison}` : ""}`,
    explanation: `All ${successResults.length} agents completed the task successfully.`,
    nextStep: `Recommend using ${best.displayLabel || best.agentId}. Switch score presets to see how rankings change with different priorities.`,
    category: "multi-success"
  };
}

function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
