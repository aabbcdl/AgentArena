# 本地 UI 服务与适配器检查（运维与安全）

本文说明 `agentarena ui` 的绑定地址、鉴权行为，以及 `doctor` / `preflight` 的结果语义，避免「看起来能用」的误判。

## `agentarena ui`：监听地址与鉴权

- **本地模式**：UI 只允许绑定 `127.0.0.1`、`localhost`、`::1` 或 `::ffff:127.0.0.1`，默认使用 `127.0.0.1:4320`。不支持局域网或公网访问。
- **敏感路径**（即使在本机、即使是 GET）：必须经过鉴权，例如：
  - `/api/run`、`/api/run/cancel`
  - `/api/preflight`
  - `/api/create-adhoc-taskpack`
  - `/api/provider-profiles` 及其子路径（含密钥相关）
- **本地服务密码**：首次打开 Workbench 时可直接设置密码；密码哈希保存在工作区 `.agentarena/ui-auth.json`，浏览器只保存当前会话的 Bearer Token。密码由每个用户自行设置，不存在通用默认值。自动打开浏览器仍通过一次性 bootstrap 连接；脚本和旧客户端仍可使用 **`--auth-token <secret>`**、**`AGENTARENA_AUTH_TOKEN`** 或端口对应的 `.agentarena/last-auth-token-<port>` 文件。

## 任务包的本地信任边界

- 任务包可以定义准备、检查和清理命令，因此它本质上是可执行输入。文件保存在本机，不代表文件本身可信。
- 只运行来源明确、内容经过检查的任务包。社区任务包会在页面中显示提醒。
- 本地模式只接受当前仓库或随程序提供的内置仓库，不接受任务包指定的外部仓库网址。
- 任务包不能通过 `envAllowList` 继承本机的 Git 登录辅助设置。确有需要时，只能由操作者通过 `AGENTARENA_EXTRA_ENV` 明确允许。

## Codex / Claude Code 本地配置边界

- Workbench 的内置 `codex-local` / `claude-local` RuntimeProfile 继承当前终端能使用的命令、环境变量、登录态、个人/项目规则、Skills、MCP 和 Hooks。AgentArena 不改写 `~/.codex/config.toml`、`~/.claude/settings.json` 或用户配置的 `CODEX_HOME` / `CLAUDE_CONFIG_DIR`。
- Codex 的验证和正式任务会从用户 Home 复制 `config.toml`、本地模式所需的 `auth.json`、`AGENTS.md`、`AGENTS.override.md`、`rules` 和 `skills` 到一次性的影子 `CODEX_HOME`。CLI 自己产生的 trust、缓存和状态只写入影子目录，子进程退出后清理；Managed Provider 模式不复制本地 `auth.json`。RuntimeProfile LaunchSpec 在 Unix 使用 `workspace-write` 与 `approval_policy=never`；Windows 使用 `danger-full-access` 回退，避免部分 npm Codex 安装中无法加载的 sandbox helper，但仍只在 AgentArena 一次性工作区内执行。
- Managed Provider RuntimeProfile 仍继承上述 Harness，只在当次任务子进程中覆盖 Provider、模型和 Secret。Codex 使用任务级 `-c` 参数，Claude 使用任务级环境变量和 `--setting-sources user,project,local`；不会删除临时仓库里的 `.claude/`、`.codex/` 或 `.mcp.json`。
- Profile、Secret、CLI、相关环境、仓库基线或 Harness 配置发生变化时，旧 Task Receipt 失效，但 Profile 本身保留，用户只需重新验证。
- Claude 后台任务使用 `--permission-mode dontAsk`。需要交互确认的工具调用会被拒绝；AgentArena 不会追加 `--dangerously-skip-permissions`，也不读取已废弃的 `AGENTARENA_SKIP_PERMISSIONS`。
- 旧 launcher 的 Claude-only Provider Profile API 仍作为兼容路径保留，并继续使用临时隔离配置；首版正式配置和任务入口是 Workbench RuntimeProfile。
- Provider 的 `extraEnv` 不能覆盖运行控制、系统启动路径、Provider 地址、模型或密钥专用字段。已有 Profile 如果包含这些冲突字段，会在修正前被阻止运行。
- Verification Receipt 只保存有界且脱敏的失败证据。任务 Secret、全部冻结环境覆盖值、Provider 路由、网络地址和运行路径不会返回网页；CLI 已提供结构化终止错误时，不再附带完整事件流。

## 三阶段就绪语义

| 状态 | 含义 |
|------|------|
| `Installed` | CLI 可执行并能返回版本；不证明已登录。 |
| `Conversation Ready` | 当前冻结 Provider/模型能返回随机 sentinel；不证明能修改仓库。 |
| `Task Ready` | 在所选仓库的一次性副本中完成了唯一预期修改，并签发与 Profile、Secret、CLI、Harness 和仓库身份绑定的 Receipt。 |

只有 `Task Ready` 且 Receipt 仍精确匹配的 RuntimeProfile 可以启动任务。

## `doctor` 与 `preflight`：失败语义

二者都会调用适配器的 **`preflightAdapters`**（UI 中 `/api/preflight` 同理），带 `--probe-auth` 时会尝试探测登录态。

| 现象 | 含义（概要） |
|------|----------------|
| `status: "ready"` | CLI 在 PATH 中可用，基础检查通过；若探测 auth，通常表示关键凭证可用（具体依适配器）。 |
| `status: "unverified"` | 适配器未报错但未完成认证探测（例如未使用 `--probe-auth`）；**不代表已登录**。 |
| `status: "missing"` | 未找到 Agent CLI 或可执行入口。 |
| `status: "blocked"` | 版本/配置不满足要求，或认证探测失败；**不应理解为「agent 已可用」**。 |
| 单个 Harness 返回 `blocked` + `preflight failed` | 该 Harness 预检异常或超时；其他 Harness 的结果仍会返回。 |
| `doctor --strict` | 任一选中适配器未就绪则 **进程退出码非 0**，适合 CI。 |

**注意**：外部 CLI（Codex、Claude Code、Cursor 等）随厂商升级行为会变；**同一退出码在不同版本下含义可能不同**。合约测试保障 JSON 形状稳定，**不保障**第三方 CLI 长期行为不变。

## 相关自动化测试（契约）

| 区域 | 测试文件 |
|------|-----------|
| HTTP 鉴权、CORS、限流 | `tests/server-unit.test.mjs` |
| `/api/*` 处理器 JSON 形状 | `tests/api-routes.test.mjs`、`tests/contracts-http-api.test.mjs` |
| Trace JSONL / TraceEvent | `tests/trace.test.mjs`、`tests/trace-event-contract.test.mjs` |
| Community / publish 条目字段 | `tests/publish.test.mjs`、`tests/publish-schema-contract.test.mjs` |

修改 `packages/cli/src/commands/api-routes.ts`、`packages/cli/src/server.ts` 或 `packages/core` 中社区/trace 类型时，请同步运行 **`pnpm test`** 并更新上表相关测试。
