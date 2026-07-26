import type { Locale } from "../types.ts";

export interface UserFacingError {
  message: string;
  detail?: string;
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isNetworkFailure(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes("failed to fetch")
    || lower.includes("networkerror")
    || lower.includes("network request failed")
    || lower.includes("load failed")
    || lower.includes("fetch failed")
    || lower.includes("econnrefused")
    || lower.includes("enotfound")
    || lower.includes("network error")
  );
}

/**
 * Map technical fetch/API failures to locale-friendly recovery copy.
 * Keep the original text in `detail` for troubleshooting.
 */
export function toUserError(error: unknown, locale: Locale): UserFacingError {
  const detail = rawMessage(error);
  if (isNetworkFailure(detail) || detail === "TypeError: Failed to fetch") {
    return {
      message: locale === "zh-CN"
        ? "本地服务不可用。请确认 agentarena ui 正在运行，然后重试。"
        : "Local service is unavailable. Confirm agentarena ui is running, then retry.",
      detail
    };
  }
  if (/^\d{3}\b/.test(detail) || /unauthorized|forbidden|auth/i.test(detail)) {
    return {
      message: locale === "zh-CN"
        ? "请求被拒绝。请检查鉴权配置后重试。"
        : "The request was rejected. Check authentication settings, then retry.",
      detail
    };
  }
  if (/repoPath must be within the current working directory/i.test(detail)) {
    return {
      message: locale === "zh-CN"
        ? "仓库路径必须在启动 agentarena ui 时的工作目录内。请先 cd 到目标仓库（或其父目录）再启动 UI，或改用相对路径。"
        : "The repository path must be inside the working directory where agentarena ui was started. cd into the target repo (or its parent), restart the UI, or use a path under that directory.",
      detail
    };
  }
  if (/scoreMode must be one of/i.test(detail)) {
    return {
      message: locale === "zh-CN"
        ? "评分模式无效。请重新选择评分模式后启动。"
        : "Invalid score mode. Choose a valid score mode, then start again.",
      detail
    };
  }
  return {
    message: detail || (locale === "zh-CN" ? "发生未知错误。" : "An unknown error occurred."),
    detail: detail || undefined
  };
}

export function formatUserError(error: unknown, locale: Locale): string {
  return toUserError(error, locale).message;
}
