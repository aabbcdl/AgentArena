import assert from "node:assert";
import { describe, it } from "node:test";
import {
  agentConcurrency,
  agentExecuteTimeoutMs,
  DEFAULT_AGENT_CONCURRENCY,
  mapWithConcurrency,
  resolvePositiveInt,
} from "../packages/runner/dist/concurrency.js";

describe("concurrency", () => {
  describe("resolvePositiveInt", () => {
    it("returns parsed positive integer", () => {
      assert.equal(resolvePositiveInt("5", 10), 5);
      assert.equal(resolvePositiveInt("100", 50), 100);
    });

    it("returns fallback for non-positive values", () => {
      assert.equal(resolvePositiveInt("0", 10), 10);
      assert.equal(resolvePositiveInt("-5", 10), 10);
      assert.equal(resolvePositiveInt("abc", 10), 10);
      assert.equal(resolvePositiveInt(undefined, 10), 10);
      assert.equal(resolvePositiveInt("", 10), 10);
    });
  });

  describe("agentConcurrency", () => {
    it("returns maxConcurrency when provided", () => {
      assert.equal(agentConcurrency({ maxConcurrency: 5 }), 5);
    });

    it("returns DEFAULT_AGENT_CONCURRENCY by default", () => {
      assert.equal(agentConcurrency({}), DEFAULT_AGENT_CONCURRENCY);
    });

    it("respects AGENTARENA_MAX_CONCURRENCY env var", () => {
      const original = process.env.AGENTARENA_MAX_CONCURRENCY;
      process.env.AGENTARENA_MAX_CONCURRENCY = "3";
      try {
        assert.equal(agentConcurrency({}), 3);
      } finally {
        process.env.AGENTARENA_MAX_CONCURRENCY = original;
      }
    });
  });

  describe("agentExecuteTimeoutMs", () => {
    it("returns default timeout when no env var", () => {
      const original = process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS;
      delete process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS;
      try {
        assert.equal(agentExecuteTimeoutMs(), 30 * 60 * 1000);
      } finally {
        process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS = original;
      }
    });

    it("respects AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS env var", () => {
      const original = process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS;
      process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS = "60000";
      try {
        assert.equal(agentExecuteTimeoutMs(), 60000);
      } finally {
        process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS = original;
      }
    });
  });

  describe("mapWithConcurrency", () => {
    it("processes empty array", async () => {
      const result = await mapWithConcurrency([], 2, () => Promise.resolve(1));
      assert.deepEqual(result, { results: [], aborted: false });
    });

    it("processes items with concurrency limit", async () => {
      const order = [];
      const delays = [10, 5, 15, 3];
      const items = [0, 1, 2, 3];

      await mapWithConcurrency(items, 2, async (item, index) => {
        order.push({ phase: "start", item });
        await new Promise((r) => setTimeout(r, delays[index]));
        order.push({ phase: "end", item });
        return item * 2;
      });

      assert.deepEqual(order, [
        { phase: "start", item: 0 },
        { phase: "start", item: 1 },
        { phase: "end", item: 1 },
        { phase: "start", item: 2 },
        { phase: "end", item: 0 },
        { phase: "start", item: 3 },
        { phase: "end", item: 3 },
        { phase: "end", item: 2 },
      ]);
    });

    it("limits concurrent workers", async () => {
      let activeWorkers = 0;
      let maxConcurrent = 0;
      const items = Array.from({ length: 10 }, (_, i) => i);

      await mapWithConcurrency(items, 3, async () => {
        activeWorkers++;
        maxConcurrent = Math.max(maxConcurrent, activeWorkers);
        await new Promise((r) => setTimeout(r, 10));
        activeWorkers--;
        return null;
      });

      assert.equal(maxConcurrent, 3);
    });

    it("handles errors in mapper", async () => {
      const items = [1, 2, 3];
      const result = await mapWithConcurrency(items, 2, async (item) => {
        if (item === 2) throw new Error("test error");
        return item * 2;
      });

      assert.equal(result.aborted, false);
      assert.equal(result.results.length, 3);
      assert.equal(result.results[0], 2);
      assert(result.results[1] instanceof Error);
      assert.equal(result.results[1].message, "test error");
      assert.equal(result.results[2], 6);
    });

    it("stops on abort signal", async () => {
      const controller = new AbortController();
      const items = Array.from({ length: 10 }, (_, i) => i);
      let processed = 0;

      const promise = mapWithConcurrency(items, 2, async (item) => {
        processed++;
        await new Promise((r) => setTimeout(r, 50));
        return item;
      }, { signal: controller.signal });

      setTimeout(() => controller.abort(), 30);
      const result = await promise;

      assert.equal(result.aborted, true);
      assert.ok(processed < 10, `Expected less than 10 processed, got ${processed}`);
    });

    it("handles abort error in mapper", async () => {
      const items = [1, 2, 3];
      const controller = new AbortController();
      const result = await mapWithConcurrency(items, 2, async () => {
        controller.abort();
        throw new Error("AbortError");
      }, { signal: controller.signal });

      assert.equal(result.aborted, true);
    });

    it("preserves index alignment when abort skips items", async () => {
      const controller = new AbortController();
      const items = [0, 1, 2, 3, 4];

      const result = await mapWithConcurrency(items, 1, async (item) => {
        if (item === 2) {
          controller.abort();
          return undefined;
        }
        return item * 10;
      }, { signal: controller.signal });

      assert.equal(result.aborted, true);
      assert.equal(result.results.length, 5);
      assert.equal(result.results[0], 0);
      assert.equal(result.results[1], 10);
      assert.equal(result.results[2], undefined);
      assert.equal(result.results[3], undefined);
      assert.equal(result.results[4], undefined);
    });

    it("preserves index alignment with undefined gaps on concurrent abort", async () => {
      const controller = new AbortController();
      const items = [0, 1, 2, 3, 4, 5];
      const started = [];

      const result = await mapWithConcurrency(items, 3, async (item) => {
        started.push(item);
        await new Promise((r) => setTimeout(r, 20));
        if (item === 1) {
          controller.abort();
        }
        return item * 10;
      }, { signal: controller.signal });

      assert.equal(result.aborted, true);
      assert.equal(result.results.length, 6);
      for (let i = 0; i < result.results.length; i++) {
        if (result.results[i] !== undefined && !(result.results[i] instanceof Error)) {
          const indexInStarted = started.indexOf(i);
          assert.ok(indexInStarted !== -1, `result[${i}] = ${result.results[i]} but item ${i} was never started`);
          assert.equal(result.results[i], i * 10);
        }
      }
    });

    it("handles concurrency limit exceeding items length", async () => {
      const items = [1, 2];
      const result = await mapWithConcurrency(items, 10, (item) => Promise.resolve(item * 2));
      assert.deepEqual(result.results, [2, 4]);
      assert.equal(result.aborted, false);
    });

    it("handles zero concurrency limit by using 1", async () => {
      const items = [1, 2, 3];
      const result = await mapWithConcurrency(items, 0, (item) => Promise.resolve(item * 2));
      assert.deepEqual(result.results, [2, 4, 6]);
    });

    it("handles negative concurrency limit by using 1", async () => {
      const items = [1, 2, 3];
      const result = await mapWithConcurrency(items, -5, (item) => Promise.resolve(item * 2));
      assert.deepEqual(result.results, [2, 4, 6]);
    });
  });
});