import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";

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

    const onData = () => {
      if (stdout.includes("RepoArena UI server running")) {
        clearTimeout(timeout);
        resolve();
      }
    };

    child.stdout.on("data", onData);
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

test("web-report browser smoke renders launcher and supports zh/en switching", {
  skip: process.env.REPOARENA_RUN_BROWSER_SMOKE !== "1",
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
    const launcherVisible = await page.locator("#launcher-panel").isVisible();
    const repoPath = await page.locator("#launcher-repo-path").inputValue();
    const launcherRunZh = await page.locator("#launcher-run").textContent();
    const bodyZh = await page.locator("body").innerText();

    await page.selectOption("#language-select", "en");
    await page.waitForTimeout(400);
    const appTitleEn = await page.locator("#app-title").textContent();
    const launcherRunEn = await page.locator("#launcher-run").textContent();

    await page.selectOption("#language-select", "zh-CN");
    await page.waitForTimeout(400);
    const appTitleZhAgain = await page.locator("#app-title").textContent();

    assert.equal(appTitleZh, "交互报告");
    assert.equal(launcherVisible, true);
    assert.match(repoPath, /RepoArena/);
    assert.equal(launcherRunZh, "开始跑分");
    assert.equal(appTitleEn, "Web Report");
    assert.equal(launcherRunEn, "Start Benchmark");
    assert.equal(appTitleZhAgain, "交互报告");
    assert.doesNotMatch(bodyZh, /杩|鍏|鏃\?|鏈|宸插|銆\?|锛|榛樿|妯\"|缂栬緫/);
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

function createTestRun() {
  return {
    runId: "test-run-001",
    createdAt: "2026-03-14T00:00:00.000Z",
    task: { title: "Test Task", schema: "repo-health" },
    results: [
      {
        agentId: "agent-a", variantId: "agent-a", displayLabel: "Agent A",
        baseAgentId: "agent-a", agentTitle: "Agent A",
        status: "success", durationMs: 5000, tokenUsage: 1000,
        estimatedCostUsd: 0.05, costKnown: true,
        changedFiles: ["file1.js", "file2.js"],
        judgeResults: [
          { judgeId: "j1", label: "Judge 1", type: "file-check", success: true },
          { judgeId: "j2", label: "Judge 2", type: "file-check", success: false }
        ],
        summary: "Agent A summary",
        requestedConfig: {}, resolvedRuntime: null
      },
      {
        agentId: "agent-b", variantId: "agent-b", displayLabel: "Agent B",
        baseAgentId: "agent-b", agentTitle: "Agent B",
        status: "failed", durationMs: 8000, tokenUsage: 2000,
        estimatedCostUsd: 0.10, costKnown: true,
        changedFiles: [],
        judgeResults: [
          { judgeId: "j1", label: "Judge 1", type: "file-check", success: false }
        ],
        summary: "Agent B failed",
        requestedConfig: {}, resolvedRuntime: null
      }
    ]
  };
}

async function injectTestRun(page) {
  const runJson = JSON.stringify(createTestRun());
  await page.locator("#result-loader-panel").evaluate((el) => { el.open = true; });
  await page.locator("#summary-file").setInputFiles({
    name: "summary.json",
    mimeType: "application/json",
    buffer: Buffer.from(runJson)
  });
  await page.waitForTimeout(600);
}

test("mobile sidebar opens and closes via toggle and backdrop", {
  skip: process.env.REPOARENA_RUN_BROWSER_SMOKE !== "1",
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

    await page.click("#sidebar-toggle");
    await page.waitForTimeout(400);
    const sidebarOpenAfterToggle = await page.locator(".sidebar").evaluate((el) => el.classList.contains("sidebar-open"));
    assert.equal(sidebarOpenAfterToggle, true, "sidebar should open after toggle click");

    await page.click("#sidebar-backdrop");
    await page.waitForTimeout(400);
    const sidebarOpenAfterBackdrop = await page.locator(".sidebar").evaluate((el) => el.classList.contains("sidebar-open"));
    assert.equal(sidebarOpenAfterBackdrop, false, "sidebar should close after backdrop click");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("clicking a comparison bar row selects the agent", {
  skip: process.env.REPOARENA_RUN_BROWSER_SMOKE !== "1",
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

    await page.locator("[data-bar-agent-id='agent-a']").first().click();
    await page.waitForTimeout(300);

    const isActive = await page.locator("[data-bar-agent-id='agent-a']").first().evaluate(
      (el) => el.classList.contains("bar-row-active")
    );
    assert.equal(isActive, true, "clicked bar row should have active class");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});

test("double-clicking a compare table row toggles inline detail", {
  skip: process.env.REPOARENA_RUN_BROWSER_SMOKE !== "1",
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

    // First click selects the agent
    await page.locator("[data-compare-agent-id='agent-a']").click();
    await page.waitForTimeout(300);

    // Second click expands inline detail
    await page.locator("[data-compare-agent-id='agent-a']").click();
    await page.waitForTimeout(300);

    const detailVisible = await page.locator(".compare-detail-row").isVisible();
    assert.equal(detailVisible, true, "detail row should appear after second click");

    // Third click collapses
    await page.locator("[data-compare-agent-id='agent-a']").click();
    await page.waitForTimeout(300);

    const detailCount = await page.locator(".compare-detail-row").count();
    assert.equal(detailCount, 0, "detail row should disappear after third click");
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});
