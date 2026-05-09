import path from "node:path";
import type { CompilationJudge, JudgeResult } from "@agentarena/core";
import { executeCommand, parseCommand } from "../command-runner.js";
import {
  buildStepEnvironment,
  type CommandExecutionCapture,
  defaultJudgeTimeoutMs,
  type JudgeExecutionOptions,
  pathExists,
  resolveJudgeWorkingDirectory,
} from "../shared.js";

export async function runCompilationJudge(
  judge: CompilationJudge,
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions = {}
): Promise<JudgeResult> {
  const startedAt = Date.now();
  const timeoutMs = judge.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = await resolveJudgeWorkingDirectory(workspacePath, judge);
  const environment = buildStepEnvironment(baseAllowedNames, judge);

  let command: string;
  let args: string[] = [];

  if (judge.command) {
    command = judge.command;
  } else {
    const tool = judge.tool ?? "auto";
    if (tool !== "auto") {
      const toolCommands: Record<string, { cmd: string; args: string[] }> = {
        npm: { cmd: "npm", args: ["run", "build"] },
        pnpm: { cmd: "pnpm", args: ["build"] },
        yarn: { cmd: "yarn", args: ["build"] },
        cargo: { cmd: "cargo", args: ["build"] },
        go: { cmd: "go", args: ["build", "./..."] },
        make: { cmd: "make", args: [] },
        gradle: { cmd: "gradle", args: ["build"] },
        maven: { cmd: "mvn", args: ["compile"] }
      };
      const detected = toolCommands[tool];
      command = detected.cmd;
      args = [...detected.args];
    } else {
      const hasPnpmLock = await pathExists(path.join(workspacePath, "pnpm-lock.yaml"));
      const hasYarnLock = await pathExists(path.join(workspacePath, "yarn.lock"));
      const hasPackageJson = await pathExists(path.join(workspacePath, "package.json"));
      const hasCargoToml = await pathExists(path.join(workspacePath, "Cargo.toml"));
      const hasGoMod = await pathExists(path.join(workspacePath, "go.mod"));
      const hasMakefile = await pathExists(path.join(workspacePath, "Makefile"));
      const hasGradleFile = await pathExists(path.join(workspacePath, "build.gradle")) || await pathExists(path.join(workspacePath, "build.gradle.kts"));
      const hasPomXml = await pathExists(path.join(workspacePath, "pom.xml"));

      if (hasCargoToml) {
        command = "cargo";
        args = ["build"];
      } else if (hasGoMod) {
        command = "go";
        args = ["build", "./..."];
      } else if (hasMakefile) {
        command = "make";
        args = [];
      } else if (hasGradleFile) {
        command = "gradle";
        args = ["build"];
      } else if (hasPomXml) {
        command = "mvn";
        args = ["compile"];
      } else if (hasPnpmLock && hasPackageJson) {
        command = "pnpm";
        args = ["build"];
      } else if (hasYarnLock && hasPackageJson) {
        command = "yarn";
        args = ["build"];
      } else if (hasPackageJson) {
        command = "npm";
        args = ["run", "build"];
      } else {
        return {
          judgeId: judge.id,
          label: judge.label,
          type: "compilation",
          target: "workspace",
          expectation: "compilation succeeds",
          exitCode: 1,
          success: false,
          stdout: "",
          stderr: "Could not auto-detect build tool. No recognized project files found.",
          durationMs: Date.now() - startedAt,
          critical: judge.critical ?? false
        };
      }
    }
  }

  if (judge.buildArgs && judge.buildArgs.length > 0) {
    args.push(...judge.buildArgs);
  }

  let result: CommandExecutionCapture;
  if (judge.command) {
    const [parsedCmd, parsedArgs] = parseCommand(command);
    const allArgs = [...parsedArgs, ...args];
    result = await executeCommand(parsedCmd, cwd, environment, timeoutMs, "Compilation", options.signal, allArgs);
  } else {
    result = await executeCommand(command, cwd, environment, timeoutMs, "Compilation", options.signal, args);
  }

  const successHint = result.exitCode === 0 ? "Compilation succeeded." : `Compilation failed with exit code ${result.exitCode}.`;
  const debugHint = result.exitCode !== 0
    ? "\nDebug tip: Check the build output above for errors. Common issues include missing dependencies, syntax errors, or type errors."
    : "";

  return {
    judgeId: judge.id,
    label: judge.label,
    type: "compilation",
    target: judge.command ?? "auto-detected build",
    expectation: "compilation succeeds",
    exitCode: result.exitCode,
    success: result.exitCode === 0,
    stdout: `${successHint}${debugHint}\n${result.stdout}`.trim(),
    stderr: result.stderr,
    durationMs: result.durationMs,
    cwd: result.cwd,
    critical: judge.critical ?? false
  };
}
