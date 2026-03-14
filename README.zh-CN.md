# RepoArena

> 面向真实代码仓库的本地优先 AI coding agent 评测与回放工具。

[English README](./README.md)

RepoArena 用来在同一个仓库、同一个任务、同一套 judge 规则下运行多个 coding agent，然后统一比较它们的成功率、耗时、token、成本、改动文件和回放结果。

现在的主入口是 `repoarena ui`。它会启动一个本地服务，让你直接在浏览器里填写仓库路径、选择任务包、勾选 agents、发起 benchmark，并在同一个页面里查看结果。

## 当前能力

- 本地 `repoarena ui`、`repoarena run`、`repoarena doctor`、`repoarena list-adapters`、`repoarena init-taskpack`、`repoarena init-ci`
- demo adapters，以及 `codex`、`claude-code`、`cursor` 真实 CLI adapter
- adapter capability matrix 和 preflight
- JSON / YAML task pack
- command、file、glob、snapshot、json judge
- `summary.json`、`summary.md`、`pr-comment.md`、`report.html`、`badge.json`
- 可交互的 `apps/web-report`
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

打开页面后，按这个顺序操作：
- 输入仓库路径
- 选择官方 task pack，或者手动填写 task pack 路径
- 勾选要比较的 agents
- 点击运行
- 运行结束后直接在页面里看结论、对比、judge 和 diff

### CLI 方式

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

位于 [examples/taskpacks/official](./examples/taskpacks/official/README.md)，当前包括：

- `repo-health.yaml`
- `failing-test-fix.yaml`
- `snapshot-fix.yaml`
- `config-repair.yaml`
- `small-refactor.yaml`
- `json-contract-repair.yaml`

## Badge 用法

每次 run 都会生成：

```text
.repoarena/runs/<run-id>/badge.json
```

如果你把这个文件发布到任意静态地址，就可以直接接 Shields：

```markdown
![RepoArena](https://img.shields.io/endpoint?url=https://your-host.example/repoarena/badge.json)
```

## 文档

- [项目概览](./docs/overview.md)
- [评测公平性](./docs/fairness.md)
- [Adapter 能力矩阵](./docs/adapter-capabilities.md)
- [Web Report 说明](./apps/web-report/README.md)
- [官方任务库](./examples/taskpacks/official/README.md)

## 许可证

[MIT](./LICENSE)
