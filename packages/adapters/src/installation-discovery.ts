import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  hashRuntimeIdentity,
  INSTALLATION_SCHEMA_V1,
  type RuntimeAgentKind,
  type RuntimeInstallation
} from "@agentarena/core";
import { prepareCodexRuntimeHome } from "./codex-runtime-home.js";
import { runProcess } from "./process-utils.js";

export interface RuntimeInstallationInvocation {
  executable: string;
  argsPrefix: string[];
  displayCommand: string;
}

export interface RuntimeInstallationProbeResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut?: boolean;
}

export interface DiscoverRuntimeInstallationOptions {
  agentKind: RuntimeAgentKind;
  commandPath?: string;
  environment?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  /** Whether Codex installation probes should inherit the local auth file. */
  includeLocalAuth?: boolean;
  now?: () => string;
  probe?: (
    invocation: RuntimeInstallationInvocation,
    args: string[]
  ) => Promise<RuntimeInstallationProbeResult>;
}

interface ResolvedCommand extends RuntimeInstallationInvocation {
  source: RuntimeInstallation["source"];
  identityPaths: string[];
}

interface KnownWindowsNpmEntry {
  entryPath: string;
  executable: string;
  argsPrefix: string[];
}

const WINDOWS_SCRIPT_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);

function commandName(agentKind: RuntimeAgentKind): string {
  return agentKind === "codex" ? "codex" : "claude";
}

function trimPathEntry(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
}

function windowsCommandCandidates(baseName: string, pathExt: string | undefined): string[] {
  const configuredExtensions = (pathExt ?? ".COM;.EXE;.BAT;.CMD;.PS1")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  const preferredExtensions = [".cmd", ".exe", ".ps1", ".bat", ...configuredExtensions];
  return [
    ...new Set(preferredExtensions.map((extension) => `${baseName}${extension}`)),
    baseName
  ];
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function findOnPath(
  baseName: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<string | undefined> {
  const entries = (environment.PATH ?? environment.Path ?? "")
    .split(path.delimiter)
    .map(trimPathEntry)
    .filter(Boolean);
  const names = platform === "win32"
    ? windowsCommandCandidates(baseName, environment.PATHEXT)
    : [baseName];

  for (const entry of entries) {
    for (const name of names) {
      const candidate = path.resolve(entry, name);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

async function knownWindowsNpmEntry(
  commandPath: string,
  agentKind: RuntimeAgentKind,
  nodeExecutable: string
): Promise<KnownWindowsNpmEntry | undefined> {
  const commandName = path.basename(commandPath).toLowerCase();
  if (path.extname(commandPath).toLowerCase() !== ".cmd") return undefined;

  const commandRoot = path.dirname(commandPath);
  const candidates = agentKind === "codex" && commandName === "codex.cmd"
    ? [path.join(commandRoot, "node_modules", "@openai", "codex", "bin", "codex.js")]
    : agentKind === "claude-code" && commandName === "claude.cmd"
      ? [
          path.join(commandRoot, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
          path.join(commandRoot, "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
          path.join(commandRoot, "node_modules", "@anthropic-ai", "claude-code", "cli.mjs")
        ]
      : [];

  for (const entryPath of candidates) {
    if (!(await isFile(entryPath))) continue;
    if (WINDOWS_SCRIPT_EXTENSIONS.has(path.extname(entryPath).toLowerCase())) {
      return { entryPath, executable: nodeExecutable, argsPrefix: [entryPath] };
    }
    return { entryPath, executable: entryPath, argsPrefix: [] };
  }
  return undefined;
}

async function invocationForPath(
  commandPath: string,
  source: RuntimeInstallation["source"],
  platform: NodeJS.Platform,
  nodeExecutable: string,
  agentKind: RuntimeAgentKind
): Promise<ResolvedCommand> {
  const extension = path.extname(commandPath).toLowerCase();
  if (platform === "win32") {
    const npmEntry = await knownWindowsNpmEntry(commandPath, agentKind, nodeExecutable);
    if (npmEntry) {
      return {
        executable: npmEntry.executable,
        argsPrefix: npmEntry.argsPrefix,
        displayCommand: [npmEntry.executable, ...npmEntry.argsPrefix].join(" "),
        source,
        identityPaths: [commandPath, npmEntry.entryPath]
      };
    }
  }
  if (WINDOWS_SCRIPT_EXTENSIONS.has(extension)) {
    return {
      executable: nodeExecutable,
      argsPrefix: [commandPath],
      displayCommand: `${nodeExecutable} ${commandPath}`,
      source,
      identityPaths: [commandPath]
    };
  }
  if (platform === "win32" && extension === ".ps1") {
    const executable = "powershell.exe";
    const argsPrefix = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", commandPath];
    return {
      executable,
      argsPrefix,
      displayCommand: `${executable} ${argsPrefix.join(" ")}`,
      source,
      identityPaths: [commandPath]
    };
  }
  return {
    executable: commandPath,
    argsPrefix: [],
    displayCommand: commandPath,
    source,
    identityPaths: [commandPath]
  };
}

async function packageEntryCandidates(
  agentKind: RuntimeAgentKind,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<string[]> {
  if (platform !== "win32") return [];
  const appData = environment.APPDATA ?? (
    environment.USERPROFILE
      ? path.join(environment.USERPROFILE, "AppData", "Roaming")
      : undefined
  );
  if (!appData) return [];
  return agentKind === "codex"
    ? [path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js")]
    : [
        path.join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
        path.join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.mjs")
      ];
}

async function resolveCommand(options: DiscoverRuntimeInstallationOptions): Promise<ResolvedCommand> {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const nodeExecutable = options.nodeExecutable ?? process.execPath;

  if (options.commandPath?.trim()) {
    const configured = options.commandPath.trim();
    const hasPathSyntax = path.isAbsolute(configured) || /[\\/]/.test(configured);
    const resolved = hasPathSyntax
      ? path.resolve(cwd, configured)
      : await findOnPath(configured, environment, platform);
    if (resolved && await isFile(resolved)) {
      return await invocationForPath(resolved, "explicit", platform, nodeExecutable, options.agentKind);
    }
    if (hasPathSyntax) {
      throw new Error(`Configured ${options.agentKind} command was not found at ${resolved}.`);
    }
    return {
      executable: configured,
      argsPrefix: [],
      displayCommand: configured,
      source: "explicit",
      identityPaths: []
    };
  }

  const name = commandName(options.agentKind);
  const pathCommand = await findOnPath(name, environment, platform);
  if (pathCommand) {
    return await invocationForPath(pathCommand, "path", platform, nodeExecutable, options.agentKind);
  }

  for (const candidate of await packageEntryCandidates(options.agentKind, environment, platform)) {
    if (await isFile(candidate)) {
      return await invocationForPath(candidate, "package", platform, nodeExecutable, options.agentKind);
    }
  }

  return {
    executable: platform === "win32" ? `${name}.cmd` : name,
    argsPrefix: [],
    displayCommand: platform === "win32" ? `${name}.cmd` : name,
    source: "fallback",
    identityPaths: []
  };
}

function extractVersion(output: string): string | undefined {
  return output.match(/\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)\b/u)?.[1];
}

function detectCapabilities(agentKind: RuntimeAgentKind, helpOutput: string): Record<string, boolean> {
  if (agentKind === "codex") {
    return {
      configOverrides: /(?:^|\s)(?:-c,\s*)?--config\b/m.test(helpOutput),
      jsonEvents: /--json\b/.test(helpOutput),
      outputLastMessage: /--output-last-message\b/.test(helpOutput),
      workspaceWrite: /workspace-write/.test(helpOutput),
      approvalPolicyOverride: /--config\b/.test(helpOutput)
    };
  }
  return {
    settingSources: /--setting-sources\b/.test(helpOutput),
    permissionMode: /--permission-mode\b/.test(helpOutput),
    dontAskPermissionMode: /\bdontAsk\b/.test(helpOutput),
    streamJson: /stream-json/.test(helpOutput),
    noSessionPersistence: /--no-session-persistence\b/.test(helpOutput)
  };
}

async function identityForPath(filePath: string): Promise<Record<string, unknown>> {
  try {
    const stat = await fs.stat(filePath);
    const identity: Record<string, unknown> = {
      path: path.resolve(filePath),
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs)
    };
    if (stat.size <= 5 * 1024 * 1024) {
      identity.sha256 = createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
    }
    return identity;
  } catch {
    return { path: filePath, unavailable: true };
  }
}

export async function discoverRuntimeInstallation(
  options: DiscoverRuntimeInstallationOptions
): Promise<RuntimeInstallation> {
  const hostEnvironment = options.environment ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const resolved = await resolveCommand(options);
  const invocation = {
    executable: resolved.executable,
    argsPrefix: resolved.argsPrefix,
    displayCommand: resolved.displayCommand
  };
  const codexRuntimeHome = options.agentKind === "codex"
    ? await prepareCodexRuntimeHome({
        environment: hostEnvironment,
        includeLocalAuth: options.includeLocalAuth ?? true
      })
    : undefined;
  const environment = codexRuntimeHome?.environment ?? hostEnvironment;
  try {
    const probe = options.probe ?? (async (
      target: RuntimeInstallationInvocation,
      args: string[]
    ): Promise<RuntimeInstallationProbeResult> => {
      return await runProcess(target.executable, args, cwd, 10_000, environment);
    });

    const versionArgs = [...resolved.argsPrefix, "--version"];
    const versionResult = await probe(invocation, versionArgs);
    if (versionResult.exitCode !== 0 || versionResult.error || versionResult.timedOut) {
      const detail = versionResult.error ?? (versionResult.stderr.trim() || "version probe failed");
      throw new Error(`${options.agentKind} CLI could not be launched: ${detail}`);
    }
    const version = extractVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
    const helpArgs = [...resolved.argsPrefix, "--help"];
    const helpResult = await probe(invocation, helpArgs);
    const helpOutputs = [`${helpResult.stdout}\n${helpResult.stderr}`];
    if (options.agentKind === "codex") {
      const execHelpResult = await probe(invocation, [...resolved.argsPrefix, "exec", "--help"]);
      if (execHelpResult.exitCode === 0 && !execHelpResult.error && !execHelpResult.timedOut) {
        helpOutputs.push(`${execHelpResult.stdout}\n${execHelpResult.stderr}`);
      }
    }
    const helpOutput = helpOutputs.join("\n");
    const capabilities = detectCapabilities(options.agentKind, helpOutput);
    const pathIdentities = await Promise.all(resolved.identityPaths.map(identityForPath));
    const fingerprint = hashRuntimeIdentity("installation", {
      agentKind: options.agentKind,
      executable: resolved.executable,
      argsPrefix: resolved.argsPrefix,
      version,
      capabilities,
      pathIdentities
    });

    return {
      schemaVersion: INSTALLATION_SCHEMA_V1,
      id: `${options.agentKind}-installation-${fingerprint.slice(-16)}`,
      agentKind: options.agentKind,
      executable: resolved.executable,
      argsPrefix: [...resolved.argsPrefix],
      displayCommand: resolved.displayCommand,
      source: resolved.source,
      version,
      capabilities,
      fingerprint,
      discoveredAt: (options.now ?? (() => new Date().toISOString()))()
    };
  } finally {
    await codexRuntimeHome?.cleanup();
  }
}
