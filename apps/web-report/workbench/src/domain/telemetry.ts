export interface ViewTelemetryDeduper {
  markAppOpened(): boolean;
  markResultViewed(runId: string): boolean;
  markEvidenceOpened(runId: string): boolean;
}

export function createViewTelemetryDeduper(): ViewTelemetryDeduper {
  let appOpened = false;
  const viewedRunIds = new Set<string>();
  const evidenceRunIds = new Set<string>();
  return {
    markAppOpened() {
      if (appOpened) return false;
      appOpened = true;
      return true;
    },
    markResultViewed(runId) {
      if (!runId || viewedRunIds.has(runId)) return false;
      viewedRunIds.add(runId);
      return true;
    },
    markEvidenceOpened(runId) {
      if (!runId || evidenceRunIds.has(runId)) return false;
      evidenceRunIds.add(runId);
      return true;
    }
  };
}
