# AgentArena HTTP API

The `agentarena ui` command starts a local HTTP server that exposes a REST API for the web-report frontend. This document describes all available endpoints.

## Server Defaults

| Setting | Default |
|---------|---------|
| Host | `127.0.0.1` |
| Port | `4320` |
| Auth | Token-based (auto-generated or `--auth-token` / `AGENTARENA_AUTH_TOKEN`) |

## Authentication

All mutating (non-GET) API requests and all sensitive endpoints require a Bearer token:

```
Authorization: Bearer <token>
```

For safety, the token itself is not printed to stdout. The server prints `auth_token_file=...`; read that file to retrieve the token. It is saved at `.agentarena/last-auth-token` by default.

On localhost, read-only GET requests to non-sensitive paths are allowed without authentication.

Sensitive paths (always require auth, even on localhost):
- `/api/provider-profiles` and sub-paths
- `/api/run`
- `/api/run/cancel`
- `/api/preflight`
- `/api/create-adhoc-taskpack`

## Rate Limiting

- General: 120 requests per 60-second window per IP
- Expensive endpoints (`/api/run`, `/api/run/cancel`, `/api/preflight`, `/api/create-adhoc-taskpack`, `/api/provider-profiles`): 10 requests per 60-second window

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
  "authRequired": false
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

**Response 202:** `{ "accepted": true }` — run started asynchronously.

**Response 400:** Validation error.

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
