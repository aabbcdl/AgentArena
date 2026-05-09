/**
 * UI HTTP server module.
 *
 * Extracted from cli/index.ts to separate server logic from CLI entry point.
 * Handles: rate limiting, CORS, token auth, API routing, static file serving.
 */

import { randomUUID } from "node:crypto";
import type http from "node:http";
import path from "node:path";

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
    return { allowed: false, retryAfterMs: oldest + RATE_LIMIT_WINDOW_MS - now };
  }

  if (entry.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = entry.timestamps[0];
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
  return randomUUID();
}

export function checkCorsOrigin(origin: string | undefined, host: string, port: number): boolean {
  if (!origin) return true;
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

export function checkAuthHeader(
  requestUrl: URL,
  method: string | undefined,
  isLocalhost: boolean,
  authToken: string,
  authHeader: string | undefined
): boolean {
  const isDestructiveApi = method !== "GET" && requestUrl.pathname.startsWith("/api/");
  if (isDestructiveApi || (!isLocalhost && requestUrl.pathname.startsWith("/api/"))) {
    const providedToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    return providedToken === authToken;
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
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
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

export async function readRequestBody(request: http.IncomingMessage, maxBytes = 1_048_576): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new HttpError("Request body too large.", 413);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
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
