---
name: code-review
description: Review git changes with project-specific risk checks layered on top of general senior code review. Use when asked for a code review, merge readiness assessment, or to flag likely regressions.
---

# Code Review

Perform a project-specific review of current changes.

## When to Use

- The user asks for a code review.
- The user wants a merge/readiness assessment.
- The user needs likely regressions flagged.

## Steps

1. Scope the diff: `git status -sb`, `git diff --stat`, `git diff`.
2. Classify touched areas and apply risk checks:

   | Area | What to Check |
   |------|---------------|
   | `packages/adapters/` | preflight/execute contract, capability metadata, registry entry, no duplicate IDs, no secret leakage |
   | `packages/judges/` | all judges return `critical` with a boolean default, regex safety, new type in `TaskJudge` union |
   | `packages/report/` | weight presets sum to 1.0, `getDefaultWeights` is the single source of truth, no duplicate definitions |
   | `packages/runner/` | imports weights from report package (not local copy), no duplicate judge execution, `scoreWeights` written to result |
   | `packages/cli/` | `--score-mode` valid modes match scoring.ts exactly, new params passed through to runner |
   | `packages/taskpacks/` | new enum fields validated, new judge types parsed, `supportedTypes` array updated |
   | `packages/core/` | new interfaces exported, union types updated, backward compatibility (new fields optional) |
   | `apps/web-report/` | weights match backend, default mode = `"practical"`, i18n in both languages, design tokens used |
   | `tests/` | new features have tests, no tests silently skipped |

3. Run automated validation: `pnpm build && pnpm test`.
4. Output findings ordered by severity, with file/line references.

## Stop Conditions

- The review gives generic feedback without checking project-specific risk areas.
- A scoring weight change was reviewed without verifying the sum equals 1.0.
- An adapter or judge change was reviewed without running build + tests.
