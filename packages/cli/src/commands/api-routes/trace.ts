/**
 * GET /api/trace — serve a single agent's execution trace (JSONL) for replay.
 *
 * Resolves the trace file for a given run + variant from the local workspace's
 * run output directory and returns parsed events. This replaces the legacy
 * approach of fetching a relative `tracePath` against the web root, which only
 * worked by coincidence and caused the "trace path split" bug. Identity is
 * bound explicitly to runId + variantId so evidence never cross-wires.
 *
 * Security: only `runId` and `variantId` query params are accepted (whitelisted
 * characters). The resolved file path is contained to the workspace via
 * isPathInsideWorkspace after realpath resolution, preventing `..` / symlink
 * escape. The endpoint lives under /api/ so it inherits token auth, CORS, and
 * rate limiting from the shared request middleware.
 */

import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { isPathInsideWorkspace } from "@agentarena/core";
import { jsonResponse } from "../../server/index.js";

const ID_WHITELIST = /^[a-zA-Z0-9._:-]+$/;
const MAX_EVENTS = 10_000;

export interface TraceEvent {
  agentId?: string;
  variantId?: string;
  runId?: string;
  timestamp: string;
  type: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceQuery {
  runId: string;
  variantId: string;
}

export interface TraceResponse {
  runId: string;
  variantId: string;
  totalEvents: number;
  returnedEvents: number;
  truncated: boolean;
  events: TraceEvent[];
}

/**
 * Resolve candidate trace file paths for a run + variant.
 * UI runs land under `.agentarena/ui-runs`; CLI/doctor runs under `.agentarena/runs`.
 */
export function resolveTraceCandidates(workspaceRoot: string, query: TraceQuery): string[] {
  const segments = ["agents", query.variantId, "trace.jsonl"];
  return [
    path.join(workspaceRoot, ".agentarena", "ui-runs", query.runId, ...segments),
    path.join(workspaceRoot, ".agentarena", "runs", query.runId, ...segments)
  ];
}

export function validateTraceQuery(runId: string | null, variantId: string | null): TraceQuery | null {
  if (!runId || !variantId) return null;
  if (!ID_WHITELIST.test(runId) || !ID_WHITELIST.test(variantId)) return null;
  return { runId, variantId };
}

/** Parse JSONL text into events, tolerating blank lines and skipping unparseable rows. */
export function parseTrace(text: string): TraceEvent[] {
  const lines = text.split("\n");
  const events: TraceEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed);
      if (value && typeof value === "object" && typeof (value as TraceEvent).type === "string") {
        events.push(value as TraceEvent);
      }
    } catch {
      // Skip malformed lines instead of failing the whole replay.
    }
  }
  return events;
}

async function readTraceWithLimit(filePath: string): Promise<{ events: TraceEvent[]; totalEvents: number }> {
  const events: TraceEvent[] = [];
  let totalEvents = 0;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const value = JSON.parse(trimmed);
        if (value && typeof value === "object" && typeof (value as TraceEvent).type === "string") {
          totalEvents++;
          if (events.length < MAX_EVENTS) events.push(value as TraceEvent);
        }
      } catch {
        // Skip malformed lines instead of failing the whole replay.
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  return { events, totalEvents };
}

/**
 * Pure handler. Resolves, contains, and reads the trace file for the given
 * workspace root + query. Returns an ApiResponse so it can be wrapped by
 * withErrorHandling and tested without a live HTTP server.
 */
export async function handleTraceGet(workspaceRoot: string, runId: string | null, variantId: string | null): Promise<{ statusCode: number; body: string; headers: Record<string, string> }> {
  const query = validateTraceQuery(runId, variantId);
  if (!query) {
    return jsonResponse({ error: "Invalid runId or variantId." }, 400);
  }

  const candidates = resolveTraceCandidates(workspaceRoot, query);
  let filePath: string | null = null;
  for (const candidate of candidates) {
    const realCandidate = await fs.realpath(candidate).catch(() => null);
    if (realCandidate) {
      const inside = await isPathInsideWorkspace(workspaceRoot, realCandidate);
      if (!inside) {
        return jsonResponse({ error: "Trace path is outside the workspace." }, 403);
      }
      filePath = realCandidate;
      break;
    }
  }

  if (!filePath) {
    return jsonResponse({ error: "trace-missing" }, 404);
  }

  let trace: { events: TraceEvent[]; totalEvents: number };
  try {
    trace = await readTraceWithLimit(filePath);
  } catch {
    return jsonResponse({ error: "trace-missing" }, 404);
  }

  const { events, totalEvents } = trace;
  const truncated = totalEvents > MAX_EVENTS;

  const payload: TraceResponse = {
    runId: query.runId,
    variantId: query.variantId,
    totalEvents,
    returnedEvents: events.length,
    truncated,
    events
  };
  return jsonResponse(payload, 200);
}
