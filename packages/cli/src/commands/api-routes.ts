/**
 * API route handlers for the UI server.
 *
 * Each handler is a pure function that receives request data and returns
 * a response object, making it independently testable without starting
 * an HTTP server.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  deleteClaudeProviderProfile,
  detectInstalledAgents,
  listAvailableAdapters,
  listClaudeProviderProfiles,
  listInstallGuides,
  preflightAdapters,
  probeAuthConfig,
  saveClaudeProviderProfile,
  setClaudeProviderProfileSecret,
} from "@agentarena/adapters";
import {
  type ClaudeProviderProfile,
  createAgentSelection,
  logger,
  metrics,
  validateTaskPackId,
} from "@agentarena/core";
import { checkTaskCompatibility } from "@agentarena/runner";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { jsonResponse } from "../server.js";
import { validateRunPayload } from "./run-payload-validator.js";

/**
 * Wrap an API handler with structured error logging and a safe error envelope.
 *
 * The envelope distinguishes:
 *   - Known errors (HttpError, ENOENT, validation failures) → propagate the
 *     message and a sensible status code so the SPA can show actionable text.
 *   - Unknown errors → log internally with the full error, return a generic
 *     "Internal server error" to avoid leaking implementation details or PII.
 */
export async function withErrorHandling(promise: Promise<ApiResponse>): Promise<ApiResponse> {
  try {
    return await promise;
  } catch (error) {
    const errnoCode = (error as NodeJS.ErrnoException | undefined)?.code;
    const rawMessage = error instanceof Error ? error.message : String(error);

    // Validation-shaped errors thrown by handlers (these throw plain Error
    // with a user-facing message). Surface them as 400 so the SPA can render.
    // Catches both explicit ValidationError and task pack validation errors
    // which use plain Error with descriptive messages.
    const isValidationError =
      (error instanceof Error && error.name === "ValidationError") ||
      rawMessage.includes("Unsupported task pack schema") ||
      rawMessage.includes("Unsupported judge type") ||
      rawMessage.includes("Unrecognized judge field") ||
      rawMessage.includes("Task pack ID must") ||
      rawMessage.includes("must be a string") ||
      rawMessage.includes("must be an array") ||
      rawMessage.includes("must be a positive integer");
    if (isValidationError) {
      logger.warn("server", "api.validation_failed", `Validation failed: ${rawMessage}`);
      return jsonResponse({ error: rawMessage }, 400);
    }

    // Not-found errors from file lookups (taskpack file, profile, etc).
    if (errnoCode === "ENOENT") {
      logger.info("server", "api.not_found", `Resource not found: ${rawMessage}`);
      return jsonResponse({ error: rawMessage }, 404);
    }

    // Permission / unreadable resource — operator-actionable.
    if (errnoCode === "EACCES" || errnoCode === "EPERM") {
      logger.warn("server", "api.permission_denied", `Permission denied: ${rawMessage}`, { error });
      return jsonResponse({ error: rawMessage }, 403);
    }

    // Truly unexpected — log full error context, return a sanitized envelope.
    logger.error("server", "api.unexpected_error", `Unhandled API error: ${rawMessage}`, { error });
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

import {
  createAdhocLintCommand,
  createAdhocTestCommand,
  createPackageScriptCommand,
} from "../templates.js";
import type { ParsedAdhocTaskPackFile } from "./shared.js";
import { OFFICIAL_TASKPACK_ROOT } from "./shared.js";

// ─── Types ───

export interface ApiResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export interface ProviderProfilePayload {
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

// ─── Helpers ───

export function validateProviderProfilePayload(payload: ProviderProfilePayload): string | null {
  if (!payload.name?.trim()) return "name is required.";
  if (!payload.kind?.trim()) return "kind is required (e.g. 'official', 'anthropic-compatible', 'openai-proxy').";
  if (!payload.apiFormat?.trim()) return "apiFormat is required (e.g. 'anthropic-messages', 'openai-chat-via-proxy').";
  return null;
}

/**
 * Mask sensitive extraEnv values in profile list responses.
 */
export function maskProfileExtraEnv(profiles: ClaudeProviderProfile[]): unknown[] {
  return profiles.map(({ extraEnv, ...rest }: ClaudeProviderProfile) => ({
    ...rest,
    extraEnv: extraEnv ? Object.fromEntries(Object.keys(extraEnv as Record<string, unknown>).map(k => [k, "***"])) : undefined
  }));
}

async function listOfficialTaskPacks() {
  return import("./init.js").then(mod => mod.listOfficialTaskPacks());
}

// ─── Route Handlers ───

export async function handleUiInfo(codexDefaults: unknown, host: string, port: number, isLocalhost: boolean): Promise<ApiResponse> {
  const providerProfiles = await listClaudeProviderProfiles();
  return jsonResponse({
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
    riskNotice: providerProfiles.some((p) => p.kind !== "official")
      ? "Provider-switched Claude Code variants use compatibility settings and may behave differently from official Claude Code."
      : null,
    host,
    port,
    authRequired: !isLocalhost
  });
}

export async function handleAdaptersList(): Promise<ApiResponse> {
  const adapters = listAvailableAdapters().map((adapter) => ({
    id: adapter.id,
    title: adapter.title,
    kind: adapter.kind,
    capability: adapter.capability
  }));
  return jsonResponse(adapters);
}

export async function handlePreflight(rawBody: string): Promise<ApiResponse> {
  let body: { baseAgentId?: string; displayLabel?: string; config?: { model?: string; reasoningEffort?: string; providerProfileId?: string } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON." }, 400);
  }
  if (!body.baseAgentId) {
    return jsonResponse({ error: "Missing baseAgentId." }, 400);
  }
  try {
    const selection = createAgentSelection({
      baseAgentId: body.baseAgentId,
      displayLabel: body.displayLabel,
      config: body.config,
      configSource: "ui"
    });
    const results = await preflightAdapters([selection], { probeAuth: true });
    const result = results[0];
    
    metrics.preflightTotal.inc({ status: result.status, agentId: body.baseAgentId });
    logger.info("server", "preflight.check", `Preflight check completed for ${body.baseAgentId}`, {
      metadata: { status: result.status, agentId: body.baseAgentId }
    });
    
    return jsonResponse(result);
  } catch (err: unknown) {
    metrics.preflightTotal.inc({ status: "error", agentId: body.baseAgentId });
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("server", "preflight.error", "Preflight check failed", {
      metadata: { agentId: body.baseAgentId },
      error: err
    });
    return jsonResponse({ status: "error", error: errorMessage }, 500);
  }
}

/**
 * Quick preflight — fast CLI + auth config check without network calls.
 * Returns in ~2 seconds instead of ~60 seconds.
 */
export async function handleQuickPreflight(rawBody: string): Promise<ApiResponse> {
  let body: { baseAgentId?: string; displayLabel?: string; config?: { model?: string; reasoningEffort?: string; providerProfileId?: string } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON." }, 400);
  }
  if (!body.baseAgentId) {
    return jsonResponse({ error: "Missing baseAgentId." }, 400);
  }
  try {
    const selection = createAgentSelection({
      baseAgentId: body.baseAgentId,
      displayLabel: body.displayLabel,
      config: body.config,
      configSource: "ui"
    });
    const [preflight] = await preflightAdapters([selection], { probeAuth: false });
    const command = preflight?.command ?? body.baseAgentId;
    const authResult = await probeAuthConfig({
      command,
      argsPrefix: [],
      displayCommand: command
    });

    let overallStatus: "ready" | "warning" | "blocked" = "ready";
    if (!preflight || preflight.status === "missing") {
      overallStatus = "blocked";
    } else if (!authResult.configured) {
      overallStatus = "warning";
    }

    const result = {
      cliExists: !!preflight && preflight.status !== "missing",
      cliVersion: preflight?.resolvedRuntime?.effectiveAgentVersion,
      authConfigured: authResult.configured,
      authHint: authResult.hint,
      overallStatus,
      command,
      summary: preflight?.summary
    };

    logger.info("server", "quick-preflight.check", `Quick preflight for ${body.baseAgentId}`, {
      metadata: { ...result, agentId: body.baseAgentId }
    });
    return jsonResponse(result);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("server", "quick-preflight.error", "Quick preflight failed", {
      metadata: { agentId: body.baseAgentId },
      error: err
    });
    return jsonResponse({ error: errorMessage }, 500);
  }
}

export async function handleProviderProfilesGet(): Promise<ApiResponse> {
  const profiles = await listClaudeProviderProfiles();
  return jsonResponse(maskProfileExtraEnv(profiles));
}

export async function handleProviderProfileCreate(rawBody: string): Promise<ApiResponse> {
  let payload: ProviderProfilePayload;
  try {
    payload = JSON.parse(rawBody) as ProviderProfilePayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  const validationError = validateProviderProfilePayload(payload);
  if (validationError) {
    return jsonResponse({ error: validationError }, 400);
  }
  const profile = await saveClaudeProviderProfile(payload);
  if (payload.secret?.trim()) {
    try {
      await setClaudeProviderProfileSecret(profile.id, payload.secret);
    } catch (secretError) {
      await deleteClaudeProviderProfile(profile.id).catch(() => {});
      return jsonResponse({ error: `Profile created but secret storage failed: ${secretError instanceof Error ? secretError.message : String(secretError)}` }, 500);
    }
  }
  const profiles = await listClaudeProviderProfiles();
  return jsonResponse({
    profile: profiles.find((entry) => entry.id === profile.id),
    profiles
  });
}

function validateProfileId(profileId: string): string | null {
  if (!profileId || typeof profileId !== "string") return "Profile ID is required.";
  if (profileId.length > 128) return "Profile ID too long (max 128 characters).";
  if (!/^[a-zA-Z0-9_-]+$/.test(profileId)) return "Profile ID may only contain alphanumeric characters, hyphens, and underscores.";
  return null;
}

export async function handleProviderProfileUpdate(profileId: string, rawBody: string): Promise<ApiResponse> {
  const profileIdError = validateProfileId(profileId);
  if (profileIdError) return jsonResponse({ error: profileIdError }, 400);

  let payload: ProviderProfilePayload;
  try {
    payload = JSON.parse(rawBody) as ProviderProfilePayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  const validationError = validateProviderProfilePayload(payload);
  if (validationError) {
    return jsonResponse({ error: validationError }, 400);
  }
  const profile = await saveClaudeProviderProfile({
    ...payload,
    id: profileId
  });
  const profiles = await listClaudeProviderProfiles();
  return jsonResponse({
    profile: profiles.find((entry) => entry.id === profile.id),
    profiles
  });
}

export async function handleProviderProfileDelete(profileId: string): Promise<ApiResponse> {
  const profileIdError = validateProfileId(profileId);
  if (profileIdError) return jsonResponse({ error: profileIdError }, 400);
  try {
    await deleteClaudeProviderProfile(profileId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /cannot be deleted/i.test(message) ? 403 : 400;
    return jsonResponse({ error: message }, status);
  }
  const profiles = await listClaudeProviderProfiles();
  return jsonResponse({ profiles });
}

export async function handleProviderProfileSecret(profileId: string, rawBody: string): Promise<ApiResponse> {
  const profileIdError = validateProfileId(profileId);
  if (profileIdError) return jsonResponse({ error: profileIdError }, 400);

  let payload: { secret?: string };
  try {
    payload = JSON.parse(rawBody) as { secret?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  if (payload.secret && payload.secret.length > 10000) {
    return jsonResponse({ error: "secret must be less than 10,000 characters." }, 400);
  }
  await setClaudeProviderProfileSecret(profileId, payload.secret ?? "");
  const profiles = await listClaudeProviderProfiles();
  return jsonResponse({
    profile: profiles.find((entry) => entry.id === profileId),
    profiles
  });
}

export async function handleCreateAdhocTaskpack(rawBody: string): Promise<ApiResponse> {
  let body: { prompt: string; title?: string };
  try {
    body = JSON.parse(rawBody) as { prompt: string; title?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  if (!body.prompt?.trim()) {
    return jsonResponse({ error: "prompt is required." }, 400);
  }
  if (body.prompt.length > 100_000) {
    return jsonResponse({ error: "prompt must be less than 100,000 characters." }, 400);
  }
  // Strip control characters (except newline, carriage return, tab) to prevent
  // YAML injection and terminal escape sequence attacks
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control character filtering for security
  const sanitizedPrompt = body.prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  if (body.title && body.title.length > 500) {
    return jsonResponse({ error: "title must be less than 500 characters." }, 400);
  }
  if (body.title && /[<>"'&]/.test(body.title)) {
    return jsonResponse({ error: "title must not contain HTML-significant characters (<, >, \", ', &)." }, 400);
  }
  const adhocDir = path.join(process.cwd(), ".agentarena", "adhoc-taskpacks");
  await fs.mkdir(adhocDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const adhocTitle = body.title?.trim() || `Adhoc Task ${timestamp}`;
  const adhocId = `adhoc-${timestamp}`;

  // Detect project language based on file presence
  const cwd = process.cwd();
  const languageDetectors: Array<{ lang: string; files: string[] }> = [
    { lang: "node-js", files: ["package.json"] },
    { lang: "python", files: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"] },
    { lang: "go", files: ["go.mod"] },
    { lang: "rust", files: ["Cargo.toml"] },
    { lang: "ruby", files: ["Gemfile"] },
  ];
  let detectedLang = "generic";
  for (const detector of languageDetectors) {
    for (const file of detector.files) {
      try {
        await fs.access(path.join(cwd, file));
        detectedLang = detector.lang;
        break;
      } catch { /* intentional: file may not exist — skip detector */ }
    }
    if (detectedLang !== "generic") break;
  }

  const testReportFile = `.agentarena/${adhocId}-test-results.json`;
  const lintReportFile = `.agentarena/${adhocId}-lint-results.json`;

  // Generate language-specific judges
  const languageJudges: Record<string, Array<Record<string, unknown>>> = {
    "node-js": [
      { id: "repo-not-broken", type: "file-exists", label: "Node package manifest still exists", path: "package.json" },
      { id: "readme-exists", type: "file-exists", label: "Repository README still exists", path: "README.md" },
      { id: "build-passes", type: "command", label: "Node project still builds", command: createPackageScriptCommand("build"), timeoutMs: 120000 },
      { id: "tests-pass", type: "test-result", label: "Node tests still pass", command: createAdhocTestCommand(testReportFile), format: "auto", reportFile: testReportFile, timeoutMs: 120000 },
      { id: "lint-clean", type: "lint-check", label: "Node lint stays clean", command: createAdhocLintCommand(lintReportFile), format: "auto", reportFile: lintReportFile, maxWarnings: 0, timeoutMs: 120000 }
    ],
    "python": [
      { id: "repo-not-broken", type: "file-exists", label: "Python project files exist", path: "pyproject.toml" },
      { id: "readme-exists", type: "file-exists", label: "Repository README still exists", path: "README.md" },
      { id: "tests-pass", type: "command", label: "Python tests pass", command: "python -m pytest --tb=short -q", timeoutMs: 120000 },
      { id: "lint-clean", type: "command", label: "Python lint clean", command: "python -m flake8 --max-line-length=120 --ignore=E501,W503", timeoutMs: 60000 }
    ],
    "go": [
      { id: "repo-not-broken", type: "file-exists", label: "Go module file exists", path: "go.mod" },
      { id: "readme-exists", type: "file-exists", label: "Repository README still exists", path: "README.md" },
      { id: "build-passes", type: "command", label: "Go build passes", command: "go build ./...", timeoutMs: 120000 },
      { id: "tests-pass", type: "command", label: "Go tests pass", command: "go test -v ./...", timeoutMs: 120000 },
      { id: "vet-clean", type: "command", label: "Go vet clean", command: "go vet ./...", timeoutMs: 60000 }
    ],
    "rust": [
      { id: "repo-not-broken", type: "file-exists", label: "Cargo.toml exists", path: "Cargo.toml" },
      { id: "readme-exists", type: "file-exists", label: "Repository README still exists", path: "README.md" },
      { id: "build-passes", type: "command", label: "Cargo build passes", command: "cargo build", timeoutMs: 300000 },
      { id: "tests-pass", type: "command", label: "Cargo tests pass", command: "cargo test", timeoutMs: 300000 },
      { id: "clippy-clean", type: "command", label: "Clippy clean", command: "cargo clippy -- -D warnings", timeoutMs: 120000 }
    ],
    "ruby": [
      { id: "repo-not-broken", type: "file-exists", label: "Gemfile exists", path: "Gemfile" },
      { id: "readme-exists", type: "file-exists", label: "Repository README still exists", path: "README.md" },
      { id: "build-passes", type: "command", label: "Bundle install passes", command: "bundle install --jobs=4", timeoutMs: 120000 },
      { id: "tests-pass", type: "command", label: "Ruby tests pass", command: "bundle exec rake test", timeoutMs: 120000 },
      { id: "lint-clean", type: "command", label: "Rubocop clean", command: "bundle exec rubocop --format=quiet", timeoutMs: 60000 }
    ],
    "generic": [
      { id: "readme-exists", type: "file-exists", label: "Repository README still exists", path: "README.md" }
    ]
  };

  const judges = languageJudges[detectedLang] ?? languageJudges.generic;
  const repoTypeLabel = detectedLang === "node-js" ? "node-js" : detectedLang;

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
      repoTypes: [repoTypeLabel],
      tags: ["adhoc", "custom", detectedLang],
      dependencies: [],
      judgeRationale: `These default checks assume a ${detectedLang} repository with appropriate build, test, and lint commands.`
    },
    prompt: sanitizedPrompt,
    judges
  }, { lineWidth: 0 });
  const adhocPath = path.join(adhocDir, `${adhocId}.yaml`);
  await fs.writeFile(adhocPath, yamlContent, "utf8");
  return jsonResponse({ path: adhocPath, id: adhocId, title: adhocTitle });
}

export async function handleAdhocTaskpacksList(): Promise<ApiResponse> {
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
    return jsonResponse(items);
  } catch (listError) {
    console.warn(`[agentarena] Failed to list adhoc taskpacks: ${listError instanceof Error ? listError.message : String(listError)}`);
    return jsonResponse([]);
  }
}

export async function handleAdhocTaskpackDelete(adhocId: string): Promise<ApiResponse> {
  if (!validateTaskPackId(adhocId)) {
    return jsonResponse({ error: "Invalid adhoc taskpack ID." }, 400);
  }
  const adhocDir = path.resolve(process.cwd(), ".agentarena", "adhoc-taskpacks");
  const filePath = path.resolve(adhocDir, `${adhocId}.yaml`);
  if (!filePath.startsWith(adhocDir + path.sep) && filePath !== adhocDir) {
    return jsonResponse({ error: "Invalid adhoc taskpack ID." }, 400);
  }
  try {
    await fs.unlink(filePath);
    return jsonResponse({ deleted: true, id: adhocId });
  } catch (unlinkError) {
    const code = (unlinkError as NodeJS.ErrnoException).code;
    const status = code === "EACCES" || code === "EPERM" ? 403 : 404;
    const message = code === "EACCES" || code === "EPERM" ? "Permission denied." : "Adhoc taskpack not found.";
    return jsonResponse({ error: message }, status);
  }
}

export async function handleTaskpacksList(): Promise<ApiResponse> {
  const taskPacks = await listOfficialTaskPacks();
  return jsonResponse(taskPacks);
}

// ─── Agent Detection & Install Guides ───

/**
 * GET /api/agent-detection
 *
 * Returns detection results for all registered adapters: whether each CLI
 * is installed, its version, config file status, and install instructions.
 * Uses the EchoBird-inspired `detectInstalledAgents()` function.
 */
export async function handleAgentDetection(): Promise<ApiResponse> {
  try {
    const results = await detectInstalledAgents();
    return jsonResponse(results);
  } catch (error) {
    logger.error("server", "agent_detection.error", "Agent detection failed", { error });
    return jsonResponse({ error: "Agent detection failed." }, 500);
  }
}

/**
 * GET /api/install-guides
 *
 * Returns all install guide definitions so the frontend can render
 * install instructions for uninstalled agents without additional requests.
 */
export async function handleInstallGuides(): Promise<ApiResponse> {
  return jsonResponse(listInstallGuides());
}

/**
 * POST /api/check-compatibility
 *
 * Checks whether a task pack is compatible with the given repository.
 * Returns compatibility status and individual check results.
 */
export async function handleCheckCompatibility(rawBody: string): Promise<ApiResponse> {
  let body: { taskPath?: unknown; repoPath?: unknown };
  try {
    body = JSON.parse(rawBody) as { taskPath?: unknown; repoPath?: unknown };
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  const validationError = validateRunPayload(body as { repoPath: string; taskPath: string });
  if (validationError) {
    return jsonResponse({ error: validationError }, 400);
  }

  try {
    const { loadTaskPack } = await import("@agentarena/taskpacks");
    const taskPath = path.resolve(body.taskPath as string);
    const repoPath = path.resolve(body.repoPath as string);
    const taskPack = await loadTaskPack(taskPath);
    const result = await checkTaskCompatibility(taskPack, repoPath);
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("server", "compatibility.check_failed", `Compatibility check failed: ${message}`);
    return jsonResponse({ error: message }, 400);
  }
}
