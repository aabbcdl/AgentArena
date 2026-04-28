// Global type declarations for AgentArena web-report

interface Window {
  loadDemoData: () => void;
  applyRuns: (runs: unknown[]) => void;
  state: {
    runs: unknown[];
    run: unknown | null;
    [key: string]: unknown;
  };
}
