/**
 * Per-command argument validators.
 *
 * Each validator checks that the required arguments for a specific command
 * are present and valid. Returns a discriminated union that makes invalid
 * states unrepresentable: the previous shape (`{ ok: boolean, error?: string }`)
 * allowed `{ ok: false }` without an error, and `{ ok: true, error: "..." }`
 * with an ignored error — both meaningless. The new union prevents either.
 */

import type { ParsedArgs } from "./args.js";

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validateRunCommand(args: ParsedArgs): ValidationResult {
  if (!args.repoPath) {
    return {
      ok: false,
      error: "Missing required argument: --repo\nExample: agentarena run --repo . --task taskpack.yaml --agents demo-fast"
    };
  }

  if (!args.taskPath) {
    return {
      ok: false,
      error: "Missing required argument: --task\nExample: agentarena run --repo . --task taskpack.yaml --agents demo-fast"
    };
  }

  if (args.agentIds.length === 0) {
    return {
      ok: false,
      error: "Missing required argument: --agents\nExample: agentarena run --repo . --task taskpack.yaml --agents demo-fast"
    };
  }

  if (args.maxConcurrency !== undefined && (args.maxConcurrency < 1 || !Number.isInteger(args.maxConcurrency))) {
    return {
      ok: false,
      error: "--max-concurrency must be a positive integer"
    };
  }

  if (args.tokenBudget !== undefined && args.tokenBudget <= 0) {
    return {
      ok: false,
      error: "--token-budget must be a positive number"
    };
  }

  return { ok: true };
}

export function validateUiCommand(args: ParsedArgs): ValidationResult {
  if (args.port !== undefined && (args.port < 1 || args.port > 65535 || !Number.isInteger(args.port))) {
    return {
      ok: false,
      error: "--port must be an integer between 1 and 65535"
    };
  }

  return { ok: true };
}

export function validateDoctorCommand(_args: ParsedArgs): ValidationResult {
  // Doctor has no required arguments
  return { ok: true };
}

export function validateInitCommand(_args: ParsedArgs): ValidationResult {
  // Init has no required arguments (uses defaults)
  return { ok: true };
}

export function validateInitTaskpackCommand(_args: ParsedArgs): ValidationResult {
  // Init-taskpack has no required arguments (uses defaults)
  return { ok: true };
}

export function validateInitCiCommand(args: ParsedArgs): ValidationResult {
  if (!args.taskPath) {
    return {
      ok: false,
      error: "Missing required argument: --task\nExample: agentarena init-ci --task taskpack.yaml --agents demo-fast"
    };
  }

  if (args.agentIds.length === 0) {
    return {
      ok: false,
      error: "Missing required argument: --agents\nExample: agentarena init-ci --task taskpack.yaml --agents demo-fast"
    };
  }

  return { ok: true };
}

export function validatePublishCommand(args: ParsedArgs): ValidationResult {
  if (!args.resultFile && !args.last) {
    return {
      ok: false,
      error: "Missing required argument: <result-file> or --last\n" +
        "Usage: agentarena publish <result-file>\n" +
        "   or: agentarena publish --last"
    };
  }

  return { ok: true };
}

export function validateListAdaptersCommand(_args: ParsedArgs): ValidationResult {
  // List-adapters has no required arguments
  return { ok: true };
}

export function validateValidateCommand(args: ParsedArgs): ValidationResult {
  if (!args.taskPath) {
    return {
      ok: false,
      error: "Missing required argument: <taskpack-path>\nExample: agentarena validate my-task.yaml"
    };
  }
  return { ok: true };
}

/**
 * Validate arguments for the specified command.
 * Returns { ok: true } if valid, or { ok: false, error: string } if invalid.
 */
export function validateCommandArgs(args: ParsedArgs): ValidationResult {
  switch (args.command) {
    case "run":
      return validateRunCommand(args);
    case "ui":
      return validateUiCommand(args);
    case "doctor":
      return validateDoctorCommand(args);
    case "init":
      return validateInitCommand(args);
    case "init-taskpack":
      return validateInitTaskpackCommand(args);
    case "init-ci":
      return validateInitCiCommand(args);
    case "publish":
      return validatePublishCommand(args);
    case "list-adapters":
      return validateListAdaptersCommand(args);
    case "validate":
      return validateValidateCommand(args);
    default:
      return { ok: true };
  }
}
