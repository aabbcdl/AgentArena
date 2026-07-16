import { useState } from "preact/hooks";
import { ProviderEditor } from "../components/ProviderEditor";
import { formatTime, Icon, Notice, PageHeader, Section, StatusPill, t } from "../components/ui";
import { useWorkbench } from "../hooks/useWorkbench";
import type { InstallGuide, ProviderProfile } from "../types";

function detectionFor(items: Array<Record<string, unknown>>, id: string): Record<string, unknown> | undefined {
  return items.find((item) => item.id === id || item.agentId === id);
}

function currentPlatform(): "windows" | "macos" | "linux" {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Win/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return "linux";
}

function installCommandsFor(guide: InstallGuide, platform: "windows" | "macos" | "linux"): Array<{ label: string; command: string }> {
  const bucket = guide.install[platform] ?? guide.install.all ?? {};
  return Object.entries(bucket).map(([label, command]) => ({ label, command }));
}

export function EnvironmentPage() {
  const { locale, environment, refreshEnvironment } = useWorkbench();
  const [editing, setEditing] = useState<ProviderProfile | "new" | null>(null);
  const platform = currentPlatform();
  const connected = !environment.error && environment.uiInfo !== null;
  const problems = environment.adapters.filter((adapter) => {
    const detection = detectionFor(environment.detectedAgents, adapter.id);
    return detection && detection.installed === false;
  });
  const guideFor = (id: string): InstallGuide | undefined => environment.installGuides.find((guide) => guide.id === id);

  const copyCommand = async (command: string) => {
    try { await navigator.clipboard?.writeText(command); } catch { /* clipboard unavailable */ }
  };

  return <>
    <PageHeader eyebrow="ENVIRONMENT" title={locale === "zh-CN" ? "环境健康中心" : "Environment health"} description={locale === "zh-CN" ? "集中查看服务、安装、登录、Provider、隔离和存储状态，并补全未安装的 Agent。" : "Inspect service, installation, authentication, provider, isolation, and storage state, and install missing agents."} actions={<button class="button secondary" type="button" onClick={() => void refreshEnvironment()} disabled={environment.loading}><Icon name="refresh"/>{t(locale, "refresh")}</button>}/>
    {environment.loading && <div class="skeleton-lines large"><span/><span/><span/><span/></div>}
    {environment.error && <Notice kind="danger"><strong>{t(locale, "environmentProblem")}</strong><span>{environment.error}</span></Notice>}
    {!environment.loading && <>
      <div class="health-hero"><div class={`health-symbol ${connected ? "healthy" : "unhealthy"}`}><Icon name={connected ? "check" : "danger"} size={30}/></div><div><div class="eyebrow">{t(locale, "status")}</div><h2>{connected ? t(locale, "environmentHealthy") : t(locale, "environmentProblem")}</h2><p>{connected ? `${environment.uiInfo?.host ?? "127.0.0.1"}:${environment.uiInfo?.port ?? ""}` : t(locale, "offline")}</p></div><StatusPill tone={connected ? "success" : "danger"}>{connected ? t(locale, "ready") : t(locale, "blocked")}</StatusPill></div>
      {environment.uiInfo?.riskNotice && <Notice kind="warning">{environment.uiInfo.riskNotice}</Notice>}
      <div class="health-grid">
        <Section title={locale === "zh-CN" ? "本地服务" : "Local service"}><dl class="detail-list"><div><dt>{t(locale, "status")}</dt><dd>{connected ? t(locale, "ready") : t(locale, "blocked")}</dd></div><div><dt>{t(locale, "version")}</dt><dd>{environment.uiInfo?.version?.version ?? t(locale, "unknown")}{environment.uiInfo?.version?.buildNumber ? ` #${environment.uiInfo.version.buildNumber}` : ""}</dd></div><div><dt>{t(locale, "repo")}</dt><dd><code>{environment.uiInfo?.repoPath ?? t(locale, "unknown")}</code></dd></div><div><dt>{t(locale, "lastChecked")}</dt><dd>{formatTime(environment.checkedAt, locale)}</dd></div></dl></Section>
        <Section title={t(locale, "agents")} description={`${environment.adapters.length - problems.length}/${environment.adapters.length} ${t(locale, "ready")}`}><div class="compact-list">{environment.adapters.slice(0, 12).map((adapter) => { const detection = detectionFor(environment.detectedAgents, adapter.id); const installed = detection?.installed !== false; return <div class="compact-row"><Icon name="agent"/><div><strong>{adapter.title}</strong><small>{String(detection?.version ?? adapter.id)}</small></div>{installed ? <StatusPill tone="success">{t(locale, "installed")}</StatusPill> : <StatusPill tone="danger">{t(locale, "notInstalled")}</StatusPill>}</div>; })}</div></Section>
        <Section title={t(locale, "provider")} description={locale === "zh-CN" ? "官方配置与临时隔离明确分开。" : "Official configuration and temporary isolation stay explicit."} actions={<button class="button secondary compact-button" type="button" onClick={() => setEditing("new")}>{t(locale, "providerAdd")}</button>}>
          <div class="compact-list">{environment.providers.length === 0 ? <p class="muted-line">{t(locale, "missing")}</p> : environment.providers.map((provider) => <div class="compact-row"><Icon name="environment"/><div><strong>{provider.name}</strong><small>{provider.primaryModel ?? provider.apiFormat ?? provider.id}</small></div><div class="row-actions"><StatusPill tone={provider.kind === "official" ? "success" : "info"}>{provider.kind === "official" ? t(locale, "localOfficial") : t(locale, "isolatedProvider")}</StatusPill>{!provider.isBuiltIn && <button class="button ghost compact-button" type="button" onClick={() => setEditing(provider)}>{t(locale, "providerEdit")}</button>}</div></div>)}</div>
          {editing && <ProviderEditor locale={locale} editing={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
        </Section>
        <Section title={locale === "zh-CN" ? "需要处理" : "Needs attention"}>
          {problems.length === 0
            ? <div class="all-clear"><Icon name="check"/><span>{locale === "zh-CN" ? "没有发现安装阻断。" : "No installation blockers found."}</span></div>
            : <div class="install-guide-list">{problems.map((adapter) => {
                const guide = guideFor(adapter.id);
                const commands = guide ? installCommandsFor(guide, platform) : [];
                return (
                  <div class="install-guide" key={adapter.id}>
                    <div class="install-guide-head"><Icon name="danger"/><div><strong>{adapter.title}</strong><small>{locale === "zh-CN" ? "未检测到本地命令，请安装后重新检查。" : "Local command not detected. Install it, then check again."}</small></div></div>
                    {guide && (
                      <div class="install-guide-body">
                        {guide.warnings?.map((warning) => <Notice kind="warning">{warning}</Notice>)}
                        {commands.length > 0 ? (
                          <div class="command-list">
                            {commands.map((entry) => (
                              <div class="command-row" key={entry.command}>
                                <code class="command-text">{entry.command}</code>
                                <button class="button ghost compact-button" type="button" onClick={() => void copyCommand(entry.command)}>{t(locale, "copyCommand")}</button>
                              </div>
                            ))}
                          </div>
                        ) : <p class="muted-line">{t(locale, "installSeeDocs")}</p>}
                        {guide.postInstall?.length ? <ul class="post-install">{guide.postInstall.map((step) => <li>{step}</li>)}</ul> : null}
                        <div class="install-guide-links">
                          {guide.docs && <a class="link-button" href={guide.docs} target="_blank" rel="noreferrer">{t(locale, "installDocs")}</a>}
                          {guide.homepage && <a class="link-button" href={guide.homepage} target="_blank" rel="noreferrer">{t(locale, "installHomepage")}</a>}
                          {guide.github && <a class="link-button" href={guide.github} target="_blank" rel="noreferrer">GitHub</a>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}</div>}
        </Section>
      </div>
    </>}
  </>;
}
