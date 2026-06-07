# ADR-002: Judge Type Registration Sync Contract

**Status:** Accepted
**Date:** 2026-06-07
**Deciders:** Original author

## Context

Adding a new judge type requires coordinated changes across **3 packages and 5 files**. The sync contract is only documented in a comment block inside `packages/judges/src/index.ts` (lines 30-46). Missing any step causes silent failures at runtime.

## Decision

### The 6-Step Procedure

To add a new judge type (e.g., `my-judge`):

1. **Define the TypeScript interface** in `packages/core/src/types/judge.ts`
   - Create `MyJudgeConfig` interface
   - Add `"my-judge"` to the `TaskJudge` discriminated union

2. **Register in the judge type registry** in `packages/judges/src/index.ts`
   ```ts
   judgeTypeRegistry.register({
     type: "my-judge",
     allowedFields: new Set([...COMMON_JUDGE_FIELDS, "myField1", "myField2"]),
     isCriticalByDefault: false  // or true if failure should block the benchmark
   });
   ```
   - `allowedFields` must exactly match the fields accessed by the normalizer in step 3
   - `isCriticalByDefault` controls whether the judge is critical when the task pack omits the `critical` field

3. **Add a normalizer** in `packages/taskpacks/src/normalizers.ts` → `JUDGE_NORMALIZERS`
   - This normalizer transforms raw YAML/JSON task pack input into the typed judge object
   - Fields accessed here MUST match `allowedFields` from step 2

4. **Implement the runner** in `packages/judges/src/judges/my-judge.ts`
   - Export a `runMyJudge(judge, workspacePath, ...)` function
   - Must return `JudgeResult`

5. **Add the switch case** in `packages/judges/src/index.ts` → `runJudge()`
   ```ts
   case "my-judge":
     result = await runMyJudge(judge, workspacePath);
     break;
   ```

6. **Update the test expectation array** in `tests/judge-registry-sync.test.mjs`
   - Add `"my-judge"` to the `EXPECTED_JUDGE_TYPES` array
   - This is a **third copy** of the judge type list that must be kept in sync

### Three-Way Sync Points

| Artifact | Location | What Must Match |
|----------|----------|-----------------|
| TypeScript union | `packages/core/src/types/judge.ts` | All judge type string literals |
| Registry calls | `packages/judges/src/index.ts` | `type` field in each `register()` call |
| Test expectation | `tests/judge-registry-sync.test.mjs` | `EXPECTED_JUDGE_TYPES` array |

### allowedFields ↔ Normalizer Sync

The `allowedFields` Set in the registry must exactly match the fields accessed by the corresponding normalizer in `packages/taskpacks/src/normalizers.ts`:

- If `allowedFields` has a field the normalizer doesn't access → harmless (field silently ignored)
- If the normalizer accesses a field not in `allowedFields` → **task pack loading rejects the field** with "unrecognized field" error

### isCriticalByDefault

This value is **only defined in the registry** — it does not appear in the TypeScript type definition or the task pack schema. When a task pack omits `critical: true/false`, this default determines whether the judge is critical.

## Consequences

- Missing any of the 6 steps causes a specific failure mode:
  - Missing step 1 → TypeScript compile error (caught early)
  - Missing step 2 → unknown judge type error at runtime
  - Missing step 3 → task pack loading rejects valid fields
  - Missing step 4 → import error (caught early)
  - Missing step 5 → `default` branch in switch produces "Unknown judge" failure
  - Missing step 6 → CI test failure (judge-registry-sync.test.mjs)
- The `allowedFields`/normalizer mismatch is the hardest to debug — it manifests as "unrecognized field" during task pack loading, not during judge execution
- `isCriticalByDefault` has no documentation outside the registry code

## Reference

- Registry: `packages/judges/src/index.ts` lines 48-62
- Normalizers: `packages/taskpacks/src/normalizers.ts` → `JUDGE_NORMALIZERS`
- Sync test: `tests/judge-registry-sync.test.mjs`
