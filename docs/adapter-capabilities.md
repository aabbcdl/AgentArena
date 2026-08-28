# Adapter Capabilities

AgentArena classifies adapters by **support tier** and exposes a capability matrix in `doctor`, `list-adapters`, JSON summaries, and reports.

## Support Tiers

- `supported`: verified standard integration path with stable enough local automation.
- `experimental`: usable, but sensitive to local auth, CLI flag changes, or install layout.
- `blocked`: intentionally not treated as stable automation today.

## Current Matrix

### Demo Adapters

| Adapter | Tier | Invocation | Tokens | Cost | Trace |
| --- | --- | --- | --- | --- | --- |
| `demo-fast` | supported | Built-in AgentArena demo adapter | estimated | estimated | partial |
| `demo-thorough` | supported | Built-in AgentArena demo adapter | estimated | estimated | partial |
| `demo-budget` | supported | Built-in AgentArena demo adapter | estimated | estimated | partial |

### First-version External Harnesses

| Adapter | Tier | Invocation | Tokens | Cost | Trace |
| --- | --- | --- | --- | --- | --- |
| `codex` | supported | Codex CLI JSON event stream | available | unavailable | full |
| `claude-code` | experimental | Claude Code CLI stream-json mode | available | available | partial |

These are the only external Harnesses shown by the default Workbench, `doctor`, `list-adapters`, detection, and install-guide surfaces. Demo adapters remain available for examples and tests but never enter a real Harness comparison.

For the local pilot, install only the external CLI you intend to use and log
that CLI in separately. AgentArena core does not require Android Studio, Docker,
Xcode, or Playwright Chromium; Chromium is a browser-test prerequisite only.
Unknown token or cost data remains unknown in the UI and reports; it is never
presented as zero or free.

### Legacy Explicit-only Adapters

The following adapters remain registered for CLI compatibility and development. They are not part of the first-version product surface and must be selected explicitly by ID.

| Adapter | Tier | Invocation | Tokens | Cost | Trace |
| --- | --- | --- | --- | --- | --- |
| `cursor` | experimental | Cursor internal claude-agent-sdk CLI bridge | available | available | partial |
| `gemini-cli` | experimental | Gemini CLI JSON event stream | available | available | partial |
| `aider` | experimental | Aider CLI with git integration | unavailable | unavailable | minimal |
| `copilot` | experimental | GitHub Copilot CLI agent mode | unavailable | unavailable | minimal |
| `kilo-cli` | experimental | Kilo CLI JSON output | available | available | partial |
| `opencode` | experimental | OpenCode CLI output | available | unavailable | partial |
| `qwen-code` | experimental | Qwen Code CLI JSON output | available | unavailable | partial |
| `trae` | experimental | Trae CLI event stream | available | unavailable | partial |
| `augment` | experimental | Augment CLI JSON events | available | available | partial |
| `windsurf` | blocked | Windsurf CLI (auth stability issues) | unavailable | unavailable | minimal |

## RuntimeProfile Configuration Modes

The Workbench persists AgentArena-owned `RuntimeProfile` metadata and Secrets without rewriting `~/.codex/config.toml`, `~/.claude/settings.json`, or the user's configured `CODEX_HOME` / `CLAUDE_CONFIG_DIR`.

- `inherit-local` uses the same command, host environment, login state, user/project instructions, Skills, MCP, Hooks, and settings sources that the normal CLI sees. AgentArena freezes their non-secret identities before a run.
- Codex verification and execution clone the behaviorally relevant user inputs into a disposable shadow `CODEX_HOME`. Local mode copies `config.toml`, `auth.json`, `AGENTS.md`, `AGENTS.override.md`, `rules`, and `skills`; managed mode omits `auth.json`. Codex state writes remain in the shadow Home and the directory is removed after the child process exits. RuntimeProfile LaunchSpecs use `workspace-write` with `approval_policy=never` on Unix; Windows uses the existing `danger-full-access` bypass because the npm Codex sandbox helper is not reliable on all installations. Both modes remain bounded to AgentArena's disposable workspace.
- `managed-provider` keeps the inherited Harness and overrides Provider URL, requested model, mappings, and Secret only in the task child process. It removes inherited Provider credentials and alternate cloud-routing switches before applying the selected Profile while preserving ordinary host environment fields. Codex uses task-scoped `-c` arguments and an in-memory Secret binding. Claude uses task-scoped environment overrides and `--setting-sources user,project,local`; it does not create a replacement `CLAUDE_CONFIG_DIR` or delete repository tool configuration.
- Harness snapshots are scoped to the selected CLI: Codex changes do not invalidate Claude receipts and vice versa. Behavioral configuration and stable account/credential identity are tracked; launcher session IDs, usage counters, token refreshes, and unrelated repository history are ignored. Snapshot entries contain hashes and presence markers, never configuration, environment, or credential plaintext.
- Claude background execution requires a CLI version that supports `--permission-mode dontAsk`. Tools that need interactive approval are denied. AgentArena never adds `--dangerously-skip-permissions` and ignores the removed `AGENTARENA_SKIP_PERMISSIONS` legacy variable.
- Verification receipts keep bounded, redacted evidence. All frozen environment override values, task Secrets, Provider routes, network hosts, and runtime paths are removed; when a CLI emits a structured terminal error, the receipt stores that error instead of the complete event stream.
- The old launcher/API for Claude-only Provider profiles remains a compatibility path and still uses temporary isolated configuration. New work should use Workbench RuntimeProfiles.

Installation detection is not task readiness. A Profile becomes `Task Ready` only after installation, sentinel conversation, and exact disposable-repository edit stages all pass for the current repository identity.

## Capability Definitions

### Token Availability

- `available`: Adapter emits token usage data in its event stream.
- `estimated`: Token usage is approximated from output size (may vary by ±50%).
- `unavailable`: No token data available without API access.

### Cost Availability

- `available`: Adapter reports cost in USD as part of its output.
- `estimated`: Cost is synthetic, based on token estimates and public API pricing.
- `unavailable`: Cost cannot be determined without API access.

### Trace Richness

- `full`: Structured event stream with per-message tokens, file changes, and metadata.
- `partial`: Some structured data available (e.g., final summary only).
- `minimal`: Only stdout/stderr capture; no structured events.

## Why This Exists

The capability matrix prevents false precision. AgentArena can compare agents honestly only if the report makes capability differences visible instead of hiding them.

## Adding New Adapters

To add a new adapter:

1. Create a new file in `packages/adapters/src/<name>-adapter.ts`
2. Implement the `AgentAdapter` interface (preflight + execute)
3. Register it in `packages/adapters/src/adapter-registry.ts`
4. Update this document with the new adapter's capabilities
5. Add the adapter ID to `agentarena list-adapters` output verification
