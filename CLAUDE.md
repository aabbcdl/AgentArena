---
description: 
alwaysApply: true
---

# CLAUDE.md

AgentArena — local-first benchmark and replay tool for comparing AI coding agents in real repositories.

## Tech Stack

- pnpm monorepo, Node >= 22, TypeScript
- Linting: [Biome](https://biomejs.dev/) (linter only, formatter disabled) — config in `biome.json`
- `apps/web-report`: vanilla JS SPA (no framework, no bundler), PWA with service worker
- Build: `pnpm -r build` (TypeScript compilation + file copy for web-report)
- i18n: `apps/web-report/src/i18n.js` exports `translate()` and `localizeText()`, app.js wraps them as `t()` and `localText()`

## Packages

| Package | Purpose |
|---------|---------|
| `packages/cli` | CLI entry point: `ui`, `run`, `doctor`, `init-taskpack`, `init-ci`, `list-adapters` |
| `packages/core` | Shared types and utilities |
| `packages/runner` | Benchmark orchestrator |
| `packages/adapters` | Agent adapters (demo-fast, demo-thorough, demo-budget, codex, claude-code, cursor, gemini-cli, copilot, qwen-code, kilo-cli, opencode, trae, augment) |
| `packages/judges` | Judge implementations (command, test-result, lint-check, file-exists, file-contains, regex-match, directory-exists, compilation, glob, file-count, snapshot, patch-validation, token-efficiency, json-value, json-schema) |
| `packages/taskpacks` | Task pack loader and validator |
| `packages/trace` | Execution trace recorder |
| `packages/report` | Report generators (JSON, Markdown, HTML, badge) |
| `apps/web-report` | Interactive benchmark UI served by `agentarena ui` |

## Common Commands

```bash
pnpm install          # install dependencies
pnpm build            # build all packages
pnpm test             # build + run unit tests (node --test)
pnpm lint             # lint all packages
pnpm typecheck        # type-check all packages
pnpm doctor           # check adapter readiness with auth probing
```

E2E tests (requires Playwright Chromium):

```bash
npx playwright install --with-deps chromium
AGENTARENA_RUN_BROWSER_SMOKE=1 pnpm test:web-report:e2e
```

## Code Conventions

- ES modules throughout (`import`/`export`, no CommonJS)
- web-report uses no framework — state object + render functions + DOM event delegation
- All user-facing strings in web-report go through `t(key)` or `localText(zh, en)` for i18n
- Task packs are YAML or JSON, schema version `agentarena.taskpack/v1`
- Tests use Node's built-in test runner (`node --test`)
- Playwright E2E tests are gated behind `AGENTARENA_RUN_BROWSER_SMOKE=1` env var

## Testing

- Unit tests: `tests/*.test.mjs` — run with `pnpm test`
- E2E tests: `tests/web-report.e2e.mjs` — run with `pnpm test:web-report:e2e`
- CI runs both unit tests and a smoke benchmark in GitHub Actions

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **RepoArena** (6666 symbols, 11746 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/RepoArena/context` | Codebase overview, check index freshness |
| `gitnexus://repo/RepoArena/clusters` | All functional areas |
| `gitnexus://repo/RepoArena/processes` | All execution flows |
| `gitnexus://repo/RepoArena/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
