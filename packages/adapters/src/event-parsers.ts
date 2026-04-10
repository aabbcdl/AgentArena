import {
  type AgentResolvedRuntime,
  normalizePath,
  portableRelativePath,
  uniqueSorted
} from "@agentarena/core";
import { safeNumber } from "./process-utils.js";

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
    }>;
  };
}

export function extractNestedStringValues(value: unknown, collector: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      extractNestedStringValues(entry, collector);
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
    extractNestedStringValues(childValue, collector);
  }
}

export function parseCodexEvents(stdout: string, workspacePath: string): {
  changedFilesHint: string[];
  tokenUsage: number;
  summaryFromEvents?: string;
  threadId?: string;
  resolvedRuntime?: AgentResolvedRuntime;
} {
  const changedFiles = new Set<string>();
  let tokenUsage = 0;
  let summaryFromEvents: string | undefined;
  let threadId: string | undefined;
  let eventModel: string | undefined;
  let eventReasoningEffort: string | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    let parsed: CodexJsonEvent;
    try {
      parsed = JSON.parse(trimmed) as CodexJsonEvent;
    } catch {
      continue;
    }

    if (parsed.type === "thread.started" && typeof parsed.thread_id === "string") {
      threadId = parsed.thread_id;
    }

    if (parsed.type === "item.completed" && parsed.item?.type === "agent_message" && parsed.item.text) {
      summaryFromEvents = parsed.item.text;
    }

    if (parsed.type === "item.completed" && parsed.item?.type === "file_change" && parsed.item.changes) {
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

    if (parsed.type === "turn.completed" && parsed.usage) {
      tokenUsage +=
        safeNumber(parsed.usage.input_tokens) +
        safeNumber(parsed.usage.cached_input_tokens) +
        safeNumber(parsed.usage.output_tokens);
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
        : undefined
  };
}

export interface GeminiJsonEvent {
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
    }>;
  };
}

export function parseGeminiEvents(stdout: string): {
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  summaryFromEvents?: string;
  sessionId?: string;
  error?: string;
} {
  let tokenUsage = 0;
  let estimatedCostUsd = 0;
  let costKnown = false;
  let summaryFromEvents: string | undefined;
  let sessionId: string | undefined;
  let error: string | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    let parsed: GeminiJsonEvent;
    try {
      parsed = JSON.parse(trimmed) as GeminiJsonEvent;
    } catch {
      continue;
    }

    if (parsed.session_id) {
      sessionId = parsed.session_id;
    }

    if (parsed.message?.content) {
      const text = parsed.message.content
        .filter((value) => value.type === "text" && typeof value.text === "string")
        .map((value) => value.text?.trim() ?? "")
        .filter(Boolean)
        .join("\n");

      if (text) {
        summaryFromEvents = text;
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
  }

  return {
    tokenUsage,
    estimatedCostUsd,
    costKnown,
    summaryFromEvents,
    sessionId,
    error
  };
}

export function parseClaudeEvents(stdout: string): {
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  summaryFromEvents?: string;
  sessionId?: string;
  error?: string;
} {
  let tokenUsage = 0;
  let estimatedCostUsd = 0;
  let costKnown = false;
  let summaryFromEvents: string | undefined;
  let sessionId: string | undefined;
  let error: string | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    let parsed: ClaudeJsonEvent;
    try {
      parsed = JSON.parse(trimmed) as ClaudeJsonEvent;
    } catch {
      continue;
    }

    if (parsed.session_id) {
      sessionId = parsed.session_id;
    }

    if (parsed.message?.content) {
      const text = parsed.message.content
        .filter((value) => value.type === "text" && typeof value.text === "string")
        .map((value) => value.text?.trim() ?? "")
        .filter(Boolean)
        .join("\n");

      if (text) {
        summaryFromEvents = text;
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
  }

  return {
    tokenUsage,
    estimatedCostUsd,
    costKnown,
    summaryFromEvents,
    sessionId,
    error
  };
}
