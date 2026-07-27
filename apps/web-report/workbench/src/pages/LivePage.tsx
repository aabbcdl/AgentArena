import { EmptyState, formatTime, Icon, Metric, Notice, PageHeader, Section, StatusPill, t } from "../components/ui";
import { labelPhase, labelRunState } from "../domain/labels";
import { useWorkbench } from "../hooks/useWorkbench";

const phaseOrder = ["starting", "preflight", "benchmark", "report", "done"];

export function LivePage() {
  const { locale, runStatus, plan, cancelRun, setPage } = useWorkbench();
  const active = runStatus.state === "running" || runStatus.state === "cancelling";
  const currentIndex = Math.max(0, phaseOrder.indexOf(runStatus.phase));
  const agents = plan.agentIds.length > 0
    ? plan.agentIds
    : [runStatus.currentVariantId ?? runStatus.currentAgentId].filter(Boolean) as string[];

  if (runStatus.state === "idle") {
    return (
      <>
        <PageHeader
          eyebrow="LIVE"
          title={t(locale, "live")}
          description={t(locale, "liveHint")}
        />
        <EmptyState
          icon="live"
          title={t(locale, "noActiveRun")}
          message={t(locale, "noActiveRunDesc")}
          actions={<button class="button primary" type="button" onClick={() => setPage("plan")}>{t(locale, "newEvaluation")}</button>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="LIVE"
        title={active ? t(locale, "runInProgress") : t(locale, "runEnded")}
        description={`${runStatus.runId ?? "Run"} · ${t(locale, "latestActivity")} ${formatTime(runStatus.updatedAt, locale)}`}
        actions={
          <>
            {active && (
              <button class="button danger" type="button" onClick={() => void cancelRun()} disabled={runStatus.state === "cancelling"}>
                <Icon name="cancel" />
                {runStatus.state === "cancelling" ? labelRunState(locale, "cancelling") : t(locale, "cancelRun")}
              </button>
            )}
            {runStatus.result?.run && (
              <button class="button primary" type="button" onClick={() => setPage("outcome")}>{t(locale, "viewOutcome")}</button>
            )}
          </>
        }
      />
      <p class="visually-hidden" role="status" aria-live="polite">
        {`${labelRunState(locale, runStatus.state)} · ${labelPhase(locale, runStatus.phase)}`}
      </p>
      {runStatus.error && <Notice kind="danger">{runStatus.error}</Notice>}
      {runStatus.state === "cancelled" && (
        <Notice kind="warning">{locale === "zh-CN" ? "运行已取消，已生成的部分证据会被保留。" : "Run cancelled. Any completed evidence is preserved."}</Notice>
      )}

      <div class="metric-grid live-metrics">
        <Metric
          icon="live"
          label={t(locale, "status")}
          value={
            <StatusPill tone={runStatus.state === "error" ? "danger" : active ? "info" : runStatus.state === "done" ? "success" : "warning"}>
              {labelRunState(locale, runStatus.state)}
            </StatusPill>
          }
          meta={labelPhase(locale, runStatus.phase)}
        />
        <Metric
          icon="agent"
          label={t(locale, "currentAgent")}
          value={runStatus.currentDisplayLabel ?? runStatus.currentVariantId ?? t(locale, "unknown")}
        />
        <Metric icon="clock" label={t(locale, "latestActivity")} value={formatTime(runStatus.updatedAt, locale)} />
      </div>

      <Section title={t(locale, "runTimeline")}>
        <ol class="timeline">
          {phaseOrder.slice(0, 4).map((phase, index) => {
            const complete = index < currentIndex || runStatus.state === "done";
            const current = phase === runStatus.phase;
            return (
              <li class={`${complete ? "complete" : ""} ${current ? "current" : ""}`} aria-current={current ? "step" : undefined}>
                <span>{complete ? <Icon name="check" /> : index + 1}</span>
                <div>
                  <strong>{labelPhase(locale, phase)}</strong>
                  <small>
                    {current
                      ? (locale === "zh-CN" ? "当前阶段" : "Current phase")
                      : complete
                        ? (locale === "zh-CN" ? "已完成" : "Complete")
                        : (locale === "zh-CN" ? "等待" : "Waiting")}
                  </small>
                </div>
              </li>
            );
          })}
        </ol>
      </Section>

      <div class="two-column live-columns">
        <Section title={t(locale, "agentTracks")}>
          <div class="agent-tracks">
            {agents.map((agent) => {
              const current = agent === runStatus.currentVariantId || agent === runStatus.currentAgentId;
              return (
                <div class={`agent-track ${current ? "current" : ""}`}>
                  <span class="track-icon"><Icon name="agent" /></span>
                  <div>
                    <strong>{agent}</strong>
                    <span>{current ? labelPhase(locale, runStatus.phase) : (locale === "zh-CN" ? "等待或已完成" : "Waiting or complete")}</span>
                  </div>
                  <StatusPill tone={current ? "info" : "neutral"}>
                    {current ? (locale === "zh-CN" ? "活动" : "Active") : (locale === "zh-CN" ? "已登记" : "Registered")}
                  </StatusPill>
                </div>
              );
            })}
          </div>
        </Section>
        <Section title={t(locale, "logs")} description={t(locale, "retainLatestLogs")}>
          <div class="log-view" role="log" aria-live="polite">
            {runStatus.logs.length === 0 ? (
              <p>{locale === "zh-CN" ? "等待运行事件…" : "Waiting for run events…"}</p>
            ) : (
              runStatus.logs.slice(-120).map((entry) => (
                <div class="log-line">
                  <time>{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString(locale) : "--:--:--"}</time>
                  <span>{entry.displayLabel ?? entry.variantId ?? entry.agentId ?? entry.phase ?? "system"}</span>
                  <code>{entry.message ?? ""}</code>
                </div>
              ))
            )}
          </div>
        </Section>
      </div>
    </>
  );
}
