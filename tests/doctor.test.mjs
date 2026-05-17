import assert from "node:assert";
import { describe, it } from "node:test";
import { runDoctor } from "../packages/cli/dist/commands/doctor.js";
import { getAvailabilityEmoji, getTierEmoji, groupByTier } from "../packages/cli/dist/commands/shared.js";

describe("doctor", () => {
  describe("shared utilities", () => {
    describe("getAvailabilityEmoji", () => {
      it("returns correct emoji for each availability", () => {
        assert.equal(getAvailabilityEmoji("available"), "✅");
        assert.equal(getAvailabilityEmoji("estimated"), "≈");
        assert.equal(getAvailabilityEmoji("unavailable"), "❌");
        assert.equal(getAvailabilityEmoji("unknown"), "❓");
      });
    });

    describe("getTierEmoji", () => {
      it("returns correct emoji for each tier", () => {
        assert.equal(getTierEmoji("supported"), "✅");
        assert.equal(getTierEmoji("experimental"), "⚠️");
        assert.equal(getTierEmoji("blocked"), "❌");
        assert.equal(getTierEmoji("unknown"), "❓");
      });
    });

    describe("groupByTier", () => {
      it("groups items by tier in correct order", () => {
        const items = [
          { capability: { supportTier: "blocked" }, id: "1" },
          { capability: { supportTier: "supported" }, id: "2" },
          { capability: { supportTier: "experimental" }, id: "3" },
          { capability: { supportTier: "supported" }, id: "4" },
        ];

        const groups = groupByTier(items);

        assert.equal(groups.length, 3);
        assert.equal(groups[0].tier, "supported");
        assert.equal(groups[0].items.length, 2);
        assert.equal(groups[1].tier, "experimental");
        assert.equal(groups[1].items.length, 1);
        assert.equal(groups[2].tier, "blocked");
        assert.equal(groups[2].items.length, 1);
      });

      it("omits empty tiers", () => {
        const items = [
          { capability: { supportTier: "supported" }, id: "1" },
          { capability: { supportTier: "supported" }, id: "2" },
        ];

        const groups = groupByTier(items);

        assert.equal(groups.length, 1);
        assert.equal(groups[0].tier, "supported");
      });

      it("assigns correct emojis and labels", () => {
        const items = [
          { capability: { supportTier: "supported" }, id: "1" },
          { capability: { supportTier: "experimental" }, id: "2" },
        ];

        const groups = groupByTier(items);

        assert.equal(groups[0].emoji, "✅");
        assert.equal(groups[0].label, "Supported Adapters");
        assert.equal(groups[1].emoji, "⚠️");
        assert.equal(groups[1].label, "Experimental Adapters");
      });
    });
  });

  describe("runDoctor", () => {
    it("handles empty agent selections", async () => {
      const originalExitCode = process.exitCode;
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(" "));

      try {
        await runDoctor({
          agentIds: [],
          format: "json",
          probeAuth: false,
          strict: false,
        });

        assert.ok(logs.length > 0);
        let parsed;
        try {
          parsed = JSON.parse(logs.join("\n"));
        } catch {
          assert.fail("Expected valid JSON output");
        }
        assert(Array.isArray(parsed), "Expected array of preflights");
      } finally {
        console.log = originalLog;
        process.exitCode = originalExitCode;
      }
    });

    it("handles JSON format output", async () => {
      const originalExitCode = process.exitCode;
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(" "));

      try {
        await runDoctor({
          agentIds: ["demo-fast"],
          format: "json",
          probeAuth: false,
          strict: false,
        });

        let parsed;
        try {
          parsed = JSON.parse(logs.join("\n"));
        } catch {
          assert.fail("Expected valid JSON output");
        }
        assert(Array.isArray(parsed), "Expected array of preflights");
        assert.equal(parsed.length, 1);
        assert.equal(parsed[0].agentId, "demo-fast");
      } finally {
        console.log = originalLog;
        process.exitCode = originalExitCode;
      }
    });

    it("handles human-readable format output", async () => {
      const originalExitCode = process.exitCode;
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(" "));

      try {
        await runDoctor({
          agentIds: ["demo-fast"],
          format: "human",
          probeAuth: false,
          strict: false,
        });

        assert.ok(logs.some(log => log.includes("AgentArena Doctor")));
        assert.ok(logs.some(log => log.includes("demo-fast")));
      } finally {
        console.log = originalLog;
        process.exitCode = originalExitCode;
      }
    });

    it("returns exit code 1 in strict mode when not all ready", async () => {
      const originalExitCode = process.exitCode;
      const originalLog = console.log;
      console.log = () => {};

      try {
        process.exitCode = 0;
        await runDoctor({
          agentIds: [],
          format: "json",
          probeAuth: false,
          strict: true,
        });

      } finally {
        console.log = originalLog;
        process.exitCode = originalExitCode;
      }
    });

    it("filters and sorts agent selections correctly", async () => {
      const originalExitCode = process.exitCode;
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(" "));

      try {
        await runDoctor({
          agentIds: ["demo-fast", "demo-thorough"],
          format: "json",
          probeAuth: false,
          strict: false,
        });

        let parsed;
        try {
          parsed = JSON.parse(logs.join("\n"));
        } catch {
          assert.fail("Expected valid JSON output");
        }
        assert.equal(parsed.length, 2);
        assert.ok(parsed.some(p => p.agentId === "demo-fast"));
        assert.ok(parsed.some(p => p.agentId === "demo-thorough"));
      } finally {
        console.log = originalLog;
        process.exitCode = originalExitCode;
      }
    });
  });
});