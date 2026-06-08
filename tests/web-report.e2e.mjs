import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";

async function getAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function startUiServer(cwd) {
  const cliPath = path.resolve(cwd, "packages/cli/dist/index.js");
  const port = await getAvailablePort();
  const child = spawn(process.execPath, [cliPath, "ui", "--host", "127.0.0.1", "--port", String(port), "--no-open"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BROWSER: "none"
    }
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`UI server did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 15000);

    child.stdout.on("data", () => {
      if (stdout.includes("AgentArena UI server running")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`UI server exited early with code ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });

  return {
    port,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  };
}

async function loadChromiumOrSkip(t) {
  if (process.env.AGENTARENA_RUN_BROWSER_SMOKE !== "1") {
    t.skip("Set AGENTARENA_RUN_BROWSER_SMOKE=1 to run browser smoke tests.");
    return null;
  }

  try {
    const { chromium } = await import("playwright");
    const probe = await chromium.launch({ headless: true });
    await probe.close();
    return chromium;
  } catch (error) {
    t.skip(`Playwright is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function expandLauncherIfNeeded(page) {
  const launcherBody = page.locator("#launcher-body");
  if (await launcherBody.isVisible()) {
    return;
  }

  const launcherToggle = page.locator("#launcher-toggle");
  if (await launcherToggle.isVisible()) {
    await launcherToggle.click();
    await launcherBody.waitFor({ state: "visible", timeout: 10000 });
  }
}

function createTestRun() {
  return {
    runId: "test-run-001",
    createdAt: "2026-03-14T00:00:00.000Z",
    task: {
      id: "test-task",
      title: "Test Task",
      schemaVersion: "agentarena.taskpack/v1",
      difficulty: "easy",
      description: "Test task description",
      objective: "Verify the dashboard renders a loaded run.",
      judgeRationale: "Use a small two-agent fixture to exercise run views.",
      tags: ["test"]
    },
    results: [
      {
        agentId: "agent-a",
        variantId: "agent-a",
        displayLabel: "Agent A",
        baseAgentId: "agent-a",
        agentTitle: "Agent A",
        status: "success",
        durationMs: 5000,
        tokenUsage: 1000,
        estimatedCostUsd: 0.05,
        costKnown: true,
        changedFiles: ["file1.js", "file2.js"],
        diff: {
          added: ["file1.js"],
          changed: ["file2.js"],
          removed: []
        },
        judgeResults: [
          { judgeId: "j1", label: "Judge 1", type: "file-check", success: true, durationMs: 10 },
          { judgeId: "j2", label: "Judge 2", type: "file-check", success: false, durationMs: 10 }
        ],
        summary: "Agent A summary",
        requestedConfig: {},
        resolvedRuntime: null,
        setupResults: [],
        teardownResults: [],
        tracePath: "run/agents/agent-a/trace.jsonl",
        workspacePath: "workspace/agent-a"
      },
      {
        agentId: "agent-b",
        variantId: "agent-b",
        displayLabel: "Agent B",
        baseAgentId: "agent-b",
        agentTitle: "Agent B",
        status: "failed",
        durationMs: 8000,
        tokenUsage: 2000,
        estimatedCostUsd: 0.1,
        costKnown: true,
        changedFiles: [],
        diff: {
          added: [],
          changed: [],
          removed: []
        },
        judgeResults: [{ judgeId: "j1", label: "Judge 1", type: "file-check", success: false, durationMs: 10 }],
        summary: "Agent B failed",
        requestedConfig: {},
        resolvedRuntime: null,
        setupResults: [],
        teardownResults: [],
        tracePath: "run/agents/agent-b/trace.jsonl",
        workspacePath: "workspace/agent-b"
      }
    ],
    preflights: [],
    scoreMode: "practical",
    scoreScope: "same run only",
    scoreValidityNote: "This score only applies within this run."
  };
}

async function injectTestRun(page) {
  const runJson = JSON.stringify(createTestRun());
  await page.locator("#result-loader-panel").evaluate((el) => {
    el.open = true;
  });
  await page.locator("#summary-file").setInputFiles({
    name: "summary.json",
    mimeType: "application/json",
    buffer: Buffer.from(runJson)
  });
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll("[data-compare-agent-id]").length;
    const dashboard = document.getElementById("dashboard");
    return rows >= 2 && dashboard && !dashboard.classList.contains("hidden");
  });
}

test("web-report browser smoke renders launcher and supports zh/en switching", {
  timeout: 120000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;
  const cwd = path.resolve(".");
  const uiServer = await startUiServer(cwd);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  try {
    await page.goto(`http://127.0.0.1:${uiServer.port}/`, {
      waitUntil: "networkidle",
      timeout: 30000
    });

    const appTitleZh = await page.locator("#app-title").textContent();
    await expandLauncherIfNeeded(page);
    const launcherRunZh = await page.locator("#launcher-run").textContent();
    const bodyZh = await page.locator("body").innerText();

    await page.selectOption("#language-select", "en");
    await page.waitForFunction(() => document.getElementById("app-title")?.textContent === "Benchmark");
    const appTitleEn = await page.locator("#app-title").textContent();
    const launcherRunEn = await page.locator("#launcher-run").textContent();

    await page.selectOption("#language-select", "zh-CN");
    await page.waitForFunction(() => document.getElementById("app-title")?.textContent === "跑分配置");
    const appTitleZhAgain = await page.locator("#app-title").textContent();

    assert.equal(appTitleZh, "跑分配置");
    assert.equal(launcherRunZh?.trim(), "开始跑分");
    assert.equal(appTitleEn, "Benchmark");
    assert.equal(launcherRunEn?.trim(), "Start Benchmark");
    assert.equal(appTitleZhAgain, "跑分配置");
    assert.match(bodyZh, /发起跑分/);
    assert.doesNotMatch(bodyZh, /\uFFFD/);
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("mobile sidebar opens and closes via toggle and backdrop", {
  timeout: 120000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;
  const cwd = path.resolve(".");
  const uiServer = await startUiServer(cwd);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 600, height: 800 } });

  try {
    await page.goto(`http://127.0.0.1:${uiServer.port}/`, {
      waitUntil: "networkidle",
      timeout: 30000
    });

    const toggleVisible = await page.locator("#sidebar-toggle").isVisible();
    assert.equal(toggleVisible, true, "sidebar toggle should be visible at mobile width");

    const sidebarOpenBefore = await page.locator(".sidebar").evaluate((el) => el.classList.contains("sidebar-open"));
    assert.equal(sidebarOpenBefore, false, "sidebar should be closed initially");

    await page.locator("#sidebar-toggle").evaluate((el) => el.click());
    await page.waitForFunction(() => document.querySelector(".sidebar")?.classList.contains("sidebar-open"));
    const sidebarOpenAfterToggle = await page.locator(".sidebar").evaluate((el) => el.classList.contains("sidebar-open"));
    assert.equal(sidebarOpenAfterToggle, true, "sidebar should open after toggle click");

    await page.locator("#sidebar-backdrop").evaluate((el) => el.click());
    await page.waitForFunction(() => !document.querySelector(".sidebar")?.classList.contains("sidebar-open"));
    const sidebarOpenAfterBackdrop = await page.locator(".sidebar").evaluate((el) => el.classList.contains("sidebar-open"));
    assert.equal(sidebarOpenAfterBackdrop, false, "sidebar should close after backdrop click");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("wrong results file shows a visible error and run list items stay valid", {
  timeout: 120000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;
  const cwd = path.resolve(".");
  const uiServer = await startUiServer(cwd);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  try {
    await page.goto(`http://127.0.0.1:${uiServer.port}/`, {
      waitUntil: "networkidle",
      timeout: 30000
    });

    await expandLauncherIfNeeded(page);
    await page.locator("#summary-file").setInputFiles({
      name: "summary.json",
      mimeType: "application/json",
      buffer: Buffer.from("{not valid json")
    });
    await page.waitForFunction(() => {
      const el = document.getElementById("result-loader-message");
      return Boolean(el && !el.hidden && el.textContent && el.textContent.length > 0);
    });

    const notice = await page.locator("#result-loader-message").textContent();
    assert.match(notice ?? "", /summary\.json|解析|parse|无法解析/i);

    await injectTestRun(page);

    const runCardTag = await page.locator("#run-list .run-button").first().evaluate((el) => el.tagName);
    assert.equal(runCardTag, "DIV");

    const deleteTitle = await page.locator("#run-list [data-role='delete-run']").first().getAttribute("title");
    assert.match(deleteTitle ?? "", /移除|Remove/);

    const actionCount = await page.locator("#run-list .run-action-btn").count();
    assert.ok(actionCount >= 2, "run cards should expose separate action buttons");

    await page.locator("#run-list .run-button").first().click();
    await page.waitForFunction(() => document.querySelector("#run-list .run-button")?.classList.contains("active"));

    const activeClass = await page.locator("#run-list .run-button").first().evaluate((el) => el.classList.contains("active"));
    assert.equal(activeClass, true, "clicking the row should still select the run");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("web-report preserves selected agent and language across reload", {
  timeout: 120000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;
  const cwd = path.resolve(".");
  const uiServer = await startUiServer(cwd);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  try {
    await page.goto(`http://127.0.0.1:${uiServer.port}/`, {
      waitUntil: "networkidle",
      timeout: 30000
    });

    await injectTestRun(page);
    const selectedAgentKey = await page.locator("[data-compare-agent-id]").nth(1).getAttribute("data-compare-agent-id");
    assert.ok(selectedAgentKey, "expected a second agent row to select");
    await page.locator(`[data-compare-agent-id="${selectedAgentKey}"]`).click();
    await page.selectOption("#language-select", "en");
    await page.waitForFunction(() => new URLSearchParams(window.location.search).get("lang") === "en");

    const beforeReloadUrl = page.url();
    assert.match(beforeReloadUrl, /run=test-run-001/);
    assert.equal(new URL(beforeReloadUrl).searchParams.get("agent"), selectedAgentKey);

    await page.reload({ waitUntil: "networkidle", timeout: 30000 });
    await page.waitForFunction((agentKey) => {
      const dashboard = document.getElementById("dashboard");
      const selectedAgent = document.querySelector(`[data-compare-agent-id="${CSS.escape(agentKey)}"]`);
      return Boolean(
        dashboard &&
          !dashboard.classList.contains("hidden") &&
          selectedAgent?.classList.contains("active") &&
          document.getElementById("app-title")?.textContent === "Report · Test Task"
      );
    }, selectedAgentKey);

    const appTitle = await page.locator("#app-title").textContent();
    assert.equal(appTitle, "Report · Test Task");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("clicking a comparison bar row selects the agent", {
  timeout: 120000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;
  const cwd = path.resolve(".");
  const uiServer = await startUiServer(cwd);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  try {
    await page.goto(`http://127.0.0.1:${uiServer.port}/`, {
      waitUntil: "networkidle",
      timeout: 30000
    });

    await injectTestRun(page);

    const barRows = await page.locator("[data-bar-agent-id]").count();
    assert.ok(barRows >= 2, "should have at least 2 bar rows");

    const firstBar = page.locator("[data-bar-agent-id]").first();
    await firstBar.scrollIntoViewIfNeeded();
    await firstBar.click();
    await page.waitForFunction(() => document.querySelector("[data-bar-agent-id]")?.classList.contains("bar-row-active"));

    const isActive = await firstBar.evaluate((el) => el.classList.contains("bar-row-active"));
    assert.equal(isActive, true, "clicked bar row should have active class");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("clicking the selected compare table row toggles inline detail", {
  timeout: 120000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;
  const cwd = path.resolve(".");
  const uiServer = await startUiServer(cwd);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  try {
    await page.goto(`http://127.0.0.1:${uiServer.port}/`, {
      waitUntil: "networkidle",
      timeout: 30000
    });

    await injectTestRun(page);

    const firstRow = page.locator("[data-compare-agent-id]").first();
    await firstRow.scrollIntoViewIfNeeded();
    await firstRow.click();
    await page.waitForSelector(".compare-detail-row", { state: "visible" });

    const detailVisible = await page.locator(".compare-detail-row").isVisible();
    assert.equal(detailVisible, true, "detail row should appear after clicking the selected row");

    await firstRow.click();
    await page.waitForFunction(() => document.querySelectorAll(".compare-detail-row").length === 0);

    const detailCount = await page.locator(".compare-detail-row").count();
    assert.equal(detailCount, 0, "detail row should disappear after clicking the selected row again");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("score weight preset buttons update active state", {
  concurrency: false,
  timeout: 30000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;

  const root = path.resolve(import.meta.dirname, "..");
  const uiServer = await startUiServer(root);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${uiServer.port}`);

    // Load demo data
    await page.locator("#try-demo-btn").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-compare-agent-id]").length > 0, { timeout: 10000 });

    // Check that score weight section exists
    const scoreSection = page.locator("#score-weights-title");
    assert.ok(await scoreSection.isVisible(), "score weights section should be visible");

    // Check that preset buttons exist
    const presetButtons = page.locator("button[data-score-preset]");
    const count = await presetButtons.count();
    assert.ok(count > 0, "should have preset buttons");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("custom score weight sliders re-score the compare table", {
  concurrency: false,
  timeout: 120000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;

  const root = path.resolve(import.meta.dirname, "..");
  const uiServer = await startUiServer(root);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(`http://127.0.0.1:${uiServer.port}`);
    await injectTestRun(page);

    const scoreCell = page.locator("[data-compare-agent-id^='agent-a@@'] .compare-score .score-cell");
    const before = (await scoreCell.textContent())?.trim() ?? "";
    assert.ok(before, "agent score should be rendered before changing weights");

    await page.locator("#weight-sliders input[data-weight='status']").evaluate((input) => {
      input.value = "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await page.waitForFunction((previousScore) => {
      const current = document
        .querySelector("[data-compare-agent-id^='agent-a@@'] .compare-score .score-cell")
        ?.textContent
        ?.trim();
      return Boolean(current && current !== previousScore);
    }, before);

    const after = (await scoreCell.textContent())?.trim() ?? "";
    assert.notEqual(after, before, "dragging a custom weight slider should change the rendered score");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("trace replay toggle opens and renders trace events", {
  concurrency: false,
  timeout: 120000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;

  const root = path.resolve(import.meta.dirname, "..");
  const uiServer = await startUiServer(root);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(`http://127.0.0.1:${uiServer.port}`);
    await injectTestRun(page);

    await page.evaluate(() => {
      const events = [
        { timestamp: "2026-03-14T00:00:00.000Z", agentId: "agent-a", runId: "test-run-001", type: "setup:start", message: "workspace ready" },
        { timestamp: "2026-03-14T00:00:00.250Z", agentId: "agent-a", runId: "test-run-001", type: "adapter:execute", message: "agent edited files" },
        { timestamp: "2026-03-14T00:00:00.500Z", agentId: "agent-a", runId: "test-run-001", type: "judge:result", message: "judge finished" }
      ];
      const jsonl = events.map((event) => JSON.stringify(event)).join("\n");
      window.state.run.results[0].traceFile = new Blob([jsonl], { type: "application/jsonl" });
    });

    const toggle = page.locator("#trace-replay-toggle");
    await toggle.waitFor({ state: "visible", timeout: 10000 });
    await toggle.click();

    await page.waitForFunction(() => {
      const panel = document.getElementById("trace-replay-section");
      const step = document.querySelector(".trace-step-card");
      return Boolean(panel && !panel.classList.contains("hidden") && step?.textContent?.includes("workspace ready"));
    });

    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal((await page.locator("#trace-total-events").textContent())?.trim(), "3");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("run list delete button removes run", {
  concurrency: false,
  timeout: 30000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;

  const root = path.resolve(import.meta.dirname, "..");
  const uiServer = await startUiServer(root);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${uiServer.port}`);

    // Load demo data
    await page.locator("#try-demo-btn").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-compare-agent-id]").length > 0, { timeout: 10000 });

    // Check run list has items
    const runItems = page.locator("[data-run-id]");
    const initialCount = await runItems.count();
    assert.ok(initialCount > 0, "should have run list items");

    // Find and click delete button (handle the confirm dialog)
    page.once("dialog", (dialog) => dialog.accept());
    const deleteBtn = page.locator("[data-role='delete-run']").first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      await page.waitForTimeout(500);
      const finalCount = await page.locator("[data-run-id]").count();
      assert.ok(finalCount < initialCount, "run count should decrease after deletion");
    }
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("dashboard shows verdict hero and comparison bars after loading demo", {
  concurrency: false,
  timeout: 30000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;

  const root = path.resolve(import.meta.dirname, "..");
  const uiServer = await startUiServer(root);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${uiServer.port}`);

    await page.locator("#try-demo-btn").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-compare-agent-id]").length > 0, { timeout: 10000 });

    const summaryCard = page.locator("#summary-card");
    assert.ok(await summaryCard.isVisible(), "summary card should be visible after loading demo");
    assert.match(await summaryCard.innerText(), /通过|passed/i);

    const comparisonBars = page.locator("#comparison-bars");
    assert.ok(await comparisonBars.isVisible(), "comparison bars should be visible");

    const agentCount = page.locator("#agent-count");
    const countText = await agentCount.textContent();
    assert.ok(parseInt(countText, 10) > 0, "agent count should be greater than 0");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("export run as JSON file", {
  concurrency: false,
  timeout: 30000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;

  const root = path.resolve(import.meta.dirname, "..");
  const uiServer = await startUiServer(root);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${uiServer.port}`);

    await page.locator("#try-demo-btn").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-compare-agent-id]").length > 0, { timeout: 10000 });

    const exportBtn = page.locator("[data-role='export-run']").first();
    if (await exportBtn.isVisible()) {
      const downloadPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
      await exportBtn.click();
      const download = await downloadPromise;
      if (download) {
        assert.ok(download.suggestedFilename().endsWith(".json"), "exported file should be JSON");
      }
    }
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});
