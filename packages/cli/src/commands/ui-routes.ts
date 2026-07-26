import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import type http from "node:http";
import path from "node:path";
import type { getCodexDefaultResolvedRuntime } from "@agentarena/adapters";
import { isPathInsideWorkspace, metrics } from "@agentarena/core";
import { formatLocalUiOrigin } from "../local-only.js";
import { checkAuthHeader, checkCorsOrigin, checkRateLimit, detectContentType, getClientIp, HttpError, jsonResponse, readRequestBody, textResponse } from "../server/index.js";
import { handleAdaptersList, handleAdhocTaskpackDelete, handleAdhocTaskpacksList, handleAgentDetection, handleCheckCompatibility, handleCreateAdhocTaskpack, handleInstallGuides, handlePreflight, handleProviderProfileCreate, handleProviderProfileDelete, handleProviderProfileSecret, handleProviderProfilesGet, handleProviderProfileUpdate, handleQuickPreflight, handleTaskpacksList, handleTelemetry, handleTelemetrySummary, handleTraceGet, handleUiInfo, withErrorHandling } from "./api-routes.js";
import { WEB_REPORT_DIST_ROOT } from "./shared.js";
import { sendApiResponse } from "./ui-http.js";
import { handleUiRunRequest, isUiRunRoute } from "./ui-run-routes.js";
import type { UiRunRequestContext } from "./ui-run-types.js";

export { sendApiResponse } from "./ui-http.js";
export { WEB_REPORT_DIST_ROOT };

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("`", "&#96;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export interface RequestContext extends UiRunRequestContext {
  host: string;
  port: number;
  isLocalhost: boolean;
  codexDefaults: Awaited<ReturnType<typeof getCodexDefaultResolvedRuntime>>;
}

export function createRequestHandler(ctx: RequestContext) {
  return async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const requestStartTime = Date.now();
    let requestPath = "/";
    const requestMethod = request.method ?? "GET";
    let responseStatusCode = 200;

    try {
      const requestUrl = new URL(request.url ?? "/", formatLocalUiOrigin(ctx.host, ctx.port));
      requestPath = requestUrl.pathname;

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

      // ─── Middleware: Token authentication ───
      const clientIp = getClientIp(request);
      if (!checkAuthHeader(requestUrl, request.method, ctx.isLocalhost, ctx.authToken, request.headers.authorization, clientIp)) {
        sendApiResponse(response, jsonResponse({ error: "Authentication required. Pass token via Authorization: Bearer <token> header." }, 401));
        return;
      }

      // ─── API Routes ───

      // GET /api/ui-info
      if (request.method === "GET" && requestUrl.pathname === "/api/ui-info") {
        sendApiResponse(response, await withErrorHandling(handleUiInfo(ctx.codexDefaults, ctx.host, ctx.port, ctx.isLocalhost)));
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

      // POST /api/create-adhoc-taskpack
      if (request.method === "POST" && requestUrl.pathname === "/api/create-adhoc-taskpack") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handleCreateAdhocTaskpack(rawBody)));
        return;
      }

      // POST /api/check-compatibility
      if (request.method === "POST" && requestUrl.pathname === "/api/check-compatibility") {
        const rawBody = await readRequestBody(request);
        sendApiResponse(response, await withErrorHandling(handleCheckCompatibility(rawBody)));
        return;
      }

      // GET /api/adhoc-taskpacks
      if (request.method === "GET" && requestUrl.pathname === "/api/adhoc-taskpacks") {
        sendApiResponse(response, await handleAdhocTaskpacksList());
        return;
      }

      // DELETE /api/adhoc-taskpacks/:id
      if (request.method === "DELETE" && requestUrl.pathname.startsWith("/api/adhoc-taskpacks/")) {
        const adhocId = decodeURIComponent(requestUrl.pathname.slice("/api/adhoc-taskpacks/".length));
        sendApiResponse(response, await handleAdhocTaskpackDelete(adhocId));
        return;
      }

      // GET /api/taskpacks
      if (request.method === "GET" && requestUrl.pathname === "/api/taskpacks") {
        sendApiResponse(response, await handleTaskpacksList(requestUrl.searchParams));
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
        sendApiResponse(response, await withErrorHandling(handleTraceGet(process.cwd(), runId, variantId)));
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
          let body = await fs.readFile(filePath);

          // SECURITY: Auth token injection for localhost UX (nonce-based CSP)
          //
          // Acceptable trade-off for a localhost-only dev tool:
          // - The meta tag and inline script exist briefly in the HTML response.
          // - A per-request CSP nonce restricts script execution to only the
          //   cleanup script; any injected <script> without the nonce is blocked.
          // - The meta tag is the FIRST thing the script reads, and .remove()
          //   is called immediately after copying to sessionStorage.
          // - sessionStorage is tab-scoped (not persisted across tabs or restarts).
          // - The server only injects this for 127.0.0.1/localhost connections.
          // - Risk: brief token visibility in raw HTTP response body (localhost only).
          //   Mitigated by: localhost binding + CORS + CSP nonce + no-cache headers.
          // - The token is NOT persisted in saved pages, screenshots, or printouts.
          const isInjectingToken = ctx.isLocalhost && filePath.endsWith("index.html") && ctx.authToken;
          const cspNonce = isInjectingToken ? randomBytes(16).toString("base64") : "";

          if (isInjectingToken) {
            let html = body.toString("utf8");
            const metaTag = `<meta name="agentarena-auth-token" content="${escapeHtmlAttribute(ctx.authToken)}">`;
            // Nonce restricts execution to this single script tag only.
            // The first action is reading + removing the meta tag so no other
            // script (even same-origin) can access it after this point.
            const cleanupScript = `<script nonce="${cspNonce}">(function(){var m=document.querySelector('meta[name="agentarena-auth-token"]');if(m){try{sessionStorage.setItem('agentarena-auth-token',m.getAttribute('content'))}catch(e){/* ignore: sessionStorage may be unavailable */}m.remove()}})();</script>`;
            // Inject meta tag and its cleanup script immediately before </head>
            // so they execute before any app scripts.
            const injection = `  ${metaTag}\n  ${cleanupScript}\n`;
            if (html.includes("</head>")) {
              html = html.replace("</head>", `${injection}</head>`);
            } else {
              html = injection + html;
            }
            body = Buffer.from(html, "utf8");
          }

          const scriptSrcPolicy = cspNonce
            ? `script-src 'self' 'nonce-${cspNonce}'`
            : "script-src 'self'";

          response.writeHead(200, {
            "Content-Type": detectContentType(filePath),
            "Cache-Control": "no-store",
            "Content-Security-Policy": `default-src 'self'; ${scriptSrcPolicy}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com`,
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
