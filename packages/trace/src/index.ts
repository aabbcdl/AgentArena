import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { ensureDirectory, type TraceEvent } from "@agentarena/core";

export interface TraceFilter {
  agentId?: string;
  type?: string | string[];
  startTime?: string;
  endTime?: string;
  messageContains?: string;
}

export interface TraceQueryOptions {
  limit?: number;
  offset?: number;
  filter?: TraceFilter;
  reverse?: boolean;
}

function matchesFilter(event: TraceEvent, filter: TraceFilter): boolean {
  if (filter.agentId && event.agentId !== filter.agentId) {
    return false;
  }
  if (filter.type) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type];
    if (!types.includes(event.type)) {
      return false;
    }
  }
  if (filter.startTime && event.timestamp < filter.startTime) {
    return false;
  }
  if (filter.endTime && event.timestamp > filter.endTime) {
    return false;
  }
  if (filter.messageContains && !event.message.toLowerCase().includes(filter.messageContains.toLowerCase())) {
    return false;
  }
  return true;
}

export class JsonlTraceRecorder {
  private directoryEnsured = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async record(event: TraceEvent): Promise<void> {
    // Queue writes to prevent race conditions
    this.writeQueue = this.writeQueue.then(async () => {
      if (!this.directoryEnsured) {
        await ensureDirectory(path.dirname(this.filePath));
        this.directoryEnsured = true;
      }
      await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
    });
    await this.writeQueue;
  }

  async recordBatch(events: TraceEvent[]): Promise<void> {
    if (events.length === 0) return;

    this.writeQueue = this.writeQueue.then(async () => {
      if (!this.directoryEnsured) {
        await ensureDirectory(path.dirname(this.filePath));
        this.directoryEnsured = true;
      }
      const lines = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
      await fs.appendFile(this.filePath, lines, "utf8");
    });
    await this.writeQueue;
  }

  async readAll(): Promise<TraceEvent[]> {
    const events: TraceEvent[] = [];
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());
      for (const line of lines) {
        try {
          events.push(JSON.parse(line) as TraceEvent);
        } catch {
          // Skip malformed lines
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    return events;
  }

  async query(options: TraceQueryOptions = {}): Promise<TraceEvent[]> {
    const events: TraceEvent[] = [];
    const { limit, offset = 0, filter, reverse } = options;

    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());
      
      const parsedEvents: TraceEvent[] = [];
      for (const line of lines) {
        try {
          parsedEvents.push(JSON.parse(line) as TraceEvent);
        } catch {
          // Skip malformed lines
        }
      }

      if (reverse) {
        parsedEvents.reverse();
      }

      let filteredEvents = parsedEvents;
      if (filter) {
        filteredEvents = parsedEvents.filter((event) => this.matchesFilter(event, filter));
      }

      const start = offset;
      const end = limit !== undefined ? start + limit : undefined;
      events.push(...filteredEvents.slice(start, end));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    return events;
  }

  private matchesFilter(event: TraceEvent, filter: TraceFilter): boolean {
    return matchesFilter(event, filter);
  }

  async getEventCount(): Promise<number> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      return content.split("\n").filter((line) => line.trim()).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return 0;
      }
      throw error;
    }
  }

  async getEventTypes(): Promise<string[]> {
    const events = await this.readAll();
    const types = new Set(events.map((event) => event.type));
    return Array.from(types).sort();
  }

  async getAgentIds(): Promise<string[]> {
    const events = await this.readAll();
    const agentIds = new Set(events.map((event) => event.agentId));
    return Array.from(agentIds).sort();
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async compress(): Promise<string> {
    const compressedPath = `${this.filePath}.gz`;
    const sourceStream = createReadStream(this.filePath);
    const gzipStream = createGzip();
    const fileHandle = await fs.open(compressedPath, "w");
    try {
      const destinationStream = fileHandle.createWriteStream();
      await pipeline(sourceStream, gzipStream, destinationStream);
    } finally {
      await fileHandle.close();
    }
    return compressedPath;
  }

  static async decompress(compressedPath: string, outputPath: string): Promise<void> {
    const sourceStream = createReadStream(compressedPath);
    const gunzipStream = createGunzip();
    const fileHandle = await fs.open(outputPath, "w");
    try {
      const destinationStream = fileHandle.createWriteStream();
      await pipeline(sourceStream, gunzipStream, destinationStream);
    } finally {
      await fileHandle.close();
    }
  }

  static async readCompressed(compressedPath: string): Promise<TraceEvent[]> {
    const events: TraceEvent[] = [];
    const tempOutputPath = `${compressedPath}.${randomUUID()}.tmp.jsonl`;

    try {
      await JsonlTraceRecorder.decompress(compressedPath, tempOutputPath);
      const content = await fs.readFile(tempOutputPath, "utf8");
      for (const line of content.split("\n")) {
        if (line.trim()) {
          try {
            events.push(JSON.parse(line) as TraceEvent);
          } catch {
            // Skip malformed lines
          }
        }
      }
      return events;
    } finally {
      await fs.rm(tempOutputPath, { force: true }).catch(() => {});
    }
  }
}

export class InMemoryTraceRecorder {
  private events: TraceEvent[] = [];

  async record(event: TraceEvent): Promise<void> {
    this.events.push({ ...event });
  }

  async recordBatch(events: TraceEvent[]): Promise<void> {
    this.events.push(...events.map((event) => ({ ...event })));
  }

  getEvents(): TraceEvent[] {
    return [...this.events];
  }

  query(options: TraceQueryOptions = {}): TraceEvent[] {
    const { limit, offset = 0, filter, reverse } = options;

    let filteredEvents = [...this.events];
    if (filter) {
      filteredEvents = filteredEvents.filter((event) => this.matchesFilter(event, filter));
    }

    if (reverse) {
      filteredEvents.reverse();
    }

    const start = offset;
    const end = limit !== undefined ? start + limit : undefined;
    return filteredEvents.slice(start, end);
  }

  private matchesFilter(event: TraceEvent, filter: TraceFilter): boolean {
    return matchesFilter(event, filter);
  }

  clear(): void {
    this.events = [];
  }

  getEventCount(): number {
    return this.events.length;
  }

  getEventTypes(): string[] {
    const types = new Set(this.events.map((event) => event.type));
    return Array.from(types).sort();
  }

  getAgentIds(): string[] {
    const agentIds = new Set(this.events.map((event) => event.agentId));
    return Array.from(agentIds).sort();
  }
}
