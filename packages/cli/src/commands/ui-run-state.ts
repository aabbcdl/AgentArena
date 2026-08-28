import {
  type AgentLogStore,
  clearRunState,
  isPathInsideWorkspace,
  loadRunState,
  logger,
  saveRunState
} from "@agentarena/core";
import { markJobManifestInterrupted } from "@agentarena/runner";
import {
  fromUiRunState,
  toUiRunState,
  type UiRunLogEntry,
  type UiRunStatus
} from "./shared.js";
import type { ActiveUiRun } from "./ui-run-types.js";

const DEFAULT_LOG_LIMIT = 150;
const DEFAULT_LOG_STORE_LIMIT = 10;
const DEFAULT_SAVE_DEBOUNCE_MS = 750;

export interface UiRunStateOptions {
  logLimit?: number;
  logStoreLimit?: number;
  saveDebounceMs?: number;
  saveState?: typeof saveRunState;
}

export class UiRunStateController {
  private currentActiveRun: ActiveUiRun | null = null;
  private currentStatus: UiRunStatus = {
    state: "idle",
    phase: "idle",
    logs: [],
    updatedAt: new Date().toISOString()
  };
  private currentGeneration = 0;
  private startReserved = false;
  private pendingSaveHandle: ReturnType<typeof setTimeout> | undefined;
  private saveQueue: Promise<void> = Promise.resolve();
  private readonly saveState: typeof saveRunState;
  private readonly logLimit: number;
  private readonly logStoreLimit: number;
  private readonly saveDebounceMs: number;
  private readonly logStores = new Map<string, AgentLogStore>();

  constructor(
    private readonly workingDirectory: string,
    options: UiRunStateOptions = {}
  ) {
    this.saveState = options.saveState ?? saveRunState;
    this.logLimit = options.logLimit ?? DEFAULT_LOG_LIMIT;
    this.logStoreLimit = options.logStoreLimit ?? DEFAULT_LOG_STORE_LIMIT;
    this.saveDebounceMs = options.saveDebounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS;
  }

  get activeRun(): ActiveUiRun | null {
    return this.currentActiveRun;
  }

  get status(): UiRunStatus {
    return this.currentStatus;
  }

  get generation(): number {
    return this.currentGeneration;
  }

  get starting(): boolean {
    return this.startReserved;
  }

  setActiveRun(run: ActiveUiRun | null): void {
    this.currentActiveRun = run;
  }

  tryReserveStart(): boolean {
    if (this.currentActiveRun || this.startReserved) {
      return false;
    }
    this.startReserved = true;
    return true;
  }

  releaseStartReservation(): void {
    this.startReserved = false;
  }

  nextGeneration(): number {
    this.currentGeneration += 1;
    return this.currentGeneration;
  }

  replaceStatus(status: UiRunStatus): void {
    this.currentStatus = status;
    this.scheduleSave();
  }

  setStatus(status: Partial<UiRunStatus>): void {
    this.currentStatus = {
      ...this.currentStatus,
      ...status,
      updatedAt: new Date().toISOString()
    };
    this.scheduleSave();
  }

  appendLog(entry: Omit<UiRunLogEntry, "timestamp">): void {
    const nextEntry: UiRunLogEntry = {
      ...entry,
      timestamp: new Date().toISOString()
    };
    this.currentStatus = {
      ...this.currentStatus,
      logs: [...this.currentStatus.logs, nextEntry].slice(-this.logLimit),
      updatedAt: nextEntry.timestamp
    };
    this.scheduleSave();
  }

  rememberLogStore(runId: string, store: AgentLogStore): void {
    this.logStores.set(runId, store);
    if (this.logStores.size > this.logStoreLimit) {
      const oldestRunId = this.logStores.keys().next().value;
      if (oldestRunId) {
        this.logStores.delete(oldestRunId);
      }
    }
  }

  getLogStore(runId: string): AgentLogStore | undefined {
    return this.logStores.get(runId);
  }

  async restore(): Promise<void> {
    try {
      const persistedState = await loadRunState(this.workingDirectory);
      if (persistedState?.state === "running" || persistedState?.state === "cancelling") {
        const outputPath = persistedState.outputPath;
        if (outputPath && await isPathInsideWorkspace(this.workingDirectory, outputPath)) {
          await markJobManifestInterrupted(outputPath).catch((error: unknown) => {
            logger.warn(
              "server",
              "job_manifest.interrupt_failed",
              `Failed to mark the recovered JobManifest interrupted: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }
        this.currentStatus = {
          ...fromUiRunState(persistedState),
          state: "error",
          phase: "idle",
          error: "Server restarted while run was in progress. Previous run state was recovered.",
          updatedAt: new Date().toISOString()
        };
        await this.enqueueSave(this.currentStatus);
      } else if (persistedState) {
        this.currentStatus = fromUiRunState(persistedState);
      }
    } catch (error) {
      logger.warn("server", "run_state.restore_failed", `Failed to restore persisted run state: ${error instanceof Error ? error.message : String(error)}`, { error });
    }
  }

  async flush(): Promise<void> {
    this.cancelPendingSave();
    await this.enqueueSave(this.currentStatus);
  }

  async clearPersisted(): Promise<void> {
    this.cancelPendingSave();
    await this.saveQueue.catch(() => {});
    await clearRunState(this.workingDirectory).catch((error: unknown) => {
      logger.warn("server", "run_state.clear_failed", `clearPersisted: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private scheduleSave(): void {
    if (this.pendingSaveHandle) {
      return;
    }
    this.pendingSaveHandle = setTimeout(() => {
      this.pendingSaveHandle = undefined;
      this.enqueueSave(this.currentStatus).catch((error: unknown) => {
        logger.warn("server", "run_state.persist_failed", `scheduleSave: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.saveDebounceMs);
  }

  private enqueueSave(status: UiRunStatus): Promise<void> {
    const persistedState = toUiRunState(status);
    const nextSave = this.saveQueue
      .catch(() => {})
      .then(() => this.saveState(this.workingDirectory, persistedState));
    this.saveQueue = nextSave;
    return nextSave;
  }

  private cancelPendingSave(): void {
    if (this.pendingSaveHandle) {
      clearTimeout(this.pendingSaveHandle);
      this.pendingSaveHandle = undefined;
    }
  }
}
