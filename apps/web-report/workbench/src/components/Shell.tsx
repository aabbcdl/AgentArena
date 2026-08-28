import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { deriveRunOutcome } from "../domain/run";
import { useWorkbench } from "../hooks/useWorkbench";
import { localizeTaskPack, type PageId, resolveTaskRepositorySource } from "../types";
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
  const serviceState = environment.loading ? "checking" : serviceHealthy ? "online" : "offline";
  const serviceLabel = environment.loading
    ? t(locale, "environmentChecking")
    : serviceHealthy
      ? t(locale, "environmentHealthy")
      : t(locale, "offline");
  const localizedTaskPacks = useMemo(() => environment.taskPacks.map((task) => localizeTaskPack(task, locale)), [environment.taskPacks, locale]);
  const planTask = localizedTaskPacks.find((task) => task.path === plan.taskPath);
  const activeTask = localizedTaskPacks.find((task) => task.path === runStatus.taskPath);

  const onPlan = page === "plan";
  const activeRun = runStatus.state === "running" || runStatus.state === "cancelling";
  const draftRepo = plan.repoPath || environment.uiInfo?.repoPath || "";
  const draftTask = planTask?.title || plan.taskPath || environment.uiInfo?.defaultTaskPath || "";
  const planRepoSource = resolveTaskRepositorySource(planTask, draftRepo);
  const activeRepoSource = resolveTaskRepositorySource(activeTask, runStatus.repoPath ?? "");
  const selectedRepoSource = selectedRun?.task.repoSource?.startsWith("builtin://")
    ? selectedRun.task.repoSource
    : selectedRun?.repository.path;
  const repoLabel = onPlan
    ? (planRepoSource.value || t(locale, "notSelected"))
    : activeRun
      ? (activeRepoSource.value || runStatus.repoPath || t(locale, "notSelected"))
      : (selectedRepoSource ?? runStatus.repoPath ?? t(locale, "notSelected"));
  const taskLabel = onPlan
    ? (draftTask || t(locale, "notSelected"))
    : activeRun
      ? (activeTask?.title ?? runStatus.taskPath ?? t(locale, "notSelected"))
      : (selectedRun?.task.title ?? runStatus.taskPath ?? t(locale, "notSelected"));
  const showPlanDraft = onPlan && Boolean(draftRepo || draftTask);
  const hasStage = Boolean(selectedRun || runStatus.state !== "idle");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    workspaceRef.current?.scrollTo({ top: 0, left: 0 });
    requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  }, [page]);

  useEffect(() => {
    const stage = stageRef.current;
    const active = stage?.querySelector<HTMLElement>("button.active");
    if (!stage || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < stage.scrollLeft) stage.scrollTo({ left: Math.max(0, left - 12) });
    else if (right > stage.scrollLeft + stage.clientWidth) stage.scrollTo({ left: right - stage.clientWidth + 12 });
  }, [hasStage, locale, page]);

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
          <div class="service-state" role="status" aria-live="polite">
            <span class={`service-dot ${serviceState}`} />
            <span>{serviceLabel}</span>
          </div>
          <a href="../legacy/" class="legacy-link" title={locale === "zh-CN" ? "仅在新版缺少所需内容时使用" : "Use only when the new workbench does not expose the needed content"}><Icon name="external" /><span>{locale === "zh-CN" ? "兼容视图" : "Compatibility view"}</span></a>
        </div>
      </aside>

      <div ref={workspaceRef} class={`workspace ${hasStage ? "has-stage" : ""}`}>
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
                <small>{t(locale, "executionRepository")}{showPlanDraft ? ` · ${t(locale, "planDraft")}` : ""}</small>
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
        {hasStage && (
          <nav ref={stageRef} class="stage-nav" aria-label={locale === "zh-CN" ? "实验阶段" : "Experiment stages"}>
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
            <span>{notice.messageKey ? t(locale, notice.messageKey, notice.params) : notice.message ?? ""}</span>
            <button type="button" onClick={clearNotice} aria-label={t(locale, "clear")}><Icon name="cancel" /></button>
          </div>
        )}
        <main ref={mainRef} id="main" class="page-content" tabindex={-1}>{children}</main>
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
