/**
 * Task pack compatibility checker.
 *
 * Validates whether a task pack's requirements are satisfied by the user's
 * repository before spending agent/model time. Hard mismatches are reported as
 * incompatible so they do not become misleading agent scores.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  TaskCompatibilityCheck,
  TaskCompatibilityResult,
  TaskPack,
} from "@agentarena/core";

export type CompatibilityCheck = TaskCompatibilityCheck;
export type CompatibilityCheckResult = TaskCompatibilityResult;

const NODE_REPO_TYPES = new Set(["node", "node-js", "javascript", "typescript", "react", "nextjs", "frontend", "npm"]);
const PYTHON_REPO_TYPES = new Set(["python", "fastapi", "flask", "django", "pip"]);
const GO_REPO_TYPES = new Set(["go", "golang"]);
const RUST_REPO_TYPES = new Set(["rust", "cargo"]);
const JAVA_REPO_TYPES = new Set(["java", "maven", "gradle"]);
const GENERIC_REPO_TYPES = new Set(["generic", "any"]);

const PYTHON_MARKERS = ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile", "poetry.lock"];
const JAVA_MARKERS = ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"];
const LOCAL_NODE_TOOLS = new Set([
  "ava",
  "biome",
  "eslint",
  "jest",
  "mocha",
  "next",
  "playwright",
  "prettier",
  "react-scripts",
  "tap",
  "tsc",
  "vite",
  "vitest",
  "webpack"
]);

/**
 * Check if a task pack is compatible with the given repository.
 */
export async function checkTaskCompatibility(
  task: TaskPack,
  repoPath: string
): Promise<CompatibilityCheckResult> {
  const checks: CompatibilityCheck[] = [];

  if (task.repoSource?.startsWith("builtin://")) {
    return {
      status: "compatible",
      summary: "Task pack uses a built-in repository, so repo compatibility is already controlled.",
      checks: [{ label: "Built-in repo", status: "pass", message: `Uses ${task.repoSource}` }]
    };
  }

  const repoCheck = await checkRepoPath(repoPath);
  checks.push(repoCheck);
  if (repoCheck.status === "fail") {
    return {
      status: "incompatible",
      summary: "Repository path is not usable.",
      checks
    };
  }

  const acceptedRepoKinds = new Set((task.metadata?.repoTypes ?? []).map((value) => value.toLowerCase()));
  const requiredKinds = new Set([
    ...(task.metadata?.dependencies ?? []),
    ...inferKindsFromCommands(task)
  ].map((value) => value.toLowerCase()));

  const acceptsNode = intersects(acceptedRepoKinds, NODE_REPO_TYPES);
  const acceptsPython = intersects(acceptedRepoKinds, PYTHON_REPO_TYPES);
  const acceptsGo = intersects(acceptedRepoKinds, GO_REPO_TYPES);
  const acceptsRust = intersects(acceptedRepoKinds, RUST_REPO_TYPES);
  const acceptsJava = intersects(acceptedRepoKinds, JAVA_REPO_TYPES);
  const acceptsGeneric = intersects(acceptedRepoKinds, GENERIC_REPO_TYPES);
  const expectsNode = intersects(requiredKinds, NODE_REPO_TYPES);
  const expectsPython = intersects(requiredKinds, PYTHON_REPO_TYPES);
  const expectsGo = intersects(requiredKinds, GO_REPO_TYPES);
  const expectsRust = intersects(requiredKinds, RUST_REPO_TYPES);
  const expectsJava = intersects(requiredKinds, JAVA_REPO_TYPES);

  const hasPackageJson = await fileExists(path.join(repoPath, "package.json"));
  const hasPythonMarker = await hasAnyFile(repoPath, PYTHON_MARKERS);
  const hasGoModule = await fileExists(path.join(repoPath, "go.mod"));
  const hasCargoManifest = await fileExists(path.join(repoPath, "Cargo.toml"));
  const hasJavaMarker = await hasAnyFile(repoPath, JAVA_MARKERS);
  const hasRepoTypeDeclaration = acceptsGeneric || acceptsNode || acceptsPython || acceptsGo || acceptsRust || acceptsJava;
  const repoTypeMatches =
    acceptsGeneric ||
    (acceptsNode && hasPackageJson) ||
    (acceptsPython && hasPythonMarker) ||
    (acceptsGo && hasGoModule) ||
    (acceptsRust && hasCargoManifest) ||
    (acceptsJava && hasJavaMarker);

  if (hasRepoTypeDeclaration) {
    checks.push({
      label: "Repository type",
      status: repoTypeMatches ? "pass" : "fail",
      message: repoTypeMatches
        ? "Repository matches one of the task pack's supported repo types."
        : "Repository does not match any supported repo type declared by this task pack.",
      fix: "Use a repository whose language/framework matches the task pack, or choose a task pack that matches this repository."
    });
  }

  if (expectsNode) {
    checks.push({
      label: "Node.js project",
      status: hasPackageJson ? "pass" : "fail",
      message: hasPackageJson ? "package.json found" : "This task expects a Node.js project, but package.json was not found.",
      fix: "Use a Node.js repository or choose a task pack that matches this repository."
    });
  } else if (hasPackageJson) {
    checks.push({ label: "Node.js project", status: "pass", message: "package.json found" });
  }

  if (expectsPython) {
    checks.push({
      label: "Python project",
      status: hasPythonMarker ? "pass" : "fail",
      message: hasPythonMarker
        ? "Python project marker found"
        : `This task expects a Python project, but none of ${PYTHON_MARKERS.join(", ")} was found.`,
      fix: "Use a Python repository with a dependency file, or choose a task pack that matches this repository."
    });
  }

  if (expectsGo) {
    checks.push({
      label: "Go project",
      status: hasGoModule ? "pass" : "fail",
      message: hasGoModule ? "go.mod found" : "This task expects a Go module, but go.mod was not found.",
      fix: "Use a Go module repository or choose a task pack that matches this repository."
    });
  }

  if (expectsRust) {
    checks.push({
      label: "Rust project",
      status: hasCargoManifest ? "pass" : "fail",
      message: hasCargoManifest ? "Cargo.toml found" : "This task expects a Rust project, but Cargo.toml was not found.",
      fix: "Use a Rust repository or choose a task pack that matches this repository."
    });
  }

  if (expectsJava) {
    checks.push({
      label: "Java project",
      status: hasJavaMarker ? "pass" : "fail",
      message: hasJavaMarker ? "Java project marker found" : `This task expects a Java project, but none of ${JAVA_MARKERS.join(", ")} was found.`,
      fix: "Use a Java repository or choose a task pack that matches this repository."
    });
  }

  for (const cmd of task.setupCommands) {
    checks.push(...await checkCommandCompatibility(repoPath, cmd.command, `Setup: ${cmd.label}`));
  }

  for (const judge of task.judges) {
    if ("command" in judge && typeof judge.command === "string") {
      checks.push(...await checkCommandCompatibility(repoPath, judge.command, `Judge: ${judge.label}`));
    }

    if (judge.type === "compilation") {
      const hasBuild = await hasNpmScript(repoPath, "build");
      checks.push({
        label: "Build script",
        status: hasBuild ? "pass" : "warn",
        message: hasBuild ? "npm script \"build\" found" : "No build script found; compilation check may fail.",
        fix: "Add a build script, set a custom compilation command, or choose a task pack without a build judge."
      });
    }

    if (judge.type === "lint-check") {
      const hasLint = await hasNpmScript(repoPath, "lint");
      const isNodeLint = hasPackageJson && (!judge.command || /\bnpm\b|\bpnpm\b|\byarn\b|\bnpx\b/u.test(judge.command));
      if (isNodeLint) {
        checks.push({
          label: "Lint script",
          status: hasLint ? "pass" : "warn",
          message: hasLint ? "npm script \"lint\" found" : "No lint script found; lint check may fail.",
          fix: "Add a lint script, set a custom lint command, or remove the lint judge for this repository."
        });
      }
    }

    if ((judge.type === "file-exists" || judge.type === "file-contains") && judge.path) {
      const exists = await fileExists(path.join(repoPath, judge.path));
      checks.push({
        label: `File: ${judge.path}`,
        status: exists ? "pass" : "warn",
        message: exists ? `${judge.path} exists` : `${judge.path} not found; this judge may fail if the task expects it to already exist.`,
        fix: "Confirm whether the task should create this file. If not, use a matching repository or adjust the judge path."
      });
    }
  }

  const hasFail = checks.some((check) => check.status === "fail");
  const hasWarn = checks.some((check) => check.status === "warn");

  if (hasFail) {
    return {
      status: "incompatible",
      summary: "Task pack does not match this repository.",
      checks
    };
  }

  if (hasWarn) {
    return {
      status: "warning",
      summary: "Task pack can run, but some checks may fail because repository prerequisites are missing.",
      checks
    };
  }

  return {
    status: "compatible",
    summary: "Task pack appears compatible with this repository.",
    checks
  };
}

async function checkRepoPath(repoPath: string): Promise<CompatibilityCheck> {
  try {
    const stat = await fs.stat(repoPath);
    if (!stat.isDirectory()) {
      return {
        label: "Repo exists",
        status: "fail",
        message: `${repoPath} is not a directory`,
        fix: "Pass a repository directory to --repo."
      };
    }
    return { label: "Repo exists", status: "pass", message: `${repoPath} exists` };
  } catch {
    return {
      label: "Repo exists",
      status: "fail",
      message: `${repoPath} not found`,
      fix: "Pass an existing repository directory to --repo."
    };
  }
}

async function checkCommandCompatibility(repoPath: string, command: string, label: string): Promise<CompatibilityCheck[]> {
  const checks: CompatibilityCheck[] = [];
  const requiredFiles = inferRequiredFiles(command);
  for (const relativePath of requiredFiles) {
    const exists = await fileExists(path.join(repoPath, relativePath));
    checks.push({
      label: `${label} requires ${relativePath}`,
      status: exists ? "pass" : "fail",
      message: exists ? `${relativePath} found` : `Command references ${relativePath}, but the file was not found.`,
      fix: "Use a repository that contains the referenced file, or update the task pack command to the real file path."
    });
  }

  if (usesBlockedEval(command)) {
    checks.push({
      label: `${label} inline eval`,
      status: "fail",
      message: "Command uses inline eval (-e/-c/--eval), which is blocked for task-pack setup and judge commands in normal runs.",
      fix: "Move the inline code into a checked-in script file and run that script from the task pack."
    });
  }

  const npxNoInstallTool = parseNpxNoInstallTool(command);
  if (npxNoInstallTool) {
    checks.push({
      label: `${label} local dependency: ${npxNoInstallTool}`,
      status: "fail",
      message:
        `Command uses npx --no-install ${npxNoInstallTool}, but AgentArena workspaces do not copy node_modules. ` +
        "Running this would force the agent to install dependencies before it can be judged.",
      fix: "Prepare dependencies outside the benchmarked agent work, use a repository-specific setup step, or replace this judge with a command that works without local node_modules."
    });
  }

  const packageManagerScript = parsePackageManagerScript(command);
  if (packageManagerScript && packageManagerScript.script !== "install") {
    const scriptBody = await getNpmScript(repoPath, packageManagerScript.script);
    checks.push({
      label: `${label} npm script: ${packageManagerScript.script}`,
      status: scriptBody ? "pass" : "fail",
      message: scriptBody
        ? `${packageManagerScript.manager} script "${packageManagerScript.script}" found`
        : `${packageManagerScript.manager} script "${packageManagerScript.script}" not found; command cannot run for this repository.`,
      fix: "Add the missing script, update the task pack command, or choose a task pack that matches this repository."
    });

    if (scriptBody) {
      const localTools = findLocalNodeTools(scriptBody);
      if (localTools.length > 0) {
        checks.push({
          label: `${label} script dependencies`,
          status: "fail",
          message:
            `Script "${packageManagerScript.script}" invokes local tool(s): ${localTools.join(", ")}. ` +
            "AgentArena workspaces do not copy node_modules, so agents would need to install dependencies before this check can run.",
          fix: "Prepare dependencies before benchmarking, use a repository-specific setup step, or change the task pack to checks that do not require local node_modules."
        });
      }
    }
  }

  if (/\bnpm\s+install\b|\bpnpm\s+install\b|\byarn\s+install\b/u.test(command)) {
    checks.push({
      label: `${label} dependency install`,
      status: "warn",
      message: "This task runs a dependency install during setup.",
      fix: "Prefer preparing dependencies before benchmarking, or keep setup install only in repository-specific task packs."
    });
  }

  return checks;
}

function inferKindsFromCommands(task: TaskPack): string[] {
  const commands = [
    ...task.setupCommands.map((step) => step.command),
    ...task.judges.flatMap((judge) => ("command" in judge && typeof judge.command === "string" ? [judge.command] : []))
  ];
  const kinds: string[] = [];
  for (const command of commands) {
    if (/\bnpm\b|\bpnpm\b|\byarn\b|\bnpx\b/u.test(command)) kinds.push("node");
    if (/\bpython\b|\bpytest\b|\bpip\b|\bflake8\b/u.test(command)) kinds.push("python");
    if (/\bgo\b/u.test(command)) kinds.push("go");
    if (/\bcargo\b/u.test(command)) kinds.push("rust");
  }
  return kinds;
}

function inferRequiredFiles(command: string): string[] {
  const files: string[] = [];
  const pipRequirements = command.match(/\bpip(?:\d+(?:\.\d+)?)?\s+install\b[^\n\r]*\s-r\s+([^\s;&|]+)/u);
  if (pipRequirements?.[1]) {
    files.push(stripQuotes(pipRequirements[1]));
  }
  return files;
}

function usesBlockedEval(command: string): boolean {
  if (process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES === "1") {
    return false;
  }
  const tokens = tokenizeCommand(command);
  const executable = path.basename(tokens[0] ?? "");
  if (!["node", "python", "python3", "bun"].includes(executable)) {
    return false;
  }
  return tokens.some((token) => token === "-e" || token === "-c" || token === "--eval" || token.startsWith("--eval="));
}

function tokenizeCommand(command: string): string[] {
  return command
    .match(/"[^"]*"|'[^']*'|[^\s]+/gu)
    ?.map(stripQuotes) ?? [];
}

function parseNpxNoInstallTool(command: string): string | undefined {
  const tokens = tokenizeCommand(command);
  const npxIndex = tokens.findIndex((token) => ["npx", "pnpx"].includes(path.basename(token)));
  if (npxIndex < 0) {
    return undefined;
  }
  if (!tokens.slice(npxIndex + 1).some((token) => token === "--no-install" || token === "-n")) {
    return undefined;
  }
  for (const token of tokens.slice(npxIndex + 1)) {
    if (token === "--no-install" || token === "-n" || token.startsWith("-")) {
      continue;
    }
    return token;
  }
  return undefined;
}

function parsePackageManagerScript(command: string): { manager: string; script: string } | undefined {
  const tokens = tokenizeCommand(command);
  const managerIndex = tokens.findIndex((token) => ["npm", "pnpm", "yarn", "bun"].includes(path.basename(token)));
  if (managerIndex < 0) {
    return undefined;
  }
  const manager = path.basename(tokens[managerIndex]);
  const args = tokens.slice(managerIndex + 1).filter((token) => !token.startsWith("-"));
  if (args.length === 0) {
    return undefined;
  }
  if (args[0] === "run") {
    return args[1] ? { manager, script: args[1] } : undefined;
  }
  if (["test", "lint", "build"].includes(args[0])) {
    return { manager, script: args[0] };
  }
  return undefined;
}

function findLocalNodeTools(script: string): string[] {
  const found = new Set<string>();
  for (const tool of LOCAL_NODE_TOOLS) {
    const pattern = new RegExp(`(^|[\\s;&|()])${escapeRegExp(tool)}($|[\\s;&|:])`, "u");
    if (pattern.test(script)) {
      found.add(tool);
    }
  }
  return [...found].sort();
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/gu, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function intersects(values: Set<string>, candidates: Set<string>): boolean {
  for (const value of values) {
    if (candidates.has(value)) {
      return true;
    }
  }
  return false;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasAnyFile(repoPath: string, relativePaths: string[]): Promise<boolean> {
  for (const relativePath of relativePaths) {
    if (await fileExists(path.join(repoPath, relativePath))) {
      return true;
    }
  }
  return false;
}

async function hasNpmScript(repoPath: string, scriptName: string): Promise<boolean> {
  return (await getNpmScript(repoPath, scriptName)) !== undefined;
}

async function getNpmScript(repoPath: string, scriptName: string): Promise<string | undefined> {
  try {
    const pkgPath = path.join(repoPath, "package.json");
    const content = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(content) as { scripts?: Record<string, unknown> };
    const script = pkg.scripts?.[scriptName];
    return typeof script === "string" ? script : undefined;
  } catch {
    return undefined;
  }
}
