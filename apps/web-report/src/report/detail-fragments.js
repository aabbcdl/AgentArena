export function createDetailFragments({
  state,
  judgeFilters,
  localText,
  escapeHtml,
  formatDuration,
  statusClass,
  translateStatus,
  formatJudgeType,
  findJudgeByType,
  formatDiffPrecisionMetric,
  formatCompositeScore,
  formatTestMetric,
  formatLintMetric,
  resultLabel,
  baseAgentLabel
}) {
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
                <div class="detail-row"><span>${escapeHtml(localText("工作目录", "CWD"))}</span><code>${escapeHtml(step.cwd)}</code></div>
                ${
                  step.stdout
                    ? `<p class="muted">${escapeHtml(localText("标准输出", "stdout"))}</p><pre>${escapeHtml(step.stdout)}</pre>`
                    : ""
                }
                ${
                  step.stderr
                    ? `<p class="muted">${escapeHtml(localText("标准错误", "stderr"))}</p><pre>${escapeHtml(step.stderr)}</pre>`
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
      const matchesStatus = judgeFilters.status === "all" || (judgeFilters.status === "pass" ? judge.success : !judge.success);
      const haystack = [judge.label, judge.target ?? "", judge.expectation ?? "", judge.command ?? ""].join(" ").toLowerCase();
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
                    ? `<div class="detail-row"><span>${escapeHtml(state.language === "zh-CN" ? "预期" : "Expectation")}</span><code>${escapeHtml(judge.expectation)}</code></div>`
                    : ""
                }
                ${
                  judge.command
                    ? `<div class="detail-row"><span>${escapeHtml(state.language === "zh-CN" ? "命令" : "Command")}</span><code>${escapeHtml(judge.command)}</code></div>`
                    : ""
                }
                ${typeof judge.totalCount === "number" ? `<div class="detail-row"><span>${escapeHtml(localText("总数", "Total"))}</span><strong>${judge.totalCount}</strong></div>` : ""}
                ${typeof judge.passedCount === "number" ? `<div class="detail-row"><span>${escapeHtml(localText("通过", "Passed"))}</span><strong>${judge.passedCount}</strong></div>` : ""}
                ${typeof judge.failedCount === "number" ? `<div class="detail-row"><span>${escapeHtml(localText("失败", "Failed"))}</span><strong>${judge.failedCount}</strong></div>` : ""}
                ${typeof judge.skippedCount === "number" ? `<div class="detail-row"><span>${escapeHtml(localText("跳过", "Skipped"))}</span><strong>${judge.skippedCount}</strong></div>` : ""}
                ${typeof judge.errorCount === "number" ? `<div class="detail-row"><span>${escapeHtml(localText("错误数", "Errors"))}</span><strong>${judge.errorCount}</strong></div>` : ""}
                ${typeof judge.warningCount === "number" ? `<div class="detail-row"><span>${escapeHtml(localText("警告数", "Warnings"))}</span><strong>${judge.warningCount}</strong></div>` : ""}
                ${judge.parser ? `<div class="detail-row"><span>${escapeHtml(localText("解析器", "Parser"))}</span><strong>${escapeHtml(judge.parser)}</strong></div>` : ""}
                ${
                  judge.cwd
                    ? `<div class="detail-row"><span>${escapeHtml(localText("工作目录", "CWD"))}</span><code>${escapeHtml(judge.cwd)}</code></div>`
                    : ""
                }
                ${
                  judge.stdout
                    ? `<p class="muted">${escapeHtml(localText("标准输出", "stdout"))}</p><pre>${escapeHtml(judge.stdout)}</pre>`
                    : ""
                }
                ${
                  judge.stderr
                    ? `<p class="muted">${escapeHtml(localText("标准错误", "stderr"))}</p><pre>${escapeHtml(judge.stderr)}</pre>`
                    : ""
                }
              </details>
            `
            )
            .join("")}</div>`;

    return `<section class="detail-card"><h3>${escapeHtml(localText("Judge 检查项", "Judges"))}</h3>${overview}${
      filteredJudges.length === 0 && judges.length > 0
        ? `<p class="empty-state">${escapeHtml(state.language === "zh-CN" ? "当前筛选下没有匹配的 judge。" : "No judges match the current filters.")}</p>`
        : content
    }</section>`;
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
      ${
        typeof result.diffPrecision?.score === "number"
          ? `<div class="summary-grid" style="margin-bottom:1rem">
            <div class="summary-row"><span>${escapeHtml(localText("Diff 精准度", "Diff Precision"))}</span><strong>${escapeHtml(formatDiffPrecisionMetric(result))}</strong></div>
            <div class="summary-row"><span>${escapeHtml(localText("命中范围", "Matched Scope"))}</span><strong>${result.diffPrecision.matchedFiles.length}</strong></div>
            <div class="summary-row"><span>${escapeHtml(localText("范围外改动", "Unexpected Changes"))}</span><strong>${result.diffPrecision.unexpectedFiles.length}</strong></div>
          </div>`
          : ""
      }
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

  function renderInlineAgentDetail(result) {
    const passed = result.judgeResults.filter((j) => j.success);
    const failed = result.judgeResults.filter((j) => !j.success);
    const judgeChips = [
      ...passed.map((j) => `<span class="judge-chip judge-chip-pass">${escapeHtml(j.label || j.judgeId)}</span>`),
      ...failed.map((j) => `<span class="judge-chip judge-chip-fail">${escapeHtml(j.label || j.judgeId)}</span>`)
    ].join("");

    const maxFiles = 10;
    const files = result.changedFiles.slice(0, maxFiles);
    const moreCount = result.changedFiles.length - maxFiles;
    const filesHtml =
      files.length > 0
        ? `<ul class="files-list">${files.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}${moreCount > 0 ? `<li class="muted">+${moreCount} ${localText("更多", "more")}</li>` : ""}</ul>`
        : `<span class="muted">${escapeHtml(localText("无改动", "No changes"))}</span>`;

    return `
    <div class="compare-detail-panel">
      <div>
        <h4>${escapeHtml(localText("Judge 概览", "Judges"))}</h4>
        <div class="judge-summary">${judgeChips || `<span class="muted">${escapeHtml(localText("无", "None"))}</span>`}</div>
      </div>
      <div>
        <h4>${escapeHtml(localText("改动文件", "Changed Files"))}</h4>
        ${filesHtml}
      </div>
      <div>
        <h4>${escapeHtml(localText("硬指标", "Hard Metrics"))}</h4>
        <div class="summary-grid">
          <div class="summary-row"><span>${escapeHtml(localText("综合分", "Composite Score"))}</span><strong>${escapeHtml(formatCompositeScore(result, state.run, state.scoreWeights))}</strong></div>
          <div class="summary-row"><span>${escapeHtml(localText("测试", "Tests"))}</span><strong>${escapeHtml(formatTestMetric(result))}</strong></div>
          <div class="summary-row"><span>${escapeHtml(localText("Lint", "Lint"))}</span><strong>${escapeHtml(formatLintMetric(result))}</strong></div>
          <div class="summary-row"><span>${escapeHtml(localText("Diff 精准度", "Diff Precision"))}</span><strong>${escapeHtml(formatDiffPrecisionMetric(result))}</strong></div>
        </div>
      </div>
      <div class="agent-summary-text">
        <span>${escapeHtml(result.summary || "")}</span>
        <button type="button" class="view-full-link" data-role="view-full-details">${escapeHtml(localText("查看完整详情", "View Full Details"))}</button>
      </div>
    </div>
  `;
  }

  return {
    renderStepCards,
    renderJudgeCards,
    renderDiff,
    renderMarkdownBlock,
    renderInlineAgentDetail,
    findJudgeByType,
    baseAgentLabel
  };
}
