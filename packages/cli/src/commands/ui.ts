#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  deleteClaudeProviderProfile,
  getCodexDefaultResolvedRuntime,
  listAvailableAdapters,
  listClaudeProviderProfiles,
  preflightAdapters,
  saveClaudeProviderProfile,
  setClaudeProviderProfileSecret,
} from "@agentarena/adapters";
import {
  type ClaudeProviderProfile,
  createAgentSelection,
  createCancellation,
  createRunId,
  isAbortError,
  validateTaskPackId,
} from "@agentarena/core";
import {
  writeReport,
} from "@agentarena/report";
import { type BenchmarkProgressEvent, runBenchmark } from "@agentarena/runner";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ParsedArgs } from "../args.js";
import {
  checkAuthHeader,
  checkCorsOrigin,
  checkRateLimit,
  detectContentType,
  generateAuthToken,
  HttpError,
  jsonResponse,
  readRequestBody,
  startRateLimitCleanup,
  textResponse,
} from "../server.js";
import {
  createAdhocLintCommand,
  createAdhocTestCommand,
  createPackageScriptCommand,
} from "../templates.js";
import {
  normalizeUiSelections,
  OFFICIAL_TASKPACK_ROOT,
  type ParsedAdhocTaskPackFile,
  resolveReportLocale,
  type UiRunLogEntry,
  type UiRunPayload,
  type UiRunStatus,
  WORKSPACE_ROOT,
} from "./shared.js";

const DEFAULT_UI_PORT = 4320;
const MAX_UI_LOG_ENTRIES = 30;

const WEB_REPORT_DIST_ROOT = path.join(WORKSPACE_ROOT, "apps", "web-report", "dist");

interface ActiveUiRun {
  promise: Promise<unknown>;
  cancel: () => void;
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
  _confirmBaseUrlRisk?: boolean;
}

async function maybeOpenBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd.exe" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true, shell: false });
    child.on("error", () => resolve());
    child.unref();
    resolve();
  });
}

function validateProviderProfilePayload(payload: UiProviderProfilePayload): string | null {
  if (!payload.name?.trim()) return "name is required.";
  if (!payload.kind?.trim()) return "kind is required (e.g. 'official', 'anthropic-compatible', 'openai-proxy').";
  if (!payload.apiFormat?.trim()) return "apiFormat is required (e.g. 'anthropic-messages', 'openai-chat-via-proxy').";
  return null;
}

function listOfficialTaskPacks() {
  // This is imported from ./init.js - re-export it here for use in the UI server
  return import("./init.js").then(mod => mod.listOfficialTaskPacks());
}


export async function runUi(parsed: ParsedArgs): Promise<void> {
  const host = parsed.host ?? "127.0.0.1";
  const port = parsed.port ?? DEFAULT_UI_PORT;
  const isLocalhost = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "::ffff:127.0.0.1";
  // Token priority: --auth-token > AGENTARENA_AUTH_TOKEN env > auto-generated
  const authToken = parsed.authToken?.trim() || process.env.AGENTARENA_AUTH_TOKEN?.trim() || generateAuthToken();
  let activeRun: ActiveUiRun | null = null;
  // Mutex flag: set synchronously when a run request begins processing (before any await),
  // preventing concurrent requests from bypassing the activeRun check during the
  // async gap between check and assignment. Cleared when activeRun is fully assigned
  // or if the request fails before starting the run.
  let runStarting = false;
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

  // Periodically clean up stale rate limit entries to prevent memory leaks
  const rateLimitCleanupInterval = startRateLimitCleanup();

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);

      // Rate limiting: check before processing API requests
      if (requestUrl.pathname.startsWith("/api/")) {
        const clientIp = request.socket.remoteAddress ?? "unknown";
        const rateLimitResult = checkRateLimit(clientIp, requestUrl.pathname);
        if (!rateLimitResult.allowed) {
          const retryAfterSeconds = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
          response.writeHead(429, {
            "Content-Type": "application/json; charset=utf-8",
            "Retry-After": String(retryAfterSeconds),
            "Cache-Control": "no-store"
          });
          response.end(JSON.stringify({
            error: "Rate limit exceeded. Please wait before retrying.",
            retryAfterSeconds
          }));
          return;
        }
      }

      // CORS protection: reject cross-origin requests
      const origin = request.headers.origin;
      if (!checkCorsOrigin(origin, host, port)) {
        const forbidden = jsonResponse({ error: "Cross-origin requests are not allowed." }, 403);
        response.writeHead(forbidden.statusCode, forbidden.headers);
        response.end(forbidden.body);
        return;
      }

      // Token authentication: required for non-localhost connections
      if (!checkAuthHeader(requestUrl, request.method, isLocalhost, authToken, request.headers.authorization)) {
        const unauthorized = jsonResponse({ error: "Authentication required. Pass token via Authorization: Bearer <token> header." }, 401);
        response.writeHead(unauthorized.statusCode, unauthorized.headers);
        response.end(unauthorized.body);
        return;
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
              port,
              authRequired: !isLocalhost
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

      if (request.method === "POST" && requestUrl.pathname === "/api/preflight") {
        const rawBody = await readRequestBody(request);
        let body: { baseAgentId?: string; displayLabel?: string; config?: { model?: string; reasoningEffort?: string; providerProfileId?: string } };
        try {
          body = JSON.parse(rawBody);
        } catch {
          const invalid = jsonResponse({ error: "Invalid JSON." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        if (!body.baseAgentId) {
          const invalid = jsonResponse({ error: "Missing baseAgentId." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        try {
          const selection = createAgentSelection({
            baseAgentId: body.baseAgentId,
            displayLabel: body.displayLabel,
            config: body.config,
            configSource: "ui"
          });
          const results = await preflightAdapters([selection], { probeAuth: true });
          const payload = jsonResponse(results[0]);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
        } catch (err: unknown) {
          console.error(`[agentarena] Preflight failed: ${err instanceof Error ? err.message : String(err)}`);
          const payload = jsonResponse({ error: "Internal server error" }, 500);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
        }
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/provider-profiles") {
        const profiles = await listClaudeProviderProfiles();
        const filtered = profiles.map(({ extraEnv, ...rest }: ClaudeProviderProfile) => ({
          ...rest,
          extraEnv: extraEnv ? Object.fromEntries(Object.keys(extraEnv as Record<string, unknown>).map(k => [k, "***"])) : undefined
        }));
        const payload = jsonResponse(filtered);
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
        const validationError = validateProviderProfilePayload(payload);
        if (validationError) {
          const invalid = jsonResponse({ error: validationError }, 400);
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
          const validationError = validateProviderProfilePayload(payload);
          if (validationError) {
            const invalid = jsonResponse({ error: validationError }, 400);
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
          if (payload.secret && payload.secret.length > 10000) {
            const invalid = jsonResponse({ error: "secret must be less than 10,000 characters." }, 400);
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
        if (body.prompt.length > 100_000) {
          const invalid = jsonResponse({ error: "prompt must be less than 100,000 characters." }, 400);
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
        } catch (listError) {
          console.warn(`[agentarena] Failed to list adhoc taskpacks: ${listError instanceof Error ? listError.message : String(listError)}`);
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
        } catch (unlinkError) {
          const code = (unlinkError as NodeJS.ErrnoException).code;
          const status = code === "EACCES" || code === "EPERM" ? 403 : 404;
          const message = code === "EACCES" || code === "EPERM" ? "Permission denied." : "Adhoc taskpack not found.";
          const payload = jsonResponse({ error: message }, status);
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
        // Mutex guard: In Node.js's single-threaded event loop, the check and assignment
        // below are atomic within a single synchronous block. However, the await for
        // readRequestBody() yields control, during which another request could pass the
        // activeRun check. We use the runStarting flag set synchronously before any await
        // to prevent this race condition.
        if (activeRun || runStarting) {
          const payload = jsonResponse({ error: "A benchmark run is already in progress." }, 409);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
          return;
        }
        // Synchronously acquire the mutex before any async operations
        runStarting = true;

        let rawBody: string;
        try {
          rawBody = await readRequestBody(request);
        } catch (readError) {
          runStarting = false;
          throw readError;
        }
        let runPayload: UiRunPayload;
        try {
          runPayload = JSON.parse(rawBody) as UiRunPayload;
        } catch {
          runStarting = false;
          const invalid = jsonResponse({ error: "Invalid JSON in request body." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        if (!runPayload.repoPath || typeof runPayload.repoPath !== "string") {
          runStarting = false;
          const invalid = jsonResponse({ error: "repoPath is required and must be a string." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        if (!runPayload.taskPath || typeof runPayload.taskPath !== "string") {
          runStarting = false;
          const invalid = jsonResponse({ error: "taskPath is required and must be a string." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        const selections = normalizeUiSelections(runPayload);
        if (selections.length === 0) {
          runStarting = false;
          const invalid = jsonResponse({ error: "At least one agent selection is required." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        if (runPayload.maxConcurrency !== undefined) {
          const parsed = Number(runPayload.maxConcurrency);
          if (!Number.isFinite(parsed) || parsed < 1) {
            runStarting = false;
            const invalid = jsonResponse({ error: "maxConcurrency must be a positive integer." }, 400);
            response.writeHead(invalid.statusCode, invalid.headers);
            response.end(invalid.body);
            return;
          }
        }
        if (runPayload.tokenBudget !== undefined) {
          const parsed = Number(runPayload.tokenBudget);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            runStarting = false;
            const invalid = jsonResponse({ error: "tokenBudget must be a positive number." }, 400);
            response.writeHead(invalid.statusCode, invalid.headers);
            response.end(invalid.body);
            return;
          }
        }

        const resolvedRepoPath = path.resolve(runPayload.repoPath);
        const resolvedTaskPath = path.resolve(runPayload.taskPath);
        const cwd = process.cwd();

        if (!resolvedRepoPath.startsWith(cwd + path.sep) && resolvedRepoPath !== cwd) {
          runStarting = false;
          const forbidden = jsonResponse({ error: "repoPath must be within the current working directory." }, 400);
          response.writeHead(forbidden.statusCode, forbidden.headers);
          response.end(forbidden.body);
          return;
        }

        if (!resolvedTaskPath.startsWith(cwd + path.sep) && resolvedTaskPath !== cwd) {
          runStarting = false;
          const forbidden = jsonResponse({ error: "taskPath must be within the current working directory." }, 400);
          response.writeHead(forbidden.statusCode, forbidden.headers);
          response.end(forbidden.body);
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
          // Mutex is now transferred to activeRun; clear the starting flag
          runStarting = false;
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
              tokenBudget: runPayload.tokenBudget ? (Number(runPayload.tokenBudget) || undefined) : undefined,
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
            if (activeRunStatus.state !== "cancelling" && activeRunStatus.state !== "cancelled") {
              activeRunStatus = { ...activeRunStatus, state: "done" };
            }
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
        activeRunStatus = { ...activeRunStatus, state: "cancelling" };
        activeRun = null;
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
            "Cache-Control": "no-store",
            "X-Frame-Options": "DENY",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin"
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
      const message = statusCode >= 500 ? "Internal server error" : (error instanceof Error ? error.message : String(error));
      const payload = jsonResponse({ error: message }, statusCode);
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
  const authTokenFilePath = path.join(process.cwd(), ".agentarena", "last-auth-token");
  await fs.mkdir(path.dirname(authTokenFilePath), { recursive: true });
  await fs.writeFile(authTokenFilePath, authToken, "utf8");
  console.log(`auth_token=${authToken}`);
  console.log(`auth_token_file=${authTokenFilePath}`);
  if (!isLocalhost) {
    console.log(`\n  Non-localhost access requires authentication.`);
    console.log(`  Open in browser: http://${host}:${port}#token=${authToken}`);
    console.log(`  Token saved to: ${authTokenFilePath}\n`);
  } else {
    console.log(`  WARNING: This token grants full API access. Do not share it.`);
  }

  if (!parsed.noOpen) {
    await maybeOpenBrowser(url);
  }

  await new Promise<void>((resolve) => {
    const closeServer = () => {
      clearInterval(rateLimitCleanupInterval);
      server.close(() => resolve());
    };

    process.once("SIGINT", closeServer);
    process.once("SIGTERM", closeServer);
  });
}