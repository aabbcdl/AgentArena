import type { Locale, RuntimeProfile, RuntimeReadiness, RuntimeVerificationStage } from "../types";

const BUILT_IN_PROFILE_LABELS: Record<string, Record<Locale, string>> = {
  "codex-local": {
    "zh-CN": "当前本地 Codex 配置",
    en: "Current local Codex setup"
  },
  "claude-local": {
    "zh-CN": "当前本地 Claude 配置",
    en: "Current local Claude setup"
  }
};

export function runtimeProfileLabel(locale: Locale, profile: RuntimeProfile): string {
  if (!profile.isBuiltIn) return profile.name;
  return BUILT_IN_PROFILE_LABELS[profile.id]?.[locale] ?? profile.name;
}

export function runtimeReadinessLabel(locale: Locale, readiness: RuntimeReadiness | undefined): string {
  const labels: Record<RuntimeReadiness, Record<Locale, string>> = {
    "not-installed": { "zh-CN": "未安装", en: "Not installed" },
    installed: { "zh-CN": "已安装", en: "Installed" },
    "conversation-ready": { "zh-CN": "对话可用", en: "Conversation ready" },
    "task-ready": { "zh-CN": "任务可用", en: "Task ready" },
    blocked: { "zh-CN": "已阻断", en: "Blocked" },
    changed: { "zh-CN": "配置已变化", en: "Changed" }
  };
  return readiness ? labels[readiness][locale] : (locale === "zh-CN" ? "未就绪" : "Not ready");
}

export function runtimeStageSummary(locale: Locale, stage: RuntimeVerificationStage): string {
  if (locale === "en") return stage.summary;
  const summaries: Record<RuntimeVerificationStage["stage"], Record<RuntimeVerificationStage["status"], string>> = {
    installation: {
      passed: "已检测到可运行的 CLI。",
      failed: "未能检测到可运行的 CLI，请查看下方诊断。",
      skipped: "尚未检测 CLI 安装状态。"
    },
    conversation: {
      passed: "已完成一次真实 Provider 对话。",
      failed: "真实 Provider 对话未通过，请查看下方诊断。",
      skipped: "尚未执行真实 Provider 对话。"
    },
    task: {
      passed: "已在隔离仓库副本中完成约定修改。",
      failed: "隔离仓库修改未通过，请查看下方诊断。",
      skipped: "尚未执行隔离仓库修改。"
    }
  };
  return summaries[stage.stage][stage.status];
}
