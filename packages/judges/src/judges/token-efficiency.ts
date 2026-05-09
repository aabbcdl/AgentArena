import type { JudgeResult, TokenEfficiencyJudge } from "@agentarena/core";

export async function runTokenEfficiencyJudge(
  judge: TokenEfficiencyJudge,
  tokenUsage: number | undefined,
  tokenBudget: number | undefined
): Promise<JudgeResult> {
  const startedAt = Date.now();
  const effectiveBudget = tokenBudget ?? judge.tokenBudget;

  if (tokenUsage === undefined || tokenUsage === null) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "token-efficiency",
      target: "tokenUsage",
      expectation: effectiveBudget ? `budget=${effectiveBudget}` : "no budget",
      exitCode: 1,
      success: false,
      stdout: "Token usage data not available.",
      stderr: "",
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  }

  let efficiencyScore: number;
  let success: boolean;
  let exitCode: number;
  let stdoutMessage: string;
  let stderrMessage: string;

  if (effectiveBudget && effectiveBudget > 0) {
    if (tokenUsage <= effectiveBudget) {
      const usageRatio = tokenUsage / effectiveBudget;
      efficiencyScore = 0.8 + (0.2 * (1 - usageRatio));
    } else {
      efficiencyScore = Math.max(0, effectiveBudget / tokenUsage);
    }
    success = tokenUsage <= effectiveBudget;
    exitCode = success ? 0 : 1;
    stdoutMessage = `Token efficiency: ${(efficiencyScore * 100).toFixed(1)}% (${tokenUsage} tokens / ${effectiveBudget} budget)`;
    stderrMessage = success
      ? ""
      : `Token usage (${tokenUsage}) exceeded budget (${effectiveBudget}). Over by ${tokenUsage - effectiveBudget} tokens.`;
  } else {
    efficiencyScore = 0.5;
    success = true;
    exitCode = 0;
    stdoutMessage = `Token usage: ${tokenUsage}. No budget configured (neutral score: 0.5).`;
    stderrMessage = "";
  }

  return {
    judgeId: judge.id,
    label: judge.label,
    type: "token-efficiency",
    target: "tokenUsage",
    expectation: effectiveBudget ? `budget=${effectiveBudget}` : "no budget",
    exitCode,
    success,
    stdout: stdoutMessage,
    stderr: stderrMessage,
    durationMs: Date.now() - startedAt,
    critical: judge.critical ?? false
  };
}
