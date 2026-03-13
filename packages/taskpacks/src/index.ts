import { promises as fs } from "node:fs";
import path from "node:path";
import { TaskPack } from "@repoarena/core";

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Task pack field "${label}" must be a non-empty string.`);
  }

  return value;
}

export async function loadTaskPack(taskPath: string): Promise<TaskPack> {
  const resolvedPath = path.resolve(taskPath);
  const extension = path.extname(resolvedPath).toLowerCase();

  if (extension !== ".json") {
    throw new Error("This initial slice supports JSON task packs only.");
  }

  const rawContent = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(rawContent) as Record<string, unknown>;

  const successCommands = Array.isArray(parsed.successCommands) ? parsed.successCommands : [];

  return {
    id: assertString(parsed.id, "id"),
    title: assertString(parsed.title, "title"),
    description: typeof parsed.description === "string" ? parsed.description : undefined,
    prompt: assertString(parsed.prompt, "prompt"),
    successCommands: successCommands.map((value, index) => {
      if (!value || typeof value !== "object") {
        throw new Error(`Task pack success command at index ${index} must be an object.`);
      }

      return {
        label: assertString((value as Record<string, unknown>).label, `successCommands[${index}].label`),
        command: assertString((value as Record<string, unknown>).command, `successCommands[${index}].command`)
      };
    })
  };
}
