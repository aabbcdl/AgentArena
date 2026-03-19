# CLAUDE.md

RepoArena — local-first benchmark and replay tool for comparing AI coding agents in real repositories.

## Tech Stack

- pnpm monorepo, Node >= 22, TypeScript
- `apps/web-report`: vanilla JS SPA (no framework, no bundler), PWA with service worker
- Build: `pnpm -r build` (TypeScript compilation + file copy for web-report)
- i18n: `apps/web-report/src/i18n.js` exports `translate()` and `localizeText()`, app.js wraps them as `t()` and `localText()`

## Packages

| Package | Purpose |
|---------|---------|
| `packages/cli` | CLI entry point: `ui`, `run`, `doctor`, `init-taskpack`, `init-ci`, `list-adapters` |
| `packages/core` | Shared types and utilities |
| `packages/runner` | Benchmark orchestrator |
| `packages/adapters` | Agent adapters (demo-fast, demo-thorough, demo-budget, codex, claude-code, cursor) |
| `packages/judges` | Judge implementations (command, file-exists, file-contains, glob, file-count, snapshot, json-value, json-schema) |
| `packages/taskpacks` | Task pack loader and validator |
| `packages/trace` | Execution trace recorder |
| `packages/report` | Report generators (JSON, Markdown, HTML, badge) |
| `apps/web-report` | Interactive benchmark UI served by `repoarena ui` |

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
REPOARENA_RUN_BROWSER_SMOKE=1 pnpm test:web-report:e2e
```

## Code Conventions

- ES modules throughout (`import`/`export`, no CommonJS)
- web-report uses no framework — state object + render functions + DOM event delegation
- All user-facing strings in web-report go through `t(key)` or `localText(zh, en)` for i18n
- Task packs are YAML or JSON, schema version `repoarena.taskpack/v1`
- Tests use Node's built-in test runner (`node --test`)
- Playwright E2E tests are gated behind `REPOARENA_RUN_BROWSER_SMOKE=1` env var

## Testing

- Unit tests: `tests/*.test.mjs` — run with `pnpm test`
- E2E tests: `tests/web-report.e2e.mjs` — run with `pnpm test:web-report:e2e`
- CI runs both unit tests and a smoke benchmark in GitHub Actions
