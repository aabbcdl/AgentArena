import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";
import { deriveRunOutcome } from "../domain/run";
import { useWorkbench } from "../hooks/useWorkbench";
import { localizeTaskPack, type PageId } from "../types";
import { Icon, StatusPill, t } from "./ui";

const mainNav: Array<{ id: PageId; icon: "runs" | "compare" | "library" | "environment" | "settings"; label: "runs" | "compare" | "library" | "environment" | "settings" }> = [
  { id: "runs", icon: "runs", label: "runs" },
  { id: "compare", icon: "compare", label: "compare" },
  { id: "library", icon: "library", label: "library" },
  { id: "environment", icon: "environment", label: "environment" },
  { id: "settings", icon: "settings", label: "settings" }
];
const stages: Array<{ id: PageId; icon: "plan" | "live" | "outcome" | "evidence" | "compare"; label: "plan" | "live" | "outcome" | "evidence" | "baseline" }> = [
  { id: "plan", icon: "plan", label: "plan" },
  { id: "live", icon: "live", label: "live" },
  { id: "outcome", icon: "outcome", label: "outcome" },
  { id: "evidence", icon: "evidence", label: "evidence" },
  { id: "compare", icon: "compare", label: "baseline" }
];

export function Shell({ children }: { children: ComponentChildren }) {
  const { locale, page, setPage, selectedRun, runStatus, environment, plan, notice, clearNotice } = useWorkbench();
  const outcome = selectedRun ? deriveRunOutcome(selectedRun) : null;
  const serviceHealthy = !environment.error && environment.uiInfo !== null;
  const planTaskTitle = useMemo(() => {
    const match = environment.taskPacks.map((task) => localizeTaskPack(task, locale)).find((task) => task.path === plan.taskPath);
    return match?.title ?? plan.taskPath;
  }, [environment.taskPacks, locale, plan.taskPath]);

  const onPlan = page === "plan";
  const draftRepo = plan.repoPath || environment.uiInfo?.repoPath || "";
  const draftTask = planTaskTitle || environment.uiInfo?.defaultTaskPath || "";
  const repoLabel = onPlan
    ? (draftRepo || t(locale, "notSelected"))
    : (selectedRun?.repository.path ?? runStatus.repoPath ?? t(locale, "notSelected"));
  const taskLabel = onPlan
    ? (draftTask || t(locale, "notSelected"))
    : (selectedRun?.task.title ?? runStatus.taskPath ?? t(locale, "notSelected"));
  const showPlanDraft = onPlan && Boolean(draftRepo || draftTask);

  return (
    <div class="app-shell">
      <a href="#main" class="skip-link">{locale === "zh-CN" ? "跳到主要内容" : "Skip to main content"}</a>
      <aside class="sidebar">
        <button class="brand" type="button" onClick={() => setPage("runs")}>
          <span class="brand-mark" aria-hidden="true"><span>A</span></span>
          <span><strong>AgentArena</strong><small>{t(locale, "productTagline")}</small></span>
        </button>
        <button class="primary-action" type="button" onClick={() => setPage("plan")}><Icon name="plus" /><span>{t(locale, "newEvaluation")}</span></button>
        <nav class="main-nav" aria-label={locale === "zh-CN" ? "主导航" : "Primary navigation"}>
          {mainNav.map((item) => (
            <button
              type="button"
              class={page === item.id ? "active" : ""}
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => setPage(item.id)}
            >
              <Icon name={item.icon} /><span>{t(locale, item.label)}</span>
            </button>
          ))}
        </nav>
        <div class="sidebar-footer">
          <div class="service-state">
            <span class={`service-dot ${serviceHealthy ? "online" : "offline"}`} />
            <span>{serviceHealthy ? t(locale, "environmentHealthy") : t(locale, "offline")}</span>
          </div>
          <a href="../legacy/" class="legacy-link"><Icon name="external" /><span>{t(locale, "legacyView")}</span></a>
        </div>
      </aside>

      <div class="workspace">
        <header class="mobile-bar">
          <button class="brand compact" type="button" onClick={() => setPage("runs")}>
            <span class="brand-mark"><span>A</span></span><strong>AgentArena</strong>
          </button>
          <button class="mobile-new" type="button" onClick={() => setPage("plan")}>
            <Icon name="plus" /><span>{t(locale, "newEvaluation")}</span>
          </button>
        </header>
        <div class="context-bar">
          <div class="context-main">
            <div class="context-item context-repo">
              <Icon name="repo" />
              <span>
                <small>{t(locale, "repo")}{showPlanDraft ? ` · ${t(locale, "planDraft")}` : ""}</small>
                <strong>{repoLabel}</strong>
              </span>
            </div>
            <div class="context-item">
              <Icon name="plan" />
              <span>
                <small>{t(locale, "task")}{showPlanDraft ? ` · ${t(locale, "planDraft")}` : ""}</small>
                <strong>{taskLabel}</strong>
              </span>
            </div>
            {!onPlan && selectedRun && (
              <div class="context-item context-id">
                <span><small>{t(locale, "runId")}</small><strong>{selectedRun.runId}</strong></span>
              </div>
            )}
          </div>
          <div class="context-status">
            {showPlanDraft && <StatusPill tone="info">{t(locale, "planDraft")}</StatusPill>}
            {!onPlan && selectedRun && (
              <StatusPill tone={selectedRun.integrity === "complete" ? "success" : selectedRun.integrity === "damaged" ? "danger" : "warning"}>
                {t(locale, selectedRun.integrity)}
              </StatusPill>
            )}
            {!onPlan && outcome && (
              <StatusPill tone={outcome.evaluation === "pass" ? "success" : outcome.evaluation === "fail" ? "danger" : "warning"}>
                {t(locale, outcome.evaluation)}
              </StatusPill>
            )}
          </div>
        </div>
        {(selectedRun || runStatus.state !== "idle") && (
          <nav class="stage-nav" aria-label={locale === "zh-CN" ? "实验阶段" : "Experiment stages"}>
            {stages.map((item, index) => (
              <button
                type="button"
                class={page === item.id ? "active" : ""}
                aria-current={page === item.id ? "step" : undefined}
                onClick={() => setPage(item.id)}
              >
                <span class="stage-index">{index + 1}</span>
                <Icon name={item.icon} />
                <span>{t(locale, item.label)}</span>
              </button>
            ))}
          </nav>
        )}
        {notice && (
          <div class={`global-notice global-${notice.kind}`} role={notice.kind === "danger" ? "alert" : "status"}>
            <Icon name={notice.kind === "success" ? "check" : notice.kind} />
            <span>{notice.message}</span>
            <button type="button" onClick={clearNotice} aria-label={t(locale, "clear")}><Icon name="cancel" /></button>
          </div>
        )}
        <main id="main" class="page-content" tabindex={-1}>{children}</main>
        <nav class="mobile-nav" aria-label={locale === "zh-CN" ? "移动导航" : "Mobile navigation"}>
          {mainNav.map((item) => (
            <button type="button" class={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>
              <Icon name={item.icon} /><span>{t(locale, item.label)}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
