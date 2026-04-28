import assert from "node:assert/strict";
import test from "node:test";

import { parseCommand } from "../packages/judges/dist/index.js";

/**
 * Security boundary tests for parseCommand().
 * These tests verify that shell metacharacters are treated as literal arguments
 * (not interpreted by a shell), and that quoting/escaping works correctly.
 */

test("shell metacharacter semicolon is treated as literal", () => {
  const [cmd, args] = parseCommand('echo "; rm -rf /"');
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["; rm -rf /"]);
});

test("shell metacharacter && is treated as literal", () => {
  const [cmd, args] = parseCommand('echo "&& echo pwned"');
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["&& echo pwned"]);
});

test("shell metacharacter pipe is treated as literal", () => {
  const [cmd, args] = parseCommand('echo "| cat /etc/passwd"');
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["| cat /etc/passwd"]);
});

test("backtick command substitution is treated as literal", () => {
  const [cmd, args] = parseCommand("echo '`whoami`'");
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["`whoami`"]);
});

test("dollar command substitution is treated as literal", () => {
  const [cmd, args] = parseCommand('echo "$(id)"');
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["$(id)"]);
});

test("empty string throws error", () => {
  assert.throws(() => parseCommand(""), { message: /empty/i });
});

test("whitespace-only string throws error", () => {
  assert.throws(() => parseCommand("   "), { message: /empty/i });
  assert.throws(() => parseCommand("\t\n  "), { message: /empty/i });
});

test("single quotes preserve literal content including spaces", () => {
  const [cmd, args] = parseCommand("node -e 'console.log(1 + 1)'");
  assert.equal(cmd, "node");
  assert.deepEqual(args, ["-e", "console.log(1 + 1)"]);
});

test("double quotes preserve literal content including spaces", () => {
  const [cmd, args] = parseCommand('node -e "console.log(2 + 2)"');
  assert.equal(cmd, "node");
  assert.deepEqual(args, ["-e", "console.log(2 + 2)"]);
});

test("backslash escapes characters outside quotes", () => {
  const [cmd, args] = parseCommand("echo hello\\ world");
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["hello world"]);
});

test("backslash escapes characters inside double quotes", () => {
  const [cmd, args] = parseCommand('echo "hello \\"world\\""');
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ['hello "world"']);
});

test("backslash is literal inside single quotes", () => {
  const [cmd, args] = parseCommand("echo 'hello\\world'");
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["hello\\world"]);
});

test("normal command with arguments parses correctly", () => {
  const [cmd, args] = parseCommand("git status --short");
  assert.equal(cmd, "git");
  assert.deepEqual(args, ["status", "--short"]);
});

test("command with spaced path parses correctly", () => {
  const [cmd, args] = parseCommand('"C:\\\\Program Files\\\\Node\\\\node.exe" --version');
  assert.equal(cmd, "C:\\Program Files\\Node\\node.exe");
  assert.deepEqual(args, ["--version"]);
});

test("command with spaced path in single quotes parses correctly", () => {
  const [cmd, args] = parseCommand("'/usr/local/bin/my tool' run");
  assert.equal(cmd, "/usr/local/bin/my tool");
  assert.deepEqual(args, ["run"]);
});

test("mixed quoted and unquoted arguments", () => {
  const [cmd, args] = parseCommand('node -e "console.log(1)" --flag value');
  assert.equal(cmd, "node");
  assert.deepEqual(args, ["-e", "console.log(1)", "--flag", "value"]);
});

test("multiple spaces between arguments are collapsed", () => {
  const [cmd, args] = parseCommand("git    status   --short");
  assert.equal(cmd, "git");
  assert.deepEqual(args, ["status", "--short"]);
});

test("leading and trailing whitespace is ignored", () => {
  const [cmd, args] = parseCommand("  git status  ");
  assert.equal(cmd, "git");
  assert.deepEqual(args, ["status"]);
});

test("argument array boundary: empty args list when only command", () => {
  const [cmd, args] = parseCommand("ls");
  assert.equal(cmd, "ls");
  assert.deepEqual(args, []);
});

test("argument array boundary: many arguments", () => {
  const [cmd, args] = parseCommand("a 1 2 3 4 5 6 7 8 9 10");
  assert.equal(cmd, "a");
  assert.deepEqual(args, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
});

test("nested quotes are handled correctly", () => {
  const [cmd, args] = parseCommand('echo "it\'s working"');
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["it's working"]);
});

test("unclosed single quote is treated as literal until end", () => {
  const [cmd, args] = parseCommand("echo 'unclosed");
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["unclosed"]);
});

test("unclosed double quote is treated as literal until end", () => {
  const [cmd, args] = parseCommand('echo "unclosed');
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["unclosed"]);
});
