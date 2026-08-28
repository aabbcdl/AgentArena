const test = require("node:test");
const assert = require("node:assert/strict");
const utils = require("../src/utils");

test("capitalizeWords handles words and whitespace", () => {
  assert.equal(utils.capitalizeWords("hello world"), "Hello World");
  assert.equal(utils.capitalizeWords("  multiple   spaces "), "  Multiple   Spaces ");
  assert.equal(utils.capitalizeWords(""), "");
});

test("utility helpers preserve their contracts", () => {
  assert.equal(utils.reverse("arena"), "anera");
  assert.equal(utils.slugify("Hello, Agent Arena"), "hello-agent-arena");
  assert.equal(utils.truncate("abcdef", 3), "abc...");
  assert.equal(utils.truncate("abc", 3), "abc");
});
