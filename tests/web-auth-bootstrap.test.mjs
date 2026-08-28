import assert from "node:assert/strict";
import test from "node:test";

function installBrowserGlobals(hash) {
  const stored = new Map();
  const replaceCalls = [];
  const location = {
    href: `http://127.0.0.1:4320/workbench/${hash}`,
    pathname: "/workbench/",
    search: "",
    hash
  };
  globalThis.window = {
    location,
    history: {
      replaceState(_state, _title, value) {
        replaceCalls.push(value);
        location.hash = value.includes("#") ? value.slice(value.indexOf("#")) : "";
      }
    }
  };
  globalThis.history = globalThis.window.history;
  globalThis.sessionStorage = {
    getItem(key) { return stored.get(key) ?? null; },
    setItem(key, value) { stored.set(key, String(value)); },
    removeItem(key) { stored.delete(key); }
  };
  globalThis.localStorage = {
    getItem() { return null; },
    removeItem() {}
  };
  return { stored, replaceCalls };
}

test("Workbench clears the bootstrap fragment before exchanging and reuses the session token", async () => {
  const browser = installBrowserGlobals("#bootstrap=one-time-code&view=runs");
  let resolveBootstrap;
  const bootstrapResponse = new Promise((resolve) => { resolveBootstrap = resolve; });
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/auth/bootstrap") return await bootstrapResponse;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = await import("../apps/web-report/workbench/src/api/client.ts?bootstrap-test");
  const requestPromise = client.apiFetch("/api/example");
  await Promise.resolve();

  assert.deepEqual(browser.replaceCalls, ["/workbench/#view=runs"]);
  assert.equal(browser.stored.has("agentarena-auth-token"), false);
  assert.equal(calls.length, 1);

  resolveBootstrap(new Response(JSON.stringify({ token: "real-token" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));
  await requestPromise;
  await client.apiFetch("/api/second");

  assert.equal(browser.stored.get("agentarena-auth-token"), "real-token");
  assert.equal(calls.filter((call) => call.url === "/api/auth/bootstrap").length, 1);
  assert.equal(new Headers(calls[1].options.headers).get("Authorization"), "Bearer real-token");
  assert.equal(new Headers(calls[2].options.headers).get("Authorization"), "Bearer real-token");
});

test("Legacy client clears obsolete token fragments and exchanges bootstrap once", async () => {
  const browser = installBrowserGlobals("#bootstrap=legacy-code&token=old-token&view=summary");
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/auth/bootstrap") {
      return new Response(JSON.stringify({ token: "legacy-real-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("{}", { status: 200 });
  };

  const helpers = await import("../apps/web-report/src/app-helpers.js?bootstrap-test");
  await helpers.apiFetch("/api/example");
  await helpers.apiFetch("/api/second");

  assert.deepEqual(browser.replaceCalls, ["/workbench/#view=summary"]);
  assert.equal(browser.stored.get("agentarena-auth-token"), "legacy-real-token");
  assert.equal(calls.filter((call) => call.url === "/api/auth/bootstrap").length, 1);
  assert.equal(calls[1].options.headers.Authorization, "Bearer legacy-real-token");
  assert.equal(calls[2].options.headers.Authorization, "Bearer legacy-real-token");
});

test("Workbench exchanges a local service password without persisting the password", async () => {
  const browser = installBrowserGlobals("");
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ token: "session-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const client = await import("../apps/web-report/workbench/src/api/client.ts?password-auth-test");
  await client.authenticateWithPassword("admin", "login");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/auth/login");
  assert.deepEqual(JSON.parse(calls[0].options.body), { password: "admin" });
  assert.equal(browser.stored.get("agentarena-auth-token"), "session-token");
  assert.equal(browser.stored.has("password"), false);
});
