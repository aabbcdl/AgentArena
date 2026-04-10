# Test Monorepo | 标准测试仓库

[English](#english) | [中文](#中文)

---

## English

This is a **standard test repository** for AgentArena benchmarks. It provides a controlled, reproducible environment for fairly comparing different AI coding agents.

### Purpose

- **Fair Comparison**: All agents work on identical codebases
- **Known Complexity**: Calibrated tasks at easy/medium/hard levels
- **Reproducible Results**: Same inputs yield comparable outputs

### Structure

```
packages/
  core/         # Core utilities (getUserData function)
  cli/          # CLI tool (demonstrates cross-package imports)
  runner/       # Task runner (demonstrates cross-package imports)
  shared/       # Shared utilities (target for consolidation)
```

### Built-in Challenges

1. **Multi-file Rename**: `getUserData` function exists in core, imported by cli and runner
2. **Cross-module Refactor**: Duplicate `logger.ts` in cli and runner should be consolidated
3. **Import Chains**: Understanding how packages depend on each other

### Usage

This repository is automatically used when task packs specify:
```yaml
repoSource: "builtin://nodejs-monorepo"
```

---

## 中文

这是 AgentArena 基准测试的**标准测试仓库**。它提供受控、可复现的环境，用于公平对比不同的 AI 编码 agent。

### 目的

- **公平对比**：所有 agent 在相同的代码库上工作
- **已知复杂度**：校准过的简单/中等/困难级别任务
- **可复现结果**：相同输入产生可比较的输出

### 结构

```
packages/
  core/         # 核心工具 (getUserData 函数)
  cli/          # CLI 工具 (演示跨包导入)
  runner/       # 任务运行器 (演示跨包导入)
  shared/       # 共享工具 (合并目标)
```

### 内置挑战

1. **多文件重命名**：`getUserData` 函数在 core 中，被 cli 和 runner 导入
2. **跨模块重构**：cli 和 runner 中重复的 `logger.ts` 应该被合并
3. **导入链**：理解包之间的依赖关系

### 使用方式

当任务包指定以下配置时，自动使用此仓库：
```yaml
repoSource: "builtin://nodejs-monorepo"
```
