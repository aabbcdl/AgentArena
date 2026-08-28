import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Field, Icon, Notice, PageHeader, Section, Skeleton, StatusPill, t } from "../components/ui";
import { formatUserError } from "../domain/errors";
import { inspectPlannedHarnessComparison, type StrictHarnessExclusionReason } from "../domain/harness-comparison.ts";
import { labelTaskDifficulty, taskDifficultyTone } from "../domain/labels.ts";
import { runtimeProfileLabel } from "../domain/runtime-profile.ts";
import { labelScoreMode, SCORE_MODES } from "../domain/score-mode.ts";
import { useWorkbench } from "../hooks/useWorkbench";
import {
  localizeTaskPack,
  type RuntimeProfile,
  type RuntimeReadiness,
  type RuntimeReadinessProjection,
  type RuntimeVerificationProgressStage,
  type RuntimeVerificationStage,
  resolveTaskRepositorySource
} from "../types";

function agentLabel(profile: RuntimeProfile): string {
  return profile.agentKind === "codex" ? "Codex CLI" : "Claude Code";
}

function localCodexProfileMatches(profile: RuntimeProfile, model: string, reasoningEffort: string): boolean {
  return profile.agentKind === "codex"
    && profile.mode === "inherit-local"
    && (profile.provider?.requestedModel ?? "") === model
    && (profile.provider?.reasoningEffort ?? "") === reasoningEffort;
}

function readinessLabel(locale: "zh-CN" | "en", readiness: RuntimeReadiness | undefined): string {
  if (readiness === "task-ready") return locale === "zh-CN" ? "任务可用" : "Task ready";
  if (readiness === "conversation-ready") return locale === "zh-CN" ? "仅对话可用" : "Conversation only";
  if (readiness === "installed") return locale === "zh-CN" ? "仅已安装" : "Installed only";
  if (readiness === "changed") return locale === "zh-CN" ? "验证已失效" : "Verification stale";
  if (readiness === "not-installed") return locale === "zh-CN" ? "未安装" : "Not installed";
  return locale === "zh-CN" ? "未就绪" : "Not ready";
}

function readinessTone(readiness: RuntimeReadiness | undefined): "success" | "warning" | "danger" | "info" | "neutral" {
  if (readiness === "task-ready") return "success";
  if (readiness === "installed" || readiness === "conversation-ready") return "info";
  if (readiness === "changed") return "warning";
  return readiness ? "danger" : "neutral";
}

function launchRuntime(projection: RuntimeReadinessProjection | undefined): Record<string, unknown> {
  const spec = projection?.launchSpec;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return {};
  const runtime = (spec as { runtime?: unknown }).runtime;
  return runtime && typeof runtime === "object" && !Array.isArray(runtime)
    ? runtime as Record<string, unknown>
    : {};
}

function stageLabel(locale: "zh-CN" | "en", stage: RuntimeVerificationStage["stage"]): string {
  if (stage === "installation") return locale === "zh-CN" ? "安装" : "Installation";
  if (stage === "conversation") return locale === "zh-CN" ? "真实对话" : "Conversation";
  return locale === "zh-CN" ? "仓库修改" : "Repository task";
}

function stageTone(stage: RuntimeVerificationProgressStage | RuntimeVerificationStage): "success" | "warning" | "danger" | "info" | "neutral" {
  if (stage.status === "passed") return "success";
  if (stage.status === "failed") return "danger";
  if (stage.status === "running") return "info";
  return "neutral";
}

function stageStatus(locale: "zh-CN" | "en", stage: RuntimeVerificationProgressStage | RuntimeVerificationStage): string {
  if (stage.status === "passed") return locale === "zh-CN" ? "通过" : "Passed";
  if (stage.status === "failed") return locale === "zh-CN" ? "失败" : "Failed";
  if (stage.status === "running") return locale === "zh-CN" ? "运行中" : "Running";
  if (stage.status === "pending") return locale === "zh-CN" ? "等待中" : "Pending";
  return locale === "zh-CN" ? "未验证" : "Not verified";
}

function stageSummary(locale: "zh-CN" | "en", stage: RuntimeVerificationProgressStage | RuntimeVerificationStage): string {
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
  return stage.summary;
}

function participantModeCopy(locale: "zh-CN" | "en", count: number): { label: string; detail: string } {
  if (count === 1) {
    return locale === "zh-CN"
      ? { label: "单 Agent 评测", detail: "当前选择可以独立运行；再选另一个已就绪 Harness 才会进入对比模式。" }
      : { label: "Single-Agent evaluation", detail: "This selection can run alone. Add one ready Harness to enter comparison mode." };
  }
  if (count === 2) {
    return locale === "zh-CN"
      ? { label: "双 Harness 对比", detail: "两个已选 Profile 都必须针对当前任务完成三阶段验证。" }
      : { label: "Two-Harness comparison", detail: "Both selected Profiles must pass all three stages for this task." };
  }
  return locale === "zh-CN"
    ? { label: "选择参评 Agent", detail: "选 1 个可单独评测；同时选择 Codex 和 Claude 才会生成 Harness 对比。" }
    : { label: "Choose participants", detail: "Select one for an individual evaluation, or Codex and Claude together for a Harness comparison." };
}

function plannedComparisonReason(locale: "zh-CN" | "en", reasons: StrictHarnessExclusionReason[]): string {
  if (reasons.includes("different-harness-required") || reasons.includes("requires-two-harnesses")) {
    return locale === "zh-CN" ? "需要同时选择 Codex 与 Claude Code。" : "Select both Codex and Claude Code.";
  }
  if (reasons.includes("unknown-model-identity")) {
    return locale === "zh-CN" ? "至少一个 Profile 无法建立规范模型身份。" : "At least one profile has no canonical model identity.";
  }
  if (reasons.includes("different-model")) {
    return locale === "zh-CN" ? "两个 Profile 的规范模型身份不同。" : "The profiles use different canonical model identities.";
  }
  if (reasons.includes("different-provider-policy")) {
    return locale === "zh-CN" ? "两个 Profile 的 Provider 路由策略不同。" : "The profiles use different Provider routing policies.";
  }
  if (reasons.includes("different-model-parameters")) {
    return locale === "zh-CN" ? "两个 Profile 的推理等级或模型映射不同。" : "The profiles use different reasoning or model-mapping parameters.";
  }
  return locale === "zh-CN" ? "冻结运行身份不满足严格比较条件。" : "The frozen runtime identities do not satisfy strict comparison requirements.";
}

export function PlanPage() {
  const {
    locale,
    environment,
    plan,
    updatePlan,
    adhocPreview,
    createAdhocTaskpack,
    clearAdhocPreview,
    startRun,
    runStatus,
    setPage,
    refreshEnvironment,
    refreshRuntimeReadiness,
    verifyRuntimeProfile,
    saveRuntimeProfile,
    setNotice
  } = useWorkbench();
  const [starting, setStarting] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [showAdhocWizard, setShowAdhocWizard] = useState(false);
  const [adhocPrompt, setAdhocPrompt] = useState("");
  const [adhocTitle, setAdhocTitle] = useState("");
  const [adhocRepoPath, setAdhocRepoPath] = useState("");
  const [adhocExpectedPaths, setAdhocExpectedPaths] = useState("");
  const [adhocCreating, setAdhocCreating] = useState(false);
  const [adhocError, setAdhocError] = useState<string | null>(null);
  const [codexModelDraft, setCodexModelDraft] = useState("");
  const [codexReasoningDraft, setCodexReasoningDraft] = useState("");
  const [codexSettingsSaving, setCodexSettingsSaving] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);

  const localizedTaskPacks = useMemo(
    () => environment.taskPacks.map((task) => localizeTaskPack(task, locale)),
    [environment.taskPacks, locale]
  );
  const selectedTask = localizedTaskPacks.find((item) => item.path === plan.taskPath);
  const executionRepository = resolveTaskRepositorySource(selectedTask, plan.repoPath);
  const taskCompatibilityStatus = selectedTask?.compatibility?.status;
  const taskCompatibilityReady = taskCompatibilityStatus !== "incompatible";
  const projections = new Map(environment.runtimeReadiness.map((entry) => [entry.profile.id, entry]));
  const selectedProfiles = plan.runtimeProfileIds
    .map((profileId) => environment.runtimeProfiles.find((profile) => profile.id === profileId))
    .filter((profile): profile is RuntimeProfile => profile !== undefined);
  const selectedCodexProfile = selectedProfiles.find((profile) => profile.agentKind === "codex");
  const codexDefaults = environment.uiInfo?.codexDefaults;
  const codexDefaultModel = codexDefaults?.effectiveModel;
  const codexDefaultReasoning = codexDefaults?.effectiveReasoningEffort;
  const appliedCodexModel = selectedCodexProfile?.provider?.requestedModel ?? "";
  const appliedCodexReasoning = selectedCodexProfile?.provider?.reasoningEffort ?? "";
  const codexSettingsDirty = Boolean(selectedCodexProfile)
    && (codexModelDraft.trim() !== appliedCodexModel || codexReasoningDraft.trim() !== appliedCodexReasoning);
  useEffect(() => {
    setCodexModelDraft(selectedCodexProfile?.provider?.requestedModel ?? "");
    setCodexReasoningDraft(selectedCodexProfile?.provider?.reasoningEffort ?? "");
  }, [selectedCodexProfile?.id, selectedCodexProfile?.provider?.requestedModel, selectedCodexProfile?.provider?.reasoningEffort]);
  const participantMode = participantModeCopy(locale, selectedProfiles.length);
  const selectedProjections = plan.runtimeProfileIds.map((profileId) => projections.get(profileId));
  const allSelectedReady = plan.runtimeProfileIds.length > 0
    && selectedProfiles.length === plan.runtimeProfileIds.length
    && selectedProjections.every((entry) => entry?.readiness === "task-ready" && entry.receiptMatch);
  const runBusy = runStatus.state === "running" || runStatus.state === "cancelling";
  const serviceReady = !environment.loading
    && !environment.error
    && !environment.failed.taskPacks
    && !environment.failed.runtimeProfiles
    && environment.runStatusLoaded
    && !runBusy;
  const missingBasics = !plan.repoPath.trim() || !plan.taskPath.trim() || plan.runtimeProfileIds.length === 0;
  const canStart = !missingBasics && serviceReady && !environment.runtimeLoading && allSelectedReady && taskCompatibilityReady && !codexSettingsDirty;

  const openAdhocWizard = () => {
    clearAdhocPreview();
    setAdhocError(null);
    setAdhocPrompt("");
    setAdhocTitle("");
    setAdhocRepoPath(plan.repoPath || environment.uiInfo?.repoPath || ".");
    setAdhocExpectedPaths("");
    setShowAdhocWizard(true);
  };

  const closeAdhocWizard = () => {
    if (adhocCreating) return;
    setShowAdhocWizard(false);
    setAdhocError(null);
    clearAdhocPreview();
  };

  const submitAdhocTask = async () => {
    const prompt = adhocPrompt.trim();
    const repoPath = adhocRepoPath.trim();
    if (!prompt || !repoPath) {
      setAdhocError(locale === "zh-CN" ? "请填写任务目标和目标仓库。" : "Enter a task goal and target repository.");
      return;
    }
    const expectedChangedPaths = adhocExpectedPaths
      .split(/[\n,]/u)
      .map((value) => value.trim())
      .filter(Boolean);
    setAdhocCreating(true);
    setAdhocError(null);
    try {
      await createAdhocTaskpack({
        prompt,
        ...(adhocTitle.trim() ? { title: adhocTitle.trim() } : {}),
        repoPath,
        ...(expectedChangedPaths.length > 0 ? { expectedChangedPaths } : {}),
      });
    } catch (error) {
      setAdhocError(formatUserError(error, locale));
    } finally {
      setAdhocCreating(false);
    }
  };

  const selectTask = (taskPath: string) => {
    const task = localizedTaskPacks.find((item) => item.path === taskPath);
    updatePlan({
      taskPath,
      ...(task?.source === "adhoc" && task.repoPath ? { repoPath: task.repoPath } : {}),
    });
  };

  const adhocWarningText = (warning: string, code: string | undefined): string => {
    if (code === "missing-expected-paths") return locale === "zh-CN" ? "变更范围未精确约束" : "Change scope is not precisely constrained";
    if (code === "basic-generated-checks") return locale === "zh-CN" ? "当前检查只能提供基础证据，不能证明任务级业务正确性" : "Generated checks provide basic evidence, not task-specific correctness";
    if (code === "compatibility-warning") return locale === "zh-CN" ? "仓库兼容性存在警告" : "Repository compatibility has warnings";
    if (code === "compatibility-failed") return locale === "zh-CN" ? "任务与仓库不兼容，当前不能启动" : "The task is incompatible with this repository and cannot start";
    return warning;
  };

  const compatibilityLabel = (status: string): string => {
    if (status === "compatible") return locale === "zh-CN" ? "兼容" : "Compatible";
    if (status === "warning") return locale === "zh-CN" ? "有警告" : "Warnings";
    if (status === "incompatible") return locale === "zh-CN" ? "不可运行" : "Incompatible";
    return locale === "zh-CN" ? "未知" : "Unknown";
  };

  const replaceSelectedCodexProfile = (profileId: string) => {
    const replacement = environment.runtimeProfiles.find((profile) => profile.id === profileId);
    const withoutCodex = plan.runtimeProfileIds.filter((id) => {
      const existing = environment.runtimeProfiles.find((profile) => profile.id === id);
      return existing?.agentKind !== "codex";
    });
    setCodexModelDraft(replacement?.provider?.requestedModel ?? "");
    setCodexReasoningDraft(replacement?.provider?.reasoningEffort ?? "");
    updatePlan({ runtimeProfileIds: [...withoutCodex, profileId] });
  };

  const applyCodexSettings = async () => {
    const model = codexModelDraft.trim();
    const reasoningEffort = codexReasoningDraft.trim();
    setCodexSettingsSaving(true);
    try {
      if (!model && !reasoningEffort) {
        const localDefault = environment.runtimeProfiles.find((profile) => profile.id === "codex-local");
        if (!localDefault) throw new Error(locale === "zh-CN" ? "当前服务没有提供本地 Codex 配置。" : "The local Codex profile is not available.");
        replaceSelectedCodexProfile(localDefault.id);
        setNotice({
          kind: "info",
          message: locale === "zh-CN"
            ? `已切换为当前 CLI 默认：${codexDefaultModel ?? "模型未解析"} / ${codexDefaultReasoning ?? "思考强度未解析"}。`
            : `Using the current CLI default: ${codexDefaultModel ?? "model unresolved"} / ${codexDefaultReasoning ?? "reasoning unresolved"}.`
        });
        return;
      }

      let profile = environment.runtimeProfiles.find((entry) => localCodexProfileMatches(entry, model, reasoningEffort));
      if (!profile) {
        profile = await saveRuntimeProfile({
          name: `Codex ${model || "本地模型"}${reasoningEffort ? ` · ${reasoningEffort}` : ""}`,
          agentKind: "codex",
          mode: "inherit-local",
          provider: {
            ...(model ? { requestedModel: model, canonicalModelIdentity: model } : {}),
            ...(model || reasoningEffort ? { modelIdentitySource: "declared" } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {})
          },
          extraEnv: {},
          riskFlags: []
        });
      }
      if (!profile) throw new Error(locale === "zh-CN" ? "运行配置保存成功，但服务没有返回配置详情。" : "The profile was saved, but the service did not return its details.");
      replaceSelectedCodexProfile(profile.id);
      setNotice({
        kind: "success",
        message: locale === "zh-CN"
          ? "Codex 模型和思考强度已应用。请对这个配置运行三阶段验证后再启动任务。"
          : "The Codex model and reasoning effort were applied. Run three-stage verification before starting."
      });
    } catch (error) {
      setNotice({ kind: "danger", message: formatUserError(error, locale) });
    } finally {
      setCodexSettingsSaving(false);
    }
  };

  const plannedComparison = inspectPlannedHarnessComparison(selectedProfiles.map((profile) => {
    const runtime = launchRuntime(projections.get(profile.id));
    return {
      agentKind: profile.agentKind,
      canonicalModelIdentity: typeof runtime.canonicalModelIdentity === "string" ? runtime.canonicalModelIdentity : undefined,
      modelIdentitySource: typeof runtime.modelIdentitySource === "string" ? runtime.modelIdentitySource : undefined,
      providerPolicyIdentity: typeof runtime.providerPolicyIdentity === "string" ? runtime.providerPolicyIdentity : undefined,
      modelParametersIdentity: typeof runtime.modelParametersIdentity === "string" ? runtime.modelParametersIdentity : undefined
    };
  }));
  const sameModelCohort = plannedComparison.eligible;
  const selectedCanonicalIdentity = selectedProjections
    .map((entry) => launchRuntime(entry).canonicalModelIdentity)
    .find((identity): identity is string => typeof identity === "string" && Boolean(identity));

  const readinessItems = [
    {
      label: locale === "zh-CN" ? "目标" : "Target",
      value: plan.repoPath && plan.taskPath ? (locale === "zh-CN" ? "已选择" : "Selected") : (locale === "zh-CN" ? "待补全" : "Missing"),
      complete: Boolean(plan.repoPath && plan.taskPath)
    },
    {
      label: locale === "zh-CN" ? "任务兼容性" : "Task compatibility",
      value: compatibilityLabel(taskCompatibilityStatus ?? "unknown"),
      complete: Boolean(selectedTask) && taskCompatibilityReady && taskCompatibilityStatus !== "unknown"
    },
    {
      label: locale === "zh-CN" ? "运行配置" : "Runtime profiles",
      value: plan.runtimeProfileIds.length ? `${plan.runtimeProfileIds.length}` : (locale === "zh-CN" ? "未选择" : "None"),
      complete: plan.runtimeProfileIds.length > 0
    },
    {
      label: locale === "zh-CN" ? "三阶段验证" : "Three-stage verification",
      value: allSelectedReady ? (locale === "zh-CN" ? "精确匹配" : "Exact match") : (locale === "zh-CN" ? "需要处理" : "Needs attention"),
      complete: allSelectedReady
    },
    {
      label: locale === "zh-CN" ? "本地服务" : "Local service",
      value: serviceReady ? (locale === "zh-CN" ? "可启动" : "Available") : runBusy ? (locale === "zh-CN" ? "已有任务运行" : "Run in progress") : (locale === "zh-CN" ? "无法确认" : "Unavailable"),
      complete: serviceReady
    }
  ];

  const toggleProfile = (profile: RuntimeProfile, projection: RuntimeReadinessProjection | undefined) => {
    const selected = plan.runtimeProfileIds.includes(profile.id);
    const ready = projection?.readiness === "task-ready" && projection.receiptMatch;
    if (!selected && !ready) return;
    if (selected) {
      if (profile.agentKind === "codex") {
        setCodexModelDraft("");
        setCodexReasoningDraft("");
      }
      updatePlan({ runtimeProfileIds: plan.runtimeProfileIds.filter((id) => id !== profile.id) });
      return;
    }
    const withoutSameHarness = plan.runtimeProfileIds.filter((id) => {
      const existing = environment.runtimeProfiles.find((entry) => entry.id === id);
      return existing?.agentKind !== profile.agentKind;
    });
    if (profile.agentKind === "codex") {
      setCodexModelDraft(profile.provider?.requestedModel ?? "");
      setCodexReasoningDraft(profile.provider?.reasoningEffort ?? "");
    }
    updatePlan({ runtimeProfileIds: [...withoutSameHarness, profile.id] });
  };

  const refreshReadiness = async () => {
    await refreshRuntimeReadiness(plan.repoPath, plan.taskPath).catch(() => undefined);
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
      setNotice({ kind: "danger", message: formatUserError(error, locale) });
    } finally {
      setVerifyingId(null);
    }
  };

  const onStart = async () => {
    if (!canStart) {
      setShowErrors(true);
      requestAnimationFrame(() => mainRef.current?.querySelector<HTMLElement>(".field-error input, .field-error select")?.focus());
      return;
    }
    setStarting(true);
    try { await startRun(); } finally { setStarting(false); }
  };

  return (
    <div class="plan-page">
      <PageHeader
        eyebrow="PLAN"
        title={t(locale, "createEvaluation")}
        description={locale === "zh-CN"
          ? "选 1 个 Agent 建立能力基线，选 2 个已就绪 Harness 做同任务对比。"
          : "Select one Agent for a capability baseline, or two ready Harnesses for a same-task comparison."}
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
          <Section
            className="plan-target-section"
            title={locale === "zh-CN" ? "任务设置" : "Task setup"}
            description={locale === "zh-CN" ? "选择任务，系统会按任务包声明确定实际执行仓库。" : "Choose a task; its task pack determines the execution repository."}
            actions={(
              <button class="button secondary compact-button" type="button" onClick={openAdhocWizard}>
                <Icon name="plus" />{locale === "zh-CN" ? "创建自定义任务" : "Create custom task"}
              </button>
            )}
          >
            <div class="plan-target-grid">
              <Field
                label={t(locale, "repo")}
                help={locale === "zh-CN" ? "必须位于启动 AgentArena 的工作区内。" : "Must be inside the workspace where AgentArena was started."}
                error={showErrors && !plan.repoPath ? t(locale, "fieldRequired") : undefined}
              >
                <input value={plan.repoPath} onInput={(event) => updatePlan({ repoPath: event.currentTarget.value })} placeholder={environment.uiInfo?.repoPath || "."} />
              </Field>
              <Field label={t(locale, "task")} error={showErrors && !plan.taskPath ? t(locale, "fieldRequired") : undefined}>
                <select value={plan.taskPath} onChange={(event) => selectTask(event.currentTarget.value)}>
                  <option value="">{t(locale, "selectTaskPack")}</option>
                  {localizedTaskPacks.map((task) => {
                    const source = resolveTaskRepositorySource(task, plan.repoPath);
                    return (
                      <option key={task.path} value={task.path}>
                        {task.title ?? task.id ?? task.path} / {labelTaskDifficulty(locale, task.difficulty)} / {source.kind === "builtin" ? t(locale, "builtinRepository") : t(locale, "currentRepository")}
                      </option>
                    );
                  })}
                </select>
              </Field>
            </div>
            {selectedTask && (
              <div class="task-context-row">
                <span class="task-context-repository">
                  <Icon name="repo" />
                  <span>
                    <small>{t(locale, "executionRepository")}</small>
                    <strong>{executionRepository.value || t(locale, "missing")}</strong>
                  </span>
                </span>
                <StatusPill tone={taskDifficultyTone(selectedTask.difficulty)}>
                  {locale === "zh-CN" ? "难度" : "Difficulty"}: {labelTaskDifficulty(locale, selectedTask.difficulty)}
                </StatusPill>
                <span class="task-context-note">
                  {executionRepository.kind === "builtin" ? t(locale, "builtinRepositoryHint") : t(locale, "currentRepositoryHint")}
                </span>
                {selectedTask?.source === "adhoc" && (
                  <span class="task-context-evidence">
                    <StatusPill tone="warning">{locale === "zh-CN" ? "基础证据" : "Basic evidence"}</StatusPill>
                    <span>{selectedTask.expectedChangedPaths?.length
                      ? (locale === "zh-CN" ? `变更范围：${selectedTask.expectedChangedPaths.join(", ")}` : `Scope: ${selectedTask.expectedChangedPaths.join(", ")}`)
                      : (locale === "zh-CN" ? "变更范围未精确约束" : "Change scope is not precisely constrained")}</span>
                  </span>
                )}
              </div>
            )}
            {selectedTask?.compatibility?.status === "incompatible" && (
              <Notice kind="danger">
                <strong>{locale === "zh-CN" ? "任务兼容性检查未通过" : "Task compatibility check failed"}</strong>
                <span>{selectedTask.compatibility.summary ?? (locale === "zh-CN" ? "请更换目标仓库或重新创建任务。" : "Choose another repository or recreate the task.")}</span>
              </Notice>
            )}
            {selectedTask?.compatibility?.status === "warning" && (
              <Notice kind="warning">
                <strong>{locale === "zh-CN" ? "任务可以尝试运行，但有兼容性警告" : "The task can run, but compatibility has warnings"}</strong>
                <span>{selectedTask.compatibility.summary}</span>
              </Notice>
            )}
          </Section>

          <Section
            className="plan-codex-runtime-section"
            title={locale === "zh-CN" ? "Codex 模型与思考强度" : "Codex model and reasoning"}
            description={locale === "zh-CN"
              ? "先读取当前 CLI 默认值；你也可以手动输入模型。保存后会生成一个任务级运行配置，不会改动 ~/.codex/config.toml。"
              : "Read the current CLI default first, or enter a model manually. Saving creates a task runtime profile without editing ~/.codex/config.toml."}
          >
            <div class="runtime-default-callout">
              <span>
                <small>{locale === "zh-CN" ? "当前 CLI 默认" : "Current CLI default"}</small>
                <strong>{codexDefaultModel ?? (locale === "zh-CN" ? "未解析" : "Not resolved")}</strong>
              </span>
              <span>
                <small>{locale === "zh-CN" ? "默认思考强度" : "Default reasoning"}</small>
                <strong>{codexDefaultReasoning ?? (locale === "zh-CN" ? "未解析" : "Not resolved")}</strong>
              </span>
              <small>{locale === "zh-CN"
                ? "Codex CLI 当前没有稳定的模型枚举接口，因此列表值来自活动配置；未知模型仍可手动填写。"
                : "Codex CLI has no stable model-enumeration command, so the detected value comes from the active config; unknown models can still be entered manually."}</small>
            </div>
            <div class="plan-codex-runtime-grid">
              <Field
                label={locale === "zh-CN" ? "运行模型" : "Model"}
                help={locale === "zh-CN" ? "留空表示使用上面的 CLI 默认；填写后会作为本次运行的明确配置。" : "Leave empty to use the CLI default; a value becomes explicit for this run profile."}
              >
                <input
                  value={codexModelDraft}
                  onInput={(event) => setCodexModelDraft(event.currentTarget.value)}
                  placeholder={codexDefaultModel ?? "gpt-5.6-luna"}
                  list="codex-model-options"
                  data-testid="codex-model"
                />
                <datalist id="codex-model-options">
                  {codexDefaultModel && <option value={codexDefaultModel} />}
                </datalist>
              </Field>
              <Field
                label={locale === "zh-CN" ? "思考强度" : "Reasoning effort"}
                help={locale === "zh-CN" ? "留空表示使用 CLI 默认。" : "Leave empty to use the CLI default."}
              >
                <select value={codexReasoningDraft} onChange={(event) => setCodexReasoningDraft(event.currentTarget.value)} data-testid="codex-reasoning">
                  <option value="">{locale === "zh-CN" ? "CLI 默认" : "CLI default"}</option>
                  <option value="minimal">minimal</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                  <option value="max">max</option>
                </select>
              </Field>
            </div>
            {codexSettingsDirty && (
              <Notice kind="warning">
                {locale === "zh-CN" ? "模型设置尚未应用；请先点击“保存并应用”，否则启动按钮会保持禁用。" : "These model settings are not applied yet. Click “Save and apply” before starting."}
              </Notice>
            )}
            <div class="runtime-profile-verify-row">
              <span>{selectedCodexProfile
                ? `${locale === "zh-CN" ? "当前配置" : "Active profile"}: ${selectedCodexProfile.name}`
                : (locale === "zh-CN" ? "尚未选择 Codex 配置" : "No Codex profile selected")}</span>
              <button class="button secondary compact-button" type="button" onClick={() => void applyCodexSettings()} disabled={codexSettingsSaving} aria-busy={codexSettingsSaving}>
                <Icon name="check" />
                {codexSettingsSaving
                  ? (locale === "zh-CN" ? "保存中" : "Saving")
                  : (locale === "zh-CN" ? "保存并应用" : "Save and apply")}
              </button>
            </div>
          </Section>

          <Section
            className="plan-runtime-profiles"
            title={locale === "zh-CN" ? "选择参评 Agent" : "Choose participants"}
            description={locale === "zh-CN"
              ? "每个 Harness 最多选择一个 Profile。未就绪的 Profile 不会影响其他 Agent 单独运行。"
              : "Choose at most one Profile per Harness. An unavailable Profile does not block another Agent from running alone."}
            actions={(
              <button class="button ghost compact-button" type="button" onClick={() => void refreshReadiness()} disabled={!plan.repoPath || environment.runtimeLoading}>
                <Icon name="refresh" />{locale === "zh-CN" ? "刷新状态" : "Refresh status"}
              </button>
            )}
          >
            <div class={`participant-mode participant-mode-${selectedProfiles.length === 0 ? "empty" : selectedProfiles.length === 1 ? "single" : "compare"}`}>
              <Icon name={selectedProfiles.length > 0 ? "check" : "agent"} />
              <span>
                <strong>{participantMode.label}</strong>
                <small>{participantMode.detail}</small>
              </span>
            </div>
            {environment.runtimeLoading && environment.runtimeProfiles.length === 0 ? (
              <Skeleton lines={3} label={t(locale, "loading")} />
            ) : environment.failed.runtimeProfiles ? (
              <Notice kind="danger">
                <strong>{locale === "zh-CN" ? "运行配置加载失败" : "Runtime profiles failed to load"}</strong>
                <button class="button secondary compact-button" type="button" onClick={() => setPage("environment")}>
                  {locale === "zh-CN" ? "打开环境页" : "Open Environment"}
                </button>
              </Notice>
            ) : (
              <div class="agent-selector runtime-selector">
                {environment.runtimeProfiles.map((profile) => {
                  const projection = projections.get(profile.id);
                  const selected = plan.runtimeProfileIds.includes(profile.id);
                  const ready = projection?.readiness === "task-ready" && projection.receiptMatch;
                  const disabled = !ready && !selected;
                  const runtime = launchRuntime(projection);
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
                    && projection?.readiness !== "not-installed"
                    && !(profile.mode === "managed-provider" && !profile.secretStored)
                    && verifyingId === null;
                  return (
                    <div class="runtime-profile-choice" key={profile.id}>
                      <label class={`agent-option ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`}>
                        <input class="runtime-profile-checkbox" type="checkbox" checked={selected} disabled={disabled} onChange={() => toggleProfile(profile, projection)} />
                        <span>
                          <strong>{runtimeProfileLabel(locale, profile)}</strong>
                          <small>{agentLabel(profile)} · {typeof runtime.requestedModel === "string" ? runtime.requestedModel : (locale === "zh-CN" ? "继承模型" : "Inherited model")}</small>
                        </span>
                        <StatusPill tone={readinessTone(projection?.readiness)}>{readinessLabel(locale, projection?.readiness)}</StatusPill>
                      </label>

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
                            ?? projection?.stages.find((entry) => entry.stage === stageName)
                            ?? { stage: stageName, status: "skipped" as const, startedAt: "", durationMs: 0, summary: locale === "zh-CN" ? "尚未验证" : "Not verified" };
                          return (
                            <li class={`runtime-stage runtime-stage-${stage.status}`} key={stageName}>
                              <span class="runtime-stage-icon"><Icon name={stage.status === "passed" ? "check" : stage.status === "failed" ? "danger" : stage.status === "running" ? "info" : "clock"} /></span>
                              <div>
                                <strong>{stageLabel(locale, stageName)}</strong>
                                <small>{stageSummary(locale, stage)}</small>
                              </div>
                              <StatusPill tone={stageTone(stage)}>{stageStatus(locale, stage)}</StatusPill>
                            </li>
                          );
                        })}
                      </ul>

                      {projection?.failure && (
                        <Notice kind={projection.readiness === "changed" ? "warning" : "danger"}>
                          <strong>{locale === "zh-CN" ? "验证未通过" : "Verification needs attention"}</strong>
                          <span>{projection.failure.summary}</span>
                        </Notice>
                      )}

                      <div class="runtime-profile-verify-row">
                        <span>{projection?.receipt?.createdAt
                          ? (locale === "zh-CN" ? "已有验证凭证" : "Verification receipt available")
                          : (locale === "zh-CN" ? "尚无三阶段验证凭证" : "No three-stage verification receipt")}</span>
                        <button class="button secondary compact-button" type="button" disabled={!canVerify} onClick={() => void verify(profile.id)} aria-busy={verifyingId === profile.id}>
                          <Icon name="check" />
                          {verifyingId === profile.id
                            ? (locale === "zh-CN" ? "验证中" : "Verifying")
                            : (locale === "zh-CN" ? "运行三阶段验证" : "Run three-stage verification")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {environment.runtimeProfiles.length === 0 && !environment.runtimeLoading && (
              <Notice kind="warning">{locale === "zh-CN" ? "没有 Codex / Claude 运行配置。" : "No Codex / Claude runtime profiles are available."}</Notice>
            )}
            {environment.runtimeProfiles.some((profile) => {
              const projection = projections.get(profile.id);
              return projection?.readiness !== "task-ready" || !projection.receiptMatch;
            }) && (
              <div class="runtime-repair-row">
                <span>{locale === "zh-CN" ? "未就绪的 Profile 会被排除；可在上方直接运行三阶段验证，配置编辑仍在环境页完成。" : "Unavailable Profiles are excluded. Run verification above; use Environment only to edit a profile."}</span>
                <button class="button secondary compact-button" type="button" onClick={() => setPage("environment")}>
                  <Icon name="environment" />{locale === "zh-CN" ? "编辑运行配置" : "Edit runtime profiles"}
                </button>
              </div>
            )}
            {showErrors && plan.runtimeProfileIds.length === 0 && <span class="field-message" role="alert">{t(locale, "fieldRequired")}</span>}
          </Section>

          <Section className="plan-rules-section" title={locale === "zh-CN" ? "运行规则" : "Run rules"}>
            <div class="plan-rule-grid">
              <Field label={t(locale, "scoreMode")} help={t(locale, "scoreModeHelp")}>
                <select value={plan.scoreMode} onChange={(event) => updatePlan({ scoreMode: event.currentTarget.value })}>
                  {SCORE_MODES.map((mode) => <option key={mode} value={mode}>{labelScoreMode(locale, mode)}</option>)}
                </select>
              </Field>
              <div class="plan-rule-fact">
                <Icon name="clock" />
                <span>
                  <small>{locale === "zh-CN" ? "执行顺序" : "Execution order"}</small>
                  <strong>{locale === "zh-CN" ? "串行执行" : "Serial execution"}</strong>
                  <span>{locale === "zh-CN" ? "避免 Harness 相互干扰" : "Prevents Harness interference"}</span>
                </span>
              </div>
            </div>
            {selectedProfiles.length === 2 && (
              <div class="comparison-eligibility">
                <StatusPill tone={sameModelCohort ? "success" : "warning"}>
                  {sameModelCohort ? (locale === "zh-CN" ? "可严格对比" : "Strictly comparable") : (locale === "zh-CN" ? "普通双 Agent 运行" : "Standard two-Agent run")}
                </StatusPill>
                <span>
                  <strong>{sameModelCohort
                    ? (locale === "zh-CN" ? "符合跨 Harness 同模型比较条件" : "Eligible for same-model cross-Harness comparison")
                    : (locale === "zh-CN" ? "可以运行，但不会自动归入同模型比较" : "Runnable, but not eligible for automatic same-model comparison")}</strong>
                  <small>{sameModelCohort
                    ? plannedComparison.modelIdentityEvidence === "confirmed"
                      ? `${selectedCanonicalIdentity} · ${locale === "zh-CN" ? "运行时已确认模型身份" : "runtime-confirmed model identity"}`
                      : `${selectedCanonicalIdentity} · ${locale === "zh-CN" ? "模型身份来自 Profile 声明，结果将使用降级措辞" : "model identity is Profile-declared; conclusions will be qualified"}`
                    : plannedComparisonReason(locale, plannedComparison.reasons)}</small>
                </span>
              </div>
            )}
          </Section>
        </div>

        <aside class="plan-summary">
          <div class="sticky-panel">
            <div class="eyebrow">{t(locale, "finalReview")}</div>
            <h2>{t(locale, "readyToSubmit")}</h2>
            <div class="readiness-list plan-readiness-list">
              {readinessItems.map((item) => (
                <div class="readiness-item" key={item.label}>
                  <StatusPill tone={item.complete ? "success" : "warning"}>{item.complete ? (locale === "zh-CN" ? "就绪" : "Ready") : (locale === "zh-CN" ? "待处理" : "Pending")}</StatusPill>
                  <span>{item.label}</span>
                  <small>{item.value}</small>
                </div>
              ))}
            </div>
            <dl>
              <div><dt>{t(locale, "executionRepository")}</dt><dd>{executionRepository.value || t(locale, "missing")}</dd></div>
              <div><dt>{t(locale, "task")}</dt><dd>{selectedTask?.title ?? (plan.taskPath || t(locale, "missing"))}</dd></div>
              <div><dt>{locale === "zh-CN" ? "任务难度" : "Task difficulty"}</dt><dd>{labelTaskDifficulty(locale, selectedTask?.difficulty)}</dd></div>
              <div><dt>{locale === "zh-CN" ? "运行配置" : "Runtime profiles"}</dt><dd>{selectedProfiles.map((profile) => runtimeProfileLabel(locale, profile)).join(", ") || t(locale, "missing")}</dd></div>
              <div><dt>{t(locale, "scoreMode")}</dt><dd>{labelScoreMode(locale, plan.scoreMode)}</dd></div>
            </dl>
            {!allSelectedReady && plan.runtimeProfileIds.length > 0 && (
              <Notice kind="danger">{locale === "zh-CN" ? "所选 Profile 的任务验证已失效或尚未完成。" : "A selected profile is stale or has not completed task verification."}</Notice>
            )}
            <button class="button primary full" type="button" disabled={starting || !canStart} onClick={() => void onStart()} aria-busy={starting}>
              <Icon name="live" />{starting
                ? t(locale, "starting")
                : selectedProfiles.length === 1
                  ? (locale === "zh-CN" ? "运行单 Agent 评测" : "Run single-Agent evaluation")
                  : selectedProfiles.length === 2
                    ? (locale === "zh-CN" ? "运行双 Harness 对比" : "Run two-Harness comparison")
                    : t(locale, "startRun")}
            </button>
            <p class="fine-print">{locale === "zh-CN" ? "启动后浏览器可以关闭，本地 AgentArena 服务必须保持运行。" : "You may close the browser after launch; the local AgentArena service must keep running."}</p>
          </div>
        </aside>
      </div>

      {showAdhocWizard && (
        <div
          class="adhoc-modal-backdrop"
          role="presentation"
        >
          <div class="adhoc-modal" role="dialog" aria-modal="true" aria-labelledby="adhoc-task-heading" data-testid="adhoc-task-wizard">
            <div class="adhoc-modal-header">
              <div>
                <div class="eyebrow">{locale === "zh-CN" ? "CUSTOM TASK" : "CUSTOM TASK"}</div>
                <h2 id="adhoc-task-heading">{locale === "zh-CN" ? "创建自定义任务" : "Create a custom task"}</h2>
                <p>{locale === "zh-CN"
                  ? "用自然语言描述目标，AgentArena 会生成一个本地草稿并先做兼容性检查。"
                  : "Describe the goal in natural language. AgentArena saves a local draft and checks compatibility first."}</p>
              </div>
              <button class="button ghost compact-button" type="button" onClick={closeAdhocWizard} disabled={adhocCreating} aria-label={locale === "zh-CN" ? "关闭" : "Close"}>
                <Icon name="cancel" />
              </button>
            </div>

            {!adhocPreview ? (
              <div class="adhoc-modal-body">
                <Field
                  label={locale === "zh-CN" ? "任务目标" : "Task goal"}
                  help={locale === "zh-CN" ? "只描述要完成的事情；第一版不接受自定义 shell 命令。" : "Describe the outcome. Custom shell commands are not accepted in the first release."}
                >
                  <textarea
                    rows={5}
                    value={adhocPrompt}
                    onInput={(event) => setAdhocPrompt(event.currentTarget.value)}
                    placeholder={locale === "zh-CN" ? "例如：为登录接口补充输入校验，并添加回归测试。" : "For example: add validation and a regression test for the login endpoint."}
                    data-testid="adhoc-prompt"
                  />
                </Field>
                <div class="adhoc-form-grid">
                  <Field label={locale === "zh-CN" ? "任务标题（可选）" : "Task title (optional)"}>
                    <input value={adhocTitle} onInput={(event) => setAdhocTitle(event.currentTarget.value)} data-testid="adhoc-title" />
                  </Field>
                  <Field
                    label={locale === "zh-CN" ? "目标仓库" : "Target repository"}
                    help={locale === "zh-CN" ? "必须位于 AgentArena 工作区内，可以填写绝对路径或相对路径。" : "Must be inside the AgentArena workspace; use an absolute or relative path."}
                  >
                    <input value={adhocRepoPath} onInput={(event) => setAdhocRepoPath(event.currentTarget.value)} placeholder="." data-testid="adhoc-repo" />
                  </Field>
                </div>
                <Field
                  label={locale === "zh-CN" ? "预期变更路径（可选）" : "Expected changed paths (optional)"}
                  help={locale === "zh-CN" ? "每行一个路径或 glob。留空会明确标记为“变更范围未精确约束”。" : "One path or glob per line. Leaving this empty marks the scope as not precisely constrained."}
                >
                  <textarea
                    rows={3}
                    value={adhocExpectedPaths}
                    onInput={(event) => setAdhocExpectedPaths(event.currentTarget.value)}
                    placeholder={locale === "zh-CN" ? "src/auth/login.ts\ntests/auth/login.test.ts" : "src/auth/login.ts\ntests/auth/login.test.ts"}
                    data-testid="adhoc-expected-paths"
                  />
                </Field>
                {adhocError && <Notice kind="danger"><span>{adhocError}</span></Notice>}
                <div class="adhoc-modal-footer">
                  <button class="button ghost" type="button" onClick={closeAdhocWizard} disabled={adhocCreating}>{locale === "zh-CN" ? "取消" : "Cancel"}</button>
                  <button class="button primary" type="button" onClick={() => void submitAdhocTask()} disabled={adhocCreating} aria-busy={adhocCreating} data-testid="adhoc-submit">
                    <Icon name="plus" />{adhocCreating ? (locale === "zh-CN" ? "生成并检查中" : "Generating and checking") : (locale === "zh-CN" ? "生成任务预览" : "Generate task preview")}
                  </button>
                </div>
              </div>
            ) : (
              <div class="adhoc-modal-body" data-testid="adhoc-preview">
                <div class="adhoc-preview-heading">
                  <div>
                    <span class="eyebrow">{locale === "zh-CN" ? "本地草稿" : "LOCAL DRAFT"}</span>
                    <h3>{adhocPreview.title}</h3>
                  </div>
                  <StatusPill tone={adhocPreview.compatibility.status === "compatible" ? "success" : adhocPreview.compatibility.status === "incompatible" ? "danger" : "warning"}>
                    {compatibilityLabel(adhocPreview.compatibility.status)}
                  </StatusPill>
                </div>
                <dl class="adhoc-preview-facts">
                  <div><dt>{locale === "zh-CN" ? "仓库" : "Repository"}</dt><dd>{adhocPreview.repoPath}</dd></div>
                  <div><dt>{locale === "zh-CN" ? "仓库类型" : "Repository type"}</dt><dd>{adhocPreview.repoType}</dd></div>
                  <div><dt>{locale === "zh-CN" ? "任务来源" : "Task source"}</dt><dd>{locale === "zh-CN" ? "自定义草稿" : "Ad-hoc draft"}</dd></div>
                  <div><dt>{locale === "zh-CN" ? "证据强度" : "Evidence strength"}</dt><dd>{locale === "zh-CN" ? "基础证据" : "Basic"}</dd></div>
                </dl>
                <div class="adhoc-preview-section">
                  <strong>{locale === "zh-CN" ? "自动生成的基础检查" : "Generated basic checks"}</strong>
                  <ul class="adhoc-check-list">
                    {adhocPreview.generatedChecks.map((check) => (
                      <li key={`${check.kind}-${check.label}`}>
                        <Icon name="check" />
                        <span><strong>{check.label}</strong><small>{check.command ? check.command : (locale === "zh-CN" ? "文件存在性检查" : "File presence check")}</small></span>
                        <StatusPill tone="warning">{check.strength}</StatusPill>
                      </li>
                    ))}
                  </ul>
                </div>
                <div class="adhoc-preview-section">
                  <strong>{locale === "zh-CN" ? "预期变更范围" : "Expected change scope"}</strong>
                  <p class={adhocPreview.expectedChangedPaths.length > 0 ? "" : "adhoc-preview-warning-text"}>
                    {adhocPreview.expectedChangedPaths.length > 0
                      ? adhocPreview.expectedChangedPaths.join(", ")
                      : (locale === "zh-CN" ? "变更范围未精确约束" : "Change scope is not precisely constrained")}
                  </p>
                </div>
                <div class="adhoc-preview-warnings">
                  {adhocPreview.warnings.map((warning, index) => (
                    <Notice kind={adhocPreview.warningCodes?.[index] === "compatibility-failed" ? "danger" : "warning"} key={`${warning}-${index}`}>
                      <span>{adhocWarningText(warning, adhocPreview.warningCodes?.[index])}</span>
                    </Notice>
                  ))}
                </div>
                {adhocPreview.compatibility.status === "incompatible" && (
                  <Notice kind="danger"><strong>{locale === "zh-CN" ? "当前草稿不能启动" : "This draft cannot start"}</strong><span>{adhocPreview.compatibility.reasons.join(" ")}</span></Notice>
                )}
                <div class="adhoc-modal-footer">
                  <button class="button ghost" type="button" onClick={closeAdhocWizard}>{locale === "zh-CN" ? "关闭" : "Close"}</button>
                  <button class="button primary" type="button" onClick={() => { setShowAdhocWizard(false); clearAdhocPreview(); }} disabled={adhocPreview.compatibility.status === "incompatible"} data-testid="adhoc-use-task">
                    <Icon name="check" />{locale === "zh-CN" ? "确认并使用任务" : "Use this task"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
