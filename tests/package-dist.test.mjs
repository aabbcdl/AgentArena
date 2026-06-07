import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_ROOT = path.join(REPO_ROOT, "packages");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFiles(root, predicate) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findFiles(entryPath, predicate)));
    } else if (predicate(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

test("package dist source maps reference existing TypeScript sources", async () => {
  const packageDirs = await readdir(PACKAGES_ROOT, { withFileTypes: true });
  const missingSources = [];

  for (const packageDir of packageDirs) {
    if (!packageDir.isDirectory()) {
      continue;
    }

    const packageRoot = path.join(PACKAGES_ROOT, packageDir.name);
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (!(await exists(packageJsonPath))) {
      continue;
    }

    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (!packageJson.files?.includes("dist")) {
      continue;
    }

    const distRoot = path.join(packageRoot, "dist");
    const mapFiles = await findFiles(distRoot, (filePath) => filePath.endsWith(".js.map"));

    for (const mapFile of mapFiles) {
      const sourceMap = JSON.parse(await readFile(mapFile, "utf8"));
      for (const source of sourceMap.sources ?? []) {
        const sourcePath = path.resolve(path.dirname(mapFile), source);
        if (!(await exists(sourcePath))) {
          missingSources.push(
            `${path.relative(REPO_ROOT, mapFile)} -> ${path.relative(REPO_ROOT, sourcePath)}`
          );
        }
      }
    }
  }

  assert.deepEqual(missingSources, []);
});
