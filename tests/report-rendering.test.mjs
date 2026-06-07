import assert from "node:assert";
import { describe, it } from "node:test";
import { escapeHtml } from "../packages/core/dist/index.js";
import { renderHtml } from "../packages/report/dist/html-template.js";
import { generateCsv, sanitizeRun } from "../packages/report/dist/index.js";

describe("report rendering", () => {
  describe("escapeHtml", () => {
    it("escapes HTML special characters", () => {
      assert.equal(escapeHtml("<script>alert('xss')</script>"), "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
      assert.equal(escapeHtml('"double quotes"'), "&quot;double quotes&quot;");
      assert.equal(escapeHtml("& ampersand"), "&amp; ampersand");
      assert.equal(escapeHtml("> greater than"), "&gt; greater than");
    });

    it("handles null and undefined", () => {
      assert.equal(escapeHtml(null), "");
      assert.equal(escapeHtml(undefined), "");
    });
  });

  describe("generateCsv", () => {
    it("generates valid CSV with headers", () => {
      const run = {
        results: [{
          agentId: "test-agent",
          baseAgentId: "test",
          variantId: "v1",
          displayLabel: "Test Agent",
          status: "success",
          compositeScore: 85.5,
          durationMs: 12345,
          tokenUsage: 1000,
          estimatedCostUsd: 0.05,
          costKnown: true,
          changedFiles: ["file1.js"],
          judgeResults: [],
          resolvedRuntime: {
            effectiveModel: "test-model",
            effectiveAgentVersion: "1.0.0",
            providerProfileName: "test-provider"
          },
          diff: { added: [], changed: [], removed: [] }
        }]
      };

      const csv = generateCsv(run);
      const lines = csv.trim().split("\n");
      
      assert.equal(lines.length, 2, "Should have header and one data row");
      assert.ok(lines[0].includes("Agent"), "Should have Agent header");
      assert.ok(lines[0].includes("Cost (USD)"), "Should have Cost header");
      assert.ok(lines[1].includes("Test Agent"), "Should include displayLabel");
      assert.ok(lines[1].includes("0.0500"), "Should include formatted cost");
    });

    it("handles CSV with special characters in displayLabel", () => {
      const run = {
        results: [{
          agentId: "test",
          baseAgentId: "test",
          variantId: "",
          displayLabel: 'Agent, with "quotes"',
          status: "success",
          compositeScore: 0,
          durationMs: 0,
          tokenUsage: 0,
          estimatedCostUsd: 0,
          costKnown: true,
          changedFiles: [],
          judgeResults: [],
          resolvedRuntime: {},
          diff: { added: [], changed: [], removed: [] }
        }]
      };

      const csv = generateCsv(run);
      const lines = csv.trim().split("\n");
      
      assert.ok(lines.length >= 2, "Should have header and data row");
      assert.ok(lines[1].includes('"'), "Special chars should be quoted");
    });

    it("handles missing cost data", () => {
      const run = {
        results: [{
          agentId: "test",
          baseAgentId: "test",
          variantId: "",
          displayLabel: "Test",
          status: "success",
          compositeScore: 0,
          durationMs: 0,
          tokenUsage: 0,
          estimatedCostUsd: 0,
          costKnown: false,
          changedFiles: [],
          judgeResults: [],
          resolvedRuntime: {},
          diff: { added: [], changed: [], removed: [] }
        }]
      };

      const csv = generateCsv(run);
      assert.ok(csv.includes("n/a"));
    });
  });

  describe("sanitizeRun", () => {
    const baseResult = {
      agentId: "demo-fast",
      workspacePath: "/tmp/ws/demo-fast",
      tracePath: "/abs/out/agents/demo-fast/trace.jsonl",
      preflight: { command: "secret-cmd" },
      setupResults: [],
      judgeResults: [],
      teardownResults: []
    };
    const baseRun = {
      runId: "r1",
      createdAt: "2026-01-01T00:00:00Z",
      repoPath: "/abs/repo",
      outputPath: "/abs/out",
      task: { id: "t", title: "T", prompt: "do x" },
      preflights: []
    };

    it("redacts the assembled prompt from shareable output", () => {
      const run = {
        ...baseRun,
        results: [{ ...baseResult, assembledPrompt: "internal file contents and API_KEY=sk-leak-123" }]
      };
      const sanitized = sanitizeRun(run);
      assert.equal(sanitized.results[0].assembledPrompt, "[redacted]");
      assert.ok(
        !JSON.stringify(sanitized).includes("API_KEY=sk-leak-123"),
        "prompt secret must not survive sanitization"
      );
    });

    it("leaves an absent assembled prompt undefined", () => {
      const run = { ...baseRun, results: [{ ...baseResult, assembledPrompt: undefined }] };
      assert.equal(sanitizeRun(run).results[0].assembledPrompt, undefined);
    });
  });

  describe("renderHtml", () => {
    it("renders basic HTML structure", () => {
      const run = {
        runId: "test-run-123",
        task: {
          title: "Test Task",
          prompt: "Test prompt",
          metadata: {
            objective: "Test objective",
            judgeRationale: "Test rationale",
            source: "test-source",
            owner: "test-owner",
            repoTypes: ["javascript", "typescript"]
          }
        },
        repoPath: "/path/to/repo",
        createdAt: "2024-01-01T00:00:00Z",
        scoreScope: "run-local",
        preflights: [],
        results: []
      };

      const html = renderHtml(run, "en");
      
      assert.ok(html.includes("<!doctype html>"));
      assert.ok(html.includes("Test Task"));
      assert.ok(html.includes("Test prompt"));
    });

    it("escapes XSS in task title", () => {
      const run = {
        runId: "test-run",
        task: {
          title: '<script>alert("XSS")</script>',
          prompt: "Safe prompt"
        },
        repoPath: "/path/to/repo",
        createdAt: "2024-01-01T00:00:00Z",
        scoreScope: "run-local",
        preflights: [],
        results: []
      };

      const html = renderHtml(run, "en");
      
      assert.ok(html.includes("&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;"));
      assert.ok(!html.includes('<script>alert("XSS")</script>'));
    });

    it("escapes XSS in preflight details", () => {
      const run = {
        runId: "test-run",
        task: {
          title: "Test Task",
          prompt: "Test prompt"
        },
        repoPath: "/path/to/repo",
        createdAt: "2024-01-01T00:00:00Z",
        scoreScope: "run-local",
        preflights: [{
          agentId: "test-agent",
          displayLabel: '<img src=x onerror=alert(1)>',
          status: "ready",
          summary: "All good",
          capability: {
            supportTier: "supported",
            invocationMethod: "cli",
            tokenAvailability: "available",
            costAvailability: "available",
            traceRichness: "rich",
            authPrerequisites: [],
            knownLimitations: []
          }
        }],
        results: []
      };

      const html = renderHtml(run, "en");
      
      assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
      assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
    });

    it("escapes XSS in agent results", () => {
      const run = {
        runId: "test-run",
        task: {
          title: "Test Task",
          prompt: "Test prompt"
        },
        repoPath: "/path/to/repo",
        createdAt: "2024-01-01T00:00:00Z",
        scoreScope: "run-local",
        preflights: [],
        results: [{
          agentId: "test-agent",
          baseAgentId: "test-base",
          variantId: "",
          displayLabel: '<script>stealCookies()</script>',
          status: "success",
          compositeScore: 85,
          durationMs: 1000,
          tokenUsage: 1000,
          estimatedCostUsd: 0.05,
          costKnown: true,
          changedFiles: [],
          summary: "Done",
          preflight: { status: "ready", summary: "Ready" },
          diff: { added: [], changed: [], removed: [] },
          judgeResults: [],
          setupResults: [],
          teardownResults: []
        }]
      };

      const html = renderHtml(run, "en");
      
      assert.ok(html.includes("&lt;script&gt;stealCookies()&lt;/script&gt;"));
      assert.ok(!html.includes('<script>stealCookies()</script>'));
    });

    it("handles Chinese locale", () => {
      const run = {
        runId: "test-run",
        task: {
          title: "中文任务",
          prompt: "中文提示"
        },
        repoPath: "/path/to/repo",
        createdAt: "2024-01-01T00:00:00Z",
        scoreScope: "run-local",
        preflights: [],
        results: []
      };

      const html = renderHtml(run, "zh-CN");
      
      assert.ok(html.includes("中文任务"), "Chinese title should be present");
      assert.ok(html.includes("中文提示"), "Chinese prompt should be present");
      assert.ok(html.includes("zh-CN"), "Chinese locale should be in HTML tag");
    });

    it("renders leaderboard section", () => {
      const run = {
        runId: "test-run",
        task: {
          title: "Test Task",
          prompt: "Test prompt"
        },
        repoPath: "/path/to/repo",
        createdAt: "2024-01-01T00:00:00Z",
        scoreScope: "run-local",
        preflights: [],
        results: []
      };

      const leaderboard = {
        comparableRunCount: 10,
        excludedRunCount: 2,
        difficultyFilter: "all",
        rows: [{
          displayLabel: "Test Agent",
          identity: {
            baseAgentId: "test",
            providerProfile: "default",
            model: "test-model",
            version: "1.0.0"
          },
          stats: {
            runCount: 5,
            averageScore: 85.5,
            winRate: 0.7,
            winCount: 7,
            totalComparisons: 10,
            successRate: 0.9,
            firstPassRate: 0.8,
            medianDurationMs: 10000,
            medianCostUsd: 0.05,
            lastSeenAt: "2024-01-15T00:00:00Z",
            sampleSizeSufficient: true
          }
        }]
      };

      const html = renderHtml(run, "en", leaderboard);
      
      assert.ok(html.includes("Historical Leaderboard"));
      assert.ok(html.includes("Test Agent"));
      assert.ok(html.includes("85.5"));
      assert.ok(html.includes("70.0%"));
    });
  });
});