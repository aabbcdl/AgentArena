# AgentArena HTTP API

The `agentarena ui` command starts a local HTTP server that exposes a REST API for the web-report frontend. This document describes all available endpoints.

## Server Defaults

| Setting | Default |
|---------|---------|
| Host | `127.0.0.1` |
| Port | `4320` |
| Auth | 本地首次启动使用密码设置；底层 API 继续使用 Bearer Token |

## Authentication

All mutating (non-GET) API requests and all sensitive endpoints require a Bearer token internally:

```
Authorization: Bearer <token>
```

Workbench 用户通过本地服务密码换取当前进程的 Bearer Token，不需要手动读取 token 文件。密码哈希保存在工作区 `.agentarena/ui-auth.json`，密码本身不会写入日志或浏览器持久存储。自动打开浏览器仍可使用一次性 bootstrap。

认证辅助接口：

- `GET /api/auth/status`：返回当前是否需要首次设置密码。
- `POST /api/auth/setup`：首次设置密码，JSON body 为 `{ "password": "..." }`。
- `POST /api/auth/login`：用已设置的密码换取当前进程 token，JSON body 为 `{ "password": "..." }`。

服务仍会把当前进程 token 写入每监听端口独立的 `.agentarena/last-auth-token-<port>` 文件，供脚本和旧客户端使用；token 本身不会打印到 stdout。

For an intentional local development password, set `AGENTARENA_LOCAL_AUTH_TOKEN` before starting the UI. For example, PowerShell uses `$env:AGENTARENA_LOCAL_AUTH_TOKEN="admin"`; this setting is only useful with AgentArena's loopback-only UI. `--auth-token` takes precedence, followed by `AGENTARENA_LOCAL_AUTH_TOKEN`, `AGENTARENA_AUTH_TOKEN`, a saved local password, and finally a generated per-process token awaiting first-time password setup.

On localhost, read-only GET requests to non-sensitive paths are allowed without authentication.

Sensitive paths (always require auth, even on localhost):
- `/api/provider-profiles` and sub-paths
- `/api/run`
- `/api/run/cancel`
- `/api/preflight`
- `/api/create-adhoc-taskpack`

## Rate Limiting

- General: 120 requests per 60-second window per IP
- Expensive endpoints (`/api/run`, `/api/run/cancel`, `/api/preflight`, `/api/create-adhoc-taskpack`, `/api/provider-profiles`): 30 requests per 60-second window

When rate-limited, the server returns `429` with a `Retry-After` header (seconds).

## CORS

Only same-origin requests are accepted. Allowed origins are derived from the server's host and port.

---

## Endpoints

### GET /api/ui-info

Server metadata and configuration for the frontend.

**Response 200:**
```json
{
  "mode": "local-service",
  "repoPath": "/path/to/repo",
  "defaultTaskPath": "/path/to/repo-health.yaml",
  "defaultOutputPath": "/path/to/repo/.agentarena/ui-runs",
  "codexDefaults": { ... },
  "claudeProviderProfiles": [
    { "id": "...", "name": "...", "kind": "...", "apiFormat": "...", "primaryModel": "...", "secretStored": true, "isBuiltIn": false }
  ],
  "riskNotice": "...",
  "host": "127.0.0.1",
  "port": 4320,
  "authRequired": false,
  "authTokenFilePath": ".agentarena/last-auth-token-4320",
  "authTokenSource": "generated"
}
```

---

### GET /api/adapters

List all registered agent adapters.

**Response 200:**
```json
[
  { "id": "demo-fast", "title": "Demo Fast", "kind": "demo", "capability": "code-generation" }
]
```

---

### POST /api/preflight

Run a preflight check for a single agent selection. Verifies authentication and adapter readiness.

**Request body:**
```json
{
  "baseAgentId": "claude-code",
  "displayLabel": "Claude Code (sonnet)",
  "config": {
    "model": "sonnet",
    "reasoningEffort": "medium",
    "providerProfileId": "profile-id"
  }
}
```

`providerProfileId` 同时决定 Claude Code 的本地配置模式：

- 省略该字段或使用 `claude-official`：读取当前本地 Claude Code 登录和个人配置。
- 使用非官方 Profile ID：使用 AgentArena 保存的 Provider 信息和独立临时配置，不读取当前官方登录、个人规则、插件或 MCP。

该模式由 Profile 类型自动确定，不存在额外的模式字段。第三方 Profile 的鉴权检查和正式运行使用同一隔离策略；不支持隔离所需命令参数的 Claude Code 版本会返回阻止状态。

**Response 200:** Preflight result object with `status` ("ready" | "unverified" | "failed"), `summary`, and `resolvedRuntime`.

**Response 400:** `{ "error": "Missing baseAgentId." }`

---

### GET /api/provider-profiles

List all Claude provider profiles (secrets are masked).

**Response 200:**
```json
[
  {
    "id": "...",
    "name": "My Provider",
    "kind": "anthropic-compatible",
    "apiFormat": "anthropic-messages",
    "primaryModel": "claude-sonnet-4-20250514",
    "secretStored": true,
    "isBuiltIn": false,
    "extraEnv": { "SOME_KEY": "***" }
  }
]
```

---

### POST /api/provider-profiles

Create a new provider profile.

**Request body:**
```json
{
  "name": "My Provider",
  "kind": "anthropic-compatible",
  "apiFormat": "anthropic-messages",
  "primaryModel": "claude-sonnet-4-20250514",
  "baseUrl": "https://api.example.com",
  "secret": "sk-...",
  "extraEnv": { "CUSTOM_VAR": "value" }
}
```

Required fields: `name`, `kind`, `apiFormat`.

**Response 200:** `{ "profile": {...}, "profiles": [...] }`

**Response 400:** Validation error.

**Response 500:** Profile created but secret storage failed (profile is rolled back).

---

### PUT /api/provider-profiles/:id

Update an existing provider profile.

**Request body:** Same shape as POST (all fields except `secret`).

**Response 200:** `{ "profile": {...}, "profiles": [...] }`

---

### DELETE /api/provider-profiles/:id

Delete a provider profile.

**Response 200:** `{ "profiles": [...] }`

**Response 403:** Built-in profiles cannot be deleted.

---

### POST /api/provider-profiles/:id/secret

Set or clear the API secret for a provider profile.

**Request body:**
```json
{ "secret": "sk-new-secret" }
```

Pass an empty string to clear. Maximum 10,000 characters.

**Response 200:** `{ "profile": {...}, "profiles": [...] }`

---

### POST /api/run

Start a benchmark run. Only one run can be active at a time.

**Request body:**
```json
{
  "repoPath": ".",
  "taskPath": "tasks/demo.yaml",
  "agents": [
    { "baseAgentId": "claude-code", "displayLabel": "Claude Code", "config": { "model": "sonnet" } }
  ],
  "outputPath": ".agentarena/ui-runs",
  "probeAuth": true,
  "updateSnapshots": false,
  "cleanupWorkspaces": true,
  "maxConcurrency": 2,
  "scoreMode": "practical",
  "tokenBudget": 100000
}
```

Required fields: `repoPath`, `taskPath`, at least one agent selection.

Path restrictions: `repoPath` and `taskPath` must be within the server's working directory.

Score mode: when `scoreMode` is provided it must be one of
`practical`, `balanced`, `issue-resolution`, `efficiency-first`,
`rotating-tasks`, `comprehensive`. Invalid values return **400** and are not
silently rewritten. Omitted `scoreMode` defaults to `practical` in the runner.

**Response 202:** `{ "accepted": true }` — run started asynchronously.

**Response 400:** Validation error (including invalid `scoreMode` or out-of-cwd paths).

**Response 409:** `{ "error": "A benchmark run is already in progress." }`

---

### POST /api/run/cancel

Cancel the active benchmark run.

**Response 200:** `{ "cancelled": true }`

**Response 409:** `{ "error": "No benchmark run in progress." }`

---

### GET /api/run-status

Poll the status of the current or most recent benchmark run.

**Response 200:**
```json
{
  "state": "running",
  "phase": "benchmark",
  "startedAt": "2026-05-10T12:00:00.000Z",
  "repoPath": ".",
  "taskPath": "tasks/demo.yaml",
  "currentAgentId": "claude-code",
  "currentVariantId": "claude-code__sonnet",
  "currentDisplayLabel": "Claude Code (sonnet)",
  "logs": [
    { "timestamp": "...", "phase": "starting", "message": "..." }
  ],
  "updatedAt": "2026-05-10T12:01:00.000Z"
}
```

States: `idle` | `running` | `done` | `error` | `cancelled` | `cancelling`

Phases: `idle` | `starting` | `preflight` | `benchmark` | `report`

When `state` is `done`, the response includes a `result` object with `run`, `markdown`, and `report` fields.

---

### POST /api/create-adhoc-taskpack

Generate an ad-hoc task pack from a user prompt.

**Request body:**
```json
{
  "prompt": "Add input validation to the login form",
  "title": "Login Validation"
}
```

Required: `prompt` (max 100,000 characters). Optional: `title`.

**Response 200:**
```json
{
  "path": ".agentarena/adhoc-taskpacks/adhoc-2026-05-10T12-00-00-000Z.yaml",
  "id": "adhoc-2026-05-10T12-00-00-000Z",
  "title": "Login Validation"
}
```

---

### GET /api/adhoc-taskpacks

List previously created ad-hoc task packs (most recent first).

**Response 200:**
```json
[
  { "id": "adhoc-...", "title": "...", "path": "...", "createdAt": "...", "promptPreview": "..." }
]
```

---

### DELETE /api/adhoc-taskpacks/:id

Delete an ad-hoc task pack file.

**Response 200:** `{ "deleted": true, "id": "..." }`

**Response 404:** Task pack not found.

**Response 403:** Permission denied.

---

### GET /api/taskpacks

List official (built-in) task packs.

**Response 200:** Array of task pack metadata objects.

---

## Error Responses

All errors follow a consistent format:

```json
{ "error": "Human-readable error message." }
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (validation failure, malformed JSON) |
| 401 | Authentication required |
| 403 | Forbidden (CORS violation, path traversal, permission denied) |
| 405 | Method not allowed |
| 408 | Request body read timed out (30s limit) |
| 409 | Conflict (run already active, or no run to cancel) |
| 413 | Request body too large (1 MB limit) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

## Security Headers

All API responses include:
- `Cache-Control: no-store`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy: default-src 'self'; ...`

---

## Security Considerations

### Network Binding

By default, the server binds to `127.0.0.1` only — it is not reachable from other machines on the network. AgentArena UI only accepts local hosts (`127.0.0.1`, `localhost`, `::1`, `::ffff:127.0.0.1`). Binding to `0.0.0.0` or other non-local addresses is rejected.

### Authentication Model

- **Read-only GET** requests from localhost do not require a token. This allows the browser to load the UI without extra configuration.
- **All mutations** (POST, PUT, DELETE) and **sensitive GET** paths require a Bearer token, even from localhost.
- **Local password mode** exposes only status/setup/login helpers on the loopback UI origin; the password is stored as a salted `scrypt` digest and exchanges for the per-process Bearer token.
- The token is generated with `randomBytes(32)` (256 bits) and compared using `timingSafeEqual` to prevent timing attacks.
- The token is written to the per-listener `.agentarena/last-auth-token-<port>` file (not printed to stdout) to prevent accidental leakage in CI logs and cross-process token-file races.

### Path Traversal Protection

- `repoPath` and `taskPath` in `/api/run` are validated using `path.relative()` (not string prefix matching) to prevent sibling-prefix bypass attacks (e.g., `/home/user-evil` bypassing a `/home/user` check).
- Static file serving uses `isPathInsideWorkspace()`, which resolves symlinks via `fs.realpath()` before checking containment. This prevents symlink-based path traversal.
- URL-encoded (`%2f`) and double-encoded (`%252f`) path traversal attempts are normalized and rejected.

### Input Limits

- Request body: 1 MB max (`413` if exceeded).
- Request body read timeout: 30 seconds (`408` if exceeded).
- Ad-hoc task pack prompt: 100,000 characters max.
- Provider profile secrets: 10,000 characters max.

### CSV Export Safety

CSV exports prefix formula-trigger characters (`=`, `+`, `-`, `@`, `\t`, `\r`) with a single quote to prevent spreadsheet formula injection attacks when results are opened in Excel or similar applications.

### Rate Limiting as DoS Mitigation

The rate limiter is per-IP with a sliding 60-second window. It uses an in-memory store (appropriate for the local-first, single-user design) with:
- Bounded store size (10,000 entries max) with oldest-entry eviction
- Cleanup every 30 seconds to remove stale entries
- On-access eviction of entries with no valid timestamps

### Content Security Policy

The web report enforces a strict CSP:
- `default-src 'self'` — only local resources by default
- `script-src 'self'` — no inline scripts, no eval
- `connect-src 'self' https://raw.githubusercontent.com` — API calls only to self and the community leaderboard data source
- Inline styles are allowed (`'unsafe-inline'`) for dynamic theming; all scripts are external and locally served.
