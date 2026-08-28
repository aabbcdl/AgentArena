const test = require("node:test");
const assert = require("node:assert/strict");
const { createCache } = require("../src/cache");

test("cache stores, reads and clears values", () => {
  const cache = createCache({ ttlMs: 1000 });
  cache.set("key", "value");
  assert.equal(cache.get("key"), "value");
  assert.equal(cache.size(), 1);
  cache.clear();
  assert.equal(cache.size(), 0);
});

test("cache validates options", () => {
  assert.throws(() => createCache({ ttlMs: 0 }), TypeError);
});
