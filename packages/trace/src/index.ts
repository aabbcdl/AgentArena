import path from "node:path";
import { promises as fs } from "node:fs";
import { ensureDirectory, TraceEvent } from "@repoarena/core";

export class JsonlTraceRecorder {
  constructor(private readonly filePath: string) {}

  async record(event: TraceEvent): Promise<void> {
    await ensureDirectory(path.dirname(this.filePath));
    await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}
