# Contributing to AgentArena

Thanks for your interest in contributing!

## Setup

```bash
git clone https://github.com/aabbcdl/AgentArena.git
cd AgentArena
pnpm install
pnpm build
```

Requires Node >= 22 and pnpm 10.6.1+.

## Development Workflow

```bash
pnpm build        # build all packages
pnpm test         # run unit tests
pnpm lint         # lint
pnpm typecheck    # type-check
```

Run the web report locally:

```bash
node packages/cli/dist/index.js ui
```

## Testing

Unit tests use Node's built-in test runner:

```bash
pnpm test
```

E2E browser tests (requires Playwright Chromium):

```bash
npx playwright install --with-deps chromium
pnpm test:web-report:e2e
```

## Project Structure

See [CLAUDE.md](./CLAUDE.md) for a package-by-package overview.

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm build && pnpm test` to verify nothing breaks
4. Open a PR against `main`

CI will run lint, typecheck, unit tests, browser smoke tests, and a smoke benchmark automatically.

## Code Style

- Linting uses [Biome](https://biomejs.dev/) — run `pnpm lint` (config: `biome.json`, formatter disabled, linter only)
- ES modules (`import`/`export`) throughout
- `apps/web-report` is vanilla JS — no frameworks, no bundler
- All user-facing strings in web-report use `t(key)` or `localText(zh, en)` for i18n
- Tests use `node:test` — no external test framework

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
