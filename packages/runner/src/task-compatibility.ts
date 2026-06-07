/**
 * Task pack compatibility checker.
 *
 * Validates whether a task pack's requirements (fixtures, scripts, runtimes)
 * are satisfied by the user's repository before running a benchmark.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { TaskPack } from "@agentarena/core";

export interface CompatibilityCheckResult {
  /** Overall compatibility status */
  status: "compatible" | "warning" | "incompatible";
  /** Human-readable summary */
  summary: string;
  /** Individual check results */
  checks: CompatibilityCheck[];
}

export interface CompatibilityCheck {
  /** What was checked */
  label: string;
  /** Check result */
  status: "pass" | "warn" | "fail";
  /** Human-readable message */
  message: string;
}

/**
 * Check if a task pack is compatible with the given repository.
 */
export async function checkTaskCompatibility(
  task: TaskPack,
  repoPath: string
): Promise<CompatibilityCheckResult> {
  const checks: CompatibilityCheck[] = [];

  // If task has a builtin repo, it's always compatible
  if (task.repoSource?.startsWith("builtin://")) {
    return {
      status: "compatible",
      summary: "Task pack uses a built-in repository — always compatible.",
      checks: [{ label: "Built-in repo", status: "pass", message: `Uses ${task.repoSource}` }]
    };
  }

  // Check if repo exists
  try {
    const stat = await fs.stat(repoPath);
    if (!stat.isDirectory()) {
      return {
        status: "incompatible",
        summary: "Repository path is not a directory.",
        checks: [{ label: "Repo exists", status: "fail", message: `${repoPath} is not a directory` }]
      };
    }
  } catch {
    return {
      status: "incompatible",
      summary: "Repository path does not exist.",
      checks: [{ label: "Repo exists", status: "fail", message: `${repoPath} not found` }]
    };
  }

  // Check for package.json (indicates Node.js project)
  const hasPackageJson = await fileExists(path.join(repoPath, "package.json"));
  if (hasPackageJson) {
    checks.push({ label: "Node.js project", status: "pass", message: "package.json found" });
  } else {
    checks.push({ label: "Node.js project", status: "warn", message: "No package.json found — some tasks may not work" });
  }

  // Check setup commands for required scripts
  for (const cmd of task.setupCommands) {
    const scriptMatch = cmd.command.match(/npm\s+(?:run\s+)?(\S+)/);
    if (scriptMatch) {
      const script = scriptMatch[1];
      if (script !== "install" && script !== "test") {
        const hasScript = await hasNpmScript(repoPath, script);
        checks.push({
          label: `Script: ${script}`,
          status: hasScript ? "pass" : "warn",
          message: hasScript ? `npm script "${script}" found` : `npm script "${script}" not found — setup may fail`
        });
      }
    }
  }

  // Check judges for required scripts/commands
  for (const judge of task.judges) {
    if (judge.type === "test-result" && judge.command) {
      const scriptMatch = judge.command.match(/npm\s+(?:run\s+)?(\S+)/);
      if (scriptMatch) {
        const script = scriptMatch[1];
        const hasScript = await hasNpmScript(repoPath, script);
        checks.push({
          label: `Test script: ${script}`,
          status: hasScript ? "pass" : "warn",
          message: hasScript ? `npm script "${script}" found` : `npm script "${script}" not found — tests may fail`
        });
      }
    }
    if (judge.type === "compilation") {
      const hasBuild = await hasNpmScript(repoPath, "build");
      checks.push({
        label: "Build script",
        status: hasBuild ? "pass" : "warn",
        message: hasBuild ? "npm script \"build\" found" : "No build script — compilation check may fail"
      });
    }
    if (judge.type === "lint-check") {
      const hasLint = await hasNpmScript(repoPath, "lint");
      checks.push({
        label: "Lint script",
        status: hasLint ? "pass" : "warn",
        message: hasLint ? "npm script \"lint\" found" : "No lint script — lint check may fail"
      });
    }
  }

  // Check for fixture files referenced in judges
  for (const judge of task.judges) {
    if (judge.type === "file-exists" || judge.type === "file-contains") {
      const filePath = judge.path;
      if (filePath) {
        const exists = await fileExists(path.join(repoPath, filePath));
        checks.push({
          label: `File: ${filePath}`,
          status: exists ? "pass" : "warn",
          message: exists ? `${filePath} exists` : `${filePath} not found — judge may fail`
        });
      }
    }
  }

  // Determine overall status
  const hasFail = checks.some(c => c.status === "fail");
  const hasWarn = checks.some(c => c.status === "warn");

  if (hasFail) {
    return {
      status: "incompatible",
      summary: "Task pack is incompatible with this repository.",
      checks
    };
  }
  if (hasWarn) {
    return {
      status: "warning",
      summary: "Task pack may not work fully with this repository.",
      checks
    };
  }
  return {
    status: "compatible",
    summary: "Task pack appears compatible with this repository.",
    checks
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasNpmScript(repoPath: string, scriptName: string): Promise<boolean> {
  try {
    const pkgPath = path.join(repoPath, "package.json");
    const content = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(content) as { scripts?: Record<string, unknown> };
    return typeof pkg.scripts?.[scriptName] === "string";
  } catch {
    return false;
  }
}
