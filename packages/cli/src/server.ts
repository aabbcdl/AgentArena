/**
 * UI HTTP server module.
 *
 * Extracted from cli/index.ts to separate server logic from CLI entry point.
 * Handles: rate limiting, CORS, token auth, API routing, static file serving.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import path from "node:path";
import { auditLogger, logger, metrics } from "@agentarena/core";

// Rate limiting
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const RATE_LIMIT_EXPENSIVE_MAX = 30; // Increased from 10 - preflight is called frequently by UI
const RATE_LIMIT_EXPENSIVE_PATHS = new Set([
  "/api/run",
  "/api/run/cancel",
  "/api/preflight",
  "/api/quick-preflight",
  "/api/check-compatibility",
  "/api/create-adhoc-taskpack",
  "/api/provider-profiles"
]);

interface RateLimitEntry {
  timestamps: number[];
  expensiveTimestamps: number[];
}

const RATE_LIMIT_MAX_STORE_SIZE = 10_000;
const rateLimitStore = new Map<string, RateLimitEntry>();

// Proxy trust configuration
let trustProxy = false;
const trustedProxyIps = new Set<string>();

export function setTrustProxy(enabled: boolean, trustedIps?: string[]): void {
  trustProxy = enabled;
  trustedProxyIps.clear(); // Replace, don't append
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

  // Evict oldest entry when store is at capacity to prevent unbounded growth
  if (!rateLimitStore.has(ip) && rateLimitStore.size >= RATE_LIMIT_MAX_STORE_SIZE) {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of rateLimitStore) {
      const lastTs = entry.timestamps[entry.timestamps.length - 1] ?? 0;
      if (lastTs < oldestTime) {
        oldestTime = lastTs;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      rateLimitStore.delete(oldestKey);
    }
  }

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
  const handle = setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    for (const [ip, entry] of rateLimitStore) {
      if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] < cutoff) {
        rateLimitStore.delete(ip);
      }
    }
    // Evict oldest entries if store exceeds max size
    if (rateLimitStore.size > RATE_LIMIT_MAX_STORE_SIZE) {
      const excess = rateLimitStore.size - RATE_LIMIT_MAX_STORE_SIZE;
      // Collect candidates with their oldest timestamp, then evict the N oldest
      const candidates: Array<{ ip: string; lastTs: number }> = [];
      for (const [ip, entry] of rateLimitStore) {
        const lastTs = entry.timestamps[entry.timestamps.length - 1] ?? 0;
        candidates.push({ ip, lastTs });
      }
      // Partial sort: only need the `excess` smallest elements, but a full sort
      // on the compact candidate array is still cheaper than sorting spread Map entries.
      candidates.sort((a, b) => a.lastTs - b.lastTs);
      for (let i = 0; i < excess; i++) {
        rateLimitStore.delete(candidates[i].ip);
      }
    }
  }, RATE_LIMIT_WINDOW_MS);
  handle.unref(); // Don't prevent process exit if server is shut down
  return handle;
}

// Auth
export function generateAuthToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Cache of computed allowed-origin Sets keyed by `host:port`.
 *
 * The host and port are immutable for the lifetime of a server, so the Set
 * (8 entries + the 4-entry `0.0.0.0` extension) can be built once and reused
 * across every request. Previously this was constructed on every CORS check,
 * adding hundreds of needless allocations per second under load.
 */
const corsOriginCache = new Map<string, Set<string>>();

function buildAllowedOrigins(host: string, port: number): Set<string> {
  const cacheKey = `${host}:${port}`;
  const cached = corsOriginCache.get(cacheKey);
  if (cached) return cached;
  // Normalize host for IPv6 bracket notation (browsers send [::1] but config may have ::1)
  const normalizedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const allowed = new Set([
    `http://${normalizedHost}:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://[::1]:${port}`,
    `https://${normalizedHost}:${port}`,
    `https://localhost:${port}`,
    `https://127.0.0.1:${port}`,
    `https://[::1]:${port}`,
  ]);
  if (host === "0.0.0.0") {
    allowed.add(`http://localhost:${port}`);
    allowed.add(`http://127.0.0.1:${port}`);
    allowed.add(`https://localhost:${port}`);
    allowed.add(`https://127.0.0.1:${port}`);
  }
  // Evict oldest entry if cache grows beyond reasonable bound (single-server model)
  if (corsOriginCache.size > 16) {
    const firstKey = corsOriginCache.keys().next().value;
    if (firstKey !== undefined) corsOriginCache.delete(firstKey);
  }
  corsOriginCache.set(cacheKey, allowed);
  return allowed;
}

export function checkCorsOrigin(origin: string | undefined, host: string, port: number): boolean {
  if (!origin) return true;
  // Reject null origin (from file:// protocol, privacy redirects, etc.)
  if (origin === "null") return false;
  return buildAllowedOrigins(host, port).has(origin);
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
  "/api/quick-preflight",
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
    // Use crypto.timingSafeEqual for constant-time comparison (prevents timing attacks).
    // Pad the shorter buffer to match the longer one to avoid leaking length via timing.
    const expectedBuf = Buffer.from(authToken, "utf8");
    const providedBuf = Buffer.from(providedToken, "utf8");
    const maxLen = Math.max(expectedBuf.length, providedBuf.length, 1);
    const paddedExpected = Buffer.alloc(maxLen);
    const paddedProvided = Buffer.alloc(maxLen);
    expectedBuf.copy(paddedExpected);
    providedBuf.copy(paddedProvided);
    const mismatch = timingSafeEqual(paddedExpected, paddedProvided) ? 0 : 1;
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
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'",
      // Prevent caching of API responses that may contain sensitive data
      "Pragma": "no-cache"
    }
  };
}

export function textResponse(body: string, statusCode = 200): { statusCode: number; body: string; headers: Record<string, string> } {
  return {
    statusCode,
    body,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff"
    }
  };
}

export class HttpError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "HttpError";
  }
}

/** Maximum request body size (1 MB) */
const MAX_REQUEST_BODY_BYTES = 1_048_576;
/** Request body read timeout (30 seconds) */
const REQUEST_BODY_TIMEOUT_MS = 30_000;

export async function readRequestBody(request: http.IncomingMessage, maxBytes = MAX_REQUEST_BODY_BYTES, timeoutMs = REQUEST_BODY_TIMEOUT_MS): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  const abortController = new AbortController();
  const timeoutTimer = setTimeout(() => {
    abortController.abort();
    request.destroy();
  }, timeoutMs);

  try {
    for await (const chunk of request) {
      if (abortController.signal.aborted) {
        throw new HttpError("Request body read timed out.", 408);
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        throw new HttpError("Request body too large.", 413);
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new HttpError("Request body read timed out.", 408);
    }
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
  }
}

export function detectContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".xml": return "application/xml; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".wasm": return "application/wasm";
    case ".webmanifest": return "application/manifest+json";
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".avif": return "image/avif";
    case ".ico": return "image/x-icon";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    case ".ttf": return "font/ttf";
    case ".otf": return "font/otf";
    case ".eot": return "application/vnd.ms-fontobject";
    case ".map": return "application/json";
    case ".pdf": return "application/pdf";
    case ".mp4": return "video/mp4";
    case ".mp3": return "audio/mpeg";
    case ".webm": return "video/webm";
    case ".txt": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}
