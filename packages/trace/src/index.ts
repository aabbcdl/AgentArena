import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { ensureDirectory, logger, metrics, TRACE_ARTIFACT_SCHEMA, type TraceEvent, validateTraceEvent } from "@agentarena/core";
import { matchesFilter, type TraceFilter, type TraceQueryOptions } from "./types.js";

function logMalformedTraceLine(filePath: string, line: string): void {
  logger.warn("trace", "trace.malformed", "Skipping malformed trace line", {
    metadata: {
      filePath,
      preview: line.slice(0, 100)
    }
  });
}

function parseTraceLine(line: string): TraceEvent {
  const parsed: unknown = JSON.parse(line);
  const validation = validateTraceEvent(parsed);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return parsed as TraceEvent;
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
      events.push(parseTraceLine(line));
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
        const event = parseTraceLine(line);
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
      const event = parseTraceLine(line);
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
  private static readonly MAX_QUEUE_DEPTH = 1000;
  private directoryEnsured = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private queueDepth = 0;
  private droppedWrites = 0;
  private writeFailed = false;
  private buffer: TraceEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly bufferSize: number = 0,
    private readonly transformEvent: (event: TraceEvent) => TraceEvent = (event) => event
  ) {}

  /**
   * Snapshot of write integrity for the recorder.
   * Call after `close()`/`flush()` so pending queue work is reflected.
   */
  getIntegrity(): { writeFailed: boolean; droppedWrites: number } {
    return {
      writeFailed: this.writeFailed,
      droppedWrites: this.droppedWrites
    };
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length > 0) {
      const events = this.buffer;
      this.buffer = [];
      await this.writeEvents(events);
    }
    await this.writeQueue;
    if (!this.directoryEnsured) {
      await ensureDirectory(path.dirname(this.filePath));
      await fs.appendFile(this.filePath, "", "utf8");
      this.directoryEnsured = true;
    }
  }

  /**
   * Await all pending writes in the queue. Equivalent to `close()` but
   * semantically distinct: callers can flush mid-session without implying
   * the recorder is being shut down.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length > 0) {
      const events = this.buffer;
      this.buffer = [];
      await this.writeEvents(events);
    }
    await this.writeQueue;
  }

  private async writeEvents(events: TraceEvent[]): Promise<void> {
    const filePath = this.filePath;
    this.enqueue(async () => {
      if (!this.directoryEnsured) {
        await ensureDirectory(path.dirname(filePath));
        this.directoryEnsured = true;
      }
      const lines = events.map((e) => JSON.stringify({ schemaVersion: TRACE_ARTIFACT_SCHEMA, ...e })).join("\n") + "\n";
      await fs.appendFile(filePath, lines, "utf8");
    }, "Trace buffered write");
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.buffer.length > 0) {
        const events = this.buffer;
        this.buffer = [];
        this.writeEvents(events).catch((error) => {
          logger.error("trace", "trace.flush_failed", "Buffered flush failed", { error });
        });
      }
    }, 100);
  }

  private enqueue(writeFn: () => Promise<void>, label: string): void {
    if (this.queueDepth >= JsonlTraceRecorder.MAX_QUEUE_DEPTH) {
      this.droppedWrites++;
      logger.warn("trace", "trace.backpressure", `Trace queue depth exceeded ${JsonlTraceRecorder.MAX_QUEUE_DEPTH}; dropping incoming write`, {
        metadata: { filePath: this.filePath, droppedWrites: this.droppedWrites }
      });
      return;
    }

    this.queueDepth++;
    this.writeQueue = this.writeQueue.then(writeFn).catch((error) => {
      this.writeFailed = true;
      metrics.traceWriteErrorsTotal.inc({ filePath: this.filePath.slice(0, 50) });
      logger.error("trace", "trace.write", `${label} failed`, {
        metadata: { filePath: this.filePath },
        error
      });
      // Do NOT re-throw: a single write failure must not reject the queue chain
      // nor the awaiting callers (record/recordBatch), which would corrupt the
      // recorder and abort the run. The failure is captured via `writeFailed`.
    }).finally(() => {
      this.queueDepth--;
    });
  }

  async record(event: TraceEvent): Promise<void> {
    if (this.writeFailed) {
      // A previous write failed; stop recording to avoid partial/corrupt traces
      // without throwing (trace recording is best-effort and must not abort runs).
      return;
    }

    const persistedEvent = this.transformEvent(event);
    if (this.bufferSize <= 1) {
      const filePath = this.filePath;
      this.enqueue(async () => {
        if (!this.directoryEnsured) {
          await ensureDirectory(path.dirname(filePath));
          this.directoryEnsured = true;
        }
        await fs.appendFile(filePath, `${JSON.stringify({ schemaVersion: TRACE_ARTIFACT_SCHEMA, ...persistedEvent })}\n`, "utf8");
      }, "Trace write");
    } else {
      this.buffer.push(persistedEvent);
      if (this.buffer.length >= this.bufferSize) {
        const events = this.buffer;
        this.buffer = [];
        await this.writeEvents(events);
      } else {
        this.scheduleFlush();
      }
    }

    await this.writeQueue;
  }

  async recordBatch(events: TraceEvent[]): Promise<void> {
    if (events.length === 0) return;

    if (this.writeFailed) {
      // A previous write failed; stop recording to avoid partial/corrupt traces
      // without throwing (trace recording is best-effort and must not abort runs).
      return;
    }

    const persistedEvents = events.map((event) => this.transformEvent(event));
    const filePath = this.filePath;
    this.enqueue(async () => {
      if (!this.directoryEnsured) {
        await ensureDirectory(path.dirname(filePath));
        this.directoryEnsured = true;
      }
      const lines = persistedEvents.map((event) => JSON.stringify({ schemaVersion: TRACE_ARTIFACT_SCHEMA, ...event })).join("\n") + "\n";
      await fs.appendFile(filePath, lines, "utf8");
    }, "Trace batch write");

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
    const types = new Set<string>();
    for await (const event of this.streamEvents()) {
      types.add(event.type);
    }
    return Array.from(types).sort();
  }

  async getAgentIds(): Promise<string[]> {
    const agentIds = new Set<string>();
    for await (const event of this.streamEvents()) {
      if (event.agentId) agentIds.add(event.agentId);
    }
    return Array.from(agentIds).sort();
  }

  private async *streamEvents(): AsyncGenerator<TraceEvent> {
    try {
      const stream = createReadStream(this.filePath, { encoding: "utf8" });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        if (line.trim()) {
          try { yield parseTraceLine(line); } catch { /* skip malformed */ }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
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
    // Write to a temp file and atomically rename to avoid leaving a corrupt
    // .gz behind if the process crashes mid-write.
    const tempPath = `${compressedPath}.${randomUUID()}.tmp`;
    let fileHandle: import("node:fs/promises").FileHandle | undefined;

    try {
      const sourceStream = createReadStream(this.filePath);
      const gzipStream = createGzip();
      fileHandle = await fs.open(tempPath, "w");
      const destinationStream = fileHandle.createWriteStream();
      await pipeline(sourceStream, gzipStream, destinationStream);
      await fileHandle.close();
      fileHandle = undefined;
      await fs.rename(tempPath, compressedPath);
    } catch (error) {
      // Clean up incomplete temp file on failure
      await fs.rm(tempPath, { force: true }).catch(() => {});
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
export { type TraceRecord, TraceTailer, type TraceTailerOptions } from "./tailer.js";
export { matchesFilter, type TraceFilter, type TraceQueryOptions } from "./types.js";
