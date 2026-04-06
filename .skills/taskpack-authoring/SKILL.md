---
name: taskpack-authoring
description: Author or modify a task pack YAML that defines benchmark tasks. Use when creating new tasks, editing existing ones, or configuring metadata.
---

# Task Pack Authoring

Create or edit task pack YAML files.

## When to Use

- Creating a new benchmark task from scratch.
- Editing an existing task's prompt, judges, or metadata.
- Adding judges or configuring metadata.

## Structure

Required top-level fields: `schemaVersion`, `id`, `title`, `prompt`, `metadata`, `envAllowList`, `setupCommands`, `judges`, `teardownCommands`.

Start from an example in `examples/taskpacks/official/` rather than writing from scratch.

## Judge Types

12 types available: `command`, `test-result`, `lint-check`, `file-exists`, `file-contains`, `json-value`, `json-schema`, `glob`, `file-count`, `snapshot`, `patch-validation`, `token-efficiency`.

Each judge requires at minimum: `type`, `label`, and type-specific fields. All judges support optional `critical: true`.

## Metadata

Key optional fields: `difficulty` (`easy`/`medium`/`hard`), `interactionModel` (`single-turn`/`multi-turn`), `requirementClarity` (`precise`/`fuzzy`/`ambiguous`), `tokenBudget`, `taskCategories`, `antiContamination`, `githubIssue`, `failToPassTests`, `passToPassTests`.

## Steps

1. Copy an existing example from `examples/taskpacks/official/`.
2. Edit `id`, `title`, `prompt`, and judges for the new task.
3. Validate enum fields match allowed values exactly.
4. Smoke test: `repoarena run --repo . --task <path>.yaml --agents demo-fast`.

## What to Check Before Committing

- All required fields present.
- Enum values match allowed options exactly.
- Judges reference commands/files that exist in the target repo.
- A smoke test passes without errors.
