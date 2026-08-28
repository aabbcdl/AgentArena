# Official Task Packs | 官方任务包

This directory contains the first-party task pack library maintained by AgentArena.

<!-- official-taskpacks:start -->

The first-release comparison catalog contains **10** core task packs. 20 historical/experimental packs remain in the repository but are excluded from first-release comparison.

| Task pack | Name | Purpose |
| --- | --- | --- |
| `add-feature-with-tests` | Add a Memoization Helper | Add a small reusable memoization feature and cover its observable contract. |
| `config-repair` | Repair Typed Configuration | Correct a small JSON configuration while preserving unrelated values. |
| `cross-file-refactor` | Extract the Slugify Module | Move a shared string helper into its own module without changing callers. |
| `failing-test-fix` | Fix the Failing Arithmetic Test | Correct one calculator operation while preserving the rest of the arithmetic API. |
| `input-validation` | Restore Input Validation Boundaries | Block script injection and path traversal while preserving useful input errors. |
| `json-contract-repair` | Repair a JSON Response Contract | Restore a deterministic response fixture to its documented shape. |
| `logging-improvement` | Improve Structured Logging | Restore log levels, context propagation, and child logger behavior. |
| `repo-health` | Repair Word Capitalization | Restore word-level capitalization without disturbing neighboring helpers. |
| `snapshot-fix` | Restore Deterministic Snapshot Output | Fix a generator so its stable text output matches the fixture contract. |
| `test-coverage` | Add Focused Validator and Logger Tests | Add meaningful tests for two previously uncovered modules and prove they catch a mutation. |

<!-- official-taskpacks:end -->

## 中文目录

<!-- official-taskpacks-zh:start -->

首发比较目录包含 **10** 个核心任务包；另有 **20** 个历史/实验任务包保留在仓库中，但不进入首发比较。

| 任务包 | 名称 | 用途 |
| --- | --- | --- |
| `add-feature-with-tests` | 添加记忆化工具 | 添加可复用的记忆化功能并覆盖可观察契约。 |
| `config-repair` | 修复类型配置 | 修复一个 JSON 配置，同时保留无关字段。 |
| `cross-file-refactor` | 提取 slugify 模块 | 将共享字符串工具移到独立模块，同时保持调用方行为。 |
| `failing-test-fix` | 修复失败的算术测试 | 修复一个计算器操作，同时保持其他算术 API 不变。 |
| `input-validation` | 恢复输入校验边界 | 阻止脚本注入和路径穿越，同时保留有用的输入错误。 |
| `json-contract-repair` | 修复 JSON 响应契约 | 将确定性的响应数据恢复到文档规定的结构。 |
| `logging-improvement` | 改进结构化日志 | 恢复日志级别、上下文传递和子 logger 行为。 |
| `repo-health` | 修复单词首字母大写 | 修复一个字符串工具回归，同时不影响相邻功能。 |
| `snapshot-fix` | 恢复确定性快照输出 | 修复生成器，使稳定文本输出符合契约。 |
| `test-coverage` | 增加校验和日志测试 | 为两个未覆盖模块增加有意义的测试，并证明测试能抓住变异。 |

<!-- official-taskpacks-zh:end -->

## Retained legacy and experimental packs

These files are retained for manual use, but their fixtures or boundaries are not yet calibrated for first-release comparison.

- `add-error-handling`
- `api-documentation`
- `bug-chain-fix`
- `official-builtin-demo-coding`
- `official-cross-module-refactor`
- `dependency-update`
- `docker-setup`
- `efficiency-first-example`
- `error-handling`
- `go-microservice`
- `issue-resolution-example`
- `iterative-debug`
- `multi-file-rename`
- `official-performance-optimize`
- `python-api`
- `react-bugfix`
- `refactor-with-tests`
- `rotating-tasks-2026-04-example`
- `security-hardening`
- `official-small-refactor`

## Usage | 使用方式

Choose a task pack in Workbench, or pass its path to `agentarena run --task <path>`.
