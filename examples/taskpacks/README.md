# Examples

This directory contains task pack examples and test repositories for RepoArena.

## Contents

### Task Packs

- `demo-repo-health.json` / `demo-repo-health.yaml` — starter demo task packs for quick testing
- `official/` — [9 official task packs](./taskpacks/official/README.md) across 3 difficulty tiers (easy, medium, hard)

### Test Repositories

- `repos/nodejs-monorepo/` — a standard Node.js/TypeScript monorepo used by official task packs that include a builtin `repoSource`

## Quick Start

Run a demo benchmark:

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents demo-fast
```

Generate your own task pack:

```bash
node packages/cli/dist/index.js init-taskpack --template repo-health --output repoarena.taskpack.yaml
```

See the [official task pack README](./taskpacks/official/README.md) for detailed descriptions and selection guidance.
