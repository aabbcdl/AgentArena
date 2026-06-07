import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ENTRY = path.join(REPO_ROOT, "packages", "cli", "dist", "index.js");

function request(port, method, pathname, body, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: { "Content-Type": "application/json" }
    };
    if (token) {
      options.headers.Authorization = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function waitForServer(port, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/ui-info`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          if (Date.now() > deadline) {
            reject(new Error(`Server returned ${res.statusCode} and did not become ready within timeout`));
          } else {
            setTimeout(check, 200);
          }
        }
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error("Server did not start within timeout"));
        } else {
          setTimeout(check, 200);
        }
      });
    };
    check();
  });
}

async function startServer(port) {
  // Pre-generate an explicit auth token to avoid token-file race conditions across
  // parallel test runs. The CLI masks tokens in stdout for security, so parsing
  // from stdout no longer works.
  const authToken = `test-token-${Date.now()}-${port}-${Math.random().toString(36).slice(2, 10)}`;
  const child = spawn(process.execPath, [CLI_ENTRY, "ui", "--port", String(port), "--no-open", "--auth-token", authToken], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env }
  });

  let stderr = "";
  child.stdout.resume();
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  await waitForServer(port);

  await new Promise(r => setTimeout(r, 200));

  return { child, stderr: () => stderr, authToken };
}

// Use a unique port for each test run to avoid conflicts
const BASE_PORT = 4320 + Math.floor(Math.random() * 1000);

test("GET /api/ui-info returns correct structure", { timeout: 60_000 }, async () => {
  const port = BASE_PORT;
  const { child } = await startServer(port);
  try {
    const res = await request(port, "GET", "/api/ui-info");
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.mode, "local-service");
    assert.ok(typeof res.body.repoPath === "string");
    assert.ok(typeof res.body.defaultTaskPath === "string");
    assert.ok(Array.isArray(res.body.claudeProviderProfiles));
  } finally {
    child.kill("SIGTERM");
  }
});

test("GET /api/adapters returns adapter list", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 1;
  const { child } = await startServer(port);
  try {
    const res = await request(port, "GET", "/api/adapters");
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);
    const demo = res.body.find((a) => a.id === "demo-fast");
    assert.ok(demo, "should include demo-fast adapter");
    assert.equal(demo.kind, "demo");
  } finally {
    child.kill("SIGTERM");
  }
});

test("POST /api/run with empty body returns 400", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 2;
  const { child, authToken } = await startServer(port);
  try {
    const res = await request(port, "POST", "/api/run", {}, authToken);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes("repoPath") || res.body.error.includes("required"));
  } finally {
    child.kill("SIGTERM");
  }
});

test("POST /api/run missing agents returns 400", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 3;
  const { child, authToken } = await startServer(port);
  try {
    const res = await request(port, "POST", "/api/run", {
      repoPath: process.cwd(),
      taskPath: path.join(process.cwd(), "test.yaml")
    }, authToken);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes("agent") || res.body.error.includes("required"));
  } finally {
    child.kill("SIGTERM");
  }
});

test("POST /api/preflight missing baseAgentId returns 400", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 4;
  const { child, authToken } = await startServer(port);
  try {
    const res = await request(port, "POST", "/api/preflight", {}, authToken);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes("baseAgentId"));
  } finally {
    child.kill("SIGTERM");
  }
});

test("POST /api/create-adhoc-taskpack missing prompt returns 400", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 5;
  const { child, authToken } = await startServer(port);
  try {
    const res = await request(port, "POST", "/api/create-adhoc-taskpack", {}, authToken);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes("prompt"));
  } finally {
    child.kill("SIGTERM");
  }
});

test("POST /api/provider-profiles missing required fields returns 400", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 6;
  const { child, authToken } = await startServer(port);
  try {
    const res = await request(port, "POST", "/api/provider-profiles", { name: "test" }, authToken);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes("kind") || res.body.error.includes("apiFormat"));
  } finally {
    child.kill("SIGTERM");
  }
});

test("GET static file path traversal is blocked", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 7;
  const { child } = await startServer(port);
  try {
    // The server normalizes paths and rejects anything outside WEB_REPORT_DIST_ROOT.
    // Depending on normalization, this returns 403 (direct rejection) or 404 (file not found after normalization).
    // Both are acceptable — the key is that /etc/passwd is NOT served.
    const res = await request(port, "GET", "/../../../etc/passwd");
    assert.ok(res.statusCode === 403 || res.statusCode === 404, `expected 403 or 404, got ${res.statusCode}`);
    // Ensure the response is not a file listing
    if (typeof res.body === "string") {
      assert.ok(!res.body.includes("root:"), "should not serve /etc/passwd content");
    }
  } finally {
    child.kill("SIGTERM");
  }
});

test("POST /api/run concurrent requests return 409", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 8;
  const { child, authToken } = await startServer(port);
  try {
    const runBody = {
      repoPath: REPO_ROOT,
      taskPath: path.join(REPO_ROOT, "examples", "taskpacks", "demo-repo-health.json"),
      agents: [{ baseAgentId: "demo-fast" }]
    };

    const firstReq = request(port, "POST", "/api/run", runBody, authToken);
    await new Promise((r) => setTimeout(r, 50));

    const secondRes = await request(port, "POST", "/api/run", runBody, authToken);
    assert.equal(secondRes.statusCode, 409);
    assert.ok(secondRes.body.error.includes("already in progress"));

    await firstReq.catch(() => {});
  } finally {
    child.kill("SIGTERM");
  }
});

test("POST /api/run valid request returns 202", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 9;
  const { child, authToken } = await startServer(port);
  try {
    const res = await request(port, "POST", "/api/run", {
      repoPath: REPO_ROOT,
      taskPath: path.join(REPO_ROOT, "examples", "taskpacks", "demo-repo-health.json"),
      agents: [{ baseAgentId: "demo-fast" }]
    }, authToken);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.accepted, true);

    await new Promise((r) => setTimeout(r, 3000));
  } finally {
    child.kill("SIGTERM");
  }
});

test("Rate limit returns 429 after many requests", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 10;
  const { child } = await startServer(port);
  try {
    // Fire many requests rapidly to trigger the general rate limit (120/min)
    const promises = [];
    for (let i = 0; i < 130; i++) {
      promises.push(request(port, "GET", "/api/adapters"));
    }
    const results = await Promise.all(promises);
    const rateLimited = results.filter((r) => r.statusCode === 429);
    assert.ok(rateLimited.length > 0, "should have at least one 429 response");
    assert.ok(rateLimited[0].body.error.includes("Rate limit"));
  } finally {
    child.kill("SIGTERM");
  }
});

test("localhost GET /api/ui-info works without token", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 20;
  const { child } = await startServer(port);
  try {
    const res = await request(port, "GET", "/api/ui-info");
    assert.equal(res.statusCode, 200, "localhost GET should work without token");
  } finally {
    child.kill("SIGTERM");
  }
});

test("localhost POST /api/run requires token", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 21;
  const { child } = await startServer(port);
  try {
    const res = await request(port, "POST", "/api/run", {});
    assert.equal(res.statusCode, 401, "localhost POST should require token");
  } finally {
    child.kill("SIGTERM");
  }
});

test("localhost POST /api/run with valid token returns non-401", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 22;
  const { child, authToken } = await startServer(port);
  try {
    const res = await request(port, "POST", "/api/run", {}, authToken);
    assert.notEqual(res.statusCode, 401, "POST with valid token should not return 401");
  } finally {
    child.kill("SIGTERM");
  }
});

test("POST /api/preflight requires auth token", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 31;
  const { child } = await startServer(port);
  try {
    const res = await request(port, "POST", "/api/preflight", { baseAgentId: "demo-fast" });
    assert.equal(res.statusCode, 401);
  } finally {
    child.kill("SIGTERM");
  }
});

test("POST /api/create-adhoc-taskpack requires auth token", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 32;
  const { child } = await startServer(port);
  try {
    const res = await request(port, "POST", "/api/create-adhoc-taskpack", { prompt: "test", title: "Test" });
    assert.equal(res.statusCode, 401);
  } finally {
    child.kill("SIGTERM");
  }
});

test("GET /api/run-status returns idle when no run active", { timeout: 60_000 }, async () => {
  const port = BASE_PORT + 33;
  // Clean up any persisted run state from previous tests
  const stateDir = path.join(process.cwd(), ".agentarena", "ui");
  try { await fs.rm(stateDir, { recursive: true, force: true }); } catch { /* best-effort: cleanup */ }
  const { child } = await startServer(port);
  try {
    const res = await request(port, "GET", "/api/run-status");
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.state, "idle");
  } finally {
    child.kill("SIGTERM");
  }
});
