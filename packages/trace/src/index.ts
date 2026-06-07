import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { ensureDirectory, logger, metrics, type TraceEvent } from "@agentarena/core";
import { matchesFilter, type TraceFilter, type TraceQueryOptions } from "./types.js";

function logMalformedTraceLine(filePath: string, line: string): void {
  logger.warn("trace", "trace.malformed", "Skipping malformed trace line", {
    metadata: {
      filePath,
      preview: line.slice(0, 100)
    }
  });
}

/**
 * Read trace events from a JSONL file using streaming to handle large files.
 * Returns the events and a count of any malformed lines encountered.
 */
async function readTraceFileStreaming(filePath: string): Promise<{ events: TraceEvent[]; malformedCount: number }> {
  const events: TraceEvent[] = [];
  let malformedCount = 0;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as TraceEvent);
    } catch {
      malformedCount++;
      logMalformedTraceLine(filePath, line);
    }
  }

  return { events, malformedCount };
}

/**
 * Stream-trace query: reads JSONL line by line, applies filter and pagination
 * without loading all events into memory. Stops as soon as the requested page
 * is satisfied, making it safe for large trace files.
 *
 * For `reverse` queries (most-recent-first) we must read the entire file,
 * but we still apply the filter during streaming to reduce memory pressure.
 */
async function queryTraceFileStream(
  filePath: string,
  options: TraceQueryOptions = {}
): Promise<{ events: TraceEvent[]; malformedCount: number }> {
  const { limit, offset = 0, filter, reverse } = options;
  let malformedCount = 0;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  // For reverse queries, we need all filtered events first
  if (reverse) {
    const filtered: TraceEvent[] = [];
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as TraceEvent;
        if (!filter || matchesFilter(event, filter)) {
          filtered.push(event);
        }
      } catch {
        malformedCount++;
        logMalformedTraceLine(filePath, line);
      }
    }
    filtered.reverse();
    const end = limit !== undefined ? offset + limit : undefined;
    return { events: filtered.slice(offset, end), malformedCount };
  }

  // Forward query: streaming with early termination
  let skipped = 0;
  const results: TraceEvent[] = [];
  const needed = limit !== undefined ? offset + limit : Infinity;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as TraceEvent;
      if (filter && !matchesFilter(event, filter)) continue;

      if (skipped < offset) {
        skipped++;
        continue;
      }

      results.push(event);
      if (results.length >= needed - offset) {
        rl.close();
        stream.destroy();
        break;
      }
    } catch {
      malformedCount++;
      logMalformedTraceLine(filePath, line);
    }
  }

  return { events: results, malformedCount };
}

export class JsonlTraceRecorder {
  private directoryEnsured = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private writeFailed = false;

  constructor(private readonly filePath: string) {}

  async close(): Promise<void> {
    await this.writeQueue;
  }

  async record(event: TraceEvent): Promise<void> {
    // If a previous write failed, don't queue more - fail fast
    if (this.writeFailed) {
      throw new Error(`Trace recording failed for ${this.filePath}. Previous write failed, refusing to queue more events.`);
    }

    // Queue writes to prevent race conditions
    this.writeQueue = this.writeQueue.then(async () => {
      if (!this.directoryEnsured) {
        await ensureDirectory(path.dirname(this.filePath));
        this.directoryEnsured = true;
      }
      await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
    }).catch((error) => {
      this.writeFailed = true;
      metrics.traceWriteErrorsTotal.inc({ filePath: this.filePath.slice(0, 50) });
      logger.error("trace", "trace.write", "Trace write failed", {
        metadata: { filePath: this.filePath },
        error
      });
      throw error;
    });
    await this.writeQueue;
  }

  async recordBatch(events: TraceEvent[]): Promise<void> {
    if (events.length === 0) return;

    if (this.writeFailed) {
      throw new Error(`Trace recording failed for ${this.filePath}. Previous write failed, refusing to queue more events.`);
    }

    this.writeQueue = this.writeQueue.then(async () => {
      if (!this.directoryEnsured) {
        await ensureDirectory(path.dirname(this.filePath));
        this.directoryEnsured = true;
      }
      const lines = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
      await fs.appendFile(this.filePath, lines, "utf8");
    }).catch((error) => {
      this.writeFailed = true;
      metrics.traceWriteErrorsTotal.inc({ filePath: this.filePath.slice(0, 50) });
      logger.error("trace", "trace.write", "Trace batch write failed", {
        metadata: { filePath: this.filePath, eventCount: events.length },
        error
      });
      throw error;
    });
    await this.writeQueue;
  }

  async readAll(): Promise<TraceEvent[]> {
    try {
      const { events } = await readTraceFileStreaming(this.filePath);
      return events;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return [];
    }
  }

  async query(options: TraceQueryOptions = {}): Promise<TraceEvent[]> {
    try {
      const { events } = await queryTraceFileStream(this.filePath, options);
      return events;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return [];
    }
  }

  async getEventCount(): Promise<number> {
    try {
      const stream = createReadStream(this.filePath, { encoding: "utf8" });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      let count = 0;
      for await (const line of rl) {
        if (line.trim()) count++;
      }
      return count;
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
    let fileHandle: import("node:fs/promises").FileHandle | undefined;

    try {
      const sourceStream = createReadStream(this.filePath);
      const gzipStream = createGzip();
      fileHandle = await fs.open(compressedPath, "w");
      const destinationStream = fileHandle.createWriteStream();
      await pipeline(sourceStream, gzipStream, destinationStream);
    } catch (error) {
      // Clean up incomplete compressed file on failure
      await fs.rm(compressedPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await fileHandle?.close().catch(() => {});
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
    const tempOutputPath = `${compressedPath}.${randomUUID()}.tmp.jsonl`;

    try {
      await JsonlTraceRecorder.decompress(compressedPath, tempOutputPath);
      // Use streaming to read the decompressed temp file
      const { events } = await readTraceFileStreaming(tempOutputPath);
      return events;
    } finally {
      await fs.rm(tempOutputPath, { force: true }).catch(() => {});
    }
  }
}

export class InMemoryTraceRecorder {
  private events: TraceEvent[] = [];
  private readonly maxEvents: number;
  private droppedCount = 0;

  constructor(options?: { maxEvents?: number }) {
    this.maxEvents = options?.maxEvents ?? 10000;
  }

  async record(event: TraceEvent): Promise<void> {
    this.events.push({ ...event });
    this.evictIfNeeded();
  }

  async recordBatch(events: TraceEvent[]): Promise<void> {
    this.events.push(...events.map((event) => ({ ...event })));
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    if (this.events.length <= this.maxEvents) return;
    const dropCount = this.events.length - this.maxEvents;
    this.events.splice(0, dropCount);
    this.droppedCount += dropCount;
    logger.warn("trace", "trace.evict", `Dropped ${dropCount} oldest trace events (maxEvents: ${this.maxEvents}, total dropped: ${this.droppedCount})`);
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

// Trace replay exports
export {
  buildTraceTimeline,
  loadTraceEvents,
  type TraceComparison,
  TraceReplayer,
  type TraceReplayOptions,
  type TraceStep,
  type TraceTimeline
} from "./replay.js";
export { matchesFilter, type TraceFilter, type TraceQueryOptions } from "./types.js";
