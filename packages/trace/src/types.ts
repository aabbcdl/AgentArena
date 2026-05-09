import type { TraceEvent } from "@agentarena/core";

export interface TraceFilter {
  agentId?: string;
  runId?: string;
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

export function matchesFilter(event: TraceEvent, filter: TraceFilter): boolean {
  if (filter.agentId && event.agentId !== filter.agentId) {
    return false;
  }
  if (filter.runId && event.runId !== filter.runId) {
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
