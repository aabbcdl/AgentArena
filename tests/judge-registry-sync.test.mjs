import assert from "node:assert/strict";
import test from "node:test";
import { judgeTypeRegistry } from "../packages/core/dist/index.js";
import "../packages/judges/dist/index.js";
import { JUDGE_NORMALIZERS } from "../packages/taskpacks/dist/index.js";

test("judgeTypeRegistry types match JUDGE_NORMALIZERS keys", () => {
  const registryTypes = new Set(judgeTypeRegistry.getAllTypes());
  const normalizerTypes = new Set(Object.keys(JUDGE_NORMALIZERS));

  const missingFromNormalizers = [...registryTypes].filter((t) => !normalizerTypes.has(t));
  const missingFromRegistry = [...normalizerTypes].filter((t) => !registryTypes.has(t));

  assert.deepEqual(
    missingFromNormalizers,
    [],
    `Types registered in judgeTypeRegistry but missing from JUDGE_NORMALIZERS: ${missingFromNormalizers.join(", ")}`
  );

  assert.deepEqual(
    missingFromRegistry,
    [],
    `Types in JUDGE_NORMALIZERS but not registered in judgeTypeRegistry: ${missingFromRegistry.join(", ")}`
  );

  assert.equal(registryTypes.size, normalizerTypes.size);
});
