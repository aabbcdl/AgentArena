import {
  buildPrTable,
  buildShareCard,
  buildShareCardSvg,
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
  notice: null
};

const elements = {
  fileInput: document.querySelector("#summary-file"),
  markdownInput: document.querySelector("#markdown-file"),
  folderInput: document.querySelector("#runs-folder"),
  languageSelect: document.querySelector("#language-select"),
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
  runDiffTable: document.querySelector("#run-diff-table"),
  preflights: document.querySelector("#preflights"),
  compareStatusFilter: document.querySelector("#compare-status-filter"),
  compareSort: document.querySelector("#compare-sort"),
  compareSortHint: document.querySelector("#compare-sort-hint"),
  compareTable: document.querySelector("#compare-table"),
  agentTrendTitle: document.querySelector("#agent-trend-title"),
  agentTrendTable: document.querySelector("#agent-trend-table"),
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
    judgeStatusFail: "Fail"
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
    judgeStatusFail: "失败"
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

function formatCost(result) {
  return result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a";
}

function renderStaticText() {
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
  renderList(elements.workflowList, t("workflowSteps"));
  renderList(document.querySelector("#hero-how-list"), t("heroHowSteps"));
}

function renderNextSteps() {
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
  elements.runInfo.innerHTML = `
    <div class="panel-header">
      <h2>${escapeHtml(t("runInfoTitle"))}</h2>
      <span class="muted">${escapeHtml(run.runId)}</span>
    </div>
    <p class="muted">${escapeHtml(t("createdAt"))} ${escapeHtml(run.createdAt)}</p>
    <p class="muted">${escapeHtml(t("taskSchema"))} ${escapeHtml(run.task.schemaVersion)}</p>
  `;
  setHidden(elements.runInfo, false);
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

function renderRunDiffTable() {
  if (!state.run) {
    elements.runDiffTable.innerHTML = `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "还没有选中 run。" : "No run selected.")}</p>`;
    return;
  }

  const diff = getRunToRunAgentDiff(state.runs, state.run);
  if (!diff.previousRun) {
    elements.runDiffTable.innerHTML =
      `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "当前任务还没有更早的 run 可用于比较。" : "No earlier run with the same task title is available for comparison.")}</p>`;
    return;
  }

  if (diff.rows.length === 0) {
    elements.runDiffTable.innerHTML = `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "没有可比较的 agent 结果。" : "No comparable agent results found.")}</p>`;
    return;
  }

  elements.runDiffTable.innerHTML = `
    <p class="muted">${
      state.language === "zh-CN"
        ? `正在比较当前 run <code>${escapeHtml(state.run.runId)}</code> 与上一个同任务 run <code>${escapeHtml(
            diff.previousRun.runId
          )}</code>（${escapeHtml(diff.previousRun.createdAt)}）。`
        : `Comparing current run <code>${escapeHtml(state.run.runId)}</code> against previous same-task run <code>${escapeHtml(
            diff.previousRun.runId
          )}</code> from ${escapeHtml(diff.previousRun.createdAt)}.`
    }</p>
    <table class="compare-table">
      <thead>
        <tr>
          <th>${escapeHtml(state.language === "zh-CN" ? "Agent" : "Agent")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "状态变化" : "Status")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "耗时变化" : "Duration Delta")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "Token 变化" : "Token Delta")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "成本变化" : "Cost Delta")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "Judge 变化" : "Judge Delta")}</th>
        </tr>
      </thead>
      <tbody>
        ${diff.rows
          .map((row) => {
            const isActive = row.agentId === state.selectedAgentId ? "active" : "";
            return `
              <tr class="${isActive}" data-run-diff-agent-id="${escapeHtml(row.agentId)}">
                <td>
                  <strong>${escapeHtml(row.currentResult?.agentTitle ?? row.previousResult?.agentTitle ?? row.agentId)}</strong><br />
                  <code>${escapeHtml(row.agentId)}</code>
                </td>
                <td>${escapeHtml(row.statusChange)}</td>
                <td>${formatSignedNumber(row.durationDeltaMs, (value) => `${value > 0 ? "+" : ""}${value}ms`)}</td>
                <td>${formatSignedNumber(row.tokenDelta, (value) => `${value > 0 ? "+" : ""}${value}`)}</td>
                <td>${formatSignedNumber(
                  row.costDelta,
                  (value) => `${value > 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`,
                  "lower"
                )}</td>
                <td>${formatSignedNumber(
                  row.judgeDelta,
                  (value) => `${value > 0 ? "+" : ""}${value}`,
                  "higher"
                )}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderAgentTrendTable(run) {
  if (!state.selectedAgentId) {
    elements.agentTrendTitle.textContent = t("agentTrendTitle");
    elements.agentTrendTable.innerHTML = `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "先选一个 agent，再看它的历史趋势。" : "Select an agent to view its run history.")}</p>`;
    return;
  }

  const activeResult = run.results.find((result) => result.agentId === state.selectedAgentId) ?? null;
  elements.agentTrendTitle.textContent = activeResult
    ? `${t("agentTrendTitle")}: ${activeResult.agentTitle}`
    : `${t("agentTrendTitle")}: ${state.selectedAgentId}`;

  const rows = getAgentTrendRows(state.runs, run, state.selectedAgentId);
  if (rows.length === 0) {
    elements.agentTrendTable.innerHTML =
      `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "当前 agent 在这个任务下还没有历史记录。" : "No same-task history found for the selected agent.")}</p>`;
    return;
  }

  elements.agentTrendTable.innerHTML = `
    <p class="muted">${
      state.language === "zh-CN"
        ? `这是 <code>${escapeHtml(state.selectedAgentId)}</code> 在同一任务下的历史表现，按时间从早到晚排列。`
        : `Same-task history for <code>${escapeHtml(state.selectedAgentId)}</code>, oldest to newest.`
    }</p>
    <table class="compare-table">
      <thead>
        <tr>
          <th>${escapeHtml(state.language === "zh-CN" ? "Run" : "Run")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "创建时间" : "Created")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "状态" : "Status")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "耗时" : "Duration")}</th>
          <th>${escapeHtml(t("metrics.tokens"))}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "成本" : "Cost")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "Judge 通过" : "Judge Pass")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "相对上一轮变化" : "Delta vs Previous")}</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const isActive = row.run.runId === state.selectedRunId ? "active" : "";
            const passedJudges = row.result.judgeResults.filter((judge) => judge.success).length;
            const deltaParts = [
              `${state.language === "zh-CN" ? "状态" : "status"} ${row.statusChange}`,
              row.durationDeltaMs === null
                ? `${state.language === "zh-CN" ? "耗时" : "duration"} n/a`
                : `${state.language === "zh-CN" ? "耗时" : "duration"} ${row.durationDeltaMs > 0 ? "+" : ""}${row.durationDeltaMs}ms`,
              row.tokenDelta === null
                ? `${state.language === "zh-CN" ? "tokens" : "tokens"} n/a`
                : `${state.language === "zh-CN" ? "tokens" : "tokens"} ${row.tokenDelta > 0 ? "+" : ""}${row.tokenDelta}`,
              row.costDelta === null
                ? `${state.language === "zh-CN" ? "成本" : "cost"} n/a`
                : `${state.language === "zh-CN" ? "成本" : "cost"} ${row.costDelta > 0 ? "+" : "-"}$${Math.abs(row.costDelta).toFixed(2)}`,
              row.judgeDelta === null
                ? `${state.language === "zh-CN" ? "judges" : "judges"} n/a`
                : `${state.language === "zh-CN" ? "judges" : "judges"} ${row.judgeDelta > 0 ? "+" : ""}${row.judgeDelta}`
            ];

            return `
              <tr class="${isActive}" data-agent-trend-run-id="${escapeHtml(row.run.runId)}">
                <td><code>${escapeHtml(row.run.runId)}</code></td>
                <td>${escapeHtml(row.run.createdAt)}</td>
                <td><span class="status-badge ${statusClass(row.result.status)}">${escapeHtml(row.result.status)}</span></td>
                <td>${escapeHtml(formatDuration(row.result.durationMs))}</td>
                <td>${row.result.tokenUsage}</td>
                <td>${escapeHtml(formatCost(row.result))}</td>
                <td>${passedJudges}/${row.result.judgeResults.length}</td>
                <td><span class="muted">${escapeHtml(deltaParts.join(" | "))}</span></td>
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
            <h3>${escapeHtml(preflight.agentTitle)}</h3>
            <span class="status-badge ${statusClass(preflight.status)}">${escapeHtml(preflight.status)}</span>
          </div>
          <p>${escapeHtml(preflight.summary)}</p>
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
      value: verdict.bestAgent ? verdict.bestAgent.agentTitle : "n/a",
      meta: verdict.bestAgent ? `${verdict.bestAgent.agentId} | ${verdict.bestAgent.status}` : t("verdicts.noResult")
    },
    {
      label: t("verdicts.fastest"),
      value: verdict.fastest ? verdict.fastest.agentTitle : "n/a",
      meta: verdict.fastest ? formatDuration(verdict.fastest.durationMs) : t("verdicts.noResult")
    },
    {
      label: t("verdicts.lowestKnownCost"),
      value: verdict.lowestKnownCost ? verdict.lowestKnownCost.agentTitle : "n/a",
      meta: verdict.lowestKnownCost ? formatCost(verdict.lowestKnownCost) : t("verdicts.noKnownCost")
    },
    {
      label: t("verdicts.highestJudgePassRate"),
      value: verdict.highestJudgePassRate ? verdict.highestJudgePassRate.agentTitle : "n/a",
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
      return `
        <button class="agent-button ${active}" type="button" data-agent-id="${escapeHtml(result.agentId)}">
          <div class="row">
            <strong>${escapeHtml(result.agentTitle)}</strong>
            <span class="status-badge ${statusClass(result.status)}">${escapeHtml(result.status)}</span>
          </div>
          <div class="meta">
            ${escapeHtml(result.agentId)} | ${escapeHtml(formatDuration(result.durationMs))} | ${escapeHtml(
              formatCost(result)
            )}
          </div>
        </button>
      `;
    })
    .join("");
}

function renderCompareTable(run) {
  const results = getCompareResults(run, compareFilters);
  const sortHintMap = {
    status: state.language === "zh-CN" ? "按状态排序，同状态下更快的排前面。" : "Sorted by status, then fastest first.",
    duration: state.language === "zh-CN" ? "按耗时排序，越快越靠前。" : "Sorted by fastest agents first.",
    tokens: state.language === "zh-CN" ? "按 token 用量排序，越高越靠前。" : "Sorted by highest token usage first.",
    cost: state.language === "zh-CN" ? "按已知成本排序，越低越靠前。" : "Sorted by lowest known cost first.",
    changed: state.language === "zh-CN" ? "按改动文件数排序，越多越靠前。" : "Sorted by most changed files first.",
    judges: state.language === "zh-CN" ? "按 judge 通过率排序，越高越靠前。" : "Sorted by highest judge pass rate first."
  };
  elements.compareSortHint.textContent = sortHintMap[compareFilters.sort] ?? sortHintMap.status;

  if (results.length === 0) {
    elements.compareTable.innerHTML = `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "没有 agent 符合当前筛选条件。" : "No agents match the current compare filters.")}</p>`;
    return;
  }

  elements.compareTable.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>${escapeHtml(state.language === "zh-CN" ? "Agent" : "Agent")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "状态" : "Status")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "耗时" : "Duration")}</th>
          <th>${escapeHtml(t("metrics.tokens"))}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "成本" : "Cost")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "改动文件" : "Changed")}</th>
          <th>${escapeHtml(state.language === "zh-CN" ? "Judges" : "Judges")}</th>
        </tr>
      </thead>
      <tbody>
        ${results
          .map((result) => {
            const passedJudges = result.judgeResults.filter((judge) => judge.success).length;
            const isActive = result.agentId === state.selectedAgentId ? "active" : "";

            return `
              <tr class="${isActive}" data-compare-agent-id="${escapeHtml(result.agentId)}">
                <td><strong>${escapeHtml(result.agentTitle)}</strong><br /><code>${escapeHtml(result.agentId)}</code></td>
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

function renderSelectedAgent() {
  if (!state.run || !state.selectedAgentId) {
    return;
  }

  const result = state.run.results.find((entry) => entry.agentId === state.selectedAgentId);
  if (!result) {
    return;
  }

  elements.resultSummary.innerHTML = `
    <h3>${escapeHtml(result.agentTitle)}</h3>
    <div class="summary-grid">
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "状态" : "Status")}</span><strong>${escapeHtml(result.status)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "耗时" : "Duration")}</span><strong>${escapeHtml(formatDuration(result.durationMs))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(t("metrics.tokens"))}</span><strong>${result.tokenUsage}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "成本" : "Cost")}</span><strong>${escapeHtml(formatCost(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "改动文件" : "Changed Files")}</span><strong>${result.changedFiles.length}</strong></div>
      <div class="summary-row"><span>${escapeHtml(state.language === "zh-CN" ? "Judge 类型" : "Judge Types")}</span><strong>${escapeHtml(
        Array.from(new Set(result.judgeResults.map((judge) => formatJudgeType(judge.type)))).join(", ") ||
          (state.language === "zh-CN" ? "无" : "None")
      )}</strong></div>
      <div class="summary-row"><span>Trace</span><code>${escapeHtml(result.tracePath)}</code></div>
      <div class="summary-row"><span>Workspace</span><code>${escapeHtml(result.workspacePath)}</code></div>
    </div>
    <p class="muted">${escapeHtml(result.summary)}</p>
  `;

  elements.resultDetails.innerHTML = [
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

  renderRunInfo(run);
  renderMetrics(run);
  renderVerdicts(run);
  renderRunCompareTable();
  renderRunDiffTable();
  renderPreflights(run);
  renderAgentList(run);
  renderCompareTable(run);
  renderAgentTrendTable(run);
  populateJudgeFilters(run);
  renderSelectedAgent();
  renderMarkdownPanel();
  renderNextSteps();
}

function render() {
  renderStaticText();
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
  renderCompareTable(state.run);
  renderAgentTrendTable(state.run);
  renderSelectedAgent();
});

elements.compareTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-compare-agent-id]");
  if (!row || !state.run) {
    return;
  }

  state.selectedAgentId = row.getAttribute("data-compare-agent-id");
  renderAgentList(state.run);
  renderCompareTable(state.run);
  renderAgentTrendTable(state.run);
  renderSelectedAgent();
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
  renderCompareTable(state.run);
  renderRunDiffTable();
  renderAgentTrendTable(state.run);
  renderSelectedAgent();
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
  renderSelectedAgent();
});

elements.judgeTypeFilter.addEventListener("change", (event) => {
  judgeFilters.type = String(event.target.value ?? "all");
  renderSelectedAgent();
});

elements.judgeStatusFilter.addEventListener("change", (event) => {
  judgeFilters.status = String(event.target.value ?? "all");
  renderSelectedAgent();
});

elements.compareStatusFilter.addEventListener("change", (event) => {
  compareFilters.status = String(event.target.value ?? "all");
  if (state.run) {
    renderCompareTable(state.run);
  }
});

elements.compareSort.addEventListener("change", (event) => {
  compareFilters.sort = String(event.target.value ?? "status");
  if (state.run) {
    renderCompareTable(state.run);
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

render();
