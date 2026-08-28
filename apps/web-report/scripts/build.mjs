import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { acquireFileLock } from "./build-lock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(appRoot, "src");
const distRoot = path.join(appRoot, "dist");
const lockPath = path.join(appRoot, ".build.lock");
const execFileAsync = promisify(execFile);
const buildLock = await acquireFileLock(lockPath);

try {
  await rm(distRoot, { recursive: true, force: true });
  await mkdir(distRoot, { recursive: true });
  await cp(srcRoot, distRoot, { recursive: true, force: true });

  const viteBin = path.join(appRoot, "node_modules", "vite", "bin", "vite.js");
  const viteConfig = path.join(appRoot, "vite.config.ts");
  const { stdout, stderr } = await execFileAsync(process.execPath, [viteBin, "build", "--config", viteConfig], {
    cwd: appRoot,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
} finally {
  await buildLock.release().catch(() => {});
}

console.log(`web-report built to ${distRoot}`);
