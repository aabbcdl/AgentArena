import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const CODEX_RUNTIME_HOME_HARNESS_INPUTS = [
  "config.toml",
  "AGENTS.md",
  "AGENTS.override.md",
  "rules",
  "skills"
] as const;

export interface PreparedCodexRuntimeHome {
  environment: NodeJS.ProcessEnv;
  sourcePath: string;
  runtimePath: string;
  cleanup(): Promise<void>;
}

function environmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const normalized = name.toUpperCase();
  return Object.entries(environment).find(
    ([key, value]) => key.toUpperCase() === normalized && typeof value === "string" && value.trim()
  )?.[1]?.trim();
}

function resolveSourceCodexHome(environment: NodeJS.ProcessEnv): string {
  const configured = environmentValue(environment, "CODEX_HOME");
  if (configured) return path.resolve(configured);
  const homeDirectory = environmentValue(environment, "HOME")
    ?? environmentValue(environment, "USERPROFILE")
    ?? os.homedir();
  return path.resolve(homeDirectory, ".codex");
}

function withEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  value: string
): NodeJS.ProcessEnv {
  const normalized = name.toUpperCase();
  const result = { ...environment };
  for (const key of Object.keys(result)) {
    if (key.toUpperCase() === normalized) delete result[key];
  }
  result[name] = value;
  return result;
}

async function copyRuntimeInput(sourcePath: string, destinationPath: string): Promise<void> {
  if (!await fs.lstat(sourcePath).catch(() => undefined)) return;
  await fs.cp(sourcePath, destinationPath, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false
  });
}

export async function prepareCodexRuntimeHome(options: {
  environment: NodeJS.ProcessEnv;
  includeLocalAuth: boolean;
}): Promise<PreparedCodexRuntimeHome> {
  const sourcePath = resolveSourceCodexHome(options.environment);
  const runtimePath = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-codex-home-"));
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await fs.rm(runtimePath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100
    });
  };

  try {
    await fs.chmod(runtimePath, 0o700).catch(() => {});
    const inputs = [
      ...CODEX_RUNTIME_HOME_HARNESS_INPUTS,
      ...(options.includeLocalAuth ? ["auth.json"] : [])
    ];
    for (const relativePath of inputs) {
      await copyRuntimeInput(
        path.join(sourcePath, relativePath),
        path.join(runtimePath, relativePath)
      );
    }
    for (const relativePath of ["config.toml", "auth.json"]) {
      await fs.chmod(path.join(runtimePath, relativePath), 0o600).catch(() => {});
    }
    return {
      environment: withEnvironmentValue(options.environment, "CODEX_HOME", runtimePath),
      sourcePath,
      runtimePath,
      cleanup
    };
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
}
