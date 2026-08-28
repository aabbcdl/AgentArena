import { rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function write(relativePath, value) {
  await writeFile(path.join(root, relativePath), value, "utf8");
}

async function replace(relativePath, expected, replacement) {
  const source = await read(relativePath);
  if (!source.includes(expected)) {
    throw new Error(`Fault injection anchor not found in ${relativePath}`);
  }
  await write(relativePath, source.replace(expected, replacement));
}

const taskId = process.argv[2];
switch (taskId) {
  case "repo-health":
    await replace(
      "src/utils.js",
      "return value.replace(/\\b\\w/g, (character) => character.toUpperCase());",
      "return value.charAt(0).toUpperCase() + value.slice(1);"
    );
    break;
  case "config-repair":
    await write("fixtures/config.json", `${JSON.stringify({
      server: { host: "127.0.0.1", port: "3000" },
      database: { url: "file:arena.db", poolSize: -2 },
      mode: "production",
      version: "1.0.0"
    }, null, 2)}\n`);
    break;
  case "json-contract-repair":
    await write("fixtures/response.json", `${JSON.stringify({
      status: "pending",
      items: [{ id: "alpha", value: "1" }],
      requestId: "",
      extra: true
    }, null, 2)}\n`);
    break;
  case "snapshot-fix":
    await replace("src/generator.js", "return `Report: ${input.name}\\nItems: ${input.count}\\n`;", "return `Summary: ${input.name}\\nItems: ${input.count}\\n`;");
    break;
  case "failing-test-fix":
    await replace("src/calculator.js", "return a - b;", "return a + b;");
    break;
  case "add-feature-with-tests":
    await write("src/memoize.js", "function memoize() { return undefined; }\n\nmodule.exports = { memoize };\n");
    await replace(
      "src/index.js",
      "};\n",
      "};\n\nmodule.exports.memoize = require(\"./memoize\").memoize;\n"
    );
    break;
  case "logging-improvement":
    await write("src/logger.js", `function createLogger(scope, options = {}) {
  const sink = options.sink || console.log;
  return {
    debug(message) { sink(\`[DEBUG] \${scope} \${message}\`); },
    info(message) { sink(\`[INFO] \${scope} \${message}\`); },
    warn(message) { sink(\`[WARN] \${scope} \${message}\`); },
    error(message) { sink(\`[ERROR] \${scope} \${message}\`); }
  };
}

module.exports = { LEVELS: { debug: 10, info: 20, warn: 30, error: 40 }, createLogger };
`);
    break;
  case "input-validation":
    await write("src/validator.js", `function sanitizeHtml(value) {
  return String(value ?? "");
}

function isSafePath() {
  return true;
}

function requireNonEmptyString(value, field) {
  return String(value ?? "").trim();
}

module.exports = { sanitizeHtml, isSafePath, requireNonEmptyString };
`);
    break;
  case "cross-file-refactor":
    await rm(path.join(root, "src/slugify.js"), { force: true });
    await write("src/utils.js", `function capitalizeWords(value) {
  if (!value) return value;
  return value.replace(/\\b\\w/g, (character) => character.toUpperCase());
}

function reverse(value) {
  if (!value) return value;
  return value.split("").reverse().join("");
}

function slugify(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) return value;
  return \`${"${value.slice(0, maxLength)}"}...\`;
}

module.exports = { capitalizeWords, reverse, slugify, truncate };
`);
    break;
  case "test-coverage":
    await rm(path.join(root, "test/logger.test.js"), { force: true });
    await rm(path.join(root, "test/validator.test.js"), { force: true });
    break;
  default:
    throw new Error(`Unknown core task fault: ${taskId}`);
}
