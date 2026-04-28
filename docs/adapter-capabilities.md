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

### External Coding Agents

| Adapter | Tier | Invocation | Tokens | Cost | Trace |
| --- | --- | --- | --- | --- | --- |
| `codex` | supported | Codex CLI JSON event stream | available | unavailable | full |
| `claude-code` | experimental | Claude Code CLI stream-json mode | available | available | partial |
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
