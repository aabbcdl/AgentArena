import { useMemo, useState } from "preact/hooks";
import { authenticateWithPassword, clearAuthToken, setAuthToken } from "../api/client";
import { ProviderEditor } from "../components/ProviderEditor";
import { formatTime, Icon, Notice, PageHeader, Section, Skeleton, StatusPill, t } from "../components/ui";
import { runtimeProfileLabel, runtimeStageSummary } from "../domain/runtime-profile";
import { useWorkbench } from "../hooks/useWorkbench";
import type { Locale, RuntimeProfile, RuntimeReadiness, RuntimeReadinessProjection, RuntimeVerificationProgressStage, RuntimeVerificationStage } from "../types";

function agentLabel(agentKind: RuntimeProfile["agentKind"]): string {
  return agentKind === "codex" ? "Codex CLI" : "Claude Code";
}

function readinessLabel(locale: Locale, readiness: RuntimeReadiness): string {
  const labels: Record<RuntimeReadiness, { "zh-CN": string; en: string }> = {
    "not-installed": { "zh-CN": "未安装", en: "Not installed" },
    installed: { "zh-CN": "已安装", en: "Installed" },
    "conversation-ready": { "zh-CN": "对话可用", en: "Conversation ready" },
    "task-ready": { "zh-CN": "任务可用", en: "Task ready" },
    blocked: { "zh-CN": "已阻断", en: "Blocked" },
    changed: { "zh-CN": "配置已变化", en: "Changed" }
  };
  return labels[readiness][locale];
}

function readinessTone(readiness: RuntimeReadiness): "success" | "warning" | "danger" | "info" | "neutral" {
  if (readiness === "task-ready") return "success";
  if (readiness === "conversation-ready" || readiness === "installed") return "info";
  if (readiness === "changed") return "warning";
  return readiness === "not-installed" || readiness === "blocked" ? "danger" : "neutral";
}

function stageLabel(locale: Locale, stage: RuntimeVerificationStage["stage"]): string {
  if (stage === "installation") return locale === "zh-CN" ? "安装" : "Installation";
  if (stage === "conversation") return locale === "zh-CN" ? "真实对话" : "Conversation";
  return locale === "zh-CN" ? "仓库修改" : "Repository task";
}

type DisplayRuntimeStage = RuntimeVerificationStage | RuntimeVerificationProgressStage;

function stageTone(stage: DisplayRuntimeStage): "success" | "warning" | "danger" | "info" | "neutral" {
  if (stage.status === "passed") return "success";
  if (stage.status === "failed") return "danger";
  if (stage.status === "running") return "info";
  return "neutral";
}

function stageStatus(locale: Locale, stage: DisplayRuntimeStage): string {
  if (stage.status === "passed") return locale === "zh-CN" ? "通过" : "Passed";
  if (stage.status === "failed") return locale === "zh-CN" ? "失败" : "Failed";
  if (stage.status === "running") return locale === "zh-CN" ? "运行中" : "Running";
  if (stage.status === "pending") return locale === "zh-CN" ? "等待中" : "Pending";
  return locale === "zh-CN" ? "未验证" : "Not verified";
}

function displayStageSummary(locale: Locale, stage: DisplayRuntimeStage): string {
  if (stage.status === "running") {
    if (locale === "zh-CN") {
      if (stage.stage === "installation") return "正在检查 CLI 安装和版本...";
      if (stage.stage === "conversation") return "正在发起一次真实 Provider 对话...";
      return "正在隔离仓库中测试约定的文件修改...";
    }
    if (stage.stage === "installation") return "Checking the CLI installation and version...";
    if (stage.stage === "conversation") return "Running a real Provider conversation...";
    return "Testing the exact repository edit in a disposable copy...";
  }
  if (stage.status === "pending") return locale === "zh-CN" ? "等待前一阶段完成" : "Waiting for the previous stage.";
  return runtimeStageSummary(locale, stage as RuntimeVerificationStage);
}

function readinessFor(profile: RuntimeProfile, projections: RuntimeReadinessProjection[]): RuntimeReadinessProjection | undefined {
  return projections.find((entry) => entry.profile.id === profile.id);
}

interface RuntimeFailureCopy {
  category: string;
  summary: string;
  title: string;
  action: string;
}

function failureFor(projection: RuntimeReadinessProjection | undefined): { category: string; summary: string } | undefined {
  if (projection?.failure) {
    return { category: projection.failure.errorCategory, summary: projection.failure.summary };
  }
  const failedStage = projection?.stages.find((stage) => stage.status === "failed");
  if (!failedStage) return undefined;
  return {
    category: failedStage.errorCategory ?? "process-crashed",
    summary: failedStage.summary
  };
}

function runtimeFailureCopy(locale: Locale, category: string, summary: string): RuntimeFailureCopy {
  const messages: Record<string, { "zh-CN": [string, string]; en: [string, string] }> = {
    "installation-missing": {
      "zh-CN": ["未找到 CLI", "请先在启动 AgentArena 的同一终端确认命令可运行，再刷新本地状态。"],
      en: ["CLI not found", "Confirm the command works in the terminal that starts AgentArena, then refresh local state."]
    },
    "installation-changed": {
      "zh-CN": ["CLI 已发生变化", "版本或可执行文件已变化，请重新运行三阶段验证。"],
      en: ["CLI changed", "The version or executable changed. Run three-stage verification again."]
    },
    "profile-invalid": {
      "zh-CN": ["运行配置无效", "检查 Provider 协议、Base URL、模型和额外环境变量后重新保存。"],
      en: ["Runtime profile is invalid", "Review the Provider protocol, Base URL, model, and extra environment variables, then save again."]
    },
    "secret-missing": {
      "zh-CN": ["缺少 Provider 密钥", "编辑此配置并保存任务专用密钥，然后重新验证。"],
      en: ["Provider secret is missing", "Edit this profile, save its task-scoped secret, then verify again."]
    },
    "authentication-rejected": {
      "zh-CN": ["Provider 拒绝了认证", "检查密钥是否有效、是否有模型权限，以及 Base URL 是否对应此密钥。"],
      en: ["Provider rejected authentication", "Check the secret, model access, and whether the Base URL belongs to that credential."]
    },
    "provider-unreachable": {
      "zh-CN": ["无法连接 Provider", "检查网络、代理、DNS 和 Base URL 后重试。"],
      en: ["Provider is unreachable", "Check the network, proxy, DNS, and Base URL, then retry."]
    },
    "provider-overloaded": {
      "zh-CN": ["Provider 暂时无可用容量", "当前 CLI 和配置已被识别，无需重新登录。等待 Provider 恢复或切换可用账号池后重新验证。"],
      en: ["Provider has no available capacity", "The CLI and configuration were recognized; no new login is needed. Retry after capacity recovers or switch to an available account pool."]
    },
    "quota-exhausted": {
      "zh-CN": ["Provider 配额已用尽", "补充余额或配额，或改用有可用额度的密钥后重新验证。"],
      en: ["Provider quota is exhausted", "Add balance or quota, or use a credential with available quota, then verify again."]
    },
    "model-unavailable": {
      "zh-CN": ["请求模型不可用", "确认模型名称和账号权限，或在运行配置中改用可用模型。"],
      en: ["Requested model is unavailable", "Confirm the model name and account access, or choose an available model in the runtime profile."]
    },
    "protocol-mismatch": {
      "zh-CN": ["Provider 协议不匹配", "确认 Provider 使用 Responses、Chat Completions 还是 Anthropic Messages 协议。"],
      en: ["Provider protocol mismatch", "Confirm whether the Provider uses Responses, Chat Completions, or Anthropic Messages."]
    },
    "harness-startup-failed": {
      "zh-CN": ["Harness 启动失败", "先在同一终端直接运行该 CLI；若可运行，再检查自定义命令路径和启动环境。"],
      en: ["Harness failed to start", "Run the CLI directly in the same terminal, then check the custom command path and startup environment."]
    },
    "harness-config-drift": {
      "zh-CN": ["验证后的环境已变化", "CLI、配置、仓库或 Harness 指纹发生变化，请重新运行三阶段验证。"],
      en: ["Environment changed after verification", "The CLI, profile, repository, or Harness fingerprint changed. Verify again."]
    },
    "permission-blocked": {
      "zh-CN": ["任务被权限策略阻断", "检查仓库写权限以及 CLI 的非交互权限配置；AgentArena 不会启用完全权限绕过。"],
      en: ["Task was blocked by permissions", "Check repository write access and unattended CLI permissions. AgentArena does not enable a full permission bypass."]
    },
    "background-incompatible": {
      "zh-CN": ["CLI 需要交互式终端", "关闭会弹出确认或登录界面的配置，确保命令能在非交互子进程中运行。"],
      en: ["CLI requires an interactive terminal", "Disable prompts or login UI and ensure the command can run in a non-interactive child process."]
    },
    "tooling-startup-failed": {
      "zh-CN": ["工具链启动失败", "检查当前 Harness 继承的 MCP、Hooks、Skills 与项目指令是否能正常加载。"],
      en: ["Tooling failed to start", "Check that inherited MCP, Hooks, Skills, and project instructions load successfully."]
    },
    "probe-timeout": {
      "zh-CN": ["对话验证超时", "检查 Provider 延迟和网络状态，确认没有隐藏的权限提示后重试。"],
      en: ["Conversation verification timed out", "Check Provider latency, network state, and hidden permission prompts, then retry."]
    },
    "task-timeout": {
      "zh-CN": ["仓库任务验证超时", "确认 CLI 能在后台修改一次小文件，并检查 MCP 或 Hooks 是否阻塞退出。"],
      en: ["Repository task verification timed out", "Confirm the CLI can edit a small file in the background and that MCP or Hooks do not block exit."]
    },
    "process-crashed": {
      "zh-CN": ["CLI 进程异常退出", "查看下方诊断摘要，并在同一终端直接运行命令复现。"],
      en: ["CLI process exited unexpectedly", "Review the diagnostic summary below and reproduce the command in the same terminal."]
    },
    "output-format-changed": {
      "zh-CN": ["CLI 输出协议已变化", "升级 AgentArena 或改用受支持的 CLI 版本后重新验证。"],
      en: ["CLI output protocol changed", "Upgrade AgentArena or use a supported CLI version, then verify again."]
    },
    "unexpected-workspace-change": {
      "zh-CN": ["验证产生了额外文件改动", "检查 Hooks、Skills 和项目指令；任务验证只接受约定的单文件修改。"],
      en: ["Verification changed unexpected files", "Review Hooks, Skills, and project instructions. The task probe accepts only its exact single-file change."]
    }
  };
  const localized = messages[category]?.[locale] ?? (
    locale === "zh-CN"
      ? ["运行验证失败", "查看诊断摘要，修复后重新运行三阶段验证。"]
      : ["Runtime verification failed", "Review the diagnostic summary, fix the issue, then run three-stage verification again."]
  );
  return { category, summary, title: localized[0], action: localized[1] };
}

export function EnvironmentPage() {
  const {
    locale,
    environment,
    plan,
    refreshEnvironment,
    refreshRuntimeReadiness,
    verifyRuntimeProfile,
    setNotice
  } = useWorkbench();
  const [editing, setEditing] = useState<RuntimeProfile | "new" | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [authTokenInput, setAuthTokenInput] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const connected = !environment.error && environment.uiInfo !== null;
  const authUsesPassword = environment.uiInfo?.authMode === "password";
  const authSetupRequired = authUsesPassword && environment.uiInfo?.authSetupRequired === true;
  const authTokenFilePath = environment.uiInfo?.authTokenFilePath
    ?? `${environment.uiInfo?.repoPath ?? plan.repoPath}/.agentarena/last-auth-token-${environment.uiInfo?.port ?? 4320}`;
  const authTokenSourceMessage = environment.uiInfo?.authTokenSource === "local-env"
    ? t(locale, "authTokenSourceLocal")
    : environment.uiInfo?.authTokenSource === "cli"
      ? t(locale, "authTokenSourceCli")
      : environment.uiInfo?.authTokenSource === "env"
        ? t(locale, "authTokenSourceEnv")
        : environment.uiInfo?.authTokenSource === "generated"
          ? t(locale, "authTokenSourceGenerated")
          : null;
  const profiles = useMemo(
    () => [...environment.runtimeProfiles].sort((left, right) => {
      if (left.agentKind !== right.agentKind) return left.agentKind.localeCompare(right.agentKind);
      if (left.isBuiltIn !== right.isBuiltIn) return left.isBuiltIn ? -1 : 1;
      return left.name.localeCompare(right.name);
    }),
    [environment.runtimeProfiles]
  );
  const readyCount = environment.runtimeReadiness.filter((entry) => entry.readiness === "task-ready" && entry.receiptMatch).length;

  const refresh = async () => {
    try {
      await refreshRuntimeReadiness(plan.repoPath, plan.taskPath);
      setNotice({
        kind: "info",
        message: locale === "zh-CN"
          ? "已刷新本地安装、配置指纹和验证凭证状态，未发起模型请求。"
          : "Local installation, configuration fingerprints, and receipts refreshed without a model request."
      });
    } catch (error) {
      setNotice({ kind: "danger", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const verify = async (profileId: string) => {
    setVerifyingId(profileId);
    try {
      await verifyRuntimeProfile(profileId);
      setNotice({
        kind: "success",
        message: locale === "zh-CN"
          ? "安装、真实对话和仓库修改三阶段验证均已完成。"
          : "Installation, real conversation, and repository-edit verification completed."
      });
    } catch (error) {
      setNotice({ kind: "danger", message: error instanceof Error ? error.message : String(error) });
      await refreshRuntimeReadiness(plan.repoPath, plan.taskPath).catch(() => undefined);
    } finally {
      setVerifyingId(null);
    }
  };

  const connectRuntimeAuth = async () => {
    const credential = authTokenInput.trim();
    if (!credential) {
      setNotice({ kind: "warning", messageKey: authUsesPassword ? "authPasswordRequired" : "authTokenRequired" });
      return;
    }
    setAuthSubmitting(true);
    try {
      if (authUsesPassword) {
        await authenticateWithPassword(credential, authSetupRequired ? "setup" : "login");
      } else {
        setAuthToken(credential);
      }
      if (authSetupRequired) {
        await refreshEnvironment(plan.repoPath, plan.taskPath);
      } else {
        await refreshRuntimeReadiness(plan.repoPath, plan.taskPath);
      }
      setAuthTokenInput("");
      setNotice({ kind: "success", messageKey: "authConnected" });
    } catch (error) {
      clearAuthToken();
      setNotice({ kind: "danger", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setAuthSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="RUNTIME"
        title={locale === "zh-CN" ? "运行环境" : "Runtime environment"}
        description={locale === "zh-CN"
          ? "配置并验证 Codex CLI 与 Claude Code。所有覆盖只作用于 AgentArena 子进程。"
          : "Configure and verify Codex CLI and Claude Code. Overrides apply only to AgentArena child processes."}
        actions={(
          <>
            <button class="button secondary" type="button" onClick={() => void refresh()} disabled={environment.runtimeLoading || !plan.repoPath}>
              <Icon name="refresh" />
              {locale === "zh-CN" ? "刷新本地状态" : "Refresh local state"}
            </button>
            <button class="button primary" type="button" onClick={() => setEditing("new")}>
              <Icon name="plus" />
              {locale === "zh-CN" ? "新增运行配置" : "Add runtime profile"}
            </button>
          </>
        )}
      />

      {environment.error && (
        <Notice kind="danger">
          <strong>{t(locale, "environmentProblem")}</strong>
          <span>{environment.error}</span>
        </Notice>
      )}

      <div class="runtime-summary-band">
        <div>
          <span>{locale === "zh-CN" ? "本地服务" : "Local service"}</span>
          <strong>{connected ? t(locale, "ready") : t(locale, "offline")}</strong>
          <small>{connected ? `${environment.uiInfo?.host ?? "127.0.0.1"}:${environment.uiInfo?.port ?? ""}` : t(locale, "unknown")}</small>
        </div>
        <div>
          <span>{locale === "zh-CN" ? "当前任务可用" : "Task-ready now"}</span>
          <strong>{readyCount} / {profiles.length}</strong>
          <small>{locale === "zh-CN" ? "绑定当前仓库与任务" : "Bound to the current repository and task"}</small>
        </div>
        <div>
          <span>{locale === "zh-CN" ? "实际验证仓库" : "Verification repository"}</span>
          <strong>{environment.runtimeRepository?.kind === "builtin"
            ? (locale === "zh-CN" ? "内置测试仓库" : "Built-in fixture")
            : (locale === "zh-CN" ? "当前仓库" : "Current repository")}</strong>
          <small>{environment.runtimeRepository?.resolvedPath ?? plan.repoPath ?? t(locale, "unknown")}</small>
        </div>
      </div>

      {!plan.repoPath || !plan.taskPath ? (
        <Notice kind="warning">
          <strong>{locale === "zh-CN" ? "先选择仓库和任务" : "Select a repository and task first"}</strong>
          <span>{locale === "zh-CN" ? "任务级验证必须绑定实际执行仓库。" : "Task readiness must bind to the repository that will actually run."}</span>
        </Notice>
      ) : null}

      <Section
        className="runtime-profiles-section"
        title={locale === "zh-CN" ? "Codex / Claude 运行配置" : "Codex / Claude runtime profiles"}
        description={locale === "zh-CN"
          ? "刷新只做本地探测；点击“运行三阶段验证”才会发起真实模型请求。"
          : "Refresh performs local checks only. A real model request starts only when you run three-stage verification."}
      >
        {environment.runtimeLoading && profiles.length === 0 ? (
          <Skeleton lines={4} large label={t(locale, "loading")} />
        ) : environment.runtimeAuthRequired ? (
          <Notice kind="warning">
            <strong>{authUsesPassword
              ? t(locale, authSetupRequired ? "authSetupTitle" : "authLoginTitle")
              : t(locale, "authRequiredTitle")}</strong>
            <span>{authUsesPassword
              ? t(locale, authSetupRequired ? "authSetupDescription" : "authLoginDescription")
              : t(locale, "authRequiredDescription")}</span>
            {!authUsesPassword && authTokenSourceMessage && <span>{authTokenSourceMessage}</span>}
            {!authUsesPassword && <code class="runtime-auth-path">{authTokenFilePath}</code>}
            <div class="runtime-auth-form">
              <label class="field">
                <span>{t(locale, authUsesPassword ? "servicePasswordLabel" : "authTokenLabel")}</span>
                <input
                  type="password"
                  value={authTokenInput}
                  autoComplete={authUsesPassword ? (authSetupRequired ? "new-password" : "current-password") : "off"}
                  placeholder={t(locale, authUsesPassword ? "servicePasswordPlaceholder" : "authTokenPlaceholder")}
                  onInput={(event) => setAuthTokenInput(event.currentTarget.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") void connectRuntimeAuth(); }}
                />
              </label>
              <button class="button primary" type="button" disabled={authSubmitting} onClick={() => void connectRuntimeAuth()}>
                <Icon name="check" />{authSubmitting
                  ? t(locale, "loading")
                  : t(locale, authUsesPassword ? (authSetupRequired ? "authSetupButton" : "authLoginButton") : "authTokenConnect")}
              </button>
            </div>
          </Notice>
        ) : environment.failed.runtimeProfiles ? (
          <Notice kind="danger">
            <strong>{locale === "zh-CN" ? "运行配置加载失败" : "Runtime profiles failed to load"}</strong>
            <button class="button secondary compact-button" type="button" onClick={() => void refresh()}>
              <Icon name="refresh" />{t(locale, "retry")}
            </button>
          </Notice>
        ) : profiles.length === 0 ? (
          <p class="muted-line">{locale === "zh-CN" ? "没有可用运行配置。" : "No runtime profiles are available."}</p>
        ) : (
          <div class="runtime-profile-list">
            {profiles.map((profile) => {
              const projection = readinessFor(profile, environment.runtimeReadiness);
              const readiness = projection?.readiness ?? "blocked";
              const rawFailure = failureFor(projection);
              const failure = rawFailure
                ? runtimeFailureCopy(locale, rawFailure.category, rawFailure.summary)
                : undefined;
              const verifying = verifyingId === profile.id;
              const activeProgress = environment.runtimeVerificationProgress?.profileId === profile.id
                && environment.runtimeVerificationProgress.state === "running"
                ? environment.runtimeVerificationProgress
                : undefined;
              const completedStages = activeProgress?.stages.filter((stage) =>
                stage.status === "passed" || stage.status === "failed" || stage.status === "skipped"
              ).length ?? 0;
              const progressPercent = activeProgress
                ? Math.min(96, Math.round(((completedStages + (activeProgress.currentStage ? 0.35 : 0)) / 3) * 100))
                : 0;
              const canVerify = Boolean(plan.repoPath && plan.taskPath)
                && readiness !== "not-installed"
                && !(profile.mode === "managed-provider" && !profile.secretStored)
                && verifyingId === null;
              return (
                <article class="runtime-profile-row" key={profile.id}>
                  <header class="runtime-profile-head">
                    <div class="runtime-profile-identity">
                      <span class="agent-option-icon"><Icon name="agent" /></span>
                      <div>
                        <strong>{runtimeProfileLabel(locale, profile)}</strong>
                        <small>{agentLabel(profile.agentKind)} · {profile.mode === "inherit-local"
                          ? (locale === "zh-CN" ? "继承当前本地配置" : "Inherited local setup")
                          : (locale === "zh-CN" ? "任务级 Managed Provider" : "Task-scoped Managed Provider")}</small>
                      </div>
                    </div>
                    <div class="row-actions">
                      <StatusPill tone={readinessTone(readiness)}>{readinessLabel(locale, readiness)}</StatusPill>
                      {!profile.isBuiltIn && (
                        <button class="button ghost compact-button" type="button" onClick={() => setEditing(profile)}>
                          {t(locale, "providerEdit")}
                        </button>
                      )}
                    </div>
                  </header>

                  <dl class="runtime-profile-facts">
                    <div><dt>{t(locale, "version")}</dt><dd>{projection?.installation?.version ?? (readiness === "not-installed" ? t(locale, "missing") : t(locale, "unknown"))}</dd></div>
                    <div><dt>{locale === "zh-CN" ? "模型" : "Model"}</dt><dd>{profile.provider?.requestedModel ?? (locale === "zh-CN" ? "继承 CLI" : "Inherited from CLI")}</dd></div>
                    <div><dt>{locale === "zh-CN" ? "规范模型身份" : "Canonical identity"}</dt><dd>{profile.provider?.canonicalModelIdentity ?? (locale === "zh-CN" ? "未声明，不能进入同模型比较" : "Not declared; excluded from same-model comparison")}</dd></div>
                    <div><dt>{locale === "zh-CN" ? "配置修订" : "Revision"}</dt><dd>r{profile.revision} / s{profile.secretRevision}</dd></div>
                  </dl>

                  {activeProgress && (
                    <div class="runtime-verification-progress" role="status" aria-live="polite">
                      <div class="runtime-verification-progress-head">
                        <div>
                          <strong>{locale === "zh-CN" ? "三阶段验证进行中" : "Three-stage verification in progress"}</strong>
                          <small>{activeProgress.currentStage
                            ? `${locale === "zh-CN" ? "当前阶段" : "Current stage"}: ${stageLabel(locale, activeProgress.currentStage)}`
                            : (locale === "zh-CN" ? "正在准备运行环境" : "Preparing the runtime")}</small>
                        </div>
                        <span>{completedStages} / 3</span>
                      </div>
                      <div class="runtime-verification-progress-track" aria-hidden="true">
                        <span style={{ width: `${progressPercent}%` }} />
                      </div>
                    </div>
                  )}

                  <ul class="runtime-stage-list" aria-label={locale === "zh-CN" ? "验证阶段" : "Verification stages"}>
                    {(["installation", "conversation", "task"] as const).map((stageName) => {
                      const stage = activeProgress?.stages.find((entry) => entry.stage === stageName)
                        ?? projection?.stages.find((entry) => entry.stage === stageName) ?? {
                        stage: stageName,
                        status: "skipped" as const,
                        startedAt: "",
                        durationMs: 0,
                        summary: locale === "zh-CN" ? "尚未验证" : "Not verified"
                      };
                      return (
                        <li class={`runtime-stage runtime-stage-${stage.status}`} key={stageName}>
                          <span class="runtime-stage-icon"><Icon name={stage.status === "passed" ? "check" : stage.status === "failed" ? "danger" : stage.status === "running" ? "info" : "clock"} /></span>
                          <div>
                            <strong>{stageLabel(locale, stageName)}</strong>
                            <small>{displayStageSummary(locale, stage)}</small>
                          </div>
                          <StatusPill tone={stageTone(stage)}>{stageStatus(locale, stage)}</StatusPill>
                        </li>
                      );
                    })}
                  </ul>

                  {failure && (
                    <Notice kind={readiness === "changed" ? "warning" : "danger"}>
                      <strong>{failure.title}</strong>
                      <span>{failure.action}</span>
                      {failure.summary && <code>{failure.summary}</code>}
                    </Notice>
                  )}

                  <footer class="runtime-profile-actions">
                    <span>{projection?.receipt?.createdAt
                      ? `${locale === "zh-CN" ? "最近验证" : "Last verified"}: ${formatTime(projection.receipt.createdAt, locale)}`
                      : (locale === "zh-CN" ? "尚无三阶段验证凭证" : "No three-stage verification receipt")}</span>
                    <button class="button secondary" type="button" disabled={!canVerify} onClick={() => void verify(profile.id)} aria-busy={verifying}>
                      <Icon name="check" />
                      {verifying
                        ? (locale === "zh-CN" ? "验证中" : "Verifying")
                        : (locale === "zh-CN" ? "运行三阶段验证" : "Run three-stage verification")}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </Section>

      <Section className="runtime-boundary" title={locale === "zh-CN" ? "配置边界" : "Configuration boundary"}>
        <div class="runtime-boundary-grid">
          <div><Icon name="check" /><span>{locale === "zh-CN" ? "继承启动服务时的环境、Skills、MCP、Hooks 和项目指令" : "Inherits the service environment, Skills, MCP, Hooks, and project instructions"}</span></div>
          <div><Icon name="check" /><span>{locale === "zh-CN" ? "Provider 覆盖只注入验证和任务子进程" : "Provider overrides are injected only into verification and task child processes"}</span></div>
          <div><Icon name="check" /><span>{locale === "zh-CN" ? "不会改写 ~/.codex/config.toml 或 ~/.claude/settings.json" : "Never rewrites ~/.codex/config.toml or ~/.claude/settings.json"}</span></div>
        </div>
      </Section>

      {editing && (
        <div class="provider-editor-backdrop">
          <ProviderEditor
            locale={locale}
            editing={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
          />
        </div>
      )}
    </>
  );
}
