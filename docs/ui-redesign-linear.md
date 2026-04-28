# AgentArena web-report UI 改版方案

> 基于 Linear 暗色 Dashboard + VoltAgent 开发者工具设计语言
> 日期：2026-04-17

---

## 一、现状分析

当前 `styles.css` 已有不错的暗色基础：
- ✅ 暗色背景层次 `#09090b` → `#111113` → `#18181b`
- ✅ Inter 字体
- ✅ 8px base spacing
- ✅ 透明边框系统 `rgba(255,255,255,0.06)`
- ✅ 亮色/暗色双主题支持

**与 Linear/VoltAgent 的差距：**

| 维度 | 当前 | Linear 做法 | 差距 |
|------|------|------------|------|
| 品牌色 | Indigo `#6366f1` | Indigo-violet `#5e6ad2` / `#7170ff` | 色相偏暖，可用 |
| 字重 | 400/500/600/700 | 签名 510（Inter Variable） | 缺少微强调档位 |
| 边框 | 单层透明 `rgba(255,255,255,0.06)` | `0.05` ~ `0.08` 分级 | 需细化 |
| 阴影 | 多层黑阴影 | Linear 几乎不用阴影，靠透明度递进 | 需简化 |
| 卡片背景 | `#1c1c1f` | `rgba(255,255,255,0.02)` ~ `0.05` 透明度 | 需切换到透明方案 |
| 背景渐变 | 紫色径向渐变 | 无装饰渐变 | 需去掉 |
| 圆角 | 4px ~ 20px | 6px ~ 8px 为主 | 偏大 |
| 滚动条 | 有自定义样式 | 无自定义（系统默认） | 可去掉 |
| 代码字体 | JetBrains Mono | Geist Mono / SFMono | 可选 |

---

## 二、具体改动清单

### 2.1 CSS 变量调整（`:root` 暗色主题）

```css
/* === 背景层次 — 微调对齐 Linear === */
--bg-primary: #08090a;        /* 原 #09090b，更深一点 */
--bg-secondary: #0f1011;      /* 原 #111113 */
--bg-tertiary: #191a1b;       /* 原 #18181b，略亮 */
--bg-elevated: #1e1f21;       /* 原 #1c1c1f */

/* === Surface — 改用 Linear 透明度方案 === */
--surface: rgba(255, 255, 255, 0.04);         /* 原 #222225 */
--surface-hover: rgba(255, 255, 255, 0.06);   /* 原 #2a2a2e */
--surface-active: rgba(255, 255, 255, 0.08);  /* 原 #323235 */
--surface-selected: rgba(255, 255, 255, 0.10);/* 原 #3a3a3e */

/* === 边框 — 分级细化 === */
--border: rgba(255, 255, 255, 0.06);          /* 不变 */
--border-subtle: rgba(255, 255, 255, 0.04);   /* 不变 */
--border-strong: rgba(255, 255, 255, 0.08);   /* 原 0.1，降低 */

/* === 文本 — 微调色阶 === */
--text-primary: #f7f8f8;      /* 原 #fafafa，Linear 的亮白 */
--text-secondary: #a1a1aa;    /* 不变 */
--text-muted: #71717a;        /* 不变 */

/* === 品牌色 — 二选一 === */
/* 方案 A：保持 indigo（改动小） */
--accent: #6366f1;
/* 方案 B：换成 Linear indigo-violet（改动大但更接近） */
--accent: #5e6ad2;
--accent-light: #7170ff;
--accent-hover: #828fff;

/* === 字重 — 加 510 档 === */
--weight-normal: 400;
--weight-medium: 510;          /* 原 500，Linear 签名字重 */
--weight-semibold: 600;
--weight-bold: 700;
/* 注意：510 需要 Inter Variable 字体才能生效 */

/* === 阴影 — 大幅简化 === */
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.15);
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.2);
--shadow-md: 0 4px 8px rgba(0, 0, 0, 0.25);
/* 删掉 shadow-lg / shadow-xl / shadow-glow — Linear 不用重阴影 */

/* === 圆角 — 缩小 === */
--radius-xs: 4px;
--radius-sm: 6px;
--radius-md: 8px;             /* 原不变，这是主圆角 */
--radius-lg: 10px;            /* 原 12px */
--radius-xl: 12px;            /* 原 16px */
--radius-2xl: 16px;           /* 原 20px */
```

### 2.2 字体升级

```css
/* 升级到 Inter Variable（支持 510 字重） */
@import url('https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300..700&display=swap');

--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

/* Linear 的 OpenType 特性 */
body {
  font-feature-settings: "cv01", "ss03";
  font-variation-settings: "opsz" 14;
}

/* 代码字体 — 可选升级到 Geist Mono */
--font-mono: 'Geist Mono', 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
```

### 2.3 去掉装饰

```css
/* 删掉 body::before 的径向渐变背景 */
body::before {
  display: none;
}

/* 删掉 sidebar 的 backdrop-filter */
.sidebar {
  backdrop-filter: none;  /* Linear 不用毛玻璃 */
}

/* 删掉 brand-icon 的 drop-shadow */
.brand-icon {
  filter: none;
}

/* 删掉 sidebar 自定义滚动条 */
.sidebar::-webkit-scrollbar { /* 去掉全部 */ }
```

### 2.4 卡片系统重写

```css
/* Linear 风格卡片：靠透明度递进分层，不用阴影 */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.card:hover {
  background: var(--surface-hover);
  border-color: var(--border-strong);
}

.card-active {
  background: var(--surface-active);
  border-color: var(--border-active);
}

/* 高亮卡片（如当前选中的 runner） */
.card-highlight {
  background: var(--accent-soft);
  border-color: rgba(94, 106, 210, 0.3);  /* accent-soft-border */
}
```

### 2.5 按钮系统

```css
/* Linear 风格：低透明度背景 + 细边框 */
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  padding: 6px 14px;
  font-weight: var(--weight-medium);  /* 510 */
  transition: background var(--transition-fast);
}

.btn-primary:hover {
  background: var(--accent-light);
}

/* Secondary 按钮 */
.btn-secondary {
  background: var(--surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 6px 14px;
  font-weight: var(--weight-medium);
}

.btn-secondary:hover {
  background: var(--surface-hover);
  border-color: var(--border-strong);
}

/* Ghost 按钮 */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: none;
  border-radius: var(--radius-md);
  padding: 6px 10px;
}

.btn-ghost:hover {
  background: var(--surface);
  color: var(--text-primary);
}
```

### 2.6 表格/排行榜

```css
/* Linear 风格表格：极简边框 + 透明行背景 */
.table {
  width: 100%;
  border-collapse: collapse;
}

.table th {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);  /* 510 */
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

.table tr:hover td {
  background: var(--surface);
}

/* 排名徽章 */
.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
}

.rank-1 { background: rgba(250, 204, 21, 0.15); color: #fbbf24; }
.rank-2 { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
.rank-3 { background: rgba(180, 83, 9, 0.15); color: #d97706; }
```

### 2.7 数据指标卡

```css
/* VoltAgent 风格的暖灰边框给数据卡增加温度 */
.metric-card {
  background: var(--surface);
  border: 1px solid rgba(61, 58, 57, 0.6);  /* VoltAgent 暖灰 #3d3a39 */
  border-radius: var(--radius-md);
  padding: var(--space-5);
}

.metric-value {
  font-size: var(--text-3xl);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  line-height: var(--leading-tight);
}

.metric-label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);  /* 510 */
  color: var(--text-muted);
  margin-top: var(--space-1);
}

.metric-change {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  margin-top: var(--space-2);
}

.metric-change.positive { color: var(--success); }
.metric-change.negative { color: var(--danger); }
```

### 2.8 侧边栏

```css
/* 简化侧边栏，去掉装饰 */
.sidebar {
  padding: var(--space-4) var(--space-3);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  /* 删掉 backdrop-filter */
  /* 删掉 backdrop-filter: blur(...) */
}

/* 导航项 */
.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);  /* 510 */
  transition: all var(--transition-fast);
  cursor: pointer;
}

.nav-item:hover {
  background: var(--surface);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--surface-active);
  color: var(--text-primary);
}
```

### 2.9 标签/Pill

```css
/* Linear 风格 pill 标签 */
.tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}

.tag-success {
  background: var(--success-soft);
  color: var(--success);
}

.tag-warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.tag-danger {
  background: var(--danger-soft);
  color: var(--danger);
}

.tag-default {
  background: var(--surface);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
```

---

## 三、品牌色决策

两个方案：

| | 保持 Indigo `#6366f1` | 换 Linear Violet `#5e6ad2` |
|---|---|---|
| 改动量 | 只调几个变量 | 涉及所有引用 accent 的地方 |
| 视觉差异 | 小，几乎看不出来 | 略偏紫，更有 Linear 味 |
| 识别度 | 已有用户习惯 | 全新品牌印象 |
| 建议 | **推荐先用这个**，稳定后再调 | 如果想完全对标 Linear 再换 |

---

## 四、实施步骤

### Phase 1：变量调整（30 分钟）
1. 替换 `:root` 中的 CSS 变量（背景、表面、边框、阴影、圆角）
2. 删掉 `body::before` 渐变
3. 删掉 sidebar 毛玻璃和自定义滚动条
4. 删掉 brand-icon glow

### Phase 2：字体升级（15 分钟）
1. `index.html` 加 Inter Variable CDN
2. 加 OpenType feature settings
3. 加 510 字重变量

### Phase 3：组件适配（1-2 小时）
1. 卡片类重写（用透明度递进）
2. 按钮重写
3. 表格/排行榜样式
4. 数据指标卡
5. 标签系统

### Phase 4：验证
1. 暗色模式下所有页面检查
2. 亮色模式回退检查（Light theme 变量需同步调整）
3. 移动端响应式检查

---

## 五、参考文件

- `apps/web-report/src/styles.css` — 主样式文件（4410 行）
- `apps/web-report/src/report/dashboard.js` — Dashboard 组件
- `apps/web-report/src/report/detail-fragments.js` — 详情页组件
- `apps/web-report/src/index.html` — 入口 HTML
- 设计参考：`D:\project\design-md\linear.app\DESIGN.md`
- 设计参考：`D:\project\design-md\voltagent\DESIGN.md`
