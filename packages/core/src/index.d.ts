export interface TaskCommand {
    label: string;
    command: string;
}
export interface TaskPack {
    id: string;
    title: string;
    description?: string;
    prompt: string;
    successCommands: TaskCommand[];
}
export interface TraceEvent {
    timestamp: string;
    agentId: string;
    type: string;
    message: string;
    metadata?: Record<string, unknown>;
}
export interface AdapterExecutionContext {
    agentId: string;
    repoPath: string;
    workspacePath: string;
    task: TaskPack;
    trace: (event: Omit<TraceEvent, "agentId" | "timestamp">) => Promise<void>;
}
export interface AdapterExecutionResult {
    status: "success" | "failed";
    summary: string;
    tokenUsage: number;
    estimatedCostUsd: number;
    costKnown: boolean;
    changedFilesHint: string[];
}
export type AdapterPreflightStatus = "ready" | "unverified" | "blocked" | "missing";
export interface AdapterPreflightOptions {
    probeAuth?: boolean;
}
export interface AdapterPreflightResult {
    agentId: string;
    agentTitle: string;
    adapterKind: "demo" | "external";
    status: AdapterPreflightStatus;
    summary: string;
    command?: string;
    details?: string[];
}
export interface AgentAdapter {
    id: string;
    title: string;
    kind: "demo" | "external";
    preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult>;
    execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult>;
}
export interface JudgeResult {
    label: string;
    command: string;
    exitCode: number | null;
    success: boolean;
    stdout: string;
    stderr: string;
    durationMs: number;
}
export interface DiffSummary {
    added: string[];
    changed: string[];
    removed: string[];
}
export interface AgentRunResult {
    agentId: string;
    agentTitle: string;
    status: "success" | "failed";
    adapterKind: "demo" | "external";
    preflight: AdapterPreflightResult;
    summary: string;
    durationMs: number;
    tokenUsage: number;
    estimatedCostUsd: number;
    costKnown: boolean;
    changedFiles: string[];
    changedFilesHint: string[];
    judgeResults: JudgeResult[];
    tracePath: string;
    workspacePath: string;
    diff: DiffSummary;
}
export interface BenchmarkRun {
    runId: string;
    createdAt: string;
    repoPath: string;
    outputPath: string;
    task: TaskPack;
    preflights: AdapterPreflightResult[];
    results: AgentRunResult[];
}
export interface FileSnapshotEntry {
    relativePath: string;
    hash: string;
}
export declare function createRunId(date?: Date): string;
export declare function normalizePath(inputPath: string): string;
export declare function ensureDirectory(dirPath: string): Promise<void>;
export declare function copyRepository(sourcePath: string, destinationPath: string): Promise<void>;
export declare function snapshotDirectory(rootPath: string): Promise<Map<string, FileSnapshotEntry>>;
export declare function diffSnapshots(before: Map<string, FileSnapshotEntry>, after: Map<string, FileSnapshotEntry>): DiffSummary;
export declare function uniqueSorted(values: string[]): string[];
export declare function formatDuration(durationMs: number): string;
