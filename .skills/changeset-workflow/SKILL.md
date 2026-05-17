---
name: changeset-workflow
description: Create and manage changesets for versioning with @changesets/cli. Use when making changes that need a changelog entry, preparing a release, or managing package versions.
---

# Changeset Workflow

This project uses [@changesets/cli](https://github.com/changesets/changesets) for version management and changelog generation.

## When to Use

- You've made a code change that should be recorded for the next release.
- You're preparing a new version / publishing.
- You need to understand how version bumps work in this monorepo.

## Package Bumping Rules

| Package | Location | Bump when... |
|---------|----------|-------------|
| `@agentarena/core` | `packages/core/` | Types, utils, or infrastructure change |
| `@agentarena/adapters` | `packages/adapters/` | Adapter added/modified, adapter API changes |
| `@agentarena/judges` | `packages/judges/` | New judge type added, judge behavior changes |
| `@agentarena/runner` | `packages/runner/` | Lifecycle, concurrency, or workspace changes |
| `@agentarena/report` | `packages/report/` | Report format, scoring, or template changes |
| `@agentarena/taskpacks` | `packages/taskpacks/` | Task pack loading, validation, or normalization |
| `@agentarena/trace` | `packages/trace/` | Trace recording or replay changes |
| `@agentarena/cli` | `packages/cli/` | CLI commands, args, or server changes |

## Creating a Changeset

After making changes, run:

```bash
pnpm changeset
```

This interactive CLI will:
1. Prompt which packages have changed (select with space).
2. Ask for the bump type: `major` / `minor` / `patch`.
3. Ask for a summary of the change.

The summary becomes the changelog entry. Write it for end-users, not for yourself:

```text
✅ Good: "Added --token-budget flag to limit agent token usage per run"
❌ Bad: "Refactored args.ts to use a builder pattern"
```

A `.md` file is created in `.changeset/`. Commit this file alongside your code changes.

## Bump Type Guidelines

| Bump | When | Example |
|------|------|---------|
| `major` | Breaking API change | Renamed `runJudge()` signature |
| `minor` | New feature, backward compatible | Added new adapter, new judge type |
| `patch` | Bug fix, internal refactor | Fixed timeout handling, improved error message |

For this project, most changes are `patch` or `minor`. `major` bumps should be rare and discussed.

## Consuming Changesets

Changesets accumulate until consumed:

```bash
# Version all packages with pending changesets
pnpm version-packages

# Publish to npm (also removes consumed changeset files)
pnpm release
```

## What to Check Before Committing

- A changeset file exists if the change affects runtime behavior.
- The changeset summary is clear and user-facing.
- Multiple changesets for the same change are not created (one changeset per logical change).
- Changeset files from previous releases have been consumed (not stale).
