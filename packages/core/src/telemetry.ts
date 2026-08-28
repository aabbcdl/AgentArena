/**
 * @module telemetry
 *
 * Minimal, opt-in, local-first product measurement.
 *
 * Design principles:
 * - OFF by default. Enabled only when AGENTARENA_TELEMETRY=1 (or "true").
 * - No network. Events are appended to a local JSONL file the user owns.
 * - No personal data, no repo paths, no prompts, no tokens. Only aggregate
 *   signals tied to a real product decision (activation, run funnel, result views).
 * - Fire-and-forget: a telemetry failure must never break a product flow.
 * - Defense-in-depth: even though event props are chosen to be non-sensitive,
 *   they still pass through the same redaction used by structured logging.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createRunId } from "./utils.js";

/**
 * The set of product events we measure. Adding a value here is the only way
 * to record a new event — this prevents accidental high-cardinality tracking.
 */
export type TelemetryEventName =
  | "app_opened"
  | "run_started"
  | "run_completed"
  | "result_viewed"
  | "preflight_completed"
  | "evidence_opened";

export interface TelemetryEvent {
  /** Schema version, so the reader can evolve safely. */
  schema: "agentarena.telemetry/v1";
  /** ISO timestamp. */
  ts: string;
  /** Event name. */
  event: TelemetryEventName;
  /** Anonymous per-process session id (in-memory UUID). */
  sessionId: string;
  /** Anonymous persistent installation id (random UUID stored on disk). */
  installId: string;
  /** AgentArena version, if known. */
  version?: string;
  /** Decision-relevant properties only. No paths, prompts, or secrets. */
  props: Record<string, unknown>;
}

const ENV_VAR = "AGENTARENA_TELEMETRY";

/**
 * Whether telemetry is enabled. Checked live so env changes between calls
 * (e.g. tests) are honored. Default is OFF.
 */
export function isTelemetryEnabled(): boolean {
  const v = process.env[ENV_VAR];
  return v === "1" || v === "true";
}

let sessionId: string | undefined;
function getSessionId(): string {
  if (!sessionId) {
    sessionId = createRunId();
  }
  return sessionId;
}

/**
 * Resolve the telemetry JSONL path. Defaults to
 * `<cwd>/.agentarena/telemetry.jsonl`. Override via AGENTARENA_TELEMETRY_FILE
 * for tests.
 */
function getTelemetryFilePath(): string {
  return (
    process.env.AGENTARENA_TELEMETRY_FILE ??
    path.join(process.cwd(), ".agentarena", "telemetry.jsonl")
  );
}

/**
 * Resolve (and lazily create) a stable anonymous installation id. Stored at
 * `<cwd>/.agentarena/telemetry-installation-id`. This is a random UUID — it
 * carries no personal information and is never sent anywhere.
 */
async function getOrCreateInstallId(): Promise<string> {
  const idPath = path.join(
    path.dirname(getTelemetryFilePath()),
    "telemetry-installation-id",
  );
  try {
    const existing = (await fs.readFile(idPath, "utf8")).trim();
    if (existing) return existing;
  } catch {
    // not present yet — create below
  }
  const id = createRunId();
  try {
    await fs.mkdir(path.dirname(idPath), { recursive: true });
    await fs.writeFile(idPath, id, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Best-effort: if we cannot persist, use the ephemeral session id so
    // events are still recorded with a stable-within-process identifier.
    return getSessionId();
  }
  return id;
}

// ─── Redaction (mirrors logging.ts SENSITIVE_KEYS to avoid importing private helpers) ───

const SENSITIVE_KEYS = new Set([
  "token",
  "secret",
  "password",
  "apikey",
  "api_key",
  "authtoken",
  "auth_token",
  "privatekey",
  "private_key",
  "bearer",
  "authorization",
]);

const SENSITIVE_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /auth[_-]?key/i,
  /private[_-]?key/i,
  /bearer/i,
  /sk-[a-zA-Z0-9]/i,
];

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[max depth]";
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return "[Buffer]";
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => redact(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.has(lower) || SENSITIVE_PATTERNS.some((p) => p.test(k))) {
      out[k] = "****";
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

/**
 * Record a telemetry event. Returns a promise that resolves once the event
 * has been appended (or once telemetry is determined to be disabled).
 *
 * Callers MUST NOT await this on a user-critical path — use `void recordTelemetryEvent(...)`.
 * If writing fails, the error is swallowed and logged to stderr; the product
 * flow continues unaffected.
 */
export async function recordTelemetryEvent(
  event: TelemetryEventName,
  props: Record<string, unknown> = {},
  options?: { version?: string },
): Promise<void> {
  if (!isTelemetryEnabled()) return;

  try {
    const installId = await getOrCreateInstallId();
    const entry: TelemetryEvent = {
      schema: "agentarena.telemetry/v1",
      ts: new Date().toISOString(),
      event,
      sessionId: getSessionId(),
      installId,
      ...(options?.version ? { version: options.version } : {}),
      props: redact(props) as Record<string, unknown>,
    };

    const filePath = getTelemetryFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    // Never let telemetry break a product flow.
    try {
      process.stderr.write(
        `telemetry: failed to record "${event}": ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    } catch {
      // give up silently
    }
  }
}


export interface TelemetrySummary {
  enabled: boolean;
  totalEvents: number;
  events: Record<TelemetryEventName, number>;
  entryPoints: Record<string, number>;
  resultIntegrity: Record<string, number>;
  outcomes: Record<string, number>;
}

const EMPTY_EVENT_COUNTS: Record<TelemetryEventName, number> = {
  app_opened: 0,
  run_started: 0,
  run_completed: 0,
  result_viewed: 0,
  preflight_completed: 0,
  evidence_opened: 0,
};

function incrementLowCardinality(target: Record<string, number>, value: unknown): void {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,39}$/i.test(value)) return;
  target[value] = (target[value] ?? 0) + 1;
}

/** Read a local aggregate suitable for the Settings page. Raw event properties are never returned. */
export async function readTelemetrySummary(): Promise<TelemetrySummary> {
  const summary: TelemetrySummary = {
    enabled: isTelemetryEnabled(),
    totalEvents: 0,
    events: { ...EMPTY_EVENT_COUNTS },
    entryPoints: {},
    resultIntegrity: {},
    outcomes: {},
  };

  let content: string;
  try {
    content = await fs.readFile(getTelemetryFilePath(), "utf8");
  } catch {
    return summary;
  }

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Partial<TelemetryEvent>;
      if (!entry.event || !(entry.event in summary.events)) continue;
      summary.totalEvents += 1;
      summary.events[entry.event] += 1;
      const props = entry.props && typeof entry.props === "object" ? entry.props : {};
      incrementLowCardinality(summary.entryPoints, props.entryPoint);
      incrementLowCardinality(summary.resultIntegrity, props.resultIntegrity);
      incrementLowCardinality(summary.outcomes, props.outcome);
    } catch {
      // Ignore malformed or partially written lines.
    }
  }
  return summary;
}
