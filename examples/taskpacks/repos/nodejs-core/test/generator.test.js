const test = require("node:test");
const assert = require("node:assert/strict");
const { renderSummary } = require("../src/generator");

test("summary rendering is deterministic", () => {
  assert.equal(renderSummary({ name: "AgentArena", count: 3 }), "Report: AgentArena\nItems: 3\n");
});
