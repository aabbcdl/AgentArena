# Environment Variables Reference

Single source of truth for all `AGENTARENA_*` environment variables.
Default values are in parentheses. All are optional.

## Timeout Configuration

| Variable | Default | File | Description |
|----------|---------|------|-------------|
| `AGENTARENA_AGENT_TIMEOUT_MS` | `900000` (15 min) | `packages/adapters/src/process-utils.ts` | Agent execution timeout |
| `AGENTARENA_PREFLIGHT_TIMEOUT_MS` | `60000` (60s) | `packages/adapters/src/process-utils.ts` | Individual auth probe timeout |
| `AGENTARENA_TRANSPORT_TIMEOUT_MS` | `120000` (120s) | `packages/adapters/src/process-utils.ts` | Transport-level timeout |
| `AGENTARENA_JUDGE_TIMEOUT_MS` | `300000` (5 min) | `packages/judges/src/shared.ts` | Judge execution timeout |

| `AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS` | `1800000` (30 min) | `packages/runner/src/concurrency.ts` | Runner-level agent execution timeout (wraps adapter timeout) |

**Note:** There are TWO timeout layers: `AGENTARENA_AGENT_TIMEOUT_MS` (adapter-level, 15 min) and `AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS` (runner-level, 30 min). The runner timeout should be longer than the adapter timeout. The adapter timeout controls the agent CLI process; the runner timeout controls the overall run lifecycle including cleanup.

**Note:** There is also a registry-level preflight timeout (`PREFLIGHT_TIMEOUT_MS = 120s` in `packages/adapters/src/adapter-registry.ts`) that wraps the entire preflight flow. It is NOT configurable via env var and is separate from `AGENTARENA_PREFLIGHT_TIMEOUT_MS` which controls individual auth probes.

## Adapter CLI Paths

| Variable | Default | File | Description |
|----------|---------|------|-------------|
| `AGENTARENA_CODEX_BIN` | `codex` | `packages/adapters/src/codex-adapter.ts` | Codex CLI binary path |
| `AGENTARENA_CLAUDE_BIN` | `claude` | `packages/adapters/src/claude-adapter.ts` | Claude Code CLI binary path |
| `AGENTARENA_CURSOR_BIN` | `cursor` | `packages/adapters/src/base-cli-adapter.ts` | Cursor CLI binary path |
| `AGENTARENA_CURSOR_AGENT_CLI` | _(auto-detect)_ | `packages/adapters/src/cursor-adapter.ts` | Cursor Agent CLI binary |
| `AGENTARENA_GEMINI_BIN` | `gemini` | `packages/adapters/src/gemini-adapter.ts` | Gemini CLI binary path |
| `AGENTARENA_KILO_BIN` | `kilo` | `packages/adapters/src/base-cli-adapter.ts` | Kilo CLI binary path |
| `AGENTARENA_OPENCODE_BIN` | `opencode` | `packages/adapters/src/base-cli-adapter.ts` | OpenCode CLI binary path |
| `AGENTARENA_QWEN_BIN` | `qwen` | `packages/adapters/src/qwen-adapter.ts` | Qwen Code CLI binary path |
| `AGENTARENA_COPILOT_BIN` | `copilot` | `packages/adapters/src/copilot-adapter.ts` | Copilot CLI binary path |
| `AGENTARENA_AUGMENT_BIN` | `augment` | `packages/adapters/src/augment-adapter.ts` | Augment CLI binary path |
| `AGENTARENA_TRAE_BIN` | `trae` | `packages/adapters/src/trae-adapter.ts` | Trae CLI binary path |

## Model Configuration

| Variable | Default | File | Description |
|----------|---------|------|-------------|
| `AGENTARENA_CODEX_MODEL` | _(adapter default)_ | `packages/adapters/src/codex-adapter.ts` | Codex model override |
| `AGENTARENA_CODEX_REASONING_EFFORT` | _(adapter default)_ | `packages/adapters/src/runtime-resolution.ts` | Codex reasoning effort level |
| `AGENTARENA_CLAUDE_MODEL` | _(adapter default)_ | `packages/adapters/src/claude-adapter.ts` | Claude model override |
| `AGENTARENA_CLAUDE_PROFILE` | _(none)_ | `packages/adapters/src/claude-adapter.ts` | Claude provider profile ID |
| `AGENTARENA_GEMINI_MODEL` | _(adapter default)_ | `packages/adapters/src/gemini-adapter.ts` | Gemini model override |
| `AGENTARENA_AIDER_BIN` | `aider` | `packages/adapters/src/base-cli-adapter.ts` | Aider CLI binary path |
| `AGENTARENA_AIDER_MODEL` | _(adapter default)_ | `packages/adapters/src/base-cli-adapter.ts` | Aider model override |
| `AGENTARENA_KILO_MODEL` | _(adapter default)_ | `packages/adapters/src/base-cli-adapter.ts` | Kilo model override |
| `AGENTARENA_OPENCODE_MODEL` | _(adapter default)_ | `packages/adapters/src/base-cli-adapter.ts` | OpenCode model override |
| `QWEN_CODE_MODEL` | _(adapter default)_ | `packages/adapters/src/qwen-adapter.ts` | Qwen model override (note: different prefix) |

## Claude Provider Profile Storage

| Variable | Default | File | Description |
|----------|---------|------|-------------|
| `AGENTARENA_CLAUDE_PROFILE_ROOT` | `~/.config/agentarena` (Unix) / `%APPDATA%/AgentArena` (Windows) | `packages/adapters/src/claude-provider-profiles.ts` | Directory for profile registry |
| `AGENTARENA_CLAUDE_PROFILES_FILE` | `<PROFILE_ROOT>/claude-provider-profiles.json` | `packages/adapters/src/claude-provider-profiles.ts` | Path to profiles JSON file |
| `AGENTARENA_CLAUDE_SECRET_PREFIX` | `AgentArena/claude-profile/` | `packages/adapters/src/claude-provider-profiles.ts` | Credential storage target prefix |

## Judge Configuration

| Variable | Default | File | Description |
|----------|---------|------|-------------|
| `AGENTARENA_JUDGE_CONCURRENCY` | `4` (max: 16) | `packages/judges/src/index.ts` | Max parallel command-based judges |
| `AGENTARENA_MAX_CONCURRENCY` | `min(4, cpuCount)` | `packages/runner/src/concurrency.ts` | Max parallel agent executions |
| `AGENTARENA_ALLOW_EVAL_IN_JUDGES` | `0` | `packages/judges/src/command-runner.ts` | Allow `node -e`, `python -c` in judges |
| `AGENTARENA_ALLOW_RISKY_COMMANDS_IN_JUDGES` | `0` | `packages/judges/src/command-runner.ts` | Allow `curl`, `wget`, `sed`, `awk`, `tee` |

## Environment Passthrough

| Variable | Default | File | Description |
|----------|---------|------|-------------|
| `AGENTARENA_EXTRA_ENV` | _(none)_ | `packages/core/src/env.ts` | Comma-separated env var names to pass to agent processes (added to built-in allowlist) |

## Output / Locale

| Variable | Default | File | Description |
|----------|---------|------|-------------|
| `AGENTARENA_LOCALE` | `en` | `packages/cli/src/commands/ui-routes.ts` | Report locale (`zh` or `en`) |
| `AGENTARENA_DEBUG` | _(unset)_ | `packages/core/src/logging.ts` | Enable debug logging (any value) |

## UI Server

| Variable | Default | File | Description |
|----------|---------|------|-------------|
| `AGENTARENA_AUTH_TOKEN` | _(auto-generated)_ | `packages/cli/src/commands/ui.ts` | Custom auth token for UI server |

## Community / Publish

| Variable | Default | File | Description |
|----------|---------|------|-------------|
| `AGENTARENA_COMMUNITY_OWNER` | `agentarena` | `packages/cli/src/publish.ts` | GitHub owner for community leaderboard |
| `AGENTARENA_COMMUNITY_REPO` | `leaderboard-data` | `packages/cli/src/publish.ts` | GitHub repo for community leaderboard |

## Testing

| Variable | Default | File | Description |
|----------|---------|------|-------------|
| `AGENTARENA_RUN_BROWSER_SMOKE` | `0` | `tests/web-report.e2e.mjs` | Enable Playwright browser smoke tests |

## Internal Constants (not configurable)

These are hardcoded and NOT exposed as env vars:

| Constant | Value | File | Description |
|----------|-------|------|-------------|
| `SIGKILL_GRACE_MS` | `2000` | `packages/adapters/src/process-utils.ts` | Grace period before SIGKILL after SIGTERM |
| `TERMINATE_ESCALATE_MS` | `1000` | `packages/adapters/src/process-utils.ts` | Wait before escalating to SIGKILL in process tree termination |
| `PREFLIGHT_TIMEOUT_MS` | `120000` | `packages/adapters/src/adapter-registry.ts` | Registry-level preflight wrap timeout |
| `AGENT_EXECUTE_TIMEOUT_GRACE_MS` | `5000` | `packages/runner/src/agent-lifecycle.ts` | Extra grace added to adapter timeout for wrapWithTimeout |
| `TEARDOWN_TIMEOUT_MS` | `30000` | `packages/runner/src/agent-lifecycle.ts` | Teardown commands timeout |
| `MAX_PROCESS_OUTPUT_BYTES` | _(from core)_ | `packages/core/` | Max stdout/stderr bytes before truncation |
| `MAX_PARSE_DEPTH` | `50` | `packages/adapters/src/event-parsers.ts` | Max JSON recursion depth in event parser |
| `MAX_PARSE_ERRORS` | `10` | `packages/adapters/src/event-parsers.ts` | Max parse errors before aborting event parsing |
