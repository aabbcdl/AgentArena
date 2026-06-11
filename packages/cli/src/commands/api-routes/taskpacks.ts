/**
 * Taskpack-related route handlers: create adhoc, list adhoc, delete adhoc, list official, check compatibility.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { logger, validateTaskPackId } from "@agentarena/core";
import { checkTaskCompatibility } from "@agentarena/runner";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { jsonResponse } from "../../server/index.js";
import {
  createAdhocLintCommand,
  createAdhocTestCommand,
  createPackageScriptCommand,
} from "../../templates.js";
import { validateRunPayload } from "../run-payload-validator.js";
import type { ParsedAdhocTaskPackFile } from "../shared.js";
import type { ApiResponse } from "./types.js";

async function listOfficialTaskPacks() {
  return import("../init.js").then(mod => mod.listOfficialTaskPacks());
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
      } catch { /* intentional: file may not exist -- skip detector */ }
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
    logger.warn("server", "adhoc.list_failed", `Failed to list adhoc taskpacks: ${listError instanceof Error ? listError.message : String(listError)}`);
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
