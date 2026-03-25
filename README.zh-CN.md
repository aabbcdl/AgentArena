# RepoArena

> 面向真实代码仓库的本地优先 AI 编程助手评测与回放工具。

[English README](./README.md)

RepoArena 用来在同一个仓库、同一个任务、同一套检查规则下运行多个编程助手，然后统一比较它们的成功率、耗时、用量、成本、改动文件和回放结果。

现在的主入口是 `repoarena ui`。它会启动一个本地页面，让你直接在浏览器里选择仓库、任务包和参与比较的助手，发起跑分，并在同一个页面里看结果。直接打开 `summary.json` 只适合浏览已经生成好的结果。

## 现在能做什么

- 启动本地页面：`repoarena ui`
- 命令行跑分：`repoarena run`
- 预检本机助手是否可用：`repoarena doctor`
- 查看可用助手：`repoarena list-adapters`
- 生成任务包模板：`repoarena init-taskpack`
- 生成 GitHub Actions 配置：`repoarena init-ci`
- 输出 `summary.json`、`summary.md`、`pr-comment.md`、`report.html`、`badge.json`
- 在页面里看实时进度、结果对比、失败原因和分享卡片

## 快速开始

### 推荐：本地页面模式

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js ui
```

终端会打印一个本地地址，通常是：

```text
http://127.0.0.1:4317
```

使用顺序：

1. 选择仓库路径
2. 选择官方任务包，或者手动填任务包路径
3. 选择要参与比较的助手
4. 点击开始跑分
5. 在同一个页面里看结果和对比

### 备用：命令行直接跑

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents demo-fast --output .repoarena/manual-run
```

这会生成：

- `summary.json`
- `summary.md`
- `pr-comment.md`
- `report.html`
- `badge.json`

## 常用命令

检查助手状态：

```bash
pnpm doctor
```

列出可用助手：

```bash
node packages/cli/dist/index.js list-adapters --json
```

生成任务包模板：

```bash
node packages/cli/dist/index.js init-taskpack --template repo-health --output repoarena.taskpack.yaml
```

生成 GitHub Actions 跑分配置：

```bash
node packages/cli/dist/index.js init-ci --task repoarena.taskpack.yaml --agents demo-fast,codex
```

输出机器可读结果：

```bash
node packages/cli/dist/index.js run --repo . --task repoarena.taskpack.yaml --agents demo-fast --json
```

## 官方任务库

官方任务包在 [examples/taskpacks/official/README.md](./examples/taskpacks/official/README.md)。

当前包含：

简单：
- `repo-health.yaml`
- `config-repair.yaml`
- `snapshot-fix.yaml`

中等：
- `failing-test-fix.yaml`
- `json-contract-repair.yaml`
- `small-refactor.yaml`

困难：
- `multi-file-rename.yaml`
- `cross-module-refactor.yaml`
- `performance-optimize.yaml`

## Badge

每次运行都会生成 `badge.json`。把它部署到静态地址后，可以直接接到 Shields：

```markdown
![RepoArena](https://img.shields.io/endpoint?url=https://your-host.example/repoarena/badge.json)
```

## 任务包格式

当前支持 `repoarena.taskpack/v1`。

支持的文件格式：

- `.json`
- `.yaml`
- `.yml`

内置模板：

- `repo-health`
- `json-api`
- `snapshot`

每个任务包可以定义：

- 任务元数据
- 一条 benchmark 提示词
- 可选的 `envAllowList`
- 可选的 `setupCommands`
- 一组结构化 `judges`
- 可选的 `teardownCommands`

## 文档

- [项目概览](./docs/overview.md)
- [公平性说明](./docs/fairness.md)
- [助手能力矩阵](./docs/adapter-capabilities.md)
- [任务模式说明](./docs/taskpack-modes.md)
- [Web Report 说明](./apps/web-report/README.md)
- [Docker Runner](./docs/runner-docker.md)
- [官方任务包说明](./examples/taskpacks/official/README.md)
- [任务包示例](./examples/taskpacks/demo-repo-health.yaml)
- [测试仓库说明](./fixtures/nodejs-monorepo/README.md)
- [贡献指南](./CONTRIBUTING.md)
- [更新日志](./CHANGELOG.md)

## 许可证

[MIT](./LICENSE)
