const test = require("node:test");
const assert = require("node:assert/strict");
const { createLogger } = require("../src/logger");

test("logger keeps level and context behavior stable", () => {
  const lines = [];
  const logger = createLogger("fixture", { level: "info", context: { requestId: "baseline" }, sink: (line) => lines.push(line) });
  logger.debug("hidden");
  logger.info("visible", { operation: "read" });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /requestId/);
  assert.match(lines[0], /operation/);
});
