import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  HARNESS_SNAPSHOT_SCHEMA_V1,
  type HarnessSnapshot,
  type HarnessSnapshotEntry,
  hashRuntimeIdentity,
  normalizePath,
  type RuntimeAgentKind,
  type RuntimeInstallation,
  type RuntimeProfileMode
} from "@agentarena/core";
import { CODEX_RUNTIME_HOME_HARNESS_INPUTS } from "./codex-runtime-home.js";

export interface CaptureHarnessSnapshotOptions {
  agentKind: RuntimeAgentKind;
  installation: RuntimeInstallation;
  repositoryPath: string;
  repositoryBaselineIdentity: string;
  profileMode?: RuntimeProfileMode;
  homeDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  now?: () => string;
}

interface SnapshotTarget {
  absolutePath: string;
  logicalPath: string;
  scope: HarnessSnapshotEntry["scope"];
  identity?: (filePath: string) => Promise<string>;
}

const MAX_HARNESS_FILES = 10_000;
const MAX_HARNESS_FILE_BYTES = 20 * 1024 * 1024;

function entryKind(logicalPath: string): HarnessSnapshotEntry["kind"] {
  const normalized = logicalPath.toLowerCase();
  if (/(?:^|\/)(?:agents|claude)\.md$/.test(normalized)) return "instruction";
  if (/(?:^|\/)skill\.md$|(?:^|\/)skills(?:\/|$)/.test(normalized)) return "skill";
  if (/mcp/.test(normalized)) return "mcp";
  if (/hook/.test(normalized)) return "hook";
  if (/(?:^|\/)(?:rules?|policies)(?:\/|$)|\.rules?$/.test(normalized)) return "rule";
  if (/plugin/.test(normalized)) return "plugin";
  return "settings";
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function fileIdentity(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_HARNESS_FILE_BYTES) {
    return hashRuntimeIdentity("harness-large-file", {
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs)
    });
  }
  return `sha256:${createHash("sha256").update(await fs.readFile(filePath)).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectSecretPresence(record: Record<string, unknown>, names: string[]): string[] {
  return names.filter((name) => typeof record[name] === "string" && record[name] !== "");
}

async function jsonProjectionIdentity(
  filePath: string,
  prefix: string,
  project: (value: Record<string, unknown>) => unknown
): Promise<string> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!isRecord(parsed)) return fileIdentity(filePath);
    return hashRuntimeIdentity(prefix, project(parsed));
  } catch {
    return fileIdentity(filePath);
  }
}

async function codexAuthIdentity(filePath: string): Promise<string> {
  return jsonProjectionIdentity(filePath, "codex-auth", (state) => {
    const tokens = isRecord(state.tokens) ? state.tokens : {};
    const accountId = typeof tokens.account_id === "string"
      ? hashRuntimeIdentity("account-id", tokens.account_id)
      : undefined;
    return {
      authMode: typeof state.auth_mode === "string" ? state.auth_mode : undefined,
      accountId,
      apiKeyIdentity: typeof state.OPENAI_API_KEY === "string" && state.OPENAI_API_KEY !== ""
        ? hashRuntimeIdentity("credential", state.OPENAI_API_KEY)
        : undefined,
      configured: projectSecretPresence(state, ["OPENAI_API_KEY"]).length > 0
        || projectSecretPresence(tokens, ["access_token", "refresh_token", "id_token"]).length > 0
    };
  });
}

function projectCodexConfig(value: string): string {
  const lines = value.split(/\r?\n/);
  const projected: string[] = [];
  const tableHeader = /^\s*\[\[?.*?\]\]?\s*(?:#.*)?$/;
  const projectHeader = /^\s*\[\s*projects\s*\./i;
  const trustAssignment = /^\s*(?:trust_level|"trust_level"|'trust_level')\s*=/i;

  for (let index = 0; index < lines.length;) {
    const header = lines[index];
    if (!projectHeader.test(header)) {
      projected.push(header);
      index += 1;
      continue;
    }

    const body: string[] = [];
    index += 1;
    while (index < lines.length && !tableHeader.test(lines[index])) {
      if (!trustAssignment.test(lines[index])) body.push(lines[index]);
      index += 1;
    }
    const hasBehavioralEntry = body.some((line) => {
      const trimmed = line.trim();
      return trimmed !== "" && !trimmed.startsWith("#");
    });
    if (hasBehavioralEntry) projected.push(header, ...body);
  }

  return projected.join("\n").replace(/\n+$/u, "");
}

async function codexConfigIdentity(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_HARNESS_FILE_BYTES) return fileIdentity(filePath);
    return hashRuntimeIdentity("codex-config", projectCodexConfig(await fs.readFile(filePath, "utf8")));
  } catch {
    return fileIdentity(filePath);
  }
}

function currentProjectState(
  state: Record<string, unknown>,
  repositoryPath: string
): Record<string, unknown> | undefined {
  if (!isRecord(state.projects)) return undefined;
  const expected = normalizePath(path.resolve(repositoryPath)).toLowerCase();
  const match = Object.entries(state.projects).find(([projectPath]) =>
    normalizePath(path.resolve(projectPath)).toLowerCase() === expected
  );
  return match && isRecord(match[1]) ? match[1] : undefined;
}

async function claudeStateIdentity(
  filePath: string,
  repositoryPath: string,
  includeProviderIdentity: boolean
): Promise<string> {
  return jsonProjectionIdentity(filePath, "claude-state", (state) => {
    const oauthAccount = isRecord(state.oauthAccount) ? state.oauthAccount : {};
    const project = currentProjectState(state, repositoryPath);
    return {
      activeProviderProfileId: includeProviderIdentity && typeof state.activeProviderProfileId === "string"
        ? state.activeProviderProfileId
        : undefined,
      oauthAccount: includeProviderIdentity ? {
        accountUuid: typeof oauthAccount.accountUuid === "string"
          ? hashRuntimeIdentity("account-id", oauthAccount.accountUuid)
          : undefined,
        organizationUuid: typeof oauthAccount.organizationUuid === "string"
          ? hashRuntimeIdentity("organization-id", oauthAccount.organizationUuid)
          : undefined
      } : undefined,
      providerProfiles: includeProviderIdentity && Array.isArray(state.providerProfiles)
        ? state.providerProfiles.map((candidate) => {
            if (!isRecord(candidate)) return null;
            return {
              id: candidate.id,
              name: candidate.name,
              provider: candidate.provider,
              baseUrl: candidate.baseUrl,
              model: candidate.model,
              authScheme: candidate.authScheme,
              authHeader: candidate.authHeader,
              credentialIdentity: typeof candidate.apiKey === "string" && candidate.apiKey !== ""
                ? hashRuntimeIdentity("credential", candidate.apiKey)
                : typeof candidate.authHeaderValue === "string" && candidate.authHeaderValue !== ""
                  ? hashRuntimeIdentity("credential", candidate.authHeaderValue)
                  : undefined,
              credentialsConfigured: projectSecretPresence(candidate, [
                "apiKey",
                "authHeaderValue"
              ]).length > 0
            };
          })
        : [],
      mcpServers: state.mcpServers,
      project: project ? {
        allowedTools: project.allowedTools,
        mcpContextUris: project.mcpContextUris,
        mcpServers: project.mcpServers,
        enabledMcpjsonServers: project.enabledMcpjsonServers,
        disabledMcpjsonServers: project.disabledMcpjsonServers,
        hasTrustDialogAccepted: project.hasTrustDialogAccepted,
        hasCompletedProjectOnboarding: project.hasCompletedProjectOnboarding,
        hasClaudeMdExternalIncludesApproved: project.hasClaudeMdExternalIncludesApproved
      } : undefined
    };
  });
}

async function collectTargetEntries(
  target: SnapshotTarget,
  entries: Map<string, HarnessSnapshotEntry>,
  budget: { files: number }
): Promise<void> {
  if (!(await exists(target.absolutePath))) return;
  const stat = await fs.lstat(target.absolutePath);
  if (stat.isSymbolicLink()) {
    const linkTarget = await fs.readlink(target.absolutePath);
    entries.set(target.logicalPath, {
      scope: target.scope,
      kind: entryKind(target.logicalPath),
      path: target.logicalPath,
      identity: hashRuntimeIdentity("harness-symlink", linkTarget)
    });
    return;
  }
  if (stat.isFile()) {
    budget.files += 1;
    if (budget.files > MAX_HARNESS_FILES) {
      throw new Error(`Harness snapshot exceeds ${MAX_HARNESS_FILES} files.`);
    }
    entries.set(target.logicalPath, {
      scope: target.scope,
      kind: entryKind(target.logicalPath),
      path: target.logicalPath,
      identity: target.identity
        ? await target.identity(target.absolutePath)
        : await fileIdentity(target.absolutePath)
    });
    return;
  }
  if (!stat.isDirectory()) return;

  const children = (await fs.readdir(target.absolutePath, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    await collectTargetEntries(
      {
        absolutePath: path.join(target.absolutePath, child.name),
        logicalPath: `${target.logicalPath}/${normalizePath(child.name)}`,
        scope: target.scope
      },
      entries,
      budget
    );
  }
}

function projectTargets(repositoryPath: string, agentKind: RuntimeAgentKind): SnapshotTarget[] {
  const relativePaths = agentKind === "codex"
    ? ["AGENTS.md", ".codex", ".agents/skills"]
    : ["CLAUDE.md", ".mcp.json", ".claude", ".agents/skills"];
  return relativePaths.map((relativePath) => ({
    absolutePath: path.join(repositoryPath, relativePath),
    logicalPath: `project:${normalizePath(relativePath)}`,
    scope: "project" as const
  }));
}

function userTargets(
  homeDirectory: string,
  environment: NodeJS.ProcessEnv,
  agentKind: RuntimeAgentKind,
  repositoryPath: string,
  profileMode: RuntimeProfileMode
): SnapshotTarget[] {
  const codexHome = environment.CODEX_HOME?.trim() || path.join(homeDirectory, ".codex");
  const claudeHome = environment.CLAUDE_CONFIG_DIR?.trim() || path.join(homeDirectory, ".claude");
  const shared: SnapshotTarget[] = [{
    absolutePath: path.join(homeDirectory, ".agents", "skills"),
    logicalPath: "user:.agents/skills",
    scope: "user" as const
  }];
  if (agentKind === "codex") {
    const targets: SnapshotTarget[] = CODEX_RUNTIME_HOME_HARNESS_INPUTS.map((relativePath) => ({
      absolutePath: path.join(codexHome, relativePath),
      logicalPath: `user:.codex/${normalizePath(relativePath)}`,
      scope: "user" as const,
      ...(relativePath === "config.toml" ? { identity: codexConfigIdentity } : {})
    }));
    return [
      ...targets,
      ...(profileMode === "inherit-local" ? [{
        absolutePath: path.join(codexHome, "auth.json"),
        logicalPath: "user:.codex/auth.json",
        scope: "user" as const,
        identity: codexAuthIdentity
      }] : []),
      ...shared
    ];
  }
  const targets: SnapshotTarget[] = [
    ["settings.json", ".claude/settings.json"],
    ["settings.local.json", ".claude/settings.local.json"],
    ["CLAUDE.md", ".claude/CLAUDE.md"],
    ["skills", ".claude/skills"],
    ["commands", ".claude/commands"],
    ["agents", ".claude/agents"],
    ["hooks", ".claude/hooks"],
    [path.join("plugins", "installed_plugins.json"), ".claude/plugins/installed_plugins.json"]
  ].map(([relativePath, logicalPath]) => ({
    absolutePath: path.join(claudeHome, relativePath),
    logicalPath: `user:${normalizePath(logicalPath)}`,
    scope: "user" as const
  }));
  return [...targets, {
    absolutePath: path.join(homeDirectory, ".claude.json"),
    logicalPath: "user:.claude.json",
    scope: "user" as const,
    identity: (filePath: string) => claudeStateIdentity(
      filePath,
      repositoryPath,
      profileMode === "inherit-local"
    )
  }, ...shared];
}

function relevantEnvironment(
  environment: NodeJS.ProcessEnv,
  agentKind: RuntimeAgentKind,
  profileMode: RuntimeProfileMode
): Array<[string, string]> {
  const exactNames = new Set([
    "PATH",
    "Path",
    "PATHEXT",
    ...(agentKind === "codex" ? ["CODEX_HOME"] : ["CLAUDE_CONFIG_DIR"]),
    "HOME",
    "USERPROFILE",
    "SHELL",
    "COMSPEC",
    ...(agentKind === "codex" ? ["OPENAI_API_KEY", "OPENAI_BASE_URL"] : [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL"
    ])
  ]);
  const agentPrefix = agentKind === "codex"
    ? /^(?:CODEX|OPENAI|MCP)_/i
    : /^(?:CLAUDE|ANTHROPIC|MCP)_/i;
  const ignoredLauncherNames = new Set([
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    "CODEX_THREAD_ID"
  ]);
  const managedProviderNames = agentKind === "codex"
    ? /^(?:OPENAI_API_KEY|OPENAI_BASE_URL)$/i
    : /^(?:ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDE_CODE_USE_(?:BEDROCK|FOUNDRY|VERTEX)$)/i;
  return Object.entries(environment)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .filter(([name]) => !ignoredLauncherNames.has(name.toUpperCase()))
    .filter(([name]) => profileMode !== "managed-provider" || !managedProviderNames.test(name))
    .filter(([name]) => exactNames.has(name) || agentPrefix.test(name))
    .sort(([left], [right]) => left.localeCompare(right));
}

export async function captureHarnessSnapshot(
  options: CaptureHarnessSnapshotOptions
): Promise<HarnessSnapshot> {
  if (options.installation.agentKind !== options.agentKind) {
    throw new Error("Harness snapshot agent does not match the discovered installation.");
  }
  const environment = options.environment ?? process.env;
  const profileMode = options.profileMode ?? "inherit-local";
  const homeDirectory = options.homeDirectory ?? environment.HOME ?? environment.USERPROFILE;
  if (!homeDirectory) {
    throw new Error("Cannot capture the Harness without a user home directory.");
  }

  const entries = new Map<string, HarnessSnapshotEntry>();
  const budget = { files: 0 };
  for (const target of [
    ...projectTargets(options.repositoryPath, options.agentKind),
    ...userTargets(
      homeDirectory,
      environment,
      options.agentKind,
      options.repositoryPath,
      profileMode
    )
  ]) {
    await collectTargetEntries(target, entries, budget);
  }

  const environmentEntries = relevantEnvironment(environment, options.agentKind, profileMode).map(([name, value]) => ({
    scope: "environment" as const,
    kind: "environment" as const,
    path: `environment:${name}`,
    identity: hashRuntimeIdentity("environment-value", { name, value })
  }));
  for (const entry of environmentEntries) entries.set(entry.path, entry);
  entries.set("installation:executable", {
    scope: "installation",
    kind: "executable",
    path: "installation:executable",
    identity: options.installation.fingerprint
  });

  const orderedEntries = [...entries.values()].sort((left, right) =>
    `${left.scope}:${left.path ?? ""}`.localeCompare(`${right.scope}:${right.path ?? ""}`)
  );
  const hostEnvironmentSnapshotId = hashRuntimeIdentity(
    "host-environment",
    environmentEntries.map(({ path: entryPath, identity }) => ({ path: entryPath, identity }))
  );
  const riskFlags = [
    ...(orderedEntries.some((entry) => entry.scope === "user") ? ["inherits-user-harness"] : []),
    ...(orderedEntries.some((entry) => entry.scope === "project") ? ["inherits-project-harness"] : []),
    ...(orderedEntries.some((entry) => entry.kind === "hook") ? ["inherits-hooks"] : []),
    ...(orderedEntries.some((entry) => entry.kind === "mcp") ? ["inherits-mcp"] : [])
  ];
  const snapshotId = hashRuntimeIdentity("harness-snapshot", {
    agentKind: options.agentKind,
    installationFingerprint: options.installation.fingerprint,
    hostEnvironmentSnapshotId,
    repositoryBaselineIdentity: options.repositoryBaselineIdentity,
    entries: orderedEntries,
    riskFlags
  });

  return {
    schemaVersion: HARNESS_SNAPSHOT_SCHEMA_V1,
    snapshotId,
    agentKind: options.agentKind,
    installationFingerprint: options.installation.fingerprint,
    hostEnvironmentSnapshotId,
    repositoryBaselineIdentity: options.repositoryBaselineIdentity,
    entries: orderedEntries,
    riskFlags,
    createdAt: (options.now ?? (() => new Date().toISOString()))()
  };
}
