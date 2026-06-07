import type { getAdapter } from "@agentarena/adapters";
import type {
  BenchmarkCancellation,
  buildExecutionEnvironment,
} from "@agentarena/core";
import type { loadTaskPack } from "@agentarena/taskpacks";
import type { JsonlTraceRecorder } from "@agentarena/trace";

export interface AgentRunContext {
  task: Awaited<ReturnType<typeof loadTaskPack>>;
  adapter: ReturnType<typeof getAdapter>;
  agentOutputPath: string;
  workspacePath: string;
  tracePath: string;
  traceRecorder: JsonlTraceRecorder;
  executionEnvironment: ReturnType<typeof buildExecutionEnvironment>;
  cancellation: BenchmarkCancellation | undefined;
  throwIfCancelled: (stage: string) => void;
  debug: boolean;
}
