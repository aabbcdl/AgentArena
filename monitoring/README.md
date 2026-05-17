# AgentArena 监控与告警方案

本文档描述了 AgentArena 的监控、日志和告警系统。

## 目录

- [指标系统](#指标系统)
- [结构化日志](#结构化日志)
- [安全审计日志](#安全审计日志)
- [告警配置](#告警配置)
- [Grafana 仪表盘](#grafana-仪表盘)
- [性能优化](#性能优化)

---

## 指标系统

AgentArena 使用 Prometheus 风格的指标系统，支持三种核心指标类型：

### 指标类型

1. **Counter（计数器）** - 单调递增的数值，如请求总数、执行次数
2. **Gauge（仪表盘）** - 可增可减的数值，如活跃工作区数量、通过率
3. **Histogram（直方图）** - 分布统计，如请求耗时、成本分布

### 可用指标

| 指标名称 | 类型 | 说明 | 标签 |
|---------|-----|------|-----|
| `agentarena_http_requests_total` | Counter | HTTP 请求总数 | method, path, status |
| `agentarena_http_request_duration_seconds` | Histogram | HTTP 请求耗时 | method, path |
| `agentarena_agent_status_total` | Counter | Agent 执行状态统计 | status, agentId, adapterKind |
| `agentarena_agent_timeout_total` | Counter | Agent 超时统计 | agentId, adapterKind |
| `agentarena_agent_execute_total` | Counter | Agent 执行启动统计 | agentId, adapterKind |
| `agentarena_agent_duration_seconds` | Histogram | Agent 执行耗时 | agentId, status |
| `agentarena_agent_cost_usd` | Histogram | Agent 执行成本 | agentId |
| `agentarena_agent_token_usage` | Histogram | Agent Token 使用量 | agentId |
| `agentarena_preflight_total` | Counter | 预检查统计 | status, agentId |
| `agentarena_trace_write_errors_total` | Counter | Trace 写入错误统计 | filePath |
| `agentarena_run_state_recovery_total` | Counter | 运行状态恢复统计 | - |
| `agentarena_active_workspaces` | Gauge | 活跃工作区数量 | - |
| `agentarena_publish_total` | Counter | 发布操作统计 | status, taskPackId |
| `agentarena_publish_duration_seconds` | Histogram | 发布操作耗时 | taskPackId |
| `agentarena_judge_pass_rate` | Gauge | 判定通过率 | agentId |
| `agentarena_rate_limit_triggered_total` | Counter | 限流触发统计 | clientIp, path |
| `agentarena_auth_failure_total` | Counter | 认证失败统计 | clientIp, path |
| `agentarena_judge_execution_total` | Counter | 判定执行统计 | type, status |
| `agentarena_judge_execution_duration_seconds` | Histogram | 判定执行耗时 | type |
| `agentarena_git_operation_total` | Counter | Git 操作统计 | operation, status |
| `agentarena_git_operation_duration_seconds` | Histogram | Git 操作耗时 | operation |

### 指标查询示例

```promql
# 过去5分钟内每秒平均 HTTP 请求数
sum(rate(agentarena_http_requests_total[5m]))

# Agent 执行 P95 耗时
histogram_quantile(0.95, sum(rate(agentarena_agent_duration_seconds_bucket[5m])) by (le, agentId))

# 认证失败率
sum(rate(agentarena_auth_failure_total[5m])) / sum(rate(agentarena_http_requests_total[5m]))

# 判定通过率
agentarena_judge_pass_rate
```

---

## 结构化日志

AgentArena 提供了结构化日志功能，包含敏感数据自动脱敏。

### 创建日志

```typescript
import { logger } from "@agentarena/core";

// 不同级别的日志
logger.debug("runner", "task.start", "Starting task execution", {
  runId: "run-20240101-120000-abc123",
  agentId: "codex"
});

logger.info("server", "request.received", "Received HTTP request", {
  path: "/api/run",
  method: "POST"
});

logger.warn("trace", "write.slow", "Trace writing is slow", {
  filePath: "/path/to/trace.json"
});

logger.error("judge", "execution.failed", "Judge execution failed", {
  error: new Error("Something went wrong")
});
```

### 日志格式

每条日志包含以下字段：

```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "level": "INFO",
  "component": "server",
  "action": "request.received",
  "runId": "run-...",
  "agentId": "codex",
  "variantId": "codex-gpt-4",
  "message": "Description",
  "metadata": { ... },
  "error": {
    "name": "Error",
    "message": "Error message",
    "code": "ERROR_CODE"
  }
}
```

### 敏感数据脱敏

日志系统会自动检测并脱敏以下敏感数据：

- password
- secret
- apiKey / api_key
- token
- bearer token
- privateKey / private_key

脱敏示例：
```json
{
  "password": "passw****",
  "apiKey": "key_****"
}
```

---

## 安全审计日志

除了常规日志，AgentArena 还提供专门的安全审计日志功能：

### 审计操作

| 操作 | 说明 |
|-----|------|
| auth_success | 认证成功 |
| auth_failure | 认证失败 |
| rate_limit_triggered | 触发限流 |
| provider_profile_created | 创建 Provider 配置 |
| provider_profile_updated | 更新 Provider 配置 |
| provider_profile_deleted | 删除 Provider 配置 |
| provider_secret_updated | 更新 Provider 密钥 |
| api_access_denied | API 访问拒绝 |
| agent_execution_started | Agent 执行开始 |
| agent_execution_completed | Agent 执行完成 |

### 使用审计日志

```typescript
import { auditLogger } from "@agentarena/core";

// 记录认证成功
auditLogger.authSuccess("User authenticated", {
  clientIp: "192.168.1.1",
  resourceType: "api",
  resourceId: "/api/run"
});

// 记录认证失败
auditLogger.authFailure("Invalid token", {
  clientIp: "192.168.1.1",
  resourceType: "api",
  resourceId: "/api/run"
});
```

---

## 告警配置

告警规则定义在 `monitoring/alerts.yaml` 文件中。

### Prometheus 告警规则

告警规则分为三个级别：

1. **Critical（严重）** - 需要立即响应，如系统不可用
2. **Warning（警告）** - 需要关注，如性能下降
3. **Info（信息）** - 一般事件通知

### 告警规则示例

```yaml
# agent arena 告警规则
groups:
  - name: agentarena
    rules:
      # 严重告警
      - alert: HighErrorRate
        expr: |
          sum(rate(agentarena_http_requests_total{status=~"5.."}[5m]))
          /
          sum(rate(agentarena_http_requests_total[5m]))
          > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "高错误率"
          description: "过去5分钟内HTTP错误率超过10%"

      # 警告
      - alert: HighAuthFailures
        expr: sum(rate(agentarena_auth_failure_total[5m])) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "认证失败次数高"
          description: "过去5分钟内认证失败次数超过10次"

      # 信息
      - alert: AgentTimeout
        expr: sum(rate(agentarena_agent_timeout_total[5m])) > 0
        for: 1m
        labels:
          severity: info
        annotations:
          summary: "Agent 超时"
          description: "检测到 Agent 执行超时"
```

---

## Grafana 仪表盘

AgentArena 提供了预配置的 Grafana 仪表盘：`monitoring/grafana-dashboard.json`

### 仪表盘面板

- **概览** - 总请求数、Agent 执行数、判定执行数、认证失败数
- **Agent 性能** - 执行耗时、状态分布、超时统计
- **系统健康** - 请求耗时、状态码分布、判定执行、Git 操作
- **安全与错误** - 限流触发、错误统计

### 导入仪表盘

1. 打开 Grafana
2. 导航到 `Dashboards` → `Import`
3. 上传 `grafana-dashboard.json` 文件
4. 选择 Prometheus 数据源
5. 点击 "Import"

---

## 性能优化

指标系统内置了多项性能优化：

### 缓存机制

- 每个指标单独缓存（100ms 有效期）
- 全局指标导出缓存（100ms 有效期）
- 指标更新时自动失效相关缓存

### 使用缓存

```typescript
import { metrics, exportAllMetrics, invalidateAllMetricsCaches } from "@agentarena/core";

// 更新指标时会自动失效缓存
metrics.httpRequestsTotal.inc({ method: "GET", path: "/api", status: "200" });

// 导出指标（会使用缓存）
const prometheusMetrics = exportAllMetrics();

// 手动失效所有缓存（特殊场景）
invalidateAllMetricsCaches();
```

### 性能建议

1. 对于高频请求场景，Prometheus 拉取间隔建议设置为 15-30s
2. 避免在同一个请求中多次调用 `exportAllMetrics()`
3. 可通过 `setMetricHandler()` 集成外部监控系统

---

## 快速开始

### 1. 启动 Prometheus

将以下配置添加到 Prometheus 配置文件中：

```yaml
scrape_configs:
  - job_name: 'agentarena'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:4320']
    metrics_path: '/api/metrics'
```

### 2. 启动 Grafana

参考上面的「导入仪表盘」部分。

### 3. 配置告警规则

将 `monitoring/alerts.yaml` 添加到 Prometheus 告警规则配置中。
