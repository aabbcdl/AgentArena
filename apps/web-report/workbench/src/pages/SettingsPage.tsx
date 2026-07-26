import { Icon, Metric, Notice, PageHeader, Section, StatusPill, t } from "../components/ui";
import { useWorkbench } from "../hooks/useWorkbench";
import type { Density, Locale, Theme } from "../types";

export function SettingsPage() {
  const { locale, theme, density, setLocale, setTheme, setDensity, environment, refreshEnvironment, setPage } = useWorkbench();
  const telemetry = environment.telemetrySummary;
  const telemetryOn = environment.uiInfo?.telemetryEnabled ?? false;
  const telemetryFailed = telemetryOn && environment.failed.telemetry;
  const emptyLabel = telemetryOn ? (telemetryFailed ? t(locale, "loadFailed") : t(locale, "missing")) : t(locale, "measurementOff");
  const events = telemetry?.events ?? {
    app_opened: 0,
    run_started: 0,
    run_completed: 0,
    result_viewed: 0,
    preflight_completed: 0,
    evidence_opened: 0
  };
  const entryPoints = Object.entries(telemetry?.entryPoints ?? {}).sort((left, right) => right[1] - left[1]);
  const integrity = Object.entries(telemetry?.resultIntegrity ?? {}).sort((left, right) => right[1] - left[1]);
  return <>
    <PageHeader eyebrow="SETTINGS" title={t(locale, "settings")} description={locale === "zh-CN" ? "\u8c03\u6574\u754c\u9762\u504f\u597d\uff0c\u5e76\u67e5\u770b\u4ec5\u4fdd\u5b58\u5728\u672c\u5730\u7684\u4f7f\u7528\u7edf\u8ba1\u3002" : "Adjust interface preferences and review local-only usage measurement."}/>
    <div class="settings-layout">
      <Section title={t(locale, "language")}><div class="choice-grid two">{(["zh-CN", "en"] as Locale[]).map((value) => <label class={`choice-card ${locale === value ? "selected" : ""}`}><input type="radio" name="language" checked={locale === value} onChange={() => setLocale(value)}/><span><strong>{value === "zh-CN" ? "\u7b80\u4f53\u4e2d\u6587" : "English"}</strong><small>{value}</small></span></label>)}</div></Section>
      <Section title={t(locale, "appearance")}><div class="choice-grid three">{(["system", "light", "dark"] as Theme[]).map((value) => <label class={`choice-card ${theme === value ? "selected" : ""}`}><input type="radio" name="theme" checked={theme === value} onChange={() => setTheme(value)}/><span><strong>{t(locale, value)}</strong><small>{value === "system" ? (locale === "zh-CN" ? "\u4f7f\u7528\u8bbe\u5907\u8bbe\u7f6e" : "Use device setting") : (locale === "zh-CN" ? "\u72ec\u7acb\u4e3b\u9898" : "Explicit theme")}</small></span></label>)}</div></Section>
      <Section title={t(locale, "density")}><div class="choice-grid two">{(["comfortable", "compact"] as Density[]).map((value) => <label class={`choice-card ${density === value ? "selected" : ""}`}><input type="radio" name="density" checked={density === value} onChange={() => setDensity(value)}/><span><strong>{t(locale, value)}</strong><small>{value === "comfortable" ? (locale === "zh-CN" ? "\u66f4\u9002\u5408\u9605\u8bfb" : "Optimized for reading") : (locale === "zh-CN" ? "\u66f4\u9002\u5408\u9ad8\u9891\u4f7f\u7528" : "Optimized for frequent use")}</small></span></label>)}</div></Section>
      <Section title={locale === "zh-CN" ? "\u672c\u5730\u4f7f\u7528\u7edf\u8ba1" : "Local usage measurement"} description={locale === "zh-CN" ? "\u9ed8\u8ba4\u5173\u95ed\uff0c\u4e0d\u4e0a\u4f20\uff0c\u4e0d\u8bb0\u5f55\u4ed3\u5e93\u8def\u5f84\u3001\u4efb\u52a1\u5185\u5bb9\u6216\u5bc6\u94a5\u3002" : "Off by default, never uploaded, and excludes repository paths, task content, and secrets."} actions={<button class="button ghost" type="button" onClick={() => void refreshEnvironment()}>{locale === "zh-CN" ? "\u5237\u65b0" : "Refresh"}</button>}>
        <p><StatusPill tone={environment.uiInfo?.telemetryEnabled ? "success" : "neutral"}>{environment.uiInfo?.telemetryEnabled ? (locale === "zh-CN" ? "\u5df2\u5f00\u542f" : "Enabled") : (locale === "zh-CN" ? "\u5df2\u5173\u95ed" : "Disabled")}</StatusPill></p>
        {telemetryFailed && <Notice kind="danger"><strong>{t(locale, "loadFailed")}</strong><button class="button secondary compact-button" type="button" onClick={() => void refreshEnvironment()}><Icon name="refresh"/>{t(locale, "retry")}</button></Notice>}
        <div class="metric-grid">
          <Metric label={t(locale, "appOpened")} value={events.app_opened}/>
          <Metric label={t(locale, "runStarted")} value={events.run_started}/>
          <Metric label={t(locale, "runCompleted")} value={events.run_completed}/>
          <Metric label={t(locale, "resultViewed")} value={events.result_viewed}/>
          <Metric label={t(locale, "preflightCompletedLabel")} value={events.preflight_completed ?? 0}/>
          <Metric label={t(locale, "evidenceOpened")} value={events.evidence_opened ?? 0}/>
        </div>
        <div class="two-column">
          <div><h3>{locale === "zh-CN" ? "\u5165\u53e3\u6765\u6e90" : "Entry points"}</h3><div class="compact-list">{entryPoints.length === 0 ? <p class="muted-line">{emptyLabel}</p> : entryPoints.map(([name, count]) => <div class="compact-row"><span>{name}</span><strong>{count}</strong></div>)}</div></div>
          <div><h3>{locale === "zh-CN" ? "\u7ed3\u679c\u5b8c\u6574\u6027" : "Result integrity"}</h3><div class="compact-list">{integrity.length === 0 ? <p class="muted-line">{emptyLabel}</p> : integrity.map(([name, count]) => <div class="compact-row"><span>{name}</span><strong>{count}</strong></div>)}</div></div>
        </div>
      </Section>
      <Section title={t(locale, "providerConfig")} description={t(locale, "providerConfigHint")}>
        <button class="button secondary" type="button" onClick={() => setPage("environment")}><Icon name="environment"/>{t(locale, "goToEnvironment")}</button>
      </Section>
      <p class="settings-note">{t(locale, "savedLocally")}</p>
    </div>
  </>;
}
