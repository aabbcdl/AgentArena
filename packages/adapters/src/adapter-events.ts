/**
 * Unified adapter event protocol.
 *
 * Defines the standard JSONL event schema that adapters can emit to produce
 * structured, parseable trace output. The type definitions are actively used
 * by DemoAdapter and serve as the contract for future adapter migration.
 *
 * Current status:
 * - Type definitions: used by DemoAdapter for typed event objects
 * - parseAdapterEvents: exported for future use — will replace the legacy
 *   per-adapter parseCodexEvents/parseClaudeEvents/parseGeminiEvents parsers
 *   once all adapters output this protocol
 * - emitEvent: exported for future use — adapters will call this to emit
 *   standardized JSONL events to stdout
 *
 * Migration path:
 * - New adapters SHOULD use this protocol
 * - Existing adapters continue using their legacy parsers (deprecated)
 * - Legacy parsers will be removed when all adapters are migrated
 */

import type { AgentResolvedRuntime } from "@agentarena/core";

/** All possible adapter event types */
export type AdapterEventType =
  | "adapter.start"
  | "adapter.message"
  | "adapter.tool_use"
  | "adapter.file_change"
  | "adapter.usage"
  | "adapter.result"
  | "adapter.error";

/** Base event structure — all events extend this */
interface AdapterEventBase {
  type: AdapterEventType;
  timestamp?: string;
}

/** Adapter has started executing */
export interface AdapterStartEvent extends AdapterEventBase {
  type: "adapter.start";
  agentId?: string;
  model?: string;
  reasoningEffort?: string;
}

/** A text message from the adapter (intermediate output) */
export interface AdapterMessageEvent extends AdapterEventBase {
  type: "adapter.message";
  text: string;
}

/** A tool was invoked by the adapter */
export interface AdapterToolUseEvent extends AdapterEventBase {
  type: "adapter.tool_use";
  toolName: string;
  input?: unknown;
}

/** A file was changed by the adapter */
export interface AdapterFileChangeEvent extends AdapterEventBase {
  type: "adapter.file_change";
  path: string;
  action: "create" | "modify" | "delete";
}

/** Token usage update */
export interface AdapterUsageEvent extends AdapterEventBase {
  type: "adapter.usage";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/** Adapter has finished executing */
export interface AdapterResultEvent extends AdapterEventBase {
  type: "adapter.result";
  status: "success" | "failed";
  summary: string;
  totalCostUsd?: number;
}

/** An error occurred during execution */
export interface AdapterErrorEvent extends AdapterEventBase {
  type: "adapter.error";
  message: string;
  code?: string;
}

export type AdapterEvent =
  | AdapterStartEvent
  | AdapterMessageEvent
  | AdapterToolUseEvent
  | AdapterFileChangeEvent
  | AdapterUsageEvent
  | AdapterResultEvent
  | AdapterErrorEvent;

/** Parsed result from a stream of adapter events */
export interface ParsedAdapterOutput {
  changedFiles: string[];
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  summary?: string;
  error?: string;
  resolvedRuntime?: AgentResolvedRuntime;
}

/**
 * Parse a stream of JSON-line adapter events into a structured result.
 * This is the unified parser that will replace parseCodexEvents/parseClaudeEvents/parseGeminiEvents
 * once all adapters are migrated to emit this protocol.
 *
 * NOTE: Currently only exported for future use — no adapter yet outputs this protocol natively.
 * DemoAdapter emits typed events via context.trace() but does not use this parser.
 */
export function parseAdapterEvents(stdout: string): ParsedAdapterOutput {
  const changedFiles = new Set<string>();
  let tokenUsage = 0;
  let estimatedCostUsd = 0;
  let costKnown = false;
  let summary: string | undefined;
  let error: string | undefined;
  let eventModel: string | undefined;
  let eventReasoningEffort: string | undefined;
  let parseErrorCount = 0;
  const MAX_PARSE_ERRORS = 10;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parseErrorCount++;
      if (parseErrorCount <= 3) {
        // biome-ignore lint/suspicious/noConsole: parse error diagnostic
        console.warn(`parseAdapterEvents: Failed to parse JSON line: ${line.slice(0, 100)}...`);
      }
      continue;
    }

    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) continue;

    const event = parsed as AdapterEvent;
    switch (event.type) {
      case "adapter.start":
        if (event.model) eventModel = event.model;
        if (event.reasoningEffort) eventReasoningEffort = event.reasoningEffort;
        break;

      case "adapter.message":
        // Keep the last message as potential summary
        if (event.text?.trim()) {
          summary = event.text.trim();
        }
        break;

      case "adapter.file_change":
        if (event.path) {
          changedFiles.add(event.path);
        }
        break;

      case "adapter.usage":
        tokenUsage +=
          (event.inputTokens ?? 0) +
          (event.outputTokens ?? 0) +
          (event.cacheReadTokens ?? 0) +
          (event.cacheWriteTokens ?? 0) +
          (event.reasoningTokens ?? 0);
        break;

      case "adapter.result":
        if (event.summary?.trim()) {
          summary = event.summary.trim();
        }
        if (typeof event.totalCostUsd === "number" && Number.isFinite(event.totalCostUsd)) {
          estimatedCostUsd = event.totalCostUsd;
          costKnown = event.status === "success";
        }
        if (event.status === "failed") {
          error = event.summary ?? "Adapter reported failure.";
        }
        break;

      case "adapter.error":
        error = event.message ?? "Unknown adapter error.";
        break;
    }
  }

  if (parseErrorCount > MAX_PARSE_ERRORS) {
    // biome-ignore lint/suspicious/noConsole: parse error diagnostic
    console.warn(`parseAdapterEvents: Skipped ${parseErrorCount} unparseable lines in total.`);
  }

  return {
    changedFiles: Array.from(changedFiles).sort(),
    tokenUsage,
    estimatedCostUsd,
    costKnown,
    summary,
    error,
    resolvedRuntime:
      eventModel || eventReasoningEffort
        ? {
            effectiveModel: eventModel,
            effectiveReasoningEffort: eventReasoningEffort,
            source: "event-stream",
            verification: "confirmed"
          }
        : undefined
  };
}

/**
 * Helper to emit a JSON-line event to stdout.
 * Adapters can use this to emit standardized events once they are migrated
 * to the unified protocol.
 *
 * NOTE: Currently only exported for future use.
 */
export function emitEvent(event: AdapterEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}
