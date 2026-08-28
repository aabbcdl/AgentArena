import type { UiRunStatus } from "../types";

function timestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mergeRunStatus(previous: UiRunStatus, incoming: Partial<UiRunStatus>): UiRunStatus {
  const merged: UiRunStatus = {
    ...previous,
    ...incoming,
    logs: Array.isArray(incoming.logs) ? incoming.logs : previous.logs
  };
  if (incoming.snapshot) {
    merged.snapshot = { ...(previous.snapshot ?? {}), ...incoming.snapshot };
  } else if (previous.snapshot) {
    merged.snapshot = previous.snapshot;
  }
  return merged;
}

export function mergeFreshRunStatus(previous: UiRunStatus, incoming: Partial<UiRunStatus>): UiRunStatus {
  const previousTimestamp = timestamp(previous.updatedAt);
  const incomingTimestamp = timestamp(incoming.updatedAt);
  if (
    previousTimestamp !== null
    && incomingTimestamp !== null
    && incomingTimestamp < previousTimestamp
  ) {
    return previous;
  }
  return mergeRunStatus(previous, incoming);
}
