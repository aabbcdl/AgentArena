import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const target = path.resolve("src/validator.js");
const original = await readFile(target, "utf8");
const mutation = original.replace(
  'return value\n    .replace(/<script[\\s\\S]*?<\\/script>/gi, "")',
  'return value'
);
if (mutation === original) throw new Error("Coverage mutation anchor not found");

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", shell: false });
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

await writeFile(target, mutation, "utf8");
try {
  const exitCode = await run(process.execPath, ["--test", "test/validator.test.js"]);
  if (exitCode === 0) {
    throw new Error("Mutation gate did not detect the validator regression");
  }
} finally {
  await writeFile(target, original, "utf8");
}
