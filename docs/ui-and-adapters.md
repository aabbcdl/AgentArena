# 本地 UI 服务与适配器检查（运维与安全）

本文说明 `agentarena ui` 的绑定地址、鉴权行为，以及 `doctor` / `preflight` 的结果语义，避免「看起来能用」的误判。

## `agentarena ui`：监听地址与鉴权

- **默认**：`--host 127.0.0.1`、`--port 4320`。仅从本机访问时，多数 **只读** API（如 `GET /api/adapters`）可不带头。
- **`--host 0.0.0.0`**：等同对外网卡监听，浏览器 Origin 仍可为 `http://127.0.0.1:<port>`（见服务端 CORS 白名单），但 **`isLocalhost` 为 false**，此时 **所有 `/api/*` 请求都必须带 `Authorization: Bearer <token>`**。
- **敏感路径**（即使在本机、即使是 GET）：必须经过鉴权，例如：
  - `/api/run`、`/api/run/cancel`
  - `/api/preflight`
  - `/api/create-adhoc-taskpack`
  - `/api/provider-profiles` 及其子路径（含密钥相关）
- **令牌**：默认进程启动时生成随机 UUID；也可用 **`--auth-token <secret>`** 固定。浏览器侧由前端存储并在 `apiFetch` 中附加（参见 web-report `app-helpers`）。
- **误用场景**：在不可信网络将 UI 绑到 `0.0.0.0` 且未妥善保管 token，等同于把「可触发跑任务 / 读写 profile」的接口暴露给局域网 — **请仅在可信环境使用或始终绑定 127.0.0.1**。

## `doctor` 与 `preflight`：失败语义

二者都会调用适配器的 **`preflightAdapters`**（UI 中 `/api/preflight` 同理），带 `--probe-auth` 时会尝试探测登录态。

| 现象 | 含义（概要） |
|------|----------------|
| `status: "ready"` | CLI 在 PATH 中可用，基础检查通过；若探测 auth，通常表示关键凭证可用（具体依适配器）。 |
| `status: "unverified"` | 适配器未报错但未完成认证探测（例如未使用 `--probe-auth`）；**不代表已登录**。 |
| `status: "missing"` | 未找到 Agent CLI 或可执行入口。 |
| `status: "blocked"` | 版本/配置不满足要求，或认证探测失败；**不应理解为「agent 已可用」**。 |
| UI 返回 500 + `"Internal server error"` | 服务端捕获未预期异常；查看终端日志中的 `[agentarena] Preflight failed:`。 |
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
