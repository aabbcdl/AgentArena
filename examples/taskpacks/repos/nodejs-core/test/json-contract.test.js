const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { validateResponse } = require("../src/json-contract");

test("fixture response satisfies the JSON contract", () => {
  const response = JSON.parse(fs.readFileSync("fixtures/response.json", "utf8"));
  assert.equal(validateResponse(response), true);
});

test("contract rejects extra or malformed fields", () => {
  assert.equal(validateResponse({ status: "ready", items: [], requestId: "x", extra: true }), false);
  assert.equal(validateResponse({ status: "ready", items: [{ id: 1, value: 2 }], requestId: "x" }), false);
});
