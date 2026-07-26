# AgentArena

> 用同一个仓库、同一个任务、同一套 judges，评估你本地已经在用的 coding agents。

[English README](./README.md)

![AgentArena launcher](./docs/images/web-report-launcher.jpg)
![AgentArena report](./docs/images/web-report-report.jpg)

AgentArena 不是教你“怎么开始装 agent”的工具，而是帮已经在深度使用 coding agent 的人回答这些问题：

- 我现在本地这套 `Codex CLI + 某个模型`，大概是什么能力水平？
- `Claude Code`、`Cursor`、`Gemini CLI` 到底谁更适合我自己的真实仓库任务？
- 如果我只想跑一个 agent，怎么把它变成可重复、可对比的能力基线？
- 如果结果看起来不对，怎么继续看 diff、judge 失败和 trace，而不是只盯着一个分数？

AgentArena 默认是本地优先。你提供自己的仓库、任务包和本地已经装好的 agent CLI，AgentArena 负责统一执行、judge、trace 和报告输出。

本地 Web UI 的绑定地址、鉴权规则，以及 `doctor` / `preflight` 的结果怎么解读，见 **[docs/ui-and-adapters.md](./docs/ui-and-adapters.md)**。量化测试覆盖率可在仓库根目录执行：`pnpm test:coverage`（基于 Node `--experimental-test-coverage`）。

## 60 秒体验

不需要安装任何 agent CLI，clone 下来就能跑：

```bash
git clone https://github.com/aabbcdl/AgentArena.git
cd AgentArena
pnpm install
pnpm build

# 用内置 demo agent 跑一次 benchmark（不需要任何认证）
node packages/cli/dist/index.js run \
  --repo . \
  --task examples/taskpacks/demo-repo-health.json \
  --agents demo-fast,demo-thorough,demo-budget

# 在浏览器里查看结果
node packages/cli/dist/index.js ui
```

打开 `http://127.0.0.1:4320`，加载 `.agentarena/runs/` 下的结果，即可看到完整的 dashboard。

等你想测真正的 agent 时，装好对应的 CLI 就行：

```bash
node packages/cli/dist/index.js run \
  --repo . \
  --task examples/taskpacks/official/repo-health.yaml \
  --agents codex,claude-code,cursor \
  --probe-auth
```

## 和其他 Benchmark 的区别

| | SWE-bench | HumanEval | BigCodeBench | **AgentArena** |
|---|---|---|---|---|
| 本地运行 | ❌ 云端 | ❌ 云端 | ❌ 云端 | **✅ 完全本地** |
| 测自己的仓库 | ❌ 固定仓库 | ❌ 合成数据 | ❌ 合成数据 | **✅ 任意仓库** |
| 自定义任务 | ❌ | ❌ | ❌ | **✅ YAML/JSON 任务包** |
| 支持任意 agent | ❌ 仅 SWE-agent | ❌ | ❌ | **✅ 12+ 适配器** |
| 离线可用 | ❌ | ❌ | ❌ | **✅ 无需联网** |
| 内置 UI | ❌ | ❌ | ❌ | **✅ Web 仪表盘** |
| CI 集成 | ❌ | ❌ | ❌ | **✅ GitHub Actions** |
| Diff + Trace | ❌ | ❌ | ❌ | **✅ 完整审计链路** |

AgentArena 不是 SWE-bench 的替代品。它填补的是另一个空白：**在你自己的代码库上，本地、可重复、agent 无关的基准测试**。

## 它最适合谁

- 已经在日常开发里使用 coding agent 的人
- 想比较多个本地 agent / model / provider 组合的人
- 想给团队建立内部基线的人
- 想持续跟踪“同一个 agent 现在到底强不强”的人

## 即使只跑一个 agent，也有价值

单 agent 跑分也不是“只有一个分数”。

你会得到：

- 共享 judge 下的通过 / 失败情况
- 改动文件和改动范围
- 耗时、token、成本（如果 adapter 支持）
- trace 与回放线索
- 后续同任务反复跑时的历史对比基线

也就是说，就算你只测自己最常用的一个 agent，它也能变成“这个 agent 当前能力水平”的近似基线。

## 快速开始

### 路线 A：直接评估你已经在本地用的 agent

```bash
pnpm install
pnpm build
pnpm doctor
node packages/cli/dist/index.js ui
```

然后打开终端打印出来的本地地址，通常是：

```text
http://127.0.0.1:4320
```

在页面里：

1. 选择仓库
2. 选择任务包
3. 选择你已经在本地使用的 agent
4. 发起 benchmark
5. 在同一页面里看结论、对比和失败定位

### 路线 B：先给单个 agent 跑一个基线

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents codex --output .agentarena/manual-run
```

这条路径最适合回答“我当前这套 Codex 配置大概处于什么水平”。

### 路线 C：同任务对比多个本地 agent

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents codex,claude-code,cursor --output .agentarena/manual-run
```

### 路线 D：不碰外部登录，先看产品流程

```bash
pnpm demo
node packages/cli/dist/index.js ui
```

如果你只想先确认产品流程和结果页长什么样，用内置 demo adapters 就够了。

## 当前能力

### 核心入口

- `agentarena ui`（默认打开 Workbench；历史链接和旧版能力保留在 `/legacy/`）
- `agentarena run`
- `agentarena doctor`
- `agentarena list-adapters`
- `agentarena init-taskpack`
- `agentarena init-ci`

### 当前可靠性重点

当前暂停新增 adapter，近期优先把现有 adapter、结果可信度和 Workbench 主流程做稳。详见 [产品方向](./docs/product-direction.md)。

### 每次运行可输出

- `summary.json`
- `summary.md`
- `report.html`
- `pr-comment.md`
- `badge.json`

### 已内置的 judge 类型

- `command`
- `test-result`
- `lint-check`
- `file-exists`
- `file-contains`
- `regex-match`
- `directory-exists`
- `compilation`
- `glob`
- `file-count`
- `snapshot`
- `json-value`
- `json-schema`
- `patch-validation`
- `token-efficiency`

### 当前 adapter 覆盖

| Adapter | 分级 | 说明 |
| --- | --- | --- |
| `codex` | supported | 支持模型与推理强度配置 |
| `claude-code` | experimental | 带鉴权感知报错 |
| `cursor` | experimental | 本地桥接，受登录态影响 |
| `gemini-cli` | experimental | 支持 token / cost 解析 |
| `aider` | experimental | 多模型支持 |
| `copilot` | experimental | token 估算 |
| `qwen-code` | experimental | JSON 输出解析 |
| `kilo-cli` | experimental | 基于 OpenCode |
| `opencode` | experimental | 开源多 provider CLI |
| `trae` | experimental | 事件流解析 |
| `augment` | experimental | 多模型支持 |
| `windsurf` | blocked | 鉴权稳定性问题 |
| `demo-fast` / `demo-thorough` / `demo-budget` | supported | 内置，不依赖外部登录 |

> **分级说明**：`supported` = 已验证的标准集成路径；`experimental` = 可用，但对本地登录态、CLI 参数变更或安装布局敏感；`blocked` = 当前不作为稳定自动化处理。完整能力矩阵见 [Adapter 能力矩阵](./docs/adapter-capabilities.md)。

## 为什么结果更可信

AgentArena 默认坚持这些前提：

- 同一个仓库快照
- 同一个任务定义
- 同一套 setup 命令
- 同一套 judges
- 先做 readiness / auth 检查
- 每个 run 使用隔离 workspace
- 执行后统一输出报告

如果某个 adapter 因为没登录或本地环境坏掉无法可信运行，`agentarena doctor` 应该先告诉你，而不是让你带着假结果继续比。

## 常用命令

检查本地 adapter 就绪情况：

```bash
pnpm doctor
```

列出 adapter 与能力信息：

```bash
node packages/cli/dist/index.js list-adapters --json
```

如果指定 agent 有一个没准备好就直接失败：

```bash
node packages/cli/dist/index.js doctor --agents codex,claude-code,cursor --probe-auth --strict
```

输出机器可读结果：

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents codex --json
```

生成任务包模板：

```bash
node packages/cli/dist/index.js init-taskpack --template repo-health --output agentarena.taskpack.yaml
```

生成 GitHub Actions benchmark 工作流：

```bash
node packages/cli/dist/index.js init-ci --task agentarena.taskpack.yaml --agents codex,claude-code
```

运行浏览器级 web-report 烟测：

```bash
npx playwright install --with-deps chromium
pnpm test:web-report:e2e
```

## 官方任务包库

<!-- official-taskpacks:start -->

当前共有 **30** 个官方任务包。以下目录直接由任务包文件生成。

| 任务包 | 名称 | 用途 |
| --- | --- | --- |
| `add-error-handling` | 添加缓存验证 | 为缓存函数添加输入验证和错误处理。 |
| `add-feature-with-tests` | 添加功能并补充测试 | 为函数添加记忆化功能，并为它编写测试。 |
| `api-documentation` | API 文档 | 为 API 模块编写文档。 |
| `bug-chain-fix` | 链式 Bug 修复 | 修复分布在 3 个文件中、彼此依赖的 3 个相关 bug。 |
| `official-builtin-demo-coding` | 内置演示：添加错误处理 | 开箱即用的编码任务——不需要本地项目。 使用内置测试仓库（4 个 TypeScript 包）。 Agent 需要为服务函数添加正确的错误处理。 |
| `official-config-repair` | 配置修复 | 修复损坏的配置文件以匹配其 schema。 |
| `cross-file-refactor` | 跨文件重构 | 将函数移到新模块，并更新所有引用。 |
| `official-cross-module-refactor` | 跨模块重构 | 重构一个跨越多个模块/包的功能。 |
| `dependency-update` | 增强日志器 | 为日志器添加级别和上下文支持。 |
| `docker-setup` | Docker 配置 | 创建或改进 Docker 配置 |
| `efficiency-first-example` | 效率优先示例（CursorBench 风格） | 以 token 效率为核心评估编码代理 |
| `error-handling` | 创建错误类 | 创建自定义错误类层次，并添加输入验证。 |
| `failing-test-fix` | 修复失败测试 | 通过修正实现来修复失败的测试。 |
| `go-microservice` | Go 微服务功能 | 为 Go 微服务添加新功能 |
| `input-validation` | 添加输入验证 | 添加 HTML 清理和路径遍历防护。 |
| `issue-resolution-example` | 问题解决示例（SWE-Bench 风格） | 以问题解决率为核心评估编码代理 |
| `iterative-debug` | 迭代调试 | 通过运行测试、阅读失败信息并反复修正来解决 bug。 |
| `official-json-contract-repair` | JSON 契约修复 | 修复 JSON 响应以匹配其契约。 |
| `logging-improvement` | 改进日志 | 为日志器添加级别和上下文支持。 |
| `multi-file-rename` | 多文件重命名 | 在多个源文件中重命名一个函数。 |
| `official-performance-optimize` | 性能优化 | 优化工具函数以提升性能。 |
| `python-api` | Python API 端点 | 在 Python Web 应用中实现新的 REST API 端点 |
| `react-bugfix` | React 组件 Bug 修复 | 修复 React 组件中的 bug 并验证修复 |
| `refactor-with-tests` | 带测试的重构 | 在保持所有测试通过的前提下重构函数。 |
| `official-repo-health` | 仓库健康检查 | 修复工具函数中的 bug 并验证现有测试通过。 |
| `rotating-tasks-2026-04-example` | 轮转任务示例（LiveBench 风格） | 跨类别平衡评估编码代理 |
| `security-hardening` | 安全加固 | 添加 HTML 清理和路径遍历防护。 |
| `official-small-refactor` | 小型重构 | 执行低风险重构，同时保持核心仓库结构完整。 |
| `official-snapshot-fix` | 快照修复 | 修复生成器脚本以匹配其预期输出。 |
| `test-coverage` | 提升测试覆盖 | 为尚未覆盖的模块添加测试。 |

<!-- official-taskpacks:end -->

## 文档

- [Project overview](./docs/overview.md)
- [Benchmark fairness](./docs/fairness.md)
- [Adapter capabilities](./docs/adapter-capabilities.md)
- [Task pack modes](./docs/taskpack-modes.md)
- [Web report app](./apps/web-report/README.md)
- [Runner Docker](./docs/runner-docker.md)
- [Official task packs](./examples/taskpacks/official/README.md)
- [Contributing](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
