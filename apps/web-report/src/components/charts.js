/**
 * @fileoverview 图表组件
 * 提供 SVG 条形图和 Canvas 雷达图，用于评分权重可视化
 */

// 色盲友好配色方案（6 个维度）
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

  // 清空画布
  ctx.clearRect(0, 0, width, height);

  // 绘制网格
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
  gridLevels.forEach(level => {
    ctx.beginPath();
    ctx.strokeStyle = 'var(--border)';
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
    ctx.strokeStyle = 'var(--border-subtle)';
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
    ctx.fillStyle = 'var(--text-secondary)';
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
    ctx.strokeStyle = 'var(--bg-primary)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
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

  ctx.clearRect(0, 0, width, height);

  // 绘制网格
  [0.2, 0.4, 0.6, 0.8, 1.0].forEach(level => {
    ctx.beginPath();
    ctx.strokeStyle = 'var(--border)';
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
    ctx.strokeStyle = 'var(--border-subtle)';
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
    ctx.fillStyle = 'var(--text-secondary)';
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
    ctx.fillStyle = 'var(--text-primary)';
    ctx.textAlign = 'left';
    ctx.fillText(dataset.name, x + 12, legendY + 4);
  });
}
