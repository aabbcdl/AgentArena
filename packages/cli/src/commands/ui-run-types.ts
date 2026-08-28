import type { AgentLogStore } from "@agentarena/core";
import type { UiRunLogEntry, UiRunStatus } from "./shared.js";
import type { SseConnection } from "./sse.js";

export interface ActiveUiRun {
  promise: Promise<unknown>;
  cancel: () => void;
  agentLogStore?: AgentLogStore;
  sseConnections?: Set<SseConnection>;
}

export interface UiRunRequestContext {
  /** Explicit filesystem boundary for all UI runs and persisted run state. */
  workspaceRoot: string;
  authToken: string;
  activeRun: ActiveUiRun | null;
  setActiveRun: (run: ActiveUiRun | null) => void;
  activeRunStatus: UiRunStatus;
  setActiveRunStatus: (status: UiRunStatus) => void;
  appendRunLog: (entry: Omit<UiRunLogEntry, "timestamp">) => void;
  setRunStatus: (status: Partial<UiRunStatus>) => void;
  runGeneration: number;
  incrementRunGeneration: () => number;
  tryReserveStart: () => boolean;
  releaseStartReservation: () => void;
  flushSaveRunState: () => Promise<void>;
  rememberLogStore: (runId: string, store: AgentLogStore) => void;
  getLogStore: (runId: string) => AgentLogStore | undefined;
  clearPersistedRunState: () => Promise<void>;
}
