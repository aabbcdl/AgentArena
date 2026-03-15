import path from "node:path";
import { promises as fs } from "node:fs";
import { ensureDirectory, TraceEvent } from "@repoarena/core";

export class JsonlTraceRecorder {
  private directoryEnsured = false;

  constructor(private readonly filePath: string) {}

  async record(event: TraceEvent): Promise<void> {
    if (!this.directoryEnsured) {
      await ensureDirectory(path.dirname(this.filePath));
      this.directoryEnsured = true;
    }
    await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}
