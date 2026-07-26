import { useRef, useState } from "preact/hooks";
import { EmptyState, formatTime, Icon, Notice, PageHeader, Section, StatusPill, t } from "../components/ui";
import { labelExecution, labelPhase, labelRunState } from "../domain/labels";
import { deriveRunOutcome } from "../domain/run";
import { useWorkbench } from "../hooks/useWorkbench";

export function RunsPage() {
  const { locale, runs, selectedRun, setSelectedRunId, setPage, loadDemo, importRuns, runStatus } = useWorkbench();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<{ kind: "success" | "warning"; text: string } | null>(null);
  const [pageNo, setPageNo] = useState(0);
  const PAGE_SIZE = 50;
  const pageCount = Math.max(1, Math.ceil(runs.length / PAGE_SIZE));
  const safePage = Math.min(pageNo, pageCount - 1);
  const pagedRuns = runs.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const attention = runs.filter((run) => {
    const outcome = deriveRunOutcome(run);
    return run.integrity !== "complete" || outcome.evaluation === "fail" || outcome.evaluation === "incomplete";
  });
  const active = runStatus.state === "running" || runStatus.state === "cancelling";
  const empty = runs.length === 0;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const result = await importRuns(files);
    setImportMessage({
      kind: result.errors.length ? "warning" : "success",
      text: locale === "zh-CN"
        ? `已导入 ${result.imported} 份结果${result.errors.length ? `，${result.errors.length} 个文件失败` : ""}。`
        : `Imported ${result.imported} result(s)${result.errors.length ? `; ${result.errors.length} file(s) failed` : ""}.`
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="RUNS"
        title={locale === "zh-CN" ? "实验运行中心" : "Experiment runs"}
        description={locale === "zh-CN" ? "从正在执行、需要处理和最近完成的实验开始。" : "Start with active, attention-needed, and recently completed experiments."}
        actions={
          empty ? (
            <button class="button secondary" type="button" onClick={() => inputRef.current?.click()}>
              <Icon name="upload" />{t(locale, "importResult")}
            </button>
          ) : (
            <>
              <button class="button secondary" type="button" onClick={loadDemo}><Icon name="outcome" />{t(locale, "tryDemo")}</button>
              <button class="button secondary" type="button" onClick={() => inputRef.current?.click()}><Icon name="upload" />{t(locale, "importResult")}</button>
              <button class="button primary" type="button" onClick={() => setPage("plan")}><Icon name="plus" />{t(locale, "newEvaluation")}</button>
            </>
          )
        }
      />
      <input ref={inputRef} class="visually-hidden" type="file" aria-label={t(locale, "importResult")} accept="application/json,.json" multiple onChange={(event) => void handleFiles(event.currentTarget.files)} />
      {importMessage && <Notice kind={importMessage.kind} onClose={() => setImportMessage(null)}>{importMessage.text}</Notice>}

      {active && (
        <Section title={t(locale, "activeRun")} className="active-section">
          <button class="active-run-card" type="button" onClick={() => setPage("live")}>
            <div class="active-run-icon"><Icon name="live" size={22} /></div>
            <div>
              <strong>{runStatus.currentDisplayLabel ?? runStatus.currentVariantId ?? t(locale, "runInProgress")}</strong>
              <span>{labelPhase(locale, runStatus.phase)} · {formatTime(runStatus.updatedAt, locale)}</span>
            </div>
            <StatusPill tone={runStatus.state === "cancelling" ? "warning" : "info"}>{labelRunState(locale, runStatus.state)}</StatusPill>
            <Icon name="chevron" />
          </button>
        </Section>
      )}

      {attention.length > 0 && (
        <Section title={t(locale, "needsAttention")} description={locale === "zh-CN" ? "失败、不完整或降级的结果。" : "Failed, incomplete, or degraded results."}>
          <div class="attention-grid">
            {attention.slice(0, 4).map((run) => {
              const outcome = deriveRunOutcome(run);
              return (
                <button type="button" class="attention-card" onClick={() => { setSelectedRunId(run.runId); setPage("outcome"); }}>
                  <Icon name={outcome.evaluation === "fail" ? "danger" : "warning"} />
                  <div><strong>{run.task.title}</strong><span>{run.runId}</span></div>
                  <StatusPill tone={outcome.evaluation === "fail" ? "danger" : "warning"}>{t(locale, outcome.evaluation)}</StatusPill>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <Section title={t(locale, "recentRuns")} description={locale === "zh-CN" ? "所有来源都显示身份、完整性和评测结论。" : "Every source shows identity, integrity, and evaluation outcome."}>
        {empty ? (
          <EmptyState
            icon="runs"
            title={t(locale, "noRuns")}
            message={t(locale, "noRunsHint")}
            actions={
              <>
                <button class="button primary" type="button" onClick={() => setPage("plan")}>{t(locale, "newEvaluation")}</button>
                <button class="button secondary" type="button" onClick={loadDemo}>{t(locale, "tryDemo")}</button>
              </>
            }
          />
        ) : (
          <>
            <div class="run-list">
              {pagedRuns.map((run) => {
                const outcome = deriveRunOutcome(run);
                const isSelected = selectedRun?.runId === run.runId;
                return (
                  <button type="button" class={`run-row ${isSelected ? "selected" : ""}`} onClick={() => { setSelectedRunId(run.runId); setPage("outcome"); }}>
                    <div class="run-cell run-title"><strong>{run.task.title}</strong><span>{run.repository.path ?? t(locale, "unknown")}</span></div>
                    <div class="run-cell"><small>{t(locale, "execution")}</small><span>{labelExecution(locale, outcome.execution)}</span></div>
                    <div class="run-cell"><small>{t(locale, "result")}</small><StatusPill tone={outcome.evaluation === "pass" ? "success" : outcome.evaluation === "fail" ? "danger" : "warning"}>{t(locale, outcome.evaluation)}</StatusPill></div>
                    <div class="run-cell"><small>{t(locale, "trust")}</small><StatusPill tone={run.integrity === "complete" ? "success" : run.integrity === "damaged" ? "danger" : "warning"}>{t(locale, run.integrity)}</StatusPill></div>
                    <div class="run-cell run-time"><small>{t(locale, "source")}</small><span>{run.source.label}</span><span>{formatTime(run.createdAt, locale)}</span></div>
                    <Icon name="chevron" />
                  </button>
                );
              })}
            </div>
            {pageCount > 1 && (
              <div class="pager">
                <button class="button ghost compact-button" type="button" disabled={safePage === 0} onClick={() => setPageNo(safePage - 1)} aria-label={t(locale, "pagePrev")}>{t(locale, "pagePrev")}</button>
                <span class="pager-info">{t(locale, "pageInfo", { current: safePage + 1, total: pageCount })}</span>
                <button class="button ghost compact-button" type="button" disabled={safePage >= pageCount - 1} onClick={() => setPageNo(safePage + 1)} aria-label={t(locale, "pageNext")}>{t(locale, "pageNext")}</button>
              </div>
            )}
          </>
        )}
      </Section>
    </>
  );
}
