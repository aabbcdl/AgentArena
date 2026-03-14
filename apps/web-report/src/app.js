import {
  buildPrTable,
  buildShareCard,
  buildShareCardSvg,
  findPreviousComparableRun,
  getAgentTrendRows,
  getCompareResults,
  getRunCompareRows,
  getRunToRunAgentDiff,
  getRunVerdict,
  summarizeRun
} from "./view-model.js";

const state = {
  runs: [],
  run: null,
  selectedRunId: null,
  selectedAgentId: null,
  markdownByRunId: new Map(),
  standaloneMarkdown: null,
  language: "zh-CN",
  notice: null,
  serviceInfo: null,
  availableAdapters: [],
  availableTaskPacks: [],
  runInProgress: false,
  runStatus: null,
  runStatusPollTimer: null,
  launcherSelectedAgentIds: [],
  launcherCodexVariants: [],
  launcherExpanded: true
};

const elements = {
  fileInput: document.querySelector("#summary-file"),
  markdownInput: document.querySelector("#markdown-file"),
  folderInput: document.querySelector("#runs-folder"),
  languageSelect: document.querySelector("#language-select"),
  resultLoaderPanel: document.querySelector("#result-loader-panel"),
  resultLoaderSummary: document.querySelector("#result-loader-summary"),
  launcherPanel: document.querySelector("#launcher-panel"),
  launcherBody: document.querySelector("#launcher-body"),
  launcherToggle: document.querySelector("#launcher-toggle"),
  launcherCompactSummary: document.querySelector("#launcher-compact-summary"),
  launcherRepoPath: document.querySelector("#launcher-repo-path"),
  launcherTaskSelect: document.querySelector("#launcher-task-select"),
  launcherTaskPath: document.querySelector("#launcher-task-path"),
  launcherOutputPath: document.querySelector("#launcher-output-path"),
  launcherAgents: document.querySelector("#launcher-agents"),
  launcherProbeAuth: document.querySelector("#launcher-probe-auth"),
  launcherRun: document.querySelector("#launcher-run"),
  launcherStatus: document.querySelector("#launcher-status"),
  taskBrief: document.querySelector("#task-brief"),
  runInfo: document.querySelector("#run-info"),
  workflowList: document.querySelector("#workflow-list"),
  nextStepsContent: document.querySelector("#next-steps-content"),
  runList: document.querySelector("#run-list"),
  runCount: document.querySelector("#run-count"),
  agentList: document.querySelector("#agent-list"),
  agentCount: document.querySelector("#agent-count"),
  emptyState: document.querySelector("#empty-state"),
  dashboard: document.querySelector("#dashboard"),
  taskTitle: document.querySelector("#task-title"),
  taskMeta: document.querySelector("#task-meta"),
  metrics: document.querySelector("#metrics"),
  runVerdicts: document.querySelector("#run-verdicts"),
  runCompareScope: document.querySelector("#run-compare-scope"),
  runCompareSort: document.querySelector("#run-compare-sort"),
  runCompareTable: document.querySelector("#run-compare-table"),
  runCompareSection: document.querySelector("#run-compare-section"),
  runDiffTable: document.querySelector("#run-diff-table"),
  runDiffSection: document.querySelector("#run-diff-section"),
  preflights: document.querySelector("#preflights"),
  preflightSection: document.querySelector("#preflight-section"),
  compareStatusFilter: document.querySelector("#compare-status-filter"),
  compareSort: document.querySelector("#compare-sort"),
  compareSortHint: document.querySelector("#compare-sort-hint"),
  compareTable: document.querySelector("#compare-table"),
  agentCompareSection: document.querySelector("#agent-compare-section"),
  agentTrendTitle: document.querySelector("#agent-trend-title"),
  agentTrendTable: document.querySelector("#agent-trend-table"),
  agentTrendSection: document.querySelector("#agent-trend-section"),
  resultSummary: document.querySelector("#result-summary"),
  resultDetails: document.querySelector("#result-details"),
  judgeSearch: document.querySelector("#judge-search"),
  judgeTypeFilter: document.querySelector("#judge-type-filter"),
  judgeStatusFilter: document.querySelector("#judge-status-filter"),
  markdownPanel: document.querySelector("#markdown-panel"),
  markdownStatus: document.querySelector("#markdown-status"),
  markdownHighlights: document.querySelector("#markdown-highlights"),
  markdownContent: document.querySelector("#markdown-content"),
  copyShareCard: document.querySelector("#copy-share-card"),
  copyPrTable: document.querySelector("#copy-pr-table"),
  copyShareSvg: document.querySelector("#copy-share-svg"),
  downloadShareSvg: document.querySelector("#download-share-svg"),
  clipboardStatus: document.querySelector("#clipboard-status"),
  expandAll: document.querySelector("#expand-all"),
  collapseAll: document.querySelector("#collapse-all")
};

const MESSAGES = {
  en: {
    appTitle: "Web Report",
    appDescription:
      "Open one RepoArena result and inspect who passed, what changed, and where the benchmark failed.",
    languageLabel: "Language",
    runsFolderTitle: "Recommended: Load Run Folder",
    runsFolderHint:
      "Select one RepoArena run folder or the whole `.repoarena` results folder. This is the easiest path.",
    summaryFileTitle: "Load Summary JSON",
    summaryFileHint: "Use this when you only want to open a single `summary.json` file.",
    markdownFileTitle: "Optional: Load Markdown Summary",
    markdownFileHint: "Adds share text, PR table, and markdown notes for the selected run.",
    workflowTitle: "Recommended Flow",
    workflowSteps: [
      "Click “Recommended: Load Run Folder”.",
      "Select one run folder such as `.repoarena/manual-run`, or the parent results folder.",
      "After the report loads, review the verdict cards and click an agent to inspect details."
    ],
    nextStepsTitle: "Next Step",
    nextStepsEmpty:
      "Start with “Recommended: Load Run Folder”. If you only have one file, load `summary.json`. `summary.md` is optional.",
    nextStepsLoaded: (run, runCount) =>
      `Loaded ${runCount} run(s). Current run is “${run.task.title}”. Next: review the top verdict cards, then click an agent on the left or in Agent Compare.`,
    runsHeading: "Runs",
    agentsHeading: "Agents",
    heroEyebrow: "Interactive Viewer",
    heroTitle: "Inspect one benchmark run without digging through raw files.",
    heroDescription:
      "RepoArena compares AI coding agents on the same repository task, then turns the result into a reviewable, shareable report.",
    heroWhatTitle: "What RepoArena does",
    heroWhatBody:
      "It runs multiple coding agents against the same repository task, records success, time, tokens, cost, file changes, and judge results, then shows where one agent performed better or failed.",
    heroHowTitle: "How to start",
    heroHowSteps: [
      "Run a benchmark with the CLI so you get a folder containing `summary.json`.",
      "Open that folder here with “Recommended: Load Run Folder”.",
      "Once loaded, compare agents, inspect judge failures, and export summary text or a share card."
    ],
    topbarEyebrow: "Run Overview",
    expandLogs: "Expand Logs",
    collapseLogs: "Collapse Logs",
    runCompareTitle: "Run Compare",
    runDiffTitle: "Run-to-Run Agent Diff",
    runDiffDescription: "Compare the selected run against the previous run with the same task title.",
    agentCompareTitle: "Agent Compare",
    agentTrendTitle: "Agent Trend",
    agentTrendDescription: "Track the selected agent across runs for the current task title.",
    judgeFiltersTitle: "Judge Filters",
    markdownSummaryTitle: "Markdown Summary",
    copySummary: "Copy Summary",
    copyPrTable: "Copy PR Table",
    copyShareSvg: "Copy Share SVG",
    downloadShareSvg: "Download Share SVG",
    judgeSearchPlaceholder: "Search label, target, expectation",
    noRunsLoaded: "No runs loaded.",
    noReportLoaded: "No report loaded.",
    runInfoTitle: "Run",
    createdAt: "Created at",
    taskSchema: "Task schema",
    linkedMarkdown: "markdown linked",
    jsonOnly: "json only",
    metrics: {
      agents: "Agents",
      success: "Success",
      failed: "Failed",
      tokens: "Tokens",
      knownCost: "Known Cost"
    },
    verdicts: {
      bestAgent: "Best Agent",
      fastest: "Fastest",
      lowestKnownCost: "Lowest Known Cost",
      highestJudgePassRate: "Highest Judge Pass Rate",
      noResult: "No result",
      noKnownCost: "No known cost"
    },
    runCompareScopeCurrent: "Current Task Only",
    runCompareScopeAll: "All Tasks",
    runCompareSortCreated: "Created At (newest first)",
    runCompareSortSuccess: "Success Rate (high to low)",
    runCompareSortTokens: "Tokens (high to low)",
    runCompareSortCost: "Known Cost (low to high)",
    compareStatusAll: "All Statuses",
    compareStatusSuccess: "Success",
    compareStatusFailed: "Failed",
    compareSortStatus: "Status",
    compareSortDuration: "Duration (fastest first)",
    compareSortTokens: "Tokens (high to low)",
    compareSortCost: "Cost (low to high)",
    compareSortChanged: "Changed Files (high to low)",
    compareSortJudges: "Judge Pass Rate (high to low)",
    judgeTypeAll: "All Types",
    judgeStatusAll: "All Statuses",
    judgeStatusPass: "Pass",
    judgeStatusFail: "Fail",
    launcherTitle: "Run Benchmark",
    launcherDescription: "Use the local RepoArena service to start a benchmark from this page.",
    launcherRepoLabel: "Repository Path",
    launcherTaskSelectLabel: "Official Task Pack",
    launcherTaskPathLabel: "Task Pack Path",
    launcherOutputLabel: "Output Folder",
    launcherAgentsLabel: "Agents",
    launcherProbeAuthLabel: "Probe auth before run",
    launcherRunButton: "Start Benchmark",
    launcherStatusIdle: "Fill in the repository path, task pack, and agents, then start the benchmark.",
    launcherStatusRunning: "Benchmark is running. This can take a while for real external agents.",
    launcherStatusRunningPhase: (phase, elapsed) =>
      elapsed ? `${phase} · ${elapsed} elapsed` : phase,
    launcherStatusDone: (title) => `Benchmark finished. Current report: ${title}.`,
    launcherStatusError: (message) => `Run failed: ${message}`,
    launcherPhases: {
      idle: "Idle",
      starting: "Starting benchmark",
      preflight: "Running preflight",
      benchmark: "Running agents",
      report: "Writing report"
    },
    launcherMode: "Local service",
    taskPackCustom: "Custom path"
  },
  "zh-CN": {
    appTitle: "交互报告",
    appDescription: "打开一次 RepoArena 跑分结果，直接看谁成功、改了什么、哪里失败了。",
    languageLabel: "语言",
    runsFolderTitle: "推荐：打开结果文件夹",
    runsFolderHint: "选择一个 RepoArena 单次结果目录，或整个 `.repoarena` 结果目录。这是最省事的入口。",
    summaryFileTitle: "打开 Summary JSON",
    summaryFileHint: "只有单个 `summary.json` 文件时再用这个入口。",
    markdownFileTitle: "可选：打开 Markdown Summary",
    markdownFileHint: "加载后会补充分享文案、PR 表格和 Markdown 面板。",
    workflowTitle: "推荐流程",
    workflowSteps: [
      "先点“推荐：打开结果文件夹”。",
      "选择一个结果目录，例如 `.repoarena/manual-run`，或者更上层的结果目录。",
      "报告加载后，先看顶部结论卡片，再点左侧 agent 查看细节。"
    ],
    nextStepsTitle: "下一步",
    nextStepsEmpty:
      "优先用“推荐：打开结果文件夹”。如果你手头只有一个文件，就加载 `summary.json`。`summary.md` 只是可选增强项。",
    nextStepsLoaded: (run, runCount) =>
      `已加载 ${runCount} 个 run。当前是“${run.task.title}”。下一步先看顶部结论卡片，再点左侧或 Agent Compare 里的 agent 进入详情。`,
    runsHeading: "运行记录",
    agentsHeading: "Agent",
    heroEyebrow: "交互查看器",
    heroTitle: "不用翻一整页静态报告，直接看一次 benchmark 的结论。",
    heroDescription:
      "RepoArena 会把多个 AI coding agent 放到同一个仓库任务里比较，然后把结果整理成可审查、可分享的报告。",
    heroWhatTitle: "RepoArena 是干什么的",
    heroWhatBody:
      "它会在同一个仓库任务上运行多个 coding agent，统一记录成功率、耗时、token、成本、改动文件和 judge 结果，让你知道谁更稳、谁更快、谁失败在什么地方。",
    heroHowTitle: "怎么开始",
    heroHowSteps: [
      "先用 CLI 跑一次 benchmark，生成包含 `summary.json` 的结果目录。",
      "在这个页面里用“推荐：打开结果文件夹”加载它。",
      "加载后比较 agent，查看 judge 失败原因，再导出摘要或分享卡片。"
    ],
    topbarEyebrow: "运行总览",
    expandLogs: "展开日志",
    collapseLogs: "收起日志",
    runCompareTitle: "Run 对比",
    runDiffTitle: "同任务 Run 差异",
    runDiffDescription: "把当前 run 和上一次同名任务 run 直接对比。",
    agentCompareTitle: "Agent 对比",
    agentTrendTitle: "Agent 趋势",
    agentTrendDescription: "查看当前选中 agent 在同一任务下的多次表现。",
    judgeFiltersTitle: "Judge 筛选",
    markdownSummaryTitle: "Markdown 摘要",
    copySummary: "复制摘要",
    copyPrTable: "复制 PR 表格",
    copyShareSvg: "复制分享 SVG",
    downloadShareSvg: "下载分享 SVG",
    judgeSearchPlaceholder: "搜索 label、target、expectation",
    noRunsLoaded: "还没有加载任何 run。",
    noReportLoaded: "还没有加载报告。",
    runInfoTitle: "当前 Run",
    createdAt: "创建时间",
    taskSchema: "任务 Schema",
    linkedMarkdown: "已关联 markdown",
    jsonOnly: "仅 JSON",
    metrics: {
      agents: "Agent 数",
      success: "成功",
      failed: "失败",
      tokens: "Tokens",
      knownCost: "已知成本"
    },
    verdicts: {
      bestAgent: "最佳 Agent",
      fastest: "最快",
      lowestKnownCost: "最低已知成本",
      highestJudgePassRate: "最高 Judge 通过率",
      noResult: "暂无结果",
      noKnownCost: "暂无已知成本"
    },
    runCompareScopeCurrent: "仅当前任务",
    runCompareScopeAll: "所有任务",
    runCompareSortCreated: "按创建时间（新到旧）",
    runCompareSortSuccess: "按成功率（高到低）",
    runCompareSortTokens: "按 Token（高到低）",
    runCompareSortCost: "按已知成本（低到高）",
    compareStatusAll: "全部状态",
    compareStatusSuccess: "成功",
    compareStatusFailed: "失败",
    compareSortStatus: "状态",
    compareSortDuration: "耗时（快到慢）",
    compareSortTokens: "Token（高到低）",
    compareSortCost: "成本（低到高）",
    compareSortChanged: "改动文件数（高到低）",
    compareSortJudges: "Judge 通过率（高到低）",
    judgeTypeAll: "全部类型",
    judgeStatusAll: "全部状态",
    judgeStatusPass: "通过",
    judgeStatusFail: "失败",
    launcherTitle: "发起 Benchmark",
    launcherDescription: "通过本地 RepoArena 服务，直接在这个页面里发起一次 benchmark。",
    launcherRepoLabel: "仓库路径",
    launcherTaskSelectLabel: "官方任务包",
    launcherTaskPathLabel: "任务包路径",
    launcherOutputLabel: "输出目录",
    launcherAgentsLabel: "Agents",
    launcherProbeAuthLabel: "运行前先探测鉴权",
    launcherRunButton: "开始跑分",
    launcherStatusIdle: "填好仓库路径、任务包和 agent，然后直接开始跑分。",
    launcherStatusRunning: "Benchmark 正在运行。真实外部 agent 可能需要一段时间。",
    launcherStatusRunningPhase: (phase, elapsed) =>
      elapsed ? `${phase} · 已运行 ${elapsed}` : phase,
    launcherStatusDone: (title) => `Benchmark 已完成。当前报告：${title}。`,
    launcherStatusError: (message) => `运行失败：${message}`,
    launcherPhases: {
      idle: "空闲",
      starting: "正在启动",
      preflight: "正在预检",
      benchmark: "正在运行",
      report: "正在写报告"
    },
    launcherMode: "本地服务",
    taskPackCustom: "自定义路径"
  }
};

const judgeFilters = {
  search: "",
  type: "all",
  status: "all"
};

const compareFilters = {
  status: "all",
  sort: "status"
};

const runCompareFilters = {
  sort: "created",
  scope: "current-task"
};

function t(key, ...args) {
  const language = MESSAGES[state.language] ? state.language : "en";
  const value = key
    .split(".")
    .reduce((current, segment) => (current && segment in current ? current[segment] : undefined), MESSAGES[language]);

  if (typeof value === "function") {
    return value(...args);
  }

  return value ?? key;
}

function setText(id, value) {
  const element = document.querySelector(`#${id}`);
  if (element) {
    element.textContent = value;
  }
}

function renderList(element, items) {
  element.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDuration(durationMs) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(2)}s`;
}

function formatElapsedDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatCost(result) {
  return result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a";
}

function runtimeIdentity(record) {
  return {
    model: record.resolvedRuntime?.effectiveModel ?? record.requestedConfig?.model ?? "unknown",
    reasoning:
      record.resolvedRuntime?.effectiveReasoningEffort ??
      record.requestedConfig?.reasoningEffort ??
      "default",
    source: record.resolvedRuntime?.source ?? "unknown",
    verification: record.resolvedRuntime?.verification ?? "unknown"
  };
}

function resultLabel(record) {
  return record.displayLabel ?? record.agentTitle ?? record.variantId ?? record.agentId;
}

function baseAgentLabel(record) {
  return record.baseAgentId ?? record.agentId;
}

function runtimeVerificationLabel(record) {
  const runtime = runtimeIdentity(record);
  return `${runtime.verification} / ${runtime.source}`;
}

function taskIntentSummary(task) {
  const objective = task.metadata?.objective ?? task.description ?? "";
  const rationale = task.metadata?.judgeRationale ?? "";
  const repoTypes = task.metadata?.repoTypes?.length ? task.metadata.repoTypes.join(", ") : "generic";
  return {
    objective,
    rationale,
    repoTypes
  };
}

function baselineTaskWarning(task) {
  if (task.id === "official-repo-health" || task.id === "repo-health") {
    return state.language === "zh-CN"
      ? "??????????? bug ?? benchmark????? agent ???????????????????????"
      : "This is not a code review or bug-fix benchmark. It only checks whether the agent made one small improvement without breaking baseline repository structure.";
  }

  return state.language === "zh-CN"
    ? "???????? judge ?????? compare ???"
    : "Read the task objective and judge rationale before interpreting the compare results.";
}

function currentRunPhaseLabel() {
  if (!state.runStatus || state.runStatus.state !== "running") {
    return "";
  }

  const phase = t(`launcherPhases.${state.runStatus.phase ?? "starting"}`);
  if (!state.runStatus.startedAt) {
    return phase;
  }

  const elapsed = formatElapsedDuration(Date.now() - new Date(state.runStatus.startedAt).getTime());
  return t("launcherStatusRunningPhase", phase, elapsed);
}

function taskMeaningBadges(task) {
  if (task.id === "official-repo-health" || task.id === "repo-health") {
    return [
      "Baseline Sanity Check",
      state.language === "zh-CN" ? "??????" : "Not a code review",
      state.language === "zh-CN" ? "?? bugfix benchmark" : "Not a bugfix benchmark"
    ];
  }

  return [state.language === "zh-CN" ? "?????????" : "Interpret results through the task goal"];
}

function summarizeTaskPrompt(prompt) {
  const compact = String(prompt ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (!compact) {
    return "n/a";
  }

  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

function summarizeJudges(taskPack) {
  const judges = Array.isArray(taskPack?.judges) ? taskPack.judges : [];
  if (judges.length === 0) {
    return state.language === "zh-CN" ? "?? judge" : "No judges";
  }

  const labels = judges.map((judge) => judge.label || judge.id).filter(Boolean);
  const summary = labels.slice(0, 3).join(", ");
  if (labels.length <= 3) {
    return summary;
  }

  return `${summary}${state.language === "zh-CN" ? ` ? ${labels.length} ?` : ` +${labels.length - 3} more`}`;
}

function summarizeLauncherSelection(selectedTaskPack) {
  const enabledCodex = state.launcherCodexVariants.filter((variant) => variant.enabled);
  const otherAgents = selectedLauncherAgents();
  const variantCount = enabledCodex.length + otherAgents.length;
  const taskTitle = selectedTaskPack?.title || (state.language === "zh-CN" ? "??????" : "Custom task pack");
  const variantNames = [
    ...otherAgents.map((agentId) => state.availableAdapters.find((adapter) => adapter.id === agentId)?.title ?? agentId),
    ...enabledCodex.map((variant) => variant.displayLabel || "Codex CLI")
  ];
  const selectionPreview = variantNames.slice(0, 3).join(", ");
  const extraCount = Math.max(variantNames.length - 3, 0);
  const preview =
    variantNames.length === 0
      ? state.language === "zh-CN"
        ? "????? variant"
        : "No variants selected"
      : `${selectionPreview}${extraCount > 0 ? ` +${extraCount}` : ""}`;

  return state.language === "zh-CN"
    ? `???${taskTitle} | ?? ${variantCount} ? variant | ${preview}`
    : `Task: ${taskTitle} | ${variantCount} variant(s) selected | ${preview}`;
}

function compareHighlights(run, result) {
  const verdict = getRunVerdict(run);
  const highlights = [];

  if (verdict.bestAgent?.agentId === result.agentId) {
    highlights.push(state.language === "zh-CN" ? "综合最佳" : "Best");
  }
  if (verdict.fastest?.agentId === result.agentId) {
    highlights.push(state.language === "zh-CN" ? "最快" : "Fastest");
  }
  if (verdict.lowestKnownCost?.agentId === result.agentId) {
    highlights.push(state.language === "zh-CN" ? "成本最低" : "Lowest Cost");
  }
  if (verdict.highestJudgePassRate?.agentId === result.agentId) {
    highlights.push(state.language === "zh-CN" ? "Judge 最优" : "Top Judges");
  }

  return highlights;
}

function runFocusLine(run) {
  const verdict = getRunVerdict(run);
  const best = verdict.bestAgent ? resultLabel(verdict.bestAgent) : "n/a";
  const fastest = verdict.fastest ? resultLabel(verdict.fastest) : "n/a";

  if (run.task.id === "official-repo-health" || run.task.id === "repo-health") {
    return state.language === "zh-CN"
      ? `这是一次 baseline sanity check，不是代码审查。当前综合最佳是 ${best}，最快是 ${fastest}。`
      : `This is a baseline sanity check, not a code review. Current best is ${best} and fastest is ${fastest}.`;
  }

  return state.language === "zh-CN"
    ? `先按任务目标解读结果。当前综合最佳是 ${best}，最快是 ${fastest}。`
    : `Interpret this run through the task objective first. Current best is ${best} and fastest is ${fastest}.`;
}

function defaultCodexVariant() {
  const defaults = state.serviceInfo?.codexDefaults ?? {};
  const model = defaults.effectiveModel ?? "";
  const reasoning = defaults.effectiveReasoningEffort ?? "";
  const labelParts = ["Codex CLI"];
  if (model) {
    labelParts.push(model);
  }
  if (reasoning) {
    labelParts.push(reasoning);
  }
  return {
    id: crypto.randomUUID(),
    enabled: true,
    displayLabel: labelParts.join(" · "),
    model,
    reasoningEffort: reasoning,
    source: defaults.source ?? "unknown",
    verification: defaults.verification ?? "unknown"
  };
}

function renderStaticText() {
  if (elements.resultLoaderSummary) {
    elements.resultLoaderSummary.textContent =
      state.language === "zh-CN" ? "打开已有结果（备用入口）" : "Open Existing Results (Fallback)";
  }
  setText("app-title", t("appTitle"));
  setText("app-description", t("appDescription"));
  setText("language-label", t("languageLabel"));
  setText("runs-folder-title", t("runsFolderTitle"));
  setText("runs-folder-hint", t("runsFolderHint"));
  setText("summary-file-title", t("summaryFileTitle"));
  setText("summary-file-hint", t("summaryFileHint"));
  setText("markdown-file-title", t("markdownFileTitle"));
  setText("markdown-file-hint", t("markdownFileHint"));
  setText("workflow-title", t("workflowTitle"));
  setText("next-steps-title", t("nextStepsTitle"));
  setText("runs-heading", t("runsHeading"));
  setText("agents-heading", t("agentsHeading"));
  setText("hero-eyebrow", t("heroEyebrow"));
  setText("hero-title", t("heroTitle"));
  setText("hero-description", t("heroDescription"));
  setText("hero-what-title", t("heroWhatTitle"));
  setText("hero-what-body", t("heroWhatBody"));
  setText("hero-how-title", t("heroHowTitle"));
  setText("topbar-eyebrow", t("topbarEyebrow"));
  setText("run-compare-title", t("runCompareTitle"));
  setText("run-diff-title", t("runDiffTitle"));
  setText("run-diff-description", t("runDiffDescription"));
  setText("agent-compare-title", t("agentCompareTitle"));
  setText("agent-trend-description", t("agentTrendDescription"));
  setText("judge-filters-title", t("judgeFiltersTitle"));
  setText("markdown-summary-title", t("markdownSummaryTitle"));
  setText("launcher-title", t("launcherTitle"));
  setText("launcher-mode", t("launcherMode"));
  setText("launcher-description", t("launcherDescription"));
  setText("launcher-repo-label", t("launcherRepoLabel"));
  setText("launcher-task-select-label", t("launcherTaskSelectLabel"));
  setText("launcher-task-path-label", t("launcherTaskPathLabel"));
  setText("launcher-output-label", t("launcherOutputLabel"));
  setText("launcher-agents-label", t("launcherAgentsLabel"));
  setText("launcher-probe-auth-label", t("launcherProbeAuthLabel"));
  setText("expand-all", t("expandLogs"));
  setText("collapse-all", t("collapseLogs"));
  setText("copy-share-card", t("copySummary"));
  setText("copy-pr-table", t("copyPrTable"));
  setText("copy-share-svg", t("copyShareSvg"));
  setText("download-share-svg", t("downloadShareSvg"));
  elements.judgeSearch.placeholder = t("judgeSearchPlaceholder");
  elements.languageSelect.value = state.language;
  elements.runCompareScope.options[0].text = t("runCompareScopeCurrent");
  elements.runCompareScope.options[1].text = t("runCompareScopeAll");
  elements.runCompareSort.options[0].text = t("runCompareSortCreated");
  elements.runCompareSort.options[1].text = t("runCompareSortSuccess");
  elements.runCompareSort.options[2].text = t("runCompareSortTokens");
  elements.runCompareSort.options[3].text = t("runCompareSortCost");
  elements.compareStatusFilter.options[0].text = t("compareStatusAll");
  elements.compareStatusFilter.options[1].text = t("compareStatusSuccess");
  elements.compareStatusFilter.options[2].text = t("compareStatusFailed");
  elements.compareSort.options[0].text = t("compareSortStatus");
  elements.compareSort.options[1].text = t("compareSortDuration");
  elements.compareSort.options[2].text = t("compareSortTokens");
  elements.compareSort.options[3].text = t("compareSortCost");
  elements.compareSort.options[4].text = t("compareSortChanged");
  elements.compareSort.options[5].text = t("compareSortJudges");
  elements.judgeTypeFilter.options[0].text = t("judgeTypeAll");
  elements.judgeStatusFilter.options[0].text = t("judgeStatusAll");
  elements.judgeStatusFilter.options[1].text = t("judgeStatusPass");
  elements.judgeStatusFilter.options[2].text = t("judgeStatusFail");
  elements.launcherRun.textContent = t("launcherRunButton");
  renderList(elements.workflowList, t("workflowSteps"));
  renderList(document.querySelector("#hero-how-list"), t("heroHowSteps"));
}

function renderNextSteps() {
  if (state.runInProgress && state.runStatus?.state === "running") {
    elements.nextStepsContent.textContent = currentRunPhaseLabel() || t("launcherStatusRunning");
    return;
  }

  if (state.notice) {
    elements.nextStepsContent.textContent = state.notice;
    return;
  }

  if (!state.run) {
    elements.nextStepsContent.textContent = t("nextStepsEmpty");
    return;
  }

  elements.nextStepsContent.textContent = t("nextStepsLoaded", state.run, state.runs.length);
}

function renderLauncher() {
  if (!state.serviceInfo) {
    setHidden(elements.launcherPanel, true);
    return;
  }

  setHidden(elements.launcherPanel, false);
  if (!state.run) {
    state.launcherExpanded = true;
  }
  elements.launcherRepoPath.value = elements.launcherRepoPath.value || state.serviceInfo.repoPath || "";
  elements.launcherOutputPath.value = elements.launcherOutputPath.value || state.serviceInfo.defaultOutputPath || "";

  if (state.launcherCodexVariants.length === 0) {
    state.launcherCodexVariants = [defaultCodexVariant()];
  }

  const options = [
    `<option value="">${escapeHtml(t("taskPackCustom"))}</option>`,
    ...state.availableTaskPacks.map(
      (taskPack) =>
        `<option value="${escapeHtml(taskPack.path)}">${escapeHtml(taskPack.title)}</option>`
    )
  ];
  elements.launcherTaskSelect.innerHTML = options.join("");

  if (!elements.launcherTaskPath.value && state.serviceInfo.defaultTaskPath) {
    elements.launcherTaskPath.value = state.serviceInfo.defaultTaskPath;
    elements.launcherTaskSelect.value = state.serviceInfo.defaultTaskPath;
  } else if (elements.launcherTaskPath.value) {
    const matching = state.availableTaskPacks.find((taskPack) => taskPack.path === elements.launcherTaskPath.value);
    elements.launcherTaskSelect.value = matching ? matching.path : "";
  }

  const selectedTaskPack =
    state.availableTaskPacks.find((taskPack) => taskPack.path === elements.launcherTaskPath.value) ?? null;
  const realAdapters = state.availableAdapters.filter((adapter) => adapter.kind !== "demo" && adapter.id !== "codex");
  const debugAdapters = state.availableAdapters.filter((adapter) => adapter.kind === "demo");
  const codexDefaults = state.serviceInfo.codexDefaults ?? {};
  const codexDefaultsText =
    state.language === "zh-CN"
      ? `??????? ${codexDefaults.effectiveModel ?? "unknown"} | ???? ${codexDefaults.effectiveReasoningEffort ?? "default"} | ${codexDefaults.verification ?? "unknown"} / ${codexDefaults.source ?? "unknown"}`
      : `Current default: model ${codexDefaults.effectiveModel ?? "unknown"} | reasoning ${codexDefaults.effectiveReasoningEffort ?? "default"} | ${codexDefaults.verification ?? "unknown"} / ${codexDefaults.source ?? "unknown"}`;

  const taskSummary = selectedTaskPack
    ? `
      <div class="launcher-section">
        <h4>${escapeHtml(state.language === "zh-CN" ? "????" : "Task Intent")}</h4>
        <p class="muted">${escapeHtml(selectedTaskPack.description ?? selectedTaskPack.objective ?? "")}</p>
        <p class="muted"><strong>${escapeHtml(state.language === "zh-CN" ? "??" : "Objective")}:</strong> ${escapeHtml(
            selectedTaskPack.objective ?? "n/a"
          )}</p>
        <p class="muted"><strong>${escapeHtml(state.language === "zh-CN" ? "Judge ??" : "Judge Rationale")}:</strong> ${escapeHtml(
            selectedTaskPack.judgeRationale ?? "n/a"
          )}</p>
        <p class="muted"><strong>${escapeHtml(state.language === "zh-CN" ? "????" : "Repo Types")}:</strong> ${escapeHtml(
            (selectedTaskPack.repoTypes ?? []).join(", ") || "generic"
          )}</p>
        <p class="muted"><strong>${escapeHtml(state.language === "zh-CN" ? "Prompt ??" : "Prompt Summary")}:</strong> ${escapeHtml(
            summarizeTaskPrompt(selectedTaskPack.prompt)
          )}</p>
        <p class="muted"><strong>${escapeHtml(state.language === "zh-CN" ? "Judge ???" : "Judge Checks")}:</strong> ${escapeHtml(
            summarizeJudges(selectedTaskPack)
          )}</p>
        <p class="warning-text">${escapeHtml(
          selectedTaskPack.id === "official-repo-health"
            ? baselineTaskWarning({ id: selectedTaskPack.id })
            : state.language === "zh-CN"
              ? "?? benchmark ???????????????"
              : "Interpret this benchmark in the context of the task objective."
        )}</p>
      </div>
    `
    : "";

  const codexVariants = state.launcherCodexVariants
    .map(
      (variant) => `
        <div class="variant-card" data-codex-variant-id="${escapeHtml(variant.id)}">
          <label class="checkbox">
            <input type="checkbox" data-role="variant-enabled" ${variant.enabled ? "checked" : ""} />
            <span>${escapeHtml(state.language === "zh-CN" ? "???? Codex ??" : "Enable this Codex variant")}</span>
          </label>
          <div class="launcher-grid">
            <label class="field">
              <span>${escapeHtml(state.language === "zh-CN" ? "???" : "Display Label")}</span>
              <input data-role="variant-label" type="text" value="${escapeHtml(variant.displayLabel)}" />
            </label>
            <label class="field">
              <span>${escapeHtml(state.language === "zh-CN" ? "???" : "Model")}</span>
              <input data-role="variant-model" type="text" value="${escapeHtml(variant.model)}" placeholder="gpt-5.4" />
            </label>
            <label class="field">
              <span>${escapeHtml(state.language === "zh-CN" ? "????" : "Reasoning Effort")}</span>
              <input data-role="variant-reasoning" list="reasoning-levels" type="text" value="${escapeHtml(
                variant.reasoningEffort
              )}" placeholder="low / medium / high" />
            </label>
          </div>
          <p class="muted">${escapeHtml(state.language === "zh-CN" ? "????" : "Default source")}: ${escapeHtml(
            variant.source
          )} | ${escapeHtml(state.language === "zh-CN" ? "???" : "Verification")}: ${escapeHtml(
            variant.verification
          )}</p>
          <button type="button" class="variant-remove" data-role="variant-remove">${escapeHtml(
            state.language === "zh-CN" ? "??????" : "Remove variant"
          )}</button>
        </div>
      `
    )
    .join("");

  elements.launcherAgents.innerHTML = `
    ${taskSummary}
    <div class="launcher-section">
      <h4>${escapeHtml(state.language === "zh-CN" ? "?? Agent" : "Real Agents")}</h4>
      <p class="muted">${escapeHtml(
        state.language === "zh-CN"
          ? "????????? agent??????????????"
          : "These are real external agents. Their results count toward the main comparison."
      )}</p>
      <div class="checkbox-grid">
        ${realAdapters
          .map((adapter) => {
            const checked = state.launcherSelectedAgentIds.includes(adapter.id) ? "checked" : "";
            return `
              <label class="checkbox">
                <input type="checkbox" data-role="real-agent" value="${escapeHtml(adapter.id)}" ${checked} />
                <span>${escapeHtml(adapter.title)} <span class="muted">(${escapeHtml(adapter.id)})</span></span>
              </label>
            `;
          })
          .join("")}
      </div>
    </div>
    <div class="launcher-section">
      <div class="panel-header">
        <h4>${escapeHtml(state.language === "zh-CN" ? "Codex ??" : "Codex Variants")}</h4>
        <button id="launcher-add-codex-variant" type="button">${escapeHtml(
          state.language === "zh-CN" ? "?? Codex ??" : "Add Codex variant"
        )}</button>
      </div>
      <p class="muted">${escapeHtml(
        state.language === "zh-CN"
          ? "??? Codex ????????????????? CLI ??????????? inferred?"
          : "Use multiple Codex variants to compare concrete model and reasoning configurations. When the CLI does not confirm them, RepoArena marks the identity as inferred."
      )}</p>
      <p class="muted">${escapeHtml(codexDefaultsText)}</p>
      <datalist id="reasoning-levels">
        <option value="low"></option>
        <option value="medium"></option>
        <option value="high"></option>
      </datalist>
      ${codexVariants}
    </div>
    <details class="launcher-section">
      <summary>${escapeHtml(state.language === "zh-CN" ? "?? Agent???????????" : "Debug Agents (not selected by default)")}</summary>
      <p class="muted">${escapeHtml(
        state.language === "zh-CN"
          ? "Demo Fast / Thorough / Budget ??????? UI ???? adapter???????????"
          : "Demo Fast / Thorough / Budget are built-in synthetic adapters for validating the pipeline and UI. They do not represent real model capability."
      )}</p>
      <div class="checkbox-grid">
        ${debugAdapters
          .map((adapter) => {
            const checked = state.launcherSelectedAgentIds.includes(adapter.id) ? "checked" : "";
            return `
              <label class="checkbox">
                <input type="checkbox" data-role="debug-agent" value="${escapeHtml(adapter.id)}" ${checked} />
                <span>${escapeHtml(adapter.title)} <span class="muted">(${escapeHtml(adapter.id)})</span></span>
              </label>
            `;
          })
          .join("")}
      </div>
    </details>
  `;

  elements.launcherRun.disabled = state.runInProgress;
  elements.launcherCompactSummary.textContent = summarizeLauncherSelection(selectedTaskPack);
  elements.launcherToggle.textContent = state.launcherExpanded
    ? state.language === "zh-CN"
      ? "????"
      : "Hide Setup"
    : state.language === "zh-CN"
      ? "????"
      : "Show Setup";
  setHidden(elements.launcherBody, !state.launcherExpanded);
  elements.launcherStatus.textContent = state.runInProgress
    ? currentRunPhaseLabel() || t("launcherStatusRunning")
    : state.notice ?? t("launcherStatusIdle");
}

async function detectService() {
  try {
    const [infoResponse, adaptersResponse, taskPacksResponse, runStatusResponse] = await Promise.all([
      fetch("/api/ui-info"),
      fetch("/api/adapters"),
      fetch("/api/taskpacks"),
      fetch("/api/run-status", { cache: "no-store" })
    ]);
    if (!infoResponse.ok || !adaptersResponse.ok || !taskPacksResponse.ok || !runStatusResponse.ok) {
      return;
    }

    state.serviceInfo = await infoResponse.json();
    state.availableAdapters = await adaptersResponse.json();
    state.availableTaskPacks = await taskPacksResponse.json();
    state.runStatus = await runStatusResponse.json();
    state.runInProgress = state.runStatus?.state === "running";
    if (state.runInProgress) {
      startRunStatusPolling();
    } else {
      stopRunStatusPolling();
    }
  } catch {
    stopRunStatusPolling();
    state.serviceInfo = null;
    state.availableAdapters = [];
    state.availableTaskPacks = [];
    state.runInProgress = false;
    state.runStatus = null;
  }

  render();
}

async function pollRunStatus() {
  if (!state.serviceInfo) {
    return;
  }

  try {
    const response = await fetch("/api/run-status", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    state.runStatus = await response.json();
    if (state.runStatus?.state !== "running" && state.runStatusPollTimer) {
      stopRunStatusPolling();
    }
  } catch {
    state.runStatus = null;
  }

  renderLauncher();
  renderNextSteps();
}

function stopRunStatusPolling() {
  if (state.runStatusPollTimer) {
    clearInterval(state.runStatusPollTimer);
    state.runStatusPollTimer = null;
  }
}

function startRunStatusPolling() {
  stopRunStatusPolling();
  void pollRunStatus();
  state.runStatusPollTimer = window.setInterval(() => {
    void pollRunStatus();
  }, 1000);
}

function selectedLauncherAgents() {
  return Array.from(
    elements.launcherAgents.querySelectorAll('input[data-role="real-agent"]:checked, input[data-role="debug-agent"]:checked')
  ).map((input) => input.value);
}

function selectedLauncherVariants() {
  const codexVariants = state.launcherCodexVariants
    .filter((variant) => variant.enabled)
    .map((variant) => ({
      baseAgentId: "codex",
      displayLabel: variant.displayLabel.trim() || "Codex CLI",
      config: {
        model: variant.model.trim() || undefined,
        reasoningEffort: variant.reasoningEffort.trim() || undefined
      },
      configSource: "ui"
    }));

  const otherAgents = selectedLauncherAgents().map((agentId) => ({
    baseAgentId: agentId,
    displayLabel: state.availableAdapters.find((adapter) => adapter.id === agentId)?.title ?? agentId,
    config: {},
    configSource: "ui"
  }));

  return [...otherAgents, ...codexVariants];
}

function syncLauncherStateFromDom() {
  state.launcherSelectedAgentIds = selectedLauncherAgents();
  state.launcherCodexVariants = Array.from(
    elements.launcherAgents.querySelectorAll("[data-codex-variant-id]")
  ).map((element) => ({
    id: element.getAttribute("data-codex-variant-id"),
    enabled: element.querySelector('[data-role="variant-enabled"]')?.checked ?? true,
    displayLabel: element.querySelector('[data-role="variant-label"]')?.value ?? "Codex CLI",
    model: element.querySelector('[data-role="variant-model"]')?.value ?? "",
    reasoningEffort: element.querySelector('[data-role="variant-reasoning"]')?.value ?? "",
    source: state.serviceInfo?.codexDefaults?.source ?? "unknown",
    verification: state.serviceInfo?.codexDefaults?.verification ?? "unknown"
  }));
}

async function handleLauncherRun() {
  const agents = selectedLauncherVariants();
  const payload = {
    repoPath: elements.launcherRepoPath.value.trim(),
    taskPath: elements.launcherTaskPath.value.trim(),
    outputPath: elements.launcherOutputPath.value.trim() || undefined,
    agents,
    probeAuth: elements.launcherProbeAuth.checked
  };

  if (!payload.repoPath || !payload.taskPath || agents.length === 0) {
    state.notice =
      state.language === "zh-CN"
        ? "仓库路径、任务包路径和至少一个 agent 是必填项。"
        : "Repository path, task pack path, and at least one agent are required.";
    render();
    return;
  }

  state.runInProgress = true;
  state.runStatus = {
    state: "running",
    phase: "starting",
    startedAt: new Date().toISOString()
  };
  state.notice = t("launcherStatusRunning");
  startRunStatusPolling();
  render();

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Unknown error");
    }

    state.notice = t("launcherStatusDone", result.run.task.title);
    state.launcherExpanded = false;
    stopRunStatusPolling();
    state.runStatus = null;
    applySingleRun(result.run, result.markdown);
  } catch (error) {
    stopRunStatusPolling();
    state.runStatus = null;
    state.runInProgress = false;
    state.notice = t("launcherStatusError", error instanceof Error ? error.message : String(error));
    render();
    return;
  }

  stopRunStatusPolling();
  state.runStatus = null;
  state.runInProgress = false;
  render();
}

function deltaClass(value, preferred = "lower") {
  if (value === null || value === 0) {
    return "delta-neutral";
  }

  const improved = preferred === "lower" ? value < 0 : value > 0;
  return improved ? "delta-positive" : "delta-negative";
}

function formatSignedNumber(value, formatter, preferred = "lower") {
  if (value === null) {
    return `<span class="muted">n/a</span>`;
  }

  if (value === 0) {
    return `<span class="delta-neutral">0</span>`;
  }

  return `<span class="${deltaClass(value, preferred)}">${formatter(value)}</span>`;
}

function formatJudgeType(type) {
  switch (type) {
    case "file-exists":
      return state.language === "zh-CN" ? "文件存在" : "File Exists";
    case "file-contains":
      return state.language === "zh-CN" ? "文件包含内容" : "File Contains";
    case "json-value":
      return state.language === "zh-CN" ? "JSON 值断言" : "JSON Value";
    case "glob":
      return state.language === "zh-CN" ? "Glob 匹配" : "Glob";
    case "file-count":
      return state.language === "zh-CN" ? "文件数量" : "File Count";
    case "snapshot":
      return state.language === "zh-CN" ? "快照" : "Snapshot";
    case "json-schema":
      return state.language === "zh-CN" ? "JSON Schema" : "JSON Schema";
    default:
      return state.language === "zh-CN" ? "命令" : "Command";
  }
}

function statusClass(status) {
  return `status-${status}`;
}

function setHidden(element, hidden) {
  element.classList.toggle("hidden", hidden);
}

function sortRuns(runs) {
  return [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function updateCurrentRun() {
  state.run = state.runs.find((run) => run.runId === state.selectedRunId) ?? null;
  if (!state.run) {
    state.selectedAgentId = null;
    return;
  }

  if (!state.run.results.some((result) => result.agentId === state.selectedAgentId)) {
    state.selectedAgentId = state.run.results[0]?.agentId ?? null;
  }
}

function applyRuns(runs, markdownByRunId = new Map()) {
  state.runs = sortRuns(runs);
  state.markdownByRunId = markdownByRunId;
  state.selectedRunId = state.runs[0]?.runId ?? null;
  updateCurrentRun();
  render();
}

function applySingleRun(run, markdown = null) {
  const existingRuns = state.runs.filter((entry) => entry.runId !== run.runId);
  const markdownByRunId = new Map(state.markdownByRunId);
  if (markdown) {
    markdownByRunId.set(run.runId, markdown);
  }
  applyRuns([run, ...existingRuns], markdownByRunId);
}

function renderRunInfo(run) {
  const intent = taskIntentSummary(run.task);
  elements.runInfo.innerHTML = `
    <div class="panel-header">
      <h2>${escapeHtml(t("runInfoTitle"))}</h2>
      <span class="muted">${escapeHtml(run.runId)}</span>
    </div>
    <p class="muted">${escapeHtml(t("createdAt"))} ${escapeHtml(run.createdAt)}</p>
    <p class="muted">${escapeHtml(t("taskSchema"))} ${escapeHtml(run.task.schemaVersion)}</p>
    <p class="muted"><strong>${escapeHtml(state.language === "zh-CN" ? "????" : "Objective")}:</strong> ${escapeHtml(intent.objective || "n/a")}</p>
    <p class="muted"><strong>${escapeHtml(state.language === "zh-CN" ? "Judge ??" : "Judge Rationale")}:</strong> ${escapeHtml(intent.rationale || "n/a")}</p>
    <p class="warning-text">${escapeHtml(baselineTaskWarning(run.task))}</p>
  `;
  setHidden(elements.runInfo, false);
}

function renderTaskBrief(run) {
  const intent = taskIntentSummary(run.task);
  const repoTypes = intent.repoTypes && intent.repoTypes !== "generic" ? intent.repoTypes : "generic";
  const resultCount = run.results.length;
  const variantLabels = run.results.map((result) => resultLabel(result)).join(", ");
  const badges = taskMeaningBadges(run.task);

  elements.taskBrief.innerHTML = `
    <div class="panel-header">
      <h3>${escapeHtml(state.language === "zh-CN" ? "??????????" : "What this run actually measures")}</h3>
      <span class="muted">${escapeHtml(resultCount)} ${escapeHtml(state.language === "zh-CN" ? "? variant" : "variants")}</span>
    </div>
    <div class="badge-row">
      ${badges.map((badge) => `<span class="meaning-badge">${escapeHtml(badge)}</span>`).join("")}
    </div>
    <article class="brief-card brief-focus-card">
      <p class="metric-label">${escapeHtml(state.language === "zh-CN" ? "???????" : "How to read this result")}</p>
      <p>${escapeHtml(runFocusLine(run))}</p>
    </article>
    <div class="brief-grid">
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(state.language === "zh-CN" ? "????" : "Objective")}</p>
        <p>${escapeHtml(intent.objective || run.task.description || "n/a")}</p>
      </article>
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(state.language === "zh-CN" ? "Judge ??" : "Judge Rationale")}</p>
        <p>${escapeHtml(intent.rationale || "n/a")}</p>
      </article>
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(state.language === "zh-CN" ? "????" : "Repo Types")}</p>
        <p>${escapeHtml(repoTypes)}</p>
      </article>
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(state.language === "zh-CN" ? "??????" : "Compared Variants")}</p>
        <p>${escapeHtml(variantLabels || "n/a")}</p>
      </article>
    </div>
    <p class="warning-text">${escapeHtml(baselineTaskWarning(run.task))}</p>
  `;
}

function renderRunList() {
  elements.runCount.textContent = String(state.runs.length);

  if (state.runs.length === 0) {
    elements.runList.className = "run-list empty-state";
    elements.runList.textContent = t("noRunsLoaded");
    return;
  }

  elements.runList.className = "run-list";
  elements.runList.innerHTML = state.runs
    .map((run) => {
      const active = run.runId === state.selectedRunId ? "active" : "";
      const successCount = run.results.filter((result) => result.status === "success").length;
      const hasMarkdown = state.markdownByRunId.has(run.runId);

      return `
        <button class="run-button ${active}" type="button" data-run-id="${escapeHtml(run.runId)}">
          <strong>${escapeHtml(run.task.title)}</strong>
          <div class="meta">${escapeHtml(run.createdAt)}</div>
          <div class="meta">${successCount}/${run.results.length} success | ${escapeHtml(run.runId)}</div>
          <div class="meta">${hasMarkdown ? escapeHtml(t("linkedMarkdown")) : escapeHtml(t("jsonOnly"))}</div>
        </button>
      `;
    })
    .join("");
}

function renderMetrics(run) {
  const summary = summarizeRun(run);

  elements.metrics.innerHTML = `
    <article class="metric">
      <p class="metric-label">${escapeHtml(t("metrics.agents"))}</p>
      <p class="metric-value">${summary.totalAgents}</p>
    </article>
    <article class="metric">
      <p class="metric-label">${escapeHtml(t("metrics.success"))}</p>
      <p class="metric-value">${summary.successCount}</p>
    </article>
    <article class="metric">
      <p class="metric-label">${escapeHtml(t("metrics.failed"))}</p>
      <p class="metric-value">${summary.failedCount}</p>
    </article>
    <article class="metric">
      <p class="metric-label">${escapeHtml(t("metrics.tokens"))}</p>
      <p class="metric-value">${summary.totalTokens}</p>
    </article>
    <article class="metric">
      <p class="metric-label">${escapeHtml(t("metrics.knownCost"))}</p>
      <p class="metric-value">$${summary.knownCost.toFixed(2)}</p>
    </article>
  `;
}

function renderRunCompareTable() {
  if (state.runs.length === 0) {
    elements.runCompareTable.innerHTML = `<p class="empty-state">${escapeHtml(t("noRunsLoaded"))}</p>`;
    return;
  }

  const taskTitle = runCompareFilters.scope === "current-task" ? state.run?.task.title ?? null : null;
  const rows = getRunCompareRows(state.runs, {
    taskTitle,
    sort: runCompareFilters.sort,
    markdownByRunId: state.markdownByRunId
  });
  elements.runCompareTable.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>${escapeHtml(state.language === "zh-CN" ? "Run" : "Run")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "任务" : "Task")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "创建时间" : "Created")}</th>
          <th>${escapeHtml(t("metrics.success"))}</th>
          <th>${escapeHtml(t("metrics.agents"))}</th>
          <th>${escapeHtml(t("metrics.tokens"))}</th>
          <th>${escapeHtml(t("metrics.knownCost"))}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "Markdown" : "Markdown")}</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(({ run, summary }) => {
            const isActive = run.runId === state.selectedRunId ? "active" : "";
            return `
              <tr class="${isActive}" data-compare-run-id="${escapeHtml(run.runId)}">
                <td><code>${escapeHtml(run.runId)}</code></td>
                <td>${escapeHtml(run.task.title)}</td>
                <td>${escapeHtml(run.createdAt)}</td>
                <td>${summary.successCount}/${summary.totalAgents}</td>
                <td>${summary.totalAgents}</td>
                <td>${summary.totalTokens}</td>
                <td>$${summary.knownCost.toFixed(2)}</td>
                <td>${state.markdownByRunId.has(run.runId) ? escapeHtml(t("linkedMarkdown")) : escapeHtml(state.language === "zh-CN" ? "无" : "none")}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderPreflights(run) {
  elements.preflights.innerHTML = run.preflights
    .map(
      (preflight) => `
        <article class="preflight-card ${escapeHtml(preflight.status)}">
          <div class="panel-header">
            <h3>${escapeHtml(resultLabel(preflight))}</h3>
            <span class="status-badge ${statusClass(preflight.status)}">${escapeHtml(preflight.status)}</span>
          </div>
          <p>${escapeHtml(preflight.summary)}</p>
          <p class="muted">${escapeHtml(state.language === "zh-CN" ? "鍩虹 Agent" : "Base Agent")}: ${escapeHtml(baseAgentLabel(preflight))}</p>
          <p class="muted">${escapeHtml(state.language === "zh-CN" ? "妯″瀷 / 鎬濊€冪瓑绾?" : "Model / Reasoning")}: ${escapeHtml(runtimeIdentity(preflight).model)} / ${escapeHtml(runtimeIdentity(preflight).reasoning)}</p>
          <p class="muted">${escapeHtml(state.language === "zh-CN" ? "淇℃伅鏉ユ簮" : "Verification")}: ${escapeHtml(runtimeVerificationLabel(preflight))}</p>
          <p class="muted">${escapeHtml(state.language === "zh-CN" ? "支持层级" : "Tier")}: ${escapeHtml(preflight.capability.supportTier)} | ${escapeHtml(state.language === "zh-CN" ? "Trace" : "Trace")}: ${escapeHtml(
            preflight.capability.traceRichness
          )}</p>
          <p class="muted">${escapeHtml(state.language === "zh-CN" ? "调用方式" : "Invocation")}: ${escapeHtml(preflight.capability.invocationMethod)}</p>
          <p class="muted">${escapeHtml(t("metrics.tokens"))}: ${escapeHtml(preflight.capability.tokenAvailability)} | ${escapeHtml(state.language === "zh-CN" ? "成本" : "Cost")}: ${escapeHtml(
            preflight.capability.costAvailability
          )}</p>
          ${
            preflight.capability.authPrerequisites.length > 0
              ? `<p class="muted">${escapeHtml(state.language === "zh-CN" ? "鉴权要求" : "Auth")}: ${escapeHtml(preflight.capability.authPrerequisites.join("; "))}</p>`
              : ""
          }
          ${
            preflight.capability.knownLimitations.length > 0
              ? `<p class="muted">${escapeHtml(state.language === "zh-CN" ? "限制" : "Limitations")}: ${escapeHtml(preflight.capability.knownLimitations.join("; "))}</p>`
              : ""
          }
          ${
            preflight.details?.length
              ? `<ul>${preflight.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>`
              : ""
          }
        </article>
      `
    )
    .join("");
}

function renderVerdicts(run) {
  const verdict = getRunVerdict(run);
  const cards = [
    {
      label: t("verdicts.bestAgent"),
      value: verdict.bestAgent ? resultLabel(verdict.bestAgent) : "n/a",
      meta: verdict.bestAgent
        ? `${runtimeIdentity(verdict.bestAgent).model} | ${runtimeIdentity(verdict.bestAgent).reasoning}`
        : t("verdicts.noResult")
    },
    {
      label: t("verdicts.fastest"),
      value: verdict.fastest ? resultLabel(verdict.fastest) : "n/a",
      meta: verdict.fastest ? formatDuration(verdict.fastest.durationMs) : t("verdicts.noResult")
    },
    {
      label: t("verdicts.lowestKnownCost"),
      value: verdict.lowestKnownCost ? resultLabel(verdict.lowestKnownCost) : "n/a",
      meta: verdict.lowestKnownCost ? formatCost(verdict.lowestKnownCost) : t("verdicts.noKnownCost")
    },
    {
      label: t("verdicts.highestJudgePassRate"),
      value: verdict.highestJudgePassRate ? resultLabel(verdict.highestJudgePassRate) : "n/a",
      meta: verdict.highestJudgePassRate
        ? `${verdict.highestJudgePassRate.judgeResults.filter((judge) => judge.success).length}/${verdict.highestJudgePassRate.judgeResults.length}`
        : t("verdicts.noResult")
    }
  ];

  elements.runVerdicts.innerHTML = cards
    .map(
      (card) => `
        <article class="metric verdict-card">
          <p class="metric-label">${escapeHtml(card.label)}</p>
          <p class="metric-value">${escapeHtml(card.value)}</p>
          <p class="muted">${escapeHtml(card.meta)}</p>
        </article>
      `
    )
    .join("");
}

function renderAgentList(run) {
  elements.agentCount.textContent = String(run.results.length);
  elements.agentList.classList.remove("empty-state");
  elements.agentList.innerHTML = run.results
    .map((result) => {
      const active = result.agentId === state.selectedAgentId ? "active" : "";
      const runtime = runtimeIdentity(result);
      return `
        <button class="agent-button ${active}" type="button" data-agent-id="${escapeHtml(result.agentId)}">
          <div class="row">
            <strong>${escapeHtml(resultLabel(result))}</strong>
            <span class="status-badge ${statusClass(result.status)}">${escapeHtml(result.status)}</span>
          </div>
          <div class="meta">
            ${escapeHtml(runtime.model)} | ${escapeHtml(runtime.reasoning)} | ${escapeHtml(formatDuration(result.durationMs))} | ${escapeHtml(
              formatCost(result)
            )}
          </div>
        </button>
      `;
    })
    .join("");
}

function renderStepCards(title, steps) {
  const content =
    steps.length === 0
      ? `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "没有执行任何命令。" : "No commands executed.")}</p>`
      : `<div class="step-list">${steps
          .map(
            (step) => `
              <details class="step-card">
                <summary>
                  <strong>${escapeHtml(step.label)}</strong>
                  <span class="status-badge ${statusClass(step.success ? "success" : "failed")}">${
                    step.success ? (state.language === "zh-CN" ? "通过" : "pass") : (state.language === "zh-CN" ? "失败" : "fail")
                  }</span>
                  <span class="muted">${escapeHtml(formatDuration(step.durationMs))}</span>
                </summary>
                <div class="detail-row"><span>${escapeHtml(state.language === "zh-CN" ? "命令" : "Command")}</span><code>${escapeHtml(step.command)}</code></div>
                <div class="detail-row"><span>CWD</span><code>${escapeHtml(step.cwd)}</code></div>
                ${
                  step.stdout
                    ? `<p class="muted">stdout</p><pre>${escapeHtml(step.stdout)}</pre>`
                    : ""
                }
                ${
                  step.stderr
                    ? `<p class="muted">stderr</p><pre>${escapeHtml(step.stderr)}</pre>`
                    : ""
                }
              </details>
            `
          )
          .join("")}</div>`;

  return `<section class="detail-card"><h3>${escapeHtml(title)}</h3>${content}</section>`;
}

function renderJudgeCards(result) {
  const judges = result.judgeResults;
  const filteredJudges = judges.filter((judge) => {
    const matchesType = judgeFilters.type === "all" || judge.type === judgeFilters.type;
    const matchesStatus =
      judgeFilters.status === "all" ||
      (judgeFilters.status === "pass" ? judge.success : !judge.success);
    const haystack = [judge.label, judge.target ?? "", judge.expectation ?? "", judge.command ?? ""]
      .join(" ")
      .toLowerCase();
    const matchesSearch = judgeFilters.search === "" || haystack.includes(judgeFilters.search);

    return matchesType && matchesStatus && matchesSearch;
  });

  const byType = judges.reduce((map, judge) => {
    map.set(judge.type, (map.get(judge.type) ?? 0) + 1);
    return map;
  }, new Map());

  const overview =
    judges.length === 0
      ? `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "没有执行任何 judge。" : "No judges executed.")}</p>`
      : `
        <div class="judge-overview">
          ${Array.from(byType.entries())
            .map(
              ([type, count]) => `
                <div class="judge-chip">
                  <span>${escapeHtml(formatJudgeType(type))}</span>
                  <strong>${count}</strong>
                </div>
              `
            )
            .join("")}
        </div>
      `;

  const content =
    filteredJudges.length === 0
      ? ""
      : `<div class="step-list">${filteredJudges
          .map(
            (judge) => `
              <details class="step-card judge-card">
                <summary>
                  <strong>${escapeHtml(judge.label)}</strong>
                  <span class="judge-kind">${escapeHtml(formatJudgeType(judge.type))}</span>
                  <span class="status-badge ${statusClass(judge.success ? "success" : "failed")}">${
                    judge.success ? (state.language === "zh-CN" ? "通过" : "pass") : (state.language === "zh-CN" ? "失败" : "fail")
                  }</span>
                  <span class="muted">${escapeHtml(formatDuration(judge.durationMs))}</span>
                </summary>
                ${
                  judge.target
                    ? `<div class="detail-row"><span>${escapeHtml(state.language === "zh-CN" ? "目标" : "Target")}</span><code>${escapeHtml(judge.target)}</code></div>`
                    : ""
                }
                ${
                  judge.expectation
                    ? `<div class="detail-row"><span>${escapeHtml(state.language === "zh-CN" ? "期望" : "Expectation")}</span><code>${escapeHtml(judge.expectation)}</code></div>`
                    : ""
                }
                ${
                  judge.command
                    ? `<div class="detail-row"><span>${escapeHtml(state.language === "zh-CN" ? "命令" : "Command")}</span><code>${escapeHtml(judge.command)}</code></div>`
                    : ""
                }
                ${
                  judge.cwd
                    ? `<div class="detail-row"><span>CWD</span><code>${escapeHtml(judge.cwd)}</code></div>`
                    : ""
                }
                ${
                  judge.stdout
                    ? `<p class="muted">stdout</p><pre>${escapeHtml(judge.stdout)}</pre>`
                    : ""
                }
                ${
                  judge.stderr
                    ? `<p class="muted">stderr</p><pre>${escapeHtml(judge.stderr)}</pre>`
                    : ""
                }
              </details>
            `
          )
          .join("")}</div>`;

  return `<section class="detail-card"><h3>${escapeHtml(state.language === "zh-CN" ? "Judges" : "Judges")}</h3>${overview}${
    filteredJudges.length === 0 && judges.length > 0
      ? `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "当前筛选下没有匹配的 judge。" : "No judges match the current filters.")}</p>`
      : content
  }</section>`;
}

function populateJudgeFilters(run) {
  const judgeTypes = Array.from(
    new Set(run.results.flatMap((result) => result.judgeResults.map((judge) => judge.type)))
  ).sort();

  const currentType = judgeFilters.type;
  elements.judgeTypeFilter.innerHTML = [
    `<option value="all">${escapeHtml(t("judgeTypeAll"))}</option>`,
    ...judgeTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(formatJudgeType(type))}</option>`)
  ].join("");
  elements.judgeTypeFilter.value = judgeTypes.includes(currentType) ? currentType : "all";
}

function renderDiff(result) {
  const sections = [
    [state.language === "zh-CN" ? "新增" : "Added", result.diff.added],
    [state.language === "zh-CN" ? "修改" : "Changed", result.diff.changed],
    [state.language === "zh-CN" ? "删除" : "Removed", result.diff.removed]
  ];

  return `
    <section class="detail-card">
      <h3>${escapeHtml(state.language === "zh-CN" ? "Diff 细分" : "Diff Breakdown")}</h3>
      <div class="diff-grid">
        ${sections
          .map(
            ([label, files]) => `
              <div class="diff-column">
                <h4>${escapeHtml(label)}</h4>
                ${
                  files.length === 0
                    ? `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "无" : "None")}</p>`
                    : `<ul>${files.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul>`
                }
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderMarkdownBlock(markdown) {
  const escaped = escapeHtml(markdown);
  return `<pre>${escaped}</pre>`;
}

function renderMarkdownPanel() {
  const markdown =
    (state.run && state.markdownByRunId.get(state.run.runId)) ??
    state.standaloneMarkdown ??
    null;

  if (!markdown) {
    setHidden(elements.markdownPanel, true);
    elements.markdownStatus.textContent = state.language === "zh-CN" ? "未加载" : "Not loaded";
    elements.markdownContent.innerHTML = "";
    return;
  }

  setHidden(elements.markdownPanel, false);
  elements.markdownStatus.textContent = state.run && state.markdownByRunId.has(state.run.runId)
    ? (state.language === "zh-CN" ? "已关联当前 run" : "Linked to selected run")
    : (state.language === "zh-CN" ? "独立 markdown" : "Standalone markdown");
  elements.markdownHighlights.innerHTML = state.run
    ? `
        <section class="detail-card">
          <h4>${escapeHtml(state.language === "zh-CN" ? "重点摘要" : "Highlights")}</h4>
          <pre>${escapeHtml(buildShareCard(state.run))}</pre>
        </section>
      `
    : `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "先加载一个 run，才能看到摘要亮点。" : "Load a run to see summary highlights.")}</p>`;
  elements.markdownContent.innerHTML = renderMarkdownBlock(markdown);
}

function renderCompareTableV2(run) {
  const results = getCompareResults(run, compareFilters);
  const sortHintMap = {
    status: state.language === "zh-CN" ? "先按状态分层，再把更快的结果排前面。" : "Sorted by status first, then by fastest duration.",
    duration: state.language === "zh-CN" ? "按耗时排序，越快越靠前。" : "Sorted by fastest variants first.",
    tokens: state.language === "zh-CN" ? "按 token 用量排序，越高越靠前。" : "Sorted by highest token usage first.",
    cost: state.language === "zh-CN" ? "按已知成本排序，越低越靠前。" : "Sorted by lowest known cost first.",
    changed: state.language === "zh-CN" ? "按改动文件数排序，越多越靠前。" : "Sorted by most changed files first.",
    judges: state.language === "zh-CN" ? "按 judge 通过率排序，越高越靠前。" : "Sorted by highest judge pass rate first."
  };
  elements.compareSortHint.textContent = sortHintMap[compareFilters.sort] ?? sortHintMap.status;

  if (results.length === 0) {
    elements.compareTable.innerHTML = `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "没有 variant 符合当前筛选条件。" : "No variants match the current compare filters.")}</p>`;
    return;
  }

  elements.compareTable.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>${escapeHtml(state.language === "zh-CN" ? "Variant" : "Variant")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "模型" : "Model")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "思考等级" : "Reasoning")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "可信度" : "Verification")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "状态" : "Status")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "耗时" : "Duration")}</th>
          <th>${escapeHtml(t("metrics.tokens"))}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "成本" : "Cost")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "改动文件" : "Changed")}</th>
          <th>Judges</th>
        </tr>
      </thead>
      <tbody>
        ${results
          .map((result) => {
            const passedJudges = result.judgeResults.filter((judge) => judge.success).length;
            const isActive = result.agentId === state.selectedAgentId ? "active" : "";
            const runtime = runtimeIdentity(result);

            return `
              <tr class="${isActive}" data-compare-agent-id="${escapeHtml(result.agentId)}">
                <td><strong>${escapeHtml(resultLabel(result))}</strong><br /><code>${escapeHtml(baseAgentLabel(result))}</code></td>
                <td>${escapeHtml(runtime.model)}</td>
                <td>${escapeHtml(runtime.reasoning)}</td>
                <td>${escapeHtml(runtimeVerificationLabel(result))}</td>
                <td><span class="status-badge ${statusClass(result.status)}">${escapeHtml(result.status)}</span></td>
                <td>${escapeHtml(formatDuration(result.durationMs))}</td>
                <td>${result.tokenUsage}</td>
                <td>${escapeHtml(formatCost(result))}</td>
                <td>${result.changedFiles.length}</td>
                <td>${passedJudges}/${result.judgeResults.length}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderSelectedAgentV2() {
  if (!state.run || !state.selectedAgentId) {
    return;
  }

  const result = state.run.results.find((entry) => entry.agentId === state.selectedAgentId);
  if (!result) {
    return;
  }

  const runtime = runtimeIdentity(result);
  const judgeKinds =
    Array.from(new Set(result.judgeResults.map((judge) => formatJudgeType(judge.type)))).join(", ") ||
    (state.language === "zh-CN" ? "无" : "None");

  elements.resultSummary.innerHTML = `
    <h3>${escapeHtml(resultLabel(result))}</h3>
    <div class="summary-grid">
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "基础 Agent" : "Base Agent")}</span><strong>${escapeHtml(baseAgentLabel(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "模型" : "Model")}</span><strong>${escapeHtml(runtime.model)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "思考等级" : "Reasoning")}</span><strong>${escapeHtml(runtime.reasoning)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "可信度" : "Verification")}</span><strong>${escapeHtml(runtimeVerificationLabel(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "状态" : "Status")}</span><strong>${escapeHtml(result.status)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "耗时" : "Duration")}</span><strong>${escapeHtml(formatDuration(result.durationMs))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(t("metrics.tokens"))}</span><strong>${result.tokenUsage}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "成本" : "Cost")}</span><strong>${escapeHtml(formatCost(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "改动文件" : "Changed Files")}</span><strong>${result.changedFiles.length}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "Judge 类型" : "Judge Types")}</span><strong>${escapeHtml(judgeKinds)}</strong></div>
      <div class="summary-row"><span>Trace</span><code>${escapeHtml(result.tracePath)}</code></div>
      <div class="summary-row"><span>Workspace</span><code>${escapeHtml(result.workspacePath)}</code></div>
    </div>
    <p class="muted">${escapeHtml(result.summary)}</p>
  `;

  elements.resultDetails.innerHTML = [
    `
      <section class="detail-card">
        <h3>Model Identity</h3>
        <div class="summary-grid">
          <div class="summary-row"><span>Requested</span><strong>${escapeHtml(result.requestedConfig?.model ?? "default")} / ${escapeHtml(result.requestedConfig?.reasoningEffort ?? "default")}</strong></div>
          <div class="summary-row"><span>Effective</span><strong>${escapeHtml(runtime.model)} / ${escapeHtml(runtime.reasoning)}</strong></div>
          <div class="summary-row"><span>Source</span><strong>${escapeHtml(runtime.source)}</strong></div>
          <div class="summary-row"><span>Verification</span><strong>${escapeHtml(runtime.verification)}</strong></div>
        </div>
      </section>
    `,
    renderStepCards(state.language === "zh-CN" ? "准备步骤" : "Setup", result.setupResults),
    renderJudgeCards(result),
    renderStepCards(state.language === "zh-CN" ? "收尾步骤" : "Teardown", result.teardownResults),
    `
      <section class="detail-card">
        <h3>${escapeHtml(state.language === "zh-CN" ? "改动文件" : "Changed Files")}</h3>
        ${
          result.changedFiles.length === 0
            ? `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "没有检测到 diff。" : "No diff detected.")}</p>`
            : `<ul>${result.changedFiles.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul>`
        }
      </section>
    `,
    renderDiff(result)
  ].join("");
}

function renderDashboard(run) {
  setHidden(elements.emptyState, true);
  setHidden(elements.dashboard, false);

  elements.taskTitle.textContent = run.task.title;
  elements.taskMeta.textContent = `${run.task.id} | ${run.task.schemaVersion} | ${run.createdAt}`;

  renderTaskBrief(run);
  renderRunInfo(run);
  renderMetrics(run);
  renderVerdicts(run);
  renderRunCompareTable();
  renderRunDiffTableV2();
  renderPreflights(run);
  renderAgentList(run);
  renderCompareTableV2(run);
  renderAgentTrendTableV2(run);
  populateJudgeFilters(run);
  renderSelectedAgentV2();
  renderMarkdownPanel();
  setHidden(elements.runCompareSection, state.runs.length <= 1);
  setHidden(elements.runDiffSection, !findPreviousComparableRun(state.runs, run));
  setHidden(
    elements.agentTrendSection,
    !state.selectedAgentId || getAgentTrendRows(state.runs, run, state.selectedAgentId).length <= 1
  );
  renderNextSteps();
}

function render() {
  renderStaticText();
  renderLauncher();
  renderRunList();

  if (!state.run) {
    setHidden(elements.runInfo, true);
    setHidden(elements.emptyState, false);
    setHidden(elements.dashboard, true);
    elements.agentCount.textContent = "0";
    elements.agentList.className = "agent-list empty-state";
    elements.agentList.textContent = t("noReportLoaded");
    elements.runVerdicts.innerHTML = "";
    elements.runCompareTable.innerHTML = "";
    elements.runDiffTable.innerHTML = "";
    elements.agentTrendTitle.textContent = t("agentTrendTitle");
    elements.agentTrendTable.innerHTML = "";
    renderNextSteps();
    renderMarkdownPanel();
    return;
  }

  renderDashboard(state.run);
}

async function readRunFromFile(file) {
  return JSON.parse(await file.text());
}

async function handleFileSelection(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const run = await readRunFromFile(file);
  state.notice =
    state.language === "zh-CN"
      ? "已加载单个 summary.json。现在可以直接查看结果，或者继续加载 summary.md。"
      : "Loaded one summary.json file. You can inspect the run now or optionally load summary.md.";
  applySingleRun(run);
}

async function handleMarkdownSelection(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  state.standaloneMarkdown = await file.text();
  state.notice =
    state.language === "zh-CN"
      ? "Markdown 已加载。如果当前也有 run，分享摘要会自动出现。"
      : "Markdown loaded. If a run is also loaded, the share summary will appear automatically.";
  renderNextSteps();
  renderMarkdownPanel();
}

async function copyToClipboard(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    elements.clipboardStatus.textContent =
      state.language === "zh-CN" ? `${label} 已复制。` : `${label} copied.`;
  } catch (error) {
    elements.clipboardStatus.textContent =
      state.language === "zh-CN" ? `${label} 复制失败。` : `Failed to copy ${label.toLowerCase()}.`;
    console.error(error);
  }
}

function downloadTextFile(filename, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function folderOf(file) {
  const relativePath = file.webkitRelativePath || file.name;
  const segments = relativePath.split("/");
  segments.pop();
  return segments.join("/");
}

async function handleFolderSelection(event) {
  const files = Array.from(event.target.files ?? []);
  const summaryFiles = files.filter((file) => file.name.toLowerCase() === "summary.json");
  if (summaryFiles.length === 0) {
    state.notice =
      state.language === "zh-CN"
        ? "选中的目录里没有 summary.json。请改选一个 RepoArena 结果目录。"
        : "No summary.json file was found in the selected folder. Choose a RepoArena results folder.";
    renderNextSteps();
    return;
  }

  const markdownByFolder = new Map();
  for (const file of files.filter((entry) => entry.name.toLowerCase() === "summary.md")) {
    markdownByFolder.set(folderOf(file), await file.text());
  }

  const runs = [];
  const markdownByRunId = new Map();
  for (const file of summaryFiles) {
    const run = await readRunFromFile(file);
    runs.push(run);
    const markdown = markdownByFolder.get(folderOf(file));
    if (markdown) {
      markdownByRunId.set(run.runId, markdown);
    }
  }

  state.notice =
    state.language === "zh-CN"
      ? `已从目录中识别到 ${runs.length} 个 run。`
      : `Loaded ${runs.length} run(s) from the selected folder.`;
  applyRuns(runs, markdownByRunId);
}

elements.fileInput.addEventListener("change", handleFileSelection);
elements.markdownInput.addEventListener("change", handleMarkdownSelection);
elements.folderInput.addEventListener("change", handleFolderSelection);
elements.launcherTaskSelect.addEventListener("change", (event) => {
  const value = String(event.target.value ?? "");
  if (value) {
    elements.launcherTaskPath.value = value;
  }
  renderLauncher();
});
elements.launcherAgents.addEventListener("change", (event) => {
  if (event.target?.id === "launcher-add-codex-variant") {
    return;
  }
  syncLauncherStateFromDom();
});
elements.launcherAgents.addEventListener("input", () => {
  syncLauncherStateFromDom();
});
elements.launcherAgents.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.id === "launcher-add-codex-variant") {
    state.launcherCodexVariants = [...state.launcherCodexVariants, defaultCodexVariant()];
    renderLauncher();
    return;
  }

  if (target.getAttribute("data-role") === "variant-remove") {
    const card = target.closest("[data-codex-variant-id]");
    const variantId = card?.getAttribute("data-codex-variant-id");
    state.launcherCodexVariants = state.launcherCodexVariants.filter((variant) => variant.id !== variantId);
    if (state.launcherCodexVariants.length === 0) {
      state.launcherCodexVariants = [defaultCodexVariant()];
    }
    renderLauncher();
  }
});
elements.launcherRun.addEventListener("click", handleLauncherRun);
elements.launcherToggle.addEventListener("click", () => {
  state.launcherExpanded = !state.launcherExpanded;
  renderLauncher();
});
elements.languageSelect.addEventListener("change", (event) => {
  state.language = String(event.target.value ?? "en");
  try {
    localStorage.setItem("repoarena.webReport.language", state.language);
  } catch {
    // ignore localStorage failures
  }
  render();
});

elements.runList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-run-id]");
  if (!button) {
    return;
  }

  state.selectedRunId = button.getAttribute("data-run-id");
  updateCurrentRun();
  render();
});

elements.agentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-agent-id]");
  if (!button || !state.run) {
    return;
  }

  state.selectedAgentId = button.getAttribute("data-agent-id");
  renderAgentList(state.run);
  renderCompareTableV2(state.run);
  renderAgentTrendTableV2(state.run);
  renderSelectedAgentV2();
  setHidden(
    elements.agentTrendSection,
    !state.selectedAgentId || getAgentTrendRows(state.runs, state.run, state.selectedAgentId).length <= 1
  );
});

elements.compareTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-compare-agent-id]");
  if (!row || !state.run) {
    return;
  }

  state.selectedAgentId = row.getAttribute("data-compare-agent-id");
  renderAgentList(state.run);
  renderCompareTableV2(state.run);
  renderAgentTrendTableV2(state.run);
  renderSelectedAgentV2();
  setHidden(
    elements.agentTrendSection,
    !state.selectedAgentId || getAgentTrendRows(state.runs, state.run, state.selectedAgentId).length <= 1
  );
});

elements.runCompareTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-compare-run-id]");
  if (!row) {
    return;
  }

  state.selectedRunId = row.getAttribute("data-compare-run-id");
  updateCurrentRun();
  render();
});

elements.runDiffTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-run-diff-agent-id]");
  if (!row || !state.run) {
    return;
  }

  state.selectedAgentId = row.getAttribute("data-run-diff-agent-id");
  renderAgentList(state.run);
  renderCompareTableV2(state.run);
  renderRunDiffTableV2();
  renderAgentTrendTableV2(state.run);
  renderSelectedAgentV2();
  setHidden(
    elements.agentTrendSection,
    !state.selectedAgentId || getAgentTrendRows(state.runs, state.run, state.selectedAgentId).length <= 1
  );
});

elements.agentTrendTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-agent-trend-run-id]");
  if (!row) {
    return;
  }

  state.selectedRunId = row.getAttribute("data-agent-trend-run-id");
  updateCurrentRun();
  render();
});

elements.expandAll.addEventListener("click", () => {
  document.querySelectorAll("details").forEach((element) => {
    element.open = true;
  });
});

elements.collapseAll.addEventListener("click", () => {
  document.querySelectorAll("details").forEach((element) => {
    element.open = false;
  });
});

elements.judgeSearch.addEventListener("input", (event) => {
  judgeFilters.search = String(event.target.value ?? "").trim().toLowerCase();
  renderSelectedAgentV2();
});

elements.judgeTypeFilter.addEventListener("change", (event) => {
  judgeFilters.type = String(event.target.value ?? "all");
  renderSelectedAgentV2();
});

elements.judgeStatusFilter.addEventListener("change", (event) => {
  judgeFilters.status = String(event.target.value ?? "all");
  renderSelectedAgentV2();
});

elements.compareStatusFilter.addEventListener("change", (event) => {
  compareFilters.status = String(event.target.value ?? "all");
  if (state.run) {
    renderCompareTableV2(state.run);
  }
});

elements.compareSort.addEventListener("change", (event) => {
  compareFilters.sort = String(event.target.value ?? "status");
  if (state.run) {
    renderCompareTableV2(state.run);
  }
});

elements.runCompareSort.addEventListener("change", (event) => {
  runCompareFilters.sort = String(event.target.value ?? "created");
  renderRunCompareTable();
});

elements.runCompareScope.addEventListener("change", (event) => {
  runCompareFilters.scope = String(event.target.value ?? "current-task");
  renderRunCompareTable();
});

elements.copyShareCard.addEventListener("click", async () => {
  if (!state.run) {
    return;
  }

  await copyToClipboard(buildShareCard(state.run), "Summary");
});

elements.copyPrTable.addEventListener("click", async () => {
  if (!state.run) {
    return;
  }

  await copyToClipboard(buildPrTable(state.run), "PR table");
});

elements.copyShareSvg.addEventListener("click", async () => {
  if (!state.run) {
    return;
  }

  await copyToClipboard(buildShareCardSvg(state.run), "Share SVG");
});

elements.downloadShareSvg.addEventListener("click", () => {
  if (!state.run) {
    return;
  }

  downloadTextFile(`repoarena-${state.run.runId}.svg`, buildShareCardSvg(state.run), "image/svg+xml");
  elements.clipboardStatus.textContent =
    state.language === "zh-CN" ? "分享 SVG 已下载。" : "Share SVG downloaded.";
});

try {
  state.language = localStorage.getItem("repoarena.webReport.language") || "zh-CN";
} catch {
  state.language = "zh-CN";
}

detectService();
render();
