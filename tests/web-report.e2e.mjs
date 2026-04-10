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
  skip: process.env.AGENTARENA_RUN_BROWSER_SMOKE !== "1",
  timeout: 120000
}, async () => {
  const { chromium } = await import("playwright");
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
    await page.waitForFunction(() => document.getElementById("app-title")?.textContent === "Web Report");
    const appTitleEn = await page.locator("#app-title").textContent();
    const launcherRunEn = await page.locator("#launcher-run").textContent();

    await page.selectOption("#language-select", "zh-CN");
    await page.waitForFunction(() => document.getElementById("app-title")?.textContent === "交互报告");
    const appTitleZhAgain = await page.locator("#app-title").textContent();

    assert.equal(appTitleZh, "交互报告");
    assert.equal(launcherRunZh?.trim(), "开始跑分");
    assert.equal(appTitleEn, "Web Report");
    assert.equal(launcherRunEn?.trim(), "Start Benchmark");
    assert.equal(appTitleZhAgain, "交互报告");
    assert.match(bodyZh, /发起 Benchmark/);
    assert.doesNotMatch(bodyZh, /\uFFFD/);
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("mobile sidebar opens and closes via toggle and backdrop", {
  skip: process.env.AGENTARENA_RUN_BROWSER_SMOKE !== "1",
  timeout: 120000
}, async () => {
  const { chromium } = await import("playwright");
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
  skip: process.env.AGENTARENA_RUN_BROWSER_SMOKE !== "1",
  timeout: 120000
}, async () => {
  const { chromium } = await import("playwright");
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
      const el = document.getElementById("error-message");
      return Boolean(el?.textContent && el.textContent.length > 0);
    });

    const notice = await page.locator("#error-message").textContent();
    assert.match(notice ?? "", /summary\.json|解析|parse/i);

    await page.locator("#error-back").click();
    await page.waitForFunction(() => document.getElementById("error-state")?.classList.contains("hidden"));

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

test("clicking a comparison bar row selects the agent", {
  skip: process.env.AGENTARENA_RUN_BROWSER_SMOKE !== "1",
  timeout: 120000
}, async () => {
  const { chromium } = await import("playwright");
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
  skip: process.env.AGENTARENA_RUN_BROWSER_SMOKE !== "1",
  timeout: 120000
}, async () => {
  const { chromium } = await import("playwright");
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
