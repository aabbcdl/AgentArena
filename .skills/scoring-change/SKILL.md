---
name: scoring-change
description: Modify scoring logic, weight presets, or score modes. Use when adding/changing scoring modes, adjusting weights, fixing score calculation bugs, or adding new score components.
---

# Scoring Change

Modify the benchmark scoring system. Weight definitions must live in a single source of truth.

## When to Use

- Adding a new scoring mode (e.g. a new way to weight metrics).
- Adjusting weights of an existing mode.
- Adding a new score component (e.g. a new metric that should influence the composite score).
- Fixing a score calculation bug.

## Steps

1. **Single source of truth**: All weight presets are in `packages/report/src/scoring.ts`:
   - `PRACTICAL_WEIGHTS`, `BALANCED_WEIGHTS`, `ISSUE_RESOLUTION_WEIGHTS`, `EFFICIENCY_FIRST_WEIGHTS`, `ROTATING_TASKS_WEIGHTS`, `COMPREHENSIVE_WEIGHTS`.
   - `getDefaultWeights(scoreMode: string)` is the ONLY function that maps mode → weights.

2. To add a new scoring mode:
   - Add a weight constant in `scoring.ts`. **Sum must equal 1.0.**
   - Add a case in `getDefaultWeights()`.
   - Add a case in `computeCompositeScore()` to apply the weights.
   - If new score components are introduced, add helper functions (e.g. `resolutionRateScore()`, `tokenEfficiencyScoreComponent()`).

3. Runner sync (`packages/runner/src/index.ts`):
   - Import `getDefaultWeights` from `@agentarena/report` — never redefine weights locally.
   - Use it when building `BenchmarkRun.scoreWeights`.

4. Web UI sync (`apps/web-report/src/view-model.js`):
   - `DEFAULT_SCORE_WEIGHTS` must match backend `PRACTICAL_WEIGHTS` exactly.
   - `SCORE_WEIGHT_PRESETS` must include all modes from `scoring.ts`.
   - Any weight change in `scoring.ts` must be mirrored in `view-model.js`.

5. CLI sync (`packages/cli/src/args.ts`):
   - Add the new mode to `validModes` in `--score-mode` validation.
   - Update the help text.

6. Verify all weight sums = 1.0 by manual addition. The normalization code will mask non-1.0 sums but will produce confusing scores.

7. Run `pnpm build && pnpm test` — scoring tests must pass for all modes.

## What to Check Before Committing

- Every weight preset sums to exactly 1.0.
- `getDefaultWeights()` handles the new mode.
- Web UI weights match backend weights.
- CLI validation includes the new mode.
- At least one test exercises the new mode or component.
