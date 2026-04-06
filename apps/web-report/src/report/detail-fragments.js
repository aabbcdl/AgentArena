export function createDetailFragments({
  state,
  judgeFilters,
  localText,
  escapeHtml,
  formatDuration,
  statusClass,
  formatJudgeType,
  findJudgeByType,
  formatDiffPrecisionMetric,
  formatCompositeScore,
  formatTestMetric,
  formatLintMetric,
  baseAgentLabel
}) {
  function renderStepCards(title, steps) {
    const content =
      steps.length === 0
        ? `<p class="empty-state">${escapeHtml(localText("没有执行任何命令。", "No commands executed."))}</p>`
        : `<div class="step-list">${steps
            .map(
              (step) => `
              <details class="step-card">
                <summary>
                  <strong>${escapeHtml(step.label)}</strong>
                  <span class="status-badge ${statusClass(step.success ? "success" : "failed")}">${
                    step.success ? localText("通过", "pass") : localText("失败", "fail")
                  }</span>
                  <span class="muted">${escapeHtml(formatDuration(step.durationMs))}</span>
                </summary>
                <div class="detail-row"><span>${escapeHtml(localText("命令", "Command"))}</span><code>${escapeHtml(step.command)}</code></div>
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
        ? `<p class="empty-state">${escapeHtml(localText("没有执行任何 judge。", "No judges executed."))}</p>`
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
                    judge.success ? localText("通过", "pass") : localText("失败", "fail")
                  }</span>
                  <span class="muted">${escapeHtml(formatDuration(judge.durationMs))}</span>
                </summary>
                ${
                  judge.target
                    ? `<div class="detail-row"><span>${escapeHtml(localText("目标", "Target"))}</span><code>${escapeHtml(judge.target)}</code></div>`
                    : ""
                }
                ${
                  judge.expectation
                    ? `<div class="detail-row"><span>${escapeHtml(localText("预期", "Expectation"))}</span><code>${escapeHtml(judge.expectation)}</code></div>`
                    : ""
                }
                ${
                  judge.command
                    ? `<div class="detail-row"><span>${escapeHtml(localText("命令", "Command"))}</span><code>${escapeHtml(judge.command)}</code></div>`
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
        ? `<p class="empty-state">${escapeHtml(localText("当前筛选下没有匹配的 judge。", "No judges match the current filters."))}</p>`
        : content
    }</section>`;
  }

  function renderDiff(result) {
    const sections = [
      [localText("新增", "Added"), result.diff.added],
      [localText("修改", "Changed"), result.diff.changed],
      [localText("删除", "Removed"), result.diff.removed]
    ];

    return `
    <section class="detail-card">
      <h3>${escapeHtml(localText("Diff 细分", "Diff Breakdown"))}</h3>
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
                    ? `<p class="empty-state">${escapeHtml(localText("无", "None"))}</p>`
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

  function renderCodeReviewSection(container, run) {
    const section = container.querySelector("#code-review-section");
    if (!section) return;

    const content = container.querySelector("#code-review-content");
    const selector = container.querySelector("#code-review-agent-selector");
    const compareBtn = container.querySelector("#code-review-compare-btn");
    const diffViewer = container.querySelector("#code-review-diff-viewer");

    // Clear previous content
    selector.innerHTML = "";

    // Add agent checkboxes
    const successfulAgents = run.results.filter((r) => r.status === "success");
    if (successfulAgents.length === 0) {
      selector.innerHTML = `<p class="muted">${escapeHtml(localText("没有成功的 Agent 结果可供对比", "No successful agent results available for comparison"))}</p>`;
      return;
    }

    for (const result of successfulAgents) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = result.agentId;
      checkbox.setAttribute("aria-label", result.displayLabel);
      checkbox.addEventListener("change", () => {
        const checked = selector.querySelectorAll("input:checked");
        compareBtn.disabled = checked.length < 2;
      });
      const span = document.createElement("span");
      span.textContent = result.displayLabel;
      label.appendChild(checkbox);
      label.appendChild(span);
      selector.appendChild(label);
    }

    // Compare button handler
    compareBtn.replaceWith(compareBtn.cloneNode(true));
    const newCompareBtn = container.querySelector("#code-review-compare-btn");
    newCompareBtn.addEventListener("click", () => {
      const checked = selector.querySelectorAll("input:checked");
      const selectedAgentIds = Array.from(checked).map((cb) => cb.value);
      const selectedResults = run.results.filter((r) => selectedAgentIds.includes(r.agentId));

      renderSideBySideDiff(diffViewer, selectedResults, run);
    });

    // Section toggle
    const toggle = section.querySelector(".section-toggle");
    if (toggle) {
      toggle.replaceWith(toggle.cloneNode(true));
      const newToggle = section.querySelector(".section-toggle");
      newToggle.addEventListener("click", () => {
        const isVisible = content.style.display !== "none";
        content.style.display = isVisible ? "none" : "block";
      });
    }
  }

  function renderSideBySideDiff(container, results, run) {
    container.innerHTML = "";

    const diffContainer = document.createElement("div");
    diffContainer.className = "side-by-side-diff";

    for (const result of results) {
      const panel = document.createElement("div");
      panel.className = "diff-panel";

      // Header
      const header = document.createElement("div");
      header.className = "diff-panel-header";
      header.textContent = result.displayLabel;
      panel.appendChild(header);

      // Content - show changed files
      const contentEl = document.createElement("div");
      contentEl.className = "diff-panel-content";

      if (result.changedFiles && result.changedFiles.length > 0) {
        contentEl.textContent =
          localText("变更文件:", "Changed files:") +
          "\n" +
          result.changedFiles.map((f) => `  ${f}`).join("\n");
      } else {
        contentEl.textContent = localText("未检测到文件变更", "No file changes detected");
      }
      panel.appendChild(contentEl);

      // Summary
      const summary = document.createElement("div");
      summary.className = "diff-summary";
      const addedCount = result.diff?.added?.length ?? 0;
      const changedCount = result.diff?.changed?.length ?? 0;
      const removedCount = result.diff?.removed?.length ?? 0;
      summary.innerHTML = `<span class="added">+${addedCount} ${localText("新增", "added")}</span><span class="changed">~${changedCount} ${localText("修改", "changed")}</span><span class="removed">-${removedCount} ${localText("删除", "removed")}</span>`;
      panel.appendChild(summary);

      diffContainer.appendChild(panel);
    }

    container.appendChild(diffContainer);
  }

  function renderTeamCostCalculator(container, run) {
    const section = container.querySelector('#team-cost-section');
    if (!section) return;

    const content = container.querySelector('#team-cost-content');
    const tableContainer = container.querySelector('#team-cost-table');
    const teamSizeInput = container.querySelector('#team-size-input');
    const dailyRunsInput = container.querySelector('#daily-runs-input');
    const recalcBtn = container.querySelector('#recalculate-cost-btn');

    function renderTable() {
      const teamSize = parseInt(teamSizeInput.value) || 10;
      const dailyRuns = parseInt(dailyRunsInput.value) || 5;
      const workingDays = 22;
      const monthlyMultiplier = teamSize * dailyRuns * workingDays;

      const successfulResults = run.results
        .filter(r => r.status === 'success' && r.costKnown && r.estimatedCostUsd > 0)
        .sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd);

      const cheapest = successfulResults[0]?.estimatedCostUsd ?? 0;

      let html = '<table>';
      html += '<thead><tr><th>Agent</th><th>' + escapeHtml(localText('单次成本', 'Cost/Run')) + '</th><th>' + escapeHtml(localText('月成本', 'Monthly Cost')) + '</th><th>' + escapeHtml(localText('与最便宜差距', 'vs Cheapest')) + '</th></tr></thead>';
      html += '<tbody>';

      for (const result of run.results) {
        if (!result.costKnown || result.estimatedCostUsd <= 0) continue;

        const monthlyCost = result.estimatedCostUsd * monthlyMultiplier;
        const diff = monthlyCost - (cheapest * monthlyMultiplier);
        const isCheapest = result.estimatedCostUsd === cheapest;

        html += `<tr class="${isCheapest ? 'cheapest' : diff > 0 ? 'expensive' : ''}">`;
        html += `<td>${escapeHtml(result.displayLabel)}</td>`;
        html += `<td>$${result.estimatedCostUsd.toFixed(2)}</td>`;
        html += `<td>$${monthlyCost.toFixed(0)}</td>`;
        html += `<td>${isCheapest ? '✅ ' + escapeHtml(localText('最便宜', 'Cheapest')) : `+$${diff.toFixed(0)}`}</td>`;
        html += '</tr>';
      }

      html += '</tbody></table>';
      tableContainer.innerHTML = html;
    }

    recalcBtn?.addEventListener('click', renderTable);

    const toggle = section.querySelector('.section-toggle');
    if (toggle) {
      toggle.replaceWith(toggle.cloneNode(true));
      const newToggle = section.querySelector('.section-toggle');
      newToggle.addEventListener('click', () => {
        const isVisible = content.style.display !== 'none';
        content.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) renderTable();
      });
    }
  }

  function setupShareActions(container, run, decisionReport) {
    const exportMdBtn = container.querySelector('#share-export-md-btn');
    const exportHtmlBtn = container.querySelector('#share-export-html-btn');
    const copyLinkBtn = container.querySelector('#share-copy-link-btn');
    const copySummaryBtn = container.querySelector('#share-copy-summary-btn');

    // Export Markdown
    exportMdBtn?.addEventListener('click', () => {
      const mdContent = decisionReport
        ? window.formatDecisionReport?.(decisionReport)
        : generateSummaryMarkdown(run);
      downloadFile(mdContent, `repoarena-report-${run.runId}.md`, 'text/markdown');
    });

    // Export HTML (reuse existing report HTML)
    exportHtmlBtn?.addEventListener('click', () => {
      const htmlContent = document.documentElement.outerHTML;
      downloadFile(htmlContent, `repoarena-report-${run.runId}.html`, 'text/html');
    });

    // Copy share link
    copyLinkBtn?.addEventListener('click', async () => {
      const text = `Benchmark Report: ${run.task.title}\nRun ID: ${run.runId}\nGenerated: ${new Date(run.createdAt).toLocaleString()}`;
      try {
        await navigator.clipboard.writeText(text);
        showToast(localText('分享链接已复制到剪贴板', 'Share link copied to clipboard'));
      } catch {
        showToast(localText('复制失败，请手动复制', 'Copy failed, please copy manually'));
      }
    });

    // Copy summary
    copySummaryBtn?.addEventListener('click', async () => {
      const summary = generateSummaryText(run);
      try {
        await navigator.clipboard.writeText(summary);
        showToast(localText('摘要已复制到剪贴板', 'Summary copied to clipboard'));
      } catch {
        showToast(localText('复制失败，请手动复制', 'Copy failed, please copy manually'));
      }
    });
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(localText('文件已下载: {filename}', 'File downloaded: {filename}').replace('{filename}', filename));
  }

  function generateSummaryMarkdown(run) {
    const lines = ['# RepoArena Benchmark Report\n', `**Task**: ${run.task.title}\n`, `**Date**: ${new Date(run.createdAt).toLocaleString()}\n`];

    const successful = run.results.filter(r => r.status === 'success');
    const failed = run.results.filter(r => r.status !== 'success');

    lines.push(`## ${localText('结果', 'Results')}\n`);
    lines.push(`- ${localText('成功', 'Successful')}: ${successful.length}/${run.results.length}`);
    lines.push(`- ${localText('失败', 'Failed')}: ${failed.length}/${run.results.length}\n`);

    if (successful.length > 0) {
      const best = successful.reduce((a, b) => (a.compositeScore ?? 0) > (b.compositeScore ?? 0) ? a : b);
      lines.push(`## 🏆 ${localText('最佳 Agent', 'Best Agent')}: ${best.displayLabel}\n`);
      lines.push(`- ${localText('分数', 'Score')}: ${best.compositeScore?.toFixed(0)}/100`);
      lines.push(`- ${localText('耗时', 'Duration')}: ${(best.durationMs / 1000).toFixed(0)}s`);
      lines.push(`- ${localText('成本', 'Cost')}: $${best.estimatedCostUsd.toFixed(2)}\n`);
    }

    return lines.join('\n');
  }

  function generateSummaryText(run) {
    const successful = run.results.filter(r => r.status === 'success');
    if (successful.length === 0) return `All agents failed for task: ${run.task.title}`;

    const best = successful.reduce((a, b) => (a.compositeScore ?? 0) > (b.compositeScore ?? 0) ? a : b);
    return `🏆 ${best.displayLabel} won with score ${best.compositeScore?.toFixed(0)}/100 on "${run.task.title}". Cost: $${best.estimatedCostUsd.toFixed(2)}, Duration: ${(best.durationMs / 1000).toFixed(0)}s`;
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          if (toast.parentNode) {
            document.body.removeChild(toast);
          }
        }, 300);
      }, 2000);
    }, 10);
  }

  return {
    renderStepCards,
    renderJudgeCards,
    renderDiff,
    renderMarkdownBlock,
    renderInlineAgentDetail,
    renderCodeReviewSection,
    renderTeamCostCalculator,
    setupShareActions,
    findJudgeByType,
    baseAgentLabel
  };
}
