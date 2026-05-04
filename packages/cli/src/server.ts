/**
 * UI HTTP server module.
 *
 * Extracted from cli/index.ts to separate server logic from CLI entry point.
 * Handles: rate limiting, CORS, token auth, API routing, static file serving.
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";

export interface ServerOptions {
  host: string;
  port: number;
  webReportDistRoot: string;
  /** Custom auth token. If not provided, a random one is generated. */
  authToken?: string;
  requestHandler: (request: http.IncomingMessage, requestUrl: URL) => Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;
}

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

// CORS
function checkCors(origin: string | undefined, host: string, port: number): boolean {
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

// Auth
export function generateAuthToken(): string {
  return randomUUID();
}

function checkAuth(
  requestUrl: URL,
  request: http.IncomingMessage,
  isLocalhost: boolean,
  authToken: string
): boolean {
  if (isLocalhost) return true;
  if (!requestUrl.pathname.startsWith("/api/")) return true;
  const authHeader = request.headers.authorization ?? "";
  const tokenFromQuery = requestUrl.searchParams.get("token");
  const providedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : tokenFromQuery;
  return providedToken === authToken;
}

// Response helpers
export function jsonResponse(data: unknown, statusCode = 200): { statusCode: number; body: string; headers: Record<string, string> } {
  return {
    statusCode,
    body: JSON.stringify(data, null, 2),
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
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
    default: return "application/octet-stream";
  }
}

// Static file serving
export async function serveStaticFile(
  requestUrl: URL,
  webReportDistRoot: string
): Promise<{ statusCode: number; body: Buffer | string; headers: Record<string, string> } | null> {
  let filePath = requestUrl.pathname === "/"
    ? path.join(webReportDistRoot, "index.html")
    : path.join(webReportDistRoot, requestUrl.pathname.replace(/^\/+/, ""));
  filePath = path.normalize(filePath);

  if (!filePath.startsWith(webReportDistRoot)) {
    return { statusCode: 403, body: "Forbidden", headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } };
  }

  try {
    const body = await fs.readFile(filePath);
    return { statusCode: 200, body, headers: { "Content-Type": detectContentType(filePath), "Cache-Control": "no-store" } };
  } catch {
    return null;
  }
}

/**
 * Create and start the HTTP server.
 */
export function createHttpServer(options: ServerOptions): http.Server {
  const { host, port, webReportDistRoot, requestHandler } = options;
  const isLocalhost = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "::ffff:127.0.0.1";
  const authToken = options.authToken || generateAuthToken();

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);

      // Rate limiting
      if (requestUrl.pathname.startsWith("/api/")) {
        const clientIp = request.socket.remoteAddress ?? "unknown";
        const rateLimitResult = checkRateLimit(clientIp, requestUrl.pathname);
        if (!rateLimitResult.allowed) {
          const retryAfterSeconds = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
          response.writeHead(429, {
            "Content-Type": "application/json; charset=utf-8",
            "Retry-After": String(retryAfterSeconds),
            "Cache-Control": "no-store"
          });
          response.end(JSON.stringify({ error: "Rate limit exceeded. Please wait before retrying.", retryAfterSeconds }));
          return;
        }
      }

      // CORS
      const origin = request.headers.origin;
      if (!checkCors(origin, host, port)) {
        const forbidden = jsonResponse({ error: "Cross-origin requests are not allowed." }, 403);
        response.writeHead(forbidden.statusCode, forbidden.headers);
        response.end(forbidden.body);
        return;
      }

      // Auth
      if (!checkAuth(requestUrl, request, isLocalhost, authToken)) {
        const unauthorized = jsonResponse({ error: "Authentication required. Pass token via Authorization: Bearer <token> header or ?token= query parameter." }, 401);
        response.writeHead(unauthorized.statusCode, unauthorized.headers);
        response.end(unauthorized.body);
        return;
      }

      // API routes — delegate to handler
      if (requestUrl.pathname.startsWith("/api/")) {
        const result = await requestHandler(request, requestUrl);
        response.writeHead(result.statusCode, result.headers);
        response.end(result.body);
        return;
      }

      // Static files
      if (request.method === "GET") {
        const result = await serveStaticFile(requestUrl, webReportDistRoot);
        if (result) {
          response.writeHead(result.statusCode, result.headers);
          response.end(result.body);
          return;
        }
        const notFound = textResponse("Not Found", 404);
        response.writeHead(notFound.statusCode, notFound.headers);
        response.end(notFound.body);
        return;
      }

      const methodNotAllowed = textResponse("Method Not Allowed", 405);
      response.writeHead(methodNotAllowed.statusCode, methodNotAllowed.headers);
      response.end(methodNotAllowed.body);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const payload = jsonResponse({ error: error instanceof Error ? error.message : String(error) }, statusCode);
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
    }
  });

  return server;
}

export { checkCors };
