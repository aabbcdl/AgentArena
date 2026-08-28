const test = require("node:test");
const assert = require("node:assert/strict");
const calculator = require("../src/calculator");

test("calculator arithmetic", () => {
  assert.equal(calculator.add(2, 3), 5);
  assert.equal(calculator.subtract(9, 4), 5);
  assert.equal(calculator.multiply(-2, 3), -6);
  assert.equal(calculator.divide(7, 2), 3.5);
  assert.equal(calculator.power(2, 3), 8);
});

test("calculator rejects invalid operations", () => {
  assert.throws(() => calculator.divide(1, 0), RangeError);
  assert.throws(() => calculator.power(2, -1), RangeError);
});
