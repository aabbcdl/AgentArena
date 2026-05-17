/**
 * UI HTTP server module.
 *
 * Extracted from cli/index.ts to separate server logic from CLI entry point.
 * Handles: rate limiting, CORS, token auth, API routing, static file serving.
 */

import { randomBytes } from "node:crypto";
import type http from "node:http";
import path from "node:path";
import { auditLogger, logger, metrics } from "@agentarena/core";

// Rate limiting
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const RATE_LIMIT_EXPENSIVE_MAX = 10;
const RATE_LIMIT_EXPENSIVE_PATHS = new Set([
  "/api/run",
  "/api/run/cancel",
  "/api/preflight",
  "/api/create-adhoc-taskpack",
  "/api/provider-profiles"
]);

interface RateLimitEntry {
  timestamps: number[];
  expensiveTimestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Proxy trust configuration
let trustProxy = false;
const trustedProxyIps = new Set<string>();

export function setTrustProxy(enabled: boolean, trustedIps?: string[]): void {
  trustProxy = enabled;
  if (trustedIps) {
    for (const ip of trustedIps) {
      trustedProxyIps.add(ip);
    }
  }
}

/**
 * Extract client IP from request, respecting X-Forwarded-For when proxy is trusted.
 */
export function getClientIp(request: http.IncomingMessage): string {
  const socketIp = request.socket.remoteAddress ?? "unknown";

  if (!trustProxy) {
    return socketIp;
  }

  // If specific trusted IPs are configured, only trust those
  if (trustedProxyIps.size > 0 && !trustedProxyIps.has(socketIp)) {
    return socketIp;
  }

  // Read X-Forwarded-For header
  // Use the LAST entry added by the trusted proxy, not the first (which is easily spoofable)
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    const ips = forwardedFor.split(",").map(ip => ip.trim()).filter(Boolean);
    // The rightmost IP before the proxy's own entry is the real client
    const clientIp = ips.length >= 2 ? ips[ips.length - 2] : ips[0];
    if (clientIp) {
      return clientIp;
    }
  }

  return socketIp;
}

export function checkRateLimit(ip: string, pathname: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  let entry = rateLimitStore.get(ip);
  if (!entry) {
    entry = { timestamps: [], expensiveTimestamps: [] };
    rateLimitStore.set(ip, entry);
  }

  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
  entry.expensiveTimestamps = entry.expensiveTimestamps.filter((t) => t > windowStart);

  const isExpensive = RATE_LIMIT_EXPENSIVE_PATHS.has(pathname);

  if (isExpensive && entry.expensiveTimestamps.length >= RATE_LIMIT_EXPENSIVE_MAX) {
    const oldest = entry.expensiveTimestamps[0];
    metrics.rateLimitTriggeredTotal.inc({ clientIp: ip.slice(0, 3) + "***", path: pathname });
    logger.warn("server", "rate.limit", "Rate limit exceeded", { metadata: { path: pathname } });
    auditLogger.rateLimitTriggered("Rate limit exceeded", {
      clientIp: ip,
      resourceType: "api",
      resourceId: pathname,
    });
    return { allowed: false, retryAfterMs: oldest + RATE_LIMIT_WINDOW_MS - now };
  }

  if (entry.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = entry.timestamps[0];
    metrics.rateLimitTriggeredTotal.inc({ clientIp: ip.slice(0, 3) + "***", path: pathname });
    logger.warn("server", "rate.limit", "Rate limit exceeded", { metadata: { path: pathname } });
    auditLogger.rateLimitTriggered("Rate limit exceeded", {
      clientIp: ip,
      resourceType: "api",
      resourceId: pathname,
    });
    return { allowed: false, retryAfterMs: oldest + RATE_LIMIT_WINDOW_MS - now };
  }

  entry.timestamps.push(now);
  if (isExpensive) {
    entry.expensiveTimestamps.push(now);
  }

  return { allowed: true };
}

export function startRateLimitCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    for (const [ip, entry] of rateLimitStore) {
      if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] < cutoff) {
        rateLimitStore.delete(ip);
      }
    }
  }, RATE_LIMIT_WINDOW_MS);
}

// Auth
export function generateAuthToken(): string {
  return randomBytes(32).toString("hex");
}

export function checkCorsOrigin(origin: string | undefined, host: string, port: number): boolean {
  if (!origin) return true;
  // Reject null origin (from file:// protocol, privacy redirects, etc.)
  if (origin === "null") return false;
  const allowedOrigins = new Set([
    `http://${host}:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`
  ]);
  if (host === "0.0.0.0") {
    allowedOrigins.add(`http://localhost:${port}`);
    allowedOrigins.add(`http://127.0.0.1:${port}`);
  }
  return allowedOrigins.has(origin);
}

/**
 * Paths that expose sensitive data (secrets, credentials, profiles).
 * These always require authentication, even on localhost.
 */
const SENSITIVE_API_PATHS = new Set([
  "/api/provider-profiles",
  "/api/run",
  "/api/run/cancel",
  "/api/preflight",
  "/api/create-adhoc-taskpack",
]);

/**
 * Check if a path pattern matches a sensitive path (including sub-paths like /api/provider-profiles/:id/secret).
 */
function isSensitivePath(pathname: string): boolean {
  if (SENSITIVE_API_PATHS.has(pathname)) return true;
  // Match sub-paths: /api/provider-profiles/:id, /api/provider-profiles/:id/secret
  if (pathname.startsWith("/api/provider-profiles/")) return true;
  return false;
}

export function checkAuthHeader(
  requestUrl: URL,
  method: string | undefined,
  isLocalhost: boolean,
  authToken: string,
  authHeader: string | undefined,
  clientIp?: string
): boolean {
  const isApiPath = requestUrl.pathname.startsWith("/api/");
  if (!isApiPath) return true;

  // Sensitive API paths ALWAYS require auth, even on localhost
  const isSensitive = isSensitivePath(requestUrl.pathname);
  const isDestructiveApi = method !== "GET";

  if (isSensitive || isDestructiveApi || !isLocalhost) {
    const providedToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    // Use timing-safe comparison to prevent timing attacks
    // Constant-time comparison: always iterate over the expected token length
    // to avoid leaking the token length via timing differences.
    let mismatch = providedToken.length !== authToken.length ? 1 : 0;
    for (let i = 0; i < authToken.length; i++) {
      mismatch |= (i < providedToken.length ? providedToken.charCodeAt(i) : 0) ^ authToken.charCodeAt(i);
    }
    if (mismatch !== 0) {
      const maskedIp = clientIp ? clientIp.slice(0, 3) + "***" : "unknown";
      metrics.authFailureTotal.inc({ clientIp: maskedIp, path: requestUrl.pathname });
      logger.warn("server", "auth.verify", "Authentication failed: token mismatch (length or content)", {
        metadata: { path: requestUrl.pathname, method }
      });
      auditLogger.authFailure("Authentication failed: token mismatch", {
        clientIp,
        resourceType: "api",
        resourceId: requestUrl.pathname,
        metadata: { method },
      });
    } else {
      auditLogger.authSuccess("Authentication successful", {
        clientIp,
        resourceType: "api",
        resourceId: requestUrl.pathname,
        metadata: { method },
      });
    }
    return mismatch === 0;
  }
  return true;
}

// Response helpers
export function jsonResponse(data: unknown, statusCode = 200): { statusCode: number; body: string; headers: Record<string, string> } {
  return {
    statusCode,
    body: JSON.stringify(data, null, 2),
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
      // Prevent caching of API responses that may contain sensitive data
      "Pragma": "no-cache"
    }
  };
}

export function textResponse(body: string, statusCode = 200): { statusCode: number; body: string; headers: Record<string, string> } {
  return {
    statusCode,
    body,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
  };
}

export class HttpError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "HttpError";
  }
}

export async function readRequestBody(request: http.IncomingMessage, maxBytes = 1_048_576, timeoutMs = 30_000): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      request.destroy();
      reject(new HttpError("Request body read timed out.", 408));
    }, timeoutMs);
    request.on("end", () => clearTimeout(timer));
    request.on("error", () => clearTimeout(timer));
    request.on("close", () => clearTimeout(timer));
  });

  const readPromise = (async () => {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        throw new HttpError("Request body too large.", 413);
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

export function detectContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".wasm": return "application/wasm";
    case ".webmanifest": return "application/manifest+json";
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".ico": return "image/x-icon";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    case ".ttf": return "font/ttf";
    default: return "application/octet-stream";
  }
}
