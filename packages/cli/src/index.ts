#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteClaudeProviderProfile,
  getCodexDefaultResolvedRuntime,
  listAvailableAdapters,
  listClaudeProviderProfiles,
  preflightAdapters,
  saveClaudeProviderProfile,
  setClaudeProviderProfileSecret
} from "@agentarena/adapters";
import {
  type AgentSelection,
  type BenchmarkRun,
  type ClaudeProviderProfile,
  createAgentSelection,
  createCancellation,
  createRunId,
  formatDuration,
  isAbortError,
  validateTaskPackId
} from "@agentarena/core";
import {
  computeVarianceAnalysis,
  enrichRunWithScores,
  formatDecisionReport,
  formatVarianceReport, 
  generateDecisionReport,
  type Locale as ReportLocale,
  writeReport
} from "@agentarena/report";
import { type BenchmarkProgressEvent, runBenchmark } from "@agentarena/runner";
import { loadTaskPack } from "@agentarena/taskpacks";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { type ParsedArgs, parseArgs, printHelp } from "./args.js";
import { buildBenchmarkOutputSummary } from "./output.js";
import {
  buildCiWorkflow,
  createAdhocLintCommand,
  createAdhocTestCommand,
  createPackageScriptCommand,
  TASKPACK_TEMPLATES
} from "./templates.js";

interface UiRunPayload {
  repoPath: string;
  taskPath: string;
  agents?: Array<{
    baseAgentId: string;
    variantId?: string;
    displayLabel?: string;
    config?: {
      model?: string;
      reasoningEffort?: string;
      providerProfileId?: string;
    };
    configSource?: "ui" | "cli";
  }>;
  agentIds?: string[];
  outputPath?: string;
  probeAuth?: boolean;
  updateSnapshots?: boolean;
  cleanupWorkspaces?: boolean;
  maxConcurrency?: number;
  scoreMode?: string;
  tokenBudget?: number;
}

interface UiProviderProfilePayload {
  id?: string;
  name: string;
  kind: ClaudeProviderProfile["kind"];
  homepage?: string;
  baseUrl?: string;
  apiFormat: ClaudeProviderProfile["apiFormat"];
  primaryModel?: string;
  thinkingModel?: string;
  defaultHaikuModel?: string;
  defaultSonnetModel?: string;
  defaultOpusModel?: string;
  extraEnv?: Record<string, string>;
  writeCommonConfig?: boolean;
  notes?: string;
  secret?: string;
}

interface ActiveUiRun {
  promise: Promise<unknown>;
  cancel: () => void;
}

type UiRunPhase = BenchmarkProgressEvent["phase"] | "idle" | "benchmark";

interface UiRunLogEntry {
  timestamp: string;
  phase: UiRunPhase;
  message: string;
  agentId?: string;
  variantId?: string;
  displayLabel?: string;
}

interface UiRunStatus {
  state: "idle" | "running" | "done" | "error" | "cancelled";
  phase: UiRunPhase | "starting" | "preflight" | "report";
  logs: UiRunLogEntry[];
  updatedAt: string;
  startedAt?: string;
  repoPath?: string;
  taskPath?: string;
  runId?: string;
  outputPath?: string;
  currentAgentId?: string;
  currentVariantId?: string;
  currentDisplayLabel?: string;
  result?: {
    run: BenchmarkRun;
    markdown: string;
    report: Awaited<ReturnType<typeof writeReport>>;
  };
  error?: string;
}

interface ParsedTaskPackMetadataFile {
  metadata?: {
    i18n?: unknown;
  };
}

interface ParsedAdhocTaskPackFile {
  id?: unknown;
  title?: unknown;
  prompt?: unknown;
}

const CLI_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = path.resolve(CLI_PACKAGE_ROOT, "..", "..");
const WEB_REPORT_DIST_ROOT = path.join(WORKSPACE_ROOT, "apps", "web-report", "dist");
const OFFICIAL_TASKPACK_ROOT = path.join(WORKSPACE_ROOT, "examples", "taskpacks", "official");
const DEFAULT_UI_PORT = 4320;
const MAX_REQUEST_BODY_BYTES = 1_048_576;
const MAX_UI_LOG_ENTRIES = 30;

function resolveReportLocale(value?: string): ReportLocale {
  return value === "zh-CN" ? "zh-CN" : "en";
}

function normalizeCliSelections(parsed: ParsedArgs): AgentSelection[] {
  return parsed.agentIds.map((agentId) => {
    const adapter = listAvailableAdapters().find((entry) => entry.id === agentId);
    const config =
      agentId === "codex"
        ? {
            model: parsed.codexModel?.trim() || undefined,
            reasoningEffort: parsed.codexReasoning?.trim() || undefined
          }
        : agentId === "claude-code"
          ? {
              model: parsed.claudeModel?.trim() || undefined,
              providerProfileId: parsed.claudeProfile?.trim() || undefined
            }
          : agentId === "gemini-cli"
            ? {
                model: parsed.geminiModel?.trim() || undefined
              }
            : agentId === "aider"
              ? {
                  model: parsed.aiderModel?.trim() || undefined
                }
              : agentId === "kilo-cli"
                ? {
                    model: parsed.kiloModel?.trim() || undefined
                  }
                : agentId === "opencode"
                  ? {
                      model: parsed.opencodeModel?.trim() || undefined
                    }
                  : agentId === "qwen-code"
                    ? {
                        model: parsed.qwenModel?.trim() || undefined
                      }
                    : agentId === "copilot"
                      ? {
                          model: parsed.copilotModel?.trim() || undefined
                        }
                      : {};

    return createAgentSelection({
      baseAgentId: agentId,
      displayLabel: adapter?.title ?? agentId,
      config,
      configSource:
        (agentId === "codex" && (config.model || config.reasoningEffort)) ||
        (agentId === "claude-code" && (config.model || config.providerProfileId)) ||
        (agentId === "gemini-cli" && config.model) ||
        (agentId === "aider" && config.model) ||
        (agentId === "kilo-cli" && config.model) ||
        (agentId === "opencode" && config.model) ||
        (agentId === "qwen-code" && config.model) ||
        (agentId === "copilot" && config.model)
          ? "cli"
          : undefined
    });
  });
}

function normalizeUiSelections(payload: UiRunPayload): AgentSelection[] {
  if (payload.agents && payload.agents.length > 0) {
    return payload.agents.map((agent) =>
      createAgentSelection({
        baseAgentId: agent.baseAgentId,
        displayLabel: agent.displayLabel,
        config: agent.config,
        configSource: agent.configSource ?? "ui"
      })
    );
  }

  return (payload.agentIds ?? []).map((agentId) =>
    createAgentSelection({
      baseAgentId: agentId,
      displayLabel: listAvailableAdapters().find((entry) => entry.id === agentId)?.title ?? agentId
    })
  );
}

function getTierEmoji(tier: string): string {
  switch (tier) {
    case "supported": return "✅";
    case "experimental": return "⚠️";
    case "blocked": return "❌";
    default: return "❓";
  }
}

/**
 * 检测是否有可用的 adapter
 * @returns 如果有可用的非 demo adapter 返回 true，否则返回 false
 */
async function hasAvailableAdapters(): Promise<boolean> {
  const adapters = listAvailableAdapters().filter((a) => a.kind !== "demo");

  if (adapters.length === 0) {
    return false;
  }

  // 检查是否有任何 adapter 可用
  for (const adapter of adapters) {
    try {
      const preflight = await adapter.preflight({ probeAuth: false });
      if (preflight.status !== "missing") {
        return true;
      }
    } catch {
      // 继续检查下一个 adapter
    }
  }

  return false;
}

/**
 * 显示欢迎信息
 */
function showWelcomeMessage(): void {
  console.log("\n🎉 欢迎使用 AgentArena！");
  console.log("");
  console.log("快速开始：");
  console.log("  agentarena doctor    - 检查环境配置");
  console.log("  agentarena ui        - 启动 Web 界面");
  console.log("  agentarena run       - 开始基准测试");
  console.log("");
}

function getAvailabilityEmoji(availability: string): string {
  switch (availability) {
    case "available": return "✅";
    case "estimated": return "≈";
    case "unavailable": return "❌";
    default: return "❓";
  }
}

interface GroupedItem<T> {
  tier: string;
  emoji: string;
  label: string;
  items: T[];
}

function groupByTier<T extends { capability: { supportTier: string } }>(items: T[]): GroupedItem<T>[] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const tier = item.capability.supportTier;
    if (!groups.has(tier)) {
      groups.set(tier, []);
    }
    groups.get(tier)?.push(item);
  }

  const tierOrder = ["supported", "experimental", "blocked"];
  const tierLabels = new Map([
    ["supported", "Supported Adapters"],
    ["experimental", "Experimental Adapters"],
    ["blocked", "Blocked Adapters"]
  ]);

  return tierOrder
    .filter(tier => groups.has(tier))
    .map(tier => ({
      tier,
      emoji: getTierEmoji(tier),
      label: tierLabels.get(tier) || `${tier} Adapters`,
      items: groups.get(tier) ?? []
    }));
}

async function runDoctor(parsed: ParsedArgs): Promise<void> {
  const selections =
    parsed.agentIds.length > 0
      ? normalizeCliSelections(parsed)
      : listAvailableAdapters()
          .map((adapter) =>
            createAgentSelection({
              baseAgentId: adapter.id,
              displayLabel: adapter.title
            })
          )
          .sort((left, right) => left.baseAgentId.localeCompare(right.baseAgentId));

  const preflights = await preflightAdapters(selections, { probeAuth: parsed.probeAuth });
  if (parsed.format === 'json') {
    console.log(JSON.stringify(preflights, null, 2));
  } else {
    console.log("\n🏥 AgentArena Doctor\n");

    const groups = groupByTier(preflights);

    for (const group of groups) {
      console.log(`${group.emoji} ${group.label} (${group.items.length})`);
      for (const preflight of group.items) {
        const statusIcon = preflight.status === "ready" ? "✓" : preflight.status === "unverified" ? "?" : "✗";
        console.log(`   • ${preflight.agentId.padEnd(20)} ${preflight.capability.invocationMethod}`);
        console.log(`     ${getAvailabilityEmoji(preflight.capability.tokenAvailability)} tokens | ${getAvailabilityEmoji(preflight.capability.costAvailability)} cost | ${getAvailabilityEmoji(preflight.capability.traceRichness)} trace`);
        console.log(`     status: ${statusIcon} ${preflight.status} - ${preflight.summary}`);

        if (preflight.command) {
          console.log(`     command: ${preflight.command}`);
        }
        for (const detail of preflight.details ?? []) {
          console.log(`     detail: ${detail}`);
        }
        if (preflight.capability.authPrerequisites.length > 0) {
          console.log(`     auth: ${preflight.capability.authPrerequisites.join("; ")}`);
        }
        for (const limitation of preflight.capability.knownLimitations) {
          console.log(`     limitation: ${limitation}`);
        }
        console.log(""); // Empty line between adapters
      }
      console.log(""); // Empty line between groups
    }
  }

  if (parsed.strict && preflights.some((preflight) => preflight.status !== "ready")) {
    process.exitCode = 1;
  }
}

async function runListAdapters(parsed: ParsedArgs): Promise<void> {
  const adapters = listAvailableAdapters()
    .map((adapter) => ({
      id: adapter.id,
      title: adapter.title,
      kind: adapter.kind,
      capability: adapter.capability
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (parsed.format === 'json') {
    console.log(JSON.stringify(adapters, null, 2));
    return;
  }

  console.log("\n🏥 AgentArena Adapters\n");

  const groups = groupByTier(adapters);

  for (const group of groups) {
    console.log(`${group.emoji} ${group.label} (${group.items.length})`);
    for (const adapter of group.items) {
      console.log(`   • ${adapter.id.padEnd(20)} ${adapter.capability.invocationMethod}`);
      console.log(`     ${getAvailabilityEmoji(adapter.capability.tokenAvailability)} tokens | ${getAvailabilityEmoji(adapter.capability.costAvailability)} cost | ${getAvailabilityEmoji(adapter.capability.traceRichness)} trace`);

      if (adapter.capability.authPrerequisites.length > 0) {
        console.log(`     auth: ${adapter.capability.authPrerequisites.join("; ")}`);
      }
      for (const limitation of adapter.capability.knownLimitations) {
        console.log(`     limitation: ${limitation}`);
      }
      console.log(""); // Empty line between adapters
    }
    console.log(""); // Empty line between groups
  }
}

async function runInitTaskpack(parsed: ParsedArgs): Promise<void> {
  const templateName = parsed.templateName ?? "repo-health";
  const template = TASKPACK_TEMPLATES[templateName];
  if (!template) {
    console.error(`❌ 未知的任务包模板："${templateName}"`);
    console.error(`原因：该模板不存在，无法创建任务包`);
    console.error(`可用模板：${Object.keys(TASKPACK_TEMPLATES).join(", ")}`);
    console.error(`使用方法：agentarena init-taskpack --template repo-health`);
    process.exit(1);
  }

  const outputPath = path.resolve(parsed.outputPath ?? "agentarena.taskpack.yaml");
  const parentPath = path.dirname(outputPath);

  try {
    await fs.access(outputPath);
    if (!parsed.force) {
      console.error(`❌ 文件已存在：${outputPath}`);
      console.error(`原因：覆盖现有文件可能导致数据丢失`);
      console.error(`解决方法：1) 换一个文件名  2) 加 --force 参数强制覆盖`);
      process.exit(1);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(parentPath, { recursive: true });
  await fs.writeFile(outputPath, template, "utf8");

  if (parsed.format === 'json') {
    console.log(JSON.stringify({ template: templateName, outputPath }, null, 2));
    return;
  }

  console.log(`\nAgentArena task pack created`);
  console.log(`template=${templateName}`);
  console.log(`path=${outputPath}`);
}

async function runInitCi(parsed: ParsedArgs): Promise<void> {
  const workflowPath = path.resolve(parsed.workflowPath ?? parsed.outputPath ?? ".github/workflows/agentarena-benchmark.yml");
  const taskPath = parsed.taskPath ?? "agentarena.taskpack.yaml";
  const agentIds = parsed.agentIds.length > 0 ? parsed.agentIds : ["demo-fast"];
  const ciTemplate = (parsed.ciTemplate ?? "pull-request") as "pull-request" | "smoke" | "nightly";
  if (!["pull-request", "smoke", "nightly"].includes(ciTemplate)) {
    console.error(`❌ 未知的 CI 模板："${ciTemplate}"`);
    console.error(`原因：该模板不存在，无法创建 CI 工作流`);
    console.error(`可用模板：pull-request, smoke, nightly`);
    console.error(`使用方法：agentarena init-ci --ci-template=pull-request`);
    process.exit(1);
  }
  const ciOutputDir = parsed.ciOutputDir ?? ".agentarena/ci-benchmark";
  const parentPath = path.dirname(workflowPath);

  try {
    await fs.access(workflowPath);
    if (!parsed.force) {
      console.error(`❌ 文件已存在：${workflowPath}`);
      console.error(`原因：覆盖现有文件可能导致数据丢失`);
      console.error(`解决方法：1) 换一个文件路径  2) 加 --force 参数强制覆盖`);
      process.exit(1);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(parentPath, { recursive: true });
  await fs.writeFile(
    workflowPath,
    buildCiWorkflow({ taskPath, agentIds, template: ciTemplate, outputDir: ciOutputDir }),
    "utf8"
  );

  if (parsed.format === 'json') {
    console.log(JSON.stringify({ workflowPath, taskPath, agentIds, ciTemplate, ciOutputDir }, null, 2));
    return;
  }

  console.log(`\nAgentArena CI workflow created`);
  console.log(`path=${workflowPath}`);
  console.log(`task=${taskPath}`);
  console.log(`agents=${agentIds.join(",")}`);
  console.log(`template=${ciTemplate}`);
  console.log(`output=${ciOutputDir}`);
}

function jsonResponse(data: unknown, statusCode = 200): { statusCode: number; body: string; headers: Record<string, string> } {
  return {
    statusCode,
    body: JSON.stringify(data, null, 2),
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  };
}

function textResponse(
  body: string,
  statusCode = 200,
  contentType = "text/plain; charset=utf-8"
): { statusCode: number; body: string; headers: Record<string, string> } {
  return {
    statusCode,
    body,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    }
  };
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function createHttpError(message: string, statusCode: number): HttpError {
  return new HttpError(message, statusCode);
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw createHttpError("Request body too large.", 413);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function listOfficialTaskPacks(): Promise<
  Array<{
    id: string;
    title: string;
    description?: string;
    path: string;
    source: string;
    objective?: string;
    judgeRationale?: string;
    repoTypes: string[];
    tags: string[];
    prompt: string;
    judges: Array<{ id: string; type: string; label: string }>;
    difficulty?: string;
    differentiator?: string;
  }>
> {
  try {
    const entries = await fs.readdir(OFFICIAL_TASKPACK_ROOT, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && [".yaml", ".yml", ".json"].includes(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(OFFICIAL_TASKPACK_ROOT, entry.name))
      .sort();

    const taskPacks = await Promise.all(
      files.map(async (filePath) => {
        const taskPack = await loadTaskPack(filePath);
        return {
          id: taskPack.id,
          title: taskPack.title,
          description: taskPack.description,
          path: filePath,
          source: taskPack.metadata?.source ?? "official",
          objective: taskPack.metadata?.objective,
          judgeRationale: taskPack.metadata?.judgeRationale,
          repoTypes: taskPack.metadata?.repoTypes ?? [],
          tags: taskPack.metadata?.tags ?? [],
          prompt: taskPack.prompt,
          judges: taskPack.judges.map((j) => ({ id: j.id, type: j.type, label: j.label })),
          difficulty: taskPack.metadata?.difficulty,
          differentiator: taskPack.metadata?.differentiator,
          i18n: await (async () => {
            try {
              const raw = await fs.readFile(filePath, "utf8");
              const parsed = (filePath.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw)) as ParsedTaskPackMetadataFile;
              return parsed.metadata?.i18n ?? undefined;
            } catch { return undefined; }
          })()
        };
      })
    );

    const difficultyOrder: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
    taskPacks.sort((a, b) => (difficultyOrder[a.difficulty ?? ""] ?? 9) - (difficultyOrder[b.difficulty ?? ""] ?? 9));

    return taskPacks;
  } catch {
    return [];
  }
}

function detectContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function maybeOpenBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const command =
    platform === "win32"
      ? "cmd.exe"
      : platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    platform === "win32"
      ? ["/c", "start", "", url]
      : [url];

  await new Promise<void>((resolve) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
      shell: false
    });
    child.on("error", () => resolve());
    child.unref();
    resolve();
  });
}

async function runUi(parsed: ParsedArgs): Promise<void> {
  const host = parsed.host ?? "127.0.0.1";
  const port = parsed.port ?? DEFAULT_UI_PORT;
  let activeRun: ActiveUiRun | null = null;
  const codexDefaults = await getCodexDefaultResolvedRuntime();
  let activeRunStatus: UiRunStatus = {
    state: "idle",
    phase: "idle",
    logs: [],
    updatedAt: new Date().toISOString()
  };

  const setRunStatus = (status: Partial<UiRunStatus>): void => {
    activeRunStatus = {
      ...activeRunStatus,
      ...status,
      updatedAt: new Date().toISOString()
    };
  };

  const appendRunLog = (entry: Omit<UiRunLogEntry, "timestamp">): void => {
    const nextEntry: UiRunLogEntry = {
      ...entry,
      timestamp: new Date().toISOString()
    };
    activeRunStatus = {
      ...activeRunStatus,
      logs: [...activeRunStatus.logs, nextEntry].slice(-MAX_UI_LOG_ENTRIES),
      updatedAt: nextEntry.timestamp
    };
  };

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);

      // CORS protection: reject cross-origin requests
      const origin = request.headers.origin;
      if (origin) {
        const allowedOrigins = new Set([
          `http://${host}:${port}`,
          `http://localhost:${port}`,
          `http://127.0.0.1:${port}`
        ]);
        // When host is 0.0.0.0, accept localhost and 127.0.0.1 origins
        if (host === "0.0.0.0") {
          allowedOrigins.add(`http://localhost:${port}`);
          allowedOrigins.add(`http://127.0.0.1:${port}`);
        }
        if (!allowedOrigins.has(origin)) {
          const forbidden = jsonResponse({ error: "Cross-origin requests are not allowed." }, 403);
          response.writeHead(forbidden.statusCode, forbidden.headers);
          response.end(forbidden.body);
          return;
        }
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/ui-info") {
        const providerProfiles = await listClaudeProviderProfiles();
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(
          JSON.stringify(
            {
              mode: "local-service",
              repoPath: process.cwd(),
              defaultTaskPath: path.join(OFFICIAL_TASKPACK_ROOT, "repo-health.yaml"),
              defaultOutputPath: path.join(process.cwd(), ".agentarena", "ui-runs"),
              codexDefaults,
              claudeProviderProfiles: providerProfiles.map((profile) => ({
                id: profile.id,
                name: profile.name,
                kind: profile.kind,
                apiFormat: profile.apiFormat,
                primaryModel: profile.primaryModel,
                secretStored: profile.secretStored,
                isBuiltIn: profile.isBuiltIn
              })),
              riskNotice:
                "Provider-switched Claude Code variants use compatibility settings and may behave differently from official Claude Code.",
              host,
              port
            },
            null,
            2
          )
        );
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/adapters") {
        const adapters = listAvailableAdapters().map((adapter) => ({
          id: adapter.id,
          title: adapter.title,
          kind: adapter.kind,
          capability: adapter.capability
        }));
        const payload = jsonResponse(adapters);
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/provider-profiles") {
        const profiles = await listClaudeProviderProfiles();
        const payload = jsonResponse(profiles);
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/provider-profiles") {
        const rawBody = await readRequestBody(request);
        let payload: UiProviderProfilePayload;
        try {
          payload = JSON.parse(rawBody) as UiProviderProfilePayload;
        } catch {
          const invalid = jsonResponse({ error: "Invalid JSON in request body." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        const profile = await saveClaudeProviderProfile(payload);
        if (payload.secret?.trim()) {
          await setClaudeProviderProfileSecret(profile.id, payload.secret);
        }
        const profiles = await listClaudeProviderProfiles();
        const responsePayload = jsonResponse({
          profile: profiles.find((entry) => entry.id === profile.id),
          profiles
        });
        response.writeHead(responsePayload.statusCode, responsePayload.headers);
        response.end(responsePayload.body);
        return;
      }

      const providerProfileMatch = requestUrl.pathname.match(/^\/api\/provider-profiles\/([^/]+)(?:\/(secret))?$/);
      if (providerProfileMatch) {
        const profileId = decodeURIComponent(providerProfileMatch[1]);
        const action = providerProfileMatch[2];

        if (request.method === "PUT" && !action) {
          const rawBody = await readRequestBody(request);
          let payload: UiProviderProfilePayload;
          try {
            payload = JSON.parse(rawBody) as UiProviderProfilePayload;
          } catch {
            const invalid = jsonResponse({ error: "Invalid JSON in request body." }, 400);
            response.writeHead(invalid.statusCode, invalid.headers);
            response.end(invalid.body);
            return;
          }
          const profile = await saveClaudeProviderProfile({
            ...payload,
            id: profileId
          });
          const profiles = await listClaudeProviderProfiles();
          const responsePayload = jsonResponse({
            profile: profiles.find((entry) => entry.id === profile.id),
            profiles
          });
          response.writeHead(responsePayload.statusCode, responsePayload.headers);
          response.end(responsePayload.body);
          return;
        }

        if (request.method === "DELETE" && !action) {
          await deleteClaudeProviderProfile(profileId);
          const profiles = await listClaudeProviderProfiles();
          const responsePayload = jsonResponse({ profiles });
          response.writeHead(responsePayload.statusCode, responsePayload.headers);
          response.end(responsePayload.body);
          return;
        }

        if (request.method === "POST" && action === "secret") {
          const rawBody = await readRequestBody(request);
          let payload: { secret?: string };
          try {
            payload = JSON.parse(rawBody) as { secret?: string };
          } catch {
            const invalid = jsonResponse({ error: "Invalid JSON in request body." }, 400);
            response.writeHead(invalid.statusCode, invalid.headers);
            response.end(invalid.body);
            return;
          }
          await setClaudeProviderProfileSecret(profileId, payload.secret ?? "");
          const profiles = await listClaudeProviderProfiles();
          const responsePayload = jsonResponse({
            profile: profiles.find((entry) => entry.id === profileId),
            profiles
          });
          response.writeHead(responsePayload.statusCode, responsePayload.headers);
          response.end(responsePayload.body);
          return;
        }
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/create-adhoc-taskpack") {
        const rawBody = await readRequestBody(request);
        let body: { prompt: string; title?: string };
        try {
          body = JSON.parse(rawBody) as { prompt: string; title?: string };
        } catch {
          const invalid = jsonResponse({ error: "Invalid JSON in request body." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        if (!body.prompt?.trim()) {
          const invalid = jsonResponse({ error: "prompt is required." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        const adhocDir = path.join(process.cwd(), ".agentarena", "adhoc-taskpacks");
        await fs.mkdir(adhocDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const adhocTitle = body.title?.trim() || `Adhoc Task ${timestamp}`;
        const adhocId = `adhoc-${timestamp}`;
        const buildCommand = createPackageScriptCommand("build");
        const testReportFile = `.agentarena/${adhocId}-test-results.json`;
        const lintReportFile = `.agentarena/${adhocId}-lint-results.json`;
        const testCommand = createAdhocTestCommand(testReportFile);
        const lintCommand = createAdhocLintCommand(lintReportFile);
        const yamlContent = stringifyYaml({
          schemaVersion: "agentarena.taskpack/v1",
          id: adhocId,
          title: adhocTitle,
          description: "User-defined ad-hoc task from the web UI.",
          metadata: {
            source: "community",
            owner: "user",
            difficulty: "medium",
            objective: "Execute the user-provided prompt and verify the result.",
            repoTypes: ["node-js"],
            tags: ["adhoc", "custom", "node-assumptions"],
            dependencies: [],
            judgeRationale: "These default checks assume a Node-style repository with package.json, README, build, test, and lint commands."
          },
          prompt: body.prompt,
          judges: [
            {
              id: "repo-not-broken",
              type: "file-exists",
              label: "Node package manifest still exists",
              path: "package.json"
            },
            {
              id: "readme-exists",
              type: "file-exists",
              label: "Repository README still exists",
              path: "README.md"
            },
            {
              id: "build-passes",
              type: "command",
              label: "Node project still builds",
              command: buildCommand,
              timeoutMs: 120000
            },
            {
              id: "tests-pass",
              type: "test-result",
              label: "Node tests still pass with structured results",
              command: testCommand,
              format: "auto",
              reportFile: testReportFile,
              timeoutMs: 120000
            },
            {
              id: "lint-clean",
              type: "lint-check",
              label: "Node lint stays clean",
              command: lintCommand,
              format: "auto",
              reportFile: lintReportFile,
              maxWarnings: 0,
              timeoutMs: 120000
            }
          ]
        }, { lineWidth: 0 });
        const adhocPath = path.join(adhocDir, `${adhocId}.yaml`);
        await fs.writeFile(adhocPath, yamlContent, "utf8");
        const payload = jsonResponse({ path: adhocPath, id: adhocId, title: adhocTitle });
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/adhoc-taskpacks") {
        const adhocDir = path.join(process.cwd(), ".agentarena", "adhoc-taskpacks");
        try {
          const entries = await fs.readdir(adhocDir, { withFileTypes: true });
          const items = await Promise.all(
            entries
              .filter((e) => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")))
              .sort((a, b) => b.name.localeCompare(a.name))
              .map(async (e) => {
                const filePath = path.join(adhocDir, e.name);
                const stat = await fs.stat(filePath);
                const raw = await fs.readFile(filePath, "utf8");
                const parsed = parseYaml(raw) as ParsedAdhocTaskPackFile;
                return {
                  id: typeof parsed.id === "string" ? parsed.id : e.name,
                  title: typeof parsed.title === "string" ? parsed.title : e.name,
                  path: filePath,
                  createdAt: stat.birthtime.toISOString(),
                  promptPreview: String(parsed.prompt ?? "").slice(0, 200)
                };
              })
          );
          const payload = jsonResponse(items);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
        } catch {
          const payload = jsonResponse([]);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
        }
        return;
      }

      if (request.method === "DELETE" && requestUrl.pathname.startsWith("/api/adhoc-taskpacks/")) {
        const adhocId = decodeURIComponent(requestUrl.pathname.slice("/api/adhoc-taskpacks/".length));
        if (!validateTaskPackId(adhocId)) {
          const forbidden = jsonResponse({ error: "Invalid adhoc taskpack ID." }, 400);
          response.writeHead(forbidden.statusCode, forbidden.headers);
          response.end(forbidden.body);
          return;
        }
        const adhocDir = path.resolve(process.cwd(), ".agentarena", "adhoc-taskpacks");
        const filePath = path.resolve(adhocDir, `${adhocId}.yaml`);
        // Harden path traversal check: use resolved paths for comparison
        if (!filePath.startsWith(adhocDir + path.sep) && filePath !== adhocDir) {
          const forbidden = jsonResponse({ error: "Invalid adhoc taskpack ID." }, 400);
          response.writeHead(forbidden.statusCode, forbidden.headers);
          response.end(forbidden.body);
          return;
        }
        try {
          await fs.unlink(filePath);
          const payload = jsonResponse({ deleted: true, id: adhocId });
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
        } catch {
          const payload = jsonResponse({ error: "Adhoc taskpack not found." }, 404);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
        }
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/taskpacks") {
        const taskPacks = await listOfficialTaskPacks();
        const payload = jsonResponse(taskPacks);
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/run-status") {
        const payload = jsonResponse(activeRunStatus);
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/run") {
        if (activeRun) {
          const payload = jsonResponse({ error: "A benchmark run is already in progress." }, 409);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
          return;
        }

        const rawBody = await readRequestBody(request);
        let runPayload: UiRunPayload;
        try {
          runPayload = JSON.parse(rawBody) as UiRunPayload;
        } catch {
          const invalid = jsonResponse({ error: "Invalid JSON in request body." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        const selections = normalizeUiSelections(runPayload);
        if (!runPayload.repoPath || !runPayload.taskPath || selections.length === 0) {
          const invalid = jsonResponse(
            { error: "repoPath, taskPath, and at least one agent selection are required." },
            400
          );
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }

        // Reset status to clean state before starting a new run
        activeRunStatus = {
          state: "idle",
          phase: "idle",
          logs: [],
          updatedAt: new Date().toISOString()
        };

        setRunStatus({
          state: "running",
          phase: "starting",
          startedAt: new Date().toISOString(),
          repoPath: runPayload.repoPath,
          taskPath: runPayload.taskPath,
          outputPath: runPayload.outputPath
        });
        appendRunLog({
          phase: "starting",
          message: `Starting benchmark for ${selections.length} selection(s).`
        });

        const cancellationController = new AbortController();
        const cancellation = createCancellation(cancellationController.signal);

        activeRun = {
          cancel: () => cancellationController.abort(),
          promise: (async () => {
          try {
            const uiRunId = createRunId();
            const outputPath = runPayload.outputPath
              ? path.join(path.resolve(runPayload.outputPath), uiRunId)
              : undefined;
            const benchmark = await runBenchmark({
              runId: uiRunId,
              repoPath: runPayload.repoPath,
              taskPath: runPayload.taskPath,
              agentIds: selections.map((selection) => selection.baseAgentId),
              agents: selections,
              outputPath,
              probeAuth: runPayload.probeAuth,
              updateSnapshots: runPayload.updateSnapshots,
              cleanupWorkspaces: runPayload.cleanupWorkspaces,
              maxConcurrency: runPayload.maxConcurrency,
              scoreMode: runPayload.scoreMode,
              tokenBudget: runPayload.tokenBudget ? Number(runPayload.tokenBudget) : undefined,
              cancellation,
              onProgress: (event: BenchmarkProgressEvent) => {
                const phase =
                  event.phase === "starting" || event.phase === "preflight"
                    ? event.phase
                    : event.phase === "report"
                      ? "report"
                      : "benchmark";
                setRunStatus({
                  phase,
                  currentAgentId:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.agentId
                      : activeRunStatus.currentAgentId,
                  currentVariantId:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.variantId
                      : activeRunStatus.currentVariantId,
                  currentDisplayLabel:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.displayLabel
                      : activeRunStatus.currentDisplayLabel
                });
                appendRunLog({
                  phase,
                  message: event.message,
                  agentId: event.agentId,
                  variantId: event.variantId,
                  displayLabel: event.displayLabel
                });
              }
            });

            const runCancelled =
              cancellationController.signal.aborted || benchmark.results.some((result) => result.status === "cancelled");
            if (runCancelled) {
              appendRunLog({
                phase: activeRunStatus.phase,
                message: "Run cancelled."
              });
              setRunStatus({
                state: "cancelled",
                phase: "idle",
                error: undefined,
                currentAgentId: undefined,
                currentVariantId: undefined,
                currentDisplayLabel: undefined,
                result: undefined
              });
              return;
            }

            setRunStatus({
              phase: "report",
              currentAgentId: undefined,
              currentVariantId: undefined,
              currentDisplayLabel: undefined
            });
            appendRunLog({
              phase: "report",
              message: "Writing report artifacts."
            });
            const report = await writeReport(benchmark, {
              locale: resolveReportLocale(process.env.AGENTARENA_LOCALE)
            });
            appendRunLog({
              phase: "report",
              message: "Report artifacts are ready."
            });
            const run = JSON.parse(await fs.readFile(report.jsonPath, "utf8"));
            const markdown = await fs.readFile(report.markdownPath, "utf8");
            setRunStatus({
              state: "done",
              phase: "idle",
              result: { run, markdown, report }
            });
          } catch (runError) {
            const errorMessage = runError instanceof Error ? runError.message : String(runError);
            appendRunLog({
              phase: activeRunStatus.phase,
              message: isAbortError(runError) ? "Run cancelled." : `Run failed: ${errorMessage}`
            });
            setRunStatus(
              isAbortError(runError)
                ? {
                    state: "cancelled",
                    phase: "idle",
                    error: undefined,
                    currentAgentId: undefined,
                    currentVariantId: undefined,
                    currentDisplayLabel: undefined
                  }
                : {
                    state: "error",
                    error: errorMessage
                  }
            );
          } finally {
            activeRun = null;
          }
        })()
        };

        const accepted = jsonResponse({ accepted: true }, 202);
        response.writeHead(accepted.statusCode, accepted.headers);
        response.end(accepted.body);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/run/cancel") {
        if (!activeRun) {
          const payload = jsonResponse({ error: "No benchmark run in progress." }, 409);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
          return;
        }
        activeRun.cancel();
        appendRunLog({ phase: activeRunStatus.phase, message: "Cancellation requested by user." });
        const payload = jsonResponse({ cancelled: true });
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "GET") {
        let filePath = requestUrl.pathname === "/" ? path.join(WEB_REPORT_DIST_ROOT, "index.html") : path.join(WEB_REPORT_DIST_ROOT, requestUrl.pathname.replace(/^\/+/, ""));
        filePath = path.normalize(filePath);
        if (!filePath.startsWith(WEB_REPORT_DIST_ROOT)) {
          const forbidden = textResponse("Forbidden", 403);
          response.writeHead(forbidden.statusCode, forbidden.headers);
          response.end(forbidden.body);
          return;
        }

        try {
          const body = await fs.readFile(filePath);
          response.writeHead(200, {
            "Content-Type": detectContentType(filePath),
            "Cache-Control": "no-store"
          });
          response.end(body);
          return;
        } catch {
          const notFound = textResponse("Not Found", 404);
          response.writeHead(notFound.statusCode, notFound.headers);
          response.end(notFound.body);
          return;
        }
      }

      const methodNotAllowed = textResponse("Method Not Allowed", 405);
      response.writeHead(methodNotAllowed.statusCode, methodNotAllowed.headers);
      response.end(methodNotAllowed.body);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const payload = jsonResponse(
        { error: error instanceof Error ? error.message : String(error) },
        statusCode
      );
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const url = `http://${host}:${port}`;
  console.log(`\nAgentArena UI server running`);
  console.log(`url=${url}`);
  console.log(`repo=${process.cwd()}`);

  if (!parsed.noOpen) {
    await maybeOpenBrowser(url);
  }

  await new Promise<void>((resolve) => {
    const closeServer = () => {
      server.close(() => resolve());
    };

    process.once("SIGINT", closeServer);
    process.once("SIGTERM", closeServer);
  });
}

async function runBenchmarkCommand(parsed: ParsedArgs): Promise<void> {
  const reportLocale = resolveReportLocale(parsed.locale ?? process.env.AGENTARENA_LOCALE);

  if (!parsed.repoPath) {
    throw new Error(
      "Missing required argument: --repo\n" +
      "Example: agentarena run --repo . --task taskpack.yaml --agents demo-fast\n" +
      'Run "agentarena --help" for more information.'
    );
  }

  if (!parsed.taskPath) {
    console.error(`❌ 缺少必需参数：--task`);
    console.error(`原因：需要指定任务包文件路径`);
    console.error(`解决方法：agentarena run --repo . --task taskpack.yaml --agents demo-fast`);
    console.error(`更多帮助：agentarena --help`);
    process.exit(1);
  }

  if (parsed.agentIds.length === 0) {
    console.error(`❌ 缺少必需参数：--agents`);
    console.error(`原因：需要指定至少一个要测试的 AI 代理`);
    console.error(`解决方法：agentarena run --repo . --task taskpack.yaml --agents demo-fast`);
    console.error(`查看可用代理：agentarena list-adapters`);
    process.exit(1);
  }

  // Validate repo path exists
  try {
    const repoStat = await fs.stat(parsed.repoPath);
    if (!repoStat.isDirectory()) {
      throw new Error(`--repo path is not a directory: ${parsed.repoPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`❌ --repo 路径不存在：${parsed.repoPath}`);
      console.error(`原因：指定的代码仓库路径不存在`);
      console.error(`解决方法：检查路径是否正确，或先创建该目录`);
      process.exit(1);
    }
    throw error;
  }

  // Validate task path exists
  try {
    await fs.access(parsed.taskPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`❌ --task 文件不存在：${parsed.taskPath}`);
      console.error(`原因：指定的任务包文件不存在`);
      console.error(`解决方法：检查文件路径是否正确，或使用 agentarena init-taskpack 创建新任务包`);
      process.exit(1);
    }
    throw error;
  }

  // Validate agent IDs
  const availableAdapters = listAvailableAdapters();
  const availableIds = availableAdapters.map((a) => a.id);
  const invalidAgents = parsed.agentIds.filter((id) => !availableIds.includes(id));
  if (invalidAgents.length > 0) {
    console.error(`❌ 未知的代理：${invalidAgents.join(", ")}`);
    console.error(`原因：这些代理未安装或不存在`);
    console.error(`可用代理：${availableIds.join(", ")}`);
    console.error(`查看详情：agentarena list-adapters`);
    process.exit(1);
  }

  const selections = normalizeCliSelections(parsed);

  if (parsed.format !== 'json') {
    console.log(`\nStarting AgentArena benchmark...`);
    console.log(`Repository: ${parsed.repoPath}`);
    console.log(`Task: ${parsed.taskPath}`);
    console.log(`Agents: ${parsed.agentIds.join(", ")}`);
    if (parsed.probeAuth) {
      console.log(`Authentication probe: enabled`);
    }
    console.log("");
  }

  let cancelled = false;
  const cancellationController = new AbortController();
  const cancellation = createCancellation(cancellationController.signal);
  const sigintHandler = () => {
    if (cancelled) {
      process.exit(1);
    }
    cancelled = true;
    cancellationController.abort();
    console.error("\nCancelling benchmark... (press Ctrl+C again to force quit)");
  };
  process.on("SIGINT", sigintHandler);

  let benchmark: BenchmarkRun;
  try {
    benchmark = await runBenchmark({
      repoPath: parsed.repoPath,
      taskPath: parsed.taskPath,
      agentIds: selections.map((selection) => selection.baseAgentId),
      agents: selections,
      outputPath: parsed.outputPath ? path.resolve(parsed.outputPath) : undefined,
      probeAuth: parsed.probeAuth,
      updateSnapshots: parsed.updateSnapshots,
      cleanupWorkspaces: parsed.cleanupWorkspaces,
      maxConcurrency: parsed.maxConcurrency,
      scoreMode: parsed.scoreMode,
      tokenBudget: parsed.tokenBudget,
      categories: parsed.categories,
      cancellation,
      onProgress: parsed.format === 'json'
        ? undefined
        : (event: BenchmarkProgressEvent) => {
            const prefix = event.displayLabel ? `[${event.displayLabel}] ` : "";
            process.stderr.write(`  ${prefix}${event.message}\n`);
          }
    });
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }

  const report = await writeReport(benchmark, { locale: reportLocale });
  const scoredBenchmark = enrichRunWithScores(benchmark);

  // Generate decision report
  const decisionReport = generateDecisionReport(benchmark, {
    teamSize: 10,
    dailyRuns: 5
  });
  const decisionReportPath = path.join(benchmark.outputPath, "decision-report.md");
  await fs.writeFile(decisionReportPath, formatDecisionReport(decisionReport), "utf8");

  // Variance analysis: check for previous runs with the same task
  const runsDir = path.dirname(benchmark.outputPath); // Go up one level to find other runs
  let varianceReportText: string | null = null;
  try {
    const allRunFiles = await fs.readdir(runsDir);
    const previousRuns = await Promise.all(
      allRunFiles
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          try {
            const content = await fs.readFile(path.join(runsDir, f), "utf8");
            return JSON.parse(content) as BenchmarkRun;
          } catch {
            return null;
          }
        })
    );
    const comparableRuns = previousRuns.filter(
      (r): r is BenchmarkRun => r !== null && r.task?.id === benchmark.task?.id
    );
    if (comparableRuns.length > 1) {
      const varianceReport = computeVarianceAnalysis(comparableRuns);
      varianceReportText = formatVarianceReport(varianceReport);
    }
  } catch {
    // Ignore variance analysis errors - not critical for the benchmark run
  }

  if (parsed.format === 'json') {
    console.log(JSON.stringify(buildBenchmarkOutputSummary(benchmark, report), null, 2));
  } else {
    console.log(`\nAgentArena run complete: ${scoredBenchmark.runId}`);
    console.log(`Score scope: ${scoredBenchmark.scoreScope ?? "run-local"}`);
    console.log(`Score note: ${scoredBenchmark.scoreValidityNote ?? "Scores only compare variants inside this run."}`);
    console.log(`\nPreflight Results:`);
    for (const preflight of scoredBenchmark.preflights) {
      const statusIcon = preflight.status === "ready" ? "✓" : preflight.status === "unverified" ? "?" : "✗";
      console.log(
        `  ${statusIcon} ${preflight.displayLabel}: ${preflight.status} - ${preflight.summary}`
      );
      if (preflight.resolvedRuntime?.effectiveModel) {
        console.log(`    Model: ${preflight.resolvedRuntime.effectiveModel}`);
      }
      if (preflight.resolvedRuntime?.effectiveAgentVersion) {
        console.log(`    Version: ${preflight.resolvedRuntime.effectiveAgentVersion}`);
      }
    }

    console.log(`\nBenchmark Results:`);
    for (const result of scoredBenchmark.results) {
      const statusIcon = result.status === "success" ? "✓" : "✗";
      console.log(
        `  ${statusIcon} ${result.displayLabel}: ${result.status} (${formatDuration(result.durationMs)})`
      );
      console.log(`    status=${result.status}`);
      console.log(`    Score: ${(result.compositeScore ?? 0).toFixed(1)}`);
      if (result.resolvedRuntime?.effectiveModel) {
        console.log(`    Model: ${result.resolvedRuntime.effectiveModel}`);
      }
      if (result.resolvedRuntime?.effectiveReasoningEffort) {
        console.log(`    Reasoning: ${result.resolvedRuntime.effectiveReasoningEffort}`);
      }
      if (result.resolvedRuntime?.effectiveAgentVersion) {
        console.log(`    Version: ${result.resolvedRuntime.effectiveAgentVersion}`);
      }
      console.log(`    Tokens: ${result.tokenUsage} | Cost: ${result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"} | Files changed: ${result.changedFiles.length}`);

      const passedJudges = result.judgeResults.filter((j) => j.success).length;
      const totalJudges = result.judgeResults.length;
      if (totalJudges > 0) {
        console.log(`    Judges: ${passedJudges}/${totalJudges} passed`);
      }
    }

    const successCount = scoredBenchmark.results.filter((r) => r.status === "success").length;
    const totalCount = scoredBenchmark.results.length;
    console.log(`\nSummary: ${successCount}/${totalCount} agents succeeded`);

    // Print decision report summary
    const topRec = decisionReport.recommendations.find((r) => r.recommendation === "recommended");
    if (topRec) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`📋 AGENTARENA DECISION REPORT`);
      console.log(`${"═".repeat(60)}`);
      console.log(``);
      console.log(`🏆 推荐: ${topRec.displayLabel}`);
      console.log(`   - 成功率: ${(topRec.successRate * 100).toFixed(0)}%`);
      console.log(`   - 平均成本: $${topRec.avgCostPerRun.toFixed(2)}/次`);
      console.log(`   - 置信度: ${topRec.confidence}`);
      console.log(``);
      console.log(`📄 完整报告: ${decisionReportPath}`);
      console.log(`${"═".repeat(60)}`);
    }

    console.log(`\nOutput Files:`);
    console.log(`  JSON summary:       ${report.jsonPath}`);
    console.log(`  Markdown:           ${report.markdownPath}`);
    console.log(`  HTML report:        ${report.htmlPath}`);
    console.log(`  Badge:              ${report.badgePath}`);
    console.log(`  PR comment:         ${report.prCommentPath}`);
    console.log(`  Decision report:    ${decisionReportPath}`);

    // Print variance report if available
    if (varianceReportText) {
      console.log(`\n${varianceReportText}`);
    }
  }

  if (benchmark.results.some((result) => result.status !== "success")) {
    process.exitCode = 1;
  }
}

async function runInit(parsed: ParsedArgs): Promise<void> {
  const repoPath = parsed.repoPath ? path.resolve(parsed.repoPath) : process.cwd();
  const taskPackPath = parsed.outputPath ? path.resolve(parsed.outputPath) : path.join(repoPath, "agentarena.taskpack.yaml");

  // Check if taskpack already exists
  try {
    await fs.access(taskPackPath);
    if (!parsed.force) {
      console.log(`Task pack already exists at: ${taskPackPath}`);
      console.log("Use --force to overwrite, or run with an existing task pack.");
      return;
    }
  } catch {
    // File doesn't exist, proceed
  }

  // Generate a demo taskpack that showcases multiple judge types
  const demoTaskPack = {
    id: "demo-repo-health",
    title: "Demo Repository Health Check",
    prompt: "Analyze this repository and create a comprehensive health report covering code quality, documentation, and project structure. Create a HEALTH.md file summarizing your findings with actionable recommendations.",
    difficulty: "easy",
    repoTypes: ["generic"],
    judges: [
      { type: "file-exists", path: "HEALTH.md" },
      { type: "file-contains", path: "HEALTH.md", pattern: "recommendation", regex: true, flags: "i" },
      { type: "file-count", pattern: "**/*.md", min: 1 }
    ]
  };

  const yamlContent = stringifyYaml(demoTaskPack);
  await fs.writeFile(taskPackPath, yamlContent, "utf8");
  console.log(`\n✓ Generated demo task pack: ${taskPackPath}`);

  // Detect available agents
  const allAdapters = listAvailableAdapters().filter((a) => a.kind !== "demo");
  const detectedAgents: string[] = [];

  for (const adapter of allAdapters) {
    try {
      const preflight = await adapter.preflight({ probeAuth: false });
      if (preflight.status !== "missing") {
        detectedAgents.push(adapter.id);
      }
    } catch {
      // Agent not available
    }
  }

  const requestedAgents = parsed.agentIds.length > 0 ? parsed.agentIds : detectedAgents;

  if (requestedAgents.length === 0) {
    console.log("\n⚠ No agents detected. Install at least one agent CLI to run benchmarks.");
    console.log("\nSupported agents:");
    for (const adapter of allAdapters) {
      console.log(`  - ${adapter.id}: ${adapter.title}`);
    }
    console.log("\nAfter installing an agent, run: agentarena init");
    return;
  }

  if (parsed.agentIds.length > 0) {
    console.log(`\n✓ Using requested agents: ${requestedAgents.join(", ")}`);
    console.log(`  (${detectedAgents.length} agent(s) detected on this machine)`);
  } else {
    console.log(`\n✓ Detected ${detectedAgents.length} available agent(s): ${detectedAgents.join(", ")}`);
  }

  console.log(`\n▶ Ready to run! Execute:`);
  console.log(`  agentarena run --repo ${repoPath} --task ${taskPackPath} --agents ${requestedAgents.join(",")}`);
}

async function main(): Promise<void> {
  let parsed: ParsedArgs | undefined;

  try {
    parsed = parseArgs(process.argv.slice(2));

    // 检查是否需要显示欢迎信息
    const shouldShowWelcome = parsed.welcome || (!parsed.command && !(await hasAvailableAdapters()));

    if (shouldShowWelcome) {
      showWelcomeMessage();
      // 如果只有 --welcome 标志而没有命令，显示欢迎信息后退出
      if (!parsed.command) {
        return;
      }
    }

    if (!parsed.command) {
      printHelp();
      return;
    }

    switch (parsed.command) {
      case "doctor":
        await runDoctor(parsed);
        break;
      case "init":
        await runInit(parsed);
        break;
      case "run":
        await runBenchmarkCommand(parsed);
        break;
      case "list-adapters":
        await runListAdapters(parsed);
        break;
      case "init-taskpack":
        await runInitTaskpack(parsed);
        break;
      case "init-ci":
        await runInitCi(parsed);
        break;
      case "ui":
        await runUi(parsed);
        break;
      case "help":
      case "--help":
      case "-h":
        printHelp();
        break;
      case "version":
      case "--version":
      case "-v": {
        const cliPkgPath = path.join(CLI_PACKAGE_ROOT, "package.json");
        try {
          const pkg = JSON.parse(await fs.readFile(cliPkgPath, "utf8"));
          console.log(pkg.version ?? "unknown");
        } catch {
          console.log("unknown");
        }
        break;
      }
      default:
        console.error(`❌ 未知命令："${parsed.command}"`);
        console.error(`原因：该命令不存在`);
        console.error(`可用命令：run, doctor, list-adapters, init, init-taskpack, init-ci, ui`);
        console.error(`使用方法：agentarena --help`);
        process.exit(1);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (parsed?.verbose && error instanceof Error) {
      console.error(`\n❌ 错误：${message}`);
      console.error(`\n堆栈跟踪：`);
      console.error(error.stack);
    } else {
      console.error(`\n❌ 错误：${message}`);
    }

    // Provide helpful suggestions based on common errors
    if (message.includes("ENOENT") || message.includes("does not exist")) {
      console.error("\n💡 提示：请检查文件路径是否正确，文件是否存在");
    } else if (message.includes("Unknown agent")) {
      console.error('\n💡 提示：运行 agentarena list-adapters 查看可用代理');
    } else if (message.includes("Missing required")) {
      console.error('\n💡 提示：运行 agentarena --help 查看使用信息');
    }

    if (!parsed?.verbose) {
      console.error('\n💡 使用 --verbose 参数查看详细错误信息');
    }

    process.exitCode = 1;
  }
}

void main();
