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
  availableProviderProfiles: [],
  runInProgress: false,
  runStatus: null,
  runStatusPollTimer: null,
  launcherSelectedAgentIds: [],
  launcherCodexVariants: [],
  launcherClaudeVariants: [],
  launcherProviderEditor: null,
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
  launcherProgress: document.querySelector("#launcher-progress"),
  launcherProgressTitle: document.querySelector("#launcher-progress-title"),
  launcherCurrentAgent: document.querySelector("#launcher-current-agent"),
  launcherLogList: document.querySelector("#launcher-log-list"),
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
      'Click "Recommended: Load Run Folder".',
      "Select one run folder such as `.repoarena/manual-run`, or the parent results folder.",
      "After the report loads, review the verdict cards and click an agent to inspect details."
    ],
    nextStepsTitle: "Next Step",
    nextStepsEmpty:
      'Start with "Recommended: Load Run Folder". If you only have one file, load `summary.json`. `summary.md` is optional.',
    nextStepsLoaded: (run, runCount) =>
      `Loaded ${runCount} run(s). Current run is "${run.task.title}". Next: review the top verdict cards, then click an agent on the left or in Agent Compare.`,
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
      'Open that folder here with "Recommended: Load Run Folder".',
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
      elapsed ? `${phase} | ${elapsed} elapsed` : phase,
    launcherStatusDone: (title) => `Benchmark finished. Current report: ${title}.`,
    launcherStatusError: (message) => `Run failed: ${message}`,
    launcherProgressTitle: "Live Progress",
    launcherCurrentAgentIdle: "Waiting to start.",
    launcherCurrentAgentLabel: (agent) => `Current agent: ${agent}`,
    launcherLogEmpty: "No progress entries yet.",
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
    runsFolderHint:
      "选择一个 RepoArena 单次结果目录，或整个 `.repoarena` 结果目录。这是最省事的入口。",
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
      "优先用“推荐：打开结果文件夹”。如果你手头只有一个文件，就加载 `summary.json`。`summary.md` 是可选增强项。",
    nextStepsLoaded: (run, runCount) =>
      `已加载 ${runCount} 个 run。当前报告是“${run.task.title}”。下一步先看顶部结论卡片，再点左侧或 Agent Compare 里的 agent 进入详情。`,
    runsHeading: "运行记录",
    agentsHeading: "Agents",
    heroEyebrow: "交互查看器",
    heroTitle: "不用翻完整页静态报告，直接看一次 benchmark 的结论。",
    heroDescription:
      "RepoArena 会把多个 AI coding agent 放到同一个仓库任务里比较，然后把结果整理成可审查、可分享的报告。",
    heroWhatTitle: "RepoArena 是做什么的",
    heroWhatBody:
      "它会在同一个仓库任务上运行多个 coding agent，统一记录成功率、耗时、Token、成本、改动文件和 judge 结果，让你知道谁更稳、谁更快、谁失败在什么地方。",
    heroHowTitle: "怎么开始",
    heroHowSteps: [
      "先用 CLI 跑一次 benchmark，生成包含 `summary.json` 的结果目录。",
      "在这里用“推荐：打开结果文件夹”加载结果。",
      "加载后先看对比表，再看 judge 失败原因和单个 agent 详情。"
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
    runCompareScopeAll: "全部任务",
    runCompareSortCreated: "按创建时间（新到旧）",
    runCompareSortSuccess: "按成功率（高到低）",
    runCompareSortTokens: "按 Tokens（高到低）",
    runCompareSortCost: "按已知成本（低到高）",
    compareStatusAll: "全部状态",
    compareStatusSuccess: "成功",
    compareStatusFailed: "失败",
    compareSortStatus: "状态",
    compareSortDuration: "耗时（快到慢）",
    compareSortTokens: "Tokens（高到低）",
    compareSortCost: "成本（低到高）",
    compareSortChanged: "改动文件（多到少）",
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
    launcherStatusIdle: "填好仓库路径、任务包和 agent，然后开始跑分。",
    launcherStatusRunning: "Benchmark 正在运行。真实外部 agent 可能需要一段时间。",
    launcherStatusRunningPhase: (phase, elapsed) =>
      elapsed ? `${phase} | 已运行 ${elapsed}` : phase,
    launcherStatusDone: (title) => `Benchmark 已完成。当前报告：${title}。`,
    launcherStatusError: (message) => `运行失败：${message}`,
    launcherProgressTitle: "实时进度",
    launcherCurrentAgentIdle: "等待开始。",
    launcherCurrentAgentLabel: (agent) => `当前 agent：${agent}`,
    launcherLogEmpty: "还没有进度日志。",
    launcherPhases: {
      idle: "空闲",
      starting: "启动 benchmark",
      preflight: "运行预检",
      benchmark: "运行 agents",
      report: "写入报告"
    },
    launcherMode: "本地服务",
    taskPackCustom: "自定义路径"
  }
};const judgeFilters = {
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
    provider: record.resolvedRuntime?.providerProfileName ?? record.requestedConfig?.providerProfileId ?? "official",
    providerKind: record.resolvedRuntime?.providerKind ?? "unknown",
    providerSource: record.resolvedRuntime?.providerSource ?? "unknown",
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

function recordKey(record) {
  return record.variantId ?? record.agentId;
}

function runtimeVerificationLabel(record) {
  const runtime = runtimeIdentity(record);
  return `${runtime.verification} / ${runtime.source}`;
}

function localText(zh, en) {
  return state.language === "zh-CN" ? zh : en;
}

function providerDisplayName(profile) {
  if (!profile) {
    return localText("Official", "Official");
  }
  return profile.name;
}

function defaultClaudeVariant(profile) {
  const model = profile?.primaryModel ?? "";
  const displayLabel =
    profile?.kind === "official"
      ? "Claude Code 路 Official"
      : `Claude Code 路 ${providerDisplayName(profile)}${model ? ` 路 ${model}` : ""}`;

  return {
    id: crypto.randomUUID(),
    profileId: profile?.id ?? "claude-official",
    enabled: false,
    displayLabel,
    model,
    providerName: providerDisplayName(profile),
    providerKind: profile?.kind ?? "official",
    secretStored: Boolean(profile?.secretStored),
    isBuiltIn: Boolean(profile?.isBuiltIn)
  };
}

function syncClaudeVariantsWithProfiles() {
  const previousByProfileId = new Map(
    state.launcherClaudeVariants.map((variant) => [variant.profileId, variant])
  );

  state.launcherClaudeVariants = state.availableProviderProfiles.map((profile) => {
    const existing = previousByProfileId.get(profile.id);
    const base = existing ?? defaultClaudeVariant(profile);
    const fallbackLabel =
      profile.kind === "official"
        ? "Claude Code 路 Official"
        : `Claude Code 路 ${providerDisplayName(profile)}${base.model?.trim() || profile.primaryModel || "default"}`;

    return {
      ...base,
      profileId: profile.id,
      providerName: profile.name,
      providerKind: profile.kind,
      secretStored: Boolean(profile.secretStored),
      isBuiltIn: Boolean(profile.isBuiltIn),
      displayLabel: base.displayLabel?.trim() || fallbackLabel,
      model: base.model ?? profile.primaryModel ?? ""
    };
  });
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
    return localText(
      "杩欎笉鏄唬鐮佸鏌ワ紝涔熶笉鏄?bugfix benchmark銆傚畠鍙鏌?agent 鏄惁鍋氫簡涓€涓皬鏀瑰姩锛屽悓鏃舵病鏈夌牬鍧忎粨搴撶殑鍩虹缁撴瀯銆?,
      "This is not a code review or bug-fix benchmark. It only checks whether the agent made one small improvement without breaking baseline repository structure."
    );
  }

  return localText(
    "鍏堢湅浠诲姟鐩爣鍜?judge 渚濇嵁锛屽啀瑙ｈ compare 缁撴灉銆?,
    "Read the task objective and judge rationale before interpreting the compare results."
  );
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
      localText("涓嶆槸浠ｇ爜瀹℃煡", "Not a code review"),
      localText("涓嶆槸 bugfix benchmark", "Not a bugfix benchmark")
    ];
  }

  return [localText("鎸変换鍔＄洰鏍囪В閲婄粨鏋?, "Interpret results through the task goal")];
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
    return localText("娌℃湁 judge", "No judges");
  }

  const labels = judges.map((judge) => judge.label || judge.id).filter(Boolean);
  const summary = labels.slice(0, 3).join(", ");
  if (labels.length <= 3) {
    return summary;
  }

  return `${summary}${state.language === "zh-CN" ? ` 绛夊叡 ${labels.length} 椤筦 : ` +${labels.length - 3} more`}`;
}

function summarizeLauncherSelection(selectedTaskPack) {
  const enabledCodex = state.launcherCodexVariants.filter((variant) => variant.enabled);
  const enabledClaude = state.launcherClaudeVariants.filter((variant) => variant.enabled);
  const otherAgents = selectedLauncherAgents();
  const variantCount = enabledCodex.length + enabledClaude.length + otherAgents.length;
  const taskTitle = selectedTaskPack?.title || localText("鑷畾涔変换鍔″寘", "Custom task pack");
  const variantNames = [
    ...otherAgents.map((agentId) => state.availableAdapters.find((adapter) => adapter.id === agentId)?.title ?? agentId),
    ...enabledClaude.map((variant) => variant.displayLabel || "Claude Code"),
    ...enabledCodex.map((variant) => variant.displayLabel || "Codex CLI")
  ];
  const selectionPreview = variantNames.slice(0, 3).join(", ");
  const extraCount = Math.max(variantNames.length - 3, 0);
  const preview =
    variantNames.length === 0
      ? localText("杩樻病鏈夐€夋嫨 variant", "No variants selected")
      : `${selectionPreview}${extraCount > 0 ? ` +${extraCount}` : ""}`;

  return localText(
    `浠诲姟锛?{taskTitle} | 宸查€?${variantCount} 涓?variant | ${preview}`,
    `Task: ${taskTitle} | ${variantCount} variant(s) selected | ${preview}`
  );
}

function compareHighlights(run, result) {
  const verdict = getRunVerdict(run);
  const highlights = [];
  const key = recordKey(result);

  if (recordKey(verdict.bestAgent ?? {}) === key) {
    highlights.push("Best");
  }
  if (recordKey(verdict.fastest ?? {}) === key) {
    highlights.push("Fastest");
  }
  if (recordKey(verdict.lowestKnownCost ?? {}) === key) {
    highlights.push(localText("鏈€浣庢垚鏈?, "Lowest Cost"));
  }
  if (recordKey(verdict.highestJudgePassRate ?? {}) === key) {
    highlights.push(localText("Judge 鏈€浣?, "Top Judges"));
  }

  return highlights;
}

function runFocusLine(run) {
  const verdict = getRunVerdict(run);
  const best = verdict.bestAgent ? resultLabel(verdict.bestAgent) : "n/a";
  const fastest = verdict.fastest ? resultLabel(verdict.fastest) : "n/a";

  if (run.task.id === "official-repo-health" || run.task.id === "repo-health") {
    return state.language === "zh-CN"
      ? `杩欐槸涓€娆?baseline sanity check锛屼笉鏄唬鐮佸鏌ャ€傚綋鍓嶇患鍚堟渶浣虫槸 ${best}锛屾渶蹇槸 ${fastest}銆俙
      : `This is a baseline sanity check, not a code review. Current best is ${best} and fastest is ${fastest}.`;
  }

  return state.language === "zh-CN"
    ? `鍏堟寜浠诲姟鐩爣瑙ｈ缁撴灉銆傚綋鍓嶇患鍚堟渶浣虫槸 ${best}锛屾渶蹇槸 ${fastest}銆俙
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
    displayLabel: labelParts.join(" 路 "),
    model,
    reasoningEffort: reasoning,
    source: defaults.source ?? "unknown",
    verification: defaults.verification ?? "unknown"
  };
}

function renderStaticText() {
  if (elements.resultLoaderSummary) {
    elements.resultLoaderSummary.textContent =
      state.language === "zh-CN" ? "鎵撳紑宸叉湁缁撴灉锛堝鐢ㄥ叆鍙ｏ級" : "Open Existing Results (Fallback)";
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

function renderLauncherProgress() {
  const isVisible = state.runInProgress || (state.runStatus?.logs?.length ?? 0) > 0;
  setHidden(elements.launcherProgress, !isVisible);

  if (!isVisible) {
    return;
  }

  elements.launcherProgressTitle.textContent = t("launcherProgressTitle");
  const currentAgent = state.runStatus?.currentDisplayLabel || state.runStatus?.currentVariantId || state.runStatus?.currentAgentId;
  elements.launcherCurrentAgent.textContent = currentAgent
    ? t("launcherCurrentAgentLabel", currentAgent)
    : t("launcherCurrentAgentIdle");

  const logs = Array.isArray(state.runStatus?.logs) ? state.runStatus.logs : [];
  if (logs.length === 0) {
    elements.launcherLogList.innerHTML = `<div class="muted">${escapeHtml(t("launcherLogEmpty"))}</div>`;
    return;
  }

  elements.launcherLogList.innerHTML = logs
    .slice()
    .reverse()
    .map((entry) => {
      const phase = t(`launcherPhases.${entry.phase ?? "starting"}`);
      const actor = entry.displayLabel ? `${escapeHtml(entry.displayLabel)} 路 ` : "";
      return `
        <article class="launcher-log-entry">
          <div class="launcher-log-head">
            <span class="status-badge status-${escapeHtml(entry.phase ?? "starting")}">${escapeHtml(phase)}</span>
            <span class="muted">${escapeHtml(new Date(entry.timestamp).toLocaleTimeString())}</span>
          </div>
          <p>${actor}${escapeHtml(entry.message)}</p>
        </article>
      `;
    })
    .join("");
}

function createProviderEditorState(profile = null) {
  return {
    id: profile?.id ?? "",
    name: profile?.name ?? "",
    kind: profile?.kind ?? "anthropic-compatible",
    homepage: profile?.homepage ?? "",
    baseUrl: profile?.baseUrl ?? "",
    apiFormat: profile?.apiFormat ?? "anthropic-messages",
    primaryModel: profile?.primaryModel ?? "",
    thinkingModel: profile?.thinkingModel ?? "",
    defaultHaikuModel: profile?.defaultHaikuModel ?? "",
    defaultSonnetModel: profile?.defaultSonnetModel ?? "",
    defaultOpusModel: profile?.defaultOpusModel ?? "",
    notes: profile?.notes ?? "",
    extraEnv: profile?.extraEnv ? JSON.stringify(profile.extraEnv, null, 2) : "{}",
    writeCommonConfig: profile?.writeCommonConfig ?? true,
    secret: ""
  };
}

function openProviderEditor(profileId = null) {
  const profile = profileId
    ? state.availableProviderProfiles.find((entry) => entry.id === profileId) ?? null
    : null;
  state.launcherProviderEditor = createProviderEditorState(profile);
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
  syncClaudeVariantsWithProfiles();

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
  const realAdapters = state.availableAdapters.filter(
    (adapter) => adapter.kind !== "demo" && adapter.id !== "codex" && adapter.id !== "claude-code"
  );
  const debugAdapters = state.availableAdapters.filter((adapter) => adapter.kind === "demo");
  const codexDefaults = state.serviceInfo.codexDefaults ?? {};
  const codexDefaultsText = localText(
    `褰撳墠榛樿锛氭ā鍨?${codexDefaults.effectiveModel ?? "unknown"} | 鎺ㄧ悊 ${codexDefaults.effectiveReasoningEffort ?? "default"} | ${codexDefaults.verification ?? "unknown"} / ${codexDefaults.source ?? "unknown"}`,
    `Current default: model ${codexDefaults.effectiveModel ?? "unknown"} | reasoning ${codexDefaults.effectiveReasoningEffort ?? "default"} | ${codexDefaults.verification ?? "unknown"} / ${codexDefaults.source ?? "unknown"}`
  );

  const taskSummary = selectedTaskPack
    ? `
      <div class="launcher-section">
        <h4>${escapeHtml(localText("浠诲姟璇存槑", "Task Intent"))}</h4>
        <p class="muted">${escapeHtml(selectedTaskPack.description ?? selectedTaskPack.objective ?? "")}</p>
        <p class="muted"><strong>${escapeHtml(localText("鐩爣", "Objective"))}:</strong> ${escapeHtml(
            selectedTaskPack.objective ?? "n/a"
          )}</p>
        <p class="muted"><strong>${escapeHtml(localText("Judge 渚濇嵁", "Judge Rationale"))}:</strong> ${escapeHtml(
            selectedTaskPack.judgeRationale ?? "n/a"
          )}</p>
        <p class="muted"><strong>${escapeHtml(localText("閫傜敤浠撳簱", "Repo Types"))}:</strong> ${escapeHtml(
            (selectedTaskPack.repoTypes ?? []).join(", ") || "generic"
          )}</p>
        <p class="muted"><strong>${escapeHtml(localText("Prompt 鎽樿", "Prompt Summary"))}:</strong> ${escapeHtml(
            summarizeTaskPrompt(selectedTaskPack.prompt)
          )}</p>
        <p class="muted"><strong>${escapeHtml(localText("Judge 妫€鏌ラ」", "Judge Checks"))}:</strong> ${escapeHtml(
            summarizeJudges(selectedTaskPack)
          )}</p>
        <p class="warning-text">${escapeHtml(
          selectedTaskPack.id === "official-repo-health"
            ? baselineTaskWarning({ id: selectedTaskPack.id })
            : localText("鎸変换鍔＄洰鏍囪В璇昏繖娆?benchmark銆?, "Interpret this benchmark in the context of the task objective.")
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
            <span>${escapeHtml(localText("鍚敤杩欎釜 Codex variant", "Enable this Codex variant"))}</span>
          </label>
          <div class="launcher-grid">
            <label class="field">
              <span>${escapeHtml(localText("鏄剧ず鍚?, "Display Label"))}</span>
              <input data-role="variant-label" type="text" value="${escapeHtml(variant.displayLabel)}" />
            </label>
            <label class="field">
              <span>${escapeHtml(localText("妯″瀷", "Model"))}</span>
              <input data-role="variant-model" type="text" value="${escapeHtml(variant.model)}" placeholder="gpt-5.4" />
            </label>
            <label class="field">
              <span>${escapeHtml(localText("鎺ㄧ悊绛夌骇", "Reasoning Effort"))}</span>
              <input data-role="variant-reasoning" list="reasoning-levels" type="text" value="${escapeHtml(
                variant.reasoningEffort
              )}" placeholder="low / medium / high" />
            </label>
          </div>
          <p class="muted">${escapeHtml(localText("榛樿鏉ユ簮", "Default source"))}: ${escapeHtml(
            variant.source
          )} | ${escapeHtml(localText("鍙俊搴?, "Verification"))}: ${escapeHtml(
            variant.verification
          )}</p>
          <button type="button" class="variant-remove" data-role="variant-remove">${escapeHtml(
            localText("鍒犻櫎杩欎釜 variant", "Remove variant")
          )}</button>
        </div>
      `
    )
    .join("");

  const claudeVariants = state.launcherClaudeVariants
    .map((variant) => {
      const profile = state.availableProviderProfiles.find((entry) => entry.id === variant.profileId);
      const riskBadges = [];
      if (profile?.kind !== "official") {
        riskBadges.push(localText("Third-party Provider", "Third-party Provider"));
        riskBadges.push(localText("Compatibility Mode", "Compatibility Mode"));
        riskBadges.push(localText("User-managed Secret", "User-managed Secret"));
      }

      return `
        <div class="variant-card" data-claude-variant-id="${escapeHtml(variant.id)}">
          <label class="checkbox">
            <input type="checkbox" data-role="claude-variant-enabled" ${variant.enabled ? "checked" : ""} />
            <span>${escapeHtml(localText("鍚敤杩欎釜 Claude Code variant", "Enable this Claude Code variant"))}</span>
          </label>
          <div class="launcher-grid">
            <label class="field">
              <span>${escapeHtml(localText("鏄剧ず鍚?, "Display Label"))}</span>
              <input data-role="claude-variant-label" type="text" value="${escapeHtml(variant.displayLabel)}" />
            </label>
            <label class="field">
              <span>${escapeHtml(localText("妯″瀷", "Model"))}</span>
              <input data-role="claude-variant-model" type="text" value="${escapeHtml(variant.model ?? "")}" placeholder="${escapeHtml(profile?.primaryModel ?? "model")}" />
            </label>
          </div>
          <p class="muted">${escapeHtml(localText("Provider", "Provider"))}: ${escapeHtml(profile?.name ?? variant.providerName ?? "Official")} | ${escapeHtml(localText("绫诲瀷", "Kind"))}: ${escapeHtml(profile?.kind ?? variant.providerKind ?? "official")}</p>
          <p class="muted">${escapeHtml(localText("瀵嗛挜鐘舵€?, "Secret"))}: ${escapeHtml(
            profile?.kind === "official"
              ? localText("瀹樻柟鐧诲綍鎬?, "Official login")
              : profile?.secretStored
                ? localText("宸蹭繚瀛樺埌 Windows Credential Manager", "Stored in Windows Credential Manager")
                : localText("鏈繚瀛橈紝杩愯浼氳闃绘", "Missing; runs will be blocked")
          )}</p>
          ${
            riskBadges.length > 0
              ? `<div class="badge-row">${riskBadges.map((badge) => `<span class="meaning-badge risk-badge">${escapeHtml(badge)}</span>`).join("")}</div>`
              : ""
          }
          <div class="inline-actions">
            ${
              profile?.isBuiltIn
                ? `<span class="muted">${escapeHtml(localText("瀹樻柟鍐呯疆 Provider", "Built-in official provider"))}</span>`
                : `<button type="button" data-role="provider-edit" data-profile-id="${escapeHtml(profile?.id ?? "claude-official")}">${escapeHtml(localText("缂栬緫 Provider", "Edit Provider"))}</button>
                   <button type="button" data-role="provider-delete" data-profile-id="${escapeHtml(profile?.id ?? "")}">${escapeHtml(localText("鍒犻櫎 Provider", "Delete Provider"))}</button>`
            }
          </div>
        </div>
      `;
    })
    .join("");

  const providerEditor = state.launcherProviderEditor
    ? `
      <div class="provider-editor" data-provider-editor="true">
        <div class="panel-header">
          <h4>${escapeHtml(state.launcherProviderEditor.id ? localText("缂栬緫 Claude Provider", "Edit Claude Provider") : localText("鏂板 Claude Provider", "Add Claude Provider"))}</h4>
        </div>
        <p class="warning-text">${escapeHtml(
          localText(
            "绗笁鏂瑰吋瀹瑰眰鍙兘鏀瑰彉 Claude Code 琛屼负銆傜粨鏋滀唬琛ㄢ€淐laude Code + 璇?provider/profile鈥濈殑琛ㄧ幇锛屼笉鏄?Claude 瀹樻柟鑳藉姏锛屼篃涓嶆槸 RepoArena 鍘熺敓 API agent銆?,
            "Third-party compatibility layers can change Claude Code behavior. Results represent 鈥淐laude Code + this provider/profile鈥? not native RepoArena API agents."
          )
        )}</p>
        <div class="launcher-grid">
          <label class="field">
            <span>${escapeHtml(localText("Provider 鍚嶇О", "Provider Name"))}</span>
            <input data-role="provider-name" type="text" value="${escapeHtml(state.launcherProviderEditor.name)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("绫诲瀷", "Kind"))}</span>
            <select data-role="provider-kind">
              <option value="anthropic-compatible" ${state.launcherProviderEditor.kind === "anthropic-compatible" ? "selected" : ""}>Anthropic Compatible</option>
              <option value="openai-proxy" ${state.launcherProviderEditor.kind === "openai-proxy" ? "selected" : ""}>OpenAI Proxy</option>
            </select>
          </label>
          <label class="field">
            <span>${escapeHtml(localText("瀹樼綉閾炬帴", "Homepage"))}</span>
            <input data-role="provider-homepage" type="text" value="${escapeHtml(state.launcherProviderEditor.homepage)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("Base URL", "Base URL"))}</span>
            <input data-role="provider-base-url" type="text" value="${escapeHtml(state.launcherProviderEditor.baseUrl)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("API 鏍煎紡", "API Format"))}</span>
            <select data-role="provider-api-format">
              <option value="anthropic-messages" ${state.launcherProviderEditor.apiFormat === "anthropic-messages" ? "selected" : ""}>Anthropic Messages</option>
              <option value="openai-chat-via-proxy" ${state.launcherProviderEditor.apiFormat === "openai-chat-via-proxy" ? "selected" : ""}>OpenAI Chat via Proxy</option>
            </select>
          </label>
          <label class="field">
            <span>${escapeHtml(localText("涓绘ā鍨?, "Primary Model"))}</span>
            <input data-role="provider-primary-model" type="text" value="${escapeHtml(state.launcherProviderEditor.primaryModel)}" placeholder="gpt-5.4" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("Thinking 妯″瀷", "Thinking Model"))}</span>
            <input data-role="provider-thinking-model" type="text" value="${escapeHtml(state.launcherProviderEditor.thinkingModel)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("Haiku 榛樿妯″瀷", "Default Haiku Model"))}</span>
            <input data-role="provider-haiku-model" type="text" value="${escapeHtml(state.launcherProviderEditor.defaultHaikuModel)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("Sonnet 榛樿妯″瀷", "Default Sonnet Model"))}</span>
            <input data-role="provider-sonnet-model" type="text" value="${escapeHtml(state.launcherProviderEditor.defaultSonnetModel)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("Opus 榛樿妯″瀷", "Default Opus Model"))}</span>
            <input data-role="provider-opus-model" type="text" value="${escapeHtml(state.launcherProviderEditor.defaultOpusModel)}" />
          </label>
          <label class="field field-wide">
            <span>${escapeHtml(localText("澶囨敞", "Notes"))}</span>
            <input data-role="provider-notes" type="text" value="${escapeHtml(state.launcherProviderEditor.notes)}" />
          </label>
          <label class="field field-wide">
            <span>${escapeHtml(localText("棰濆鐜鍙橀噺 JSON", "Extra Env JSON"))}</span>
            <textarea data-role="provider-extra-env" rows="6">${escapeHtml(state.launcherProviderEditor.extraEnv)}</textarea>
          </label>
          <label class="field field-wide">
            <span>${escapeHtml(localText("API Key / Token", "API Key / Token"))}</span>
            <input data-role="provider-secret" type="password" value="" placeholder="${escapeHtml(localText("鐣欑┖鍒欎笉淇敼褰撳墠宸蹭繚瀛?secret", "Leave blank to keep the currently stored secret"))}" />
          </label>
        </div>
        <label class="checkbox">
          <input data-role="provider-write-common-config" type="checkbox" ${state.launcherProviderEditor.writeCommonConfig ? "checked" : ""} />
          <span>${escapeHtml(localText("鍐欏叆閫氱敤 Claude Code 閰嶇疆", "Write common Claude Code config"))}</span>
        </label>
        <div class="inline-actions">
          <button type="button" data-role="provider-save">${escapeHtml(localText("淇濆瓨 Provider", "Save Provider"))}</button>
          <button type="button" data-role="provider-cancel">${escapeHtml(localText("鍙栨秷", "Cancel"))}</button>
        </div>
      </div>
    `
    : "";

  elements.launcherAgents.innerHTML = `
    ${taskSummary}
    <div class="launcher-section">
      <h4>${escapeHtml(localText("鐪熷疄 Agents", "Real Agents"))}</h4>
      <p class="muted">${escapeHtml(localText("杩欎簺鏄洿鎺ュ弬涓庝富瀵规瘮鐨勭湡瀹炲閮?agent銆?, "These are real external agents. Their results count toward the main comparison."))}</p>
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
        <h4>${escapeHtml(localText("Claude Code Provider Profiles", "Claude Code Provider Profiles"))}</h4>
        <button id="launcher-add-provider" type="button">${escapeHtml(localText("鏂板 Claude Provider", "Add Claude Provider"))}</button>
      </div>
      <p class="muted">${escapeHtml(localText(
        "杩欓噷姣旇緝鐨勬槸鍚屼竴涓?Claude Code harness 涓嬶紝涓嶅悓 provider/profile 鐨勫彉浣撱€?,
        "These are provider-switched Claude Code variants under the same Claude Code harness."
      ))}</p>
      <p class="warning-text">${escapeHtml(state.serviceInfo.riskNotice ?? "")}</p>
      ${claudeVariants || `<p class="empty-state">${escapeHtml(localText("杩樻病鏈夊彲鐢ㄧ殑 Claude Provider銆?, "No Claude provider profiles available yet."))}</p>`}
      ${providerEditor}
    </div>
    <div class="launcher-section">
      <div class="panel-header">
        <h4>${escapeHtml(localText("Codex Variants", "Codex Variants"))}</h4>
        <button id="launcher-add-codex-variant" type="button">${escapeHtml(
          localText("鏂板 Codex variant", "Add Codex variant")
        )}</button>
      </div>
      <p class="muted">${escapeHtml(localText(
        "鐢ㄥ涓?Codex variant 姣旇緝鍏蜂綋妯″瀷鍜屾帹鐞嗙瓑绾с€侰LI 娌℃湁鏄庣‘杩斿洖鏃讹紝RepoArena 浼氭妸韬唤鏍囨垚 inferred銆?,
        "Use multiple Codex variants to compare concrete model and reasoning configurations. When the CLI does not confirm them, RepoArena marks the identity as inferred."
      ))}</p>
      <p class="muted">${escapeHtml(codexDefaultsText)}</p>
      <datalist id="reasoning-levels">
        <option value="low"></option>
        <option value="medium"></option>
        <option value="high"></option>
      </datalist>
      ${codexVariants}
    </div>
    <details class="launcher-section">
      <summary>${escapeHtml(localText("Debug Agents锛堥粯璁や笉閫夛級", "Debug Agents (not selected by default)"))}</summary>
      <p class="muted">${escapeHtml(localText(
        "Demo Fast / Thorough / Budget 鍙槸鍐呯疆鐨?synthetic adapter锛岀敤鏉ラ獙璇佹祦姘寸嚎鍜?UI锛屼笉浠ｈ〃鐪熷疄妯″瀷鑳藉姏銆?,
        "Demo Fast / Thorough / Budget are built-in synthetic adapters for validating the pipeline and UI. They do not represent real model capability."
      ))}</p>
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
    ? localText("鏀惰捣璁剧疆", "Hide Setup")
    : localText("灞曞紑璁剧疆", "Show Setup");
  setHidden(elements.launcherBody, !state.launcherExpanded);
  elements.launcherStatus.textContent = state.runInProgress
    ? currentRunPhaseLabel() || t("launcherStatusRunning")
    : state.notice ?? t("launcherStatusIdle");
  renderLauncherProgress();
}

async function detectService() {
  try {
    const [infoResponse, adaptersResponse, taskPacksResponse, runStatusResponse, providerProfilesResponse] = await Promise.all([
      fetch("/api/ui-info"),
      fetch("/api/adapters"),
      fetch("/api/taskpacks"),
      fetch("/api/run-status", { cache: "no-store" }),
      fetch("/api/provider-profiles")
    ]);
    if (!infoResponse.ok || !adaptersResponse.ok || !taskPacksResponse.ok || !runStatusResponse.ok || !providerProfilesResponse.ok) {
      return;
    }

    state.serviceInfo = await infoResponse.json();
    state.availableAdapters = await adaptersResponse.json();
    state.availableTaskPacks = await taskPacksResponse.json();
    state.runStatus = await runStatusResponse.json();
    state.availableProviderProfiles = await providerProfilesResponse.json();
    syncClaudeVariantsWithProfiles();
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
    state.availableProviderProfiles = [];
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
    if (state.runStatus?.state === "done") {
      stopRunStatusPolling();
      const result = state.runStatus.result;
      state.runStatus = null;
      state.runInProgress = false;
      if (result && result.run) {
        state.notice = t("launcherStatusDone", result.run.task.title);
        state.launcherExpanded = false;
        applySingleRun(result.run, result.markdown);
      }
      render();
      return;
    }
    if (state.runStatus?.state === "error") {
      stopRunStatusPolling();
      const errorMessage = state.runStatus.error || "Unknown error";
      state.runStatus = null;
      state.runInProgress = false;
      state.notice = t("launcherStatusError", errorMessage);
      render();
      return;
    }
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

  const claudeVariants = state.launcherClaudeVariants
    .filter((variant) => variant.enabled)
    .map((variant) => ({
      baseAgentId: "claude-code",
      displayLabel: variant.displayLabel.trim() || `Claude Code 路 ${variant.providerName ?? "Official"}`,
      config: {
        model: variant.model.trim() || undefined,
        providerProfileId: variant.profileId
      },
      configSource: "ui"
    }));

  const otherAgents = selectedLauncherAgents().map((agentId) => ({
    baseAgentId: agentId,
    displayLabel: state.availableAdapters.find((adapter) => adapter.id === agentId)?.title ?? agentId,
    config: {},
    configSource: "ui"
  }));

  return [...otherAgents, ...claudeVariants, ...codexVariants];
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
  state.launcherClaudeVariants = Array.from(
    elements.launcherAgents.querySelectorAll("[data-claude-variant-id]")
  ).map((element) => {
    const profileId = element.getAttribute("data-profile-id") || "claude-official";
    const profile = state.availableProviderProfiles.find((entry) => entry.id === profileId);
    return {
      id: element.getAttribute("data-claude-variant-id"),
      profileId,
      enabled: element.querySelector('[data-role="claude-variant-enabled"]')?.checked ?? false,
      displayLabel:
        element.querySelector('[data-role="claude-variant-label"]')?.value ??
        `Claude Code 路 ${profile?.name ?? "Official"}`,
      model: element.querySelector('[data-role="claude-variant-model"]')?.value ?? "",
      providerName: profile?.name ?? "Official",
      providerKind: profile?.kind ?? "official",
      secretStored: Boolean(profile?.secretStored),
      isBuiltIn: Boolean(profile?.isBuiltIn)
    };
  });
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
        ? "浠撳簱璺緞銆佷换鍔″寘璺緞鍜岃嚦灏戜竴涓?agent 鏄繀濉」銆?
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
    if (!response.ok && response.status !== 202) {
      throw new Error(result.error || "Unknown error");
    }
  } catch (error) {
    stopRunStatusPolling();
    state.runStatus = null;
    state.runInProgress = false;
    state.notice = t("launcherStatusError", error instanceof Error ? error.message : String(error));
    render();
  }
}

async function refreshProviderProfiles() {
  const response = await fetch("/api/provider-profiles", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load provider profiles.");
  }

  state.availableProviderProfiles = await response.json();
  syncClaudeVariantsWithProfiles();
}

async function saveProviderProfileFromEditor() {
  const editor = elements.launcherAgents.querySelector("[data-provider-editor='true']");
  if (!editor) {
    return;
  }

  const readValue = (selector) => editor.querySelector(selector)?.value?.trim() ?? "";
  const readChecked = (selector) => editor.querySelector(selector)?.checked ?? false;
  let extraEnv = {};
  const extraEnvRaw = editor.querySelector('[data-role="provider-extra-env"]')?.value?.trim() ?? "{}";
  try {
    extraEnv = extraEnvRaw ? JSON.parse(extraEnvRaw) : {};
  } catch {
    throw new Error(localText("棰濆鐜鍙橀噺 JSON 鏃犳硶瑙ｆ瀽銆?, "Extra env JSON is invalid."));
  }

  const payload = {
    name: readValue('[data-role="provider-name"]'),
    kind: readValue('[data-role="provider-kind"]'),
    homepage: readValue('[data-role="provider-homepage"]') || undefined,
    baseUrl: readValue('[data-role="provider-base-url"]') || undefined,
    apiFormat: readValue('[data-role="provider-api-format"]'),
    primaryModel: readValue('[data-role="provider-primary-model"]') || undefined,
    thinkingModel: readValue('[data-role="provider-thinking-model"]') || undefined,
    defaultHaikuModel: readValue('[data-role="provider-haiku-model"]') || undefined,
    defaultSonnetModel: readValue('[data-role="provider-sonnet-model"]') || undefined,
    defaultOpusModel: readValue('[data-role="provider-opus-model"]') || undefined,
    notes: readValue('[data-role="provider-notes"]') || undefined,
    extraEnv,
    writeCommonConfig: readChecked('[data-role="provider-write-common-config"]')
  };
  const secret = editor.querySelector('[data-role="provider-secret"]')?.value ?? "";

  if (!payload.name) {
    throw new Error(localText("Provider 鍚嶇О涓嶈兘涓虹┖銆?, "Provider name is required."));
  }

  const isEdit = Boolean(state.launcherProviderEditor?.id);
  const url = isEdit
    ? `/api/provider-profiles/${encodeURIComponent(state.launcherProviderEditor.id)}`
    : "/api/provider-profiles";
  const method = isEdit ? "PUT" : "POST";
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(isEdit ? payload : { ...payload, secret: secret || undefined })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Failed to save provider profile.");
  }

  if (isEdit && secret.trim()) {
    const secretResponse = await fetch(`/api/provider-profiles/${encodeURIComponent(state.launcherProviderEditor.id)}/secret`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ secret })
    });
    const secretResult = await secretResponse.json();
    if (!secretResponse.ok) {
      throw new Error(secretResult.error || "Failed to store provider secret.");
    }
    state.availableProviderProfiles = secretResult.profiles ?? state.availableProviderProfiles;
  } else {
    state.availableProviderProfiles = result.profiles ?? state.availableProviderProfiles;
  }

  syncClaudeVariantsWithProfiles();
  state.launcherProviderEditor = null;
}

async function deleteProviderProfileById(profileId) {
  const response = await fetch(`/api/provider-profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE"
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Failed to delete provider profile.");
  }

  state.availableProviderProfiles = result.profiles ?? [];
  syncClaudeVariantsWithProfiles();
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
      return state.language === "zh-CN" ? "鏂囦欢瀛樺湪" : "File Exists";
    case "file-contains":
      return state.language === "zh-CN" ? "鏂囦欢鍖呭惈鍐呭" : "File Contains";
    case "json-value":
      return state.language === "zh-CN" ? "JSON 鍊兼柇瑷€" : "JSON Value";
    case "glob":
      return state.language === "zh-CN" ? "Glob 鍖归厤" : "Glob";
    case "file-count":
      return state.language === "zh-CN" ? "鏂囦欢鏁伴噺" : "File Count";
    case "snapshot":
      return state.language === "zh-CN" ? "蹇収" : "Snapshot";
    case "json-schema":
      return state.language === "zh-CN" ? "JSON Schema" : "JSON Schema";
    default:
      return state.language === "zh-CN" ? "鍛戒护" : "Command";
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

  if (!state.run.results.some((result) => recordKey(result) === state.selectedAgentId)) {
    state.selectedAgentId = recordKey(state.run.results[0] ?? {}) ?? null;
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
    <p class="muted"><strong>${escapeHtml(localText("鐩爣", "Objective"))}:</strong> ${escapeHtml(intent.objective || "n/a")}</p>
    <p class="muted"><strong>${escapeHtml(localText("Judge 渚濇嵁", "Judge Rationale"))}:</strong> ${escapeHtml(intent.rationale || "n/a")}</p>
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
      <h3>${escapeHtml(localText("杩欐 benchmark 鍦ㄦ祴浠€涔?, "What this run actually measures"))}</h3>
      <span class="muted">${escapeHtml(resultCount)} ${escapeHtml(localText("涓?variant", "variants"))}</span>
    </div>
    <div class="badge-row">
      ${badges.map((badge) => `<span class="meaning-badge">${escapeHtml(badge)}</span>`).join("")}
    </div>
    <article class="brief-card brief-focus-card">
      <p class="metric-label">${escapeHtml(localText("濡備綍瑙ｈ杩欐缁撴灉", "How to read this result"))}</p>
      <p>${escapeHtml(runFocusLine(run))}</p>
    </article>
    <div class="brief-grid">
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(localText("鐩爣", "Objective"))}</p>
        <p>${escapeHtml(intent.objective || run.task.description || "n/a")}</p>
      </article>
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(localText("Judge 渚濇嵁", "Judge Rationale"))}</p>
        <p>${escapeHtml(intent.rationale || "n/a")}</p>
      </article>
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(localText("閫傜敤浠撳簱", "Repo Types"))}</p>
        <p>${escapeHtml(repoTypes)}</p>
      </article>
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(localText("鍙備笌瀵规瘮鐨?Variants", "Compared Variants"))}</p>
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
          <th>${escapeHtml(state.language === "zh-CN" ? "浠诲姟" : "Task")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "鍒涘缓鏃堕棿" : "Created")}</th>
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
                <td>${state.markdownByRunId.has(run.runId) ? escapeHtml(t("linkedMarkdown")) : escapeHtml(state.language === "zh-CN" ? "鏃? : "none")}</td>
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
          <p class="muted">${escapeHtml(localText("鍩虹 Agent", "Base Agent"))}: ${escapeHtml(baseAgentLabel(preflight))}</p>
          <p class="muted">${escapeHtml(localText("Provider", "Provider"))}: ${escapeHtml(runtimeIdentity(preflight).provider)} | ${escapeHtml(localText("绫诲瀷", "Kind"))}: ${escapeHtml(runtimeIdentity(preflight).providerKind)}</p>
          <p class="muted">${escapeHtml(localText("妯″瀷 / 鎺ㄧ悊", "Model / Reasoning"))}: ${escapeHtml(runtimeIdentity(preflight).model)} / ${escapeHtml(runtimeIdentity(preflight).reasoning)}</p>
          <p class="muted">${escapeHtml(localText("鍙俊搴?, "Verification"))}: ${escapeHtml(runtimeVerificationLabel(preflight))}</p>
          <p class="muted">${escapeHtml(state.language === "zh-CN" ? "鏀寔灞傜骇" : "Tier")}: ${escapeHtml(preflight.capability.supportTier)} | ${escapeHtml(state.language === "zh-CN" ? "Trace" : "Trace")}: ${escapeHtml(
            preflight.capability.traceRichness
          )}</p>
          <p class="muted">${escapeHtml(state.language === "zh-CN" ? "璋冪敤鏂瑰紡" : "Invocation")}: ${escapeHtml(preflight.capability.invocationMethod)}</p>
          <p class="muted">${escapeHtml(t("metrics.tokens"))}: ${escapeHtml(preflight.capability.tokenAvailability)} | ${escapeHtml(state.language === "zh-CN" ? "鎴愭湰" : "Cost")}: ${escapeHtml(
            preflight.capability.costAvailability
          )}</p>
          ${
            preflight.capability.authPrerequisites.length > 0
              ? `<p class="muted">${escapeHtml(state.language === "zh-CN" ? "閴存潈瑕佹眰" : "Auth")}: ${escapeHtml(preflight.capability.authPrerequisites.join("; "))}</p>`
              : ""
          }
          ${
            preflight.capability.knownLimitations.length > 0
              ? `<p class="muted">${escapeHtml(state.language === "zh-CN" ? "闄愬埗" : "Limitations")}: ${escapeHtml(preflight.capability.knownLimitations.join("; "))}</p>`
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
      const active = recordKey(result) === state.selectedAgentId ? "active" : "";
      const runtime = runtimeIdentity(result);
      return `
        <button class="agent-button ${active}" type="button" data-agent-id="${escapeHtml(recordKey(result))}">
          <div class="row">
            <strong>${escapeHtml(resultLabel(result))}</strong>
            <span class="status-badge ${statusClass(result.status)}">${escapeHtml(result.status)}</span>
          </div>
          <div class="meta">
            ${escapeHtml(runtime.provider)} | ${escapeHtml(runtime.model)} | ${escapeHtml(formatDuration(result.durationMs))} | ${escapeHtml(
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
      ? `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "娌℃湁鎵ц浠讳綍鍛戒护銆? : "No commands executed.")}</p>`
      : `<div class="step-list">${steps
          .map(
            (step) => `
              <details class="step-card">
                <summary>
                  <strong>${escapeHtml(step.label)}</strong>
                  <span class="status-badge ${statusClass(step.success ? "success" : "failed")}">${
                    step.success ? (state.language === "zh-CN" ? "閫氳繃" : "pass") : (state.language === "zh-CN" ? "澶辫触" : "fail")
                  }</span>
                  <span class="muted">${escapeHtml(formatDuration(step.durationMs))}</span>
                </summary>
                <div class="detail-row"><span>${escapeHtml(state.language === "zh-CN" ? "鍛戒护" : "Command")}</span><code>${escapeHtml(step.command)}</code></div>
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
      ? `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "娌℃湁鎵ц浠讳綍 judge銆? : "No judges executed.")}</p>`
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
                    judge.success ? (state.language === "zh-CN" ? "閫氳繃" : "pass") : (state.language === "zh-CN" ? "澶辫触" : "fail")
                  }</span>
                  <span class="muted">${escapeHtml(formatDuration(judge.durationMs))}</span>
                </summary>
                ${
                  judge.target
                    ? `<div class="detail-row"><span>${escapeHtml(state.language === "zh-CN" ? "鐩爣" : "Target")}</span><code>${escapeHtml(judge.target)}</code></div>`
                    : ""
                }
                ${
                  judge.expectation
                    ? `<div class="detail-row"><span>${escapeHtml(state.language === "zh-CN" ? "鏈熸湜" : "Expectation")}</span><code>${escapeHtml(judge.expectation)}</code></div>`
                    : ""
                }
                ${
                  judge.command
                    ? `<div class="detail-row"><span>${escapeHtml(state.language === "zh-CN" ? "鍛戒护" : "Command")}</span><code>${escapeHtml(judge.command)}</code></div>`
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
      ? `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "褰撳墠绛涢€変笅娌℃湁鍖归厤鐨?judge銆? : "No judges match the current filters.")}</p>`
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
    [state.language === "zh-CN" ? "鏂板" : "Added", result.diff.added],
    [state.language === "zh-CN" ? "淇敼" : "Changed", result.diff.changed],
    [state.language === "zh-CN" ? "鍒犻櫎" : "Removed", result.diff.removed]
  ];

  return `
    <section class="detail-card">
      <h3>${escapeHtml(state.language === "zh-CN" ? "Diff 缁嗗垎" : "Diff Breakdown")}</h3>
      <div class="diff-grid">
        ${sections
          .map(
            ([label, files]) => `
              <div class="diff-column">
                <h4>${escapeHtml(label)}</h4>
                ${
                  files.length === 0
                    ? `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "鏃? : "None")}</p>`
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
    elements.markdownStatus.textContent = state.language === "zh-CN" ? "鏈姞杞? : "Not loaded";
    elements.markdownContent.innerHTML = "";
    return;
  }

  setHidden(elements.markdownPanel, false);
  elements.markdownStatus.textContent = state.run && state.markdownByRunId.has(state.run.runId)
    ? (state.language === "zh-CN" ? "宸插叧鑱斿綋鍓?run" : "Linked to selected run")
    : (state.language === "zh-CN" ? "鐙珛 markdown" : "Standalone markdown");
  elements.markdownHighlights.innerHTML = state.run
    ? `
        <section class="detail-card">
          <h4>${escapeHtml(state.language === "zh-CN" ? "閲嶇偣鎽樿" : "Highlights")}</h4>
          <pre>${escapeHtml(buildShareCard(state.run))}</pre>
        </section>
      `
    : `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "鍏堝姞杞戒竴涓?run锛屾墠鑳界湅鍒版憳瑕佷寒鐐广€? : "Load a run to see summary highlights.")}</p>`;
  elements.markdownContent.innerHTML = renderMarkdownBlock(markdown);
}

function renderCompareTableV2(run) {
  const results = getCompareResults(run, compareFilters);
  const sortHintMap = {
    status: localText("鍏堟寜鐘舵€佸垎灞傦紝鍐嶆妸鏇村揩鐨勭粨鏋滄帓鍓嶉潰銆?, "Sorted by status first, then by fastest duration."),
    duration: localText("鎸夎€楁椂鎺掑簭锛岃秺蹇秺闈犲墠銆?, "Sorted by fastest variants first."),
    tokens: localText("鎸?token 鐢ㄩ噺鎺掑簭锛岃秺楂樿秺闈犲墠銆?, "Sorted by highest token usage first."),
    cost: localText("鎸夊凡鐭ユ垚鏈帓搴忥紝瓒婁綆瓒婇潬鍓嶃€?, "Sorted by lowest known cost first."),
    changed: localText("鎸夋敼鍔ㄦ枃浠舵暟鎺掑簭锛岃秺澶氳秺闈犲墠銆?, "Sorted by most changed files first."),
    judges: localText("鎸?judge 閫氳繃鐜囨帓搴忥紝瓒婇珮瓒婇潬鍓嶃€?, "Sorted by highest judge pass rate first.")
  };
  elements.compareSortHint.textContent = sortHintMap[compareFilters.sort] ?? sortHintMap.status;

  if (results.length === 0) {
    elements.compareTable.innerHTML = `<p class="empty-state">${escapeHtml(localText("娌℃湁 variant 绗﹀悎褰撳墠绛涢€夋潯浠躲€?, "No variants match the current compare filters."))}</p>`;
    return;
  }

  elements.compareTable.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>${escapeHtml("Variant")}</th>
          <th>${escapeHtml(localText("Provider", "Provider"))}</th>
          <th>${escapeHtml(localText("绫诲瀷", "Kind"))}</th>
          <th>${escapeHtml(localText("妯″瀷", "Model"))}</th>
          <th>${escapeHtml(localText("鎺ㄧ悊", "Reasoning"))}</th>
          <th>${escapeHtml(localText("鍙俊搴?, "Verification"))}</th>
          <th>${escapeHtml(localText("鐘舵€?, "Status"))}</th>
          <th>${escapeHtml(localText("鑰楁椂", "Duration"))}</th>
          <th>${escapeHtml(t("metrics.tokens"))}</th>
          <th>${escapeHtml(localText("鎴愭湰", "Cost"))}</th>
          <th>${escapeHtml(localText("鏀瑰姩鏂囦欢", "Changed"))}</th>
          <th>${escapeHtml("Judges")}</th>
        </tr>
      </thead>
      <tbody>
        ${results
          .map((result) => {
            const passedJudges = result.judgeResults.filter((judge) => judge.success).length;
            const isActive = recordKey(result) === state.selectedAgentId ? "active" : "";
            const runtime = runtimeIdentity(result);

            return `
              <tr class="${isActive}" data-compare-agent-id="${escapeHtml(recordKey(result))}">
                <td><strong>${escapeHtml(resultLabel(result))}</strong><br /><code>${escapeHtml(baseAgentLabel(result))}</code></td>
                <td>${escapeHtml(runtime.provider)}</td>
                <td>${escapeHtml(runtime.providerKind)}</td>
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

  const result = state.run.results.find((entry) => recordKey(entry) === state.selectedAgentId);
  if (!result) {
    return;
  }

  const runtime = runtimeIdentity(result);
  const judgeKinds =
    Array.from(new Set(result.judgeResults.map((judge) => formatJudgeType(judge.type)))).join(", ") ||
    localText("鏃?, "None");

  elements.resultSummary.innerHTML = `
    <h3>${escapeHtml(resultLabel(result))}</h3>
    <div class="summary-grid">
      <div class="summary-row"><span>${escapeHtml(localText("鍩虹 Agent", "Base Agent"))}</span><strong>${escapeHtml(baseAgentLabel(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("Provider", "Provider"))}</span><strong>${escapeHtml(runtime.provider)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("绫诲瀷", "Kind"))}</span><strong>${escapeHtml(runtime.providerKind)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("妯″瀷", "Model"))}</span><strong>${escapeHtml(runtime.model)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("鎺ㄧ悊", "Reasoning"))}</span><strong>${escapeHtml(runtime.reasoning)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("鍙俊搴?, "Verification"))}</span><strong>${escapeHtml(runtimeVerificationLabel(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("鐘舵€?, "Status"))}</span><strong>${escapeHtml(result.status)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("鑰楁椂", "Duration"))}</span><strong>${escapeHtml(formatDuration(result.durationMs))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(t("metrics.tokens"))}</span><strong>${result.tokenUsage}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("鎴愭湰", "Cost"))}</span><strong>${escapeHtml(formatCost(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("鏀瑰姩鏂囦欢", "Changed Files"))}</span><strong>${result.changedFiles.length}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("Judge 绫诲瀷", "Judge Types"))}</span><strong>${escapeHtml(judgeKinds)}</strong></div>
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
    `
      <section class="detail-card">
        <h3>Provider Identity</h3>
        <div class="summary-grid">
          <div class="summary-row"><span>Requested Profile</span><strong>${escapeHtml(result.requestedConfig?.providerProfileId ?? "official")}</strong></div>
          <div class="summary-row"><span>Effective Provider</span><strong>${escapeHtml(runtime.provider)}</strong></div>
          <div class="summary-row"><span>Provider Kind</span><strong>${escapeHtml(runtime.providerKind)}</strong></div>
          <div class="summary-row"><span>Provider Source</span><strong>${escapeHtml(runtime.providerSource)}</strong></div>
        </div>
        ${
          runtime.providerKind !== "official" && runtime.provider !== "official"
            ? `<p class="warning-text">${escapeHtml("This result was produced through a provider-switched Claude Code configuration.")}</p>`
            : ""
        }
      </section>
    `,
    renderStepCards(localText("鍑嗗姝ラ", "Setup"), result.setupResults),
    renderJudgeCards(result),
    renderStepCards(localText("鏀跺熬姝ラ", "Teardown"), result.teardownResults),
    `
      <section class="detail-card">
        <h3>${escapeHtml(localText("鏀瑰姩鏂囦欢", "Changed Files"))}</h3>
        ${
          result.changedFiles.length === 0
            ? `<p class="empty-state">${escapeHtml(localText("娌℃湁妫€娴嬪埌 diff銆?, "No diff detected."))}</p>`
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
      ? "宸插姞杞藉崟涓?summary.json銆傜幇鍦ㄥ彲浠ョ洿鎺ユ煡鐪嬬粨鏋滐紝鎴栬€呯户缁姞杞?summary.md銆?
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
      ? "Markdown 宸插姞杞姐€傚鏋滃綋鍓嶄篃鏈?run锛屽垎浜憳瑕佷細鑷姩鍑虹幇銆?
      : "Markdown loaded. If a run is also loaded, the share summary will appear automatically.";
  renderNextSteps();
  renderMarkdownPanel();
}

async function copyToClipboard(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    elements.clipboardStatus.textContent =
      state.language === "zh-CN" ? `${label} 宸插鍒躲€俙 : `${label} copied.`;
  } catch (error) {
    elements.clipboardStatus.textContent =
      state.language === "zh-CN" ? `${label} 澶嶅埗澶辫触銆俙 : `Failed to copy ${label.toLowerCase()}.`;
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
        ? "閫変腑鐨勭洰褰曢噷娌℃湁 summary.json銆傝鏀归€変竴涓?RepoArena 缁撴灉鐩綍銆?
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
      ? `宸蹭粠鐩綍涓瘑鍒埌 ${runs.length} 涓?run銆俙
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

  if (target.id === "launcher-add-provider") {
    openProviderEditor();
    renderLauncher();
    return;
  }

  if (target.getAttribute("data-role") === "provider-edit") {
    openProviderEditor(target.getAttribute("data-profile-id"));
    renderLauncher();
    return;
  }

  if (target.getAttribute("data-role") === "provider-cancel") {
    state.launcherProviderEditor = null;
    renderLauncher();
    return;
  }

  if (target.getAttribute("data-role") === "provider-save") {
    void (async () => {
      try {
        await saveProviderProfileFromEditor();
        state.notice = localText("Claude Provider 宸蹭繚瀛樸€?, "Claude provider saved.");
      } catch (error) {
        state.notice = error instanceof Error ? error.message : String(error);
      }
      render();
    })();
    return;
  }

  if (target.getAttribute("data-role") === "provider-delete") {
    const profileId = target.getAttribute("data-profile-id");
    if (!profileId) {
      return;
    }
    void (async () => {
      try {
        await deleteProviderProfileById(profileId);
        state.notice = localText("Claude Provider 宸插垹闄ゃ€?, "Claude provider deleted.");
      } catch (error) {
        state.notice = error instanceof Error ? error.message : String(error);
      }
      render();
    })();
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
    state.language === "zh-CN" ? "鍒嗕韩 SVG 宸蹭笅杞姐€? : "Share SVG downloaded.";
});

try {
  state.language = localStorage.getItem("repoarena.webReport.language") || "zh-CN";
} catch {
  state.language = "zh-CN";
}

detectService();
render();


