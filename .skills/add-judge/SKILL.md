---
name: add-judge
description: Add a new evaluation judge type so task packs can use it to verify agent correctness. Use when creating a new check, custom validator, or specialized assertion.
---

# Add Judge Type

Add a new judge type to the evaluation system.

## When to Use

- Existing judge types (`command`, `test-result`, `lint-check`, `file-exists`, `file-contains`, `json-value`, `json-schema`, `glob`, `file-count`, `snapshot`, `patch-validation`, `token-efficiency`) don't cover the evaluation need.
- A task pack needs a new kind of automated check.

## Steps

1. Define the type in `packages/core/src/types.ts`:
   - Create `interface XxxJudge` with `id`, `label`, `type: "xxx"`, and judge-specific fields.
   - Add to the `TaskJudge` union type.

2. Implement in `packages/judges/src/index.ts`:
   - Create `runXxxJudge()` returning `Promise<JudgeResult>`.
   - Required return fields: `judgeId`, `label`, `type`, `exitCode`, `success`, `stdout`, `stderr`, `durationMs`, `critical: judge.critical ?? false`.
   - Optional: `passedCount`, `failedCount`, `totalCount`, `warningCount`, `errorCount`.
   - Use `resolveJudgeWorkingDirectory()`, `buildStepEnvironment()`, `executeCommand()` for consistent execution.
   - Add a case to the `runJudge()` dispatch switch.

3. Add loader support in `packages/taskpacks/src/index.ts`:
   - In `normalizeJudge()`, add parsing for `type === "xxx"`.
   - Validate required fields with `assertString()`, `assertOptionalPositiveInteger()`, etc.
   - Add `"xxx"` to the `supportedTypes` array in the error message.

4. If the judge contributes to scoring, add a scoring helper in `packages/report/src/scoring.ts` and wire it into the relevant weight modes.

5. Verify:
   - `pnpm --filter @agentarena/judges build`
   - `pnpm --filter @agentarena/taskpacks build`
   - Create a test task pack YAML using the new judge type and verify it loads.
   - Add a unit test in `tests/judges.test.mjs`.

## What to Check Before Committing

- The judge is dispatched in `runJudge()` — defined but never called is a bug.
- `critical` field defaults to `false` consistently with all other judges.
- Regex patterns (if any) are validated: flags whitelisted, length limited.
- A task pack example and unit test exist for the new type.
