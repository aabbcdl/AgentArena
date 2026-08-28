import { useEffect, useMemo, useState } from "preact/hooks";
import { EmptyState, Icon, PageHeader, Section, StatusPill, t } from "../components/ui";
import { adapterTrialStatusLabel, adapterTrialStatusTone, deriveAdapterTrialStatus } from "../domain/adapter-trial";
import { labelTaskDifficulty, taskDifficultyTone } from "../domain/labels";
import { runtimeProfileLabel, runtimeReadinessLabel } from "../domain/runtime-profile";
import { useWorkbench } from "../hooks/useWorkbench";
import { localizeTaskPack } from "../types";

export function LibraryPage() {
  const { locale, environment, setPage, updatePlan } = useWorkbench();
  const taskPacks = environment.taskPacks.map((task) => localizeTaskPack(task, locale));
  const [query, setQuery] = useState("");
  const [compatibility, setCompatibility] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("agentarena-library-favorites-v1") ?? "[]") as string[]; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem("agentarena-library-favorites-v1", JSON.stringify(favorites)); } catch { /* private mode */ } }, [favorites]);
  const filteredTaskPacks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return taskPacks.filter((task) => {
      const matchesQuery = !normalized || [task.title, task.id, task.path, task.description, task.objective].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized));
      const status = task.compatibility?.status ?? "unknown";
      const matchesCompatibility = compatibility === "all" || status === compatibility;
      const matchesFavorite = !favoritesOnly || favorites.includes(task.path);
      return matchesQuery && matchesCompatibility && matchesFavorite;
    }).sort((a, b) => Number(favorites.includes(b.path)) - Number(favorites.includes(a.path)));
  }, [compatibility, favorites, favoritesOnly, query, taskPacks]);
  const trialAdapters = useMemo(() => environment.adapters
    .filter((adapter) => adapter.kind !== "demo")
    .map((adapter) => deriveAdapterTrialStatus(
      adapter,
      environment.detectedAgents.find((agent) => agent.id === adapter.id),
      environment.runtimeReadiness
    ))
    .sort((left, right) => Number(right.adapter.id === "codex") - Number(left.adapter.id === "codex")), [environment.adapters, environment.detectedAgents, environment.runtimeReadiness]);
  const useTaskInPlan = (path: string) => { updatePlan({ taskPath: path }); setPage("plan"); };
  return <>
    <PageHeader eyebrow="LIBRARY" title={locale === "zh-CN" ? "评测资源库" : "Evaluation library"} description={locale === "zh-CN" ? "搜索任务包，按兼容性筛选，并把常用任务固定到前面。" : "Search task packs, filter by compatibility, and keep frequently used tasks at the top."}/>
    <div class="library-stats"><div><Icon name="plan"/><strong>{taskPacks.length}</strong><span>{locale === "zh-CN" ? "任务包" : "Task packs"}</span></div><div><Icon name="agent"/><strong>{trialAdapters.length}</strong><span>Harnesses</span></div><div><Icon name="environment"/><strong>{environment.runtimeProfiles.length}</strong><span>{locale === "zh-CN" ? "运行配置" : "Runtime profiles"}</span></div></div>
    <Section title={locale === "zh-CN" ? "任务包" : "Task packs"}>
      <search class="library-filters">
        <label class="filter-field"><span>{locale === "zh-CN" ? "搜索资源" : "Search resources"}</span><input value={query} onInput={(event) => setQuery(event.currentTarget.value)} placeholder={locale === "zh-CN" ? "标题、描述或路径" : "Title, description, or path"} /></label>
        <label class="filter-field"><span>{locale === "zh-CN" ? "兼容性" : "Compatibility"}</span><select value={compatibility} onChange={(event) => setCompatibility(event.currentTarget.value)}><option value="all">{locale === "zh-CN" ? "全部" : "All"}</option><option value="compatible">{locale === "zh-CN" ? "兼容" : "Compatible"}</option><option value="incompatible">{locale === "zh-CN" ? "不兼容" : "Incompatible"}</option><option value="unknown">{locale === "zh-CN" ? "未知" : "Unknown"}</option></select></label>
        <label class="filter-toggle"><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.currentTarget.checked)} /><span>{locale === "zh-CN" ? "只看收藏" : "Favorites only"}</span></label>
        <span class="filter-count">{locale === "zh-CN" ? `${filteredTaskPacks.length} 个任务包` : `${filteredTaskPacks.length} task pack(s)`}</span>
      </search>
      {taskPacks.length === 0
        ? <EmptyState icon="library" title={locale === "zh-CN" ? "没有任务包" : "No task packs"} message={locale === "zh-CN" ? "连接本地服务后重新检查。" : "Reconnect the local service and check again."}/>
        : filteredTaskPacks.length === 0
          ? <EmptyState icon="library" title={locale === "zh-CN" ? "没有匹配的任务包" : "No matching task packs"} message={locale === "zh-CN" ? "换一个关键词或清除筛选条件。" : "Try another search term or clear a filter."}/>
          : (
              <div class="resource-grid">
                {filteredTaskPacks.map((task) => {
                  const favorite = favorites.includes(task.path);
                  return (
                    <article class="resource-card" key={task.path}>
                      <div class="resource-icon"><Icon name="plan"/></div>
                      <div class="resource-content">
                        <div class="resource-title">
                          <h3>{task.title ?? task.id ?? task.path}</h3>
                          <button class="button ghost compact-button favorite-button" type="button" aria-pressed={favorite} onClick={() => setFavorites((items) => favorite ? items.filter((path) => path !== task.path) : [...items, task.path])}>
                            {favorite ? (locale === "zh-CN" ? "已收藏" : "Saved") : (locale === "zh-CN" ? "收藏" : "Save")}
                          </button>
                        </div>
                        <div class="resource-meta">
                          <StatusPill tone={taskDifficultyTone(task.difficulty)}>
                            {locale === "zh-CN" ? "难度" : "Difficulty"}: {labelTaskDifficulty(locale, task.difficulty)}
                          </StatusPill>
                          {task.compatibility?.status && (
                            <StatusPill tone={task.compatibility.status === "compatible" ? "success" : task.compatibility.status === "incompatible" ? "danger" : "warning"}>
                              {task.compatibility.status}
                            </StatusPill>
                          )}
                        </div>
                        <p>{task.description ?? task.compatibility?.summary ?? task.path}</p>
                        <code>{task.path}</code>
                        <div class="resource-actions">
                          <button class="button ghost compact-button" type="button" onClick={() => useTaskInPlan(task.path)}>
                            {locale === "zh-CN" ? "用于新评测" : "Use in new evaluation"}<Icon name="chevron"/>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
    </Section>
    <div class="two-column">
      <Section title="Harnesses" description={locale === "zh-CN" ? "状态来自适配器能力、CLI 检测和当前运行配置。Codex 是首轮推荐入口。" : "Status combines adapter capability, CLI detection, and current runtime verification. Codex is the first-release recommendation."}>
        <div class="compact-list">
          {trialAdapters.length === 0
            ? <p class="muted-line">{t(locale, "loadFailed")}</p>
            : trialAdapters.map((projection) => <div class="compact-row" key={projection.adapter.id}>
              <Icon name="agent"/>
              <div><strong>{projection.adapter.title}</strong><small>{projection.adapter.id === "codex" ? (locale === "zh-CN" ? "首轮推荐" : "First-release recommendation") : `${locale === "zh-CN" ? "支持层级" : "Support tier"}: ${projection.supportTier}`}{projection.reason ? ` · ${projection.reason}` : ""}</small></div>
              <StatusPill tone={adapterTrialStatusTone(projection.status)}>{adapterTrialStatusLabel(locale, projection.status)}</StatusPill>
            </div>)}
        </div>
      </Section>
      <Section title={locale === "zh-CN" ? "运行配置" : "Runtime profiles"}><div class="compact-list">{environment.runtimeProfiles.length === 0 ? <p class="muted-line">{t(locale, "missing")}</p> : environment.runtimeProfiles.map((profile) => { const readiness = environment.runtimeReadiness.find((entry) => entry.profile.id === profile.id); return <div class="compact-row" key={profile.id}><Icon name="environment"/><div><strong>{runtimeProfileLabel(locale, profile)}</strong><small>{profile.provider?.requestedModel ?? (profile.agentKind === "codex" ? "Codex CLI" : "Claude Code")}</small></div><StatusPill tone={readiness?.readiness === "task-ready" && readiness.receiptMatch ? "success" : readiness?.readiness === "changed" ? "warning" : "neutral"}>{runtimeReadinessLabel(locale, readiness?.readiness)}</StatusPill></div>; })}</div></Section>
    </div>
  </>;
}
