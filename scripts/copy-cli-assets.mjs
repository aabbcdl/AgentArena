import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const webReportDist = path.join(repoRoot, "apps", "web-report", "dist");
const officialTaskpacks = path.join(repoRoot, "examples", "taskpacks", "official");
const demoTaskpack = path.join(repoRoot, "examples", "taskpacks", "demo", "demo-ui-tour.yaml");
const builtinRepos = path.join(repoRoot, "examples", "taskpacks", "repos");
const cliAssets = path.join(repoRoot, "packages", "cli", "assets");

await rm(cliAssets, { recursive: true, force: true });
await mkdir(cliAssets, { recursive: true });
await cp(webReportDist, path.join(cliAssets, "web-report"), { recursive: true, force: true });
await cp(officialTaskpacks, path.join(cliAssets, "taskpacks", "official"), { recursive: true, force: true });
await mkdir(path.join(cliAssets, "taskpacks", "demo"), { recursive: true });
await cp(demoTaskpack, path.join(cliAssets, "taskpacks", "demo", "demo-ui-tour.yaml"), { force: true });
await cp(builtinRepos, path.join(cliAssets, "taskpacks", "repos"), {
  recursive: true,
  force: true,
  filter: (sourcePath) => {
    const relative = path.relative(builtinRepos, sourcePath);
    if (!relative) return true;
    return !relative.split(path.sep).some((segment) => [".agentarena", ".git", "node_modules", "output", "dist"].includes(segment));
  }
});

// Generate version-info.json without changing package.json. Release automation
// may provide a fixed build time through SOURCE_DATE_EPOCH.

const rootPkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const cliPkg = JSON.parse(readFileSync(path.join(repoRoot, "packages", "cli", "package.json"), "utf8"));
const buildMeta = {
  version: cliPkg.version,
  buildNumber: rootPkg.buildNumber ?? 0,
  buildTime: resolveBuildTime(repoRoot),
  gitCommit: getGitCommit(repoRoot),
};
await writeFile(
  path.join(cliAssets, "version-info.json"),
  JSON.stringify(buildMeta, null, 2) + "\n",
  "utf8"
);

console.log(`CLI runtime assets copied to ${cliAssets}`);
console.log(`Version: v${cliPkg.version} #${buildMeta.buildNumber} (${buildMeta.gitCommit.slice(0, 7)})`);

function getGitCommit(cwd) {
  try {
    const hash = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return hash || "unknown";
  } catch {
    return "unknown";
  }
}

function resolveBuildTime(cwd) {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) {
    return new Date(Number(epoch) * 1000).toISOString();
  }
  try {
    return execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}
