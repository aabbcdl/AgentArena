# Official Task Packs | 官方任务包

[English](#english) | [中文](#中文)

---

## English

This directory contains the first-party task pack library maintained by RepoArena.

### Difficulty Levels | 难度分级

| Level | Name | Description | Tests What |
|-------|------|-------------|------------|
| 🟢 Easy | Basic | Single-file, straightforward tasks | Basic code generation, syntax correctness |
| 🟡 Medium | Intermediate | Multi-file coordination, understanding | Module comprehension, import handling |
| 🔴 Hard | Advanced | Cross-module refactoring, complex reasoning | Architecture understanding, tool usage, security |

### Included Packs | 任务包列表

#### 🟢 Easy (Basic)

| Pack | Purpose | What It Tests | Differentiator |
|------|---------|---------------|----------------|
| `repo-health.yaml` | Basic repository maintenance | Can agent make small improvements without breaking structure? | Baseline - all agents should pass |
| `config-repair.yaml` | Fix broken JSON configuration | Can agent repair structured config without introducing errors? | JSON syntax understanding, schema awareness |
| `snapshot-fix.yaml` | Align output with expected snapshot | Can agent match exact output format? | Precision, attention to detail |

#### 🟡 Medium (Intermediate)

| Pack | Purpose | What It Tests | Differentiator |
|------|---------|---------------|----------------|
| `failing-test-fix.yaml` | Debug and fix failing tests | Can agent identify root cause and fix without breaking other tests? | Debugging, test understanding, isolation |
| `json-contract-repair.yaml` | Fix API contract violations | Can agent satisfy both schema and value constraints? | API understanding, constraint satisfaction |
| `small-refactor.yaml` | Perform maintainability refactoring | Can agent improve code without changing behavior? | Refactoring discipline, preservation |

#### 🔴 Hard (Advanced)

| Pack | Purpose | What It Tests | Differentiator |
|------|---------|---------------|----------------|
| `multi-file-rename.yaml` | Rename symbol across multiple files | Can agent coordinate changes across files? | Cross-file coordination, import updates |
| `cross-module-refactor.yaml` | Refactor across module boundaries | Can agent understand module dependencies? | Architecture comprehension, dependency analysis |
| `performance-optimize.yaml` | Optimize code for performance | Can agent identify and fix performance issues? | Performance profiling, optimization strategies |

### How to Choose | 如何选择

**Quick baseline check (快速基线检查):**
```bash
--task repo-health.yaml
```
Use this to verify agent can run in your repository.

**Debugging capability (调试能力):**
```bash
--task failing-test-fix.yaml
```
Tests if agent can read errors, locate issues, and fix them.

**Real-world complexity (真实复杂度):**
```bash
--task multi-file-rename.yaml,cross-module-refactor.yaml
```
Tests multi-file coordination - this is where agents differ most.

**Full evaluation (完整评估):**
```bash
--task repo-health.yaml,failing-test-fix.yaml,multi-file-rename.yaml,cross-module-refactor.yaml
```
Recommended for comparing multiple agents.

### Design Rules | 设计规则

- Every official task pack includes metadata describing purpose, repo types, dependencies, and judge rationale.
- Official packs should favor a small number of interpretable judges over large opaque command chains.
- Official packs are intended to be loaded directly or copied into repository-specific variants.
- Each pack has a clear **differentiator** - what skill difference it can reveal between agents.

---

## 中文

本目录包含由 RepoArena 维护的官方任务包库。

### 难度分级

| 等级 | 名称 | 描述 | 测试内容 |
|------|------|------|---------|
| 🟢 简单 | 基础 | 单文件、直观任务 | 基础代码生成、语法正确性 |
| 🟡 中等 | 进阶 | 多文件协调、理解能力 | 模块理解、导入处理 |
| 🔴 困难 | 高级 | 跨模块重构、复杂推理 | 架构理解、工具使用、安全性 |

### 任务包详情

#### 🟢 简单（基础级）

| 任务包 | 用途 | 测试能力 | 区分度 |
|--------|------|---------|--------|
| `repo-health.yaml` | 基础仓库维护 | Agent 能否在不破坏结构的情况下做小改进？ | 基线测试 - 所有 agent 都应通过 |
| `config-repair.yaml` | 修复损坏的 JSON 配置 | Agent 能否修复结构化配置且不引入错误？ | JSON 语法理解、schema 意识 |
| `snapshot-fix.yaml` | 对齐输出快照 | Agent 能否精确匹配输出格式？ | 精确度、细节关注 |

#### 🟡 中等（进阶级）

| 任务包 | 用途 | 测试能力 | 区分度 |
|--------|------|---------|--------|
| `failing-test-fix.yaml` | 调试并修复失败测试 | Agent 能否定位根因并修复且不破坏其他测试？ | 调试能力、测试理解、问题隔离 |
| `json-contract-repair.yaml` | 修复 API 契约违规 | Agent 能否同时满足 schema 和值约束？ | API 理解、约束满足能力 |
| `small-refactor.yaml` | 执行可维护性重构 | Agent 能否在不改变行为的前提下改进代码？ | 重构纪律、行为保持 |

#### 🔴 困难（高级）

| 任务包 | 用途 | 测试能力 | 区分度 |
|--------|------|---------|--------|
| `multi-file-rename.yaml` | 跨多文件重命名符号 | Agent 能否协调多文件变更？ | 跨文件协调、导入更新 |
| `cross-module-refactor.yaml` | 跨模块边界重构 | Agent 能否理解模块依赖关系？ | 架构理解、依赖分析 |
| `performance-optimize.yaml` | 性能优化 | Agent 能否识别并修复性能问题？ | 性能分析、优化策略 |

### 如何选择任务包

**快速基线检查：**
```bash
--task repo-health.yaml
```
验证 agent 能否在你的仓库中运行。

**调试能力测试：**
```bash
--task failing-test-fix.yaml
```
测试 agent 是否能阅读错误、定位问题并修复。

**真实复杂度测试：**
```bash
--task multi-file-rename.yaml,cross-module-refactor.yaml
```
测试多文件协调能力 - 这是 agent 差异最明显的地方。

**完整评估：**
```bash
--task repo-health.yaml,failing-test-fix.yaml,multi-file-rename.yaml,cross-module-refactor.yaml
```
推荐用于比较多个 agent。

### Agent 能力差异对照表

| 场景 | 简单 Agent | 优秀 Agent | 差异表现 |
|------|-----------|-----------|---------|
| 单文件修改 | ✅ 通过 | ✅ 通过 | 无差异 |
| 测试修复 | ⚠️ 可能破坏其他测试 | ✅ 隔离修复 | 理解深度 |
| 多文件重命名 | ❌ 漏改/错改 | ✅ 完整协调 | 跨文件能力 |
| 跨模块重构 | ❌ 无法理解依赖 | ✅ 正确处理 | 架构理解 |
| 性能优化 | ⚠️ 可能引入 bug | ✅ 安全优化 | 安全意识 |

### 推荐评估流程

1. **筛选阶段**：用简单任务过滤明显不合格的 agent
2. **能力评估**：用中等任务评估核心能力
3. **差异对比**：用困难任务区分优秀 agent
4. **综合报告**：生成对比报告，查看各维度得分