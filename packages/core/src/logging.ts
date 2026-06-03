// randomUUID removed — generateRunId now delegates to utils.ts

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type LogComponent = "runner" | "server" | "trace" | "publish" | "judge" | "adapter" | "core" | "evidence";

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  component: LogComponent;
  action: string;
  runId?: string;
  agentId?: string;
  variantId?: string;
  message: string;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
  };
}

const SENSITIVE_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /auth[_-]?key/i,
  /private[_-]?key/i,
  /bearer/i,
  /sk-[a-zA-Z0-9]/i,
];

const SENSITIVE_KEYS = new Set([
  "token",
  "secret",
  "password",
  "apikey",
  "api_key",
  "authtoken",
  "auth_token",
  "privatekey",
  "private_key",
  "bearer",
  "authorization",
]);

function redactSensitiveValue(key: string, value: unknown): unknown {
  const lowerKey = key.toLowerCase();
  
  if (SENSITIVE_KEYS.has(lowerKey) || SENSITIVE_PATTERNS.some(p => p.test(key))) {
    return "****";
  }
  
  return value;
}

function redactObject(obj: unknown, depth = 0): unknown {
  if (depth > 10) return "[max depth]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Buffer.isBuffer(obj)) return "[Buffer]";
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: obj.message,
      code: (obj as NodeJS.ErrnoException).code,
    };
  }
  
  if (Array.isArray(obj)) {
    return obj.slice(0, 100).map(v => redactObject(v, depth + 1));
  }
  
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = redactSensitiveValue(key, redactObject(value, depth + 1));
  }
  return result;
}

export function createLogEntry(
  level: LogLevel,
  component: LogComponent,
  action: string,
  message: string,
  options?: {
    runId?: string;
    agentId?: string;
    variantId?: string;
    metadata?: Record<string, unknown>;
    error?: Error | unknown;
  }
): StructuredLogEntry {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    action,
    message,
  };

  if (options?.runId) entry.runId = options.runId;
  if (options?.agentId) entry.agentId = options.agentId;
  if (options?.variantId) entry.variantId = options.variantId;
  
  if (options?.metadata) {
    entry.metadata = redactObject(options.metadata) as Record<string, unknown>;
  }

  if (options?.error) {
    const err = options.error instanceof Error ? options.error : new Error(String(options.error));
    entry.error = {
      name: err.name,
      message: err.message,
      code: (err as NodeJS.ErrnoException).code,
      stack: err.stack,
    };
  }

  return entry;
}

export function formatLogEntry(entry: StructuredLogEntry): string {
  return JSON.stringify(entry);
}

export function log(
  level: LogLevel,
  component: LogComponent,
  action: string,
  message: string,
  options?: Parameters<typeof createLogEntry>[4]
): void {
  const entry = createLogEntry(level, component, action, message, options);
  const formatted = formatLogEntry(entry);
  
  switch (level) {
    case "ERROR":
      console.error(formatted);
      break;
    case "WARN":
      console.warn(formatted);
      break;
    case "DEBUG":
      if (process.env.AGENTARENA_DEBUG === "1" || process.env.AGENTARENA_DEBUG === "true") {
        console.log(formatted);
      }
      break;
    default:
      console.log(formatted);
  }
}

export const logger = {
  debug: (component: LogComponent, action: string, message: string, options?: Parameters<typeof createLogEntry>[4]) =>
    log("DEBUG", component, action, message, options),
  info: (component: LogComponent, action: string, message: string, options?: Parameters<typeof createLogEntry>[4]) =>
    log("INFO", component, action, message, options),
  warn: (component: LogComponent, action: string, message: string, options?: Parameters<typeof createLogEntry>[4]) =>
    log("WARN", component, action, message, options),
  error: (component: LogComponent, action: string, message: string, options?: Parameters<typeof createLogEntry>[4]) =>
    log("ERROR", component, action, message, options),
};

/**
 * Generate a unique run ID.
 * Delegates to createRunId from utils.ts for consistency.
 * Re-exported here for backward compatibility.
 */
export { createRunId as generateRunId } from "./utils.js";

export type AuditAction =
  | "auth_success"
  | "auth_failure"
  | "token_used"
  | "token_refreshed"
  | "token_revoked"
  | "rate_limit_triggered"
  | "provider_profile_created"
  | "provider_profile_updated"
  | "provider_profile_deleted"
  | "provider_secret_updated"
  | "api_access_denied"
  | "workspace_created"
  | "workspace_cleaned"
  | "agent_execution_started"
  | "agent_execution_completed"
  | "publish_started"
  | "publish_completed";

export interface AuditLogEntry extends StructuredLogEntry {
  auditAction: AuditAction;
  clientIp?: string;
  userId?: string;
  resourceId?: string;
  resourceType?: string;
  success: boolean;
}

export function createAuditLogEntry(
  auditAction: AuditAction,
  message: string,
  options: {
    success: boolean;
    clientIp?: string;
    userId?: string;
    resourceId?: string;
    resourceType?: string;
    runId?: string;
    agentId?: string;
    variantId?: string;
    metadata?: Record<string, unknown>;
  }
): AuditLogEntry {
  const baseEntry = createLogEntry("INFO", "core", auditAction, message, {
    runId: options.runId,
    agentId: options.agentId,
    variantId: options.variantId,
    metadata: options.metadata,
  });

  return {
    ...baseEntry,
    auditAction,
    clientIp: options.clientIp,
    userId: options.userId,
    resourceId: options.resourceId,
    resourceType: options.resourceType,
    success: options.success,
  };
}

export function auditLog(
  auditAction: AuditAction,
  message: string,
  options: Parameters<typeof createAuditLogEntry>[2]
): void {
  const entry = createAuditLogEntry(auditAction, message, options);
  console.error(JSON.stringify(entry));
}

export const auditLogger = {
  authSuccess: (message: string, options: Omit<Parameters<typeof auditLog>[2], "success">) =>
    auditLog("auth_success", message, { ...options, success: true }),
  authFailure: (message: string, options: Omit<Parameters<typeof auditLog>[2], "success">) =>
    auditLog("auth_failure", message, { ...options, success: false }),
  rateLimitTriggered: (message: string, options: Omit<Parameters<typeof auditLog>[2], "success">) =>
    auditLog("rate_limit_triggered", message, { ...options, success: false }),
  providerProfileCreated: (message: string, options: Omit<Parameters<typeof auditLog>[2], "success">) =>
    auditLog("provider_profile_created", message, { ...options, success: true }),
  providerProfileUpdated: (message: string, options: Omit<Parameters<typeof auditLog>[2], "success">) =>
    auditLog("provider_profile_updated", message, { ...options, success: true }),
  providerProfileDeleted: (message: string, options: Omit<Parameters<typeof auditLog>[2], "success">) =>
    auditLog("provider_profile_deleted", message, { ...options, success: true }),
  providerSecretUpdated: (message: string, options: Omit<Parameters<typeof auditLog>[2], "success">) =>
    auditLog("provider_secret_updated", message, { ...options, success: true }),
  apiAccessDenied: (message: string, options: Omit<Parameters<typeof auditLog>[2], "success">) =>
    auditLog("api_access_denied", message, { ...options, success: false }),
  agentExecutionStarted: (message: string, options: Omit<Parameters<typeof auditLog>[2], "success">) =>
    auditLog("agent_execution_started", message, { ...options, success: true }),
  agentExecutionCompleted: (message: string, options: { success: boolean } & Omit<Parameters<typeof auditLog>[2], "success">) =>
    auditLog("agent_execution_completed", message, { ...options }),
};
