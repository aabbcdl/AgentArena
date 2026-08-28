import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  createUiAuthBootstrap,
  UI_AUTH_BOOTSTRAP_TTL_MS
} from "../packages/cli/dist/commands/ui-auth-bootstrap.js";
import { createRequestHandler } from "../packages/cli/dist/commands/ui-routes.js";

test("UI auth bootstrap exchanges the valid code exactly once", () => {
  const bootstrap = createUiAuthBootstrap("real-token", { code: "valid-code" });
  assert.equal(bootstrap.exchange("valid-code"), "real-token");
  assert.equal(bootstrap.exchange("valid-code"), null);
});

test("UI auth bootstrap rejects a wrong code without consuming the valid one", () => {
  const bootstrap = createUiAuthBootstrap("real-token", { code: "valid-code" });
  assert.equal(bootstrap.exchange("wrong-code"), null);
  assert.equal(bootstrap.exchange("valid-code"), "real-token");
});

test("UI auth bootstrap rejects expired codes", () => {
  let now = 1_000;
  const bootstrap = createUiAuthBootstrap("real-token", {
    code: "valid-code",
    now: () => now
  });
  now += UI_AUTH_BOOTSTRAP_TTL_MS + 1;
  assert.equal(bootstrap.exchange("valid-code"), null);
});

test("POST /api/auth/bootstrap exchanges through the real HTTP route exactly once", async () => {
  const bootstrap = createUiAuthBootstrap("real-token", { code: "valid-code" });
  const context = {
    host: "127.0.0.1",
    port: 0,
    isLocalhost: true,
    authToken: "real-token",
    exchangeAuthBootstrap: bootstrap.exchange,
    codexDefaults: {},
    activeRun: null,
    activeRunStatus: null,
    setActiveRun() {},
    setActiveRunStatus() {},
    appendRunLog() {},
    setRunStatus() {},
    runGeneration: 0,
    incrementRunGeneration() {},
    tryReserveStart() { return true; },
    releaseStartReservation() {},
    async flushSaveRunState() {},
    rememberLogStore() {},
    getLogStore() { return undefined; },
    async clearPersistedRunState() {}
  };
  const server = http.createServer(createRequestHandler(context));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const exchange = async (code) => {
      const response = await fetch(`${origin}/api/auth/bootstrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      return { status: response.status, body: await response.json() };
    };

    assert.equal((await exchange("wrong-code")).status, 401);
    assert.deepEqual(await exchange("valid-code"), {
      status: 200,
      body: { token: "real-token" }
    });
    assert.equal((await exchange("valid-code")).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
