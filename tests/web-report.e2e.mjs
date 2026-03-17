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
