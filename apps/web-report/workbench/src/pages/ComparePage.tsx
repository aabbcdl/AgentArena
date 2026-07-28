import { useMemo, useState } from "preact/hooks";
import { TrendSparkline } from "../components/TrendSparkline";
import { EmptyState, formatCost, formatDuration, Icon, PageHeader, Section, StatusPill, t } from "../components/ui";
import {
  getAgentTrendRows,
  getComparableRuns,
  getCrossRunCompareRows,
  getCrossRunRecommendation,
  getSelectionTrust,
  recordKey
} from "../domain/compare";
import {
  comparisonExclusionReasons,
  deriveRunOutcome,
  type NormalizedRun
} from "../domain/run";
import { useCompareSession } from "../hooks/useCompareSession";
import { useWorkbench } from "../hooks/useWorkbench";
import type { Locale } from "../types";

function agentKeyFor(run: NormalizedRun, variantId: string): string {
  const result = run.results.find((item) => item.variantId === variantId);
  return result ? recordKey(result) : "";
}

export function ComparePage() {
  const { locale, runs, selectedRun, setSelectedRunId, setPage, setNotice } = useWorkbench();
  const session = useCompareSession(runs);
  const [sessionPage, setSessionPage] = useState(0);
  const SESSION_PAGE_SIZE = 50;
  const sessionPageCount = Math.max(1, Math.ceil(runs.length / SESSION_PAGE_SIZE));
  const sessionSafePage = Math.min(sessionPage, sessionPageCount - 1);
  const pagedRuns = runs.slice(sessionSafePage * SESSION_PAGE_SIZE, sessionSafePage * SESSION_PAGE_SIZE + SESSION_PAGE_SIZE);

  const baseId = session.session.baseRunId
    ?? selectedRun?.runId
    ?? runs[0]?.runId
    ?? "";
  const base = runs.find((item) => item.runId === baseId) ?? runs[0] ?? null;

  const [trendAgent, setTrendAgent] = useState<string>(base?.results[0]?.variantId ?? "");

  const candidates = useMemo(() => {
    if (!base) return [];
    return runs
      .filter((item) => item.runId !== base.runId)
      .map((run) => ({ run, reasons: comparisonExclusionReasons(base, run) }));
  }, [base, runs]);

  const comparableRuns = useMemo(() => (base ? getComparableRuns(runs, base) : []), [base, runs]);

  const trendRows = useMemo(() => {
    if (!base) return [];
    return getAgentTrendRows(runs, base, trendAgent ? agentKeyFor(base, trendAgent) : "");
  }, [base, runs, trendAgent]);

  const crossData = useMemo(() => getCrossRunCompareRows(session.selectedRuns), [session.selectedRuns]);
  const recommendation = useMemo(() => getCrossRunRecommendation(crossData), [crossData]);

  const trust = useMemo(() =>
    getSelectionTrust({
      comparableRuns: crossData.comparableRuns.length,
      excludedRuns: crossData.excludedRuns.length,
      hasLegacyFallback: crossData.comparableRuns.some((run) => run.source.kind === "legacy")
    }),
  [crossData]);

  if (runs.length < 2 || !base) {
    return <>
      <PageHeader eyebrow="COMPARE" title={t(locale, "compare")} description={t(locale, "compareEmpty")}/>
      <EmptyState icon="compare" title={t(locale, "compare")} message={t(locale, "compareEmpty")} actions={<button class="button primary" type="button" onClick={() => setPage("runs")}>{t(locale, "runs")}</button>}/>
    </>;
  }

  return <>
    <PageHeader eyebrow="COMPARE" title={t(locale, "compare")} description={locale === "zh-CN" ? "先检查共同条件，再看历史趋势和交叉会话。" : "Check shared conditions before trends and cross-run sessions."}/>

    <Section title={t(locale, "compare")} description={t(locale, "fair")}>
      <label class="inline-field" for="compare-base-run"><span>{locale === "zh-CN" ? "基准运行" : "Base run"}</span>
        <select id="compare-base-run" value={base.runId} onChange={(event) => session.setBaseRunId(event.currentTarget.value)}>
          {runs.map((run) => <option value={run.runId}>{run.task.title} · {run.runId}</option>)}
        </select>
      </label>
      <div class="base-identity">
        <div><small>{t(locale, "repo")}</small><strong>{base.repository.path ?? t(locale, "unknown")}</strong></div>
        <div><small>{t(locale, "task")}</small><strong>{base.task.id ?? base.task.title}</strong></div>
        <div><small>{locale === "zh-CN" ? "提交" : "Revision"}</small><strong>{base.repository.revision ?? t(locale, "unknown")}</strong></div>
        <div><small>{locale === "zh-CN" ? "评分模式" : "Score mode"}</small><strong>{base.scoreMode}</strong></div>
      </div>
      <div class="comparison-list">
        {candidates.map(({ run, reasons }) => {
          const outcome = deriveRunOutcome(run);
          return <div class={`comparison-row ${reasons.length ? "excluded" : "fair"}`}>
            <div class="comparison-identity"><Icon name={reasons.length ? "warning" : "check"}/><div><strong>{run.task.title}</strong><span>{run.runId} · {run.source.label}</span></div></div>
            <div>{reasons.length === 0
              ? <StatusPill tone="success">{t(locale, "fair")}</StatusPill>
              : <div class="reason-pills">{reasons.map((reason) => <StatusPill tone="warning">{reason}</StatusPill>)}</div>}</div>
            <div class="comparison-summary"><span>{t(locale, outcome.evaluation)}</span><span>{outcome.winner?.displayLabel ?? t(locale, "noWinner")}</span></div>
            <button class="button ghost compact-button" type="button" onClick={() => { setSelectedRunId(run.runId); setPage("outcome"); }}>{locale === "zh-CN" ? "查看" : "View"}<Icon name="chevron"/></button>
          </div>;
        })}
      </div>
    </Section>

    <Section title={t(locale, "trendTitle")} description={locale === "zh-CN" ? "同一 Agent 跨多次运行的指标变化。" : "How one agent's metrics change across runs."}>
      {comparableRuns.length < 2
        ? <p class="muted-line">{t(locale, "trendEmpty")}</p>
        : <>
          <label class="inline-field" for="compare-trend-agent"><span>{t(locale, "trendAgent")}</span>
            <select id="compare-trend-agent" value={trendAgent} onChange={(event) => setTrendAgent(event.currentTarget.value)}>
              {base.results.map((item) => <option value={item.variantId}>{item.displayLabel}</option>)}
            </select>
          </label>
          <div class="trend-grid">
            <TrendCell locale={locale} label={t(locale, "trendStatus")} values={trendRows.map((row) => row.result ? (row.result.status === "success" ? 1 : 0) : null)} />
            <TrendCell locale={locale} label={t(locale, "trendDuration")} values={trendRows.map((row) => row.result?.durationMs ?? null)} tone="success" />
            <TrendCell locale={locale} label={t(locale, "trendTokens")} values={trendRows.map((row) => row.result?.tokenUsage ?? null)} />
            <TrendCell locale={locale} label={t(locale, "trendCost")} values={trendRows.map((row) => (row.result?.costKnown ? row.result.estimatedCostUsd : null))} tone="accent" />
            <TrendCell locale={locale} label={t(locale, "trendJudges")} values={trendRows.map((row) => row.result ? row.result.judgeResults.filter((judge) => judge.success).length : null)} />
          </div>
        </>}
    </Section>

    <Section title={t(locale, "crossTitle")} description={t(locale, "crossSelect")}>
      {trust.level === "caution" && (
        <NoticeCaution locale={locale} trust={trust} />
      )}
      <div class="compare-session">
        {pagedRuns.map((run) => {
          const isBase = run.runId === base.runId;
          const checked = session.session.selectedRunIds.includes(run.runId) || isBase;
          const reasons = comparisonExclusionReasons(base, run);
          return <label class={`session-row ${reasons.length && !isBase ? "excluded" : ""}`}>
            <input type="checkbox" checked={checked} disabled={isBase} onChange={() => session.toggleRun(run.runId)} />
            <span class="session-title"><strong>{run.task.title}</strong> · {run.runId}</span>
            {isBase
              ? <StatusPill tone="info">{locale === "zh-CN" ? "基准" : "Base"}</StatusPill>
              : reasons.length > 0
                ? <div class="reason-pills">{reasons.map((reason) => <StatusPill tone="warning">{reason}</StatusPill>)}</div>
                : <StatusPill tone="success">{t(locale, "fair")}</StatusPill>}
          </label>;
        })}
      </div>
      {sessionPageCount > 1 && <div class="pager">
        <button class="button ghost compact-button" type="button" disabled={sessionSafePage === 0} onClick={() => setSessionPage(sessionSafePage - 1)} aria-label={t(locale, "pagePrev")}>{t(locale, "pagePrev")}</button>
        <span class="pager-info">{t(locale, "pageInfo", { current: sessionSafePage + 1, total: sessionPageCount })}</span>
        <button class="button ghost compact-button" type="button" disabled={sessionSafePage >= sessionPageCount - 1} onClick={() => setSessionPage(sessionSafePage + 1)} aria-label={t(locale, "pageNext")}>{t(locale, "pageNext")}</button>
      </div>}

      {crossData.rows.length > 0 && (
        <div class="results-table compare-table">
          <table>
            <caption class="visually-hidden">{t(locale, "compare")}</caption>
            <thead><tr class="results-head">
              <th scope="col">{t(locale, "agent")}</th><th scope="col">{t(locale, "crossSuccessRate")}</th><th scope="col">{t(locale, "crossAvgDuration")}</th><th scope="col">{t(locale, "crossAvgTokens")}</th><th scope="col">{t(locale, "crossAvgCost")}</th><th scope="col">{t(locale, "trendVersion")}</th>
            </tr></thead>
            <tbody>
              {crossData.rows.map((row) => <tr class={`results-row static ${recommendation?.recordKey === row.recordKey ? "recommended" : ""}`}>
                <td><span class="identity-cell"><span class="agent-avatar"><Icon name="agent"/></span><strong>{row.displayLabel}</strong></span></td>
                <td class="number-cell" data-label={t(locale, "crossSuccessRate")}>{Math.round((row.stats.successCount / row.stats.totalRuns) * 100)}%</td>
                <td data-label={t(locale, "crossAvgDuration")}>{formatDuration(row.stats.totalDurationMs / row.stats.totalRuns, locale)}</td>
                <td class="number-cell" data-label={t(locale, "crossAvgTokens")}>{Math.round(row.stats.totalTokens / row.stats.totalRuns)}</td>
                <td data-label={t(locale, "crossAvgCost")}>{row.stats.costKnownCount > 0 ? formatCost(row.stats.totalCost / row.stats.costKnownCount, locale) : t(locale, "unknown")}</td>
                <td data-label={t(locale, "trendVersion")}>{row.version || t(locale, "unknown")}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}

      {recommendation
        ? <div class="session-recommend"><Icon name="check"/><div><strong>{t(locale, "crossRecommended")}: {recommendation.displayLabel}</strong><span>{recommendation.version || t(locale, "unknown")} · {Math.round(recommendation.successRate * 100)}% · {formatDuration(recommendation.avgDurationMs, locale)}</span></div></div>
        : crossData.rows.length > 0 && <p class="muted-line">{t(locale, "crossNone")}</p>}

      <div class="session-bar">
        <button class="button secondary" type="button" onClick={() => { session.saveSession(); setNotice({ kind: "success", message: t(locale, "sessionSaved") }); }}>{t(locale, "sessionSave")}</button>
        <button class="button ghost" type="button" onClick={() => {
          const text = session.shareText();
          if (navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(text)
              .then(() => setNotice({ kind: "success", message: t(locale, "copied") }))
              .catch(() => setNotice({ kind: "danger", message: t(locale, "loadFailed") }));
          } else {
            setNotice({ kind: "danger", message: t(locale, "loadFailed") });
          }
        }}>{t(locale, "sessionShare")}</button>
        <button class="button ghost" type="button" onClick={() => { downloadJson(session.exportJson(), `agentarena-compare-${Date.now()}.json`); setNotice({ kind: "success", message: t(locale, "exported") }); }}>{t(locale, "sessionExport")}</button>
      </div>
    </Section>
  </>;
}

function TrendCell({ locale, label, values, tone = "neutral" }: { locale: Locale; label: string; values: Array<number | null>; tone?: "accent" | "success" | "danger" | "neutral" }) {
  return <div class="trend-cell">
    <small>{label}</small>
    <TrendSparkline values={values} locale={locale} tone={tone} label={label} />
  </div>;
}

function NoticeCaution({ locale, trust }: { locale: Locale; trust: ReturnType<typeof getSelectionTrust> }) {
  const parts: string[] = [];
  if (trust.lowSampleSize) parts.push(t(locale, "sessionLowSample"));
  if (trust.hasExclusions) parts.push(t(locale, "sessionExcluded").replace("{count}", String(trust.excludedRuns)));
  if (trust.hasLegacyFallback) parts.push(t(locale, "sessionLegacy"));
  return <div class="notice notice-warning" role="status"><Icon name="warning"/><div class="notice-body"><strong>{t(locale, "sessionTrustCaution")}</strong><span>{parts.join(" ")}</span></div></div>;
}

function downloadJson(content: string, filename: string) {
  try {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    /* download unsupported */
  }
}
