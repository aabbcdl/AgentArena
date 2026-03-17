# RepoArena Runner Docker

RepoArena can run inside a standard Docker-based runner environment to reduce host drift across laptops, CI, and benchmark machines.

## Why use the runner image

The runner image provides a predictable baseline with:
- Node 22
- pnpm 10.6.1
- git
- bash
- Python 3
- jq
- ripgrep

This is useful when you want benchmark runs to depend less on the host machine's toolchain.

## Build the image

```bash
docker build -f Dockerfile.runner -t repoarena-runner .
```

## Open a shell in the runner

```bash
docker run --rm -it \
  -v "$PWD:/workspace" \
  -w /workspace \
  repoarena-runner
```

## Use docker compose

```bash
docker compose -f docker-compose.runner.yml run --rm repoarena-runner bash
```

## Typical workflow inside the container

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
node packages/cli/dist/index.js run \
  --repo . \
  --task examples/taskpacks/demo-repo-health.yaml \
  --agents demo-fast \
  --output .repoarena/docker-run
```

## Notes

- This image is intended as a reproducible execution shell, not a published production service.
- External agent CLIs such as Codex, Claude Code, or Cursor may still require additional authentication or host-specific setup.
- For browser-level smoke tests in CI, use Playwright separately because browser dependencies are heavier than the default runner image.
