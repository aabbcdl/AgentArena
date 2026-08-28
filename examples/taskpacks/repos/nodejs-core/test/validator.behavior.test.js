const test = require("node:test");
const assert = require("node:assert/strict");
const { isSafePath, sanitizeHtml } = require("../src/validator");

test("validator blocks scripts and traversal", () => {
  assert.equal(sanitizeHtml("<p>ok</p><script>bad()</script>"), "ok");
  assert.equal(isSafePath("reports/result.json", "D:/workspace"), true);
  assert.equal(isSafePath("../../secret.txt", "D:/workspace"), false);
});
