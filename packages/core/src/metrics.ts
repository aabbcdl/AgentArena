export interface MetricLabels {
  [key: string]: string | number;
}

export interface MetricValue {
  name: string;
  type: "counter" | "gauge" | "histogram";
  value: number;
  labels: MetricLabels;
  timestamp: number;
}

type MetricHandler = (metric: MetricValue) => void;

let metricHandler: MetricHandler | null = null;
const metricsBuffer: MetricValue[] = [];
const MAX_BUFFER_SIZE = 10000;

// Global cache for exportAllMetrics
let cachedAllMetrics: string | null = null;
let lastAllMetricsUpdate = 0;
const allMetricsCacheValidMs = 100; // 100ms cache

export function setMetricHandler(handler: MetricHandler | null): void {
  metricHandler = handler;
}

export function getMetricsBuffer(): MetricValue[] {
  return [...metricsBuffer];
}

export function clearMetricsBuffer(): void {
  metricsBuffer.length = 0;
}

/**
 * Trim the metrics buffer when it exceeds the maximum size.
 *
 * Uses batch trimming (splice off the oldest 20%) instead of per-item
 * `Array.shift()`. `shift()` on a 10,000-element array is O(n) per call,
 * causing quadratic cost under sustained metric recording. Batch trimming
 * amortizes the cost across thousands of inserts.
 */
function trimMetricsBuffer(): void {
  if (metricsBuffer.length <= MAX_BUFFER_SIZE) return;
  const trimCount = Math.floor(MAX_BUFFER_SIZE * 0.2); // Remove oldest 20%
  metricsBuffer.splice(0, trimCount);
}

export function invalidateAllMetricsCaches(): void {
  cachedAllMetrics = null;
  lastAllMetricsUpdate = 0;
}

function recordMetric(metric: MetricValue): void {
  if (metricHandler) {
    metricHandler(metric);
  }
  
  metricsBuffer.push(metric);
  trimMetricsBuffer();
}

export class Counter {
  private readonly name: string;
  private readonly help: string;
  private readonly labelNames: string[];
  private readonly values: Map<string, number> = new Map();
  private cachedExport: string | null = null;
  private lastUpdateTime = 0;
  private readonly cacheValidMs = 100; // 100ms cache

  constructor(name: string, help: string, labelNames: string[] = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
  }

  private invalidateCache(): void {
    this.cachedExport = null;
    this.lastUpdateTime = Date.now();
    invalidateAllMetricsCaches();
  }

  private getLabelKey(labels: MetricLabels = {}): string {
    return this.labelNames.map(k => `${k}="${labels[k] ?? ""}"`).join(",");
  }

  inc(labels: MetricLabels = {}, value = 1): void {
    const key = this.getLabelKey(labels);
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current + value);
    this.invalidateCache();
    
    recordMetric({
      name: this.name,
      type: "counter",
      value: current + value,
      labels,
      timestamp: Date.now(),
    });
  }

  getValue(labels: MetricLabels = {}): number {
    return this.values.get(this.getLabelKey(labels)) ?? 0;
  }

  export(): string {
    const now = Date.now();
    if (this.cachedExport && now - this.lastUpdateTime < this.cacheValidMs) {
      return this.cachedExport;
    }
    
    let output = `# HELP ${this.name} ${this.help}\n`;
    output += `# TYPE ${this.name} counter\n`;
    
    for (const [key, value] of this.values) {
      if (key) {
        output += `${this.name}{${key}} ${value}\n`;
      } else {
        output += `${this.name} ${value}\n`;
      }
    }
    
    this.cachedExport = output;
    this.lastUpdateTime = now;
    return output;
  }
}

export class Gauge {
  private readonly name: string;
  private readonly help: string;
  private readonly labelNames: string[];
  private readonly values: Map<string, number> = new Map();
  private cachedExport: string | null = null;
  private lastUpdateTime = 0;
  private readonly cacheValidMs = 100; // 100ms cache

  constructor(name: string, help: string, labelNames: string[] = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
  }

  private invalidateCache(): void {
    this.cachedExport = null;
    this.lastUpdateTime = Date.now();
    invalidateAllMetricsCaches();
  }

  private getLabelKey(labels: MetricLabels = {}): string {
    return this.labelNames.map(k => `${k}="${labels[k] ?? ""}"`).join(",");
  }

  set(labels: MetricLabels | number, value?: number): void {
    let actualLabels: MetricLabels = {};
    let actualValue: number;
    
    if (typeof labels === "number") {
      actualValue = labels;
    } else {
      actualLabels = labels;
      actualValue = value ?? 0;
    }
    
    const key = this.getLabelKey(actualLabels);
    this.values.set(key, actualValue);
    this.invalidateCache();
    
    recordMetric({
      name: this.name,
      type: "gauge",
      value: actualValue,
      labels: actualLabels,
      timestamp: Date.now(),
    });
  }

  inc(labels: MetricLabels = {}, value = 1): void {
    const key = this.getLabelKey(labels);
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current + value);
    this.invalidateCache();
    
    recordMetric({
      name: this.name,
      type: "gauge",
      value: current + value,
      labels,
      timestamp: Date.now(),
    });
  }

  dec(labels: MetricLabels = {}, value = 1): void {
    const key = this.getLabelKey(labels);
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current - value);
    this.invalidateCache();
    
    recordMetric({
      name: this.name,
      type: "gauge",
      value: current - value,
      labels,
      timestamp: Date.now(),
    });
  }

  getValue(labels: MetricLabels = {}): number {
    return this.values.get(this.getLabelKey(labels)) ?? 0;
  }

  export(): string {
    const now = Date.now();
    if (this.cachedExport && now - this.lastUpdateTime < this.cacheValidMs) {
      return this.cachedExport;
    }
    
    let output = `# HELP ${this.name} ${this.help}\n`;
    output += `# TYPE ${this.name} gauge\n`;
    
    for (const [key, value] of this.values) {
      if (key) {
        output += `${this.name}{${key}} ${value}\n`;
      } else {
        output += `${this.name} ${value}\n`;
      }
    }
    
    this.cachedExport = output;
    this.lastUpdateTime = now;
    return output;
  }
}

export class Histogram {
  private readonly name: string;
  private readonly help: string;
  private readonly buckets: number[];
  private readonly labelNames: string[];
  private readonly values: Map<string, { sum: number; count: number; buckets: Map<number, number> }> = new Map();
  private cachedExport: string | null = null;
  private lastUpdateTime = 0;
  private readonly cacheValidMs = 100; // 100ms cache

  constructor(name: string, help: string, buckets: number[] = [0.1, 0.5, 1, 2, 5, 10, 30, 60], labelNames: string[] = []) {
    this.name = name;
    this.help = help;
    this.buckets = buckets.sort((a, b) => a - b);
    this.labelNames = labelNames;
  }

  private invalidateCache(): void {
    this.cachedExport = null;
    this.lastUpdateTime = Date.now();
    invalidateAllMetricsCaches();
  }

  private getLabelKey(labels: MetricLabels = {}): string {
    return this.labelNames.map(k => `${k}="${labels[k] ?? ""}"`).join(",");
  }

  observe(labels: MetricLabels | number, value?: number): void {
    let actualLabels: MetricLabels = {};
    let actualValue: number;
    
    if (typeof labels === "number") {
      actualValue = labels;
    } else {
      actualLabels = labels;
      actualValue = value ?? 0;
    }
    
    const key = this.getLabelKey(actualLabels);
    let entry = this.values.get(key);
    
    if (!entry) {
      entry = { sum: 0, count: 0, buckets: new Map(this.buckets.map(b => [b, 0])) };
      this.values.set(key, entry);
    }
    
    entry.sum += actualValue;
    entry.count += 1;
    
    for (const bucket of this.buckets) {
      if (actualValue <= bucket) {
        entry.buckets.set(bucket, (entry.buckets.get(bucket) ?? 0) + 1);
      }
    }
    this.invalidateCache();
    
    recordMetric({
      name: this.name,
      type: "histogram",
      value: actualValue,
      labels: actualLabels,
      timestamp: Date.now(),
    });
  }

  export(): string {
    const now = Date.now();
    if (this.cachedExport && now - this.lastUpdateTime < this.cacheValidMs) {
      return this.cachedExport;
    }
    
    let output = `# HELP ${this.name} ${this.help}\n`;
    output += `# TYPE ${this.name} histogram\n`;
    
    for (const [key, entry] of this.values) {
      const labelStr = key ? `{${key}}` : "";
      
      for (const bucket of this.buckets) {
        const bucketLabel = key ? `{le="${bucket}",${key}}` : `{le="${bucket}"}`;
        output += `${this.name}_bucket${bucketLabel} ${entry.buckets.get(bucket) ?? 0}\n`;
      }
      
      output += `${this.name}_bucket${key ? `{le="+Inf",${key}}` : `{le="+Inf"}`} ${entry.count}\n`;
      output += `${this.name}_sum${labelStr} ${entry.sum}\n`;
      output += `${this.name}_count${labelStr} ${entry.count}\n`;
    }
    
    this.cachedExport = output;
    this.lastUpdateTime = now;
    return output;
  }
}

export const metrics = {
  httpRequestsTotal: new Counter(
    "agentarena_http_requests_total",
    "Total number of HTTP requests",
    ["method", "path", "status"]
  ),
  
  httpRequestDuration: new Histogram(
    "agentarena_http_request_duration_seconds",
    "HTTP request duration in seconds",
    [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    ["method", "path"]
  ),
  
  agentStatusTotal: new Counter(
    "agentarena_agent_status_total",
    "Total number of agent executions by status",
    ["status", "agentId", "adapterKind"]
  ),
  
  agentTimeoutTotal: new Counter(
    "agentarena_agent_timeout_total",
    "Total number of agent execution timeouts",
    ["agentId", "adapterKind"]
  ),
  
  agentExecuteTotal: new Counter(
    "agentarena_agent_execute_total",
    "Total number of agent executions started",
    ["agentId", "adapterKind"]
  ),
  
  agentDurationSeconds: new Histogram(
    "agentarena_agent_duration_seconds",
    "Agent execution duration in seconds",
    [10, 30, 60, 120, 300, 600, 1200, 1800],
    ["agentId", "status"]
  ),
  
  agentCostUsd: new Histogram(
    "agentarena_agent_cost_usd",
    "Agent execution cost in USD",
    [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    ["agentId"]
  ),
  
  agentTokenUsage: new Histogram(
    "agentarena_agent_token_usage",
    "Agent token usage",
    [1000, 5000, 10000, 50000, 100000, 200000, 500000],
    ["agentId"]
  ),
  
  preflightTotal: new Counter(
    "agentarena_preflight_total",
    "Total number of preflight checks",
    ["status", "agentId"]
  ),
  
  traceWriteErrorsTotal: new Counter(
    "agentarena_trace_write_errors_total",
    "Total number of trace write errors",
    ["filePath"]
  ),
  
  runStateRecoveryTotal: new Counter(
    "agentarena_run_state_recovery_total",
    "Total number of run state recoveries after server restart"
  ),
  
  activeWorkspaces: new Gauge(
    "agentarena_active_workspaces",
    "Number of active workspaces"
  ),
  
  publishTotal: new Counter(
    "agentarena_publish_total",
    "Total number of publish operations",
    ["status", "taskPackId"]
  ),
  
  publishDurationSeconds: new Histogram(
    "agentarena_publish_duration_seconds",
    "Publish operation duration in seconds",
    [5, 10, 30, 60, 120],
    ["taskPackId"]
  ),
  
  judgePassRate: new Gauge(
    "agentarena_judge_pass_rate",
    "Judge pass rate per agent",
    ["agentId"]
  ),
  
  rateLimitTriggeredTotal: new Counter(
    "agentarena_rate_limit_triggered_total",
    "Total number of rate limit triggers",
    ["clientIp", "path"]
  ),
  
  authFailureTotal: new Counter(
    "agentarena_auth_failure_total",
    "Total number of authentication failures",
    ["clientIp", "path"]
  ),
  
  judgeExecutionTotal: new Counter(
    "agentarena_judge_execution_total",
    "Total number of judge executions",
    ["type", "status"]
  ),
  
  judgeExecutionDurationSeconds: new Histogram(
    "agentarena_judge_execution_duration_seconds",
    "Judge execution duration in seconds",
    [0.1, 0.5, 1, 2, 5, 10, 30],
    ["type"]
  ),
  
  gitOperationTotal: new Counter(
    "agentarena_git_operation_total",
    "Total number of git operations",
    ["operation", "status"]
  ),
  
  gitOperationDurationSeconds: new Histogram(
    "agentarena_git_operation_duration_seconds",
    "Git operation duration in seconds",
    [0.5, 1, 5, 10, 30, 60],
    ["operation"]
  ),
};

export function exportAllMetrics(): string {
  const now = Date.now();
  if (cachedAllMetrics && now - lastAllMetricsUpdate < allMetricsCacheValidMs) {
    return cachedAllMetrics;
  }
  
  const parts: string[] = [];
  
  for (const metric of Object.values(metrics)) {
    if (metric instanceof Counter || metric instanceof Gauge || metric instanceof Histogram) {
      parts.push(metric.export());
    }
  }
  
  const result = parts.join("\n");
  cachedAllMetrics = result;
  lastAllMetricsUpdate = now;
  return result;
}
