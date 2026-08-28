import { useMemo, useState } from "preact/hooks";
import { FileChanges } from "../components/FileChanges";
import { TraceReplay } from "../components/TraceReplay";
import { EmptyState, Icon, Notice, PageHeader, Section, StatusPill, t } from "../components/ui";
import { runIdentityKey } from "../domain/run";
import { useTrace } from "../hooks/useTrace";
import { useWorkbench } from "../hooks/useWorkbench";
import type { Locale } from "../types";

type EvidenceFocus = "all" | "failed-judges" | "changed-files" | "trace-steps";

/** Render an object as readable key/value rows instead of raw JSON. */
function KeyValues({ data, locale }: { data: unknown; locale: Locale }) {
  if (!data || typeof data !== "object") return <span>{t(locale, "unknown")}</span>;
  const entries = Object.entries(data as Record<string, unknown>).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) return <span>{t(locale, "unknown")}</span>;
  return <span class="kv-list">{entries.map(([key, value]) => {
    const rendered = Array.isArray(value) && value.every((item) => typeof item === "string")
      ? JSON.stringify([...new Set(value)])
      : typeof value === "object" ? JSON.stringify(value) : String(value);
    return (
      <span class="kv-row" key={key}>
        <span class="kv-key">{key}</span>
        <code>{rendered}</code>
      </span>
    );
  })}</span>;
}

export function EvidencePage() {
  const { locale, selectedRun, selectedAgentId, setSelectedAgentId, setPage } = useWorkbench();
  const [focus, setFocus] = useState<EvidenceFocus>("all");
  const selected = useMemo(
    () => selectedRun?.results.find((item) => item.variantId === selectedAgentId) ?? selectedRun?.results[0] ?? null,
    [selectedAgentId, selectedRun]
  );
  const trace = useTrace(selectedRun, selected);

  if (!selectedRun || !selected) {
    return (
      <>
        <PageHeader eyebrow="EVIDENCE" title={t(locale, "evidence")} />
        <EmptyState icon="evidence" title={t(locale, "noEvidenceTitle")} message={t(locale, "evidenceEmpty")} actions={<button class="button primary" type="button" onClick={() => setPage("runs")}>{t(locale, "runs")}</button>} />
      </>
    );
  }

  const identity = runIdentityKey(selectedRun, selected.variantId);
  const agentLabel = selected.displayLabel;
  const failedJudges = selected.judgeResults.filter((judge) => !judge.success);
  const changedFileCount = new Set([
    ...selected.changedFiles,
    ...(selected.fileDiffs ?? []).map((diff) => diff.path)
  ]).size;
  const traceStepCount = trace.status === "ready" ? trace.timeline.steps.length : null;
  const traceStepCountLabel = traceStepCount === null ? "-" : `${traceStepCount}${trace.status === "ready" && trace.hasMore ? "+" : ""}`;
  const labels = locale === "zh-CN"
    ? {
        all: "全部证据",
        failedJudges: "失败裁判",
        changedFiles: "文件变更",
        traceSteps: "回放步骤",
        filters: "证据范围",
        noFailedJudges: "当前 Agent 没有失败的裁判结果。"
      }
    : {
        all: "All evidence",
        failedJudges: "Failed judges",
        changedFiles: "Changed files",
        traceSteps: "Trace steps",
        filters: "Evidence scope",
        noFailedJudges: "This agent has no failed judge results."
      };

  const selectFocus = (next: EvidenceFocus) => {
    setFocus(next);
    window.requestAnimationFrame(() => {
      const targetId = next === "all" ? "evidence-content" : `evidence-${next}`;
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="EVIDENCE"
        title={agentLabel}
        description={`${selectedRun.task.title} · ${identity}`}
        actions={
          <select class="agent-select" value={selected.variantId} onChange={(event) => setSelectedAgentId(event.currentTarget.value)} aria-label={t(locale, "selectAgent")}>
            {selectedRun.results.map((item) => <option value={item.variantId}>{item.displayLabel}</option>)}
          </select>
        }
      />

      {selectedRun.raw.summaryOnly === true && <Notice kind="info">{t(locale, "summaryOnlyEvidence")}</Notice>}

      {selected.failureReason && (
        <Notice kind="danger">
          <strong>{t(locale, "failureFirst")}</strong>
          <span>{selected.failureReason}</span>
        </Notice>
      )}

      <nav class="evidence-focus" aria-label={labels.filters}>
        <div class="evidence-focus-controls" role="tablist" aria-label={labels.filters}>
          <button type="button" class={`button evidence-focus-button ${focus === "all" ? "secondary active" : "ghost"}`} role="tab" aria-selected={focus === "all"} aria-controls="evidence-content" onClick={() => selectFocus("all")}>
            <span>{labels.all}</span>
          </button>
          <button type="button" class={`button evidence-focus-button ${focus === "failed-judges" ? "secondary active" : "ghost"}`} role="tab" aria-selected={focus === "failed-judges"} aria-controls="evidence-failed-judges" onClick={() => selectFocus("failed-judges")}>
            <span>{labels.failedJudges}</span><strong>{failedJudges.length}</strong>
          </button>
          <button type="button" class={`button evidence-focus-button ${focus === "changed-files" ? "secondary active" : "ghost"}`} role="tab" aria-selected={focus === "changed-files"} aria-controls="evidence-changed-files" onClick={() => selectFocus("changed-files")}>
            <span>{labels.changedFiles}</span><strong>{changedFileCount}</strong>
          </button>
          <button type="button" class={`button evidence-focus-button ${focus === "trace-steps" ? "secondary active" : "ghost"}`} role="tab" aria-selected={focus === "trace-steps"} aria-controls="evidence-trace-steps" onClick={() => selectFocus("trace-steps")}>
            <span>{labels.traceSteps}</span><strong>{traceStepCountLabel}</strong>
          </button>
        </div>
      </nav>

      <div id="evidence-content" class={`evidence-grid ${focus === "all" ? "" : "evidence-grid-focused"}`}>
        <div id="evidence-failed-judges" class="evidence-section-wrap" hidden={focus !== "all" && focus !== "failed-judges"} role={focus === "failed-judges" ? "tabpanel" : undefined}>
        <Section title={focus === "failed-judges" ? labels.failedJudges : t(locale, "judges")} description={t(locale, "judgesDesc")}>
          <div class="judge-list">
            {(focus === "failed-judges" ? failedJudges : selected.judgeResults).length === 0 ? (
              <p class="muted-line">{focus === "failed-judges" ? labels.noFailedJudges : t(locale, "missing")}</p>
            ) : (
              (focus === "failed-judges" ? failedJudges : selected.judgeResults).map((judge) => (
                <div class={`judge-row ${judge.success ? "passed" : "failed"}`} key={judge.judgeId}>
                  <span class="judge-status"><Icon name={judge.success ? "check" : "danger"} /></span>
                  <div>
                    <strong>{judge.label}</strong>
                    <small>{judge.type}</small>
                    {judge.message && <p>{judge.message}</p>}
                  </div>
                  <StatusPill tone={judge.success ? "success" : "danger"}>{judge.success ? t(locale, "pass") : t(locale, "fail")}</StatusPill>
                </div>
              ))
            )}
          </div>
        </Section>
        </div>

        <div id="evidence-changed-files" class="evidence-section-wrap" hidden={focus !== "all" && focus !== "changed-files"} role={focus === "changed-files" ? "tabpanel" : undefined}>
        <Section title={t(locale, "files")} description={t(locale, "filesDesc")}>
          <FileChanges locale={locale} files={selected.changedFiles} diffs={selected.fileDiffs} runId={selectedRun.runId} variantId={selected.variantId} />
        </Section>
        </div>

        <div id="evidence-trace-steps" class="evidence-section-wrap evidence-trace-wrap" hidden={focus !== "all" && focus !== "trace-steps"} role={focus === "trace-steps" ? "tabpanel" : undefined}>
        <Section title={t(locale, "trace")} description={t(locale, "traceDesc")} className="evidence-trace">
          {trace.status === "loading" && <p class="muted-line">{t(locale, "traceLoading")}</p>}
          {trace.status === "missing" && <p class="muted-line">{t(locale, "traceMissingNote")}</p>}
          {trace.status === "error" && (
            <Notice kind="warning">
              <span>{t(locale, "traceLoadError")}</span>
              <small>{trace.message}</small>
            </Notice>
          )}
          {trace.status === "ready" && <TraceReplay locale={locale} timeline={trace.timeline} truncated={trace.truncated} hasMore={trace.hasMore} onLoadFull={trace.loadFull} />}
        </Section>
        </div>

        <div class="evidence-section-wrap" hidden={focus !== "all"}>
        <Section title={t(locale, "executionSummary")}>
          <div class="summary-block">
            <p>{selected.summary || t(locale, "missing")}</p>
            <dl>
              <div><dt>{t(locale, "source")}</dt><dd>{selectedRun.source.label}</dd></div>
              <div><dt>{t(locale, "config")}</dt><dd><KeyValues data={selected.requestedConfig} locale={locale} /></dd></div>
              <div><dt>{t(locale, "runtime")}</dt><dd><KeyValues data={selected.resolvedRuntime} locale={locale} /></dd></div>
            </dl>
          </div>
        </Section>
        </div>
      </div>
    </>
  );
}
