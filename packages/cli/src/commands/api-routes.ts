/**
 * API route handlers for the UI server.
 *
 * Each handler is a pure function that receives request data and returns
 * a response object, making it independently testable without starting
 * an HTTP server.
 *
 * This module re-exports all handlers from sub-modules and owns the shared
 * error-handling middleware (`withErrorHandling`).
 */

import { logger } from "@agentarena/core";
import { jsonResponse } from "../server/index.js";
import type { ApiResponse } from "./api-routes/types.js";

// ─── Re-export everything from sub-modules ───


export {
  handleAdaptersList,
  handleAgentDetection,
  handleInstallGuides,
} from "./api-routes/adapters.js";
export {
  handleProviderProfileCreate,
  handleProviderProfileDelete,
  handleProviderProfileSecret,
  handleProviderProfilesGet,
  handleProviderProfileUpdate,
} from "./api-routes/providers.js";
export {
  handleAdhocTaskpackDelete,
  handleAdhocTaskpacksList,
  handleCheckCompatibility,
  handleCreateAdhocTaskpack,
  handleTaskpacksList,
} from "./api-routes/taskpacks.js";
export type { ApiResponse, ProviderProfilePayload } from "./api-routes/types.js";
export {
  maskProfileExtraEnv,
  validateProfileId,
  validateProviderProfilePayload,
} from "./api-routes/types.js";
export {
  handlePreflight,
  handleQuickPreflight,
  handleUiInfo,
} from "./api-routes/ui.js";

// ─── Shared error-handling middleware ───

/**
 * Classify an error into a known category based on its `code` property
 * (errno-style) first, then fall back to string matching on the message.
 *
 * Returns `{ category, status }` where category is a stable label and
 * status is the HTTP status code to use.
 */
function classifyError(error: unknown): { category: string; status: number } {
  const errnoCode = (error as NodeJS.ErrnoException | undefined)?.code;
  const rawMessage = error instanceof Error ? error.message : String(error);

  // 1. Check errno codes first -- these are structurally reliable.
  if (errnoCode === "ENOENT") return { category: "not_found", status: 404 };
  if (errnoCode === "EACCES" || errnoCode === "EPERM") return { category: "permission_denied", status: 403 };
  if (errnoCode === "EEXIST") return { category: "conflict", status: 409 };
  if (errnoCode === "ENOTDIR" || errnoCode === "EISDIR") return { category: "not_found", status: 404 };

  // 2. Check for explicit ValidationError instances.
  if (error instanceof Error && error.name === "ValidationError") {
    return { category: "validation", status: 400 };
  }

  // 3. Fall back to string matching for validation-shaped messages.
  const validationPatterns = [
    "Unsupported task pack schema",
    "Unsupported judge type",
    "Unrecognized judge field",
    "Task pack ID must",
    "must be a string",
    "must be an array",
    "must be a positive integer",
  ];
  for (const pattern of validationPatterns) {
    if (rawMessage.includes(pattern)) {
      return { category: "validation", status: 400 };
    }
  }

  // 4. Unknown -- caller should log and return a generic envelope.
  return { category: "unknown", status: 500 };
}

/**
 * Wrap an API handler with structured error logging and a safe error envelope.
 *
 * The envelope distinguishes:
 *   - Known errors (HttpError, ENOENT, validation failures) -> propagate the
 *     message and a sensible status code so the SPA can show actionable text.
 *   - Unknown errors -> log internally with the full error, return a generic
 *     "Internal server error" to avoid leaking implementation details or PII.
 */
export async function withErrorHandling(promise: Promise<ApiResponse>): Promise<ApiResponse> {
  try {
    return await promise;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const { category, status } = classifyError(error);

    if (category === "validation") {
      logger.warn("server", "api.validation_failed", `Validation failed: ${rawMessage}`);
      return jsonResponse({ error: rawMessage }, status);
    }

    if (category === "not_found") {
      logger.info("server", "api.not_found", `Resource not found: ${rawMessage}`);
      return jsonResponse({ error: rawMessage }, status);
    }

    if (category === "permission_denied") {
      logger.warn("server", "api.permission_denied", `Permission denied: ${rawMessage}`, { error });
      return jsonResponse({ error: rawMessage }, status);
    }

    if (category === "conflict") {
      logger.warn("server", "api.conflict", `Resource conflict: ${rawMessage}`);
      return jsonResponse({ error: rawMessage }, status);
    }

    // Truly unexpected -- log full error context, return a sanitized envelope.
    logger.error("server", "api.unexpected_error", `Unhandled API error: ${rawMessage}`, { error });
    return jsonResponse({ error: "Internal server error" }, status);
  }
}
