# Architecture Decisions

Key design decisions that are not obvious from the code alone.

## Windows Process Tree Killing

`packages/adapters/src/process-utils.ts` uses `taskkill /F /T /PID` on Windows instead of Node's `child.kill()`.

Why:
- Node's `child.kill()` only terminates the direct child process
- Agent CLIs (codex, claude-code, gemini) spawn their own subprocesses (language servers, tool runners)
- Without tree kill, these grandchild processes become orphans that hold file locks on the workspace
- On Windows, there is no process group mechanism like Unix's `kill(-pid)`

The `/T` flag kills the entire process tree. `/F` forces immediate termination because Windows signals are unreliable for process trees. On Unix, the adapter uses `process.kill(-pid, SIGTERM)` to signal the entire process group, with a SIGKILL fallback after timeout.

If tree kill fails, `adapterWarn` logs the PID for manual cleanup. This is the only diagnostic signal for orphaned processes.

## Provider Profile URL Whitelist

`packages/adapters/src/claude-provider-profiles.ts` restricts which API hosts can receive secrets.

Allowed hosts: `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `dashscope.aliyuncs.com`

Security model:
- API keys are sent to the configured `baseUrl` — a malicious URL would exfiltrate the key
- Private/loopback addresses are blocked via `isInternalUrl()` (SSRF prevention)
- Unknown hosts require explicit `_confirmBaseUrlRisk: true` acknowledgment from the user
- Unknown hosts get the `baseUrl-redirects-traffic` risk flag attached to the profile

Risk flags (`ClaudeProviderRiskFlag`):
- `third-party-provider` — not using official Anthropic API
- `compatibility-mode` — relying on Claude-compatible behavior from a non-Anthropic endpoint
- `user-managed-secret` — secret lifecycle is the user's responsibility
- `baseUrl-redirects-traffic` — API calls go to an unverified host

These flags are informational in the UI. Only the absence of a stored secret blocks execution (preflight returns `"blocked"`).

## Scoring: Run-Local vs Leaderboard Aggregation

Composite scores are **relative within a single run**. They cannot be compared across runs.

Why: duration and cost scores are normalized against the best/worst in the same run. A score of 85 in run A and 85 in run B do not mean the same thing if the runs had different agent sets, models, or task configurations.

The `scoreScope: "run-local"` field on `BenchmarkRun` makes this constraint machine-readable.

The community leaderboard (`packages/cli/src/publish.ts`) aggregates differently:
- Groups by agent identity: `baseAgentId + model + provider + version`
- Computes avgScore, winRate, successRate across all runs for that identity
- Does NOT use `fairComparison` metadata — it groups by agent, not by task comparability

The web report's cross-run comparison (`apps/web-report/src/view-model/comparison.js`) DOES use `fairComparison` to filter which runs are comparable before showing side-by-side results.

## Codex Runtime Resolution Priority

`packages/adapters/src/runtime-resolution.ts` resolves the effective model and reasoning effort through a 4-layer priority chain:

1. **Explicit AgentArena config** — `requestedConfig.model` / `requestedConfig.reasoningEffort` from the UI or CLI flags. Source: `"ui"`
2. **Environment variables** — `AGENTARENA_CODEX_MODEL`, `AGENTARENA_CODEX_REASONING_EFFORT`. Source: `"env"`
3. **Codex config file** — `~/.codex/config.toml` fields `model` and `model_reasoning_effort`. Source: `"codex-config"`
4. **CLI default** — no model resolved; Codex CLI uses its own internal default. Source: `"cli-default"`

The first layer that produces a non-empty value wins. Empty strings and whitespace-only values are normalized to `undefined` and skipped.

The binary path has a separate 3-layer resolution in `codex-adapter.ts`:
1. `AGENTARENA_CODEX_BIN` environment variable
2. Windows npm global path (`%APPDATA%/npm/node_modules/@openai/codex/bin/codex.js`)
3. Bare `codex` / `codex.cmd` command on PATH
