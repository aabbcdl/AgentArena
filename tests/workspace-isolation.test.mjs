import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { setupWorkspaceAndPrechecks } from "../packages/runner/dist/workspace-operations.js";

const execFileAsync = promisify(execFile);

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function createPreflight(providerKind) {
  return {
    baseAgentId: "claude-code",
    agentId: "claude-code",
    variantId: `claude-${providerKind}`,
    displayLabel: "Claude Code",
    kind: "external",
    status: "unverified",
    summary: "ready for workspace setup",
    command: "claude",
    requestedConfig: { providerProfileId: providerKind === "official" ? "claude-official" : "provider-test" },
    resolvedRuntime: {
      providerKind,
      source: providerKind === "official" ? "official-login" : "profile-config",
      verification: "inferred"
    }
  };
}

function createContext(tempDir, workspacePath) {
  return {
    task: {},
    adapter: {},
    agentOutputPath: path.join(tempDir, "agent-output"),
    workspacePath,
    tracePath: path.join(tempDir, "trace.jsonl"),
    traceRecorder: { record: async () => {} },
    executionEnvironment: {},
    cancellation: undefined,
    throwIfCancelled: () => {},
    debug: false
  };
}

async function writeSourceRepository(sourcePath) {
  await mkdir(path.join(sourcePath, ".claude"), { recursive: true });
  await mkdir(path.join(sourcePath, ".codex"), { recursive: true });
  await writeFile(path.join(sourcePath, "AGENTS.md"), "agent instructions\n", "utf8");
  await writeFile(path.join(sourcePath, "CLAUDE.md"), "claude instructions\n", "utf8");
  await writeFile(path.join(sourcePath, "README.md"), "workspace\n", "utf8");
  await writeFile(path.join(sourcePath, ".claude", "settings.json"), "{}\n", "utf8");
  await writeFile(path.join(sourcePath, ".codex", "config.toml"), "model = 'private'\n", "utf8");
  await writeFile(path.join(sourcePath, ".mcp.json"), "{}\n", "utf8");
}

test("third-party Claude workspace preserves the normal project Harness before the git baseline", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-workspace-isolation-"));
  const sourcePath = path.join(tempDir, "source");
  const workspacePath = path.join(tempDir, "workspace");
  const originalAuthorName = process.env.GIT_AUTHOR_NAME;
  const originalAuthorEmail = process.env.GIT_AUTHOR_EMAIL;
  const originalCommitterName = process.env.GIT_COMMITTER_NAME;
  const originalCommitterEmail = process.env.GIT_COMMITTER_EMAIL;

  try {
    await writeSourceRepository(sourcePath);
    process.env.GIT_AUTHOR_NAME = "AgentArena Test";
    process.env.GIT_AUTHOR_EMAIL = "agentarena@example.invalid";
    process.env.GIT_COMMITTER_NAME = "AgentArena Test";
    process.env.GIT_COMMITTER_EMAIL = "agentarena@example.invalid";

    const earlyResult = await setupWorkspaceAndPrechecks(
      sourcePath,
      createPreflight("openai-proxy"),
      createContext(tempDir, workspacePath)
    );

    assert.equal(earlyResult, undefined);
    assert.equal(await readFile(path.join(workspacePath, "AGENTS.md"), "utf8"), "agent instructions\n");
    assert.equal(await readFile(path.join(workspacePath, "CLAUDE.md"), "utf8"), "claude instructions\n");
    assert.equal(await readFile(path.join(workspacePath, ".claude", "settings.json"), "utf8"), "{}\n");
    assert.equal(await readFile(path.join(workspacePath, ".codex", "config.toml"), "utf8"), "model = 'private'\n");
    assert.equal(await readFile(path.join(workspacePath, ".mcp.json"), "utf8"), "{}\n");
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: workspacePath });
    assert.equal(stdout.trim(), "");
  } finally {
    if (originalAuthorName === undefined) delete process.env.GIT_AUTHOR_NAME;
    else process.env.GIT_AUTHOR_NAME = originalAuthorName;
    if (originalAuthorEmail === undefined) delete process.env.GIT_AUTHOR_EMAIL;
    else process.env.GIT_AUTHOR_EMAIL = originalAuthorEmail;
    if (originalCommitterName === undefined) delete process.env.GIT_COMMITTER_NAME;
    else process.env.GIT_COMMITTER_NAME = originalCommitterName;
    if (originalCommitterEmail === undefined) delete process.env.GIT_COMMITTER_EMAIL;
    else process.env.GIT_COMMITTER_EMAIL = originalCommitterEmail;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("official Claude workspace keeps non-Claude project tool configuration", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-workspace-official-"));
  const sourcePath = path.join(tempDir, "source");
  const workspacePath = path.join(tempDir, "workspace");

  try {
    await writeSourceRepository(sourcePath);
    const earlyResult = await setupWorkspaceAndPrechecks(
      sourcePath,
      createPreflight("official"),
      createContext(tempDir, workspacePath)
    );

    assert.equal(earlyResult, undefined);
    assert.equal(await exists(path.join(workspacePath, ".codex", "config.toml")), true);
    assert.equal(await exists(path.join(workspacePath, ".mcp.json")), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
