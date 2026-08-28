import type { LogKind, RunLogEntry } from "../types";

const ANSI_PATTERN = new RegExp(String.fromCharCode(0x1b) + "\\[[0-?]*[ -/]*[@-~]", "g");

/** Remove terminal control codes and collapse the repeated whitespace emitted by CLIs. */
export function compactLogMessage(value: string): string {
  return value
    .replace(ANSI_PATTERN, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 500);
}

/**
 * Give live output a small semantic layer. The raw line is still retained;
 * this only controls emphasis and lets the UI keep startup noise quiet.
 */
export function classifyLogLine(
  message: string,
  options: { stream?: RunLogEntry["stream"]; phase?: string } = {}
): LogKind {
  const value = message.toLowerCase();
  if (options.phase === "starting" || options.phase === "preflight" || options.phase === "report") {
    return "phase";
  }
  if (options.stream === "stderr" && /\b(error|fatal|exception|unauthori[sz]ed|denied|failed)\b/.test(value)) {
    return "error";
  }
  if (/\b(error|fatal|exception|unauthori[sz]ed|permission denied|failed|traceback)\b/.test(value)) {
    return "error";
  }
  if (/\b(warn(?:ing)?|deprecated|retry(?:ing)?|timeout|timed out|fallback)\b/.test(value)) {
    return "warning";
  }
  if (/\b(tool|tool_use|mcp|apply_patch|shell|exec(?:ute)?|read(?:ing)?|write|search|grep|rg)\b/.test(value)) {
    return "tool";
  }
  if (/\b(file|files|created|modified|updated|deleted|changed|diff|patch)\b/.test(value) || /\.(?:ts|tsx|js|jsx|json|yaml|yml|md)\b/.test(value)) {
    return "file";
  }
  if (/\b(done|complete(?:d)?|success(?:ful)?|passed|pass)\b/.test(value)) {
    return "success";
  }
  if (/plugin|mcp server|remote .*sync|could not create path aliases|shell snapshot/.test(value)) {
    return "noise";
  }
  return "output";
}

export function normalizeLogEntry(entry: RunLogEntry): RunLogEntry {
  const message = compactLogMessage(entry.message ?? "");
  return {
    ...entry,
    message,
    kind: entry.kind ?? classifyLogLine(message, entry)
  };
}
