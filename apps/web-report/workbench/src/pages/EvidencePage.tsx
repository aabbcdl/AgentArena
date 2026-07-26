import { useMemo } from "preact/hooks";
import { FileChanges } from "../components/FileChanges";
import { TraceReplay } from "../components/TraceReplay";
import { EmptyState, Icon, Notice, PageHeader, Section, StatusPill, t } from "../components/ui";
import { runIdentityKey } from "../domain/run";
import { useTrace } from "../hooks/useTrace";
import { useWorkbench } from "../hooks/useWorkbench";
import type { Locale } from "../types";

/** Render an object as readable "key: value" chips instead of raw JSON, so the
 *  execution summary does not leak `{"providerKind":"official"}` into the UI. */
function KeyValues({ data, locale }: { data: unknown; locale: Locale }) {
  if (!data || typeof data !== "object") return <span>{t(locale, "unknown")}</span>;
  const entries = Object.entries(data as Record<string, unknown>).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) return <span>{t(locale, "unknown")}</span>;
  return <span class="kv-inline">{entries.map(([key, value]) => (
    <span class="kv-pair" key={key}><span class="kv-key">{key}</span><code>{typeof value === "object" ? JSON.stringify(value) : String(value)}</code></span>
  ))}</span>;
}

export function EvidencePage() {
  const { locale, selectedRun, selectedAgentId, setSelectedAgentId, setPage } = useWorkbench();
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

      {selected.failureReason && (
        <Notice kind="danger">
          <strong>{t(locale, "failureFirst")}</strong>
          <span>{selected.failureReason}</span>
        </Notice>
      )}

      <div class="evidence-grid">
        <Section title={t(locale, "judges")} description={t(locale, "judgesDesc")}>
          <div class="judge-list">
            {selected.judgeResults.length === 0 ? (
              <p class="muted-line">{t(locale, "missing")}</p>
            ) : (
              selected.judgeResults.map((judge) => (
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

        <Section title={t(locale, "files")} description={t(locale, "filesDesc")}>
          <FileChanges locale={locale} files={selected.changedFiles} diffs={selected.fileDiffs} runId={selectedRun.runId} variantId={selected.variantId} />
        </Section>

        <Section title={t(locale, "trace")} description={t(locale, "traceDesc")} className="evidence-trace">
          {trace.status === "loading" && <p class="muted-line">{t(locale, "traceLoading")}</p>}
          {trace.status === "missing" && <p class="muted-line">{t(locale, "traceMissingNote")}</p>}
          {trace.status === "error" && (
            <Notice kind="warning">
              <span>{t(locale, "traceLoadError")}</span>
              <small>{trace.message}</small>
            </Notice>
          )}
          {trace.status === "ready" && <TraceReplay locale={locale} timeline={trace.timeline} truncated={trace.truncated} />}
        </Section>

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
    </>
  );
}
