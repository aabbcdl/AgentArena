# RepoArena

> 面向真实代码仓库的本地优先 AI coding agent 评测与回放工具。

[English README](./README.md)

RepoArena 用来在同一个仓库、同一个任务、同一套 judge 规则下运行多个 coding agent，然后统一比较它们的成功率、耗时、token、成本、改动文件和回放结果。

现在的主入口是 `repoarena ui`。它会启动一个本地服务，让你直接在浏览器里填写仓库路径、选择任务包、勾选 agents 或 Codex 变体、发起 benchmark，并在同一个页面里查看结果。直接打开 `summary.json` 只是浏览已有结果的备用路径，不是主流程。

## 当前能力

- 本地 `repoarena ui`、`repoarena run`、`repoarena doctor`、`repoarena list-adapters`
- `repoarena init-taskpack`、`repoarena init-ci`
- demo adapters，以及 `codex`、`claude-code`、`cursor` CLI adapters
- adapter capability matrix 和 preflight
- JSON / YAML task pack
- command、file、glob、snapshot、json judges
- `summary.json`、`summary.md`、`pr-comment.md`、`report.html`、`badge.json`
- 可交互的 `apps/web-report`
- 跑分实时进度反馈与日志流
- 任务包详情展示（难度、区分度、Judge 检查项）
- GitHub Actions smoke benchmark 和 PR comment

## 快速开始

### 推荐：本地 UI 模式

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js ui
```

终端会打印本地地址，通常是：

```text
http://127.0.0.1:4317
```

推荐流程：

1. 输入仓库路径
2. 选择官方 task pack，或者手动填写 task pack 路径
3. 选择一个或多个真实 agent，或配置多个 Codex 变体
4. 发起 benchmark
5. 在同一个页面里查看结果、对比和细节

### 备用：CLI 方式

如果你要脚本化运行，可以直接：

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents demo-fast --output .repoarena/manual-run
```

每次 run 会产出：

- `summary.json`
- `summary.md`
- `pr-comment.md`
- `report.html`
- `badge.json`

## 常用命令

检查 adapter readiness：

```bash
pnpm doctor
```

列出 adapters：

```bash
node packages/cli/dist/index.js list-adapters --json
```

生成 starter task pack：

```bash
node packages/cli/dist/index.js init-taskpack --template repo-health --output repoarena.taskpack.yaml
```

生成 GitHub Actions benchmark workflow：

```bash
node packages/cli/dist/index.js init-ci --task repoarena.taskpack.yaml --agents demo-fast,codex
```

返回机器可读 benchmark 结果：

```bash
node packages/cli/dist/index.js run --repo . --task repoarena.taskpack.yaml --agents demo-fast --json
```

## 官方任务库

位于 [examples/taskpacks/official/README.md](./examples/taskpacks/official/README.md)，当前包括：

**简单：**
- `repo-health.yaml`
- `config-repair.yaml`
- `snapshot-fix.yaml`

**中等：**
- `failing-test-fix.yaml`
- `json-contract-repair.yaml`
- `small-refactor.yaml`

**困难：**
- `multi-file-rename.yaml`
- `cross-module-refactor.yaml`
- `performance-optimize.yaml`

## Badge 用法

每次 run 都会生成 `badge.json`。发布到任意静态地址后可以接 Shields：

```markdown
![RepoArena](https://img.shields.io/endpoint?url=https://your-host.example/repoarena/badge.json)
```

## 任务包 Schema

当前支持 `repoarena.taskpack/v1`。

支持的文件格式：
- `.json`
- `.yaml`
- `.yml`

内置 starter 模板：
- `repo-health`
- `json-api`
- `snapshot`

每个任务包定义：
- 仓库任务元数据
- 一条 benchmark prompt
- 可选的 `envAllowList`
- 可选的 `setupCommands`
- 结构化的 `judges` 列表
- 可选的 `teardownCommands`

内置 judge 类型：
- `command`
- `file-exists`
- `file-contains`
- `glob`
- `file-count`
- `snapshot`
- `json-value`
- `json-schema`

环境变量采用白名单机制。任务包通过 `envAllowList` 暴露特定宿主变量，每个 setup/judge/teardown 步骤可以进一步扩展白名单或注入 `env` 覆盖。Agent 执行时只能访问任务级过滤后的环境变量。

## 设计原则

### 默认公平
每个 agent 在相同的仓库快照、相同的任务定义、相同的评测规则下运行。

### 真实仓库
Benchmark 应该对维护者有意义，而不只是在 demo 里好看。

### 可回放结果
如果结果出乎意料，你应该能检查 trace 并理解原因。

### 诚实就绪
如果 adapter 因为缺少鉴权或本地配置而无法运行，RepoArena 会在比较开始前明确告知。

## 仓库结构

```text
apps/
  web-report/          交互式 benchmark UI（原生 JS，PWA）
packages/
  cli/                 CLI 入口（ui, run, doctor, init-taskpack, init-ci）
  core/                共享类型和工具
  runner/              Benchmark 编排器
  adapters/            Agent 适配器（demo, codex, claude-code, cursor）
  judges/              Judge 实现（command, file, glob, snapshot, json）
  taskpacks/           任务包加载器和校验器
  trace/               执行 trace 记录器
  report/              报告生成器（JSON, Markdown, HTML, badge）
examples/
  taskpacks/           Demo 和官方任务包
fixtures/
  nodejs-monorepo/     标准测试仓库
docs/
```

## 文档

- [项目概览](./docs/overview.md)
- [评测公平性](./docs/fairness.md)
- [Adapter 能力矩阵](./docs/adapter-capabilities.md)
- [任务包模式](./docs/taskpack-modes.md) - 标准仓库 vs 用户仓库
- [Web Report 说明](./apps/web-report/README.md)
- [Docker Runner](./docs/runner-docker.md)
- [官方任务包](./examples/taskpacks/official/README.md)
- [YAML 任务包示例](./examples/taskpacks/demo-repo-health.yaml)
- [标准测试仓库](./fixtures/nodejs-monorepo/README.md)

## 许可证

[MIT](./LICENSE)
