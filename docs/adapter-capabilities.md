# Adapter Capabilities

RepoArena classifies adapters by **support tier** and exposes a capability matrix in `doctor`, `list-adapters`, JSON summaries, and reports.

## Support Tiers

- `supported`: verified standard integration path with stable enough local automation.
- `experimental`: usable, but sensitive to local auth, CLI flag changes, or install layout.
- `blocked`: intentionally not treated as stable automation today.

## Current Matrix

| Adapter | Tier | Invocation | Tokens | Cost | Trace |
| --- | --- | --- | --- | --- | --- |
| `demo-fast`, `demo-thorough`, `demo-budget` | supported | Built-in RepoArena demo adapter | estimated | estimated | partial |
| `codex` | supported | Codex CLI JSON event stream | available | unavailable | full |
| `claude-code` | experimental | Claude Code CLI stream-json mode | available | available | partial |
| `cursor` | experimental | Cursor internal claude-agent-sdk CLI bridge | available | available | partial |

## Why This Exists

The capability matrix prevents false precision. RepoArena can compare agents honestly only if the report makes capability differences visible instead of hiding them.
