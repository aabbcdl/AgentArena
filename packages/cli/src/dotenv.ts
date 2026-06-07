import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Load .env file from the current working directory.
 * Simple parser — no external dependencies.
 * Supports: KEY=value, KEY="value", # comments, blank lines.
 * Does NOT override already-set environment variables.
 */
export function loadDotEnv(dir?: string): void {
  const envPath = path.join(dir ?? process.cwd(), ".env");
  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    return; // No .env file — silently skip
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Don't override already-set env vars
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
