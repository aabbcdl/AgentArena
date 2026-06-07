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
  // Use `echo -e` (echo is in COMMANDS_USING_E_FLAG) to test quote handling
  // without triggering the eval-style guard that now blocks `node -e`.
  const [cmd, args] = parseCommand("echo -e 'hello world inside quotes'");
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["-e", "hello world inside quotes"]);
});

test("double quotes preserve literal content including spaces", () => {
  const [cmd, args] = parseCommand('echo -e "hello world inside quotes"');
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["-e", "hello world inside quotes"]);
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
  // Single-quoted path with spaces; basename ("node") must still be allowlisted.
  const [cmd, args] = parseCommand("'/opt/with spaces/node' --version");
  assert.equal(cmd, "/opt/with spaces/node");
  assert.deepEqual(args, ["--version"]);
});

test("mixed quoted and unquoted arguments", () => {
  // echo permits `-e` (in COMMANDS_USING_E_FLAG); node would now be blocked.
  const [cmd, args] = parseCommand('echo -e "hello world" --flag value');
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["-e", "hello world", "--flag", "value"]);
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
  const [cmd, args] = parseCommand("git 1 2 3 4 5 6 7 8 9 10");
  assert.equal(cmd, "git");
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

test("dangerous command: netcat is rejected", () => {
  assert.throws(() => parseCommand("nc -l 8080"), /not in the allowed command list/i);
});

test("dangerous command: sudo is rejected", () => {
  assert.throws(() => parseCommand("sudo rm -rf /"), /not in the allowed command list/i);
});

test("dangerous command: bash -c is rejected", () => {
  // bash is now blocked by the allowlist (not in SAFE_COMMANDS), not by the eval check
  assert.throws(() => parseCommand("bash -c 'echo pwned'"), /not in the allowed command list/i);
});

test("dangerous command: python -c is rejected when allowEval is false", () => {
  assert.throws(() => parseCommand("python3 -c 'import os'", { allowEval: false }), /not allowed/i);
});

test("dangerous command: chmod is rejected", () => {
  assert.throws(() => parseCommand("chmod 777 /tmp"), /not in the allowed command list/i);
});

test("dangerous command: mkfifo is rejected", () => {
  assert.throws(() => parseCommand("mkfifo /tmp/pipe"), /not in the allowed command list/i);
});

test("safe command: echo with dangerous words is allowed", () => {
  const [cmd, _args] = parseCommand('echo "; rm -rf /"');
  assert.equal(cmd, "echo");
});

test("dangerous command: node -e is rejected when allowEval is false", () => {
  // node -e is allowed by default for task pack commands, but rejected when explicitly disabled
  assert.throws(() => parseCommand('node -e "console.log(1)"', { allowEval: false }), /not allowed/i);
});

test("dangerous command: node --eval is rejected when allowEval is false", () => {
  assert.throws(() => parseCommand('node --eval "console.log(1)"', { allowEval: false }), /not allowed/i);
});

test("dangerous command: bun -e is rejected when allowEval is false", () => {
  assert.throws(() => parseCommand('bun -e "console.log(1)"', { allowEval: false }), /not allowed/i);
});

test("safe command: npm test is allowed", () => {
  const [cmd, _args] = parseCommand("npm test");
  assert.equal(cmd, "npm");
});

test("rejected command includes suggestion", () => {
  try {
    parseCommand("sudo apt install foo");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err.message.includes("Suggestion") || err.message.includes("script file"), `Error message should include suggestion: ${err.message}`);
  }
});

test("sh is rejected by allowlist", () => {
  assert.throws(() => parseCommand("sh ./run-tests.sh"), /not in the allowed command list/i);
});

test("bash is rejected by allowlist", () => {
  assert.throws(() => parseCommand("bash ./script.sh"), /not in the allowed command list/i);
});

test("AGENTARENA_ALLOW_EVAL_IN_JUDGES bypass is not set by default", () => {
  // Verify the env var is not set in this test context (it should only be set
  // explicitly by test harnesses that need inline node -e)
  const original = process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES;
  try {
    delete process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES;
    // node -e is now allowed by default for task pack commands;
    // only rejected when explicitly passing allowEval: false
    assert.throws(() => parseCommand('node -e "console.log(1)"', { allowEval: false }), /not allowed/i);
  } finally {
    if (original !== undefined) {
      process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES = original;
    }
  }
});

// --- commandBasenameForAllowlist Windows extension stripping ---

test("node.exe is matched as node via Windows extension stripping", () => {
  const [cmd, args] = parseCommand("node.exe --version");
  assert.equal(cmd, "node.exe");
  assert.deepEqual(args, ["--version"]);
});

test("python.cmd is matched as python via Windows extension stripping", () => {
  const [cmd, args] = parseCommand("python.cmd script.py");
  assert.equal(cmd, "python.cmd");
  assert.deepEqual(args, ["script.py"]);
});

test("git.bat is matched as git via Windows extension stripping", () => {
  const [cmd, args] = parseCommand("git.bat status");
  assert.equal(cmd, "git.bat");
  assert.deepEqual(args, ["status"]);
});

test("absolute path to node is allowed", () => {
  const [cmd, args] = parseCommand("/usr/bin/node --version");
  assert.equal(cmd, "/usr/bin/node");
  assert.deepEqual(args, ["--version"]);
});

test("unallowed command with .exe extension is still rejected", () => {
  assert.throws(() => parseCommand("malware.exe --payload"), /not in the allowed command list/i);
});
