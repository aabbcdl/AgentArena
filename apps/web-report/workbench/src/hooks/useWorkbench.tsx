import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { apiFetch, eventStreamUrl } from "../api/client";
import { demoRun } from "../data/demo";
import { formatUserError } from "../domain/errors";
import { type NormalizedRun, normalizeRun } from "../domain/run";
import { DEFAULT_SCORE_MODE, normalizeScoreMode } from "../domain/score-mode.ts";
import { createViewTelemetryDeduper } from "../domain/telemetry";
import type { AdapterInfo, Density, EnvironmentState, InstallGuide, Locale, PageId, ProviderProfile, RunPlan, TaskPackInfo, TelemetrySummary, Theme, UiInfo, UiRunStatus, WorkbenchContextValue } from "../types";

const RUNS_KEY = "agentarena-workbench-runs-v1";
const PREFS_KEY = "agentarena-workbench-preferences-v1";
const PLAN_KEY = "agentarena-workbench-plan-v1";
const defaultPlan: RunPlan = { repoPath: "", taskPath: "", agentIds: [], scoreMode: DEFAULT_SCORE_MODE, probeAuth: true, maxConcurrency: 1 };
const idleStatus: UiRunStatus = { state: "idle", phase: "idle", logs: [], updatedAt: new Date(0).toISOString() };
const emptyEnvironment: EnvironmentState = { loading: true, error: null, uiInfo: null, adapters: [], taskPacks: [], providers: [], detectedAgents: [], installGuides: [], telemetrySummary: null, checkedAt: null, failed: { adapters: false, taskPacks: false, providers: false, telemetry: false } };
const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

function readJson<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
}

function readLocaleFromUrl(): Locale | null {
  // Support both ?lang= and #/...?lang= (hash routing) for shareable links.
  const fromQuery = new URLSearchParams(window.location.search).get("lang");
  if (fromQuery === "en" || fromQuery === "zh-CN") return fromQuery;
  const hashQuery = window.location.hash.split("?")[1];
  if (hashQuery) {
    const hashLang = new URLSearchParams(hashQuery).get("lang");
    if (hashLang === "en" || hashLang === "zh-CN") return hashLang;
  }
  return null;
}

function initialLocale(preferred?: Locale): Locale {
  return readLocaleFromUrl() ?? preferred ?? "zh-CN";
}

function initialPage(): PageId {
  const candidate = window.location.hash.replace(/^#\/?/, "").split("?")[0] as PageId;
  const pages: PageId[] = ["runs", "plan", "live", "outcome", "evidence", "compare", "library", "environment", "settings"];
  return pages.includes(candidate) ? candidate : "runs";
}

function persistedRuns(): NormalizedRun[] { return readJson<unknown[]>(RUNS_KEY, []).map(normalizeRun); }
function mergeStatus(previous: UiRunStatus, incoming: Partial<UiRunStatus>): UiRunStatus {
  return { ...previous, ...incoming, logs: Array.isArray(incoming.logs) ? incoming.logs : previous.logs, snapshot: incoming.snapshot ? { ...(previous.snapshot ?? {}), ...incoming.snapshot } : previous.snapshot };
}
function upsertRun(items: NormalizedRun[], run: NormalizedRun): NormalizedRun[] { return [run, ...items.filter((item) => item.runId !== run.runId)].slice(0, 250); }

export function WorkbenchProvider({ children }: { children: preact.ComponentChildren }) {
  const preferences = readJson<{ locale?: Locale; theme?: Theme; density?: Density }>(PREFS_KEY, {});
  const initialRuns = useMemo(persistedRuns, []);
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale(preferences.locale));
  const [theme, setThemeState] = useState<Theme>(preferences.theme ?? "system");
  const [density, setDensityState] = useState<Density>(preferences.density ?? "comfortable");
  const [page, setPageState] = useState<PageId>(initialPage);
  const [runs, setRuns] = useState<NormalizedRun[]>(initialRuns);
  const [selectedRunId, setSelectedRunIdState] = useState<string | null>(initialRuns[0]?.runId ?? null);
  const [selectedAgentId, setSelectedAgentIdState] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentState>(emptyEnvironment);
  const [plan, setPlan] = useState<RunPlan>(() => ({ ...defaultPlan, ...readJson<Partial<RunPlan>>(PLAN_KEY, {}) }));
  const [preflight, setPreflight] = useState<Record<string, unknown>[]>([]);
  const [runStatus, setRunStatus] = useState<UiRunStatus>(idleStatus);
  const [notice, setNotice] = useState<WorkbenchContextValue["notice"]>(null);
  const activeRunId = useRef<string | null>(null);
  const telemetryDeduper = useRef(createViewTelemetryDeduper());

  const selectedRun = useMemo(() => runs.find((item) => item.runId === selectedRunId) ?? runs[0] ?? null, [runs, selectedRunId]);
  const persistPreferences = useCallback((next: { locale: Locale; theme: Theme; density: Density }) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private mode */ } }, []);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistPreferences({ locale: next, theme, density });
    // Keep the URL in sync so the active locale is shareable/bookmarkable.
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.history.replaceState(null, "", url.toString());
  }, [density, persistPreferences, theme]);
  const setTheme = useCallback((next: Theme) => { setThemeState(next); persistPreferences({ locale, theme: next, density }); }, [density, locale, persistPreferences]);
  const setDensity = useCallback((next: Density) => { setDensityState(next); persistPreferences({ locale, theme, density: next }); }, [locale, persistPreferences, theme]);
  const setPage = useCallback((next: PageId) => { window.location.hash = `/${next}`; setPageState(next); }, []);
  const trackTelemetry = useCallback((
    event: "app_opened" | "result_viewed" | "preflight_completed" | "evidence_opened",
    props: Record<string, unknown>
  ) => {
    if (!environment.uiInfo?.telemetryEnabled) return;
    void apiFetch("/api/telemetry", { method: "POST", body: JSON.stringify({ event, props }) }).catch(() => undefined);
  }, [environment.uiInfo?.telemetryEnabled]);

  useEffect(() => { const handler = () => setPageState(initialPage()); window.addEventListener("hashchange", handler); return () => window.removeEventListener("hashchange", handler); }, []);
  useEffect(() => { document.documentElement.lang = locale; document.documentElement.dataset.theme = theme; document.documentElement.dataset.density = density; }, [density, locale, theme]);
  useEffect(() => { try { localStorage.setItem(RUNS_KEY, JSON.stringify(runs.map((item) => item.raw))); } catch { /* unavailable */ } }, [runs]);
  useEffect(() => { try { localStorage.setItem(PLAN_KEY, JSON.stringify(plan)); } catch { /* unavailable */ } }, [plan]);

  const absorbStatus = useCallback((incoming: UiRunStatus) => {
    setRunStatus((previous) => mergeStatus(previous, incoming));
    if (incoming.runId) activeRunId.current = incoming.runId;
    if (incoming.result?.run) {
      const normalized = normalizeRun(incoming.result.run);
      setRuns((items) => upsertRun(items, normalized));
      setSelectedRunIdState(normalized.runId);
      setSelectedAgentIdState(normalized.results[0]?.variantId ?? null);
    }
  }, []);

  const refreshEnvironment = useCallback(async () => {
    setEnvironment((previous) => ({ ...previous, loading: true, error: null }));
    const [uiInfoResult, adaptersResult, tasksResult, providersResult, detectionResult, statusResult, guidesResult, telemetryResult] = await Promise.allSettled([
      apiFetch<UiInfo>("/api/ui-info"), apiFetch<AdapterInfo[]>("/api/adapters"),
      apiFetch<TaskPackInfo[]>(`/api/taskpacks${plan.repoPath ? `?repoPath=${encodeURIComponent(plan.repoPath)}` : ""}`),
      apiFetch<ProviderProfile[]>("/api/provider-profiles"), apiFetch<Array<Record<string, unknown>>>("/api/agent-detection"), apiFetch<UiRunStatus>("/api/run-status"),
      apiFetch<InstallGuide[]>("/api/install-guides"), apiFetch<TelemetrySummary>("/api/telemetry-summary")
    ]);
    const uiInfo = uiInfoResult.status === "fulfilled" ? uiInfoResult.value : null;
    const adapters = adaptersResult.status === "fulfilled" ? adaptersResult.value : [];
    const taskPacks = tasksResult.status === "fulfilled" ? tasksResult.value : [];
    const providers = providersResult.status === "fulfilled" ? providersResult.value : [];
    const detectedAgents = detectionResult.status === "fulfilled" ? detectionResult.value : [];
    const installGuides = guidesResult.status === "fulfilled" ? guidesResult.value : [];
    const telemetrySummary = telemetryResult.status === "fulfilled" ? telemetryResult.value : null;
    const failures = [uiInfoResult, adaptersResult, tasksResult, providersResult, detectionResult].filter((item) => item.status === "rejected");
    const offlineError = failures.length === 5
      ? formatUserError((failures[0] as PromiseRejectedResult).reason, locale)
      : null;
    // Track per-section failures so consumers can show "load failed / retry"
    // instead of an empty list that reads as a genuine zero.
    const failed = {
      adapters: adaptersResult.status === "rejected",
      taskPacks: tasksResult.status === "rejected",
      providers: providersResult.status === "rejected",
      telemetry: telemetryResult.status === "rejected"
    };
    setEnvironment({ loading: false, error: offlineError, uiInfo, adapters, taskPacks, providers, detectedAgents, installGuides, telemetrySummary, checkedAt: new Date().toISOString(), failed });
    if (statusResult.status === "fulfilled") absorbStatus(statusResult.value);
    setPlan((current) => ({ ...current, repoPath: current.repoPath || uiInfo?.repoPath || "", taskPath: current.taskPath || uiInfo?.defaultTaskPath || taskPacks[0]?.path || "", agentIds: current.agentIds.length > 0 ? current.agentIds : adapters.filter((item) => item.kind === "demo").slice(0, 3).map((item) => item.id) }));
  }, [absorbStatus, locale, plan.repoPath]);

  useEffect(() => { void refreshEnvironment(); }, []);
  useEffect(() => {
    if (!environment.uiInfo?.telemetryEnabled || !telemetryDeduper.current.markAppOpened()) return;
    trackTelemetry("app_opened", { entryPoint: "workbench", language: locale, hasRuns: runs.length > 0 });
  }, [environment.uiInfo?.telemetryEnabled, locale, runs.length, trackTelemetry]);
  useEffect(() => {
    if (!environment.uiInfo?.telemetryEnabled || !selectedRun || !telemetryDeduper.current.markResultViewed(selectedRun.runId)) return;
    const hasInlineDiff = selectedRun.results.some((item) => Array.isArray(item.fileDiffs) && item.fileDiffs.length > 0);
    trackTelemetry("result_viewed", {
      entryPoint: "workbench",
      resultIntegrity: selectedRun.integrity,
      sourceKind: selectedRun.source.kind,
      agentCount: selectedRun.results.length,
      scoreMode: normalizeScoreMode(selectedRun.scoreMode),
      hasInlineDiff
    });
  }, [environment.uiInfo?.telemetryEnabled, selectedRun, trackTelemetry]);
  useEffect(() => {
    if (!environment.uiInfo?.telemetryEnabled || page !== "evidence" || !selectedRun) return;
    if (!telemetryDeduper.current.markEvidenceOpened(selectedRun.runId)) return;
    const hasInlineDiff = selectedRun.results.some((item) => Array.isArray(item.fileDiffs) && item.fileDiffs.length > 0);
    trackTelemetry("evidence_opened", {
      entryPoint: "workbench",
      resultIntegrity: selectedRun.integrity,
      hasInlineDiff
    });
  }, [environment.uiInfo?.telemetryEnabled, page, selectedRun, trackTelemetry]);
  useEffect(() => {
    if (runStatus.state !== "running" && runStatus.state !== "cancelling") return;
    const poll = window.setInterval(() => { void apiFetch<UiRunStatus>("/api/run-status").then(absorbStatus).catch(() => undefined); }, 1000);
    return () => window.clearInterval(poll);
  }, [absorbStatus, runStatus.state]);
  useEffect(() => {
    if (runStatus.state !== "running") return;
    let source: EventSource | null = null;
    try {
      source = new EventSource(eventStreamUrl("/api/run-stream"));
      const update = (event: Event) => { try { absorbStatus(JSON.parse((event as MessageEvent).data) as UiRunStatus); } catch { /* malformed */ } };
      source.addEventListener("snapshot", update);
      source.addEventListener("progress", (event) => { try { setRunStatus((previous) => mergeStatus(previous, JSON.parse((event as MessageEvent).data) as Partial<UiRunStatus>)); } catch { /* malformed */ } });
      source.addEventListener("activity", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as Record<string, unknown>;
          const message = typeof data.line === "string" ? data.line : "Activity";
          setRunStatus((previous) => ({ ...previous, updatedAt: new Date().toISOString(), logs: [...previous.logs, { timestamp: new Date().toISOString(), message, variantId: typeof data.variantId === "string" ? data.variantId : undefined, agentId: typeof data.agentId === "string" ? data.agentId : undefined }].slice(-400) }));
        } catch { /* malformed */ }
      });
      source.addEventListener("done", () => { source?.close(); void apiFetch<UiRunStatus>("/api/run-status").then(absorbStatus).catch(() => undefined); });
    } catch { /* polling remains active */ }
    return () => source?.close();
  }, [absorbStatus, runStatus.state]);

  const updatePlan = useCallback((patch: Partial<RunPlan>) => {
    setPlan((current) => {
      const next = { ...current, ...patch };
      if (patch.scoreMode !== undefined) next.scoreMode = normalizeScoreMode(patch.scoreMode);
      return next;
    });
    if (patch.agentIds !== undefined || patch.repoPath !== undefined || patch.taskPath !== undefined) {
      setPreflight([]);
    }
  }, []);

  const saveProviderProfile = useCallback(async (payload: Record<string, unknown>): Promise<void> => {
    const id = typeof payload.id === "string" && payload.id ? payload.id : undefined;
    const url = id ? `/api/provider-profiles/${encodeURIComponent(id)}` : "/api/provider-profiles";
    const method = id ? "PUT" : "POST";
    await apiFetch(url, { method, body: JSON.stringify(payload) });
    await refreshEnvironment();
  }, [refreshEnvironment]);

  const deleteProviderProfile = useCallback(async (id: string): Promise<void> => {
    await apiFetch(`/api/provider-profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshEnvironment();
  }, [refreshEnvironment]);
  const runPreflight = useCallback(async () => {
    if (plan.agentIds.length === 0) { setNotice({ kind: "warning", message: locale === "zh-CN" ? "请至少选择一个 Agent。" : "Select at least one agent." }); return; }
    const results = await Promise.all(plan.agentIds.map(async (agentId) => {
      try { const result = await apiFetch<Record<string, unknown>>("/api/quick-preflight", { method: "POST", body: JSON.stringify({ baseAgentId: agentId, displayLabel: environment.adapters.find((item) => item.id === agentId)?.title ?? agentId }) }); return { ...result, agentId }; }
      catch (error) { return { agentId, status: "error", error: formatUserError(error, locale) }; }
    }));
    setPreflight(results);
    const blocked = results.some((item) => ["blocked", "missing", "error"].includes(String(item.status)));
    trackTelemetry("preflight_completed", {
      entryPoint: "workbench-plan",
      blocked,
      selectedCount: plan.agentIds.length
    });
    setNotice({ kind: blocked ? "warning" : "success", message: blocked ? (locale === "zh-CN" ? "运行前检查发现需要处理的问题。" : "Preflight found issues that need attention.") : (locale === "zh-CN" ? "运行前检查通过。" : "Preflight passed.") });
  }, [environment.adapters, locale, plan.agentIds, trackTelemetry]);

  const startRun = useCallback(async () => {
    if (!plan.repoPath || !plan.taskPath || plan.agentIds.length === 0) { setNotice({ kind: "warning", message: locale === "zh-CN" ? "请补全仓库、任务和 Agent。" : "Complete repository, task, and agent selections." }); return; }
    try {
      const scoreMode = normalizeScoreMode(plan.scoreMode);
      const response = await apiFetch<UiRunStatus>("/api/run", { method: "POST", body: JSON.stringify({ repoPath: plan.repoPath, taskPath: plan.taskPath, agentIds: plan.agentIds, probeAuth: plan.probeAuth, scoreMode, maxConcurrency: plan.maxConcurrency, entryPoint: "workbench-plan" }) });
      absorbStatus(response); setNotice({ kind: "success", message: locale === "zh-CN" ? "评测已经启动。" : "Evaluation started." }); setPage("live");
    } catch (error) { setNotice({ kind: "danger", message: formatUserError(error, locale) }); }
  }, [absorbStatus, locale, plan, setPage]);

  const cancelRun = useCallback(async () => {
    try { const response = await apiFetch<UiRunStatus>("/api/run/cancel", { method: "POST", body: "{}" }); absorbStatus(response); setNotice({ kind: "warning", message: locale === "zh-CN" ? "取消请求已发送。" : "Cancellation requested." }); }
    catch (error) { setNotice({ kind: "danger", message: formatUserError(error, locale) }); }
  }, [absorbStatus, locale]);

  const loadDemo = useCallback(() => {
    const normalized = normalizeRun(demoRun); setRuns((items) => upsertRun(items, normalized)); setSelectedRunIdState(normalized.runId); setSelectedAgentIdState(normalized.results[0]?.variantId ?? null); setPage("outcome"); setNotice({ kind: "info", message: locale === "zh-CN" ? "已载入安全 Demo，以下均为模拟数据。" : "Safe demo loaded. All values are simulated." });
  }, [locale, setPage]);

  const importRuns = useCallback(async (files: FileList | File[]) => {
    const errors: string[] = []; const imported: NormalizedRun[] = [];
    for (const file of Array.from(files)) {
      try {
        const parsed = JSON.parse(await file.text()) as unknown;
        const values = parsed && typeof parsed === "object" && "runs" in parsed && Array.isArray((parsed as { runs: unknown }).runs) ? (parsed as { runs: unknown[] }).runs : [parsed];
        for (const value of values) imported.push(normalizeRun({ ...(value as Record<string, unknown>), imported: true, source: { kind: "imported", label: file.name } }));
      } catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (imported.length > 0) { setRuns((items) => imported.reduce((all, item) => upsertRun(all, item), items)); setSelectedRunIdState(imported[0].runId); setSelectedAgentIdState(imported[0].results[0]?.variantId ?? null); setPage("outcome"); }
    return { imported: imported.length, errors };
  }, [setPage]);

  const setSelectedRunId = useCallback((runId: string) => { const next = runs.find((item) => item.runId === runId) ?? null; setSelectedRunIdState(runId); setSelectedAgentIdState(next?.results[0]?.variantId ?? null); }, [runs]);
  const value: WorkbenchContextValue = { locale, theme, density, page, setPage, setLocale, setTheme, setDensity, runs, selectedRun, selectedAgentId, setSelectedRunId, setSelectedAgentId: setSelectedAgentIdState, importRuns, loadDemo, environment, refreshEnvironment, saveProviderProfile, deleteProviderProfile, plan, updatePlan, preflight, runPreflight, runStatus, startRun, cancelRun, notice, setNotice, clearNotice: () => setNotice(null) };
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue { const value = useContext(WorkbenchContext); if (!value) throw new Error("useWorkbench must be used inside WorkbenchProvider"); return value; }
