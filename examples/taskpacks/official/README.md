# Official Task Packs

This directory contains the first-party task pack library maintained by RepoArena.

## Included Packs

- `repo-health.yaml`
- `failing-test-fix.yaml`
- `snapshot-fix.yaml`
- `config-repair.yaml`
- `small-refactor.yaml`
- `json-contract-repair.yaml`

## Design Rules

- Every official task pack includes metadata describing purpose, repo types, dependencies, and judge rationale.
- Official packs should favor a small number of interpretable judges over large opaque command chains.
- Official packs are intended to be loaded directly or copied into repository-specific variants.
