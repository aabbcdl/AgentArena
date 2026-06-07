# ADR-003: Security and Execution Model

**Status:** Accepted
**Date:** 2026-06-07
**Deciders:** Original author (reconstructed from code comments)

## Context

AgentArena executes untrusted code (AI agent output) in workspaces and runs judge commands defined in task packs. The security model controls what commands can execute, what environment variables are exposed, and how timeouts/cleanup work. This knowledge was scattered across 5+ files with no central reference.

## Decision

### 1. Command Allowlist (Judge Security)

**File:** `packages/judges/src/command-runner.ts`

Judge commands are validated against a two-layer allowlist:

#### Layer 1: SAFE_COMMANDS (allowlist)
Commands that MAY be executed. Includes ~60 commands across categories:
- Package managers: `node`, `npm`, `npx`, `pnpm`, `yarn`, `bun`
- Languages: `python`, `go`, `cargo`, `rustc`, `ruby`
- Build tools: `make`, `cmake`, `gradle`, `mvn`
- Shell utilities: `grep`, `find`, `ls`, `cat`, `echo`, `diff`, `wc`, `head`, `tail`
- JS ecosystem: `eslint`, `biome`, `prettier`, `tsc`, `vitest`, `jest`

**Intentionally excluded:** `sh`, `bash` — they can execute arbitrary code from script files, bypassing the allowlist entirely.

#### Layer 2: RISKY_COMMANDS (default-blocked subset)
Commands that are in SAFE_COMMANDS but blocked by default:
- `curl`, `wget` — can make network requests
- `sed`, `awk` — can modify files
- `tee` — can write to files

Enable with: `AGENTARENA_ALLOW_RISKY_COMMANDS_IN_JUDGES=1`

#### Eval-style invocation block
`node -e`, `python -c`, `ruby -e`, etc. are blocked by a regex check (separate from the allowlist) because they execute arbitrary code.

Exception: `echo`, `printf`, `type`, `which`, `where` use `-e` for their own flags — they are in `COMMANDS_USING_E_FLAG` and bypass the eval check.

Enable with: `AGENTARENA_ALLOW_EVAL_IN_JUDGES=1`

### 2. Environment Variable Security

**File:** `packages/core/src/env.ts`

Agent processes receive a filtered environment:

#### Baseline allowlist (always passed through)
~35 variables including `PATH`, `HOME`, `USER`, `TMP`, `LANG`, `npm_*`, `SSL_CERT_FILE`, `GIT_*`

#### Blocked list (never passed through, even if explicitly allowed)
- `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES` — library injection
- `NODE_OPTIONS`, `NODE_PATH` — Node.js runtime manipulation
- `ELECTRON_RUN_AS_NODE` — Electron abuse

#### Extension via `AGENTARENA_EXTRA_ENV`
Comma-separated additional variable names to pass through.

### 3. Timeout Constants

| Constant | Value | Env Var Override | Location | Purpose |
|----------|-------|-----------------|----------|---------|
| `DEFAULT_AGENT_TIMEOUT_MS` | 15 min | `AGENTARENA_AGENT_TIMEOUT_MS` | `process-utils.ts:34` | Agent execution timeout |
| `DEFAULT_PREFLIGHT_TIMEOUT_MS` | 60s | `AGENTARENA_PREFLIGHT_TIMEOUT_MS` | `process-utils.ts:63` | Individual auth probe timeout |
| `DEFAULT_TRANSPORT_TIMEOUT_MS` | 120s | `AGENTARENA_TRANSPORT_TIMEOUT_MS` | `process-utils.ts:75` | Transport-level timeout |
| `DEFAULT_JUDGE_TIMEOUT_MS` | 5 min | `AGENTARENA_JUDGE_TIMEOUT_MS` | `shared.ts:20` | Judge execution timeout |
| `PREFLIGHT_TIMEOUT_MS` | 120s | _(none)_ | `adapter-registry.ts:78` | Registry-level preflight wrap |
| `SIGKILL_GRACE_MS` | 2s | _(none)_ | `process-utils.ts:42` | Grace before SIGKILL after SIGTERM |
| `TERMINATE_ESCALATE_MS` | 1s | _(none)_ | `process-utils.ts:49` | Escalation delay in process tree termination |
| `DEFAULT_JUDGE_CONCURRENCY` | 4 | `AGENTARENA_JUDGE_CONCURRENCY` | `judges/index.ts:179` | Max parallel command judges |

**Important distinction:** `PREFLIGHT_TIMEOUT_MS` (120s, registry-level) wraps the entire preflight flow. `DEFAULT_PREFLIGHT_TIMEOUT_MS` (60s, process-level) controls individual auth probes. They are different timeouts at different layers.

### 4. Claude Provider Profile Security

**File:** `packages/adapters/src/claude-provider-profiles.ts`

#### Encryption scheme
- **Algorithm:** AES-256-GCM
- **Key derivation:** `scryptSync(hostname + username, salt, 32)` where salt = `agentarena-secret-${hostname}-${username}`
- **Threat model:** Machine-bound encryption — protects secrets at rest on shared filesystems. Does NOT protect against local privilege escalation (the key is derived from publicly known values).
- **Caveat:** Renaming the machine or user account silently invalidates all encrypted secrets

#### Secret storage backends (fallback chain)
1. **Windows:** PasswordVault via PowerShell (UWP API)
2. **Unix:** AES-256-GCM encrypted file at `<appDataRoot>/secrets/<profileId>.secret`
3. **Legacy fallback:** Base64-encoded or plaintext files (auto-detected, read-only)

#### SSRF protection
- `isInternalUrl()` blocks private/loopback IPs
- DNS rebinding guard resolves hostname and verifies no resolved IP is internal
- `ALLOWED_API_HOSTS` hardcodes 4 known providers:
  - `api.anthropic.com`
  - `api.openai.com`
  - `generativelanguage.googleapis.com`
  - `dashscope.aliyuncs.com`
- Unknown hosts are allowed but flagged with `baseUrl-redirects-traffic` risk flag

### 5. Agent Prompt Constraints

**File:** `packages/adapters/src/adapter-helpers.ts` → `buildAgentPrompt()`

Agents are pre-instructed with behavioral constraints that affect benchmark fairness:
- "Do NOT install software"
- "Do NOT use EnterPlanMode"
- "Stop after completing the specific task"

These constraints are NOT documented in any task pack authoring guide. Task pack authors must read the source to understand agent behavior boundaries.

## Consequences

- The SAFE_COMMANDS/RISKY_COMMANDS dual layer is non-obvious — a command can be "safe" but still blocked
- Scattered timeout constants across 5 files make it hard to understand the full timeout chain
- The encryption scheme provides confidentiality-at-rest but not integrity against local attackers
- Agent prompt constraints affect benchmark results but are invisible to task pack authors
- `.env.example` was incomplete — see `docs/env-vars.md` for the authoritative reference
