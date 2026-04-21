export function createCrossRunRenders({
	state,
	elements,
	t,
	localText,
	setHidden,
	summarizeRun,
	runtimeIdentity,
	formatDuration,
	getCrossRunRecommendation,
	escapeHtml
}) {
	function translateFairComparisonReason(reason, t) {
		switch (reason) {
			case "different-task-pack":
				return t("runCompareReasonDifferentTaskPack");
			case "different-judge-logic":
				return t("runCompareReasonDifferentJudgeLogic");
			case "different-repo-baseline":
				return t("runCompareReasonDifferentRepoBaseline");
			case "missing-core-data":
			default:
				return t("runCompareReasonMissingCoreData");
		}
	}

	function renderCrossRunCompare() {
    if (state.runs.length < 2) {
      setHidden(elements.crossRunCompareSection, true);
      return;
    }

    setHidden(elements.crossRunCompareSection, false);
    elements.crossRunCompareTitle.textContent = t("crossRunCompareTitle");
    elements.crossRunDescription.textContent = t("crossRunDescription");
    elements.crossRunCompareBtn.textContent = t("crossRunCompareBtn");
    elements.crossRunClearBtn.textContent = t("crossRunClearBtn");
    elements.crossRunCloseCompare.textContent = t("crossRunCloseCompare");
    elements.crossRunSearch.placeholder = t("crossRunSearchPlaceholder");

    const isSelectedMode = state.crossRunSelectMode;
    elements.crossRunToggleSelect.textContent = isSelectedMode
      ? localText("取消选择", "Cancel Selection")
      : t("crossRunToggleSelect");
    setHidden(elements.crossRunSelectionPanel, !isSelectedMode);
    setHidden(elements.crossRunCompareView, !state.crossRunCompareData);

    if (isSelectedMode) {
      renderCrossRunSelectionList();
      elements.crossRunCompareBtn.disabled = state.crossRunSelectedIds.size < 2;
    }

    if (state.crossRunCompareData) {
      renderCrossRunCompareTable();
      renderAgentRadarChart();
    }
  }

  function renderCrossRunSelectionList() {
    const searchTerm = (elements.crossRunSearch?.value || "").toLowerCase();
    const filteredRuns = state.runs.filter(
      (run) =>
        !searchTerm ||
        run.task.title.toLowerCase().includes(searchTerm) ||
        run.runId.toLowerCase().includes(searchTerm)
    );

    if (filteredRuns.length === 0) {
      elements.crossRunSelectionList.innerHTML = `<p class="empty-state">${escapeHtml(t("crossRunNoRuns"))}</p>`;
      return;
    }

    elements.crossRunSelectionList.innerHTML = filteredRuns
      .map((run) => {
        const summary = summarizeRun(run);
        const isSelected = state.crossRunSelectedIds.has(run.runId);
        const runtime = run.results[0] ? runtimeIdentity(run.results[0]) : {};

        return `
      <label class="cross-run-item ${isSelected ? "selected" : ""}">
        <input type="checkbox" data-run-id="${escapeHtml(run.runId)}" ${isSelected ? "checked" : ""} />
        <div class="cross-run-item-content">
          <strong>${escapeHtml(run.task.title)}</strong>
          <p class="muted">
            ${escapeHtml(run.runId.slice(0, 16))}... |
            ${escapeHtml(run.createdAt.slice(0, 10))} |
            ${summary.successCount}/${summary.totalAgents} ${localText("成功", "passed")} |
            ${localText("模型", "Model")}: ${escapeHtml(runtime.model || "unknown")} |
            ${localText("Provider", "Provider")}: ${escapeHtml(runtime.provider || "official")}
          </p>
        </div>
      </label>
    `;
      })
      .join("");
  }

  function renderCrossRunCompareTable() {
    if (!state.crossRunCompareData || state.crossRunCompareData.rows.length === 0) {
      elements.crossRunCompareTable.innerHTML = `<p class="empty-state">${escapeHtml(t("crossRunEmptySelection"))}</p>`;
      return;
    }

    const { runs, comparableRuns, excludedRuns, rows } = state.crossRunCompareData;
    elements.crossRunCompareSummary.textContent = excludedRuns.length > 0
      ? localText(
        `已选 ${runs.length} 个运行，其中 ${comparableRuns.length} 个进入公平对比，${excludedRuns.length} 个因前提不一致被排除。`,
        `${comparableRuns.length} of ${runs.length} selected runs are in the fair comparison; ${excludedRuns.length} were excluded because the comparison conditions do not match.`
      )
      : localText(
        `对比 ${runs.length} 个运行，全部满足公平对比条件。`,
        `Comparing ${runs.length} runs; all meet the fair comparison rules.`
      );

    const recommendation = getCrossRunRecommendation(state.crossRunCompareData, { scoreWeights: state.scoreWeights });

    const header = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>${escapeHtml(localText("配置名称", "Variant"))}</th>
          <th>${escapeHtml(localText("基础 Agent", "Base Agent"))}</th>
          <th>${escapeHtml(t("crossRunRuns"))}</th>
          <th>${escapeHtml(t("crossRunSuccessRate"))}</th>
          <th>${escapeHtml(t("crossRunAvgDuration"))}</th>
          <th>${escapeHtml(t("crossRunAvgTokens"))}</th>
          <th>${escapeHtml(t("crossRunAvgCost"))}</th>
          <th>${escapeHtml(localText("最佳模型", "Best Model"))}</th>
          <th>${escapeHtml(localText("最佳 Provider", "Best Provider"))}</th>
        </tr>
      </thead>
      <tbody>
    `;

    const body = rows
      .map((row) => {
        const avgDuration = Math.round(row.stats.totalDurationMs / row.stats.totalRuns);
        const avgTokens = Math.round(row.stats.totalTokens / row.stats.totalRuns);
        const avgCost =
          row.stats.costKnownCount > 0 ? (row.stats.totalCost / row.stats.costKnownCount).toFixed(4) : null;
        const successRate = ((row.stats.successCount / row.stats.totalRuns) * 100).toFixed(1);
        const isRecommended = recommendation && recommendation.agentId === row.agentId;

        return `
      <tr class="${isRecommended ? "recommended-row" : ""}">
        <td>
          <strong>${escapeHtml(row.displayLabel)}</strong>
          ${isRecommended ? `<span class="badge">${escapeHtml(t("crossRunBestConfig"))}</span>` : ""}
        </td>
        <td>${escapeHtml(row.baseAgent)}</td>
        <td>${row.stats.totalRuns}</td>
        <td>
          <span class="status-badge ${row.stats.successCount === row.stats.totalRuns ? "status-success" : row.stats.successCount > 0 ? "status-partial" : "status-fail"}">
            ${successRate}%
          </span>
          (${row.stats.successCount}/${row.stats.totalRuns})
        </td>
        <td>${escapeHtml(formatDuration(avgDuration))}</td>
        <td>${avgTokens.toLocaleString()}</td>
        <td>${avgCost !== null ? `$${avgCost}` : "n/a"}</td>
        <td>${escapeHtml(row.bestRuntime?.runtime?.model || "n/a")}</td>
        <td>${escapeHtml(row.bestRuntime?.runtime?.provider || "n/a")}</td>
      </tr>
    `;
      })
      .join("");

    const excludedHtml = excludedRuns.length === 0
      ? ""
      : `
        <section class="compare-excluded-block">
          <h4>${escapeHtml(t("runCompareExcludedTitle"))}</h4>
          <ul class="compare-excluded-list">
            ${excludedRuns.map(({ run, reasons }) => `
              <li>
                <strong>${escapeHtml(run.task.title)}</strong>
                <code>${escapeHtml(run.runId)}</code>
                <p>${escapeHtml(reasons.map((reason) => translateFairComparisonReason(reason, t)).join(" "))}</p>
              </li>
            `).join("")}
          </ul>
        </section>
      `;

    elements.crossRunCompareTable.innerHTML = header + body + "</tbody></table>" + excludedHtml;

    // 绘制雷达图
    renderRadarChart(rows);
  }

  function renderRadarChart(rows) {
    const canvas = document.getElementById('radar-canvas');
    if (!canvas || rows.length === 0) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 60;
    
    // 清除画布
    ctx.clearRect(0, 0, width, height);
    
    // 维度：成功率、速度、成本效率、稳定性、覆盖度
    const dimensions = [
      { key: 'successRate', label: localText('成功率', 'Success Rate') },
      { key: 'speed', label: localText('速度', 'Speed') },
      { key: 'costEfficiency', label: localText('成本效率', 'Cost Efficiency') },
      { key: 'stability', label: localText('稳定性', 'Stability') },
      { key: 'coverage', label: localText('覆盖度', 'Coverage') }
    ];
    
    const numDimensions = dimensions.length;
    const angleStep = (Math.PI * 2) / numDimensions;
    
    // 计算每个配置的各维度分数
    const chartData = rows.map(row => {
      const stats = row.stats;
      const successRate = stats.totalRuns > 0 ? stats.successCount / stats.totalRuns : 0;
      const avgDuration = stats.totalRuns > 0 ? stats.totalDurationMs / stats.totalRuns : 0;
      const avgCost = stats.costKnownCount > 0 ? stats.totalCost / stats.costKnownCount : 0;
      
      // 速度分数：越快越高 (假设 5 分钟为基准)
      const speedScore = avgDuration > 0 ? Math.min(1, 300000 / avgDuration) : 0;
      
      // 成本效率：越便宜越高 (假设 $0.1 为基准)
      const costEfficiency = avgCost > 0 ? Math.min(1, 0.1 / avgCost) : 1;
      
      // 稳定性：成功率的一致性 (简化为成功率本身)
      const stability = successRate;
      
      // 覆盖度：运行次数越多越高 (假设 10 次为基准)
      const coverage = Math.min(1, stats.totalRuns / 10);
      
      return {
        label: row.displayLabel,
        values: {
          successRate: successRate,
          speed: speedScore,
          costEfficiency: costEfficiency,
          stability: stability,
          coverage: coverage
        }
      };
    });
    
    // 颜色调色板
    const colors = [
      'rgba(99, 102, 241, 0.3)',   // indigo
      'rgba(16, 185, 129, 0.3)',   // green
      'rgba(245, 158, 11, 0.3)',   // amber
      'rgba(239, 68, 68, 0.3)',    // red
      'rgba(59, 130, 246, 0.3)',   // blue
      'rgba(168, 85, 247, 0.3)'    // purple
    ];
    const borderColors = [
      'rgba(99, 102, 241, 1)',
      'rgba(16, 185, 129, 1)',
      'rgba(245, 158, 11, 1)',
      'rgba(239, 68, 68, 1)',
      'rgba(59, 130, 246, 1)',
      'rgba(168, 85, 247, 1)'
    ];
    
    // 绘制网格
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    
    for (let i = 1; i <= 5; i++) {
      const r = (radius / 5) * i;
      ctx.beginPath();
      for (let j = 0; j <= numDimensions; j++) {
        const angle = j * angleStep - Math.PI / 2;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    
    // 绘制轴线和标签
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillStyle = 'var(--text-secondary)';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    
    dimensions.forEach((dim, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.stroke();
      
      // 标签
      const labelX = centerX + Math.cos(angle) * (radius + 25);
      const labelY = centerY + Math.sin(angle) * (radius + 25);
      ctx.fillText(dim.label, labelX, labelY + 4);
    });
    
    // 绘制每个配置的数据
    chartData.forEach((data, idx) => {
      const color = colors[idx % colors.length];
      const borderColor = borderColors[idx % borderColors.length];
      
      ctx.beginPath();
      dimensions.forEach((dim, i) => {
        const value = data.values[dim.key];
        const r = value * radius;
        const angle = i * angleStep - Math.PI / 2;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    
    // 绘制图例
    const legendY = height - 30;
    const legendStartX = centerX - (chartData.length * 80) / 2;
    
    chartData.forEach((data, idx) => {
      const x = legendStartX + idx * 80;
      ctx.fillStyle = borderColors[idx % borderColors.length];
      ctx.fillRect(x, legendY, 12, 12);
      ctx.fillStyle = 'var(--text-primary)';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'left';
      const displayLabel = data.label.length > 8 ? data.label.slice(0, 8) + '...' : data.label;
      ctx.fillText(displayLabel, x + 16, legendY + 10);
    });
  }

  function renderAgentRadarChart() {
    const canvas = document.getElementById("radar-canvas");
    if (!canvas || !state.crossRunCompareData || state.crossRunCompareData.rows.length === 0) {
      const chartEl = document.getElementById("agent-radar-chart");
      if (chartEl) chartEl.classList.add("hidden");
      return;
    }

    const chartEl = document.getElementById("agent-radar-chart");
    if (chartEl) chartEl.classList.remove("hidden");

    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(centerX, centerY) - 60;

    ctx.clearRect(0, 0, width, height);

    const rows = state.crossRunCompareData.rows.slice(0, 6);
    const metrics = [
      { key: "successRate", label: localText("成功率", "Success"), getValue: (r) => (r.stats.successCount / r.stats.totalRuns) * 100 },
      { key: "avgTokens", label: localText("效率", "Efficiency"), getValue: (r) => Math.max(0, 100 - (Math.round(r.stats.totalTokens / r.stats.totalRuns) / 5000) * 100) },
      { key: "avgDuration", label: localText("速度", "Speed"), getValue: (r) => Math.max(0, 100 - (Math.round(r.stats.totalDurationMs / r.stats.totalRuns) / 60000) * 100) },
      { key: "avgCost", label: localText("成本", "Cost"), getValue: (r) => r.stats.costKnownCount > 0 ? Math.max(0, 100 - (r.stats.totalCost / r.stats.costKnownCount) * 100) : 50 },
      { key: "reliability", label: localText("稳定", "Reliability"), getValue: (r) => (r.stats.successCount / r.stats.totalRuns) * 100 },
    ];

    const angleStep = (Math.PI * 2) / metrics.length;
    const colors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6"];

    // Draw grid
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    for (let level = 1; level <= 4; level++) {
      const radius = (maxRadius * level) / 4;
      ctx.beginPath();
      for (let i = 0; i <= metrics.length; i++) {
        const angle = i * angleStep - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Draw axes
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    for (let i = 0; i < metrics.length; i++) {
      const angle = i * angleStep - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + maxRadius * Math.cos(angle), centerY + maxRadius * Math.sin(angle));
      ctx.stroke();

      // Labels
      const labelRadius = maxRadius + 30;
      const labelX = centerX + labelRadius * Math.cos(angle);
      const labelY = centerY + labelRadius * Math.sin(angle);
      ctx.fillStyle = "var(--text-secondary)";
      ctx.font = "12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(metrics[i].label, labelX, labelY);
    }

    // Draw data polygons
    rows.forEach((row, rowIndex) => {
      const values = metrics.map((m) => m.getValue(row));
      const color = colors[rowIndex % colors.length];

      ctx.beginPath();
      values.forEach((value, i) => {
        const radius = (value / 100) * maxRadius;
        const angle = i * angleStep - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = color + "30";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Data points
      values.forEach((value, i) => {
        const radius = (value / 100) * maxRadius;
        const angle = i * angleStep - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    });

    // Legend
    const legendY = height - 20;
    rows.forEach((row, i) => {
      const legendX = centerX - ((rows.length - 1) * 80) / 2 + i * 80;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(legendX - 8, legendY - 6, 12, 12);
      ctx.fillStyle = "var(--text-secondary)";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(row.displayLabel.substring(0, 10), legendX, legendY + 4);
    });
  }

  return {
    renderCrossRunCompare,
    renderCrossRunSelectionList,
    renderCrossRunCompareTable,
    renderAgentRadarChart
  };
}
