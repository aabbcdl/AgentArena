import { rm } from "node:fs/promises";
import path from "node:path";

const packageRoot = process.cwd();

await Promise.all([
  rm(path.join(packageRoot, "dist"), { recursive: true, force: true }),
  rm(path.join(packageRoot, "tsconfig.tsbuildinfo"), { force: true })
]);
