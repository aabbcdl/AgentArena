import { mkdir, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(appRoot, "src");
const distRoot = path.join(appRoot, "dist");

await mkdir(distRoot, { recursive: true });
await cp(srcRoot, distRoot, { recursive: true, force: true });

console.log(`web-report built to ${distRoot}`);
