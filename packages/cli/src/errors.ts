/**
 * Unified CLI error message formatting.
 *
 * Strategy:
 * - User-facing errors: bilingual (Chinese primary, English fallback)
 * - Technical errors: English only (Error.message)
 * - --verbose flag: show stack traces
 */

export interface CliErrorOptions {
  /** Chinese message */
  zh: string;
  /** English message (defaults to zh if not provided) */
  en?: string;
  /** Why the error occurred */
  reason?: { zh: string; en: string };
  /** How to fix it */
  fix?: { zh: string; en: string };
  /** The underlying error object */
  cause?: unknown;
}

export function formatCliError(options: CliErrorOptions): string {
  const { zh, en, reason, fix, cause } = options;
  const lines: string[] = [];

  lines.push(`❌ ${zh}`);
  if (en && en !== zh) {
    lines.push(`   ${en}`);
  }

  if (reason) {
    lines.push(`原因：${reason.zh}`);
    if (reason.en) lines.push(`   Reason: ${reason.en}`);
  }

  if (fix) {
    lines.push(`解决方法：${fix.zh}`);
    if (fix.en) lines.push(`   Fix: ${fix.en}`);
  }

  if (cause instanceof Error && cause.message) {
    lines.push(`   Error: ${cause.message}`);
  }

  return lines.join("\n");
}

/**
 * Print a user-facing error to stderr.
 */
export function printCliError(options: CliErrorOptions): void {
  console.error(formatCliError(options));
}

/**
 * Common error patterns for reuse.
 */
export const CLI_ERRORS = {
  missingTaskPath: () => formatCliError({
    zh: "缺少必需参数：--task",
    en: "Missing required argument: --task",
    reason: { zh: "需要指定任务包文件路径", en: "A task pack file path is required" },
    fix: { zh: "agentarena run --repo . --task taskpack.yaml --agents demo-fast", en: "" }
  }),

  missingAgents: () => formatCliError({
    zh: "缺少必需参数：--agents",
    en: "Missing required argument: --agents",
    reason: { zh: "需要指定至少一个要测试的 AI 代理", en: "At least one agent is required" },
    fix: { zh: "agentarena run --repo . --task taskpack.yaml --agents demo-fast", en: "" }
  }),

  unknownAgents: (ids: string[], available: string[]) => formatCliError({
    zh: `未知的代理：${ids.join(", ")}`,
    en: `Unknown agents: ${ids.join(", ")}`,
    reason: { zh: "这些代理未安装或不存在", en: "These agents are not installed or do not exist" },
    fix: { zh: `可用代理：${available.join(", ")}`, en: `Available: ${available.join(", ")}` }
  }),

  repoNotFound: (repoPath: string) => formatCliError({
    zh: `--repo 路径不存在：${repoPath}`,
    en: `--repo path not found: ${repoPath}`,
    reason: { zh: "指定的代码仓库路径不存在", en: "The specified repository path does not exist" },
    fix: { zh: "检查路径是否正确，或先创建该目录", en: "Check the path or create the directory first" }
  }),

  taskNotFound: (taskPath: string) => formatCliError({
    zh: `--task 文件不存在：${taskPath}`,
    en: `--task file not found: ${taskPath}`,
    reason: { zh: "指定的任务包文件不存在", en: "The specified task pack file does not exist" },
    fix: { zh: "检查文件路径是否正确，或使用 agentarena init-taskpack 创建新任务包", en: "" }
  }),

  unknownCommand: (command: string) => formatCliError({
    zh: `未知命令：${command}`,
    en: `Unknown command: ${command}`,
    reason: { zh: "该命令不存在", en: "This command does not exist" },
    fix: { zh: "可用命令：run, doctor, list-adapters, init, init-taskpack, init-ci, publish, ui", en: "" }
  }),

  fileExists: (filePath: string) => formatCliError({
    zh: `文件已存在：${filePath}`,
    en: `File already exists: ${filePath}`,
    reason: { zh: "覆盖现有文件可能导致数据丢失", en: "Overwriting may cause data loss" },
    fix: { zh: "换一个文件名，或加 --force 参数强制覆盖", en: "Use a different name or add --force" }
  }),

  unknownTemplate: (name: string, available: string[]) => formatCliError({
    zh: `未知模板：${name}`,
    en: `Unknown template: ${name}`,
    reason: { zh: "该模板不存在", en: "This template does not exist" },
    fix: { zh: `可用模板：${available.join(", ")}`, en: `Available: ${available.join(", ")}` }
  })
};
