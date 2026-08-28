# AgentArena

> 用同一个仓库、同一个任务、同一套 judges，评估你本地已经在用的 coding agent，并查看结果背后的证据。

[English README](./README.md) · [npm package](https://www.npmjs.com/package/@agentarena/cli) · [快速开始](./docs/getting-started.md)

![AgentArena Workbench](./docs/images/web-report-launcher.jpg)
![AgentArena report](./docs/images/web-report-report.jpg)

AgentArena 是一个本地优先的 coding agent benchmark 和回放工具。它解决的不是“怎么安装 agent”，而是后续更实际的问题：

> 我当前本地的 agent、模型和运行配置，在自己的真实仓库任务上到底表现怎么样？

AgentArena 让不同运行使用同一个仓库快照、同一个任务定义、同一套 setup 命令和 judges，然后记录改动、judge 证据、trace、运行时身份和报告。结果可以被检查和复盘，而不是只看一个漂亮分数。

当前公开版本是 **0.2.1**，目标是 Local Pilot。它不是托管服务，也不是面向所有模型的全球排行榜。

## 安装和启动

需要：

- Node.js **22 或更高版本**；
- 目标仓库及其自身需要的语言工具链；
- 只有在运行真实外部 agent 时，才需要安装对应的 agent CLI。

安装已经发布的 CLI：

```bash
npm install --global @agentarena/cli@0.2.1
agentarena ui
```

打开命令行打印的本地地址，通常是 `http://127.0.0.1:4320`。

第一次启动时，Workbench 会让你自己设置本地服务密码，至少 4 个字符。程序只会把加盐后的密码哈希保存在当前 workspace 的 `.agentarena/` 目录下；普通使用不需要手动寻找或粘贴 Bearer Token。之后如果浏览器会话失效，输入同一个密码即可重新连接。密码只属于这个 workspace，不存在所有用户共用的默认密码。

如果你要给脚本使用，仍可以显式传入 `--auth-token`、`AGENTARENA_LOCAL_AUTH_TOKEN` 或 `AGENTARENA_AUTH_TOKEN`。除非你已经设计好更强的网络边界，否则请保持 UI 只监听本机回环地址。

## 不登录外部服务，先跑通第一条任务

内置 demo agent 不需要 API Key，也不需要外部登录：

```bash
agentarena init-taskpack --template repo-health --output agentarena-task.yaml
agentarena run \
  --repo . \
  --task agentarena-task.yaml \
  --agents demo-fast,demo-thorough
agentarena ui
```

Workbench 里也可以直接使用 Safe Demo，先验证启动、运行状态、结果、diff 和证据页面，再连接真实 agent。

## 评估真实的本地 agent

只安装并登录你准备测试的 agent CLI，然后先检查就绪状态：

```bash
agentarena doctor --agents codex --probe-auth
```

在 Workbench 中：

1. 选择目标仓库和任务包；
2. 选择已经安装、已登录且状态为 ready 的 Harness；
3. 对 Codex 查看读取到的 CLI 默认模型和思考强度，或者手动输入后保存；
4. 启动任务并查看实时状态；
5. 查看结论、judge 明细、改动文件、trace 和证据。

UI 不会偷偷连接 Provider、修改全局 CLI 配置或切换模型。Codex CLI 没有稳定通用的模型枚举协议，因此 AgentArena 会在可用时读取当前本地配置中的默认模型，同时允许你手动填写模型名。

等价的 CLI 用法：

```bash
agentarena run \
  --repo /path/to/your/project \
  --task /path/to/your/task.yaml \
  --agents codex \
  --probe-auth
```

## 在 Workbench 创建自定义任务

进入 **Plan → 创建自定义任务**，填写：

- 自然语言目标；
- 目标仓库；
- 可选的预期变更路径。

AgentArena 会保存一个本地草稿，检查任务和仓库的兼容性，并在选中任务前展示预览。自动生成的 build/test/lint 只是**基础仓库健康证据**，不能证明自然语言任务的业务逻辑已经正确。没有填写预期路径时，界面会明确显示“变更范围未精确约束”。第一版不接受任意 shell 命令。

## 正确理解结果

任务运行成功，不等于自然语言目标已经被完整证明。AgentArena 把三类证据分开：

- **运行时就绪**：选定的 Harness 能否在当前仓库环境执行受控编辑；
- **任务兼容性**：任务包和仓库是否存在已知结构冲突；
- **任务结果证据**：本次运行的 judges、测试、diff 范围、trace 和最终报告。

报告还会标出模型身份、receipt 和结果证据是 confirmed、declared、missing 还是 stale。token 或 cost 不可用时保持 unknown，不会显示成 0 或免费。

只跑一个 agent 也有价值：它可以建立可重复的能力基线。但多跑一个 agent 不会自动让结论变好；只有在任务、仓库基线、judges、模型参数和证据质量可比时，比较结果才有意义。单次运行通常是 baseline，不应该强行显示 winner。

## 当前产品能力

### 主要命令

```bash
agentarena ui                         # 本地 Workbench 和报告页
agentarena run --repo . --task task.yaml --agents demo-fast
agentarena doctor --agents codex --probe-auth
agentarena list-adapters --json
agentarena init-taskpack --template repo-health --output task.yaml
agentarena init-ci --task task.yaml --agents codex
```

如果需要显式指定 UI workspace：

```bash
agentarena ui --workspace-root /path/to/workspace
```

不传该参数时，访问边界仍然是启动命令时的当前工作目录。

### Adapter 分级

Workbench 默认聚焦于已经定义了本地 Pilot 路径的集成：

| Adapter | 分级 | 说明 |
| --- | --- | --- |
| `demo-fast` / `demo-thorough` / `demo-budget` | supported | 内置，不需要外部登录 |
| `codex` | supported | Codex CLI 事件流，支持模型和思考强度配置 |
| `claude-code` | experimental | 需要兼容的本地 CLI 和登录态 |

其他 adapter 仍保留给 CLI 显式实验使用，不代表首发稳定支持：

| Adapter | 分级 |
| --- | --- |
| `cursor`、`gemini-cli`、`aider`、`copilot` | experimental |
| `kilo-cli`、`opencode`、`qwen-code`、`trae`、`augment` | experimental |
| `windsurf` | blocked |

具体的调用方式、token、cost 和 trace 能力见 [Adapter 能力矩阵](./docs/adapter-capabilities.md)。

### Judges 和输出文件

内置 judge 类型包括：`command`、`test-result`、`lint-check`、`file-exists`、`file-contains`、`regex-match`、`directory-exists`、`compilation`、`glob`、`file-count`、`snapshot`、`json-value`、`json-schema`、`patch-validation`、`token-efficiency`。

每次运行可以输出：

- `summary.json`：机器可读结果；
- `summary.md`：人类可读摘要；
- `report.html`：交互式报告；
- `pr-comment.md`：可直接粘贴的 PR 评论；
- `badge.json`：徽章数据。

## 官方任务包库

<!-- official-taskpacks:start -->

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

<!-- official-taskpacks:end -->

## 从源码开发

npm 包是普通用户最快的使用方式。要参与 AgentArena 开发：

```bash
git clone https://github.com/aabbcdl/AgentArena.git
cd AgentArena
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

源码开发需要仓库声明的 `pnpm` 版本。核心本地 Pilot 不需要 Android Studio、Docker、Xcode 或 Playwright Chromium；Chromium 只用于浏览器 E2E 验证。

常用检查：

```bash
pnpm typecheck
pnpm lint
pnpm taskpacks:check
pnpm test:web-report:e2e
```

## 文档

- [快速开始](./docs/getting-started.md)
- [故障排查](./docs/troubleshooting.md)
- [UI 和 adapter 行为](./docs/ui-and-adapters.md)
- [Adapter 能力矩阵](./docs/adapter-capabilities.md)
- [Benchmark 公平性](./docs/fairness.md)
- [Task pack 模式](./docs/taskpack-modes.md)
- [评分说明](./docs/scoring.md)
- [HTTP API](./docs/http-api.md)
- [官方任务包](./examples/taskpacks/official/README.md)
- [贡献指南](./CONTRIBUTING.md)
- [更新日志](./CHANGELOG.md)

## License

[MIT](./LICENSE)
