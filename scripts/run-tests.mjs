import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const testsDirectory = path.join(scriptsDirectory, "..", "tests");
const testFiles = (await readdir(testsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => path.join(testsDirectory, entry.name))
  .sort();

const help = spawnSync(process.execPath, ["--help"], { encoding: "utf8" });
const helpText = `${help.stdout ?? ""}\n${help.stderr ?? ""}`;
const isolationArgs = helpText.includes("--experimental-test-isolation")
  ? ["--experimental-test-isolation=process"]
  : [];

const result = spawnSync(
  process.execPath,
  [...isolationArgs, "--test", "--test-concurrency=1", ...testFiles],
  { stdio: "inherit" }
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
