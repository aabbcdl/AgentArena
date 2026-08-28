/**
 * Server module.
 *
 * Re-exports all server utilities from core.ts.
 * This is the public API surface of the server/ directory.
 */

export {
  checkAuthHeader,
  checkCorsOrigin,
  checkRateLimit,
  detectContentType,
  generateAuthToken,
  getClientIp,
  HttpError,
  jsonResponse,
  normalizeMetricPath,
  readRequestBody,
  setTrustProxy,
  startRateLimitCleanup,
  textResponse,
} from "./core.js";
