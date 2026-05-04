/**
 * @fileoverview 图表组件
 * 提供 SVG 条形图、Canvas 雷达图和权重滑块，用于评分可视化
 */

// 色盲友好配色方案（6 个维度）
// 使用亮度递增 + 饱和度差异，确保色弱用户可区分
const CHART_COLORS = [
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
];

const CHART_COLORS_SOFT = [
  'rgba(99, 102, 241, 0.15)',
  'rgba(16, 185, 129, 0.15)',
  'rgba(245, 158, 11, 0.15)',
  'rgba(239, 68, 68, 0.15)',
  'rgba(139, 92, 246, 0.15)',
  'rgba(6, 182, 212, 0.15)',
];

// 用于 SVG pattern 的条纹图案，增强色盲可辨识度
const CHART_PATTERNS = [
  { id: 'pat-solid', d: '' },
  { id: 'pat-diagonal', d: 'M0,10 l10,-10 M-2.5,2.5 l5,-5 M7.5,12.5 l5,-5' },
  { id: 'pat-dots', d: 'M5,5 m-1.5,0 a1.5,1.5 0 1,0 3,0 a1.5,1.5 0 1,0 -3,0' },
  { id: 'pat-hcross', d: 'M0,5 h10 M5,0 v10' },
  { id: 'pat-vlines', d: 'M5,0 v10' },
  { id: 'pat-zigzag', d: 'M0,7.5 L5,2.5 L10,7.5' },
];

/**
 * 检测当前主题是否为暗色
 * @returns {boolean}
 */
function isDarkTheme() {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'dark' ||
    document.documentElement.classList.contains('dark') ||
    (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

/**
 * 渲染 SVG 条形图
 * @param {HTMLElement} container - 容器元素
 * @param {Array} data - 数据数组 [{ group: '方案A', dimensions: [{ name: 'tests', value: 85, weight: 0.25 }, ...] }, ...]
 * @param {Object} options - 配置选项
 */
export function renderBarChart(container, data, options = {}) {
  const {
    width = 600,
    height = 300,
    barHeight = 24,
    gap = 8,
    groupGap = 24,
    labelWidth = 80,
    animation = true
  } = options;

  if (!container || !data || data.length === 0) return;

  // 清空容器
  container.innerHTML = '';

  // 获取所有维度名称
  const dimensions = data[0]?.dimensions?.map(d => d.name) || [];
  const maxValue = 100;

  // 计算图表尺寸
  const chartWidth = width - labelWidth - 40;
  const chartHeight = data.length * dimensions.length * (barHeight + gap) + 
                      data.length * groupGap;

  // 创建 SVG
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(Math.max(height, chartHeight + 40)));
  svg.setAttribute('viewBox', `0 0 ${width} ${Math.max(height, chartHeight + 40)}`);
  svg.style.width = '100%';
  svg.style.height = 'auto';

  let yOffset = 20;

  data.forEach((group, groupIndex) => {
    // 组标题
    const groupTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    groupTitle.setAttribute('x', '10');
    groupTitle.setAttribute('y', String(yOffset));
    groupTitle.setAttribute('font-size', '14');
    groupTitle.setAttribute('font-weight', '600');
    groupTitle.setAttribute('fill', 'var(--text-primary)');
    groupTitle.textContent = group.group;
    svg.appendChild(groupTitle);
    yOffset += 20;

    group.dimensions.forEach((dim, dimIndex) => {
      const color = CHART_COLORS[dimIndex % CHART_COLORS.length];
      const barWidth = (dim.value / maxValue) * chartWidth;

      // 维度标签
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', '10');
      label.setAttribute('y', String(yOffset + barHeight / 2 + 4));
      label.setAttribute('font-size', '12');
      label.setAttribute('fill', 'var(--text-secondary)');
      label.textContent = dim.name;
      svg.appendChild(label);

      // 背景条
      const bgBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgBar.setAttribute('x', String(labelWidth));
      bgBar.setAttribute('y', String(yOffset));
      bgBar.setAttribute('width', String(chartWidth));
      bgBar.setAttribute('height', String(barHeight));
      bgBar.setAttribute('rx', '4');
      bgBar.setAttribute('fill', 'var(--surface)');
      svg.appendChild(bgBar);

      // 数值条
      const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bar.setAttribute('x', String(labelWidth));
      bar.setAttribute('y', String(yOffset));
      bar.setAttribute('width', String(animation ? 0 : barWidth));
      bar.setAttribute('height', String(barHeight));
      bar.setAttribute('rx', '4');
      bar.setAttribute('fill', color);
      bar.setAttribute('opacity', '0.85');
      svg.appendChild(bar);

      // 动画
      if (animation) {
        setTimeout(() => {
          bar.style.transition = 'width 0.5s ease';
          bar.setAttribute('width', String(barWidth));
        }, (groupIndex * dimensions.length + dimIndex) * 50);
      }

      // 数值文本
      const valueText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      valueText.setAttribute('x', String(labelWidth + barWidth + 8));
      valueText.setAttribute('y', String(yOffset + barHeight / 2 + 4));
      valueText.setAttribute('font-size', '12');
      valueText.setAttribute('font-weight', '500');
      valueText.setAttribute('fill', 'var(--text-primary)');
      valueText.textContent = `${dim.value.toFixed(1)}`;
      svg.appendChild(valueText);

      // 权重提示（悬停显示）
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${dim.name}: ${dim.value.toFixed(1)} (权重: ${(dim.weight * 100).toFixed(0)}%)`;
      bar.appendChild(title);

      yOffset += barHeight + gap;
    });

    yOffset += groupGap;
  });

  container.appendChild(svg);
}

/**
 * 渲染多 Agent 评分维度对比条形图
 * 每个 agent 一组，每组 N 根条形对应 N 个评分维度
 * 同维度同色，跨 agent 对比
 *
 * @param {HTMLElement} container - 容器元素
 * @param {Array} agents - agent 数据数组
 *   [{ label: 'Agent A', dimensions: [{ key: 'tests', name: 'Tests', value: 85, max: 100, weight: 0.25 }, ...] }, ...]
 * @param {Array} dimensions - 维度信息数组（可选，如果 agents 内已有则忽略）
 *   [{ key: 'tests', name: 'Tests', weight: 0.25 }, ...]
 * @param {Object} options - 配置选项
 */
export function renderComparisonBarChart(container, agents, dimensions, options = {}) {
  const {
    width = 640,
    barHeight = 18,
    gap = 4,
    groupGap = 32,
    labelWidth = 100,
    animation = true,
    title
  } = options;

  if (!container || !agents || agents.length === 0) return;

  container.innerHTML = '';

  // 提取维度列表
  const dims = dimensions || agents[0]?.dimensions?.map(d => ({ key: d.key || d.name, name: d.name, weight: d.weight })) || [];
  const dimCount = dims.length;
  if (dimCount === 0) return;

  const maxBarWidth = width - labelWidth - 80;
  const groupHeight = dimCount * (barHeight + gap) + 8;
  const totalHeight = agents.length * (groupHeight + groupGap) + 40;
  const dark = isDarkTheme();

  // 创建 SVG
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(totalHeight));
  svg.setAttribute('viewBox', `0 0 ${width} ${totalHeight}`);
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.overflow = 'visible';

  // 定义 pattern（色盲辅助）
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  CHART_PATTERNS.forEach((pat, _i) => {
    if (!pat.d) return;
    const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
    pattern.setAttribute('id', pat.id);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', '10');
    pattern.setAttribute('height', '10');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pat.d);
    path.setAttribute('stroke', dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)');
    path.setAttribute('stroke-width', '1');
    path.setAttribute('fill', 'none');
    pattern.appendChild(path);
    defs.appendChild(pattern);
  });
  svg.appendChild(defs);

  // 标题
  let yOffset = 24;
  if (title) {
    const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    titleEl.setAttribute('x', '10');
    titleEl.setAttribute('y', String(yOffset));
    titleEl.setAttribute('font-size', '14');
    titleEl.setAttribute('font-weight', '600');
    titleEl.setAttribute('fill', dark ? '#e2e8f0' : '#1e293b');
    titleEl.textContent = title;
    svg.appendChild(titleEl);
    yOffset += 24;
  }

  // 绘制每组 agent
  agents.forEach((agent, gi) => {
    // 组标题
    const groupTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    groupTitle.setAttribute('x', '10');
    groupTitle.setAttribute('y', String(yOffset + 4));
    groupTitle.setAttribute('font-size', '13');
    groupTitle.setAttribute('font-weight', '600');
    groupTitle.setAttribute('fill', dark ? '#e2e8f0' : '#1e293b');
    groupTitle.textContent = agent.label;
    svg.appendChild(groupTitle);
    yOffset += 18;

    agent.dimensions.forEach((dim, di) => {
      const dimInfo = dims[di];
      const color = CHART_COLORS[di % CHART_COLORS.length];
      const patternId = CHART_PATTERNS[di % CHART_PATTERNS.length].id;
      const max = dim.max || 100;
      const pct = Math.min(dim.value / max, 1);
      const barW = pct * maxBarWidth;

      // 维度标签
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', '10');
      label.setAttribute('y', String(yOffset + barHeight / 2 + 4));
      label.setAttribute('font-size', '11');
      label.setAttribute('fill', dark ? '#94a3b8' : '#64748b');
      label.textContent = dimInfo?.name || dim.name;
      svg.appendChild(label);

      // 背景轨道
      const track = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      track.setAttribute('x', String(labelWidth));
      track.setAttribute('y', String(yOffset));
      track.setAttribute('width', String(maxBarWidth));
      track.setAttribute('height', String(barHeight));
      track.setAttribute('rx', '3');
      track.setAttribute('fill', dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)');
      svg.appendChild(track);

      // 主条形
      const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bar.setAttribute('x', String(labelWidth));
      bar.setAttribute('y', String(yOffset));
      bar.setAttribute('width', String(animation ? 0 : barW));
      bar.setAttribute('height', String(barHeight));
      bar.setAttribute('rx', '3');
      bar.setAttribute('fill', color);
      bar.setAttribute('opacity', '0.85');
      svg.appendChild(bar);

      // 条纹覆盖层（色盲辅助）
      if (patternId !== 'pat-solid' && barW > 4) {
        const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        overlay.setAttribute('x', String(labelWidth));
        overlay.setAttribute('y', String(yOffset));
        overlay.setAttribute('width', String(animation ? 0 : barW));
        overlay.setAttribute('height', String(barHeight));
        overlay.setAttribute('rx', '3');
        overlay.setAttribute('fill', `url(#${patternId})`);
        overlay.setAttribute('opacity', '0.4');
        svg.appendChild(overlay);

        if (animation) {
          setTimeout(() => {
            overlay.style.transition = 'width 0.5s ease';
            overlay.setAttribute('width', String(barW));
          }, (gi * dimCount + di) * 40 + 50);
        }
      }

      // 动画
      if (animation) {
        setTimeout(() => {
          bar.style.transition = 'width 0.5s ease';
          bar.setAttribute('width', String(barW));
        }, (gi * dimCount + di) * 40);
      }

      // 数值文本
      const valueText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      valueText.setAttribute('x', String(labelWidth + barW + 8));
      valueText.setAttribute('y', String(yOffset + barHeight / 2 + 4));
      valueText.setAttribute('font-size', '11');
      valueText.setAttribute('font-weight', '500');
      valueText.setAttribute('fill', dark ? '#cbd5e1' : '#334155');
      valueText.textContent = `${dim.value.toFixed(1)}/${max}`;
      svg.appendChild(valueText);

      // Tooltip
      const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      const w = dimInfo?.weight ?? dim.weight;
      titleEl.textContent = w != null
        ? `${dimInfo?.name || dim.name}: ${dim.value.toFixed(1)}/${max} (${(pct * 100).toFixed(0)}%) · 权重 ${(w * 100).toFixed(0)}%`
        : `${dimInfo?.name || dim.name}: ${dim.value.toFixed(1)}/${max} (${(pct * 100).toFixed(0)}%)`;
      bar.appendChild(titleEl);

      yOffset += barHeight + gap;
    });

    yOffset += groupGap;
  });

  // 图例
  const legendY = yOffset;
  dims.forEach((dim, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const x = 10 + i * (width / dimCount);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(legendY));
    rect.setAttribute('width', '12');
    rect.setAttribute('height', '12');
    rect.setAttribute('rx', '2');
    rect.setAttribute('fill', color);
    svg.appendChild(rect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(x + 16));
    text.setAttribute('y', String(legendY + 10));
    text.setAttribute('font-size', '11');
    text.setAttribute('fill', dark ? '#94a3b8' : '#64748b');
    text.textContent = dim.name;
    svg.appendChild(text);
  });

  container.appendChild(svg);

  // 响应 resize
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    if (w > 0 && w !== width) {
      // 重绘以适配新宽度
      renderComparisonBarChart(container, agents, dimensions, { ...options, width: w, animation: false });
    }
  });
  ro.observe(container);
  container._chartResizeObserver = ro;
}

/**
 * 渲染 Canvas 雷达图
 * @param {HTMLCanvasElement} canvas - Canvas 元素
 * @param {Object} data - 数据 { dimensions: [{ name: 'tests', value: 85 }, ...] }
 * @param {Object} options - 配置选项
 */
export function renderRadarChart(canvas, data, options = {}) {
  const {
    width = 300,
    height = 300,
    padding = 40
  } = options;

  if (!canvas || !data?.dimensions) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  
  // 设置 Canvas 尺寸（处理 DPI 缩放）
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - padding;
  const dimensions = data.dimensions;
  const angleStep = (Math.PI * 2) / dimensions.length;
  const dark = isDarkTheme();

  // 清空画布
  ctx.clearRect(0, 0, width, height);

  // 绘制网格
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
  gridLevels.forEach(level => {
    ctx.beginPath();
    ctx.strokeStyle = dark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1;
    
    for (let i = 0; i < dimensions.length; i++) {
      const angle = i * angleStep - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius * level;
      const y = centerY + Math.sin(angle) * radius * level;
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  });

  // 绘制轴线
  dimensions.forEach((_, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    
    ctx.beginPath();
    ctx.strokeStyle = dark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    ctx.lineWidth = 1;
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x, y);
    ctx.stroke();
  });

  // 绘制维度标签
  dimensions.forEach((dim, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const labelRadius = radius + 20;
    const x = centerX + Math.cos(angle) * labelRadius;
    const y = centerY + Math.sin(angle) * labelRadius;
    
    ctx.font = '12px sans-serif';
    ctx.fillStyle = dark ? '#94a3b8' : '#64748b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(dim.name, x, y);
  });

  // 绘制数据多边形
  ctx.beginPath();
  dimensions.forEach((dim, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const value = Math.min(dim.value / 100, 1);
    const x = centerX + Math.cos(angle) * radius * value;
    const y = centerY + Math.sin(angle) * radius * value;
    
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  
  ctx.fillStyle = CHART_COLORS_SOFT[0];
  ctx.fill();
  ctx.strokeStyle = CHART_COLORS[0];
  ctx.lineWidth = 2;
  ctx.stroke();

  // 绘制数据点
  dimensions.forEach((dim, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const value = Math.min(dim.value / 100, 1);
    const x = centerX + Math.cos(angle) * radius * value;
    const y = centerY + Math.sin(angle) * radius * value;
    
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = CHART_COLORS[0];
    ctx.fill();
    ctx.strokeStyle = dark ? '#0f172a' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // 响应 resize
  if (!canvas._radarResizeBound) {
    canvas._radarResizeBound = true;
    const parent = canvas.parentElement;
    if (parent) {
      const ro = new ResizeObserver(() => {
        const w = parent.clientWidth;
        if (w > 0 && w !== width) {
          renderRadarChart(canvas, data, { ...options, width: Math.min(w, 500), height: Math.min(w, 500) });
        }
      });
      ro.observe(parent);
      canvas._chartResizeObserver = ro;
    }
  }
}

/**
 * 渲染多方案对比雷达图
 * @param {HTMLCanvasElement} canvas - Canvas 元素
 * @param {Array} datasets - 多个方案数据 [{ name: '方案A', dimensions: [...] }, ...]
 * @param {Object} options - 配置选项
 */
export function renderMultiRadarChart(canvas, datasets, options = {}) {
  const {
    width = 400,
    height = 400,
    padding = 50
  } = options;

  if (!canvas || !datasets || datasets.length === 0) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - padding;
  const dimensions = datasets[0]?.dimensions || [];
  const angleStep = (Math.PI * 2) / dimensions.length;
  const dark = isDarkTheme();

  ctx.clearRect(0, 0, width, height);

  // 绘制网格
  [0.2, 0.4, 0.6, 0.8, 1.0].forEach(level => {
    ctx.beginPath();
    ctx.strokeStyle = dark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1;
    
    for (let i = 0; i < dimensions.length; i++) {
      const angle = i * angleStep - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius * level;
      const y = centerY + Math.sin(angle) * radius * level;
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  });

  // 绘制轴线
  dimensions.forEach((_, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    
    ctx.beginPath();
    ctx.strokeStyle = dark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x, y);
    ctx.stroke();
  });

  // 绘制维度标签
  dimensions.forEach((dim, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const labelRadius = radius + 25;
    const x = centerX + Math.cos(angle) * labelRadius;
    const y = centerY + Math.sin(angle) * labelRadius;
    
    ctx.font = '11px sans-serif';
    ctx.fillStyle = dark ? '#94a3b8' : '#64748b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(dim.name, x, y);
  });

  // 绘制每个方案
  datasets.forEach((dataset, datasetIndex) => {
    const color = CHART_COLORS[datasetIndex % CHART_COLORS.length];
    const softColor = CHART_COLORS_SOFT[datasetIndex % CHART_COLORS_SOFT.length];

    ctx.beginPath();
    dataset.dimensions.forEach((dim, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const value = Math.min(dim.value / 100, 1);
      const x = centerX + Math.cos(angle) * radius * value;
      const y = centerY + Math.sin(angle) * radius * value;
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    
    ctx.fillStyle = softColor;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // 绘制图例
  const legendY = height - 20;
  datasets.forEach((dataset, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const x = 20 + i * 100;
    
    ctx.beginPath();
    ctx.arc(x, legendY, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    
    ctx.font = '12px sans-serif';
    ctx.fillStyle = dark ? '#e2e8f0' : '#1e293b';
    ctx.textAlign = 'left';
    ctx.fillText(dataset.name, x + 12, legendY + 4);
  });

  // 响应 resize
  if (!canvas._multiRadarResizeBound) {
    canvas._multiRadarResizeBound = true;
    const parent = canvas.parentElement;
    if (parent) {
      const ro = new ResizeObserver(() => {
        const w = parent.clientWidth;
        if (w > 0 && w !== width) {
          renderMultiRadarChart(canvas, datasets, { ...options, width: Math.min(w, 600), height: Math.min(w, 600) });
        }
      });
      ro.observe(parent);
      canvas._chartResizeObserver = ro;
    }
  }
}

/**
 * 权重滑块组件
 * 6 个 input[type=range] 对应评分维度，实时回调触发分数重算
 *
 * @param {HTMLElement} container - 容器元素
 * @param {Record<string, number>} currentWeights - 当前权重 { status: 0.24, tests: 0.26, ... }
 * @param {function} onChange - 权重变化回调 (newWeights) => void
 * @param {Object} options - 配置
 */
export function renderWeightSliders(container, currentWeights, onChange, options = {}) {
  const {
    labelMap = {},
    showTotal = true,
    step = 1
  } = options;

  if (!container || !currentWeights) return;

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'weight-sliders-wrapper';
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.gap = '8px';

  const weights = { ...currentWeights };

  function getTotal() {
    return Object.values(weights).reduce((s, v) => s + v, 0);
  }

  function renderSliders() {
    wrapper.innerHTML = '';

    for (const [key, value] of Object.entries(weights)) {
      if (value === 0 && !Object.hasOwn(currentWeights, key)) continue;

      const row = document.createElement('div');
      row.className = 'weight-slider-row';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';

      const label = document.createElement('label');
      label.style.minWidth = '120px';
      label.style.fontSize = '13px';
      const displayName = labelMap[key] || key;
      const pct = (value * 100).toFixed(0);
      label.innerHTML = `<span>${displayName}</span> <span class="weight-value" style="font-weight:600;min-width:36px;text-align:right;display:inline-block">${pct}%</span>`;

      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = String(step);
      input.value = pct;
      input.style.flex = '1';
      input.dataset.weight = key;

      input.addEventListener('input', () => {
        const newPct = parseInt(input.value, 10);
        weights[key] = newPct / 100;
        label.querySelector('.weight-value').textContent = `${newPct}%`;

        if (showTotal) {
          updateTotalDisplay();
        }

        onChange?.({ ...weights });
      });

      row.appendChild(label);
      row.appendChild(input);
      wrapper.appendChild(row);
    }

    if (showTotal) {
      const totalRow = document.createElement('div');
      totalRow.className = 'weight-total-row';
      totalRow.style.display = 'flex';
      totalRow.style.justifyContent = 'space-between';
      totalRow.style.padding = '4px 0';
      totalRow.style.borderTop = '1px solid var(--border, #e2e8f0)';
      totalRow.style.fontSize = '13px';
      totalRow.style.fontWeight = '500';
      totalRow.innerHTML = `<span>总权重</span><span class="weight-total-value">${(getTotal() * 100).toFixed(0)}%</span>`;
      wrapper.appendChild(totalRow);
    }

    container.appendChild(wrapper);
  }

  function updateTotalDisplay() {
    const totalEl = wrapper.querySelector('.weight-total-value');
    if (totalEl) {
      const total = getTotal();
      totalEl.textContent = `${(total * 100).toFixed(0)}%`;
      totalEl.style.color = Math.abs(total - 1) > 0.02 ? '#ef4444' : '';
    }
  }

  renderSliders();

  // 返回更新方法
  return {
    update(newWeights) {
      Object.assign(weights, newWeights);
      renderSliders();
    },
    getWeights() {
      return { ...weights };
    }
  };
}
