import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  CommandExecutionSpec,
  CommandStepResult,
  CommandJudge,
  FileContainsJudge,
  FileCountJudge,
  FileExistsJudge,
  GlobJudge,
  JsonValueJudge,
  JudgeResult,
  TaskJudge,
  buildExecutionEnvironment,
  uniqueSorted
} from "@repoarena/core";

const DEFAULT_JUDGE_TIMEOUT_MS = 5 * 60 * 1_000;

function resolveTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function defaultJudgeTimeoutMs(): number {
  return resolveTimeoutMs(process.env.REPOARENA_JUDGE_TIMEOUT_MS, DEFAULT_JUDGE_TIMEOUT_MS);
}

function resolveWorkspacePath(workspacePath: string, relativeTargetPath: string, label: string): string {
  const candidatePath = path.resolve(workspacePath, relativeTargetPath);
  const relativePath = path.relative(workspacePath, candidatePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the workspace.`);
  }

  return candidatePath;
}

function resolveJudgeWorkingDirectory(workspacePath: string, judge: CommandJudge): string {
  return resolveWorkspacePath(workspacePath, judge.cwd ?? ".", `Judge "${judge.id}" cwd`);
}

function resolveCommandWorkingDirectory(workspacePath: string, step: CommandExecutionSpec): string {
  return resolveWorkspacePath(workspacePath, step.cwd ?? ".", `Command step "${step.id}" cwd`);
}

function buildStepEnvironment(
  baseAllowedNames: string[],
  step: Pick<CommandExecutionSpec, "envAllowList" | "env">
): NodeJS.ProcessEnv {
  const effectiveAllowList = uniqueSorted([...(baseAllowedNames ?? []), ...(step.envAllowList ?? [])]);
  return buildExecutionEnvironment(effectiveAllowList, step.env ?? {});
}

function stringifyExpectation(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const nextNext = pattern[index + 2];

    if (char === "*") {
      if (next === "*" && nextNext === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else if (next === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  source += "$";
  return new RegExp(source);
}

async function listWorkspaceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      files.push(path.relative(rootPath, absolutePath).split(path.sep).join("/"));
    }
  }

  await walk(rootPath);
  return files.sort();
}

function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === "") {
    return root;
  }

  if (!pointer.startsWith("/")) {
    throw new Error(`JSON pointer "${pointer}" must start with "/".`);
  }

  const segments = pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));

  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`JSON pointer segment "${segment}" is not a valid array index.`);
      }
      current = current[index];
      continue;
    }

    if (!current || typeof current !== "object" || !(segment in current)) {
      throw new Error(`JSON pointer segment "${segment}" does not exist.`);
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

async function runCommandJudge(
  judge: CommandJudge,
  workspacePath: string,
  baseAllowedNames: string[]
): Promise<JudgeResult> {
  const startedAt = Date.now();
  const timeoutMs = judge.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = resolveJudgeWorkingDirectory(workspacePath, judge);
  const environment = buildStepEnvironment(baseAllowedNames, judge);

  return await new Promise((resolve) => {
    const child = spawn(judge.command, {
      cwd,
      env: environment,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      resolve({
        judgeId: judge.id,
        label: judge.label,
        type: "command",
        command: judge.command,
        exitCode,
        success: exitCode === 0 && !timedOut,
        stdout: stdout.trim(),
        stderr: `${stderr}${timedOut ? `\nJudge timed out after ${timeoutMs}ms.` : ""}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      resolve({
        judgeId: judge.id,
        label: judge.label,
        type: "command",
        command: judge.command,
        exitCode: -1,
        success: false,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });
  });
}

async function runFileExistsJudge(judge: FileExistsJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);

  try {
    await fs.access(targetPath);
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-exists",
      target: judge.path,
      expectation: "exists",
      exitCode: 0,
      success: true,
      stdout: `Found ${judge.path}.`,
      stderr: "",
      durationMs: Date.now() - startedAt
    };
  } catch {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-exists",
      target: judge.path,
      expectation: "exists",
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: `Expected file "${judge.path}" to exist.`,
      durationMs: Date.now() - startedAt
    };
  }
}

async function runFileContainsJudge(judge: FileContainsJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);

  try {
    const content = await fs.readFile(targetPath, "utf8");
    const matched = judge.regex
      ? new RegExp(judge.pattern, judge.flags).test(content)
      : content.includes(judge.pattern);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-contains",
      target: judge.path,
      expectation: judge.regex
        ? `regex:${judge.pattern}${judge.flags ? `/${judge.flags}` : ""}`
        : judge.pattern,
      exitCode: matched ? 0 : 1,
      success: matched,
      stdout: matched ? `Matched content in ${judge.path}.` : "",
      stderr: matched
        ? ""
        : `Expected file "${judge.path}" to contain ${judge.regex ? "a regex match" : "the target string"}.`,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-contains",
      target: judge.path,
      expectation: judge.pattern,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

async function runJsonValueJudge(judge: JsonValueJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);
  const expectation = stringifyExpectation(judge.expected);

  try {
    const parsed = JSON.parse(await fs.readFile(targetPath, "utf8")) as unknown;
    const actual = resolveJsonPointer(parsed, judge.pointer);
    const matched = isDeepStrictEqual(actual, judge.expected);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "json-value",
      target: `${judge.path}#${judge.pointer}`,
      expectation,
      exitCode: matched ? 0 : 1,
      success: matched,
      stdout: matched ? `Matched JSON value at ${judge.pointer}.` : `Actual: ${stringifyExpectation(actual)}`,
      stderr: matched
        ? ""
        : `Expected ${judge.path} at "${judge.pointer}" to equal ${expectation}.`,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "json-value",
      target: `${judge.path}#${judge.pointer}`,
      expectation,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

async function runGlobJudge(judge: GlobJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const matcher = globToRegExp(judge.pattern);

  try {
    const matches = (await listWorkspaceFiles(workspacePath)).filter((filePath) => matcher.test(filePath));
    const minMatches = judge.minMatches ?? 1;
    const maxMatches = judge.maxMatches;
    const success = matches.length >= minMatches && (maxMatches === undefined || matches.length <= maxMatches);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "glob",
      target: judge.pattern,
      expectation:
        maxMatches === undefined
          ? `matches>=${minMatches}`
          : `matches>=${minMatches} && matches<=${maxMatches}`,
      exitCode: success ? 0 : 1,
      success,
      stdout: matches.length > 0 ? `Matched files: ${matches.join(", ")}` : "",
      stderr: success
        ? ""
        : `Expected glob "${judge.pattern}" to match within configured bounds, actual matches=${matches.length}.`,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "glob",
      target: judge.pattern,
      expectation:
        judge.maxMatches === undefined
          ? `matches>=${judge.minMatches ?? 1}`
          : `matches>=${judge.minMatches ?? 1} && matches<=${judge.maxMatches}`,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

async function runFileCountJudge(judge: FileCountJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const matcher = globToRegExp(judge.pattern);

  try {
    const matches = (await listWorkspaceFiles(workspacePath)).filter((filePath) => matcher.test(filePath));
    const actual = matches.length;
    const success =
      (judge.equals === undefined || actual === judge.equals) &&
      (judge.min === undefined || actual >= judge.min) &&
      (judge.max === undefined || actual <= judge.max);

    const expectationParts = [
      judge.equals !== undefined ? `equals=${judge.equals}` : "",
      judge.min !== undefined ? `min=${judge.min}` : "",
      judge.max !== undefined ? `max=${judge.max}` : ""
    ].filter(Boolean);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-count",
      target: judge.pattern,
      expectation: expectationParts.join(", "),
      exitCode: success ? 0 : 1,
      success,
      stdout: `Actual count=${actual}${matches.length > 0 ? `; matches: ${matches.join(", ")}` : ""}`,
      stderr: success ? "" : `File count assertion failed for pattern "${judge.pattern}".`,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-count",
      target: judge.pattern,
      expectation: stringifyExpectation({
        equals: judge.equals,
        min: judge.min,
        max: judge.max
      }),
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

export async function runJudge(
  judge: TaskJudge,
  workspacePath: string,
  baseAllowedNames: string[]
): Promise<JudgeResult> {
  switch (judge.type) {
    case "command":
      return await runCommandJudge(judge, workspacePath, baseAllowedNames);
    case "file-exists":
      return await runFileExistsJudge(judge, workspacePath);
    case "file-contains":
      return await runFileContainsJudge(judge, workspacePath);
    case "json-value":
      return await runJsonValueJudge(judge, workspacePath);
    case "glob":
      return await runGlobJudge(judge, workspacePath);
    case "file-count":
      return await runFileCountJudge(judge, workspacePath);
  }
}

export async function runJudges(
  judges: TaskJudge[],
  workspacePath: string,
  baseAllowedNames: string[]
): Promise<JudgeResult[]> {
  return await Promise.all(
    judges.map(async (judge) => await runJudge(judge, workspacePath, baseAllowedNames))
  );
}

export async function runCommandStep(
  step: CommandExecutionSpec,
  workspacePath: string,
  baseAllowedNames: string[]
): Promise<CommandStepResult> {
  const startedAt = Date.now();
  const timeoutMs = step.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = resolveCommandWorkingDirectory(workspacePath, step);
  const environment = buildStepEnvironment(baseAllowedNames, step);

  return await new Promise((resolve) => {
    const child = spawn(step.command, {
      cwd,
      env: environment,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      resolve({
        stepId: step.id,
        label: step.label,
        command: step.command,
        exitCode,
        success: exitCode === 0 && !timedOut,
        stdout: stdout.trim(),
        stderr: `${stderr}${timedOut ? `\nCommand step timed out after ${timeoutMs}ms.` : ""}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      resolve({
        stepId: step.id,
        label: step.label,
        command: step.command,
        exitCode: -1,
        success: false,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });
  });
}

export async function runCommandSteps(
  steps: CommandExecutionSpec[],
  workspacePath: string,
  baseAllowedNames: string[]
): Promise<CommandStepResult[]> {
  const results: CommandStepResult[] = [];

  for (const step of steps) {
    results.push(await runCommandStep(step, workspacePath, baseAllowedNames));
  }

  return results;
}
