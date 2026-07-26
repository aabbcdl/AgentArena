import {
  type AgentResolvedRuntime,
  logger,
  normalizePath,
  portableRelativePath,
  uniqueSorted
} from "@agentarena/core";
import { safeNumber } from "./process-utils.js";

/**
 * Narrow an unknown JSON.parse result to a non-null object with optional `type` discriminant.
 * Returns null when the parsed value isn't a plain object — protects downstream code
 * from arrays, primitives, or null that pass `JSON.parse` but break property access.
 */
function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** Strip ANSI escape sequences from a string (color codes, cursor movements, etc.) */
function stripAnsi(input: string): string {
  // Use character code based pattern to avoid noControlCharacters lint
  const ESC = String.fromCharCode(0x1b);
  const CSI = String.fromCharCode(0x9b);
  const pattern = new RegExp(`[${ESC}${CSI}][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`, "g");
  return input.replace(pattern, "");
}

interface CodexUsageEvent {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
}

export interface CodexJsonEvent {
  type?: string;
  item?: {
    type?: string;
    text?: string;
    changes?: Array<{
      path?: string;
    }>;
  };
  usage?: CodexUsageEvent;
  thread_id?: string;
}

interface ClaudeUsageEvent {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ClaudeJsonEvent {
  type?: string;
  session_id?: string;
  is_error?: boolean;
  error?: string;
  total_cost_usd?: number;
  result?: string;
  usage?: ClaudeUsageEvent;
  message?: {
    usage?: ClaudeUsageEvent;
    content?: Array<{
      type?: string;
      text?: string;
      // tool_use fields
      id?: string;
      name?: string;
      input?: unknown;
    }>;
  };
}

/** A tool call extracted from Claude's stream-json output */
export interface ToolCallEvent {
  name: string;
  input?: unknown;
}

const MAX_PARSE_DEPTH = 50; // Prevent stack overflow on deeply nested JSON

export function extractNestedStringValues(value: unknown, collector: Map<string, string>, depth = 0): void {
  if (depth > MAX_PARSE_DEPTH) {
    return; // Stop recursion to prevent stack overflow
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      extractNestedStringValues(entry, collector, depth + 1);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (typeof childValue === "string" && childValue.trim()) {
      collector.set(normalizedKey, childValue.trim());
    }
    extractNestedStringValues(childValue, collector, depth + 1);
  }
}

/**
 * Parse Codex CLI JSON-per-line stdout events.
 *
 * CONTRACT WARNING: This parser depends on undocumented Codex CLI output formats.
 * Expected event types and fields (as of 2025-06):
 * - `type: "thread.started"` → `thread_id` (string)
 * - `type: "item.completed"` + `item.type: "agent_message"` → `item.text` (summary)
 * - `type: "item.completed"` + `item.type: "file_change"` → `item.changes[].path`
 * - `type: "turn.completed"` → `usage.{input_tokens, cached_input_tokens, output_tokens}`
 *
 * If any field is renamed or removed, tokenUsage silently drops to 0 and
 * changedFilesHint returns empty. See docs/adr/ADR-001-adapter-cli-contract.md.
 */
export function parseCodexEvents(stdout: string, workspacePath: string): {
  changedFilesHint: string[];
  tokenUsage: number;
  summaryFromEvents?: string;
  threadId?: string;
  resolvedRuntime?: AgentResolvedRuntime;
  /**
   * True when turn.completed events were seen but produced zero tokens.
   * Indicates the CLI may have changed its usage field names.
   */
  tokenCountSuspicious: boolean;
  /**
   * True when the parser saw JSON lines with `type` fields but the majority
   * were unrecognized — indicating the CLI changed its event schema.
   * When true, tokenUsage and changedFilesHint may be inaccurate.
   */
  formatMismatch: boolean;
  /**
   * Names of critical events that were expected but not seen in the stream.
   * For Codex: "turn.completed" (usage totals).
   * When non-empty, tokenUsage may be inaccurate and consumers
   * SHOULD set tokenUsageReliable=false and costQuality="unavailable".
   */
  missingCriticalEvents: string[];
} {
  const changedFiles = new Set<string>();
  let tokenUsage = 0;
  let summaryFromEvents: string | undefined;
  let threadId: string | undefined;
  let eventModel: string | undefined;
  let eventReasoningEffort: string | undefined;
  let parseErrorCount = 0;
  let turnCompletedCount = 0;
  // Track recognized vs unrecognized typed JSON events for format mismatch detection
  let totalTypedEvents = 0;
  let unrecognizedTypedEvents = 0;
  const MAX_PARSE_ERRORS = 10; // Stop logging after this many to avoid noise
  // These lifecycle events carry no result fields, but are valid Codex output.
  // They must not be treated as evidence of a schema break.
  const knownLifecycleTypes = new Set(["thread.started", "turn.started", "item.started", "item.completed"]);

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = stripAnsi(rawLine.trim());
    if (!line.startsWith("{")) {
      continue;
    }

    let parsed: CodexJsonEvent;
    try {
      const raw: unknown = JSON.parse(line);
      const obj = asJsonObject(raw);
      if (!obj) {
        // Array/primitive/null parse result — not a valid event
        continue;
      }
      parsed = obj as CodexJsonEvent;
    } catch {
      parseErrorCount += 1;
      // Only log first few parse errors to avoid flooding
      if (parseErrorCount <= 3) {
        logger.warn("adapter", "codex.parse_failed", `parseCodexEvents: Failed to parse JSON line: ${line.slice(0, 100)}...`);
      }
      if (parseErrorCount > MAX_PARSE_ERRORS) {
        // After too many errors, stop parsing to avoid performance impact
        break;
      }
      continue;
    }

    // Track whether this JSON line had a recognized event type
    let recognizedType = false;

    if (parsed.type === "thread.started" && typeof parsed.thread_id === "string") {
      threadId = parsed.thread_id;
      recognizedType = true;
    }

    if (parsed.type === "item.completed" && parsed.item?.type === "agent_message" && typeof parsed.item.text === "string") {
      summaryFromEvents = parsed.item.text;
      recognizedType = true;
    }

    if (parsed.type === "item.completed" && parsed.item?.type === "file_change" && Array.isArray(parsed.item.changes)) {
      recognizedType = true;
      for (const change of parsed.item.changes) {
        if (!change.path) {
          continue;
        }

        const relativePath = normalizePath(portableRelativePath(workspacePath, change.path));
        if (relativePath && !relativePath.startsWith("..") && !/^[a-zA-Z]:/.test(relativePath)) {
          changedFiles.add(relativePath);
        }
      }
    }

    if (parsed.type === "turn.completed") {
      recognizedType = true;
      turnCompletedCount += 1;
      if (parsed.usage) {
        tokenUsage +=
          safeNumber(parsed.usage.input_tokens) +
          safeNumber(parsed.usage.cached_input_tokens) +
          safeNumber(parsed.usage.output_tokens);
      }
    }

    // Count typed events for format mismatch detection. A known lifecycle
    // event is recognized even when it has no result payload we need.
    if (typeof parsed.type === "string") {
      totalTypedEvents += 1;
      if (knownLifecycleTypes.has(parsed.type)) {
        recognizedType = true;
      }
      if (!recognizedType) {
        unrecognizedTypedEvents += 1;
      }
    }

    const stringValues = new Map<string, string>();
    extractNestedStringValues(parsed, stringValues);
    eventModel =
      stringValues.get("modelname") ??
      stringValues.get("modelslug") ??
      stringValues.get("model") ??
      eventModel;
    eventReasoningEffort =
      stringValues.get("modelreasoningeffort") ??
      stringValues.get("reasoningeffort") ??
      stringValues.get("reasoninglevel") ??
      eventReasoningEffort;
  }

  if (parseErrorCount > MAX_PARSE_ERRORS) {
    logger.warn("adapter", "codex.parse_skipped", `parseCodexEvents: Skipped ${parseErrorCount} unparseable lines in total.`);
  }

  // Warn if turn.completed events were seen but produced zero tokens.
  // This likely means the CLI changed its usage field names.
  const tokenCountSuspicious = turnCompletedCount > 0 && tokenUsage === 0;
  if (tokenCountSuspicious) {
    logger.warn("adapter", "codex.zero_tokens", `parseCodexEvents: Saw ${turnCompletedCount} turn.completed events but tokenUsage is 0. The CLI may have changed its usage field names (expected: input_tokens, cached_input_tokens, output_tokens).`);
  }

  // Format mismatch: majority of typed JSON events were unrecognized.
  // This indicates the CLI changed its event schema — tokenUsage and
  // changedFilesHint may be inaccurate (silently zero/empty).
  const formatMismatch =
    totalTypedEvents > 0 && unrecognizedTypedEvents / totalTypedEvents >= 0.5;
  if (formatMismatch) {
    logger.warn(
      "adapter",
      "codex.format_mismatch",
      `parseCodexEvents: ${unrecognizedTypedEvents}/${totalTypedEvents} typed JSON events were unrecognized. The CLI may have changed its event schema.`,
    );
  }

  const missingCriticalEvents: string[] = [];
  if (turnCompletedCount === 0 && totalTypedEvents > 0) {
    missingCriticalEvents.push("turn.completed");
  }

  return {
    changedFilesHint: uniqueSorted(Array.from(changedFiles)),
    tokenUsage,
    summaryFromEvents,
    threadId,
    resolvedRuntime:
      eventModel || eventReasoningEffort
        ? {
            effectiveModel: eventModel,
            effectiveReasoningEffort: eventReasoningEffort,
            source: "event-stream",
            verification: "confirmed"
          }
        : undefined,
    tokenCountSuspicious,
    formatMismatch,
    missingCriticalEvents
  };
}

/**
 * Generic parser for CLI event streams that emit one JSON object per line.
 * Handles the shared pattern used by both Claude Code and Gemini CLI:
 * - Strip ANSI, parse JSON lines
 * - Extract session ID, message content, usage tokens, cost, errors
 *
 * STRING-BASED CONTRACT WARNING:
 * This parser depends on undocumented output formats from external CLI tools.
 * If any CLI tool changes field names or event types, the parser silently
 * produces zero results (tokenUsage: 0, empty changedFiles) with no warning.
 *
 * Known field dependencies (as of 2025-01):
 * - Claude Code: parsed.type === "result" for final event
 * - parsed.usage.input_tokens, output_tokens, cache_creation_input_tokens,
 *   cache_read_input_tokens (token counting)
 * - parsed.message.content as Array<{type: "text", text: string}>
 * - parsed.cost_usd (cost extraction)
 *
 * Codex: parsed.type === "turn.completed" for final event
 * - item.type === "agent_message", "file_change" (content extraction)
 * - model/modelSlug/modelName fields (runtime resolution)
 *
 * @param stdout - Raw stdout from the CLI process
 * @param callerName - Label used in diagnostic warnings (e.g. "parseClaudeEvents")
 */
export function parseStreamJsonEvents(
  stdout: string,
  callerName: string
): {
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  summaryFromEvents?: string;
  sessionId?: string;
  error?: string;
  toolCalls: ToolCallEvent[];
  /**
   * True when the result event was seen but produced zero tokens.
   * Indicates the CLI may have changed its field names — the tokenUsage
   * value is likely inaccurate (should be > 0). Callers should mark
   * the result as "data may be inaccurate" in the UI/report.
   */
  tokenCountSuspicious: boolean;
  /**
   * True when the authoritative cumulative "result" event was seen. That event
   * carries the final total; without it, tokenUsage is a per-message sum that
   * can double-count cache-read tokens across turns. Callers should treat a
   * false value as "token total not authoritative".
   */
  tokenUsageFromResultEvent: boolean;
  /**
   * True when the parser saw JSON lines with `type` fields but the majority
   * were unrecognized — indicating the CLI changed its event schema.
   * When true, tokenUsage, cost, and toolCalls may be inaccurate.
   */
  formatMismatch: boolean;
  /**
   * Names of critical events that were expected but not seen in the stream.
   * For Claude: "result" (authoritative cumulative total).
   * For Codex: "turn.completed" (usage totals).
   * When non-empty, tokenUsage and cost may be inaccurate and consumers
   * SHOULD set tokenUsageReliable=false and costQuality="unavailable".
   */
  missingCriticalEvents: string[];
} {
  let tokenUsage = 0;
  let estimatedCostUsd = 0;
  let costKnown = false;
  let summaryFromEvents: string | undefined;
  let sessionId: string | undefined;
  let error: string | undefined;
  const toolCalls: ToolCallEvent[] = [];
  let parseErrorCount = 0;
  let resultEventSeen = false;
  // Track recognized vs unrecognized typed JSON events for format mismatch detection
  let totalTypedEvents = 0;
  let unrecognizedTypedEvents = 0;
  const MAX_PARSE_ERRORS = 10;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = stripAnsi(rawLine.trim());
    if (!line.startsWith("{")) {
      continue;
    }

    let parsed: ClaudeJsonEvent;
    try {
      const raw: unknown = JSON.parse(line);
      const obj = asJsonObject(raw);
      if (!obj) continue;
      parsed = obj as ClaudeJsonEvent;
    } catch {
      parseErrorCount += 1;
      if (parseErrorCount <= 3) {
        logger.warn("adapter", "stream_json.parse_failed", `${callerName}: Failed to parse JSON line: ${line.slice(0, 100)}...`);
      }
      continue;
    }

    // Track whether this JSON line had a recognized event type
    let recognizedType = false;

    if (parsed.session_id) {
      recognizedType = true;
      sessionId = parsed.session_id;
    }

    if (parsed.message?.content && Array.isArray(parsed.message.content)) {
      recognizedType = true;
      const text = parsed.message.content
        .filter((value) => value.type === "text" && typeof value.text === "string")
        .map((value) => value.text?.trim() ?? "")
        .filter(Boolean)
        .join("\n");

      if (text) {
        summaryFromEvents = text;
      }

      // Extract tool_use entries
      for (const block of parsed.message.content) {
        if (block.type === "tool_use" && typeof block.name === "string") {
          toolCalls.push({ name: block.name, input: block.input });
        }
      }

      const usage = parsed.message.usage;
      if (usage) {
        tokenUsage +=
          safeNumber(usage.input_tokens) +
          safeNumber(usage.output_tokens) +
          safeNumber(usage.cache_creation_input_tokens) +
          safeNumber(usage.cache_read_input_tokens);
      }
    }

    if (parsed.type === "result") {
      recognizedType = true;
      resultEventSeen = true;
      // The result event contains the final cumulative usage summary.
      // Replace the running total to avoid double-counting with per-message usage.
      const usage = parsed.usage;
      if (usage) {
        tokenUsage =
          safeNumber(usage.input_tokens) +
          safeNumber(usage.output_tokens) +
          safeNumber(usage.cache_creation_input_tokens) +
          safeNumber(usage.cache_read_input_tokens);
      }

      if (typeof parsed.total_cost_usd === "number" && Number.isFinite(parsed.total_cost_usd)) {
        estimatedCostUsd = parsed.total_cost_usd;
        costKnown = !parsed.is_error;
      }

      if (typeof parsed.result === "string" && parsed.result.trim()) {
        summaryFromEvents = parsed.result.trim();
      }

      if (parsed.is_error) {
        error = parsed.error ?? parsed.result ?? "The adapter reported an error.";
      }
    }

    // Count typed events for format mismatch detection
    if (typeof parsed.type === "string") {
      totalTypedEvents += 1;
      if (!recognizedType) {
        unrecognizedTypedEvents += 1;
      }
    }
  }

  if (parseErrorCount > MAX_PARSE_ERRORS) {
    logger.warn("adapter", "stream_json.parse_skipped", `${callerName}: Skipped ${parseErrorCount} unparseable lines in total.`);
  }

  // Warn if result event was seen but produced zero tokens.
  // This likely means the CLI changed its usage field names.
  const tokenCountSuspicious = resultEventSeen && tokenUsage === 0;
  if (tokenCountSuspicious) {
    logger.warn("adapter", "stream_json.zero_tokens", `${callerName}: Saw "result" event but tokenUsage is 0. The CLI may have changed its usage field names (expected: input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens).`);
  }

  // Format mismatch: majority of typed JSON events were unrecognized.
  const formatMismatch =
    totalTypedEvents > 0 && unrecognizedTypedEvents / totalTypedEvents >= 0.5;
  if (formatMismatch) {
    logger.warn(
      "adapter",
      "stream_json.format_mismatch",
      `${callerName}: ${unrecognizedTypedEvents}/${totalTypedEvents} typed JSON events were unrecognized. The CLI may have changed its event schema.`,
    );
  }

  const missingCriticalEvents: string[] = [];
  if (!resultEventSeen && totalTypedEvents > 0) {
    missingCriticalEvents.push("result");
  }

  return {
    tokenUsage,
    estimatedCostUsd,
    costKnown,
    summaryFromEvents,
    sessionId,
    error,
    toolCalls,
    tokenCountSuspicious,
    tokenUsageFromResultEvent: resultEventSeen,
    formatMismatch,
    missingCriticalEvents
  };
}

export function parseGeminiEvents(stdout: string): ReturnType<typeof parseStreamJsonEvents> {
  return parseStreamJsonEvents(stdout, "parseGeminiEvents");
}

export function parseClaudeEvents(stdout: string): ReturnType<typeof parseStreamJsonEvents> {
  return parseStreamJsonEvents(stdout, "parseClaudeEvents");
}
