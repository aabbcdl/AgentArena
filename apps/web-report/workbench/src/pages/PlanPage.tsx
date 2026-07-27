import { useMemo, useRef, useState } from "preact/hooks";
import { Field, Icon, Notice, PageHeader, Section, Skeleton, StatusPill, t } from "../components/ui";
import {
  adapterSupportTier,
  isBlockedSupportTier,
  isComingSoonAdapter,
  labelCostAvailability,
  labelPreflightStatus,
  labelSupportTier,
  labelTokenAvailability
} from "../domain/labels";
import { labelScoreMode, SCORE_MODES } from "../domain/score-mode.ts";
import { useWorkbench } from "../hooks/useWorkbench";
import { localizeTaskPack } from "../types";

function detectionFor(items: Array<Record<string, unknown>>, id: string): Record<string, unknown> | undefined {
  return items.find((item) => item.id === id || item.agentId === id);
}

function capabilityString(capability: Record<string, unknown> | undefined, key: string): string {
  const value = capability?.[key];
  return typeof value === "string" ? value : "unavailable";
}

export function PlanPage() {
  const {
    locale,
    environment,
    plan,
    updatePlan,
    preflight,
    runPreflight,
    startRun,
    runStatus,
    setPage,
    refreshEnvironment
  } = useWorkbench();

  const blocked = preflight.some((item) => ["blocked", "missing", "error"].includes(String(item.status)));
  const selectedAdapters = useMemo(
    () => environment.adapters.filter((item) => plan.agentIds.includes(item.id)),
    [environment.adapters, plan.agentIds]
  );
  const localizedTaskPacks = useMemo(
    () => environment.taskPacks.map((task) => localizeTaskPack(task, locale)),
    [environment.taskPacks, locale]
  );
  const selectedTask = localizedTaskPacks.find((item) => item.path === plan.taskPath);

  const selectableIds = useMemo(() => {
    return new Set(
      environment.adapters
        .filter((adapter) => {
          if (isComingSoonAdapter(adapter.title)) return false;
          if (isBlockedSupportTier(adapter.capability)) return false;
          const detection = detectionFor(environment.detectedAgents, adapter.id);
          if (detection && detection.installed === false && adapter.kind !== "demo") return false;
          return true;
        })
        .map((adapter) => adapter.id)
    );
  }, [environment.adapters, environment.detectedAgents]);

  const selectedExperimental = selectedAdapters.some(
    (adapter) => adapterSupportTier(adapter.capability) === "experimental"
  );

  const onlyDemo = selectedAdapters.length > 0 && selectedAdapters.every((item) => item.kind === "demo");
  const preflightDone = preflight.length > 0;
  const baseReady = Boolean(plan.repoPath && plan.taskPath && plan.agentIds.length > 0 && runStatus.state !== "running" && !environment.error);
  const canStart = baseReady && !blocked && (onlyDemo || preflightDone);
  const canSkip = baseReady && !blocked && !onlyDemo && !preflightDone;

  const [starting, setStarting] = useState(false);
  const [preflighting, setPreflighting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const missingBasics = !plan.repoPath || !plan.taskPath || plan.agentIds.length === 0;

  function toggleAgent(agentId: string) {
    if (!selectableIds.has(agentId) && !plan.agentIds.includes(agentId)) return;
    updatePlan({
      agentIds: plan.agentIds.includes(agentId)
        ? plan.agentIds.filter((id) => id !== agentId)
        : [...plan.agentIds, agentId]
    });
  }

  // Prevent double-submit and surface which field is missing at the field itself
  // (not only as a detached global toast), moving focus to the first error.
  async function onStart() {
    if (missingBasics) {
      setShowErrors(true);
      requestAnimationFrame(() => mainRef.current?.querySelector<HTMLElement>(".field-error input, .field-error select")?.focus());
      return;
    }
    setStarting(true);
    try { await startRun(); } finally { setStarting(false); }
  }

  async function onPreflight() {
    setPreflighting(true);
    try { await runPreflight(); } finally { setPreflighting(false); }
  }

  function handleSkipStart() {
    if (!window.confirm(t(locale, "skipPreflightConfirm"))) return;
    void onStart();
  }

  return (
    <>
      <PageHeader
        eyebrow="PLAN"
        title={t(locale, "createEvaluation")}
        description={locale === "zh-CN" ? "启动前确认目标、参赛配置、安全条件和实际提交内容。" : "Confirm the target, participants, safety conditions, and exact submission before starting."}
        actions={<button class="button ghost" type="button" onClick={() => setPage("runs")}>{t(locale, "backToRuns")}</button>}
      />
      {environment.error && (
        <Notice kind="danger">
          <strong>{t(locale, "offline")}</strong>
          <span>{environment.error}</span>
          <button class="button secondary compact-button" type="button" onClick={() => void refreshEnvironment()}>
            <Icon name="refresh" />{t(locale, "offlineRetry")}
          </button>
        </Notice>
      )}
      <div class="plan-layout">
        <div class="plan-main" ref={mainRef}>
          <Section title={t(locale, "target")} description={t(locale, "chooseRepoTask")}>
            <div class="form-grid">
              <Field label={t(locale, "repo")} help={t(locale, "repoPathHelp")} error={showErrors && !plan.repoPath ? t(locale, "fieldRequired") : undefined}>
                <input
                  value={plan.repoPath}
                  onInput={(event) => updatePlan({ repoPath: event.currentTarget.value })}
                  placeholder={environment.uiInfo?.repoPath || "."}
                />
              </Field>
              <Field label={t(locale, "task")} error={showErrors && !plan.taskPath ? t(locale, "fieldRequired") : undefined}>
                <select value={plan.taskPath} onChange={(event) => updatePlan({ taskPath: event.currentTarget.value })}>
                  <option value="">{t(locale, "selectTaskPack")}</option>
                  {localizedTaskPacks.map((task) => <option value={task.path}>{task.title ?? task.id ?? task.path}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section title={t(locale, "participants")} description={`${t(locale, "selected")} ${plan.agentIds.length}`}>
            {environment.loading ? (
              <Skeleton lines={3} label={t(locale, "loading")} />
            ) : environment.failed.adapters ? (
              <Notice kind="danger">
                <strong>{t(locale, "loadFailed")}</strong>
                <button class="button secondary compact-button" type="button" onClick={() => void refreshEnvironment()}>
                  <Icon name="refresh" />{t(locale, "retry")}
                </button>
              </Notice>
            ) : (
              <div class="agent-selector">
                {environment.adapters.map((adapter) => {
                  const selected = plan.agentIds.includes(adapter.id);
                  const comingSoon = isComingSoonAdapter(adapter.title);
                  const blockedTier = isBlockedSupportTier(adapter.capability);
                  const detection = detectionFor(environment.detectedAgents, adapter.id);
                  const notInstalled = Boolean(detection && detection.installed === false && adapter.kind !== "demo");
                  const tier = adapterSupportTier(adapter.capability);
                  const disabled = comingSoon || notInstalled || blockedTier;
                  const badge = comingSoon
                    ? t(locale, "agentComingSoon")
                    : blockedTier
                      ? t(locale, "tierBlocked")
                      : notInstalled
                        ? t(locale, "agentNotInstalled")
                        : adapter.kind === "demo"
                          ? t(locale, "demo")
                          : labelSupportTier(locale, tier);
                  const tone = comingSoon || notInstalled || blockedTier
                    ? "warning"
                    : tier === "supported"
                      ? "success"
                      : tier === "experimental"
                        ? "warning"
                        : adapter.kind === "demo"
                          ? "info"
                          : "neutral";
                  const tokenLabel = labelTokenAvailability(locale, capabilityString(adapter.capability, "tokenAvailability"));
                  const costLabel = labelCostAvailability(locale, capabilityString(adapter.capability, "costAvailability"));
                  return (
                    <label class={`agent-option ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`} key={adapter.id}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={disabled && !selected}
                        onChange={() => toggleAgent(adapter.id)}
                        aria-label={`${adapter.title} · ${badge} · ${tokenLabel} · ${costLabel}`}
                      />
                      <span class="agent-option-icon" aria-hidden="true"><Icon name="agent" /></span>
                      <span>
                        <strong>{adapter.title}</strong>
                        <small>{adapter.kind ?? adapter.id} · {tokenLabel} · {costLabel}</small>
                      </span>
                      <StatusPill tone={tone}>{badge}</StatusPill>
                    </label>
                  );
                })}
              </div>
            )}
            {selectedExperimental && (
              <Notice kind="warning">{t(locale, "agentExperimentalHint")}</Notice>
            )}
            {showErrors && plan.agentIds.length === 0 && !environment.loading && !environment.failed.adapters && (
              <span class="field-message" role="alert">{t(locale, "fieldRequired")}</span>
            )}
          </Section>

          <Section title={t(locale, "safetyRuntime")}>
            <div class="form-grid three">
              <Field label={t(locale, "scoreMode")} help={t(locale, "scoreModeHelp")}>
                <select value={plan.scoreMode} onChange={(event) => updatePlan({ scoreMode: event.currentTarget.value })}>
                  {SCORE_MODES.map((mode) => (
                    <option key={mode} value={mode}>{labelScoreMode(locale, mode)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t(locale, "maxConcurrency")}>
                <input type="number" min="1" max="8" value={plan.maxConcurrency} onInput={(event) => updatePlan({ maxConcurrency: Number(event.currentTarget.value) || 1 })} />
              </Field>
              <div class="field">
                <span class="field-label">{t(locale, "authProbe")}</span>
                <label class="switch-row">
                  <input type="checkbox" checked={plan.probeAuth} onChange={(event) => updatePlan({ probeAuth: event.currentTarget.checked })} />
                  <span>{t(locale, "checkAuthBeforeStart")}</span>
                </label>
              </div>
            </div>
            <button class="button secondary" type="button" onClick={() => void onPreflight()} disabled={plan.agentIds.length === 0 || Boolean(environment.error) || preflighting} aria-busy={preflighting}>
              <Icon name="refresh" />{preflighting ? t(locale, "checking") : t(locale, "runCheck")}
            </button>
            {preflight.length === 0 ? (
              <p class="muted-line">{onlyDemo ? t(locale, "preflightEmpty") : t(locale, "preflightRequired")}</p>
            ) : (
              <div class="preflight-list">
                {preflight.map((item) => {
                  const status = String(item.status ?? "unknown");
                  const tone = ["ready", "pass", "success"].includes(status)
                    ? "success"
                    : ["blocked", "missing", "error"].includes(status)
                      ? "danger"
                      : "warning";
                  return (
                    <div class="preflight-row">
                      <StatusPill tone={tone}>{labelPreflightStatus(locale, status)}</StatusPill>
                      <div>
                        <strong>{String(item.agentId)}</strong>
                        <span>{String(item.message ?? item.error ?? item.authStatus ?? (locale === "zh-CN" ? "检查完成" : "Check complete"))}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        <aside class="plan-summary">
          <div class="sticky-panel">
            <div class="eyebrow">{t(locale, "finalReview")}</div>
            <h2>{t(locale, "readyToSubmit")}</h2>
            <dl>
              <div><dt>{t(locale, "repo")}</dt><dd>{plan.repoPath || t(locale, "missing")}</dd></div>
              <div><dt>{t(locale, "task")}</dt><dd>{selectedTask?.title ?? (plan.taskPath || t(locale, "missing"))}</dd></div>
              <div><dt>{t(locale, "agents")}</dt><dd>{selectedAdapters.map((item) => item.title).join(", ") || t(locale, "missing")}</dd></div>
              <div>
                <dt>{t(locale, "configSource")}</dt>
                <dd>
                  {selectedAdapters.some((item) => item.id === "claude-code") && environment.providers.some((item) => item.kind !== "official")
                    ? t(locale, "isolatedProvider")
                    : t(locale, "localOfficial")}
                </dd>
              </div>
            </dl>
            {blocked && <Notice kind="danger">{t(locale, "preflightBlockedNotice")}</Notice>}
            {!onlyDemo && !preflightDone && !blocked && baseReady && (
              <Notice kind="warning">{t(locale, "preflightRequired")}</Notice>
            )}
            <button class="button primary full" type="button" disabled={(!canStart && !missingBasics) || starting} onClick={() => void onStart()} aria-busy={starting}>
              <Icon name="live" />{starting ? t(locale, "starting") : t(locale, "startRun")}
            </button>
            {canSkip && (
              <button class="button ghost full" type="button" onClick={handleSkipStart}>
                {t(locale, "skipPreflight")}
              </button>
            )}
            <p class="fine-print">{t(locale, "startCreatesRun")}</p>
          </div>
        </aside>
      </div>
    </>
  );
}
