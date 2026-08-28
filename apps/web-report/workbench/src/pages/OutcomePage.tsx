import { EmptyState, formatCost, formatDuration, Icon, Metric, Notice, PageHeader, Section, StatusPill, t } from "../components/ui";
import { labelExecution, labelTaskDifficulty, labelTrustReason, taskDifficultyTone } from "../domain/labels";
import { assessResultEvidence, formatTokenCount, runtimeEvidence, runtimeText, taskDifficulty } from "../domain/result-insights";
import { deriveRunOutcome } from "../domain/run";
import { useWorkbench } from "../hooks/useWorkbench";

function evidenceLabel(locale: "zh-CN" | "en", level: ReturnType<typeof assessResultEvidence>["level"]): string {
  const labels = locale === "zh-CN"
    ? { strong: "证据强", adequate: "基本可信", limited: "证据有限", insufficient: "证据不足" }
    : { strong: "Strong evidence", adequate: "Adequate evidence", limited: "Limited evidence", insufficient: "Insufficient evidence" };
  return labels[level];
}

function evidenceTone(level: ReturnType<typeof assessResultEvidence>["level"]): "success" | "info" | "warning" | "danger" {
  if (level === "strong") return "success";
  if (level === "adequate") return "info";
  if (level === "limited") return "warning";
  return "danger";
}

function runtimeEvidenceTone(value: ReturnType<typeof runtimeEvidence>): "success" | "info" | "warning" {
  if (value === "confirmed") return "success";
  if (value === "unknown") return "warning";
  return "info";
}

function tokenBreakdownText(
  locale: "zh-CN" | "en",
  breakdown: { inputTokens: number; outputTokens: number; reasoningTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
): string {
  const labels = locale === "zh-CN"
    ? { input: "输入", output: "输出", reasoning: "推理", cacheRead: "缓存读", cacheWrite: "缓存写" }
    : { input: "in", output: "out", reasoning: "reasoning", cacheRead: "cache read", cacheWrite: "cache write" };
  const parts = [
    `${labels.input} ${formatTokenCount(breakdown.inputTokens)}`,
    `${labels.output} ${formatTokenCount(breakdown.outputTokens)}`
  ];
  if (breakdown.reasoningTokens > 0) parts.push(`${labels.reasoning} ${formatTokenCount(breakdown.reasoningTokens)}`);
  if (breakdown.cacheReadTokens > 0) parts.push(`${labels.cacheRead} ${formatTokenCount(breakdown.cacheReadTokens)}`);
  if (breakdown.cacheWriteTokens > 0) parts.push(`${labels.cacheWrite} ${formatTokenCount(breakdown.cacheWriteTokens)}`);
  return parts.join(" · ");
}

function evidenceReason(locale: "zh-CN" | "en", reason: string): string {
  const labels: Record<string, [string, string]> = {
    "easy-task": ["任务难度为 easy，不能代表复杂工程能力", "The task is easy and does not represent complex engineering ability"],
    "single-sample": ["只有一个样本，没有横向对比基线", "Only one sample was run; there is no comparison baseline"],
    "model-unknown": ["CLI 没有返回实际模型名，不能确认模型身份", "The CLI did not return the effective model identity"],
    "cost-unavailable": ["CLI 没有提供可核验成本", "The CLI did not provide a verifiable cost"],
    "tokens-unreliable": ["Token 计数被标记为不可靠", "Token counting was marked unreliable"],
    "trace-missing": ["Trace 不完整，复核证据受限", "The trace is incomplete, limiting review"],
    "basic-generated-checks": ["这是自定义任务的通用仓库检查，只能提供基础证据", "This custom task uses generic repository checks and provides basic evidence only"],
    "no-judges": ["没有结构化 Judge，不能确认任务完成", "No structured judges were run"],
    "not-qualified": ["结果未通过完整的执行/验证门槛", "The result did not pass the execution and validation gates"]
  };
  return labels[reason]?.[locale === "zh-CN" ? 0 : 1] ?? reason;
}

function runtimeEvidenceLabel(locale: "zh-CN" | "en", value: ReturnType<typeof runtimeEvidence>): string {
  const labels = locale === "zh-CN"
    ? { confirmed: "已确认", declared: "配置声明", inferred: "推断", unknown: "未返回" }
    : { confirmed: "Confirmed", declared: "Declared", inferred: "Inferred", unknown: "Not returned" };
  return labels[value];
}

function scoreComponentLabel(locale: "zh-CN" | "en", key: string): string {
  const labels: Record<string, [string, string]> = {
    status: ["执行状态", "Execution"],
    tests: ["测试", "Tests"],
    criticalJudges: ["关键 Judge", "Critical judges"],
    nonCriticalJudges: ["非关键 Judge", "Non-critical judges"],
    precision: ["改动精度", "Change precision"],
    lint: ["Lint", "Lint"],
    duration: ["耗时效率", "Duration efficiency"],
    cost: ["成本效率", "Cost efficiency"],
    tokenEfficiency: ["Token 效率", "Token efficiency"]
  };
  return labels[key]?.[locale === "zh-CN" ? 0 : 1] ?? key;
}

export function OutcomePage() {
  const { locale, selectedRun, setPage, setSelectedAgentId, preparePlanFromRun } = useWorkbench();
  if (!selectedRun) {
    return <><PageHeader eyebrow="OUTCOME" title={t(locale, "outcome")} /><EmptyState icon="outcome" title={locale === "zh-CN" ? "没有可解释的结果" : "No outcome to interpret"} message={t(locale, "noRunsHint")} actions={<button class="button primary" type="button" onClick={() => setPage("runs")}>{t(locale, "runs")}</button>} /></>;
  }

  const outcome = deriveRunOutcome(selectedRun);
  const failures = outcome.failedResults;
  const summaryOnly = selectedRun.raw.summaryOnly === true;
  const singleRun = selectedRun.results.length === 1;
  const winner = summaryOnly || singleRun ? null : outcome.winner;
  const difficulty = taskDifficulty(selectedRun);
  const primaryResult = winner ?? selectedRun.results[0];
  const primaryEvidence = primaryResult ? assessResultEvidence(selectedRun, primaryResult) : { level: "insufficient" as const, reasons: ["no-judges"], comparable: false };
  const passedJudges = selectedRun.results.reduce((sum, item) => sum + item.judgeResults.filter((judge) => judge.success).length, 0);
  const totalJudges = selectedRun.results.reduce((sum, item) => sum + item.judgeResults.length, 0);

  return (
    <>
      <PageHeader eyebrow="OUTCOME" title={selectedRun.task.title} description={locale === "zh-CN" ? "先看执行、分数构成和证据强度，再决定是否值得比较。" : "Read execution, score composition, and evidence strength before making a comparison."} actions={<><button class="button secondary" type="button" onClick={() => preparePlanFromRun(selectedRun)}><Icon name="refresh" />{locale === "zh-CN" ? "复用配置" : "Reuse config"}</button><button class="button secondary" type="button" onClick={() => setPage("evidence")}><Icon name="evidence" />{t(locale, "evidence")}</button></>} />
      {selectedRun.source.kind === "demo" && <Notice kind="info">{locale === "zh-CN" ? "这是模拟结果，不代表真实 Agent 表现。" : "This is simulated data and does not represent real agent performance."}</Notice>}
      {selectedRun.integrity === "damaged" && <Notice kind="danger">{locale === "zh-CN" ? "结果数据已损坏，不能生成可靠排名。" : "The result is damaged. No reliable ranking is generated."}</Notice>}
      {singleRun && !summaryOnly && <Notice kind="info">{locale === "zh-CN"
        ? "本次只运行了一个配置：可以判断任务是否通过，但不会生成模型能力排名。要比较模型，请为同一任务配置两个明确的模型/思考强度。"
        : "Only one configuration ran: this can establish whether the task passed, but it does not produce a model ranking. Configure two explicit model/reasoning profiles for the same task to compare them."}</Notice>}

      <div class="outcome-hero">
        <div class="outcome-summary">
          <div class="eyebrow">{t(locale, "result")}</div>
          <div class={`outcome-symbol evaluation-${outcome.evaluation}`}><Icon name={outcome.evaluation === "pass" ? "check" : outcome.evaluation === "fail" ? "danger" : "warning"} size={30} /></div>
          <h2>{outcome.evaluation === "pass" && primaryEvidence.level !== "strong" ? (locale === "zh-CN" ? "通过，但证据有限" : "Pass, with limited evidence") : t(locale, outcome.evaluation)}</h2>
          <p>{singleRun && outcome.evaluation === "pass" ? (locale === "zh-CN" ? "本次配置已通过任务验证；这是任务结果，不是模型能力排名。" : "This configuration passed task validation; it is a task result, not a model capability ranking.") : outcome.evaluation === "pass" ? (locale === "zh-CN" ? "Judge 通过说明任务契约满足；证据强度决定这次结果能否代表模型能力。" : "Passing judges means the task contract was met; evidence strength tells you how far this result can support a capability claim.") : outcome.evaluation === "partial" ? (locale === "zh-CN" ? "只有部分 Agent 通过验证。" : "Only some agents passed validation.") : outcome.evaluation === "fail" ? (locale === "zh-CN" ? "没有 Agent 达到本次验证门槛。" : "No agent reached the evaluation threshold.") : (locale === "zh-CN" ? "当前数据不足以给出安全结论。" : "There is not enough data for a safe conclusion.")}</p>
          <div class="outcome-tags"><StatusPill tone={difficulty ? taskDifficultyTone(difficulty) : "neutral"}>{difficulty ? labelTaskDifficulty(locale, difficulty) : (locale === "zh-CN" ? "未标注难度" : "Difficulty not set")}</StatusPill><StatusPill tone={evidenceTone(primaryEvidence.level)}>{evidenceLabel(locale, primaryEvidence.level)}</StatusPill></div>
        </div>
        <div class="outcome-metrics">
          <Metric label={t(locale, "execution")} value={<StatusPill tone={outcome.execution === "completed" ? "success" : "warning"}>{labelExecution(locale, outcome.execution)}</StatusPill>} />
          <Metric label={t(locale, "trust")} value={<StatusPill tone={selectedRun.integrity === "complete" ? "success" : selectedRun.integrity === "damaged" ? "danger" : "warning"}>{t(locale, selectedRun.integrity)}</StatusPill>} />
          <Metric label={t(locale, "qualifiedCount")} value={`${outcome.qualifiedResults.length} / ${selectedRun.results.length}`} />
          <Metric label={locale === "zh-CN" ? "Judge 通过" : "Judge pass"} value={totalJudges > 0 ? `${passedJudges}/${totalJudges}` : "n/a"} />
        </div>
      </div>

      <Section title={locale === "zh-CN" ? "这次结论有多可信" : "How much confidence to place in this result"} description={locale === "zh-CN" ? "通过、分数和证据强度是三个不同维度。" : "Pass status, score, and evidence strength answer different questions."} className="evidence-strength-section">
        <div class="evidence-strength-grid"><div class={`evidence-strength-callout evidence-${primaryEvidence.level}`}><StatusPill tone={evidenceTone(primaryEvidence.level)}>{evidenceLabel(locale, primaryEvidence.level)}</StatusPill><strong>{primaryResult?.displayLabel ?? (locale === "zh-CN" ? "无结果" : "No result")}</strong><span>{primaryEvidence.comparable ? (locale === "zh-CN" ? "可以参与同一任务的横向比较" : "Eligible for same-task comparison") : (locale === "zh-CN" ? "当前不应被当作模型能力排名" : "Should not be treated as a model capability ranking")}</span></div><div class="evidence-reason-list">{primaryEvidence.reasons.length === 0 ? <div class="trust-row"><Icon name="check" /><span>{locale === "zh-CN" ? "运行、Judge、Trace 和身份信息完整。" : "Execution, judges, trace, and identity evidence are complete."}</span></div> : primaryEvidence.reasons.map((reason) => <div class="trust-row" key={reason}><Icon name="warning" /><span>{evidenceReason(locale, reason)}</span></div>)}</div></div>
      </Section>

      {failures.length > 0 && <Section title={t(locale, "failureFirst")} description={locale === "zh-CN" ? "先看失败原因，再看排名。" : "Failure reasons come before ranking."}><div class="failure-list">{failures.map((item) => { const raw = item.failureReason ?? item.judgeResults.find((judge) => !judge.success)?.message ?? item.summary; return <button type="button" class="failure-row" key={item.variantId} onClick={() => { setSelectedAgentId(item.variantId); setPage("evidence"); }}><span class="failure-icon"><Icon name="danger" /></span><div><strong>{item.displayLabel}</strong><span>{raw || (locale === "zh-CN" ? "未达到验证门槛" : "Did not meet the evaluation threshold")}</span></div><Icon name="chevron" /></button>; })}</div></Section>}

      <Section title={locale === "zh-CN" ? "模型、思考强度与消耗" : "Model, reasoning, and usage"} description={locale === "zh-CN" ? "模型未返回时明确显示未知；成本未知不会显示为 $0。" : "Unknown model identities stay unknown; unavailable cost is never rendered as $0."}>
        <div class="results-table runtime-results-table"><table><caption class="visually-hidden">{locale === "zh-CN" ? "运行指标" : "Runtime metrics"}</caption><thead><tr><th scope="col">{t(locale, "agent")}</th><th scope="col">{locale === "zh-CN" ? "模型 / 思考" : "Model / reasoning"}</th><th scope="col">{locale === "zh-CN" ? "身份证据" : "Identity evidence"}</th><th scope="col">Provider</th><th scope="col">{locale === "zh-CN" ? "Token" : "Tokens"}</th><th scope="col">{locale === "zh-CN" ? "成本" : "Cost"}</th><th scope="col">{t(locale, "duration")}</th></tr></thead><tbody>{selectedRun.results.map((item) => { const model = runtimeText(item, "effectiveModel"); const reasoning = runtimeText(item, "effectiveReasoningEffort"); const evidence = runtimeEvidence(item, "model"); const provider = runtimeText(item, "providerProfileName") ?? runtimeText(item, "providerKind") ?? (item.baseAgentId === "codex" ? (locale === "zh-CN" ? "继承当前本地配置" : "Inherited local setup") : "n/a"); const breakdown = item.tokenUsageBreakdown; return <tr key={item.variantId}><td data-label={t(locale, "agent")}><button type="button" class="result-agent-button" onClick={() => { setSelectedAgentId(item.variantId); setPage("evidence"); }}><span class="agent-avatar"><Icon name="agent" /></span><span><strong>{item.displayLabel}</strong><small>{item.baseAgentId} · {runtimeText(item, "effectiveAgentVersion") ?? "version n/a"}</small></span></button></td><td data-label={locale === "zh-CN" ? "模型 / 思考" : "Model / reasoning"}><span class="runtime-cell-main">{model ?? (locale === "zh-CN" ? "CLI 未返回" : "CLI did not return")}</span><small class="runtime-cell-sub">{reasoning ?? (locale === "zh-CN" ? "思考强度未返回" : "Reasoning not returned")}</small></td><td data-label={locale === "zh-CN" ? "身份证据" : "Identity evidence"}><StatusPill tone={runtimeEvidenceTone(evidence)}>{runtimeEvidenceLabel(locale, evidence)}</StatusPill></td><td data-label="Provider"><span class="runtime-cell-main">{provider}</span></td><td class="number-cell" data-label={locale === "zh-CN" ? "Token" : "Tokens"}><span>{formatTokenCount(item.tokenUsage)}</span>{breakdown && <small class="runtime-cell-sub">{tokenBreakdownText(locale, breakdown)}</small>}</td><td class="number-cell" data-label={locale === "zh-CN" ? "成本" : "Cost"}>{formatCost(item.estimatedCostUsd, locale, item.costQuality)}</td><td class="number-cell" data-label={t(locale, "duration")}>{formatDuration(item.durationMs, locale)}</td></tr>; })}</tbody></table></div>
      </Section>

      <Section title={locale === "zh-CN" ? "分数为什么是这个数" : "Why this score"} description={locale === "zh-CN" ? "分数是当前任务和权重下的合成值，不是模型能力的绝对分。" : "The score is a composite for this task and weighting preset, not an absolute capability score."}>
        <div class="score-explanation-grid">{selectedRun.results.map((item) => <div class="score-explanation" key={item.variantId}><div class="score-explanation-head"><strong>{item.displayLabel}</strong><b>{item.compositeScore === null ? "n/a" : `${item.compositeScore.toFixed(1)} / 100`}</b></div><div class="score-component-list">{Object.entries(item.scoreComponents).length === 0 ? <span class="muted-line">{locale === "zh-CN" ? "没有保存分数组件" : "Score components were not stored"}</span> : Object.entries(item.scoreComponents).map(([key, value]) => <div key={key}><span>{scoreComponentLabel(locale, key)}</span><strong>{(value * 100).toFixed(0)}%</strong></div>)}</div>{item.scoreReasons.length > 0 && <small class="score-reasons">{item.scoreReasons.join(" · ")}</small>}</div>)}</div>
      </Section>

      <div class="two-column outcome-columns"><Section title={summaryOnly ? t(locale, "noCapabilityWinner") : singleRun ? t(locale, "noWinner") : winner ? t(locale, "qualifiedWinner") : t(locale, "noWinner")} className="winner-section">{summaryOnly ? <Notice kind="warning">{t(locale, "summaryOnlyEvidence")}</Notice> : singleRun ? <Notice kind="info">{locale === "zh-CN" ? "只有一个运行配置，本次不生成 winner。请把两个明确模型配置放在同一任务和仓库基线上再比较。" : "One configuration ran, so no winner is generated. Compare two explicit model profiles on the same task and repository baseline."}</Notice> : winner ? <div class="winner-card"><div class="winner-mark"><Icon name="check" size={24} /></div><div><span>{winner.displayLabel}</span><strong>{winner.compositeScore === null ? t(locale, "unknown") : winner.compositeScore.toFixed(1)}</strong><small>{primaryEvidence.comparable ? (locale === "zh-CN" ? "同一任务内的合格结果比较" : "Compared within qualified results") : (locale === "zh-CN" ? "当前没有足够的可比证据" : "Not enough comparable evidence")}</small></div></div> : <Notice kind="warning">{locale === "zh-CN" ? "没有结果同时满足执行和验证门槛。" : "No result passed both execution and validation gates."}</Notice>}</Section><Section title={t(locale, "trust")} description={locale === "zh-CN" ? "未知值不会被当成零。" : "Unknown values are never treated as zero."}><div class="trust-reasons">{selectedRun.integrityReasons.length === 0 ? <div class="trust-row"><Icon name="check" /><span>{locale === "zh-CN" ? "核心证据完整。" : "Core evidence is complete."}</span></div> : selectedRun.integrityReasons.map((reason) => <div class="trust-row" key={reason}><Icon name={reason.includes("invalid") || reason.includes("failed") ? "danger" : "warning"} /><span>{labelTrustReason(locale, reason)}</span></div>)}</div></Section></div>

      <Section title={locale === "zh-CN" ? "可比性边界" : "Comparison boundary"} description={locale === "zh-CN" ? "只有同一任务、同一基线、同一 Judge 和已知身份才适合横向比较。" : "Cross-harness comparison requires the same task, baseline, judges, and known runtime identity."}><dl class="basis-list"><div><dt>{locale === "zh-CN" ? "任务难度" : "Task difficulty"}</dt><dd>{difficulty ? labelTaskDifficulty(locale, difficulty) : t(locale, "unknown")}</dd></div><div><dt>{t(locale, "scoreMode")}</dt><dd>{selectedRun.scoreMode}</dd></div><div><dt>{locale === "zh-CN" ? "任务版本" : "Task schema"}</dt><dd>{selectedRun.task.schemaVersion ?? t(locale, "unknown")}</dd></div><div><dt>{locale === "zh-CN" ? "仓库基线" : "Repository baseline"}</dt><dd>{selectedRun.repository.revision ?? t(locale, "unknown")}</dd></div><div><dt>{locale === "zh-CN" ? "运行 ID" : "Run ID"}</dt><dd><code>{selectedRun.runId}</code></dd></div></dl></Section>
    </>
  );
}
