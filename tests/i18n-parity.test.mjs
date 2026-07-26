import assert from "node:assert/strict";
import test from "node:test";
import { MESSAGES } from "../apps/web-report/dist/i18n.js";
import { copy } from "../apps/web-report/workbench/src/i18n.ts";

/**
 * i18n key-parity guards. These catch translation drift mechanically so a new
 * key added to one language (or one UI) but not the other cannot ship silently.
 *
 * translate()/localizeText() fall back to the raw key when a key is missing in
 * the resolved language, so a missing translation renders the literal key to
 * the user.
 */

test("legacy i18n: every English key has a zh-CN translation", () => {
  const en = Object.keys(MESSAGES.en);
  const zh = new Set(Object.keys(MESSAGES["zh-CN"]));
  const enOnly = en.filter((key) => !zh.has(key));
  assert.deepEqual(enOnly, [], `English-only keys would render raw to zh-CN users: ${enOnly.join(", ")}`);
});

test("workbench i18n: en and zh-CN key sets are identical", () => {
  const en = new Set(Object.keys(copy.en));
  const zh = new Set(Object.keys(copy["zh-CN"]));
  const enOnly = [...en].filter((key) => !zh.has(key));
  const zhOnly = [...zh].filter((key) => !en.has(key));
  assert.deepEqual(enOnly, [], `Workbench en-only keys: ${enOnly.join(", ")}`);
  assert.deepEqual(zhOnly, [], `Workbench zh-only keys: ${zhOnly.join(", ")}`);
});
