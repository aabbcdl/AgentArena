import assert from "node:assert/strict";
import { access, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_AGENT_TIMEOUT_MS,
  findExecutableOnPath,
  formatTimeoutMessage,
  runProcess,
  safeNumber,
  sleep,
} from "../packages/adapters/dist/process-utils.js";

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("DEFAULT_AGENT_TIMEOUT_MS is 15 minutes", () => {
  assert.equal(DEFAULT_AGENT_TIMEOUT_MS, 15 * 60 * 1_000);
});

test("formatTimeoutMessage includes timeout value", () => {
  const msg = formatTimeoutMessage(5000);
  assert.ok(msg.includes("5000"));
  assert.ok(msg.includes("timed out"));
});

test("safeNumber returns 0 for undefined", () => {
  assert.equal(safeNumber(undefined), 0);
});

test("safeNumber returns 0 for NaN", () => {
  assert.equal(safeNumber(NaN), 0);
});

test("safeNumber returns 0 for Infinity", () => {
  assert.equal(safeNumber(Infinity), 0);
});

test("safeNumber returns value for valid numbers", () => {
  assert.equal(safeNumber(42), 42);
  assert.equal(safeNumber(0), 0);
  assert.equal(safeNumber(-1), -1);
});

test("sleep resolves after duration", async () => {
  const start = Date.now();
  await sleep(50);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 40, `Expected >= 40ms, got ${elapsed}ms`);
});

test("sleep throws on pre-aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => sleep(1000, controller.signal));
});

test("sleep throws when signal aborts during sleep", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(() => sleep(5000, controller.signal));
});

test("runProcess collects stdout", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "console.log('hello')"],
    process.cwd(),
    5000
  );
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("hello"));
  assert.equal(result.timedOut, false);
});

test("runProcess collects stderr", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "console.error('warn')"],
    process.cwd(),
    5000
  );
  assert.equal(result.exitCode, 0);
  assert.ok(result.stderr.includes("warn"));
});

test("runProcess reports non-zero exit code", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "process.exit(42)"],
    process.cwd(),
    5000
  );
  assert.equal(result.exitCode, 42);
});

test("runProcess times out for long-running process", async () => {
  // Use a temp script file so the test exercises normal script invocation
  // instead of depending on platform-specific `node -e` quoting.
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-timeout-"));
  try {
    const scriptPath = path.join(tempDir, "sleep.js");
    await writeFile(scriptPath, "setTimeout(() => {}, 60000);\n", "utf8");
    const result = await runProcess(process.execPath, [scriptPath], process.cwd(), 200);
    assert.equal(result.timedOut, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runProcess enforces an opt-in idle timeout after output stops", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-idle-timeout-"));
  try {
    const scriptPath = path.join(tempDir, "idle.js");
    await writeFile(
      scriptPath,
      'process.stdout.write("started\\n");\nsetTimeout(() => {}, 60000);\n',
      "utf8"
    );
    const startedAt = Date.now();
    const result = await runProcess(
      process.execPath,
      [scriptPath],
      process.cwd(),
      5_000,
      undefined,
      undefined,
      undefined,
      { idleTimeoutMs: 200 }
    );

    assert.equal(result.timedOut, true);
    assert.equal(result.timeoutKind, "idle");
    assert.match(result.stdout, /started/);
    assert.match(result.stderr, /no output.*200ms/i);
    assert.ok(Date.now() - startedAt < 3_000, "idle timeout should finish before the total timeout");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runProcess resets the opt-in idle timeout whenever output arrives", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-idle-activity-"));
  try {
    const scriptPath = path.join(tempDir, "active.js");
    await writeFile(
      scriptPath,
      [
        "let count = 0;",
        "const timer = setInterval(() => {",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: The placeholder must remain in the generated JavaScript fixture.
        '  process.stdout.write(`tick-${++count}\\n`);',
        "  if (count === 5) { clearInterval(timer); setTimeout(() => process.exit(0), 20); }",
        "}, 70);"
      ].join("\n"),
      "utf8"
    );
    const result = await runProcess(
      process.execPath,
      [scriptPath],
      process.cwd(),
      3_000,
      undefined,
      undefined,
      undefined,
      { idleTimeoutMs: 500 }
    );

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.timedOut, false);
    assert.equal(result.timeoutKind, undefined);
    assert.match(result.stdout, /tick-5/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runProcess respects abort signal", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-abort-"));
  try {
    const scriptPath = path.join(tempDir, "sleep.js");
    await writeFile(scriptPath, "setTimeout(() => {}, 60000);\n", "utf8");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await runProcess(
      process.execPath,
      [scriptPath],
      process.cwd(),
      30000,
      undefined,
      controller.signal
    );
    assert.ok(result.exitCode !== 0 || result.timedOut || result.error);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runProcess handles command not found", async () => {
  const result = await runProcess(
    "nonexistent-command-xyz-12345",
    [],
    process.cwd(),
    5000
  );
  assert.ok(result.exitCode !== 0 || result.error);
});

test("runProcess does not execute shell metacharacters from arguments", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-shell-args-"));
  try {
    const scriptPath = path.join(tempDir, "argv.js");
    const markerPath = path.join(tempDir, "injected.txt");
    await writeFile(scriptPath, "console.log(JSON.stringify(process.argv.slice(2)));\n", "utf8");

    const dangerousArg = `safe&echo injected>${markerPath}`;
    const result = await runProcess(process.execPath, [scriptPath, dangerousArg], process.cwd(), 5000);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), [dangerousArg]);
    assert.equal(await fileExists(markerPath), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test(
  "runProcess invokes Windows batch shims without shell injection",
  { skip: process.platform !== "win32" ? "Windows-specific batch shim behavior" : false },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena cmd shim "));
    try {
      const scriptPath = path.join(tempDir, "argv.js");
      const shimPath = path.join(tempDir, "runner.cmd");
      const markerPath = path.join(tempDir, "injected.txt");
      await writeFile(scriptPath, "console.log(JSON.stringify(process.argv.slice(2)));\n", "utf8");
      await writeFile(shimPath, `@echo off\n"${process.execPath}" "${scriptPath}" %*\n`, "utf8");

      const dangerousArg = `safe&echo injected>${markerPath}`;
      const trailingSlashArg = "C:\\work dir\\";
      const result = await runProcess(shimPath, [dangerousArg, trailingSlashArg], process.cwd(), 5000);

      assert.equal(result.exitCode, 0);
      assert.deepEqual(JSON.parse(result.stdout), [dangerousArg, trailingSlashArg]);
      assert.equal(await fileExists(markerPath), false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
);

test(
  "runProcess rejects Windows batch arguments that cmd.exe would expand",
  { skip: process.platform !== "win32" ? "Windows-specific batch shim behavior" : false },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-cmd-expand-"));
    try {
      const scriptPath = path.join(tempDir, "argv.js");
      const shimPath = path.join(tempDir, "runner.cmd");
      await writeFile(scriptPath, "console.log(JSON.stringify(process.argv.slice(2)));\n", "utf8");
      await writeFile(shimPath, `@echo off\n"${process.execPath}" "${scriptPath}" %*\n`, "utf8");

      const result = await runProcess(shimPath, ["a%PATH%b"], process.cwd(), 5000);

      assert.notEqual(result.exitCode, 0);
      assert.match(`${result.error}\n${result.stderr}`, /unsupported.*cmd\.exe/i);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
);

test(
  "runProcess times out detached Windows Claude invocations",
  { skip: process.platform !== "win32" ? "Windows-specific Claude wrapper behavior" : false },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-claude-timeout-"));
    try {
      const scriptPath = path.join(tempDir, "hang.js");
      const shimPath = path.join(tempDir, "claude.cmd");
      await writeFile(scriptPath, "setTimeout(() => {}, 60000);\n", "utf8");
      await writeFile(shimPath, `@echo off\n"${process.execPath}" "${scriptPath}" %*\n`, "utf8");

      const result = await runProcess(
        shimPath,
        ["-p", "--output-format", "stream-json"],
        tempDir,
        500,
        process.env,
        undefined,
        "READY"
      );

      assert.equal(result.timedOut, true);
      assert.match(result.stderr, /timed out/i);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
);

test(
  "runProcess applies idle timeout to detached Windows Claude output files",
  { skip: process.platform !== "win32" ? "Windows-specific Claude wrapper behavior" : false },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-claude-idle-timeout-"));
    try {
      const scriptPath = path.join(tempDir, "idle.js");
      const shimPath = path.join(tempDir, "claude.cmd");
      await writeFile(
        scriptPath,
        'process.stdout.write("started\\n");\nsetTimeout(() => {}, 60000);\n',
        "utf8"
      );
      await writeFile(shimPath, `@echo off\n"${process.execPath}" "${scriptPath}" %*\n`, "utf8");

      const startedAt = Date.now();
      const result = await runProcess(
        shimPath,
        ["-p", "--output-format", "stream-json"],
        tempDir,
        10_000,
        process.env,
        undefined,
        "READY",
        { idleTimeoutMs: 1_000 }
      );

      assert.equal(result.timedOut, true);
      assert.equal(result.timeoutKind, "idle");
      assert.match(result.stdout, /started/);
      assert.match(result.stderr, /no output.*1000ms/i);
      assert.ok(Date.now() - startedAt < 6_000, "idle timeout should stop the detached process tree");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
);

test(
  "detached Windows Claude invocations do not inherit environment variables omitted from the requested environment",
  { skip: process.platform !== "win32" ? "Windows-specific Claude wrapper behavior" : false },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-claude-env-isolation-"));
    const originalLeak = process.env.AGENTARENA_SHOULD_NOT_LEAK;
    try {
      const scriptPath = path.join(tempDir, "print-env.js");
      const shimPath = path.join(tempDir, "claude.cmd");
      await writeFile(
        scriptPath,
        'process.stdout.write(process.env.AGENTARENA_SHOULD_NOT_LEAK ?? "missing");\n',
        "utf8"
      );
      await writeFile(shimPath, `@echo off\n"${process.execPath}" "${scriptPath}" %*\n`, "utf8");
      process.env.AGENTARENA_SHOULD_NOT_LEAK = "parent-secret";
      const requestedEnvironment = { ...process.env };
      delete requestedEnvironment.AGENTARENA_SHOULD_NOT_LEAK;

      const result = await runProcess(
        shimPath,
        ["-p", "--output-format", "text"],
        tempDir,
        10_000,
        requestedEnvironment,
        undefined,
        "READY"
      );

      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "missing");
    } finally {
      if (originalLeak === undefined) delete process.env.AGENTARENA_SHOULD_NOT_LEAK;
      else process.env.AGENTARENA_SHOULD_NOT_LEAK = originalLeak;
      await rm(tempDir, { recursive: true, force: true });
    }
  }
);

test(
  "detached Windows Claude launch scripts never contain environment secrets",
  { skip: process.platform !== "win32" ? "Windows-specific Claude wrapper behavior" : false },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-claude-secret-script-"));
    const secret = "third-party-secret-sentinel";
    const existingWrapperDirs = new Set(
      (await readdir(os.tmpdir(), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("agentarena-claude-run-"))
        .map((entry) => entry.name)
    );
    let resultPromise;

    try {
      const scriptPath = path.join(tempDir, "delay.js");
      const shimPath = path.join(tempDir, "claude.cmd");
      await writeFile(
        scriptPath,
        'setTimeout(() => process.stdout.write("READY"), 1500);\n',
        "utf8"
      );
      await writeFile(shimPath, `@echo off\n"${process.execPath}" "${scriptPath}" %*\n`, "utf8");

      const requestedEnvironment = {
        ...process.env,
        ANTHROPIC_AUTH_TOKEN: secret
      };
      resultPromise = runProcess(
        shimPath,
        ["-p", "--output-format", "text"],
        tempDir,
        10_000,
        requestedEnvironment,
        undefined,
        "READY"
      );

      let wrapperScript;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const wrapperDirs = (await readdir(os.tmpdir(), { withFileTypes: true }))
          .filter(
            (entry) =>
              entry.isDirectory() &&
              entry.name.startsWith("agentarena-claude-run-") &&
              !existingWrapperDirs.has(entry.name)
          );
        for (const entry of wrapperDirs) {
          const candidate = path.join(os.tmpdir(), entry.name, "run.ps1");
          if (await fileExists(candidate)) {
            wrapperScript = await readFile(candidate, "utf8");
            break;
          }
        }
        if (wrapperScript !== undefined) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      assert.ok(wrapperScript, "expected to observe the detached Claude wrapper script");
      assert.doesNotMatch(wrapperScript, new RegExp(secret));
      const result = await resultPromise;
      assert.equal(result.exitCode, 0, result.stderr);
    } finally {
      await resultPromise?.catch(() => {});
      await rm(tempDir, { recursive: true, force: true });
    }
  }
);

// --- Output truncation (previously had NO coverage) ---
//
// MAX_PROCESS_OUTPUT_BYTES is 50 MB. To verify the truncation cap actually
// fires we have to push slightly more than that through the pipe — these two
// tests are intentionally heavy. Generating ~52 MB takes a couple of seconds
// on a modern dev box.

const MAX_PROCESS_OUTPUT_BYTES = 50 * 1024 * 1024;
const MAX_ALLOWED_OUTPUT = MAX_PROCESS_OUTPUT_BYTES + 4 * 1024;

test("runProcess truncates stdout that exceeds MAX_PROCESS_OUTPUT_BYTES", async () => {
  // Write ~52 MB to stdout in 1-MB chunks. The runProcess pipeline must cap
  // the captured output and append a truncation marker so benchmark agents
  // producing huge logs can't OOM the parent.
  //
  // The generator is written to a temp .js file and run as `node <file>` so
  // the test does not depend on platform-specific `node -e` quoting.
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-trunc-"));
  try {
    const scriptPath = path.join(tempDir, "gen-stdout.js");
    await writeFile(
      scriptPath,
      'const chunk = "a".repeat(1024 * 1024);\nfor (let i = 0; i < 52; i++) { process.stdout.write(chunk); }\n',
      "utf8"
    );
    const result = await runProcess(process.execPath, [scriptPath], process.cwd(), 60_000);
    assert.equal(result.timedOut, false);
    assert.ok(
      result.stdout.length <= MAX_ALLOWED_OUTPUT,
      `Expected stdout <= ${MAX_ALLOWED_OUTPUT} bytes, got ${result.stdout.length}`
    );
    assert.match(result.stdout, /truncated/i, `Expected truncation marker in stdout`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runProcess truncates stderr that exceeds MAX_PROCESS_OUTPUT_BYTES", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-trunc-"));
  try {
    const scriptPath = path.join(tempDir, "gen-stderr.js");
    await writeFile(
      scriptPath,
      'const chunk = "e".repeat(1024 * 1024);\nfor (let i = 0; i < 52; i++) { process.stderr.write(chunk); }\n',
      "utf8"
    );
    const result = await runProcess(process.execPath, [scriptPath], process.cwd(), 60_000);
    assert.ok(
      result.stderr.length <= MAX_ALLOWED_OUTPUT,
      `Expected stderr <= ${MAX_ALLOWED_OUTPUT} bytes, got ${result.stderr.length}`
    );
    assert.match(result.stderr, /truncated/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// --- terminateProcessTree (previously had NO coverage) ---

test("terminateProcessTree is a no-op for pid <= 0", async () => {
  // Import here so we don't trip the entry-point lint rule.
  const { terminateProcessTree } = await import("../packages/adapters/dist/process-utils.js");
  // Should not throw, should resolve quickly even for invalid pids.
  await terminateProcessTree(0);
  await terminateProcessTree(-1);
});

test("terminateProcessTree kills a real child process", async () => {
  const { spawn } = await import("node:child_process");
  const { terminateProcessTree } = await import("../packages/adapters/dist/process-utils.js");

  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
    detached: process.platform !== "win32",
  });

  // Wait for the child to actually be running before we try to kill it.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(child.pid, "child should have a pid");

  const exited = new Promise((resolve) => child.on("exit", resolve));
  await terminateProcessTree(child.pid);
  // Within a generous window, the child must have exited.
  const exitResult = await Promise.race([
    exited.then(() => "exited"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 4000)),
  ]);
  assert.equal(exitResult, "exited", "child was not terminated within 4s");
});

// --- findExecutableOnPath ---

test("findExecutableOnPath finds node", async () => {
  // On Windows, X_OK may not work correctly; skip if result is undefined
  const result = await findExecutableOnPath(["node"]);
  if (result === undefined && process.platform === "win32") {
    // Windows X_OK behavior: skip gracefully
    assert.ok(true, "skipping on Windows where X_OK may not work");
    return;
  }
  assert.ok(result, "should find node on PATH");
  assert.ok(result.includes("node"), `result should contain 'node': ${result}`);
});

test("findExecutableOnPath returns undefined for nonexistent binary", async () => {
  const result = await findExecutableOnPath(["nonexistent-binary-xyz-99999"]);
  assert.equal(result, undefined);
});

test("findExecutableOnPath returns first match from candidates", async () => {
  // On Windows, X_OK may not work as expected; use process.execPath basename as a known executable
  const nodeExe = path.basename(process.execPath);
  const result = await findExecutableOnPath(["nonexistent-1", nodeExe, "nonexistent-2"]);
  if (result === undefined && process.platform === "win32") {
    assert.ok(true, "skipping on Windows where X_OK may not work");
    return;
  }
  assert.ok(result, `should find ${nodeExe}`);
});
