import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { loadChromiumForSmoke as loadChromiumOrSkip } from "./browser-smoke-support.mjs";

async function port() { return await new Promise((resolve, reject) => { const server = http.createServer(); server.listen(0, "127.0.0.1", () => { const address = server.address(); const value = typeof address === "object" && address ? address.port : 0; server.close(() => resolve(value)); }); server.on("error", reject); }); }
async function startServer(cwd) {
  const selectedPort = await port();
  const authToken = `workbench-e2e-${selectedPort}-${Date.now()}`;
  const child = spawn(process.execPath, [path.resolve(cwd, "packages/cli/dist/index.js"), "ui", "--host", "127.0.0.1", "--port", String(selectedPort), "--no-open", "--auth-token", authToken], { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BROWSER: "none" } });
  let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk.toString(); }); child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`server timeout\n${stdout}\n${stderr}`)), 15000); child.stdout.on("data", () => { if (stdout.includes("AgentArena UI server running")) { clearTimeout(timer); resolve(); } }); child.on("error", reject); child.on("exit", (code) => reject(new Error(`server exited ${code}\n${stdout}\n${stderr}`))); });
  return { selectedPort, authToken, stop: async () => { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); } };
}

async function newAuthenticatedPage(browser, server, options) {
  const page = await browser.newPage(options);
  await page.addInitScript((token) => sessionStorage.setItem("agentarena-auth-token", token), server.authToken);
  return page;
}

function allFailedRun() {
  return { runId: "all-failed-ui", createdAt: "2026-07-15T00:00:00.000Z", repository: { path: "D:/repo", revision: "abc" }, task: { id: "task", title: "All failed fixture", schemaVersion: "agentarena.taskpack/v1" }, results: [
    { agentId: "a", variantId: "a", displayLabel: "Agent A", status: "failed", judgeResults: [], changedFiles: [], costKnown: false, summary: "A failed" },
    { agentId: "b", variantId: "b", displayLabel: "Agent B", status: "error", judgeResults: [], changedFiles: [], costKnown: false, summary: "B failed" }
  ] };
}

function qualifiedSummaryOnlyRun() {
  const fixture = strictCompareRun("qualified-summary-only", "2026-08-22T00:00:00.000Z");
  fixture.results = [fixture.results[0]];
  fixture.jobManifest.variants = [fixture.jobManifest.variants[0]];
  return fixture;
}

function strictCompareVariant(agentKind) {
  const codex = agentKind === "codex";
  return {
    order: codex ? 0 : 1,
    variantId: codex ? "codex-strict" : "claude-strict",
    agentKind,
    profileId: codex ? "codex-strict-profile" : "claude-strict-profile",
    profileRevision: 1,
    secretRevision: 1,
    launchSpecHash: `launch:${agentKind}`,
    verificationReceiptId: `receipt:${agentKind}`,
    installationFingerprint: `installation:${agentKind}`,
    installationVersion: "1.0.0",
    harnessSnapshotId: `harness:${agentKind}`,
    providerKind: codex ? "openai-responses" : "anthropic-messages",
    requestedModel: codex ? "shared-codex-alias" : "shared-claude-alias",
    canonicalModelIdentity: "provider/shared-model-v1",
    modelIdentitySource: "declared",
    reasoningEffort: "high",
    providerPolicyIdentity: "provider-policy:shared",
    modelParametersIdentity: "model-parameters:shared",
    permissionMode: codex ? "workspace-write" : "dontAsk",
    fullPermissionBypass: false,
    riskFlags: [],
    harnessDrift: {
      status: "unchanged",
      checkedAt: RUNTIME_FIXTURE_NOW,
      postRunSnapshotId: `harness:${agentKind}`,
      summary: "Harness inputs remained unchanged."
    }
  };
}

function strictCompareRun(runId, createdAt, options = {}) {
  const taskIdentity = options.taskIdentity ?? "task:strict-shared";
  const codexScore = options.codexScore ?? 92;
  const claudeScore = options.claudeScore ?? 84;
  const variants = [strictCompareVariant("codex"), strictCompareVariant("claude-code")];
  return {
    artifactSchemaVersion: "agentarena.summary/v1",
    runId,
    createdAt,
    repository: { path: "D:/strict-compare-repo", revision: "baseline-abc" },
    task: { id: "strict-task", title: "Strict same-model task", schemaVersion: "agentarena.taskpack/v1" },
    scoreMode: "practical",
    fairComparison: {
      taskIdentity,
      judgeIdentity: "judge:strict-shared",
      repoBaselineIdentity: "repo:strict-shared"
    },
    jobManifest: {
      schemaVersion: "agentarena.job-manifest/v1",
      runId,
      status: "completed",
      createdAt,
      updatedAt: createdAt,
      startedAt: createdAt,
      finishedAt: createdAt,
      repositoryBaselineIdentity: "repo:strict-shared",
      taskIdentity,
      judgeIdentity: "judge:strict-shared",
      scoreMode: "practical",
      variants
    },
    results: variants.map((variant) => {
      const codex = variant.agentKind === "codex";
      return {
        agentId: variant.agentKind,
        baseAgentId: variant.agentKind,
        variantId: variant.variantId,
        displayLabel: codex ? "Codex Strict Profile" : "Claude Strict Profile",
        status: "success",
        durationMs: codex ? 1200 : 1500,
        tokenUsage: codex ? 100 : 120,
        estimatedCostUsd: codex ? 0.02 : 0.025,
        costKnown: true,
        costQuality: "known",
        compositeScore: codex ? codexScore : claudeScore,
        scoreExcluded: false,
        changedFiles: ["src/fix.ts"],
        judgeResults: [{ judgeId: "tests", label: "Tests", type: "test-result", success: true }],
        tracePath: `agents/${variant.variantId}/trace.jsonl`,
        summary: "Completed strict comparison fixture."
      };
    })
  };
}

function collectErrors(page) { const errors = []; page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); }); page.on("pageerror", (error) => errors.push(String(error))); page.on("requestfailed", (request) => { if (new URL(request.url()).origin === new URL(page.url() || "http://127.0.0.1").origin) errors.push(`request failed: ${request.url()}`); }); return errors; }

const RUNTIME_FIXTURE_NOW = "2026-08-12T00:00:00.000Z";

function runtimeProfileFixture({ id, name, agentKind, mode = "inherit-local", provider, secretStored = false, isBuiltIn = false }) {
  return {
    id,
    name,
    agentKind,
    mode,
    revision: 1,
    secretRevision: 1,
    provider,
    extraEnvKeys: [],
    riskFlags: mode === "managed-provider" ? ["third-party-provider", "user-managed-secret"] : [],
    createdAt: RUNTIME_FIXTURE_NOW,
    updatedAt: RUNTIME_FIXTURE_NOW,
    secretStored,
    isBuiltIn
  };
}

function runtimeProjectionFixture(profile, readiness = "installed") {
  const passed = readiness === "task-ready";
  const stages = [
    { stage: "installation", status: "passed", startedAt: RUNTIME_FIXTURE_NOW, durationMs: 12, summary: "CLI 1.0.0 detected" },
    { stage: "conversation", status: passed ? "passed" : "skipped", startedAt: RUNTIME_FIXTURE_NOW, durationMs: passed ? 30 : 0, summary: passed ? "Sentinel returned" : "Not verified" },
    { stage: "task", status: passed ? "passed" : "skipped", startedAt: RUNTIME_FIXTURE_NOW, durationMs: passed ? 45 : 0, summary: passed ? "Expected repository diff matched" : "Not verified" }
  ];
  return {
    profile,
    readiness,
    receiptMatch: passed,
    installation: {
      id: `${profile.id}-installation`,
      executable: profile.agentKind === "codex" ? "codex" : "claude",
      version: "1.0.0",
      fingerprint: `${profile.id}-fingerprint`
    },
    harness: {
      snapshotId: `${profile.id}-harness`,
      repositoryBaselineIdentity: "repo:workbench-runtime-e2e",
      riskFlags: [],
      entries: []
    },
    launchSpec: {
      launchSpecHash: `${profile.id}-launch-spec`,
      runtime: {
        requestedModel: profile.provider?.requestedModel,
        canonicalModelIdentity: profile.provider?.canonicalModelIdentity,
        modelIdentitySource: profile.provider?.canonicalModelIdentity ? "declared" : "unknown"
      }
    },
    ...(passed ? {
      receipt: {
        receiptId: `${profile.id}-receipt`,
        createdAt: RUNTIME_FIXTURE_NOW,
        readiness,
        stages
      }
    } : {}),
    stages
  };
}

function runtimeProfilesResponse(profiles, readinessById = new Map()) {
  return {
    profiles,
    repository: {
      requestedPath: "builtin://nodejs-app",
      resolvedPath: "D:/fixtures/nodejs-app",
      baselineIdentity: "repo:workbench-runtime-e2e",
      kind: "builtin"
    },
    readiness: profiles.map((profile) => runtimeProjectionFixture(profile, readinessById.get(profile.id) ?? "installed"))
  };
}

async function assertStageNoticeLayout(page) {
  const layout = await page.evaluate(() => {
    const nav = document.querySelector(".stage-nav")?.getBoundingClientRect();
    const active = document.querySelector(".stage-nav button.active")?.getBoundingClientRect();
    const notice = document.querySelector(".global-notice")?.getBoundingClientRect();
    const targets = [...document.querySelectorAll(".stage-nav button")].map((button) => button.getBoundingClientRect().height);
    return nav && active && notice ? {
      nav: { left: nav.left, right: nav.right, bottom: nav.bottom },
      active: { left: active.left, right: active.right },
      notice: { top: notice.top },
      minTargetHeight: Math.min(...targets)
    } : null;
  });
  assert.ok(layout, "stage navigation and notice should both be rendered");
  assert.ok(layout.active.left >= layout.nav.left - 1, "active stage should not be clipped on the left");
  assert.ok(layout.active.right <= layout.nav.right + 1, "active stage should not be clipped on the right");
  assert.ok(layout.notice.top >= layout.nav.bottom, "notice should not overlap the stage navigation");
  assert.ok(layout.minTargetHeight >= 44, "stage navigation targets should remain at least 44px high");
}

async function assertMobileContentClearOfNavigation(page) {
  await page.locator(".workspace").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(50);
  const layout = await page.evaluate(() => {
    const workspace = document.querySelector(".workspace");
    const navigation = document.querySelector(".mobile-nav");
    const main = document.querySelector("main.page-content");
    const lastContent = main?.lastElementChild;
    if (!(workspace instanceof HTMLElement) || !navigation || !main || !lastContent) return null;
    const workspaceRect = workspace.getBoundingClientRect();
    const navigationRect = navigation.getBoundingClientRect();
    const lastContentRect = lastContent.getBoundingClientRect();
    return {
      workspaceBottom: workspaceRect.bottom,
      navigationTop: navigationRect.top,
      lastContentBottom: lastContentRect.bottom,
      horizontalOverflow: workspace.scrollWidth - workspace.clientWidth,
      bodyOverflow: document.documentElement.scrollHeight - window.innerHeight
    };
  });
  assert.ok(layout, "mobile workspace, content, and navigation should be rendered");
  assert.ok(layout.workspaceBottom <= layout.navigationTop + 1, `the mobile scroll viewport must end before the fixed navigation: ${JSON.stringify(layout)}`);
  assert.ok(layout.lastContentBottom <= layout.workspaceBottom + 1, `the final content must scroll fully above the navigation: ${JSON.stringify(layout)}`);
  assert.ok(layout.horizontalOverflow <= 1, `the mobile workspace must not overflow horizontally: ${JSON.stringify(layout)}`);
  assert.ok(layout.bodyOverflow <= 1, `mobile scrolling must stay inside the workspace viewport: ${JSON.stringify(layout)}`);
}

test("workbench empty state starts the packaged demo through the real run API", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await newAuthenticatedPage(browser, server, { viewport: { width: 1440, height: 900 } }); const errors = collectErrors(page);
  let demoPayload = null;
  await page.route("**/api/run", async (route) => {
    demoPayload = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: true }) });
  });
  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "实验运行中心" }).waitFor();
    const header = page.locator(".page-header");
    await header.getByRole("button", { name: /安全 Demo/ }).waitFor();
    await header.getByRole("button", { name: /导入结果/ }).waitFor();
    await header.getByRole("button", { name: /新建评测/ }).waitFor();
    await header.getByRole("button", { name: /安全 Demo/ }).click();
    await page.getByRole("heading", { name: "评测正在运行" }).waitFor();
    assert.match(demoPayload.taskPath, /taskpacks[\\/]demo[\\/]demo-ui-tour\.yaml$/);
    assert.deepEqual(demoPayload.agents, ["demo-fast", "demo-thorough"]);
    assert.equal(demoPayload.entryPoint, "workbench-plan");
    assert.match(demoPayload.repoPath, /AgentArena$/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench treats imported summary JSON as summary-only evidence", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await newAuthenticatedPage(browser, server, { viewport: { width: 1280, height: 800 } }); const errors = collectErrors(page);
  let traceRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/trace") traceRequests += 1;
  });
  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="file"]').setInputFiles({
      name: "qualified-summary.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(qualifiedSummaryOnlyRun()))
    });
    await page.getByRole("heading", { name: "Strict same-model task" }).waitFor();
    await page.getByText("当前没有能力赢家").waitFor();
    assert.equal(await page.locator(".winner-card").count(), 0);
    await page.getByRole("button", { name: /证据/ }).first().click();
    await page.getByText(/导入的 summary\.json 只包含摘要/).waitFor();
    await page.waitForTimeout(100);
    assert.equal(traceRequests, 0, "summary-only imports must not request unavailable trace files");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench all-failed import shows no qualified winner", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await newAuthenticatedPage(browser, server, { viewport: { width: 1280, height: 800 } }); const errors = collectErrors(page);
  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="file"]').setInputFiles({ name: "all-failed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(allFailedRun())) });
    await page.getByText("没有合格冠军").waitFor();
    await page.getByText("没有结果同时满足执行和验证门槛。").waitFor();
    assert.equal(await page.getByText("本次合格最佳").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench renders a direct strict Harness winner and excludes mismatched samples", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await newAuthenticatedPage(browser, server, { viewport: { width: 1440, height: 1000 } }); const errors = collectErrors(page);
  const runs = [
    strictCompareRun("strict-run-001", "2026-08-10T00:00:00.000Z"),
    strictCompareRun("strict-run-002", "2026-08-11T00:00:00.000Z", { codexScore: 90, claudeScore: 82 }),
    strictCompareRun("strict-run-other-task", "2026-08-12T00:00:00.000Z", { taskIdentity: "task:other" })
  ];

  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "实验运行中心" }).waitFor();
    await page.locator('input[type="file"]').setInputFiles({
      name: "strict-harness-runs.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ runs }))
    });
    await page.getByRole("heading", { name: "Strict same-model task" }).waitFor();
    await page.getByRole("button", { name: /^比较$/ }).first().click();
    await page.getByRole("heading", { name: "同模型 Harness 对比" }).waitFor();
    await page.getByRole("heading", { name: "按声明的模型映射，Codex CLI 在 2 次有效样本中胜出更多" }).waitFor();
    await page.getByText(/2 次胜出，方向一致/).waitFor();
    await page.getByRole("heading", { name: "Harness 结果" }).waitFor();
    await page.getByRole("heading", { name: "逐次样本" }).waitFor();
    const sampleTable = page.locator(".strict-sample-table");
    await sampleTable.getByText("strict-run-001", { exact: true }).waitFor();
    await sampleTable.getByText("strict-run-002", { exact: true }).waitFor();
    const excluded = page.locator(".comparison-exclusion-row", { hasText: "strict-run-other-task" });
    await excluded.getByText("任务不同", { exact: true }).waitFor();
    assert.equal(await page.locator("canvas").count(), 0, "strict comparison should remain text and tables only");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench mobile layout keeps primary navigation usable", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await newAuthenticatedPage(browser, server, { viewport: { width: 390, height: 844 } }); const errors = collectErrors(page);
  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "实验运行中心" }).waitFor();
    await page.getByRole("button", { name: /新建评测/ }).first().click();
    await page.getByRole("heading", { name: "创建一次可信评测" }).waitFor();
    await assertMobileContentClearOfNavigation(page);
    await page.getByRole("button", { name: /^环境$/ }).last().click();
    await page.getByRole("heading", { name: "运行环境" }).waitFor();
    await assertMobileContentClearOfNavigation(page);
    await page.getByRole("button", { name: /运行/ }).last().click();
    await page.getByRole("heading", { name: "实验运行中心" }).waitFor();
    await page.getByRole("button", { name: /设置/ }).last().click();
    await page.getByRole("heading", { name: "设置" }).waitFor();
    await page.getByRole("button", { name: /运行/ }).last().click();
    await page.route("**/api/run", async (route) => {
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: true }) });
    });
    await page.getByRole("button", { name: /安全 Demo/ }).first().click();
    await page.getByRole("heading", { name: "评测正在运行" }).waitFor();
    await assertStageNoticeLayout(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(100);
    await assertStageNoticeLayout(page);
    await page.getByRole("button", { name: /设置/ }).last().click();
    await page.getByText("English", { exact: true }).click();
    await page.locator(".stage-nav").getByRole("button", { name: /Live/ }).click();
    await page.getByText("Safe demo accepted and starting.").waitFor();
    await assertStageNoticeLayout(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench derives adapter readiness and exports redacted pilot diagnostics", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true });
  const page = await newAuthenticatedPage(browser, server, { viewport: { width: 390, height: 844 } });
  await page.route("**/api/adapters", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { id: "demo-fast", title: "Demo Fast", kind: "demo", capability: { supportTier: "supported" } },
      { id: "codex", title: "Codex CLI", kind: "external", capability: { supportTier: "supported" } },
      { id: "claude-code", title: "Claude Code", kind: "external", capability: { supportTier: "experimental" } }
    ]) });
  });
  await page.route("**/api/agent-detection", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { id: "codex", displayName: "Codex CLI", installed: true, version: "0.145.0", configExists: true, configFilesFound: [], configFilesMissing: [] },
      { id: "claude-code", displayName: "Claude Code", installed: true, version: "2.1.233", configExists: true, configFilesFound: [], configFilesMissing: [], status: "unverified", detail: "Authentication was not probed" }
    ]) });
  });
  await page.route("**/api/runtime-profiles**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profiles: [], readiness: [] }) });
  });

  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/#/library?lang=en`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Evaluation library" }).waitFor();
    const harnessSection = page.locator(".section", { hasText: "Harnesses" }).first();
    await harnessSection.getByText("Installed", { exact: true }).waitFor();
    await harnessSection.getByText("Unverified", { exact: true }).waitFor();
    assert.equal(await harnessSection.getByText("Ready", { exact: true }).count(), 0, "unverified Claude must not render as Ready");

    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/#/settings?lang=en`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Settings" }).waitFor();
    const preview = await page.locator(".diagnostics-preview").innerText();
    assert.match(preview, /agentarena\.pilot-diagnostics\/v1/);
    assert.doesNotMatch(preview, /[A-Za-z]:\\/);
    assert.doesNotMatch(preview, /secret|api[_ -]?key|prompt/i);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download JSON" }).click()
    ]);
    assert.equal(download.suggestedFilename(), "agentarena-pilot-diagnostics.json");
    await assertMobileContentClearOfNavigation(page);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench outcome localizes trust reasons and execution status", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await newAuthenticatedPage(browser, server, { viewport: { width: 1440, height: 900 } }); const errors = collectErrors(page);
  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/`, { waitUntil: "domcontentloaded" });
    const fixture = strictCompareRun("legacy-estimated", "2026-08-22T00:00:00.000Z");
    delete fixture.artifactSchemaVersion;
    for (const result of fixture.results) {
      result.costKnown = false;
      result.costQuality = "estimated";
    }
    await page.locator('input[type="file"]').setInputFiles({ name: "legacy-estimated.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
    await page.getByRole("heading", { name: "Strict same-model task" }).waitFor();
    await page.getByText("已完成").first().waitFor();
    await page.getByText("结果使用兼容旧产物格式").waitFor();
    await page.getByText("部分费用为估算").waitFor();
    assert.equal(await page.getByText("legacy-artifact").count(), 0);
    assert.equal(await page.getByText("cost-estimated", { exact: true }).count(), 0);
    assert.equal(await page.locator("th", { hasText: "Token" }).count() > 0, true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench plan context bar shows draft identity", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await newAuthenticatedPage(browser, server, { viewport: { width: 1440, height: 900 } }); const errors = collectErrors(page);
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
    await page.locator(".task-context-repository").getByText("builtin://nodejs-core", { exact: true }).waitFor();
    assert.match(await page.locator("select").filter({ has: page.locator('option[value*="repo-health"]') }).innerText(), /内置测试仓库/);
    await page.getByRole("button", { name: /启动评测|运行单 Agent 评测/ }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench creates a Safe Demo custom task, explains basic evidence, and starts demo-fast", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve(".");
  const safeDemoRepo = path.resolve(cwd, "examples/taskpacks/repos/nodejs-core");
  const adhocTaskPath = path.resolve(cwd, ".agentarena/adhoc-taskpacks/adhoc-safe-demo-e2e.yaml");
  const server = await startServer(cwd);
  const browser = await chromium.launch({ headless: true });
  const page = await newAuthenticatedPage(browser, server, { viewport: { width: 1440, height: 1000 } });
  const errors = collectErrors(page);
  const profile = runtimeProfileFixture({ id: "demo-fast", name: "Safe Demo Fast", agentKind: "codex", isBuiltIn: true });
  const readinessById = new Map([[profile.id, "task-ready"]]);
  const preview = {
    id: "adhoc-safe-demo-e2e",
    title: "Safe Demo custom task",
    prompt: "Add a small, well-tested improvement to the Safe Demo repository.",
    repoPath: safeDemoRepo,
    repoType: "nodejs",
    source: "adhoc",
    lifecycle: "ready",
    expectedChangedPaths: [],
    generatedChecks: [
      { kind: "generic", label: "Repository health", strength: "basic" },
      { kind: "build", label: "Build", command: "package script if present", strength: "basic" },
      { kind: "test", label: "Tests", command: "repository tests if present", strength: "basic" },
      { kind: "lint", label: "Lint", command: "repository lint if present", strength: "basic" }
    ],
    warnings: ["No expected changed paths were declared.", "Generated checks provide basic evidence."],
    warningCodes: ["missing-expected-paths", "basic-generated-checks"],
    compatibility: { status: "compatible", reasons: [] },
    evidenceStrength: "basic"
  };
  const summary = {
    id: preview.id,
    title: preview.title,
    path: adhocTaskPath,
    createdAt: RUNTIME_FIXTURE_NOW,
    promptPreview: preview.prompt,
    repoPath: safeDemoRepo,
    source: "adhoc",
    lifecycle: "experimental",
    repoSource: "user",
    expectedChangedPaths: [],
    evidenceStrength: "basic",
    warningCodes: preview.warningCodes,
    compatibility: { status: "compatible", reasons: [] }
  };
  let adhocPayload;
  let runPayload;
  let adhocSummaries = [];
  let status = { state: "idle", phase: "idle", logs: [], updatedAt: RUNTIME_FIXTURE_NOW };

  await page.route("**/api/adhoc-taskpacks*", async (route) => {
    if (route.request().method() !== "GET") { await route.continue(); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(adhocSummaries) });
  });
  await page.route("**/api/create-adhoc-taskpack", async (route) => {
    adhocPayload = route.request().postDataJSON();
    adhocSummaries = [summary];
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ path: adhocTaskPath, id: preview.id, title: preview.title, preview }) });
  });
  await page.route("**/api/runtime-profiles*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(runtimeProfilesResponse([profile], readinessById)) });
  });
  await page.route("**/api/run-status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(status) });
  });
  await page.route("**/api/run-stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
      body: `event: snapshot\ndata: ${JSON.stringify(status)}\n\n`
    });
  });
  await page.route("**/api/run", async (route) => {
    runPayload = route.request().postDataJSON();
    status = {
      state: "running",
      phase: "starting",
      runId: "adhoc-safe-demo-e2e-run",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      repoPath: runPayload.repoPath,
      taskPath: runPayload.taskPath,
      logs: []
    };
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: true }) });
  });
  await page.route("**/api/telemetry", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.continue();
  });

  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/#/plan`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "创建一次可信评测" }).waitFor();
    await page.getByRole("button", { name: "创建自定义任务" }).click();
    const wizard = page.getByTestId("adhoc-task-wizard");
    await wizard.waitFor();
    await page.getByTestId("adhoc-prompt").fill(preview.prompt);
    await page.getByTestId("adhoc-title").fill(preview.title);
    await page.getByTestId("adhoc-repo").fill(safeDemoRepo);
    await page.getByTestId("adhoc-submit").click();
    await page.getByTestId("adhoc-preview").waitFor();

    assert.equal(adhocPayload?.repoPath, safeDemoRepo);
    assert.equal("expectedChangedPaths" in (adhocPayload ?? {}), false);
    assert.equal("commands" in (adhocPayload ?? {}), false, "the wizard must not accept arbitrary shell commands");
    await page.getByTestId("adhoc-preview").getByText("基础证据", { exact: true }).waitFor();
    await page.getByTestId("adhoc-preview").locator(".adhoc-preview-warning-text").waitFor();
    await page.getByTestId("adhoc-preview").getByText("兼容", { exact: true }).waitFor();
    await page.getByTestId("adhoc-use-task").click();

    await page.locator(".task-context-evidence").getByText("基础证据", { exact: true }).waitFor();
    assert.equal(await page.locator(".plan-target-section select").inputValue(), adhocTaskPath);
    const profileOption = page.locator("label.agent-option", { hasText: profile.name });
    await profileOption.waitFor();
    await profileOption.click();
    const startButton = page.getByRole("button", { name: "运行单 Agent 评测" });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("运行单 Agent 评测"));
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    const [runResponse] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/run" && response.request().method() === "POST"),
      startButton.click()
    ]);
    assert.equal(runResponse.status(), 202);
    assert.equal(runPayload?.repoPath, safeDemoRepo);
    assert.equal(runPayload?.taskPath, adhocTaskPath);
    assert.equal(runPayload?.agents?.[0]?.baseAgentId, "codex");
    assert.equal(runPayload?.agents?.[0]?.runtimeProfileId, profile.id);
    await page.getByRole("heading", { name: "评测正在运行" }).waitFor();
    assert.deepEqual(errors.filter((error) => !error.includes("/api/run-stream")), []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench restores a background runtime-profile run after refresh and supports explicit cancellation", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await newAuthenticatedPage(browser, server, { viewport: { width: 1440, height: 900 } }); const errors = collectErrors(page);
  const profile = runtimeProfileFixture({
    id: "codex-background-e2e",
    name: "Codex Background E2E",
    agentKind: "codex",
    mode: "managed-provider",
    provider: {
      baseUrl: "https://provider.example.test/v1",
      protocol: "openai-responses",
      requestedModel: "gpt-background-e2e",
      canonicalModelIdentity: "provider/gpt-background-e2e",
      modelIdentitySource: "declared"
    },
    secretStored: true
  });
  const readinessById = new Map([[profile.id, "task-ready"]]);
  let runStarts = 0;
  let cancelCalls = 0;
  let lastRunPayload;
  let status = { state: "idle", phase: "idle", logs: [], updatedAt: RUNTIME_FIXTURE_NOW };

  await page.route("**/api/runtime-profiles**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(runtimeProfilesResponse([profile], readinessById)) });
  });
  await page.route("**/api/run-status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(status) });
  });
  await page.route("**/api/run-stream", (route) => route.abort());
  await page.route("**/api/run/cancel", async (route) => {
    cancelCalls++;
    status = {
      ...status,
      state: "cancelled",
      phase: "idle",
      updatedAt: new Date().toISOString(),
      logs: [...status.logs, { timestamp: new Date().toISOString(), phase: "idle", message: "Run cancelled by explicit request." }]
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cancelled: true }) });
  });
  await page.route("**/api/run", async (route) => {
    runStarts++;
    const payload = route.request().postDataJSON();
    lastRunPayload = payload;
    const timestamp = new Date().toISOString();
    status = {
      state: "running",
      phase: "benchmark",
      runId: `background-e2e-${runStarts}`,
      startedAt: timestamp,
      updatedAt: timestamp,
      repoPath: payload.repoPath,
      taskPath: payload.taskPath,
      currentAgentId: "codex",
      currentVariantId: `codex-${profile.id}`,
      currentDisplayLabel: profile.name,
      logs: [{ timestamp, phase: "benchmark", message: "Background run is active.", agentId: "codex" }]
    };
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: true }) });
  });

  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/#/plan`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "创建一次可信评测" }).waitFor();
    await page.locator(".task-context-repository").getByText("builtin://nodejs-core", { exact: true }).waitFor();
    const profileOption = page.locator("label.agent-option", { hasText: profile.name });
    await profileOption.waitFor();
    await profileOption.click();
    const start = page.getByRole("button", { name: /启动评测|运行单 Agent 评测/ });
    await assert.doesNotReject(() => start.waitFor());
    assert.equal(await start.isDisabled(), false);
    const [startResponse] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/run" && response.request().method() === "POST"),
      start.click()
    ]);
    assert.equal(startResponse.status(), 202);
    assert.equal(lastRunPayload?.agents?.[0]?.runtimeProfileId, profile.id);
    assert.equal(lastRunPayload?.agents?.[0]?.launchSpecHash, `${profile.id}-launch-spec`);
    assert.equal(lastRunPayload?.agents?.[0]?.verificationReceiptId, `${profile.id}-receipt`);
    await page.waitForTimeout(500);
    const startDiagnostic = {
      url: page.url(),
      headings: await page.locator("h1, h2").allTextContents(),
      body: (await page.locator("body").innerText()).slice(0, 1200)
    };
    assert.match(startDiagnostic.url, /#\/live(?:$|\?)/, JSON.stringify(startDiagnostic));
    assert.match(startDiagnostic.body, /评测正在运行/, JSON.stringify(startDiagnostic));
    await page.getByRole("heading", { name: "评测正在运行" }).waitFor();
    assert.equal(await page.getByText("当前没有活动运行").count(), 0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "评测正在运行" }).waitFor();
    assert.equal(cancelCalls, 0, "refreshing the browser must not cancel the background run");
    const finishedAt = new Date().toISOString();
    status = {
      ...status,
      state: "done",
      phase: "done",
      updatedAt: finishedAt,
      currentAgentId: undefined,
      currentVariantId: undefined,
      currentDisplayLabel: undefined,
      result: { run: { ...allFailedRun(), runId: "background-e2e-complete", createdAt: finishedAt } }
    };
    await page.getByRole("heading", { name: "运行已结束" }).waitFor({ timeout: 90000 });
    await page.getByRole("button", { name: "查看结论" }).waitFor();
    assert.equal(await page.getByText("评测已接收，正在启动。").count(), 0);
    assert.equal(await page.locator(".agent-track.current").count(), 0);
    await page.locator(".stage-nav").getByRole("button", { name: /计划/ }).click();
    await page.getByRole("heading", { name: "创建一次可信评测" }).waitFor();
    const restart = page.getByRole("button", { name: /启动评测|运行单 Agent 评测/ });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("启动评测") || item.textContent?.includes("运行单 Agent 评测"));
      return button instanceof HTMLButtonElement && !button.disabled;
    }, { timeout: 15000 });
    await restart.click();
    await page.getByRole("heading", { name: "评测正在运行" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "查看结论" }).count(), 0);
    await page.getByRole("button", { name: "取消运行" }).click();
    await page.getByText("取消请求已发送。").waitFor();
    await page.getByRole("heading", { name: "运行已结束" }).waitFor({ timeout: 30000 });
    assert.equal(runStarts, 2);
    assert.equal(cancelCalls, 1);
    assert.deepEqual(errors.filter((error) => !error.includes("/api/run-stream")), []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench keeps launch unavailable while status is loading or offline", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true });
  const loadingPage = await newAuthenticatedPage(browser, server, { viewport: { width: 1280, height: 800 } });
  let releaseStatus;
  await loadingPage.route("**/api/run-status", async (route) => {
    await new Promise((resolve) => { releaseStatus = resolve; });
    await route.continue();
  });
  try {
    await loadingPage.goto(`http://127.0.0.1:${server.selectedPort}/workbench/#/plan`, { waitUntil: "domcontentloaded" });
    await loadingPage.getByRole("heading", { name: "创建一次可信评测" }).waitFor();
    await loadingPage.getByText("正在检查本地服务").waitFor();
    assert.equal(await loadingPage.getByRole("button", { name: /启动评测|运行单 Agent 评测/ }).isDisabled(), true);
    releaseStatus();
    const serviceReadiness = loadingPage.locator(".readiness-item", { hasText: "本地服务" });
    await serviceReadiness.getByText("可启动", { exact: true }).waitFor();
    assert.equal(await loadingPage.getByRole("button", { name: /启动评测|运行单 Agent 评测/ }).isDisabled(), true, "an online service is not enough without a Task-ready profile");

    const offlinePage = await newAuthenticatedPage(browser, server, { viewport: { width: 1280, height: 800 } });
    await offlinePage.route("**/api/**", (route) => route.abort());
    await offlinePage.goto(`http://127.0.0.1:${server.selectedPort}/workbench/#/plan`, { waitUntil: "domcontentloaded" });
    await offlinePage.getByText("本地服务不可用").first().waitFor();
    await offlinePage.getByText("无法确认", { exact: true }).waitFor();
    assert.equal(await offlinePage.getByRole("button", { name: /启动评测|运行单 Agent 评测/ }).isDisabled(), true);
    await offlinePage.close();
  } finally { releaseStatus?.(); await loadingPage.close(); await browser.close(); await server.stop(); }
});

test("workbench saves task-scoped runtime profiles and verifies only on explicit action", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await newAuthenticatedPage(browser, server, { viewport: { width: 1440, height: 1000 } }); const errors = collectErrors(page);
  const secret = "workbench-runtime-secret-value";
  const profiles = [
    runtimeProfileFixture({ id: "codex-local", name: "Current local Codex setup", agentKind: "codex", isBuiltIn: true }),
    runtimeProfileFixture({ id: "claude-local", name: "Current local Claude setup", agentKind: "claude-code", isBuiltIn: true })
  ];
  const readinessById = new Map();
  let savedPayload;
  let verifyCalls = 0;
  let runCalls = 0;
  let lastRunPayload;

  await page.route("**/api/runtime-profiles**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && /\/verify-progress\//.test(url.pathname)) {
      const profileId = decodeURIComponent(url.pathname.split("/").at(-3));
      const projection = runtimeProjectionFixture(profiles.find((profile) => profile.id === profileId), "task-ready");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          progressId: decodeURIComponent(url.pathname.split("/").at(-1)),
          profileId,
          state: "completed",
          readiness: "task-ready",
          startedAt: RUNTIME_FIXTURE_NOW,
          updatedAt: RUNTIME_FIXTURE_NOW,
          stages: projection.stages
        })
      });
      return;
    }
    if (request.method() === "POST" && /\/api\/runtime-profiles\/[^/]+\/verify$/.test(url.pathname)) {
      verifyCalls++;
      const profileId = decodeURIComponent(url.pathname.split("/").at(-2));
      assert.equal(profileId, "codex-managed-e2e");
      const payload = request.postDataJSON();
      assert.equal(typeof payload.repositoryPath, "string");
      assert.ok(payload.repositoryPath.length > 0);
      assert.equal(typeof payload.taskPath, "string");
      assert.ok(payload.taskPath.length > 0);
      readinessById.set(profileId, "task-ready");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ receipt: runtimeProjectionFixture(profiles.find((profile) => profile.id === profileId), "task-ready").receipt })
      });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/api/runtime-profiles") {
      savedPayload = request.postDataJSON();
      assert.equal(savedPayload.secret, secret);
      assert.deepEqual(savedPayload.extraEnv, { PROVIDER_REGION: "cn-east" });
      profiles.push(runtimeProfileFixture({
        id: "codex-managed-e2e",
        name: savedPayload.name,
        agentKind: savedPayload.agentKind,
        mode: savedPayload.mode,
        provider: savedPayload.provider,
        secretStored: true
      }));
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(runtimeProfilesResponse(profiles, readinessById)) });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/api/runtime-profiles") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(runtimeProfilesResponse(profiles, readinessById)) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/run", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    runCalls++;
    lastRunPayload = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: true }) });
  });

  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/#/environment`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "运行环境" }).waitFor();
    await page.getByText("当前本地 Codex 配置").waitFor();
    await page.getByText("当前本地 Claude 配置").waitFor();
    await page.waitForTimeout(500);
    assert.equal(verifyCalls, 0, "loading and local refresh must not spend model tokens");

    await page.getByRole("button", { name: "新增运行配置" }).click();
    const dialog = page.getByRole("dialog", { name: "新增运行配置" });
    await dialog.waitFor();
    const harness = dialog.getByLabel("Harness");
    assert.deepEqual(await harness.locator("option").allTextContents(), ["Codex CLI", "Claude Code"]);
    await dialog.getByLabel("配置名称").fill("Codex Managed E2E");
    await dialog.getByRole("textbox", { name: "Base URL", exact: true }).fill("https://provider.example.test/v1");
    await dialog.getByLabel("请求模型").fill("gpt-runtime-e2e");
    await dialog.getByLabel("规范模型身份（用于公平比较）").fill("provider/shared-runtime-model");
    await dialog.getByLabel("API 密钥").fill(secret);
    await dialog.getByLabel("额外环境变量（每行 KEY=value）").fill("PROVIDER_REGION=cn-east");
    await dialog.getByText("非官方 Base URL 可能存在安全风险，请确认后保存。").click();
    await dialog.getByRole("button", { name: "保存" }).click();

    const managedCard = page.locator("article.runtime-profile-row", { hasText: "Codex Managed E2E" });
    await managedCard.waitFor();
    assert.equal(savedPayload?.provider?.canonicalModelIdentity, "provider/shared-runtime-model");
    assert.equal((await page.locator("body").innerText()).includes(secret), false);
    assert.equal(verifyCalls, 0, "saving a profile must not automatically verify it");

    await page.getByRole("button", { name: /新建评测/ }).first().click();
    await page.getByRole("heading", { name: "创建一次可信评测" }).waitFor();
    const managedOption = page.locator("label.agent-option", { hasText: "Codex Managed E2E" });
    assert.equal(await managedOption.locator('input[type="checkbox"]').isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: /启动评测|运行单 Agent 评测/ }).isDisabled(), true);
    assert.equal(verifyCalls, 0);

    const planChoice = page.locator(".runtime-profile-choice", { hasText: "Codex Managed E2E" });
    await planChoice.getByRole("button", { name: "运行三阶段验证" }).click();
    await page.getByText("安装、真实对话和仓库修改三阶段验证均已完成。").waitFor();
    await planChoice.getByText("任务可用", { exact: true }).waitFor();
    await planChoice.getByText("通过", { exact: true }).first().waitFor();
    assert.equal(verifyCalls, 1);

    const readyOption = page.locator("label.agent-option", { hasText: "Codex Managed E2E" });
    assert.equal(await readyOption.locator('input[type="checkbox"]').isDisabled(), false);
    await readyOption.click();
    const startButton = page.getByRole("button", { name: /运行单 Agent 评测/ });
    assert.equal(await startButton.isDisabled(), false);
    const [runResponse] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/run" && response.request().method() === "POST"),
      startButton.click()
    ]);
    assert.equal(runResponse.status(), 202);
    assert.equal(runCalls, 1);
    assert.equal(lastRunPayload?.agents?.[0]?.launchSpecHash, "codex-managed-e2e-launch-spec");
    assert.equal(lastRunPayload?.agents?.[0]?.verificationReceiptId, "codex-managed-e2e-receipt");
    assert.equal((await page.locator("body").innerText()).includes(secret), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench applies an explicit Codex model and reasoning profile without Provider routing", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await newAuthenticatedPage(browser, server, { viewport: { width: 1440, height: 1000 } }); const errors = collectErrors(page);
  const profiles = [
    runtimeProfileFixture({ id: "codex-local", name: "Current local Codex setup", agentKind: "codex", isBuiltIn: true }),
    runtimeProfileFixture({ id: "claude-local", name: "Current local Claude setup", agentKind: "claude-code", isBuiltIn: true })
  ];
  const readinessById = new Map();
  let savedPayload;

  await page.route("**/api/runtime-profiles*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/api/runtime-profiles") {
      savedPayload = request.postDataJSON();
      const created = runtimeProfileFixture({
        id: "codex-local-model-e2e",
        name: savedPayload.name,
        agentKind: "codex",
        mode: "inherit-local",
        provider: savedPayload.provider
      });
      profiles.push(created);
      readinessById.set(created.id, "task-ready");
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ profile: created, ...runtimeProfilesResponse(profiles, readinessById) })
      });
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(runtimeProfilesResponse(profiles, readinessById)) });
      return;
    }
    await route.continue();
  });

  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/#/plan`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "创建一次可信评测" }).waitFor();
    await page.getByTestId("codex-model").fill("gpt-5.6-luna-e2e");
    await page.getByTestId("codex-reasoning").selectOption("high");
    await page.getByRole("button", { name: "保存并应用" }).click();
    await page.getByText("Codex 模型和思考强度已应用。请对这个配置运行三阶段验证后再启动任务。").waitFor();
    assert.equal(savedPayload?.agentKind, "codex");
    assert.equal(savedPayload?.mode, "inherit-local");
    assert.equal(savedPayload?.provider?.requestedModel, "gpt-5.6-luna-e2e");
    assert.equal(savedPayload?.provider?.reasoningEffort, "high");
    assert.equal(savedPayload?.provider?.baseUrl, undefined);
    assert.equal(savedPayload?.provider?.protocol, undefined);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});

test("workbench explains Provider overload without reporting verification success", { timeout: 120000 }, async (t) => {
  const chromium = await loadChromiumOrSkip(t); if (!chromium) return;
  const cwd = path.resolve("."); const server = await startServer(cwd); const browser = await chromium.launch({ headless: true }); const page = await newAuthenticatedPage(browser, server, { viewport: { width: 1280, height: 900 } }); const errors = collectErrors(page);
  const profile = runtimeProfileFixture({ id: "claude-overload-e2e", name: "Claude overloaded Provider", agentKind: "claude-code", isBuiltIn: true });
  let verified = false;
  const failedStages = [
    { stage: "installation", status: "passed", startedAt: RUNTIME_FIXTURE_NOW, durationMs: 12, summary: "CLI 2.1.226 is installed." },
    { stage: "conversation", status: "failed", startedAt: RUNTIME_FIXTURE_NOW, durationMs: 30, errorCategory: "provider-overloaded", summary: "API Error: 503 No available accounts" },
    { stage: "task", status: "skipped", startedAt: RUNTIME_FIXTURE_NOW, durationMs: 0, summary: "Skipped because the Provider conversation could not start." }
  ];
  const response = () => {
    const base = runtimeProfilesResponse([profile]);
    if (!verified) return base;
    base.readiness[0] = {
      ...base.readiness[0],
      readiness: "installed",
      receiptMatch: true,
      stages: failedStages,
      receipt: {
        receiptId: "claude-overload-receipt",
        createdAt: RUNTIME_FIXTURE_NOW,
        readiness: "installed",
        stages: failedStages
      },
      failure: {
        errorCategory: "provider-overloaded",
        summary: "API Error: 503 No available accounts"
      }
    };
    return base;
  };

  await page.route("**/api/runtime-profiles**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && /\/verify$/.test(new URL(request.url()).pathname)) {
      verified = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ receipt: response().readiness[0].receipt })
      });
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response()) });
      return;
    }
    await route.continue();
  });

  try {
    await page.goto(`http://127.0.0.1:${server.selectedPort}/workbench/#/environment`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "运行环境" }).waitFor();
    const card = page.locator("article.runtime-profile-row", { hasText: profile.name });
    await card.getByRole("button", { name: "运行三阶段验证" }).click();
    await page.waitForTimeout(500);
    const cardText = await card.innerText();
    await card.getByText("Provider 暂时无可用容量", { exact: true }).waitFor({ timeout: 5000 }).catch((error) => {
      throw new Error(`${error.message}\nCard text after verification:\n${cardText}`);
    });
    await card.getByText(/无需重新登录/).waitFor();
    await page.getByText(/验证完成，但当前配置仍不可运行/).waitFor();
    assert.equal(await page.getByText("安装、真实对话和仓库修改三阶段验证均已完成。").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.stop(); }
});
