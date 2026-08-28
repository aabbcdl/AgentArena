# Examples

This directory contains task pack examples and test repositories for AgentArena.

## Contents

### Task Packs

- `demo-repo-health.json` / `demo-repo-health.yaml` - starter demo task packs for quick testing
- `official/` - [10 core task packs](./official/README.md) for the first Codex/Claude Code comparison release. Historical and experimental YAML files remain in the same directory but are excluded from the first-release catalog.

### Test Repositories

- `repos/nodejs-core/` - the dependency-free, deterministic fixture used by every first-release core task pack
- `repos/nodejs-app/` and `repos/nodejs-monorepo/` - legacy fixtures retained for historical examples

## Quick Start

Run a demo benchmark:

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents demo-fast
```

Generate your own task pack:

```bash
node packages/cli/dist/index.js init-taskpack --template repo-health --output agentarena.taskpack.yaml
```

See the [official task pack README](./official/README.md) for core task descriptions and lifecycle guidance.
