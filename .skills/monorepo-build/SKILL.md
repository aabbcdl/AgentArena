---
name: monorepo-build
description: Build the pnpm monorepo correctly respecting inter-package dependencies. Use when building, verifying changes, or troubleshooting build failures.
---

# Monorepo Build

This is a pnpm workspace monorepo with 8 packages. Build order matters.

## When to Use

- Building the project from scratch.
- Verifying that changes in one package don't break dependents.
- Debugging a build failure.
- Adding a new package to the monorepo.

## Package Dependency Chain

```
core (no deps)
  ├── adapters
  ├── judges
  ├── report
  ├── taskpacks
  └── trace
        │
runner → adapters + core + judges + taskpacks + trace
  │
cli → adapters + core + report + runner + taskpacks
```

**Build order**: core → {adapters, judges, report, taskpacks, trace} → runner → cli

## Build Commands

```bash
# Build everything (recommended - respects dependency order)
pnpm build

# Build a single package and its deps
pnpm --filter @agentarena/core build

# Build a specific package only (no dep resolution)
pnpm --filter @agentarena/cli --workspace-concurrency=1 build

# Watch mode for development
# (Configure individually per package if needed)
```

## When You Change a Package

| Changed package | Must also rebuild | Verify with |
|-----------------|-------------------|-------------|
| `core` | Everything | `pnpm build && pnpm test` |
| `adapters` | runner, cli | `pnpm --filter @agentarena/runner build` |
| `judges` | runner | `pnpm --filter @agentarena/runner build` |
| `report` | cli | `pnpm --filter @agentarena/cli build` |
| `taskpacks` | runner, cli | `pnpm --filter @agentarena/runner build` |
| `trace` | runner | `pnpm --filter @agentarena/runner build` |
| `runner` | cli | `pnpm build` |
| `cli` | none (leaf) | `pnpm --filter @agentarena/cli build` |

## Troubleshooting Build Failures

| Error | Likely cause |
|-------|-------------|
| `Cannot find module '@agentarena/...'` | Dependent package not built yet. Run `pnpm build` from root. |
| Type errors referencing another package | That package's dist is stale. Rebuild it. |
| `tsconfig.tsbuildinfo` conflicts | Delete `**/tsconfig.tsbuildinfo` and rebuild. |
| Build succeeds but tests fail | Tests import from `dist/`. Run `pnpm build` first. |

## Adding a New Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `src/`.
2. In `package.json`, set `name` to `@agentarena/<name>`.
3. Add dependencies on other `@agentarena/*` packages.
4. Register in `.changeset/config.json` if it should be versioned.
5. Build: `pnpm install` then `pnpm build`.

## What to Check Before Committing

- `pnpm build` succeeds from root (not just the changed package).
- If public API changed, dependent packages were rebuilt and checked.
- No stale `tsconfig.tsbuildinfo` files in the diff.
