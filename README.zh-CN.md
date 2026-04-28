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

- `agentarena ui`
- `agentarena run`
- `agentarena doctor`
- `agentarena list-adapters`
- `agentarena init-taskpack`
- `agentarena init-ci`

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

| Adapter | 状态 | 说明 |
| --- | --- | --- |
| `codex` | 可用 | 支持模型与推理强度配置 |
| `claude-code` | 可用 | 带鉴权感知报错 |
| `cursor` | 可用 | 本地桥接，受登录态影响 |
| `gemini-cli` | 可用 | 支持 token / cost 解析 |
| `aider` | 可用 | 多模型支持 |
| `copilot` | 可用 | token 估算 |
| `qwen-code` | 可用 | JSON 输出解析 |
| `kilo-cli` | 可用 | 基于 OpenCode |
| `opencode` | 可用 | 开源多 provider CLI |
| `trae` | 可用 | 事件流解析 |
| `augment` | 可用 | 多模型支持 |
| `windsurf` | 阻塞 | 鉴权稳定性问题 |
| `demo-fast` / `demo-thorough` / `demo-budget` | 内置 | 不依赖外部登录 |

> **说明**：「可用」表示 adapter 可以正常运行，但可能对本地登录态、CLI 版本或安装路径敏感。详见 [Adapter 能力矩阵](./docs/adapter-capabilities.md) 了解详细分级定义。

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
