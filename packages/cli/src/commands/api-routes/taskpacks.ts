/**
 * Taskpack-related route handlers: create adhoc, list adhoc, delete adhoc, list official, check compatibility.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { isPathInsideWorkspace, logger, validateTaskPackId } from "@agentarena/core";
import { checkTaskCompatibility } from "@agentarena/runner";
import { loadTaskPack } from "@agentarena/taskpacks";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { jsonResponse } from "../../server/index.js";
import {
  createAdhocLintCommand,
  createAdhocTestCommand,
  createPackageScriptCommand,
} from "../../templates.js";
import { validateRunPayload } from "../run-payload-validator.js";
import { OFFICIAL_TASKPACK_ROOT, type ParsedAdhocTaskPackFile } from "../shared.js";
import type { ApiResponse } from "./types.js";

async function listOfficialTaskPacks() {
  return import("../init.js").then(mod => mod.listOfficialTaskPacks());
}

const MAX_EXPECTED_CHANGED_PATHS = 100;
const MAX_EXPECTED_CHANGED_PATH_LENGTH = 500;
const PROTECTED_PATH_SEGMENTS = new Set([
  ".agentarena",
  ".aws",
  ".git",
  ".ssh",
  "credentials",
  "node_modules",
  "secrets",
]);

type AdhocCheckKind = "build" | "test" | "lint" | "generic";

interface AdhocTaskpackRequest {
  prompt?: unknown;
  title?: unknown;
  repoPath?: unknown;
  expectedChangedPaths?: unknown;
}

interface AdhocTaskpackWarning {
  code: "missing-expected-paths" | "basic-generated-checks" | "compatibility-warning" | "compatibility-failed";
  message: string;
}

interface AdhocRepositoryTarget {
  repoPath: string;
  storedPath: string;
}

function protectedPathReason(relativePath: string): string | null {
  const segments = relativePath.split(/[\\/]+/u).filter(Boolean);
  if (segments.some((segment) => segment === "..")) return "must not contain '..' path traversal segments.";
  if (segments.some((segment) => PROTECTED_PATH_SEGMENTS.has(segment.toLowerCase()))) {
    return "must not target protected project or credential directories.";
  }
  if (segments.some((segment) => /^\.env(?:\.|$)/u.test(segment.toLowerCase()))) {
    return "must not target environment or secret files.";
  }
  return null;
}

function normalizeExpectedChangedPaths(value: unknown): { paths?: string[]; error?: string } {
  if (value === undefined) return { paths: [] };
  if (!Array.isArray(value)) return { error: "expectedChangedPaths must be an array of repository-relative paths." };
  if (value.length > MAX_EXPECTED_CHANGED_PATHS) {
    return { error: `expectedChangedPaths must contain at most ${MAX_EXPECTED_CHANGED_PATHS} paths.` };
  }

  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return { error: "Every expectedChangedPaths entry must be a string." };
    const candidate = entry.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
    if (!candidate) return { error: "expectedChangedPaths entries must not be empty." };
    if (candidate.length > MAX_EXPECTED_CHANGED_PATH_LENGTH) {
      return { error: `Each expectedChangedPaths entry must be at most ${MAX_EXPECTED_CHANGED_PATH_LENGTH} characters.` };
    }
    if (
      candidate.startsWith("/") ||
      path.posix.isAbsolute(candidate) ||
      /^[a-z]:[\\/]/iu.test(candidate) ||
      candidate.startsWith("~") ||
      candidate.includes("\0")
    ) {
      return { error: "expectedChangedPaths entries must be repository-relative paths, not absolute paths." };
    }
    const protectedReason = protectedPathReason(candidate);
    if (protectedReason) return { error: `expectedChangedPaths entry "${candidate}" ${protectedReason}` };
    if (candidate === ".") return { error: "expectedChangedPaths must identify files or file globs, not the repository root." };
    if (candidate.startsWith("!")) return { error: "expectedChangedPaths does not support negated globs." };
    if (!normalized.includes(candidate)) normalized.push(candidate);
  }
  return { paths: normalized };
}

async function resolveAdhocRepositoryTarget(
  input: unknown,
  workspaceRoot: string
): Promise<{ target?: AdhocRepositoryTarget; error?: string }> {
  if (input !== undefined && typeof input !== "string") {
    return { error: "repoPath is required and must be a string when provided." };
  }
  const rawPath = typeof input === "string" && input.trim() ? input.trim() : workspaceRoot;
  const repoPath = path.resolve(workspaceRoot, rawPath);
  if (!(await isPathInsideWorkspace(workspaceRoot, repoPath))) {
    return { error: "repoPath must be within the current workspace." };
  }
  const storedPath = path.relative(path.resolve(workspaceRoot), repoPath).replaceAll(path.sep, "/") || ".";
  const protectedReason = protectedPathReason(storedPath);
  if (protectedReason) return { error: `repoPath ${protectedReason}` };
  try {
    const stat = await fs.stat(repoPath);
    if (!stat.isDirectory()) return { error: "repoPath must point to a directory." };
  } catch {
    return { error: "repoPath must point to an existing directory." };
  }
  return { target: { repoPath, storedPath } };
}

function checkKind(judge: Record<string, unknown>): AdhocCheckKind {
  const type = typeof judge.type === "string" ? judge.type : "";
  const id = typeof judge.id === "string" ? judge.id : "";
  const command = typeof judge.command === "string" ? judge.command : "";
  if (type === "test-result" || /test/u.test(id) || /\btest\b/u.test(command)) return "test";
  if (type === "lint-check" || /lint/u.test(id) || /lint/u.test(command)) return "lint";
  if (/build|compile|cargo check|go build/u.test(`${id} ${command}`)) return "build";
  return "generic";
}

function generatedChecks(judges: Array<Record<string, unknown>>) {
  return judges.map((judge) => ({
    kind: checkKind(judge),
    label: typeof judge.label === "string" ? judge.label : "Generated repository check",
    ...(typeof judge.command === "string" ? { command: judge.command } : {}),
    strength: "basic" as const,
  }));
}

function compatibilityPreview(result: Awaited<ReturnType<typeof checkTaskCompatibility>>) {
  const failedChecks = result.checks.filter((check) => check.status !== "pass");
  return {
    status: result.status,
    reasons: failedChecks.length > 0
      ? failedChecks.map((check) => `${check.label}: ${check.message}`)
      : [result.summary],
  };
}

function warningList(
  expectedChangedPaths: string[],
  compatibility: Awaited<ReturnType<typeof checkTaskCompatibility>>
): AdhocTaskpackWarning[] {
  const warnings: AdhocTaskpackWarning[] = [];
  if (expectedChangedPaths.length === 0) {
    warnings.push({
      code: "missing-expected-paths",
      message: "Expected changed paths were not provided; change scope is not precisely constrained.",
    });
  }
  warnings.push({
    code: "basic-generated-checks",
    message: "Generated checks provide basic repository-health evidence, not task-specific correctness validation.",
  });
  if (compatibility.status === "warning") {
    warnings.push({ code: "compatibility-warning", message: compatibility.summary });
  } else if (compatibility.status === "incompatible") {
    warnings.push({ code: "compatibility-failed", message: compatibility.summary });
  }
  return warnings;
}

export async function handleCreateAdhocTaskpack(
  rawBody: string,
  workspaceRoot = process.cwd()
): Promise<ApiResponse> {
  let body: AdhocTaskpackRequest;
  try {
    body = JSON.parse(rawBody) as AdhocTaskpackRequest;
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    return jsonResponse({ error: "prompt is required." }, 400);
  }
  if (body.prompt.length > 100_000) {
    return jsonResponse({ error: "prompt must be less than 100,000 characters." }, 400);
  }
  // Strip control characters (except newline, carriage return, tab) to prevent
  // YAML injection and terminal escape sequence attacks.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control character filtering for security
  const sanitizedPrompt = body.prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  if (body.title !== undefined && typeof body.title !== "string") {
    return jsonResponse({ error: "title must be a string when provided." }, 400);
  }
  if (typeof body.title === "string" && body.title.length > 500) {
    return jsonResponse({ error: "title must be less than 500 characters." }, 400);
  }
  if (typeof body.title === "string" && body.title && /[<>"'&]/.test(body.title)) {
    return jsonResponse({ error: "title must not contain HTML-significant characters (<, >, \", ', &)." }, 400);
  }

  const repository = await resolveAdhocRepositoryTarget(body.repoPath, workspaceRoot);
  if (!repository.target) return jsonResponse({ error: repository.error }, 400);
  const changedPaths = normalizeExpectedChangedPaths(body.expectedChangedPaths);
  if (!changedPaths.paths) return jsonResponse({ error: changedPaths.error }, 400);

  const adhocDir = path.join(workspaceRoot, ".agentarena", "adhoc-taskpacks");
  await fs.mkdir(adhocDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").toLowerCase();
  const adhocTitle = (typeof body.title === "string" ? body.title.trim() : "") || `Adhoc Task ${timestamp}`;
  const adhocId = `adhoc-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

  // Detect project language from the selected repository, never from the
  // AgentArena service's own working directory.
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
        await fs.access(path.join(repository.target.repoPath, file));
        detectedLang = detector.lang;
        break;
      } catch { /* intentional: file may not exist -- skip detector */ }
    }
    if (detectedLang !== "generic") break;
  }

  const testReportFile = `.agentarena/${adhocId}-test-results.json`;
  const lintReportFile = `.agentarena/${adhocId}-lint-results.json`;

  // These are deliberately generic repository-health judges. They are useful
  // as basic evidence, but never claim to validate the natural-language task.
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
      lifecycle: "experimental",
      difficulty: "medium",
      objective: "Execute the user-provided prompt and collect basic repository-health evidence.",
      repoTypes: [repoTypeLabel],
      tags: ["adhoc", "custom", detectedLang],
      dependencies: [],
      judgeRationale: `These generated checks are basic ${detectedLang} repository-health evidence; they do not prove task-specific business correctness.`,
      adhocRepositoryPath: repository.target.storedPath,
    },
    prompt: sanitizedPrompt,
    repoSource: "user",
    ...(changedPaths.paths.length > 0 ? { expectedChangedPaths: changedPaths.paths } : {}),
    changePolicy: {
      requireAgentChange: true,
      ...(changedPaths.paths.length > 0 ? { allowedPaths: changedPaths.paths } : {}),
    },
    envAllowList: [],
    judges,
  }, { lineWidth: 0 });
  const adhocPath = path.join(adhocDir, `${adhocId}.yaml`);
  await fs.writeFile(adhocPath, yamlContent, "utf8");
  const taskPack = await loadTaskPack(adhocPath);
  const compatibility = await checkTaskCompatibility(taskPack, repository.target.repoPath);
  const warnings = warningList(changedPaths.paths, compatibility);
  return jsonResponse({
    path: adhocPath,
    id: adhocId,
    title: adhocTitle,
    preview: {
      id: adhocId,
      title: adhocTitle,
      prompt: sanitizedPrompt,
      repoPath: repository.target.repoPath,
      repoType: repoTypeLabel,
      source: "adhoc",
      lifecycle: compatibility.status === "compatible" ? "ready" : "draft",
      expectedChangedPaths: changedPaths.paths,
      generatedChecks: generatedChecks(judges),
      warnings: warnings.map((warning) => warning.message),
      warningCodes: warnings.map((warning) => warning.code),
      compatibility: compatibilityPreview(compatibility),
      evidenceStrength: "basic",
    },
  });
}

export async function handleAdhocTaskpacksList(
  queryParams?: URLSearchParams,
  workspaceRoot = process.cwd()
): Promise<ApiResponse> {
  const adhocDir = path.join(workspaceRoot, ".agentarena", "adhoc-taskpacks");
  const requestedRepository = queryParams?.get("repoPath")?.trim();
  try {
    const entries = await fs.readdir(adhocDir, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter((e) => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")))
        .sort((a, b) => b.name.localeCompare(a.name))
        .map(async (e) => {
          const filePath = path.join(adhocDir, e.name);
          const stat = await fs.stat(filePath);
          try {
            const raw = await fs.readFile(filePath, "utf8");
            const parsed = parseYaml(raw) as ParsedAdhocTaskPackFile;
            const taskPack = await loadTaskPack(filePath);
            const storedPath = typeof parsed.metadata?.adhocRepositoryPath === "string"
              ? parsed.metadata.adhocRepositoryPath
              : undefined;
            const target = await resolveAdhocRepositoryTarget(
              requestedRepository ?? storedPath,
              workspaceRoot
            );
            const compatibility = target.target
              ? await checkTaskCompatibility(taskPack, target.target.repoPath)
              : undefined;
            return {
              id: typeof parsed.id === "string" ? parsed.id : e.name,
              title: typeof parsed.title === "string" ? parsed.title : e.name,
              path: filePath,
              createdAt: stat.birthtime.toISOString(),
              promptPreview: String(parsed.prompt ?? "").slice(0, 200),
              repoPath: target.target?.repoPath,
              source: "adhoc",
              lifecycle: "experimental",
              repoSource: "user",
              expectedChangedPaths: taskPack.expectedChangedPaths ?? [],
              evidenceStrength: "basic",
              warningCodes: [
                ...(taskPack.expectedChangedPaths?.length ? [] : ["missing-expected-paths"]),
                "basic-generated-checks",
              ],
              compatibility: compatibility
                ? compatibilityPreview(compatibility)
                : { status: "unknown", reasons: [target.error ?? "Compatibility could not be checked."] },
            };
          } catch {
            return {
              id: e.name.replace(/\.(?:yaml|yml)$/u, ""),
              title: e.name,
              path: filePath,
              createdAt: stat.birthtime.toISOString(),
              promptPreview: "",
              source: "adhoc",
              lifecycle: "experimental",
              repoSource: "user",
              evidenceStrength: "basic",
              warningCodes: ["invalid-taskpack"],
              compatibility: { status: "unknown", reasons: ["Task pack could not be loaded."] },
            };
          }
        })
    );
    return jsonResponse(items);
  } catch (listError) {
    logger.warn("server", "adhoc.list_failed", `Failed to list adhoc taskpacks: ${listError instanceof Error ? listError.message : String(listError)}`);
    return jsonResponse([]);
  }
}

export async function handleAdhocTaskpackDelete(adhocId: string, workspaceRoot = process.cwd()): Promise<ApiResponse> {
  if (!validateTaskPackId(adhocId)) {
    return jsonResponse({ error: "Invalid adhoc taskpack ID." }, 400);
  }
  const adhocDir = path.resolve(workspaceRoot, ".agentarena", "adhoc-taskpacks");
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

export async function handleTaskpacksList(queryParams?: URLSearchParams, workspaceRoot = process.cwd()): Promise<ApiResponse> {
  const taskPacks = await listOfficialTaskPacks();
  const repoPath = queryParams?.get("repoPath")?.trim();

  if (!repoPath) {
    return jsonResponse(taskPacks);
  }

  // Resolve and validate repo path
  const resolvedRepoPath = path.resolve(workspaceRoot, repoPath);
  if (!(await isPathInsideWorkspace(workspaceRoot, resolvedRepoPath))) {
    return jsonResponse(taskPacks);
  }
  try {
    const stat = await fs.stat(resolvedRepoPath);
    if (!stat.isDirectory()) {
      return jsonResponse(taskPacks);
    }
  } catch {
    return jsonResponse(taskPacks);
  }

  // Enrich each task pack with compatibility info
  const enriched = await Promise.all(
    taskPacks.map(async (tp) => {
      try {
        const taskPack = await loadTaskPack(tp.path);
        const result = await checkTaskCompatibility(taskPack, resolvedRepoPath);
        const failedChecks = result.checks
          .filter((c) => c.status !== "pass")
          .map((c) => ({
            label: c.label,
            status: c.status,
            message: c.message,
            fix: c.fix,
          }));
        return {
          ...tp,
          compatibility: {
            status: result.status,
            summary: result.summary,
            failedChecks,
          },
        };
      } catch {
        return {
          ...tp,
          compatibility: {
            status: "unknown" as const,
            summary: "Compatibility check could not be performed.",
            failedChecks: [],
          },
        };
      }
    })
  );

  // Sort: compatible first, then warning, then incompatible, then unknown
  const statusOrder: Record<string, number> = { compatible: 0, warning: 1, incompatible: 2, unknown: 3 };
  enriched.sort((a, b) => {
    const sa = statusOrder[a.compatibility?.status ?? "unknown"] ?? 3;
    const sb = statusOrder[b.compatibility?.status ?? "unknown"] ?? 3;
    return sa - sb;
  });

  return jsonResponse(enriched);
}

/**
 * POST /api/check-compatibility
 *
 * Checks whether a task pack is compatible with the given repository.
 * Returns compatibility status and individual check results.
 */
export async function handleCheckCompatibility(rawBody: string, workspaceRoot = process.cwd()): Promise<ApiResponse> {
  let body: { taskPath?: unknown; repoPath?: unknown };
  try {
    body = JSON.parse(rawBody) as { taskPath?: unknown; repoPath?: unknown };
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  // UI callers normally send absolute paths, but the public route also accepts
  // workspace-relative paths. Resolve those against the configured workspace
  // before validation; path.resolve(value) alone would silently anchor them to
  // the process cwd when --workspace-root points elsewhere.
  const normalizedBody = {
    ...body,
    repoPath: typeof body.repoPath === "string" && body.repoPath.trim()
      ? path.resolve(workspaceRoot, body.repoPath)
      : body.repoPath,
    taskPath: typeof body.taskPath === "string" && body.taskPath.trim()
      ? path.resolve(workspaceRoot, body.taskPath)
      : body.taskPath
  };
  const validationError = validateRunPayload(
    normalizedBody as { repoPath: string; taskPath: string },
    workspaceRoot,
    [workspaceRoot, OFFICIAL_TASKPACK_ROOT]
  );
  if (validationError) {
    return jsonResponse({ error: validationError }, 400);
  }

  try {
    const { loadTaskPack } = await import("@agentarena/taskpacks");
    const taskPath = normalizedBody.taskPath as string;
    const repoPath = normalizedBody.repoPath as string;

    // SECURITY: contain both paths to the current working directory to prevent
    // the server from reading/validating arbitrary filesystem locations
    // (path-traversal). Mirrors the guards in validateRunPayload.
    if (!(await isPathInsideWorkspace(workspaceRoot, taskPath))) {
      return jsonResponse({ error: "Task path is outside the allowed workspace." }, 400);
    }
    if (!(await isPathInsideWorkspace(workspaceRoot, repoPath))) {
      return jsonResponse({ error: "Repository path is outside the allowed workspace." }, 400);
    }

    const taskPack = await loadTaskPack(taskPath);
    const result = await checkTaskCompatibility(taskPack, repoPath);
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("server", "compatibility.check_failed", `Compatibility check failed: ${message}`);
    return jsonResponse({ error: message }, 400);
  }
}
