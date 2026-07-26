import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { loadChromiumForSmoke as loadChromiumOrSkip } from "./browser-smoke-support.mjs";

async function port() { return await new Promise((resolve, reject) => { const server = http.createServer(); server.listen(0, "127.0.0.1", () => { const address = server.address(); const value = typeof address === "object" && address ? address.port : 0; server.close(() => resolve(value)); }); server.on("error", reject); }); }
async function startServer(cwd) {
  const selectedPort = await port();
  const child = spawn(process.execPath, [path.resolve(cwd, "packages/cli/dist/index.js"), "ui", "--host", "127.0.0.1", "--port", String(selectedPort), "--no-open"], { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BROWSER: "none" } });
  let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk.toString(); }); child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`server timeout\n${stdout}\n${stderr}`)), 15000); child.stdout.on("data", () => { if (stdout.includes("AgentArena UI server running")) { clearTimeout(timer); resolve(); } }); child.on("error", reject); child.on("exit", (code) => reject(new Error(`server exited ${code}\n${stdout}\n${stderr}`))); });
  return { selectedPort, stop: async () => { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); } };
}

function allFailedRun() {
  return { runId: "all-failed-ui", createdAt: "2026-07-15T00:00:00.000Z", repository: { path: "D:/repo", revision: "abc" }, task: { id: "task", title: "All failed fixture", schemaVersion: "agentarena.taskpack/v1" }, results: [
    { agentId: "a", variantId: "a", displayLabel: "Agent A", status: "failed", judgeResults: [], changedFiles: [], costKnown: false, summary: "A failed" },
    { agentId: "b", variantId: "b", displayLabel: "Agent B", status: "error", judgeResults: [], changedFiles: [], costKnown: false, summary: "B failed" }
  ] };
}

function collectErrors(page) { const errors = []; page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); }); page.on("pageerror", (error) => errors.push(String(error))); page.on("requestfailed", (request) => { if (new URL(request.url()).origin === new URL(page.url() || "http://127.0.0.1").origin) errors.push(`request failed: ${request.url()}`); }); return errors; }

test("workbench demo, evidence and language flow has no browser errors", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errors = collectErrors(page);
  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "实验运行中心" }).waitFor();
    await page.getByRole("button", { name: /安全 Demo/ }).first().click();
    await page.getByRole("heading", { name: "Improve repository health" }).waitFor();
    await assert.doesNotReject(() => page.getByText("Demo Thorough").first().waitFor());
    await page.getByRole("button", { name: /证据/ }).first().click();
    await page.getByRole("heading", { name: "Demo Thorough" }).waitFor();
    await page.getByLabel("选择 Agent").selectOption("demo-budget");
    await page.getByText("No accepted file changes were produced.").waitFor();
    await page.getByRole("button", { name: /设置/ }).first().click();
    await page.getByText("简体中文").waitFor();
    await page.getByText("English", { exact: true }).click();
    await page.getByRole("heading", { name: "Settings" }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench all-failed import shows no qualified winner", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); const errors = collectErrors(page);
  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="file"]').setInputFiles({ name: "all-failed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(allFailedRun())) });
    await page.getByText("没有合格冠军").waitFor();
    await page.getByText("没有结果满足通过门槛").waitFor();
    assert.equal(await page.getByText("本次合格最佳").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench mobile layout keeps primary navigation usable", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); const errors = collectErrors(page);
  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "实验运行中心" }).waitFor();
    await page.getByRole("button", { name: /新建评测/ }).first().click();
    await page.getByRole("heading", { name: "创建一次可信评测" }).waitFor();
    await page.getByRole("button", { name: /运行/ }).last().click();
    await page.getByRole("heading", { name: "实验运行中心" }).waitFor();
    await page.getByRole("button", { name: /设置/ }).last().click();
    await page.getByRole("heading", { name: "设置" }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench outcome localizes trust reasons and execution status", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errors = collectErrors(page);
  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /安全 Demo/ }).first().click();
    await page.getByRole("heading", { name: "Improve repository health" }).waitFor();
    await page.getByText("已完成").first().waitFor();
    await page.getByText("结果使用兼容旧产物格式").waitFor();
    await page.getByText("部分费用为估算").waitFor();
    assert.equal(await page.getByText("legacy-artifact").count(), 0);
    assert.equal(await page.getByText("cost-estimated", { exact: true }).count(), 0);
    assert.equal(await page.locator("th", { hasText: "分数" }).count() > 0, true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench plan context bar shows draft identity", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errors = collectErrors(page);
  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/#/plan`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "创建一次可信评测" }).waitFor();
    await page.waitForFunction(() => {
      const text = document.querySelector(".context-bar")?.textContent ?? "";
      return text.includes("草稿") && !text.includes("尚未选择");
    }, { timeout: 15000 });
    const context = await page.locator(".context-bar").innerText();
    assert.match(context, /草稿/);
    assert.ok(!context.includes("尚未选择"));
    await page.getByRole("button", { name: /启动评测/ }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});
