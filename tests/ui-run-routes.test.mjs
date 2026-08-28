import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { handleUiRunRequest } from "../packages/cli/dist/commands/ui-run-routes.js";

test("run start releases its reservation when the pre-run state flush fails", async () => {
  const payload = JSON.stringify({
    repoPath: process.cwd(),
    taskPath: path.join(process.cwd(), "examples", "taskpacks", "demo-repo-health.json"),
    agents: [{ baseAgentId: "demo-fast" }]
  });
  const request = Readable.from([payload]);
  request.method = "POST";
  const response = {
    writeHead() {},
    end() {}
  };
  let releases = 0;
  const ctx = {
    authToken: "test-token",
    activeRun: null,
    setActiveRun() {},
    activeRunStatus: { state: "idle", phase: "idle", logs: [], updatedAt: new Date().toISOString() },
    setActiveRunStatus(status) { this.activeRunStatus = status; },
    appendRunLog() {},
    setRunStatus() {},
    runGeneration: 0,
    incrementRunGeneration: () => 1,
    tryReserveStart: () => true,
    releaseStartReservation: () => { releases += 1; },
    flushSaveRunState: async () => { throw new Error("simulated state flush failure"); },
    rememberLogStore() {},
    getLogStore() { return undefined; },
    clearPersistedRunState: async () => {}
  };

  await assert.rejects(
    () => handleUiRunRequest(request, response, new URL("http://127.0.0.1/api/run"), ctx),
    /simulated state flush failure/
  );
  assert.equal(releases, 1);
});

test("run start blocks a task pack that is incompatible with the selected repository", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agentarena-ui-compatibility-"));
  const repoPath = path.join(workspaceRoot, "repo");
  const taskPath = path.join(workspaceRoot, "incompatible.json");
  await mkdir(repoPath, { recursive: true });
  await writeFile(taskPath, JSON.stringify({
    schemaVersion: "agentarena.taskpack/v1",
    id: "node-only-task",
    title: "Node-only task",
    prompt: "Make a change.",
    metadata: {
      source: "community",
      owner: "test",
      repoTypes: ["node-js"],
      tags: ["test"],
      dependencies: [],
    },
    judges: [],
  }), "utf8");

  const payload = JSON.stringify({
    repoPath,
    taskPath,
    agents: [{ baseAgentId: "demo-fast" }],
  });
  const request = Readable.from([payload]);
  request.method = "POST";
  let statusCode = 200;
  let responseBody = "";
  const response = {
    writeHead(status) { statusCode = status; },
    end(body) { responseBody = String(body ?? ""); },
  };
  let releases = 0;
  const ctx = {
    workspaceRoot,
    authToken: "test-token",
    activeRun: null,
    setActiveRun() {},
    activeRunStatus: { state: "idle", phase: "idle", logs: [], updatedAt: new Date().toISOString() },
    setActiveRunStatus(status) { this.activeRunStatus = status; },
    appendRunLog() {},
    setRunStatus() {},
    runGeneration: 0,
    incrementRunGeneration: () => 1,
    tryReserveStart: () => true,
    releaseStartReservation: () => { releases += 1; },
    flushSaveRunState: async () => {},
    rememberLogStore() {},
    getLogStore() { return undefined; },
    clearPersistedRunState: async () => {},
  };

  try {
    await handleUiRunRequest(request, response, new URL("http://127.0.0.1/api/run"), ctx);
    assert.equal(statusCode, 409);
    const body = JSON.parse(responseBody);
    assert.match(body.error, /does not match/i);
    assert.equal(body.compatibility.status, "incompatible");
    assert.equal(releases, 1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
