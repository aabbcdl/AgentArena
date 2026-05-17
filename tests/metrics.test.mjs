import assert from "node:assert/strict";
import test from "node:test";
import { Counter, exportAllMetrics, Gauge, Histogram, metrics } from "../packages/core/dist/index.js";

test("Counter increments correctly", () => {
  const counter = new Counter("test_counter", "Test counter", ["label"]);
  assert.equal(counter.getValue(), 0);
  counter.inc();
  assert.equal(counter.getValue(), 1);
  counter.inc({ label: "value" }, 5);
  assert.equal(counter.getValue({ label: "value" }), 5);
});

test("Counter exports valid Prometheus format", () => {
  const counter = new Counter("test_export_counter", "Test export counter", ["env"]);
  counter.inc({ env: "prod" }, 10);
  const output = counter.export();
  assert.ok(output.includes("test_export_counter"));
  assert.ok(output.includes('env="prod"'));
  assert.ok(output.includes("10"));
});

test("Gauge sets and increments values", () => {
  const gauge = new Gauge("test_gauge", "Test gauge", ["type"]);
  gauge.set(100);
  assert.equal(gauge.getValue(), 100);
  gauge.inc({ type: "memory" }, 50);
  assert.equal(gauge.getValue({ type: "memory" }), 50);
  gauge.dec({ type: "memory" }, 20);
  assert.equal(gauge.getValue({ type: "memory" }), 30);
});

test("Gauge exports valid Prometheus format", () => {
  const gauge = new Gauge("test_export_gauge", "Test export gauge", ["region"]);
  gauge.set({ region: "us-west" }, 42);
  const output = gauge.export();
  assert.ok(output.includes("test_export_gauge"));
  assert.ok(output.includes('region="us-west"'));
  assert.ok(output.includes("42"));
});

test("Histogram observes values", () => {
  const histogram = new Histogram("test_histogram", "Test histogram", [0.1, 0.5, 1], ["path"]);
  histogram.observe({ path: "/api" }, 0.3);
  histogram.observe({ path: "/api" }, 0.7);
  const output = histogram.export();
  assert.ok(output.includes("test_histogram_bucket"));
  assert.ok(output.includes("test_histogram_sum"));
  assert.ok(output.includes("test_histogram_count"));
});

test("Histogram exports with buckets", () => {
  const histogram = new Histogram("test_buckets_histogram", "Test buckets", [1, 5, 10]);
  histogram.observe(3);
  histogram.observe(7);
  const output = histogram.export();
  assert.ok(output.includes('le="1"'));
  assert.ok(output.includes('le="5"'));
  assert.ok(output.includes('le="10"'));
  assert.ok(output.includes('le="+Inf"'));
});

test("exportAllMetrics includes all predefined metrics", () => {
  const output = exportAllMetrics();
  assert.ok(output.includes("agentarena_http_requests_total"));
  assert.ok(output.includes("agentarena_agent_status_total"));
  assert.ok(output.includes("agentarena_judge_execution_total"));
  assert.ok(output.includes("agentarena_git_operation_total"));
});

test("metrics object has expected keys", () => {
  assert.ok(metrics.httpRequestsTotal instanceof Counter);
  assert.ok(metrics.httpRequestDuration instanceof Histogram);
  assert.ok(metrics.agentStatusTotal instanceof Counter);
  assert.ok(metrics.agentTimeoutTotal instanceof Counter);
  assert.ok(metrics.agentExecuteTotal instanceof Counter);
  assert.ok(metrics.agentDurationSeconds instanceof Histogram);
  assert.ok(metrics.agentCostUsd instanceof Histogram);
  assert.ok(metrics.agentTokenUsage instanceof Histogram);
  assert.ok(metrics.preflightTotal instanceof Counter);
  assert.ok(metrics.traceWriteErrorsTotal instanceof Counter);
  assert.ok(metrics.runStateRecoveryTotal instanceof Counter);
  assert.ok(metrics.activeWorkspaces instanceof Gauge);
  assert.ok(metrics.publishTotal instanceof Counter);
  assert.ok(metrics.publishDurationSeconds instanceof Histogram);
  assert.ok(metrics.judgePassRate instanceof Gauge);
  assert.ok(metrics.rateLimitTriggeredTotal instanceof Counter);
  assert.ok(metrics.authFailureTotal instanceof Counter);
  assert.ok(metrics.judgeExecutionTotal instanceof Counter);
  assert.ok(metrics.judgeExecutionDurationSeconds instanceof Histogram);
  assert.ok(metrics.gitOperationTotal instanceof Counter);
  assert.ok(metrics.gitOperationDurationSeconds instanceof Histogram);
});
