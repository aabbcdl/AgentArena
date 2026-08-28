import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createUiAuthPasswordRecord,
  readUiAuthPassword,
  resolveUiAuthToken,
  UI_AUTH_PASSWORD_MIN_LENGTH,
  uiAuthPasswordFilePath,
  uiAuthTokenFilePath,
  validateUiAuthPassword,
  verifyUiAuthPassword,
  writeUiAuthPassword,
} from "../packages/cli/dist/commands/ui-auth.js";

test("UI auth resolution keeps admin opt-in and uses explicit precedence", () => {
  assert.deepEqual(
    resolveUiAuthToken(undefined, { AGENTARENA_LOCAL_AUTH_TOKEN: " admin ", AGENTARENA_AUTH_TOKEN: "legacy" }, () => "generated"),
    { token: "admin", source: "local-env" }
  );
  assert.deepEqual(
    resolveUiAuthToken(" cli-token ", { AGENTARENA_LOCAL_AUTH_TOKEN: "admin" }, () => "generated"),
    { token: "cli-token", source: "cli" }
  );
  assert.deepEqual(
    resolveUiAuthToken(undefined, { AGENTARENA_AUTH_TOKEN: "legacy" }, () => "generated"),
    { token: "legacy", source: "env" }
  );
  assert.deepEqual(
    resolveUiAuthToken(undefined, {}, () => "generated"),
    { token: "generated", source: "generated" }
  );
});

test("UI auth token files are stable per listener port and do not share the legacy path", () => {
  const workspacePath = process.platform === "win32" ? "C:\\workspace" : "/tmp/workspace";
  const first = uiAuthTokenFilePath(workspacePath, 4320);
  const second = uiAuthTokenFilePath(workspacePath, 4321);
  assert.equal(first, path.join(workspacePath, ".agentarena", "last-auth-token-4320"));
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /last-auth-token$/);
});

test("UI auth token file paths reject invalid ports", () => {
  assert.throws(() => uiAuthTokenFilePath("C:\\workspace", 0), /Invalid UI port/);
  assert.throws(() => uiAuthTokenFilePath("C:\\workspace", 65_536), /Invalid UI port/);
});

test("UI password records verify without storing the password", () => {
  const record = createUiAuthPasswordRecord("admin");
  assert.equal(verifyUiAuthPassword(record, "admin"), true);
  assert.equal(verifyUiAuthPassword(record, "wrong"), false);
  assert.doesNotMatch(JSON.stringify(record), /admin/);
  assert.equal(validateUiAuthPassword(" admin "), "admin");
  assert.throws(() => validateUiAuthPassword("x".repeat(UI_AUTH_PASSWORD_MIN_LENGTH - 1)), /at least/);
});

test("UI password records persist with owner-only file permissions", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-ui-auth-record-"));
  const filePath = uiAuthPasswordFilePath(tempDir);
  try {
    await writeUiAuthPassword(filePath, "admin");
    const loaded = await readUiAuthPassword(filePath);
    assert.ok(loaded);
    assert.equal(verifyUiAuthPassword(loaded, "admin"), true);
    assert.doesNotMatch(await fs.readFile(filePath, "utf8"), /admin/);
    if (process.platform !== "win32") {
      const mode = (await fs.stat(filePath)).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
