import { promises as fs } from "node:fs";
import type http from "node:http";
import path from "node:path";
import type { getCodexDefaultResolvedRuntime } from "@agentarena/adapters";
import { isPathInsideWorkspace, metrics } from "@agentarena/core";
import { formatLocalUiOrigin } from "../local-only.js";
import { checkAuthHeader, checkCorsOrigin, checkRateLimit, detectContentType, getClientIp, HttpError, jsonResponse, normalizeMetricPath, readRequestBody, textResponse } from "../server/index.js";
import { handleAdaptersList, handleAdhocTaskpackDelete, handleAdhocTaskpacksList, handleAgentDetection, handleCheckCompatibility, handleCreateAdhocTaskpack, handleInstallGuides, handlePreflight, handleProviderProfileCreate, handleProviderProfileDelete, handleProviderProfileSecret, handleProviderProfilesGet, handleProviderProfileUpdate, handleQuickPreflight, handleRuntimeProfileCreate, handleRuntimeProfileDelete, handleRuntimeProfileSecret, handleRuntimeProfilesGet, handleRuntimeProfileUpdate, handleRuntimeProfileVerify, handleRuntimeProfileVerifyProgress, handleTaskpacksList, handleTelemetry, handleTelemetrySummary, handleTraceGet, handleUiInfo, withErrorHandling } from "./api-routes.js";
import { WEB_REPORT_DIST_ROOT } from "./shared.js";
import { type UiAuthMode, type UiAuthTokenSource, validateUiAuthPassword } from "./ui-auth.js";
import { sendApiResponse } from "./ui-http.js";
import { handleUiRunRequest, isUiRunRoute } from "./ui-run-routes.js";
import type { UiRunRequestContext } from "./ui-run-types.js";

export { sendApiResponse } from "./ui-http.js";
export { WEB_REPORT_DIST_ROOT };

export interface RequestContext extends UiRunRequestContext {
  host: string;
  port: number;
  isLocalhost: boolean;
  authMode?: UiAuthMode;
  authTokenSource?: UiAuthTokenSource;
  authTokenFilePath?: string;
  authSetupRequired?: () => boolean;
  setupAuthPassword?: (password: string) => Promise<string | null>;
  loginWithAuthPassword?: (password: string) => Promise<string | null>;
  exchangeAuthBootstrap?: (code: string) => string | null;
  codexDefaults: Awaited<ReturnType<typeof getCodexDefaultResolvedRuntime>>;
}

export function createRequestHandler(ctx: RequestContext) {
  const workspaceRoot = ctx.workspaceRoot ?? process.cwd();
  return async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const requestStartTime = Date.now();
    let requestPath = "/";
    const requestMethod = request.method ?? "GET";
    let responseStatusCode = 200;

    try {
      const requestUrl = new URL(request.url ?? "/", formatLocalUiOrigin(ctx.host, ctx.port));
      requestPath = normalizeMetricPath(requestUrl.pathname);

      // ─── Middleware: Rate limiting ───
      if (requestUrl.pathname.startsWith("/api/")) {
        const clientIp = getClientIp(request);
        const rateLimitResult = checkRateLimit(clientIp, requestUrl.pathname);
        if (!rateLimitResult.allowed) {
          const retryAfterSeconds = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
          response.writeHead(429, {
            "Content-Type": "application/json; charset=utf-8",
            "Retry-After": String(retryAfterSeconds),
            "Cache-Control": "no-store"
          });
          response.end(JSON.stringify({
            error: "Rate limit exceeded. Please wait before retrying.",
            retryAfterSeconds
          }));
          return;
        }
      }

      // ─── Middleware: CORS protection ───
      const origin = request.headers.origin;
      if (!checkCorsOrigin(origin, ctx.host, ctx.port)) {
        sendApiResponse(response, jsonResponse({ error: "Cross-origin requests are not allowed." }, 403));
        return;
      }

      // Password setup/login are intentionally available only on the local
      // UI origin and before Bearer authentication. They exchange a user-facing
      // password for the per-process Bearer token; the password never enters
      // logs or the browser's persistent storage.
      if (request.method === "GET" && requestUrl.pathname === "/api/auth/status") {
        if (!ctx.isLocalhost) {
          sendApiResponse(response, jsonResponse({ error: "Password authentication is local-only." }, 403));
          return;
        }
        const mode = ctx.authMode ?? "token";
        sendApiResponse(response, jsonResponse({
          mode,
          setupRequired: mode === "password" && (ctx.authSetupRequired?.() ?? false)
        }));
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/auth/setup"
      ) {
        if (!ctx.isLocalhost || ctx.authMode !== "password" || !ctx.setupAuthPassword) {
          sendApiResponse(response, jsonResponse({ error: "Password setup is not available for this service." }, 403));
          return;
        }
        const rawBody = await readRequestBody(request);
        let payload: { password?: unknown };
        try {
          payload = JSON.parse(rawBody) as { password?: unknown };
        } catch {
          sendApiResponse(response, jsonResponse({ error: "Invalid JSON in request body." }, 400));
          return;
        }
        if (typeof payload.password !== "string") {
          sendApiResponse(response, jsonResponse({ error: "Local service password is required." }, 400));
          return;
        }
        let password: string;
        try {
          password = validateUiAuthPassword(payload.password);
        } catch (error) {
          sendApiResponse(response, jsonResponse({ error: error instanceof Error ? error.message : "Invalid local service password." }, 400));
          return;
        }
        sendApiResponse(response, await withErrorHandling(
          ctx.setupAuthPassword(password).then((token) => token
            ? jsonResponse({ token })
            : jsonResponse({ error: "Local service password is already configured." }, 409))
        ));
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/auth/login"
      ) {
        if (!ctx.isLocalhost || ctx.authMode !== "password" || !ctx.loginWithAuthPassword) {
          sendApiResponse(response, jsonResponse({ error: "Password authentication is not available for this service." }, 403));
          return;
        }
        const rawBody = await readRequestBody(request);
        let payload: { password?: unknown };
        try {
          payload = JSON.parse(rawBody) as { password?: unknown };
        } catch {
          sendApiResponse(response, jsonResponse({ error: "Invalid JSON in request body." }, 400));
          return;
        }
        if (typeof payload.password !== "string" || !payload.password.trim()) {
          sendApiResponse(response, jsonResponse({ error: "Invalid local service password." }, 401));
          return;
        }
        sendApiResponse(response, await withErrorHandling(
          ctx.loginWithAuthPassword(payload.password).then((token) => token
            ? jsonResponse({ token })
            : jsonResponse({ error: "Invalid local service password." }, 401))
        ));
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/auth/bootstrap" &&
        ctx.exchangeAuthBootstrap
      ) {
        const rawBody = await readRequestBody(request);
        let payload: { code?: unknown };
        try {
          payload = JSON.parse(rawBody) as { code?: unknown };
        } catch {
          sendApiResponse(response, jsonResponse({ error: "Invalid JSON in request body." }, 400));
          return;
        }
        if (typeof payload.code !== "string" || !payload.code) {
          sendApiResponse(response, jsonResponse({ error: "Bootstrap code is required." }, 400));
          return;
        }
        const token = ctx.exchangeAuthBootstrap(payload.code);
        if (!token) {
          sendApiResponse(response, jsonResponse({ error: "Bootstrap code is invalid or expired." }, 401));
          return;
        }
        sendApiResponse(response, jsonResponse({ token }));
        return;
      }

      // ─── Middleware: Token authentication ───
      const clientIp = getClientIp(request);
      if (!checkAuthHeader(requestUrl, request.method, ctx.isLocalhost, ctx.authToken, request.headers.authorization, clientIp)) {
        sendApiResponse(response, jsonResponse({ error: "Authentication required. Pass token via Authorization: Bearer <token> header." }, 401));
        return;
      }

      // ─── API Routes ───

      // GET /api/ui-info
      if (request.method === "GET" && requestUrl.pathname === "/api/ui-info") {
        sendApiResponse(response, await withErrorHandling(handleUiInfo(
          ctx.codexDefaults,
          ctx.host,
          ctx.port,
          ctx.isLocalhost,
          ctx.authTokenFilePath,
          ctx.authTokenSource,
          workspaceRoot,
          ctx.authMode,
          ctx.authSetupRequired?.() ?? false
        )));
        return;
      }

      // GET /api/adapters
      if (request.method === "GET" && requestUrl.pathname === "/api/adapters") {
        sendApiResponse(response, await withErrorHandling(handleAdaptersList()));
        return;
      }

      // POST /api/preflight
      if (request.method === "POST" && requestUrl.pathname === "/api/preflight") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handlePreflight(rawBody)));
        return;
      }

      // POST /api/quick-preflight
      if (request.method === "POST" && requestUrl.pathname === "/api/quick-preflight") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handleQuickPreflight(rawBody)));
        return;
      }

      // GET /api/provider-profiles
      if (request.method === "GET" && requestUrl.pathname === "/api/provider-profiles") {
        sendApiResponse(response, await withErrorHandling(handleProviderProfilesGet()));
        return;
      }

      // POST /api/provider-profiles
      if (request.method === "POST" && requestUrl.pathname === "/api/provider-profiles") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handleProviderProfileCreate(rawBody)));
        return;
      }

      // /api/provider-profiles/:id and /api/provider-profiles/:id/secret
      const providerProfileMatch = requestUrl.pathname.match(/^\/api\/provider-profiles\/([^/]+)(?:\/(secret))?$/);
      if (providerProfileMatch) {
        const profileId = decodeURIComponent(providerProfileMatch[1]);
        const action = providerProfileMatch[2];

        if (request.method === "PUT" && !action) {
          const rawBody = await readRequestBody(request);
          sendApiResponse(response, await withErrorHandling(handleProviderProfileUpdate(profileId, rawBody)));
          return;
        }

        if (request.method === "DELETE" && !action) {
          sendApiResponse(response, await withErrorHandling(handleProviderProfileDelete(profileId)));
          return;
        }

        if (request.method === "POST" && action === "secret") {
          const rawBody = await readRequestBody(request);
          sendApiResponse(response, await withErrorHandling(handleProviderProfileSecret(profileId, rawBody)));
          return;
        }
      }

      // RuntimeProfile API for the first-release Codex and Claude control plane.
      if (request.method === "GET" && requestUrl.pathname === "/api/runtime-profiles") {
        sendApiResponse(response, await withErrorHandling(handleRuntimeProfilesGet(requestUrl.searchParams)));
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/runtime-profiles") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handleRuntimeProfileCreate(rawBody)));
        return;
      }

      const runtimeVerificationProgressMatch = requestUrl.pathname.match(
        /^\/api\/runtime-profiles\/([^/]+)\/verify-progress\/([^/]+)$/
      );
      if (request.method === "GET" && runtimeVerificationProgressMatch) {
        sendApiResponse(response, await withErrorHandling(handleRuntimeProfileVerifyProgress(
          decodeURIComponent(runtimeVerificationProgressMatch[1]),
          decodeURIComponent(runtimeVerificationProgressMatch[2])
        )));
        return;
      }

      const runtimeProfileMatch = requestUrl.pathname.match(
        /^\/api\/runtime-profiles\/([^/]+)(?:\/(secret|verify))?$/
      );
      if (runtimeProfileMatch) {
        const profileId = decodeURIComponent(runtimeProfileMatch[1]);
        const action = runtimeProfileMatch[2];
        if (request.method === "PUT" && !action) {
          const rawBody = await readRequestBody(request);
          sendApiResponse(response, await withErrorHandling(handleRuntimeProfileUpdate(profileId, rawBody)));
          return;
        }
        if (request.method === "DELETE" && !action) {
          sendApiResponse(response, await withErrorHandling(handleRuntimeProfileDelete(profileId)));
          return;
        }
        if (request.method === "POST" && action === "secret") {
          const rawBody = await readRequestBody(request);
          sendApiResponse(response, await withErrorHandling(handleRuntimeProfileSecret(profileId, rawBody)));
          return;
        }
        if (request.method === "POST" && action === "verify") {
          const rawBody = await readRequestBody(request);
          sendApiResponse(response, await withErrorHandling(handleRuntimeProfileVerify(profileId, rawBody)));
          return;
        }
      }

      // POST /api/create-adhoc-taskpack
      if (request.method === "POST" && requestUrl.pathname === "/api/create-adhoc-taskpack") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handleCreateAdhocTaskpack(rawBody, workspaceRoot)));
        return;
      }

      // POST /api/check-compatibility
      if (request.method === "POST" && requestUrl.pathname === "/api/check-compatibility") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handleCheckCompatibility(rawBody, workspaceRoot)));
        return;
      }

      // GET /api/adhoc-taskpacks
      if (request.method === "GET" && requestUrl.pathname === "/api/adhoc-taskpacks") {
        sendApiResponse(response, await handleAdhocTaskpacksList(requestUrl.searchParams, workspaceRoot));
        return;
      }

      // DELETE /api/adhoc-taskpacks/:id
      if (request.method === "DELETE" && requestUrl.pathname.startsWith("/api/adhoc-taskpacks/")) {
        const adhocId = decodeURIComponent(requestUrl.pathname.slice("/api/adhoc-taskpacks/".length));
        sendApiResponse(response, await handleAdhocTaskpackDelete(adhocId, workspaceRoot));
        return;
      }

      // GET /api/taskpacks
      if (request.method === "GET" && requestUrl.pathname === "/api/taskpacks") {
        sendApiResponse(response, await handleTaskpacksList(requestUrl.searchParams, workspaceRoot));
        return;
      }

      // GET /api/agent-detection —EchoBird-style agent detection
      if (request.method === "GET" && requestUrl.pathname === "/api/agent-detection") {
        sendApiResponse(response, await withErrorHandling(handleAgentDetection()));
        return;
      }

      // GET /api/install-guides —install guide definitions for all agents
      if (request.method === "GET" && requestUrl.pathname === "/api/install-guides") {
        sendApiResponse(response, await withErrorHandling(handleInstallGuides()));
        return;
      }

      // GET /api/metrics —Prometheus metrics endpoint
      if (request.method === "GET" && requestUrl.pathname === "/api/metrics") {
        const { exportAllMetrics } = await import("@agentarena/core");
        const metricsText = exportAllMetrics();
        response.writeHead(200, {
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end(metricsText);
        return;
      }


      // GET /api/telemetry-summary ? aggregate local funnel counts only.
      if (request.method === "GET" && requestUrl.pathname === "/api/telemetry-summary") {
        sendApiResponse(response, await withErrorHandling(handleTelemetrySummary()));
        return;
      }

      // POST /api/telemetry — opt-in local product measurement events from the UI.
      // recordTelemetryEvent no-ops when AGENTARENA_TELEMETRY is not enabled, so
      // this endpoint is safe to call regardless of the server-side toggle.
      if (request.method === "POST" && requestUrl.pathname === "/api/telemetry") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handleTelemetry(rawBody)));
        return;
      }

      if (isUiRunRoute(request.method, requestUrl.pathname)) {
        await handleUiRunRequest(request, response, requestUrl, ctx);
        return;
      }

      // GET /api/trace?runId=<id>&variantId=<vid> — replay a single agent's
      // execution trace. Resolves from the workspace run output dir and is
      // contained to the workspace, so it replaces the legacy relative-path
      // fetch that caused trace identity to split across demo/imported/real runs.
      if (request.method === "GET" && requestUrl.pathname === "/api/trace") {
        const runId = requestUrl.searchParams.get("runId");
        const variantId = requestUrl.searchParams.get("variantId");
        sendApiResponse(response, await withErrorHandling(handleTraceGet(workspaceRoot, runId, variantId)));
        return;
      }

      // ─── Static file serving ───

      if (request.method === "GET") {
        if (requestUrl.pathname === "/") {
          const isLegacyDeepLink = requestUrl.searchParams.has("run") || requestUrl.searchParams.has("agent");
          const targetBase = isLegacyDeepLink ? "/legacy/" : "/workbench/";
          response.writeHead(302, { Location: `${targetBase}${requestUrl.search}` });
          response.end();
          return;
        }
        if (requestUrl.pathname === "/legacy") {
          response.writeHead(302, { Location: `/legacy/${requestUrl.search}` });
          response.end();
          return;
        }
        // SECURITY: resolve the web root via realpath once so symlink / \\?\ long-path
        // forms cannot escape the containment check below.
        const rootReal = await fs.realpath(WEB_REPORT_DIST_ROOT).catch(() => WEB_REPORT_DIST_ROOT);
        const assetPath = requestUrl.pathname.startsWith("/legacy/")
          ? requestUrl.pathname.slice("/legacy".length)
          : requestUrl.pathname;
        const relativePath = assetPath.endsWith("/")
          ? `${assetPath.replace(/^\/+/, "")}index.html`
          : assetPath.replace(/^\/+/, "");
        let filePath = path.join(WEB_REPORT_DIST_ROOT, relativePath);
        filePath = path.normalize(filePath);
        // Re-resolve the target via realpath (falls back to the normalized path if
        // it does not exist yet, e.g. SPA routes) so symlink escapes are caught.
        const fileReal = await fs.realpath(filePath).catch(() => filePath);
        const insideWorkspace = await isPathInsideWorkspace(rootReal, fileReal);
        if (!insideWorkspace) {
          sendApiResponse(response, textResponse("Forbidden", 403));
          return;
        }

        try {
          const body = await fs.readFile(filePath);

          response.writeHead(200, {
            "Content-Type": detectContentType(filePath),
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com",
            "X-Frame-Options": "DENY",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
          });
          response.end(body);
          return;
        } catch {
          sendApiResponse(response, textResponse("Not Found", 404));
          return;
        }
      }

      const methodNotAllowed = textResponse("Method Not Allowed", 405);
      response.writeHead(methodNotAllowed.statusCode, methodNotAllowed.headers);
      response.end(methodNotAllowed.body);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      responseStatusCode = statusCode;
      const message = statusCode >= 500 ? "Internal server error" : (error instanceof Error ? error.message : String(error));
      const payload = jsonResponse({ error: message }, statusCode);
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
    } finally {
      const durationSeconds = (Date.now() - requestStartTime) / 1000;
      const actualStatusCode = response.statusCode || responseStatusCode;
      metrics.httpRequestsTotal.inc({ method: requestMethod, path: requestPath, status: String(actualStatusCode) });
      metrics.httpRequestDuration.observe({ method: requestMethod, path: requestPath }, durationSeconds);
    }
  };
}
