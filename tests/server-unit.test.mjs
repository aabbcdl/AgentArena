import assert from "node:assert/strict";
import test from "node:test";

// Import server module functions directly (pure functions, no server startup needed)
import {
  checkAuthHeader,
  checkCorsOrigin,
  checkRateLimit,
  detectContentType,
  generateAuthToken,
  getClientIp,
  HttpError,
  jsonResponse,
  setTrustProxy,
  startRateLimitCleanup,
  textResponse,
} from "../packages/cli/dist/server/index.js";

// ─── checkAuthHeader tests ───

test("checkAuthHeader: non-API paths always pass", () => {
  const url = new URL("http://localhost:3000/index.html");
  assert.equal(checkAuthHeader(url, "GET", true, "secret-token", undefined), true);
  assert.equal(checkAuthHeader(url, "POST", false, "secret-token", undefined), true);
});

test("checkAuthHeader: localhost GET on non-sensitive API path passes without token", () => {
  const url = new URL("http://localhost:3000/api/adapters");
  assert.equal(checkAuthHeader(url, "GET", true, "secret-token", undefined), true);
});

test("checkAuthHeader: localhost POST on API path requires token", () => {
  const url = new URL("http://localhost:3000/api/adapters");
  assert.equal(checkAuthHeader(url, "POST", true, "secret-token", undefined), false);
  assert.equal(checkAuthHeader(url, "POST", true, "secret-token", "Bearer secret-token"), true);
});

test("checkAuthHeader: sensitive API paths require token even on localhost GET", () => {
  const token = "my-auth-token-1234";

  // /api/provider-profiles is sensitive
  const url1 = new URL("http://localhost:3000/api/provider-profiles");
  assert.equal(checkAuthHeader(url1, "GET", true, token, undefined), false, "provider-profiles GET should require token on localhost");
  assert.equal(checkAuthHeader(url1, "GET", true, token, `Bearer ${token}`), true, "provider-profiles GET should pass with valid token");

  // /api/provider-profiles/:id/secret is sensitive (sub-path)
  const url2 = new URL("http://localhost:3000/api/provider-profiles/my-profile/secret");
  assert.equal(checkAuthHeader(url2, "GET", true, token, undefined), false, "profile secret sub-path should require token");
  assert.equal(checkAuthHeader(url2, "GET", true, token, `Bearer ${token}`), true);

  // /api/run is sensitive
  const url3 = new URL("http://localhost:3000/api/run");
  assert.equal(checkAuthHeader(url3, "GET", true, token, undefined), false, "/api/run GET should require token");
  assert.equal(checkAuthHeader(url3, "GET", true, token, `Bearer ${token}`), true);
});

test("checkAuthHeader: non-localhost requires token for ALL API paths", () => {
  const token = "my-auth-token-1234";
  const url = new URL("http://192.168.1.100:3000/api/adapters");

  // GET without token on non-localhost
  assert.equal(checkAuthHeader(url, "GET", false, token, undefined), false);
  // GET with token
  assert.equal(checkAuthHeader(url, "GET", false, token, `Bearer ${token}`), true);
});

test("checkAuthHeader: wrong token is rejected", () => {
  const url = new URL("http://localhost:3000/api/run");
  assert.equal(checkAuthHeader(url, "POST", true, "correct-token", "Bearer wrong-token"), false);
});

test("checkAuthHeader: token without Bearer prefix is rejected", () => {
  const url = new URL("http://localhost:3000/api/run");
  assert.equal(checkAuthHeader(url, "POST", true, "correct-token", "correct-token"), false);
});

test("checkAuthHeader: timing-safe comparison — wrong-length tokens are rejected", () => {
  const url = new URL("http://localhost:3000/api/run");
  // Different length token should fail fast (before byte comparison)
  assert.equal(checkAuthHeader(url, "POST", true, "abc123", "Bearer x"), false);
  assert.equal(checkAuthHeader(url, "POST", true, "abc123", "Bearer abc1234567890"), false);
});

// ─── checkCorsOrigin tests ───

test("checkCorsOrigin: no origin passes", () => {
  assert.equal(checkCorsOrigin(undefined, "localhost", 3000), true);
});

test("checkCorsOrigin: matching localhost origin passes", () => {
  assert.equal(checkCorsOrigin("http://localhost:3000", "localhost", 3000), true);
});

test("checkCorsOrigin: 127.0.0.1 origin passes for localhost host", () => {
  assert.equal(checkCorsOrigin("http://127.0.0.1:3000", "localhost", 3000), true);
});

test("checkCorsOrigin: 0.0.0.0 host allows localhost and 127.0.0.1", () => {
  assert.equal(checkCorsOrigin("http://localhost:3000", "0.0.0.0", 3000), true);
  assert.equal(checkCorsOrigin("http://127.0.0.1:3000", "0.0.0.0", 3000), true);
  assert.equal(checkCorsOrigin("http://0.0.0.0:3000", "0.0.0.0", 3000), true);
});

test("checkCorsOrigin: foreign origin is rejected", () => {
  assert.equal(checkCorsOrigin("http://evil.com:3000", "localhost", 3000), false);
  assert.equal(checkCorsOrigin("http://evil.com", "localhost", 3000), false);
});

test("checkCorsOrigin: wrong port is rejected", () => {
  assert.equal(checkCorsOrigin("http://localhost:8080", "localhost", 3000), false);
});

// ─── Rate limit tests ───

test("checkRateLimit: allows requests under the limit", () => {
  const result = checkRateLimit("127.0.0.1", "/api/adapters");
  assert.equal(result.allowed, true);
});

test("checkRateLimit: blocks requests over the general limit", () => {
  // Simulate hitting the general rate limit
  const ip = `test-ip-${Date.now()}`;
  for (let i = 0; i < 120; i++) {
    checkRateLimit(ip, "/api/adapters");
  }
  const result = checkRateLimit(ip, "/api/adapters");
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterMs > 0, "Should provide retryAfterMs");
});

test("checkRateLimit: blocks expensive path requests over the expensive limit", () => {
  const ip = `test-expensive-${Date.now()}`;
  // RATE_LIMIT_EXPENSIVE_MAX = 30 (increased from 10 to reduce 429 errors on preflight)
  for (let i = 0; i < 30; i++) {
    checkRateLimit(ip, "/api/run");
  }
  const result = checkRateLimit(ip, "/api/run");
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterMs > 0);
});

test("checkRateLimit: check-compatibility is treated as expensive", () => {
  const ip = `test-compatibility-expensive-${Date.now()}`;
  for (let i = 0; i < 30; i++) {
    checkRateLimit(ip, "/api/check-compatibility");
  }
  assert.equal(checkRateLimit(ip, "/api/check-compatibility").allowed, false);
});

test("checkRateLimit: different IPs have independent limits", () => {
  const ip1 = `test-ip1-${Date.now()}`;
  const ip2 = `test-ip2-${Date.now()}`;
  for (let i = 0; i < 120; i++) {
    checkRateLimit(ip1, "/api/adapters");
  }
  // ip1 is blocked
  assert.equal(checkRateLimit(ip1, "/api/adapters").allowed, false);
  // ip2 is still allowed
  assert.equal(checkRateLimit(ip2, "/api/adapters").allowed, true);
});

test("checkRateLimit: expensive paths are tracked separately", () => {
  const ip = `test-mixed-${Date.now()}`;
  // Hit expensive limit (RATE_LIMIT_EXPENSIVE_MAX = 30)
  for (let i = 0; i < 30; i++) {
    checkRateLimit(ip, "/api/run");
  }
  // Expensive path should be blocked
  assert.equal(checkRateLimit(ip, "/api/run").allowed, false);
  // Non-expensive path should still be allowed (under 120)
  assert.equal(checkRateLimit(ip, "/api/adapters").allowed, true);
});

// ─── generateAuthToken tests ───

test("generateAuthToken: returns a high-entropy hex bearer token", () => {
  const token = generateAuthToken();
  assert.ok(token.length > 0, "Token should not be empty");
  assert.ok(/^[0-9a-f]{64}$/.test(token), "Token should be 32 random bytes encoded as hex");
});

test("generateAuthToken: generates unique tokens", () => {
  const tokens = new Set(Array.from({ length: 10 }, () => generateAuthToken()));
  assert.equal(tokens.size, 10, "All tokens should be unique");
});

// ─── jsonResponse tests ───

test("jsonResponse: includes security headers", () => {
  const res = jsonResponse({ test: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.headers["X-Frame-Options"], "DENY");
  assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(res.headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(res.headers.Pragma, "no-cache");
  assert.ok(res.headers["Content-Security-Policy"].includes("default-src 'self'"));
});

test("jsonResponse: custom status code", () => {
  const res = jsonResponse({ error: "not found" }, 404);
  assert.equal(res.statusCode, 404);
});

test("jsonResponse: body is valid JSON", () => {
  const res = jsonResponse({ key: "value" });
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.key, "value");
});

// ─── textResponse tests ───

test("textResponse: returns plain text with correct headers", () => {
  const res = textResponse("hello");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "hello");
  assert.equal(res.headers["Content-Type"], "text/plain; charset=utf-8");
  assert.equal(res.headers["Cache-Control"], "no-store");
});

// ─── HttpError tests ───

test("HttpError: has correct properties", () => {
  const err = new HttpError("test error", 418);
  assert.equal(err.message, "test error");
  assert.equal(err.statusCode, 418);
  assert.equal(err.name, "HttpError");
  assert.ok(err instanceof Error);
});

// ─── detectContentType tests ───

test("detectContentType: recognizes common web file types", () => {
  assert.equal(detectContentType("index.html"), "text/html; charset=utf-8");
  assert.equal(detectContentType("app.js"), "text/javascript; charset=utf-8");
  assert.equal(detectContentType("style.css"), "text/css; charset=utf-8");
  assert.equal(detectContentType("data.json"), "application/json; charset=utf-8");
  assert.equal(detectContentType("icon.svg"), "image/svg+xml");
  assert.equal(detectContentType("module.wasm"), "application/wasm");
  assert.equal(detectContentType("manifest.webmanifest"), "application/manifest+json");
});

test("detectContentType: falls back to octet-stream for unknown types", () => {
  assert.equal(detectContentType("file.xyz"), "application/octet-stream");
  assert.equal(detectContentType("file.bin"), "application/octet-stream");
});

// ─── startRateLimitCleanup returns a timer ───

test("startRateLimitCleanup: returns a Timer handle", () => {
  const timer = startRateLimitCleanup();
  assert.ok(timer, "Should return a timer handle");
  // Clean up
  clearInterval(timer);
});

// ─── getClientIp tests ───

test("getClientIp: returns socket IP when trustProxy is false", () => {
  setTrustProxy(false);
  const req = { socket: { remoteAddress: "192.168.1.100" }, headers: {} };
  assert.equal(getClientIp(req), "192.168.1.100");
});

test("getClientIp: returns socket IP when no X-Forwarded-For header", () => {
  setTrustProxy(true);
  const req = { socket: { remoteAddress: "10.0.0.1" }, headers: {} };
  assert.equal(getClientIp(req), "10.0.0.1");
  setTrustProxy(false);
});

test("getClientIp: extracts client IP from X-Forwarded-For with trusted proxy", () => {
  setTrustProxy(true);
  const req = {
    socket: { remoteAddress: "10.0.0.1" },
    headers: { "x-forwarded-for": "203.0.113.50, 10.0.0.1" }
  };
  // Should use second-to-last IP (the real client before the proxy)
  assert.equal(getClientIp(req), "203.0.113.50");
  setTrustProxy(false);
});

test("getClientIp: handles single IP in X-Forwarded-For", () => {
  setTrustProxy(true);
  const req = {
    socket: { remoteAddress: "10.0.0.1" },
    headers: { "x-forwarded-for": "203.0.113.50" }
  };
  assert.equal(getClientIp(req), "203.0.113.50");
  setTrustProxy(false);
});

test("getClientIp: returns 'unknown' when remoteAddress is undefined", () => {
  setTrustProxy(false);
  const req = { socket: {}, headers: {} };
  assert.equal(getClientIp(req), "unknown");
});

test("getClientIp: rejects untrusted proxy IP", () => {
  setTrustProxy(true, ["10.0.0.1"]);
  const req = {
    socket: { remoteAddress: "192.168.1.1" },
    headers: { "x-forwarded-for": "203.0.113.50, 192.168.1.1" }
  };
  // Socket IP is not in trusted set, so X-Forwarded-For is ignored
  assert.equal(getClientIp(req), "192.168.1.1");
  setTrustProxy(false);
});

test("getClientIp: trusts X-Forwarded-For from trusted proxy IP", () => {
  setTrustProxy(true, ["10.0.0.1"]);
  const req = {
    socket: { remoteAddress: "10.0.0.1" },
    headers: { "x-forwarded-for": "203.0.113.50, 10.0.0.1" }
  };
  assert.equal(getClientIp(req), "203.0.113.50");
  setTrustProxy(false);
});
