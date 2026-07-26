import { EmptyState, formatCost, formatDuration, Icon, Metric, Notice, PageHeader, Section, StatusPill, t } from "../components/ui";
import { labelExecution, labelTrustReason } from "../domain/labels";
import { deriveRunOutcome } from "../domain/run";
import { useWorkbench } from "../hooks/useWorkbench";

export function OutcomePage() {
  const { locale, selectedRun, setPage, setSelectedAgentId } = useWorkbench();
  if (!selectedRun) {
    return (
      <>
        <PageHeader eyebrow="OUTCOME" title={t(locale, "outcome")} />
        <EmptyState
          icon="outcome"
          title={locale === "zh-CN" ? "没有可解释的结果" : "No outcome to interpret"}
          message={t(locale, "noRunsHint")}
          actions={<button class="button primary" type="button" onClick={() => setPage("runs")}>{t(locale, "runs")}</button>}
        />
      </>
    );
  }

  const outcome = deriveRunOutcome(selectedRun);
  const failures = outcome.failedResults;
  const winner = outcome.winner;

  return (
    <>
      <PageHeader
        eyebrow="OUTCOME"
        title={selectedRun.task.title}
        description={locale === "zh-CN" ? "先看执行和评测结论，再查看分数和证据。" : "Read execution and evaluation first, then scores and evidence."}
        actions={<button class="button secondary" type="button" onClick={() => setPage("evidence")}><Icon name="evidence" />{t(locale, "evidence")}</button>}
      />
      {selectedRun.source.kind === "demo" && (
        <Notice kind="info">{locale === "zh-CN" ? "这是模拟结果，不代表任何真实 Agent 表现。" : "This is simulated data and does not represent real agent performance."}</Notice>
      )}
      {selectedRun.integrity === "damaged" && (
        <Notice kind="danger">{locale === "zh-CN" ? "结果已经损坏，页面不会生成排名。" : "The result is damaged. No ranking is generated."}</Notice>
      )}

      <div class="outcome-hero">
        <div class="outcome-summary">
          <div class="eyebrow">{t(locale, "result")}</div>
          <div class={`outcome-symbol evaluation-${outcome.evaluation}`}>
            <Icon name={outcome.evaluation === "pass" ? "check" : outcome.evaluation === "fail" ? "danger" : "warning"} size={30} />
          </div>
          <h2>{t(locale, outcome.evaluation)}</h2>
          <p>
            {outcome.evaluation === "pass"
              ? (locale === "zh-CN" ? "所有参赛结果都达到本次评测门槛。" : "All participant results met this evaluation threshold.")
              : outcome.evaluation === "partial"
                ? (locale === "zh-CN" ? "只有部分 Agent 达到本次评测门槛。" : "Only some agents met this evaluation threshold.")
                : outcome.evaluation === "fail"
                  ? (locale === "zh-CN" ? "没有 Agent 达到本次评测门槛。" : "No agent met this evaluation threshold.")
                  : (locale === "zh-CN" ? "当前数据不足以生成安全结论。" : "There is not enough data for a safe conclusion.")}
          </p>
        </div>
        <div class="outcome-metrics">
          <Metric
            label={t(locale, "execution")}
            value={<StatusPill tone={outcome.execution === "completed" ? "success" : "warning"}>{labelExecution(locale, outcome.execution)}</StatusPill>}
          />
          <Metric
            label={t(locale, "trust")}
            value={<StatusPill tone={selectedRun.integrity === "complete" ? "success" : selectedRun.integrity === "damaged" ? "danger" : "warning"}>{t(locale, selectedRun.integrity)}</StatusPill>}
          />
          <Metric label={t(locale, "qualifiedCount")} value={`${outcome.qualifiedResults.length} / ${selectedRun.results.length}`} />
        </div>
      </div>

      {failures.length > 0 && (
        <Section title={t(locale, "failureFirst")} description={locale === "zh-CN" ? "失败和不合格原因优先于排名显示。" : "Failure and disqualification reasons appear before ranking."}>
          <div class="failure-list">
            {failures.map((item) => {
              const raw = item.failureReason ?? item.judgeResults.find((judge) => !judge.success)?.message ?? item.summary;
              const fallback = locale === "zh-CN" ? "未达到评测门槛" : "Did not meet the evaluation threshold";
              return (
                <button type="button" class="failure-row" onClick={() => { setSelectedAgentId(item.variantId); setPage("evidence"); }}>
                  <span class="failure-icon"><Icon name="danger" /></span>
                  <div>
                    <strong>{item.displayLabel}</strong>
                    <span>{raw || fallback}</span>
                    {raw && /[A-Za-z]{4,}/.test(raw) && locale === "zh-CN" ? <small class="raw-output-hint">{t(locale, "rawOutputLabel")}</small> : null}
                  </div>
                  <Icon name="chevron" />
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <div class="two-column outcome-columns">
        <Section title={winner ? t(locale, "qualifiedWinner") : t(locale, "noWinner")} className="winner-section">
          {winner ? (
            <div class="winner-card">
              <div class="winner-mark"><Icon name="check" size={24} /></div>
              <div>
                <span>{winner.displayLabel}</span>
                <strong>{winner.compositeScore === null ? t(locale, "unknown") : winner.compositeScore.toFixed(1)}</strong>
                <small>{locale === "zh-CN" ? "只在本次合格结果内比较" : "Compared only within qualified results"}</small>
              </div>
            </div>
          ) : (
            <Notice kind={outcome.evaluation === "incomplete" ? "warning" : "danger"}>
              {locale === "zh-CN" ? "没有结果满足通过门槛，因此不显示冠军、奖牌或推荐。" : "No result passed the threshold, so no winner, medal, or recommendation is shown."}
            </Notice>
          )}
        </Section>
        <Section title={t(locale, "trust")} description={locale === "zh-CN" ? "未知和缺失值不会被当成零。" : "Unknown and missing values are never treated as zero."}>
          <div class="trust-reasons">
            {outcome.trust.reasons.length === 0 ? (
              <div class="trust-row"><Icon name="check" /><span>{locale === "zh-CN" ? "核心证据完整。" : "Core evidence is complete."}</span></div>
            ) : (
              outcome.trust.reasons.map((reason) => (
                <div class="trust-row">
                  <Icon name={reason.includes("invalid") || reason.includes("failed") ? "danger" : "warning"} />
                  <span>{labelTrustReason(locale, reason)}</span>
                </div>
              ))
            )}
          </div>
        </Section>
      </div>

      <Section title={locale === "zh-CN" ? "Agent 结果" : "Agent results"} description={locale === "zh-CN" ? "失败结果保留事实，但不参与合格排名。" : "Failed results remain visible but do not join the qualified ranking."}>
        <div class="results-table">
          <table>
            <caption class="visually-hidden">{locale === "zh-CN" ? "Agent 结果" : "Agent results"}</caption>
            <thead>
              <tr class="results-head">
                <th scope="col">{t(locale, "agent")}</th>
                <th scope="col">{t(locale, "status")}</th>
                <th scope="col">{t(locale, "score")}</th>
                <th scope="col">{t(locale, "duration")}</th>
                <th scope="col">{t(locale, "cost")}</th>
                <th scope="col">{t(locale, "judges")}</th>
              </tr>
            </thead>
            <tbody>
              {selectedRun.results.map((item) => {
                const passed = item.judgeResults.filter((judge) => judge.success).length;
                const qualified = outcome.qualifiedResults.includes(item);
                return (
                  <tr class="results-row">
                    <td>
                      <button type="button" class="result-agent-button" onClick={() => { setSelectedAgentId(item.variantId); setPage("evidence"); }}>
                        <span class="agent-avatar"><Icon name="agent" /></span>
                        <span><strong>{item.displayLabel}</strong><small>{item.variantId}</small></span>
                      </button>
                    </td>
                    <td><StatusPill tone={qualified ? "success" : "danger"}>{qualified ? t(locale, "pass") : t(locale, "fail")}</StatusPill></td>
                    <td class="number-cell">{qualified && item.compositeScore !== null ? item.compositeScore.toFixed(1) : "—"}</td>
                    <td class="number-cell">{formatDuration(item.durationMs, locale)}</td>
                    <td class="number-cell">{formatCost(item.estimatedCostUsd, locale, item.costQuality)}</td>
                    <td class="number-cell">{passed}/{item.judgeResults.length || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
