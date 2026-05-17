import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TaskPack } from "@agentarena/core";
import { isInternalUrl, resolveRepoSource } from "@agentarena/core";
import { loadTaskPack } from "@agentarena/taskpacks";

function redactToken(input: string, token: string): string {
  if (!token) return input;
  return input.split(token).join("***");
}

async function createAskpassScript(): Promise<{ scriptPath: string; cleanup: () => Promise<void> }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-askpass-"));
  const isWindows = process.platform === "win32";
  const askpassMjs = path.join(tmpDir, "askpass.mjs");
  const mjsContent = 'const p=process.argv[2]||"";process.stdout.write(p.includes("Username")?(process.env.GIT_ASKPASS_USER||""):(process.env.GIT_ASKPASS_PASS||""));\n';
  await fs.writeFile(askpassMjs, mjsContent);
  let scriptPath: string;
  if (isWindows) {
    const cmdPath = path.join(tmpDir, "askpass.cmd");
    await fs.writeFile(cmdPath, `@node "${askpassMjs}" %*\r\n`);
    scriptPath = cmdPath;
  } else {
    await fs.writeFile(askpassMjs, `#!/usr/bin/env node\n${mjsContent}`, { mode: 0o700 });
    scriptPath = askpassMjs;
  }
  return {
    scriptPath,
    cleanup: async () => {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

export interface RepoResolution {
  repoPath: string;
  userRepoPath: string;
  task: TaskPack;
}

export interface RepoResolutionOptions {
  repoPath: string;
  taskPath: string;
  builtinReposRoot?: string;
}

export async function resolveAndValidateRepo(
  options: RepoResolutionOptions
): Promise<RepoResolution> {
  const userRepoPath = path.resolve(options.repoPath);
  const task = await loadTaskPack(options.taskPath);
  const builtinReposRoot = options.builtinReposRoot ?? path.join(path.dirname(options.taskPath), "..", "repos");
  const repoResolution = resolveRepoSource(task.repoSource, userRepoPath, builtinReposRoot);
  const repoPath = path.resolve(repoResolution.repoPath);

  if (repoResolution.kind === "builtin") {
    try {
      const stat = await fs.stat(repoPath);
      if (!stat.isDirectory()) {
        throw new Error(`Builtin repo path is not a directory: "${repoPath}"`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Builtin repo not found: "${repoPath}". ` +
          `The task pack requires repoSource "${task.repoSource}" but the directory does not exist.`
        );
      }
      throw error;
    }
  }

  if (repoResolution.kind === "url") {
    try {
      const stat = await fs.stat(repoPath);
      if (!stat.isDirectory()) {
        throw new Error(`URL repo path is not a directory: "${repoPath}"`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const repoUrl = task.repoSource;
        if (typeof repoUrl !== "string" || !repoUrl.startsWith("http")) {
          throw new Error(`Invalid URL repoSource: "${repoUrl}"`);
        }
        if (isInternalUrl(repoUrl)) {
          throw new Error(`Cannot clone from internal/private URL: "${repoUrl}". Only public internet URLs are allowed.`);
        }
        const parentDir = path.dirname(repoPath);
        await fs.mkdir(parentDir, { recursive: true });
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);

        const gitAuthToken = process.env.GIT_AUTH_TOKEN;
        const gitUsername = process.env.GIT_USERNAME;
        const gitPassword = process.env.GIT_PASSWORD;
        const hasAuth = !!(gitAuthToken || (gitUsername && gitPassword));

        let askpass: { scriptPath: string; cleanup: () => Promise<void> } | undefined;
        const cloneEnv: Record<string, string> = { ...process.env as Record<string, string>, GIT_TERMINAL_PROMPT: "0" };

        if (hasAuth) {
          askpass = await createAskpassScript();
          cloneEnv.GIT_ASKPASS = askpass.scriptPath;
          if (gitAuthToken) {
            cloneEnv.GIT_ASKPASS_USER = gitAuthToken;
            cloneEnv.GIT_ASKPASS_PASS = "";
          } else {
            cloneEnv.GIT_ASKPASS_USER = gitUsername ?? "";
            cloneEnv.GIT_ASKPASS_PASS = gitPassword ?? "";
          }
        }

        try {
          await execFileAsync("git", ["clone", "--depth", "1", repoUrl, repoPath], {
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
            env: cloneEnv,
          });
        } catch (cloneError) {
          const authHint = !hasAuth
            ? " Set GIT_AUTH_TOKEN or GIT_USERNAME+GIT_PASSWORD for private repositories."
            : "";
          let message = cloneError instanceof Error ? cloneError.message : String(cloneError);
          if (gitAuthToken) message = redactToken(message, gitAuthToken);
          if (gitPassword) message = redactToken(message, gitPassword);
          if (gitUsername) message = redactToken(message, gitUsername);
          throw new Error(
            `Failed to clone URL repoSource "${repoUrl}": ${message}${authHint}`
          );
        } finally {
          if (askpass) await askpass.cleanup();
        }
      } else {
        throw error;
      }
    }
  }

  if (repoResolution.kind === "user") {
    try {
      const stat = await fs.stat(repoPath);
      if (!stat.isDirectory()) {
        throw new Error(`User repo path is not a directory: "${repoPath}"`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`User repo not found: "${repoPath}". The specified repository path does not exist.`);
      }
      throw error;
    }
  }

  return { repoPath, userRepoPath, task };
}
