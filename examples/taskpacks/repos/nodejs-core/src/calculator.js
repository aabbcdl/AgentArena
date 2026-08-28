function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}

function divide(a, b) {
  if (b === 0) throw new RangeError("Cannot divide by zero");
  return a / b;
}

function power(base, exponent) {
  if (exponent < 0) throw new RangeError("Exponent must be non-negative");
  return exponent === 0 ? 1 : base * power(base, exponent - 1);
}

module.exports = { add, subtract, multiply, divide, power };
