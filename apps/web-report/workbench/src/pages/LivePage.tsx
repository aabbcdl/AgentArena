import { useEffect, useMemo, useState } from "preact/hooks";
import { EmptyState, formatTime, Icon, Metric, Notice, PageHeader, Section, StatusPill, t } from "../components/ui";
import { labelPhase, labelRunState } from "../domain/labels";
import { normalizeLogEntry } from "../domain/logs";
import { formatTokenCount, runtimeEvidence, runtimeText } from "../domain/result-insights";
import { type NormalizedAgentResult, type NormalizedRun, normalizeRun } from "../domain/run";
import { runtimeProfileLabel } from "../domain/runtime-profile";
import { useWorkbench } from "../hooks/useWorkbench";
import type { Locale, LogKind, RuntimeProfile, UiRunStatus } from "../types";

const phaseOrder = ["starting", "preflight", "benchmark", "report"] as const;

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatElapsed(startedAt: number | null, endedAt: number, locale: Locale): string {
  if (startedAt === null) return t(locale, "unknown");
  const totalSeconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function remainingEstimate(locale: Locale, phase: string, state: UiRunStatus["state"]): string {
  if (state === "cancelling") return locale === "zh-CN" ? "正在停止" : "Stopping";
  if (state !== "running") return locale === "zh-CN" ? "运行已结束" : "Run ended";
  if (phase === "starting") return locale === "zh-CN" ? "正在准备运行环境" : "Preparing the isolated runtime";
  if (phase === "preflight") return locale === "zh-CN" ? "正在确认 harness 可运行" : "Checking harness readiness";
  if (phase === "benchmark") return locale === "zh-CN" ? "模型正在执行任务" : "The harness is executing the task";
  return locale === "zh-CN" ? "正在整理报告" : "Assembling the report";
}

function runtimeEvidenceTone(evidence: ReturnType<typeof runtimeEvidence>): "success" | "warning" | "info" {
  if (evidence === "confirmed") return "success";
  if (evidence === "unknown") return "warning";
  return "info";
}

function iconForKind(kind: LogKind): "check" | "warning" | "danger" | "info" | "file" | "agent" {
  if (kind === "error") return "danger";
  if (kind === "warning" || kind === "noise") return "warning";
  if (kind === "tool") return "info";
  if (kind === "file") return "file";
  if (kind === "success") return "check";
  return "agent";
}

function sumTokens(results: NormalizedAgentResult[]): number | null {
  const values = results.map((result) => result.tokenUsage).filter((value): value is number => value !== null);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function judgeSummary(results: NormalizedAgentResult[]): string {
  const passed = results.reduce((sum, result) => sum + result.judgeResults.filter((judge) => judge.success).length, 0);
  const total = results.reduce((sum, result) => sum + result.judgeResults.length, 0);
  return total > 0 ? `${passed}/${total}` : "n/a";
}

function runtimeEvidenceLabel(locale: Locale, evidence: ReturnType<typeof runtimeEvidence>): string {
  const labels = locale === "zh-CN"
    ? { confirmed: "已确认", declared: "配置声明", inferred: "推断", unknown: "未返回" }
    : { confirmed: "Confirmed", declared: "Declared", inferred: "Inferred", unknown: "Not returned" };
  return labels[evidence];
}

function runtimeCard(locale: Locale, result: NormalizedAgentResult) {
  const model = runtimeText(result, "effectiveModel");
  const reasoning = runtimeText(result, "effectiveReasoningEffort");
  const version = runtimeText(result, "effectiveAgentVersion");
  const provider = runtimeText(result, "providerProfileName") ?? runtimeText(result, "providerKind");
  const modelEvidence = runtimeEvidence(result, "model");
  return {
    model: model ?? (locale === "zh-CN" ? "CLI 未返回模型名" : "CLI did not return a model name"),
    reasoning: reasoning ?? (locale === "zh-CN" ? "未返回" : "Not returned"),
    version: version ?? "n/a",
    provider: provider ?? (locale === "zh-CN" ? "继承当前环境" : "Inherited local setup"),
    modelEvidence,
    tokenUsage: result.tokenUsage,
    cost: result.costQuality === "unavailable" ? "n/a" : result.estimatedCostUsd === null ? "n/a" : `$${result.estimatedCostUsd.toFixed(2)}`
  };
}

function activeProfileCard(locale: Locale, profile: RuntimeProfile | undefined, id: string) {
  const requestedModel = profile?.provider?.requestedModel;
  return {
    id,
    model: requestedModel ?? (locale === "zh-CN" ? "等待 CLI 返回模型名" : "Waiting for the CLI model identity"),
    reasoning: profile?.provider?.reasoningEffort ?? (locale === "zh-CN" ? "默认" : "CLI default"),
    version: "n/a",
    provider: profile?.name ?? id,
    modelEvidence: requestedModel ? "declared" as const : "unknown" as const
  };
}

export function LivePage() {
  const { locale, runStatus, plan, environment, cancelRun, startRun, setPage } = useWorkbench();
  const active = runStatus.state === "running" || runStatus.state === "cancelling";
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const completedRun = useMemo<NormalizedRun | null>(() => {
    if (!runStatus.result?.run) return null;
    return normalizeRun(runStatus.result.run);
  }, [runStatus.result?.run]);
  const resultCards = completedRun?.results ?? [];
  const phaseIndex = phaseOrder.indexOf(runStatus.phase as (typeof phaseOrder)[number]);
  const currentIndex = phaseIndex < 0 ? 0 : phaseIndex;
  const phaseNumber = runStatus.state === "done" || runStatus.phase === "done" ? phaseOrder.length : currentIndex + 1;
  const startedAt = parseTimestamp(runStatus.startedAt)
    ?? parseTimestamp(runStatus.logs.find((entry) => entry.timestamp)?.timestamp);
  const endedAt = active ? now : parseTimestamp(runStatus.updatedAt) ?? now;
  const recoverable = runStatus.state === "error" || runStatus.state === "cancelled";

  const agents = plan.runtimeProfileIds.length > 0
    ? plan.runtimeProfileIds.map((profileId) => {
        const profile = environment.runtimeProfiles.find((entry) => entry.id === profileId);
        return { id: profileId, label: profile ? runtimeProfileLabel(locale, profile) : profileId, baseAgentId: profile?.agentKind ?? profileId, profile };
      })
    : [{ id: runStatus.currentVariantId ?? runStatus.currentAgentId ?? "runtime", label: runStatus.currentDisplayLabel ?? runStatus.currentVariantId ?? runStatus.currentAgentId ?? t(locale, "unknown"), baseAgentId: runStatus.currentAgentId ?? "runtime", profile: undefined }];

  if (runStatus.state === "idle") {
    return <><PageHeader eyebrow="LIVE" title={t(locale, "live")} description={t(locale, "liveHint")} /><EmptyState icon="live" title={t(locale, "noActiveRun")} message={t(locale, "noActiveRunDesc")} actions={<button class="button primary" type="button" onClick={() => setPage("plan")}>{t(locale, "newEvaluation")}</button>} /></>;
  }

  return (
    <>
      <PageHeader eyebrow="LIVE" title={active ? t(locale, "runInProgress") : t(locale, "runEnded")} description={`${runStatus.runId ?? "Run"} · ${t(locale, "latestActivity")} ${formatTime(runStatus.updatedAt, locale)}`} actions={<>{active && <button class="button danger" type="button" onClick={() => void cancelRun()} disabled={runStatus.state === "cancelling"}><Icon name="cancel" />{runStatus.state === "cancelling" ? labelRunState(locale, "cancelling") : t(locale, "cancelRun")}</button>}{runStatus.result?.run && <button class="button primary" type="button" onClick={() => setPage("outcome")}><Icon name="outcome" />{t(locale, "viewOutcome")}</button>}</>} />
      <p class="visually-hidden" role="status" aria-live="polite">{`${labelRunState(locale, runStatus.state)} · ${labelPhase(locale, runStatus.phase)}`}</p>
      {runStatus.error && !recoverable && <Notice kind="danger">{runStatus.error}</Notice>}
      {recoverable && <Notice kind={runStatus.state === "error" ? "danger" : "warning"}><strong>{runStatus.state === "error" ? (locale === "zh-CN" ? "运行未完成" : "Run did not complete") : (locale === "zh-CN" ? "运行已取消" : "Run cancelled")}</strong><span>{runStatus.error ?? (locale === "zh-CN" ? "已完成的证据仍会保留。" : "Any completed evidence is preserved.")}</span><div class="page-actions"><button class="button secondary" type="button" onClick={() => setPage("plan")}><Icon name="plan" />{locale === "zh-CN" ? "修改计划" : "Edit plan"}</button><button class="button primary" type="button" onClick={() => void startRun()}><Icon name="refresh" />{locale === "zh-CN" ? "重试" : "Retry"}</button></div></Notice>}

      <div class="metric-grid live-metrics">
        <Metric icon="live" label={locale === "zh-CN" ? "阶段" : "Phase"} value={`${phaseNumber} / ${phaseOrder.length}`} meta={<StatusPill tone={runStatus.state === "error" ? "danger" : active ? "info" : runStatus.state === "done" ? "success" : "warning"}>{labelRunState(locale, runStatus.state)}</StatusPill>} />
        <Metric icon="agent" label={active ? t(locale, "currentAgent") : t(locale, "agents")} value={active ? runStatus.currentDisplayLabel ?? runStatus.currentVariantId ?? t(locale, "unknown") : String(agents.length)} />
        <Metric icon="clock" label={locale === "zh-CN" ? "已运行" : "Elapsed"} value={formatElapsed(startedAt, endedAt, locale)} meta={remainingEstimate(locale, runStatus.phase, runStatus.state)} />
        <Metric icon="cost" label={locale === "zh-CN" ? "Token 总量" : "Total tokens"} value={formatTokenCount(sumTokens(resultCards))} meta={resultCards.some((result) => result.raw.tokenUsageReliable === false) ? (locale === "zh-CN" ? "数据不可靠" : "Data flagged unreliable") : undefined} />
        <Metric icon="check" label={locale === "zh-CN" ? "Judge" : "Judges"} value={judgeSummary(resultCards)} meta={resultCards.length > 1 ? (locale === "zh-CN" ? "本次运行汇总" : "This run") : undefined} />
      </div>

      <Section title={locale === "zh-CN" ? "运行身份" : "Runtime identity"} description={locale === "zh-CN" ? "模型只在 CLI 或配置明确提供时显示；未返回的字段不会被猜测。" : "Model identity is shown only when the CLI or configuration provides evidence; unknown values are never guessed."}>
        <div class="runtime-identity-grid">
          {resultCards.length > 0 ? resultCards.map((result) => {
            const card = runtimeCard(locale, result);
            return <div class="runtime-identity-card" key={result.variantId}><div class="runtime-identity-head"><strong>{result.displayLabel}</strong><StatusPill tone={runtimeEvidenceTone(card.modelEvidence)}>{runtimeEvidenceLabel(locale, card.modelEvidence)}</StatusPill></div><dl><div><dt>{locale === "zh-CN" ? "模型" : "Model"}</dt><dd>{card.model}</dd></div><div><dt>{locale === "zh-CN" ? "思考强度" : "Reasoning"}</dt><dd>{card.reasoning}</dd></div><div><dt>{locale === "zh-CN" ? "版本" : "Version"}</dt><dd>{card.version}</dd></div><div><dt>Provider</dt><dd>{card.provider}</dd></div></dl><div class="runtime-identity-foot"><span>{locale === "zh-CN" ? "Token" : "Tokens"}: {formatTokenCount(card.tokenUsage)}</span><span>{locale === "zh-CN" ? "成本" : "Cost"}: {card.cost}</span></div></div>;
          }) : agents.map((agent) => {
            const card = activeProfileCard(locale, agent.profile, agent.id);
            return <div class="runtime-identity-card" key={agent.id}><div class="runtime-identity-head"><strong>{agent.label}</strong><StatusPill tone={card.modelEvidence === "unknown" ? "warning" : "info"}>{runtimeEvidenceLabel(locale, card.modelEvidence)}</StatusPill></div><dl><div><dt>{locale === "zh-CN" ? "模型" : "Model"}</dt><dd>{card.model}</dd></div><div><dt>{locale === "zh-CN" ? "思考强度" : "Reasoning"}</dt><dd>{card.reasoning}</dd></div><div><dt>{locale === "zh-CN" ? "版本" : "Version"}</dt><dd>n/a</dd></div><div><dt>Provider</dt><dd>{card.provider}</dd></div></dl><div class="runtime-identity-foot"><span>{locale === "zh-CN" ? "运行结束后显示真实 token" : "Token usage appears after the run"}</span></div></div>;
          })}
        </div>
      </Section>

      <Section title={t(locale, "runTimeline")} description={`${locale === "zh-CN" ? "当前" : "Current"}: ${labelPhase(locale, runStatus.phase)} · ${phaseNumber} / ${phaseOrder.length}`}>
        <ol class="timeline">{phaseOrder.map((phase, index) => { const complete = index < currentIndex || runStatus.state === "done"; const current = phase === runStatus.phase; return <li class={`${complete ? "complete" : ""} ${current ? "current" : ""}`} aria-current={current ? "step" : undefined} key={phase}><span>{complete ? <Icon name="check" /> : index + 1}</span><div><strong>{labelPhase(locale, phase)}</strong><small>{current ? remainingEstimate(locale, phase, runStatus.state) : complete ? (locale === "zh-CN" ? "已完成" : "Complete") : (locale === "zh-CN" ? "等待" : "Waiting")}</small></div></li>; })}</ol>
      </Section>

      <div class="two-column live-columns">
        <Section title={t(locale, "agentTracks")}><div class="agent-tracks">{agents.map((agent) => { const result = resultCards.find((item) => item.variantId === agent.id); const current = agent.id === runStatus.currentVariantId || agent.baseAgentId === runStatus.currentAgentId || agent.label === runStatus.currentDisplayLabel; const statusTone = result?.status === "success" ? "success" : result?.status === "failed" ? "danger" : current ? "info" : "neutral"; return <div class={`agent-track ${current ? "current" : ""}`} key={agent.id}><span class="track-icon"><Icon name="agent" /></span><div><strong>{agent.label}</strong><small>{agent.baseAgentId === "claude-code" ? "Claude Code" : agent.baseAgentId === "codex" ? "Codex CLI" : agent.baseAgentId}</small><span>{result ? `${result.judgeResults.filter((judge) => judge.success).length}/${result.judgeResults.length || "n/a"} judges` : current ? labelPhase(locale, runStatus.phase) : (locale === "zh-CN" ? "等待" : "Waiting")}</span></div><StatusPill tone={statusTone}>{result?.status ?? (current ? (locale === "zh-CN" ? "运行中" : "Active") : (locale === "zh-CN" ? "已登记" : "Registered"))}</StatusPill></div>; })}</div></Section>
        <Section title={t(locale, "logs")} description={locale === "zh-CN" ? "只强调关键事件，原始行仍保留在 trace 中。" : "Key events are emphasized; the raw trace remains available for audit."}><div class="log-legend"><span><i class="log-dot log-dot-info" />{locale === "zh-CN" ? "工具/文件" : "Tool/file"}</span><span><i class="log-dot log-dot-warning" />{locale === "zh-CN" ? "警告" : "Warning"}</span><span><i class="log-dot log-dot-danger" />{locale === "zh-CN" ? "错误" : "Error"}</span></div><div class="log-view" role="log" aria-live="polite">{runStatus.logs.length === 0 ? <p>{locale === "zh-CN" ? "等待运行事件" : "Waiting for run events"}</p> : runStatus.logs.slice(-120).map((rawEntry, index) => { const entry = normalizeLogEntry(rawEntry); const kind = entry.kind ?? "output"; return <div class={`log-line log-${kind}`} key={`${entry.seq ?? "line"}-${entry.timestamp ?? index}-${index}`}><time>{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString(locale) : "--:--:--"}</time><span class="log-source">{entry.displayLabel ?? entry.variantId ?? entry.agentId ?? entry.phase ?? "system"}</span><span class="log-badge"><Icon name={iconForKind(kind)} size={12} />{kind}</span><code>{entry.message ?? ""}</code></div>; })}</div></Section>
      </div>
    </>
  );
}
