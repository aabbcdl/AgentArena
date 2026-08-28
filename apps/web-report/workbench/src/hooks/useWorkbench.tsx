import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { apiFetch, eventStreamUrl, isApiErrorStatus } from "../api/client";
import { demoRun } from "../data/demo";
import { formatUserError } from "../domain/errors";
import { normalizeLogEntry } from "../domain/logs";
import { type NormalizedRun, normalizeRun } from "../domain/run";
import { mergeFreshRunStatus } from "../domain/run-status";
import { DEFAULT_SCORE_MODE, normalizeScoreMode } from "../domain/score-mode.ts";
import { createViewTelemetryDeduper } from "../domain/telemetry";
import type { AdapterInfo, AdhocTaskPackPreview, AdhocTaskPackSummary, AgentDetectionResult, CreateAdhocTaskpackRequest, Density, EnvironmentState, InstallGuide, Locale, PageId, RunPlan, RuntimeProfile, RuntimeProfilesResponse, RuntimeVerificationProgress, TaskPackInfo, TelemetrySummary, Theme, UiInfo, UiRunStatus, WorkbenchContextValue } from "../types";

const RUNS_KEY = "agentarena-workbench-runs-v1";
const PREFS_KEY = "agentarena-workbench-preferences-v1";
const PLAN_KEY = "agentarena-workbench-plan-v1";
const defaultPlan: RunPlan = { repoPath: "", taskPath: "", runtimeProfileIds: [], scoreMode: DEFAULT_SCORE_MODE, maxConcurrency: 1 };
const idleStatus: UiRunStatus = { state: "idle", phase: "idle", logs: [], updatedAt: new Date(0).toISOString() };
const emptyEnvironment: EnvironmentState = { loading: true, runtimeLoading: true, runtimeAuthRequired: false, error: null, runStatusLoaded: false, uiInfo: null, adapters: [], taskPacks: [], runtimeProfiles: [], runtimeReadiness: [], runtimeVerificationProgress: null, runtimeRepository: null, detectedAgents: [], installGuides: [], telemetrySummary: null, checkedAt: null, failed: { adapters: false, taskPacks: false, runtimeProfiles: false, telemetry: false } };
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
function upsertRun(items: NormalizedRun[], run: NormalizedRun): NormalizedRun[] { return [run, ...items.filter((item) => item.runId !== run.runId)].slice(0, 250); }

function runtimeProfileIdsFromManifest(raw: Record<string, unknown>): string[] {
  const manifest = raw.jobManifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return [];
  const variants = (manifest as { variants?: unknown }).variants;
  if (!Array.isArray(variants)) return [];
  return [...new Set(variants.flatMap((variant) => {
    if (!variant || typeof variant !== "object" || Array.isArray(variant)) return [];
    const profileId = (variant as { profileId?: unknown }).profileId;
    return typeof profileId === "string" && profileId.trim() ? [profileId.trim()] : [];
  }))];
}

function taskPackFromAdhocSummary(summary: AdhocTaskPackSummary): TaskPackInfo {
  return {
    id: summary.id,
    title: summary.title,
    path: summary.path,
    description: summary.promptPreview,
    difficulty: "medium",
    source: "adhoc",
    lifecycle: "experimental",
    repoSource: "user",
    repoPath: summary.repoPath,
    expectedChangedPaths: summary.expectedChangedPaths,
    evidenceStrength: summary.evidenceStrength ?? "basic",
    warningCodes: summary.warningCodes,
    compatibility: summary.compatibility
      ? {
          status: summary.compatibility.status,
          summary: summary.compatibility.reasons?.join(" "),
          failedChecks: [],
        }
      : undefined,
    objective: summary.promptPreview,
    judgeRationale: "Generated repository-health checks provide basic evidence; they do not prove task-specific correctness.",
  };
}

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
  const [adhocPreview, setAdhocPreview] = useState<AdhocTaskPackPreview | null>(null);
  const [plan, setPlan] = useState<RunPlan>(() => {
    const stored = readJson<Partial<RunPlan>>(PLAN_KEY, {});
    return {
      ...defaultPlan,
      ...stored,
      runtimeProfileIds: Array.isArray(stored.runtimeProfileIds) ? stored.runtimeProfileIds : []
    };
  });
  const [runStatus, setRunStatus] = useState<UiRunStatus>(idleStatus);
  const [notice, setNotice] = useState<WorkbenchContextValue["notice"]>(null);
  const activeRunId = useRef<string | null>(null);
  // Only the newest runtime projection request may publish state.
  const runtimeReadinessRequestId = useRef(0);
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

  const absorbStatus = useCallback((incoming: Partial<UiRunStatus>) => {
    const terminal = incoming.state === "done" || incoming.state === "cancelled" || incoming.state === "error";
    const status = terminal
      ? { ...incoming, currentAgentId: undefined, currentVariantId: undefined, currentDisplayLabel: undefined }
      : incoming;
    setRunStatus((previous) => mergeFreshRunStatus(previous, status));
    if (terminal) {
      setNotice((current) => current?.messageKey === "evaluationStarted" || current?.messageKey === "cancellationRequested"
        ? null
        : current);
    }
    if (incoming.runId) activeRunId.current = incoming.runId;
    if (incoming.result?.run) {
      const normalized = normalizeRun(incoming.result.run);
      setRuns((items) => upsertRun(items, normalized));
      setSelectedRunIdState(normalized.runId);
      setSelectedAgentIdState(normalized.results[0]?.variantId ?? null);
    }
  }, []);

  const fetchRuntimeProfiles = useCallback(async (
    repoPath: string,
    taskPath: string
  ): Promise<RuntimeProfilesResponse> => {
    const query = new URLSearchParams();
    if (repoPath.trim()) query.set("repositoryPath", repoPath.trim());
    if (taskPath.trim()) query.set("taskPath", taskPath.trim());
    return await apiFetch<RuntimeProfilesResponse>(
      `/api/runtime-profiles${query.size > 0 ? `?${query.toString()}` : ""}`
    );
  }, []);

  const refreshRuntimeReadiness = useCallback(async (
    repoPath: string = plan.repoPath,
    taskPath: string = plan.taskPath
  ): Promise<RuntimeProfilesResponse> => {
    const requestId = ++runtimeReadinessRequestId.current;
    setEnvironment((previous) => ({ ...previous, runtimeLoading: true }));
    try {
      const response = await fetchRuntimeProfiles(repoPath, taskPath);
      if (requestId === runtimeReadinessRequestId.current) {
        setEnvironment((previous) => ({
          ...previous,
          runtimeLoading: false,
          runtimeAuthRequired: false,
          runtimeProfiles: response.profiles,
          runtimeReadiness: response.readiness ?? [],
          runtimeRepository: response.repository ?? null,
          failed: { ...previous.failed, runtimeProfiles: false },
          checkedAt: new Date().toISOString()
        }));
      }
      return response;
    } catch (error) {
      if (requestId === runtimeReadinessRequestId.current) {
        setEnvironment((previous) => ({
          ...previous,
          runtimeLoading: false,
          runtimeAuthRequired: isApiErrorStatus(error, 401),
          failed: { ...previous.failed, runtimeProfiles: true }
        }));
      }
      throw error;
    }
  }, [fetchRuntimeProfiles, plan.repoPath, plan.taskPath]);

  const refreshEnvironment = useCallback(async (
    repositoryPathOverride?: string,
    taskPathOverride?: string
  ) => {
    const repositoryPath = repositoryPathOverride ?? plan.repoPath;
    const taskPath = taskPathOverride ?? plan.taskPath;
    const runtimeRequestId = ++runtimeReadinessRequestId.current;
    setEnvironment((previous) => ({ ...previous, loading: true, runtimeLoading: true, error: null, runStatusLoaded: false }));
    const [uiInfoResult, adaptersResult, tasksResult, adhocTasksResult, runtimeResult, detectionResult, statusResult, guidesResult, telemetryResult] = await Promise.allSettled([
      apiFetch<UiInfo>("/api/ui-info"), apiFetch<AdapterInfo[]>("/api/adapters"),
      apiFetch<TaskPackInfo[]>(`/api/taskpacks${repositoryPath ? `?repoPath=${encodeURIComponent(repositoryPath)}` : ""}`),
      apiFetch<AdhocTaskPackSummary[]>(`/api/adhoc-taskpacks${repositoryPath ? `?repoPath=${encodeURIComponent(repositoryPath)}` : ""}`),
      fetchRuntimeProfiles(repositoryPath, taskPath), apiFetch<AgentDetectionResult[]>("/api/agent-detection"), apiFetch<UiRunStatus>("/api/run-status"),
      apiFetch<InstallGuide[]>("/api/install-guides"), apiFetch<TelemetrySummary>("/api/telemetry-summary")
    ]);
    const uiInfo = uiInfoResult.status === "fulfilled" ? uiInfoResult.value : null;
    const adapters = adaptersResult.status === "fulfilled" ? adaptersResult.value : [];
    const officialTaskPacks = tasksResult.status === "fulfilled" ? tasksResult.value : [];
    const adhocTaskPacks = adhocTasksResult.status === "fulfilled"
      ? adhocTasksResult.value.map(taskPackFromAdhocSummary)
      : [];
    const taskPacks = [...officialTaskPacks, ...adhocTaskPacks];
    const runtimeResponse: RuntimeProfilesResponse = runtimeResult.status === "fulfilled"
      ? runtimeResult.value
      : { profiles: [] };
    const detectedAgents = detectionResult.status === "fulfilled" ? detectionResult.value : [];
    const installGuides = guidesResult.status === "fulfilled" ? guidesResult.value : [];
    const telemetrySummary = telemetryResult.status === "fulfilled" ? telemetryResult.value : null;
    const failures = [uiInfoResult, adaptersResult, tasksResult, runtimeResult, detectionResult].filter((item) => item.status === "rejected");
    const offlineError = failures.length === 5
      ? formatUserError((failures[0] as PromiseRejectedResult).reason, locale)
      : null;
    // Track per-section failures so consumers can show "load failed / retry"
    // instead of an empty list that reads as a genuine zero.
    const failed = {
      adapters: adaptersResult.status === "rejected",
      taskPacks: tasksResult.status === "rejected" && adhocTasksResult.status === "rejected",
      runtimeProfiles: runtimeResult.status === "rejected",
      telemetry: telemetryResult.status === "rejected"
    };
    setEnvironment((previous) => {
      const runtimeIsCurrent = runtimeRequestId === runtimeReadinessRequestId.current;
      return {
        ...previous,
        loading: false,
        runtimeLoading: runtimeIsCurrent ? false : previous.runtimeLoading,
        runtimeAuthRequired: runtimeIsCurrent
          ? runtimeResult.status === "rejected" && isApiErrorStatus(runtimeResult.reason, 401)
          : previous.runtimeAuthRequired,
        error: offlineError,
        runStatusLoaded: statusResult.status === "fulfilled",
        uiInfo,
        adapters,
        taskPacks,
        runtimeProfiles: runtimeIsCurrent ? runtimeResponse.profiles : previous.runtimeProfiles,
        runtimeReadiness: runtimeIsCurrent ? (runtimeResponse.readiness ?? []) : previous.runtimeReadiness,
        runtimeVerificationProgress: previous.runtimeVerificationProgress,
        runtimeRepository: runtimeIsCurrent ? (runtimeResponse.repository ?? null) : previous.runtimeRepository,
        detectedAgents,
        installGuides,
        telemetrySummary,
        checkedAt: new Date().toISOString(),
        failed: {
          ...failed,
          runtimeProfiles: runtimeIsCurrent ? failed.runtimeProfiles : previous.failed.runtimeProfiles
        }
      };
    });
    if (statusResult.status === "fulfilled") absorbStatus(statusResult.value);
    setPlan((current) => ({ ...current, repoPath: current.repoPath || uiInfo?.repoPath || "", taskPath: current.taskPath || uiInfo?.defaultTaskPath || taskPacks[0]?.path || "" }));
  }, [absorbStatus, fetchRuntimeProfiles, locale, plan.repoPath, plan.taskPath]);

  useEffect(() => { void refreshEnvironment(); }, []);
  useEffect(() => {
    if (!plan.repoPath.trim()) return;
    const timer = window.setTimeout(() => {
      void refreshRuntimeReadiness(plan.repoPath, plan.taskPath).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [plan.repoPath, plan.taskPath, refreshRuntimeReadiness]);
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
      source.addEventListener("progress", (event) => { try { setRunStatus((previous) => mergeFreshRunStatus(previous, JSON.parse((event as MessageEvent).data) as Partial<UiRunStatus>)); } catch { /* malformed */ } });
      source.addEventListener("activity", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as Record<string, unknown>;
          const message = typeof data.line === "string" ? data.line : "Activity";
          const entry = normalizeLogEntry({
            timestamp: new Date().toISOString(),
            message,
            phase: "benchmark",
            stream: data.stream === "stderr" ? "stderr" : "stdout",
            seq: typeof data.seq === "number" ? data.seq : undefined,
            variantId: typeof data.variantId === "string" ? data.variantId : undefined,
            displayLabel: typeof data.displayLabel === "string" ? data.displayLabel : undefined,
            agentId: typeof data.agentId === "string" ? data.agentId : undefined
          });
          setRunStatus((previous) => ({ ...previous, updatedAt: new Date().toISOString(), logs: [...previous.logs, entry].slice(-400) }));
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
    if (patch.repoPath !== undefined || patch.taskPath !== undefined) {
      // Invalidate responses for the previous repository/task pair. The
      // effect below will request a projection for the new pair.
      runtimeReadinessRequestId.current += 1;
      setEnvironment((previous) => ({
        ...previous,
        runtimeReadiness: [],
        runtimeRepository: null,
        runtimeVerificationProgress: null,
        runtimeLoading: Boolean((patch.repoPath ?? plan.repoPath).trim())
      }));
    }
  }, [plan.repoPath]);

  const createAdhocTaskpack = useCallback(async (request: CreateAdhocTaskpackRequest): Promise<AdhocTaskPackPreview> => {
    const response = await apiFetch<{ path?: string; preview?: AdhocTaskPackPreview }>("/api/create-adhoc-taskpack", {
      method: "POST",
      body: JSON.stringify(request),
    });
    if (!response.preview) throw new Error("The local service did not return an ad-hoc task preview.");
    const preview = response.preview;
    setAdhocPreview(preview);
    setPlan((current) => ({ ...current, repoPath: preview.repoPath, taskPath: response.path ?? current.taskPath }));
    trackTelemetry("preflight_completed", {
      entryPoint: "workbench-adhoc-task",
      blocked: preview.compatibility.status === "incompatible",
      selectedCount: 0,
      taskSource: "adhoc",
      hasExpectedChangedPaths: preview.expectedChangedPaths.length > 0,
      compatibilityStatus: preview.compatibility.status,
      readinessStatus: "unknown",
    });
    await refreshEnvironment(preview.repoPath, response.path ?? "");
    return preview;
  }, [refreshEnvironment, trackTelemetry]);

  const clearAdhocPreview = useCallback(() => setAdhocPreview(null), []);

  const preparePlanFromRun = useCallback((run: NormalizedRun) => {
    const rawTaskPath = typeof run.raw.taskPath === "string" ? run.raw.taskPath : "";
    const matchingTask = environment.taskPacks.find((task) => task.id && task.id === run.task.id);
    const runtimeProfileIds = runtimeProfileIdsFromManifest(run.raw);
    setPlan((current) => ({
      ...current,
      repoPath: run.repository.path ?? current.repoPath,
      taskPath: rawTaskPath || matchingTask?.path || current.taskPath,
      runtimeProfileIds,
      scoreMode: normalizeScoreMode(run.scoreMode),
      maxConcurrency: 1
    }));
    setPage("plan");
    setNotice({ kind: "info", messageKey: "planCopied" });
  }, [environment.taskPacks, setPage]);

  const saveRuntimeProfile = useCallback(async (payload: Record<string, unknown>): Promise<RuntimeProfile | undefined> => {
    const id = typeof payload.id === "string" && payload.id ? payload.id : undefined;
    const url = id ? `/api/runtime-profiles/${encodeURIComponent(id)}` : "/api/runtime-profiles";
    const method = id ? "PUT" : "POST";
    const response = await apiFetch<{ profile?: RuntimeProfile }>(url, { method, body: JSON.stringify(payload) });
    await refreshRuntimeReadiness(plan.repoPath, plan.taskPath);
    return response.profile;
  }, [plan.repoPath, plan.taskPath, refreshRuntimeReadiness]);

  const deleteRuntimeProfile = useCallback(async (id: string): Promise<void> => {
    await apiFetch(`/api/runtime-profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
    setPlan((current) => ({
      ...current,
      runtimeProfileIds: current.runtimeProfileIds.filter((profileId) => profileId !== id)
    }));
    await refreshRuntimeReadiness(plan.repoPath, plan.taskPath);
  }, [plan.repoPath, plan.taskPath, refreshRuntimeReadiness]);

  const verifyRuntimeProfile = useCallback(async (id: string): Promise<void> => {
    if (!plan.repoPath.trim() || !plan.taskPath.trim()) {
      throw new Error(locale === "zh-CN" ? "请先选择仓库和任务。" : "Select a repository and task first.");
    }
    const progressId = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const startedAt = new Date().toISOString();
    const initialProgress: RuntimeVerificationProgress = {
      progressId,
      profileId: id,
      state: "running",
      currentStage: "installation",
      startedAt,
      updatedAt: startedAt,
      stages: (["installation", "conversation", "task"] as const).map((stage) => ({
        stage,
        status: "pending" as const,
        startedAt,
        durationMs: 0,
        summary: "Waiting for this stage."
      }))
    };
    setEnvironment((previous) => ({ ...previous, runtimeLoading: true, runtimeVerificationProgress: initialProgress }));
    let polling = true;
    let pollInFlight = false;
    const pollProgress = async (): Promise<void> => {
      if (!polling || pollInFlight) return;
      pollInFlight = true;
      try {
        const progress = await apiFetch<RuntimeVerificationProgress>(
          `/api/runtime-profiles/${encodeURIComponent(id)}/verify-progress/${encodeURIComponent(progressId)}`
        );
        if (polling) setEnvironment((previous) => ({ ...previous, runtimeVerificationProgress: progress }));
      } catch {
        // The POST request remains authoritative. A transient progress poll failure
        // should not turn a running verification into a false error.
      } finally {
        pollInFlight = false;
      }
    };
    const pollTimer = window.setInterval(() => { void pollProgress(); }, 700);
    void pollProgress();
    try {
      const verification = await apiFetch<{
        receipt?: { readiness?: string; stages?: Array<{ status?: string; errorCategory?: string }> };
      }>(`/api/runtime-profiles/${encodeURIComponent(id)}/verify`, {
        method: "POST",
        body: JSON.stringify({ repositoryPath: plan.repoPath, taskPath: plan.taskPath, progressId })
      });
      await pollProgress();
      await refreshRuntimeReadiness(plan.repoPath, plan.taskPath);
      const taskReady = verification.receipt?.readiness === "task-ready";
      trackTelemetry("preflight_completed", {
        entryPoint: "workbench-environment",
        blocked: !taskReady,
        selectedCount: 1
      });
      if (!taskReady) {
        throw new Error(locale === "zh-CN"
          ? "验证完成，但当前配置仍不可运行。请查看下方具体原因。"
          : "Verification finished, but this profile is still not runnable. Review the reason below.");
      }
    } finally {
      polling = false;
      window.clearInterval(pollTimer);
      setEnvironment((previous) => ({
        ...previous,
        runtimeLoading: false,
        // If the POST already returned but the final progress poll was lost,
        // do not let the optimistic "running" snapshot mask the fresh Receipt
        // and readiness projection.
        runtimeVerificationProgress: previous.runtimeVerificationProgress?.progressId === progressId
          && previous.runtimeVerificationProgress.state === "running"
          ? null
          : previous.runtimeVerificationProgress
      }));
    }
  }, [locale, plan.repoPath, plan.taskPath, refreshRuntimeReadiness, trackTelemetry]);

  const startRun = useCallback(async () => {
    const repoPath = plan.repoPath.trim();
    const taskPath = plan.taskPath.trim();
    if (!repoPath || !taskPath || plan.runtimeProfileIds.length === 0) { setNotice({ kind: "warning", messageKey: "completeSelections" }); return; }
    try {
      // React state may still contain the response from before a task or
      // profile change. Admission must use a fresh server projection.
      const latest = await refreshRuntimeReadiness(repoPath, taskPath);
      const latestProfiles = latest.profiles;
      const latestReadiness = latest.readiness ?? [];
      const selectedProfiles = plan.runtimeProfileIds
        .map((profileId) => latestProfiles.find((profile) => profile.id === profileId))
        .filter((profile): profile is NonNullable<typeof profile> => profile !== undefined);
      const selectedReadiness = plan.runtimeProfileIds.map((profileId) =>
        latestReadiness.find((entry) => entry.profile.id === profileId)
      );
      const invalid = selectedReadiness.find((entry) => entry?.readiness !== "task-ready" || entry.receiptMatch !== true);
      if (selectedProfiles.length !== plan.runtimeProfileIds.length || invalid) {
        const detail = invalid?.failure?.summary
          ?? invalid?.stages.find((stage) => stage.status === "failed")?.summary;
        setNotice({
          kind: "warning",
          message: locale === "zh-CN"
            ? `所选运行配置尚未完成三阶段验证${detail ? `：请重新验证（${detail}）` : "，请重新验证"}。`
            : `Every selected runtime profile must pass all three stages for this repository and task.${detail ? ` ${detail}` : ""}`
        });
        return;
      }
      const scoreMode = normalizeScoreMode(plan.scoreMode);
      const agents = selectedProfiles.map((profile) => ({
        baseAgentId: profile.agentKind,
        runtimeProfileId: profile.id,
        displayLabel: profile.name,
        configSource: "ui" as const,
        ...(typeof latestReadiness.find((entry) => entry.profile.id === profile.id)?.launchSpec?.launchSpecHash === "string"
          ? { launchSpecHash: latestReadiness.find((entry) => entry.profile.id === profile.id)?.launchSpec?.launchSpecHash as string }
          : {}),
        ...(typeof latestReadiness.find((entry) => entry.profile.id === profile.id)?.receipt?.receiptId === "string"
          ? { verificationReceiptId: latestReadiness.find((entry) => entry.profile.id === profile.id)?.receipt?.receiptId as string }
          : {})
      }));
      await apiFetch<{ accepted: true }>("/api/run", { method: "POST", body: JSON.stringify({ repoPath, taskPath, agents, scoreMode, maxConcurrency: 1, entryPoint: "workbench-plan" }) });
      const startedAt = new Date().toISOString();
      setRunStatus({ state: "running", phase: "starting", startedAt, updatedAt: startedAt, repoPath, taskPath, logs: [{ timestamp: startedAt, phase: "starting", message: "Evaluation request accepted." }] });
      setNotice({ kind: "success", messageKey: "evaluationStarted" }); setPage("live");
    } catch (error) { setNotice({ kind: "danger", message: formatUserError(error, locale) }); }
  }, [locale, plan, refreshRuntimeReadiness, setPage]);

  const cancelRun = useCallback(async () => {
    try { await apiFetch<{ cancelled: true }>("/api/run/cancel", { method: "POST", body: "{}" }); absorbStatus({ state: "cancelling" }); setNotice({ kind: "warning", messageKey: "cancellationRequested" }); }
    catch (error) { setNotice({ kind: "danger", message: formatUserError(error, locale) }); }
  }, [absorbStatus, locale]);

  const loadDemo = useCallback(() => {
    const normalized = normalizeRun(demoRun); setRuns((items) => upsertRun(items, normalized)); setSelectedRunIdState(normalized.runId); setSelectedAgentIdState(normalized.results[0]?.variantId ?? null); setPage("outcome"); setNotice({ kind: "info", messageKey: "safeDemoLoaded" });
  }, [locale, setPage]);

  const startDemo = useCallback(async () => {
    let repoPath = environment.uiInfo?.repoPath?.trim() || plan.repoPath.trim();
    let taskPath = environment.uiInfo?.demoTaskPath?.trim()
      || (plan.taskPath.includes("demo-ui-tour.yaml") ? plan.taskPath.trim() : "");
    const preview = normalizeRun(demoRun);
    // Seed the bundled evidence before the first network await. The action can
    // be clicked while bootstrap requests are still in flight, and the
    // preview keeps the evidence route useful during that short hand-off.
    setRuns((items) => upsertRun(items, preview));
    setSelectedRunIdState(preview.runId);
    setSelectedAgentIdState(preview.results[0]?.variantId ?? null);
    try {
      // The action is available before the bootstrap requests necessarily
      // finish. Resolve the authoritative packaged-demo paths on demand so
      // an eager click does not become a misleading no-op.
      if (!repoPath || !taskPath) {
        const freshUiInfo = await apiFetch<UiInfo>("/api/ui-info");
        repoPath = freshUiInfo.repoPath?.trim() || repoPath;
        taskPath = freshUiInfo.demoTaskPath?.trim() || taskPath;
      }
      if (!repoPath || !taskPath) {
        setRuns((items) => items.filter((item) => item.runId !== preview.runId));
        setSelectedRunIdState((current) => current === preview.runId ? null : current);
        setSelectedAgentIdState((current) => current === preview.results[0]?.variantId ? null : current);
        setNotice({
          kind: "warning",
          message: locale === "zh-CN"
            ? "本地服务尚未提供安全 Demo 路径，请稍后重试。"
            : "The local service has not provided the safe demo path yet. Try again shortly."
        });
        return;
      }
      await apiFetch<{ accepted: true }>("/api/run", {
        method: "POST",
        body: JSON.stringify({
          repoPath,
          taskPath,
          agents: ["demo-fast", "demo-thorough"],
          scoreMode: DEFAULT_SCORE_MODE,
          maxConcurrency: 1,
          entryPoint: "workbench-plan"
        })
      });
      const startedAt = new Date().toISOString();
      setRunStatus({
        state: "running",
        phase: "starting",
        startedAt,
        updatedAt: startedAt,
        repoPath,
        taskPath,
        logs: [{ timestamp: startedAt, phase: "starting", message: "Starting packaged safe demo run." }]
      });
      setNotice({ kind: "success", messageKey: "demoAccepted" });
      const currentRoute = window.location.hash.replace(/^#\/?/, "").split("?")[0];
      if (!currentRoute || currentRoute === "runs") setPage("live");
    } catch (error) {
      setRuns((items) => items.filter((item) => item.runId !== preview.runId));
      setSelectedRunIdState((current) => current === preview.runId ? null : current);
      setSelectedAgentIdState((current) => current === preview.results[0]?.variantId ? null : current);
      setNotice({ kind: "danger", message: formatUserError(error, locale) });
    }
  }, [environment.uiInfo?.demoTaskPath, environment.uiInfo?.repoPath, locale, plan.repoPath, plan.taskPath, setPage]);

  const importRuns = useCallback(async (files: FileList | File[]) => {
    const errors: string[] = []; const imported: NormalizedRun[] = [];
    for (const file of Array.from(files)) {
      try {
        const parsed = JSON.parse(await file.text()) as unknown;
        const values = parsed && typeof parsed === "object" && "runs" in parsed && Array.isArray((parsed as { runs: unknown }).runs) ? (parsed as { runs: unknown[] }).runs : [parsed];
        const summaryOnly = /summary/i.test(file.name)
          || values.some((value) => value && typeof value === "object" && !Array.isArray(value)
            && (value as Record<string, unknown>).artifactSchemaVersion === "agentarena.summary/v1");
        for (const value of values) {
          const record = value && typeof value === "object" && !Array.isArray(value)
            ? value as Record<string, unknown>
            : {};
          imported.push(normalizeRun({
            ...record,
            imported: true,
            ...(summaryOnly ? { summaryOnly: true } : {}),
            source: { kind: "imported", label: file.name }
          }));
        }
      } catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (imported.length > 0) { setRuns((items) => imported.reduce((all, item) => upsertRun(all, item), items)); setSelectedRunIdState(imported[0].runId); setSelectedAgentIdState(imported[0].results[0]?.variantId ?? null); setPage("outcome"); }
    return { imported: imported.length, errors };
  }, [setPage]);

  const setSelectedRunId = useCallback((runId: string) => { const next = runs.find((item) => item.runId === runId) ?? null; setSelectedRunIdState(runId); setSelectedAgentIdState(next?.results[0]?.variantId ?? null); }, [runs]);
  const value: WorkbenchContextValue = { locale, theme, density, page, setPage, setLocale, setTheme, setDensity, runs, selectedRun, selectedAgentId, setSelectedRunId, setSelectedAgentId: setSelectedAgentIdState, importRuns, loadDemo, startDemo, environment, refreshEnvironment, adhocPreview, createAdhocTaskpack, clearAdhocPreview, refreshRuntimeReadiness, saveRuntimeProfile, deleteRuntimeProfile, verifyRuntimeProfile, plan, updatePlan, preparePlanFromRun, runStatus, startRun, cancelRun, notice, setNotice, clearNotice: () => setNotice(null) };
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue { const value = useContext(WorkbenchContext); if (!value) throw new Error("useWorkbench must be used inside WorkbenchProvider"); return value; }
