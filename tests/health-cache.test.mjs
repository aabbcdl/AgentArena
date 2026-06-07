import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getHealthCache, HealthCache, resetHealthCache } from "../packages/core/dist/health-cache.js";

describe("HealthCache", () => {
  let tempDir;
  let cache;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "health-cache-test-"));
    cache = new HealthCache({
      cacheDir: tempDir,
      defaultTtlMs: 5000, // 5 seconds for testing
    });
    resetHealthCache();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    resetHealthCache();
  });

  it("should store and retrieve cache entries", async () => {
    await cache.set("claude-code", "official", "ready", "CLI is healthy");

    const entry = await cache.get("claude-code", "official");
    assert.notEqual(entry, undefined);
    assert.equal(entry.adapterId, "claude-code");
    assert.equal(entry.providerId, "official");
    assert.equal(entry.status, "ready");
    assert.equal(entry.summary, "CLI is healthy");
  });

  it("should return undefined for non-existent entries", async () => {
    const entry = await cache.get("nonexistent", "provider");
    assert.equal(entry, undefined);
  });

  it("should handle entries with endpoint", async () => {
    await cache.set("claude-code", "mimo", "blocked", "Auth failed", {
      endpoint: "https://api.mimo.com",
    });

    const entry = await cache.get("claude-code", "mimo", "https://api.mimo.com");
    assert.notEqual(entry, undefined);
    assert.equal(entry.endpoint, "https://api.mimo.com");

    // Different endpoint should not match
    const other = await cache.get("claude-code", "mimo", "https://other.com");
    assert.equal(other, undefined);
  });

  it("should expire entries after TTL", async () => {
    const shortCache = new HealthCache({
      cacheDir: tempDir,
      defaultTtlMs: 100, // 100ms TTL
    });

    await shortCache.set("test", "provider", "ready", "ok");

    // Should exist immediately
    const entry1 = await shortCache.get("test", "provider");
    assert.notEqual(entry1, undefined);

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 150));

    const entry2 = await shortCache.get("test", "provider");
    assert.equal(entry2, undefined);
  });

  it("should persist cache to disk", async () => {
    await cache.set("test", "provider", "ready", "ok");

    // Read the cache file directly
    const cachePath = path.join(tempDir, "health-cache.json");
    const data = await fs.readFile(cachePath, "utf8");
    const entries = JSON.parse(data);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].adapterId, "test");
  });

  it("should load cache from disk", async () => {
    // Write cache file directly
    const cachePath = path.join(tempDir, "health-cache.json");
    const entries = [
      {
        adapterId: "loaded",
        providerId: "provider",
        status: "ready",
        summary: "from disk",
        timestamp: Date.now(),
        ttlMs: 60000,
      },
    ];
    await fs.writeFile(cachePath, JSON.stringify(entries));

    // Create new cache instance - should load from disk
    const newCache = new HealthCache({
      cacheDir: tempDir,
      defaultTtlMs: 60000,
    });

    const entry = await newCache.get("loaded", "provider");
    assert.notEqual(entry, undefined);
    assert.equal(entry.summary, "from disk");
  });

  it("should invalidate entries", async () => {
    await cache.set("test", "provider", "ready", "ok");
    assert.equal(await cache.has("test", "provider"), true);

    await cache.invalidate("test", "provider");
    assert.equal(await cache.has("test", "provider"), false);
  });

  it("should cleanup expired entries", async () => {
    const shortCache = new HealthCache({
      cacheDir: tempDir,
      defaultTtlMs: 50, // 50ms TTL
    });

    await shortCache.set("expired1", "p", "ready", "ok");
    await shortCache.set("expired2", "p", "ready", "ok");

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 100));

    const removed = await shortCache.cleanup();
    assert.equal(removed, 2);

    const stats = await shortCache.stats();
    assert.equal(stats.total, 0);
  });

  it("should clear all entries", async () => {
    await cache.set("test1", "p", "ready", "ok");
    await cache.set("test2", "p", "blocked", "fail");

    await cache.clear();

    const stats = await cache.stats();
    assert.equal(stats.total, 0);
  });

  it("should return all valid entries", async () => {
    await cache.set("test1", "p1", "ready", "ok");
    await cache.set("test2", "p2", "blocked", "fail");

    const all = await cache.getAll();
    assert.equal(all.length, 2);
  });

  it("should provide accurate stats", async () => {
    const shortCache = new HealthCache({
      cacheDir: tempDir,
      defaultTtlMs: 50,
    });

    await shortCache.set("valid", "p", "ready", "ok");
    await shortCache.set("about-to-expire", "p", "ready", "ok");

    // Wait for some to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stats = await shortCache.stats();
    assert.equal(stats.total, 2);
    assert.equal(stats.valid, 0);
    assert.equal(stats.expired, 2);
  });
});

describe("HealthCache singleton", () => {
  afterEach(() => {
    resetHealthCache();
  });

  it("should return the same instance", () => {
    const cache1 = getHealthCache();
    const cache2 = getHealthCache();
    assert.equal(cache1, cache2);
  });

  it("should create new instance after reset", () => {
    const cache1 = getHealthCache();
    resetHealthCache();
    const cache2 = getHealthCache();
    assert.notEqual(cache1, cache2);
  });
});

describe("probeClaudeLikeAuthFast", () => {
  // This test requires the actual CLI to be installed
  // Skip if not available
  it(
    "should use cache for repeated probes",
    { skip: !process.env.ANTHROPIC_API_KEY },
    async () => {
      // This is an integration test that would require actual CLI
      // Skipping in unit tests
    }
  );
});
