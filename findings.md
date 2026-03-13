# Findings

## Repository State
- `D:\project\AgentArena` started effectively empty.
- The directory was not initially a git repository.

## Product Insight
- The strongest wedge is not "build a better coding agent".
- The stronger wedge is "be the neutral arena for all coding agents inside real repos".

## Naming Insight
- The product name is `RepoArena`.
- The repo-native benchmark wedge is the same, but the brand collision risk is much lower.

## MVP Insight
- MVP should avoid hosted infra, public governance, and enterprise concerns.
- The first release should let a developer benchmark multiple agents locally on a real repo and export a shareable report.

## Architecture Insight
- A TypeScript monorepo is the most practical fit for:
  - CLI orchestration
  - adapter contracts
  - trace serialization
  - local web report rendering
- JSONL traces plus static HTML output are enough for the first runnable slice.

## Implementation Insight
- The first trustworthy slice should use built-in demo adapters rather than pretend real vendor integrations already exist.
- A repo copy plus snapshot diff is enough to validate the benchmark loop before adding Docker or git worktree isolation.
- Workspaces must live outside the repo tree because Node will not copy a directory into one of its own descendants.
- On Windows, the reliable way to invoke Codex from Node is `node <global codex.js>`, not the default PowerShell wrapper.
- Claude Code's `stream-json` mode requires `--verbose`, and local auth failures can be surfaced cleanly inside the benchmark summary.
- Cursor's public `cursor agent` CLI is not a reliable automation surface on this install, but its bundled `cursor-agent/dist/claude-agent-sdk/cli.js` works as a non-interactive bridge.
- A useful v0 benchmark needs a preflight layer, not just adapter execution, so users can tell the difference between "agent lost the task" and "local environment was never ready".

## Growth Insight
- The fastest adoption loop is:
  1. run on your own repo
  2. export a clear result card
  3. share it publicly
  4. provoke comparison and community contributions
