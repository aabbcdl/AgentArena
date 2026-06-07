import type { InvocationSpec } from "./adapter-capabilities.js";
import { adapterWarn } from "./adapter-diagnostics.js";
import { parseClaudeEvents } from "./event-parsers.js";
import type { ProcessResult } from "./process-utils.js";
import { runProcess } from "./process-utils.js";

/**
 * Transport abstraction for different communication modes with AI agent CLIs.
 * Allows fallback between different invocation strategies when one fails.
 */
export interface Transport {
  /** Unique identifier for this transport */
  readonly id: string;
  /** Human-readable description */
  readonly description: string;
  /**
   * Send a prompt to the agent and get a result.
   * @returns ProcessResult with stdout/stderr/exitCode
   */
  send(
    prompt: string,
    cwd: string,
    environment?: NodeJS.ProcessEnv,
    timeoutMs?: number
  ): Promise<TransportResult>;
  /**
   * Optional: Check if this transport is likely to work.
   * Used for pre-flight checks before attempting send().
   */
  probe?(cwd: string, environment?: NodeJS.ProcessEnv): Promise<boolean>;
  /**
   * Cleanup any resources held by this transport.
   */
  dispose?(): Promise<void>;
}

export interface TransportResult {
  /** Raw process result */
  processResult: ProcessResult;
  /** Parsed output (if applicable) */
  parsed?: {
    summary?: string;
    tokenUsage?: number;
    estimatedCostUsd?: number;
    costKnown?: boolean;
    toolCalls?: Array<{ name: string; input?: unknown }>;
    sessionId?: string;
    error?: string;
  };
  /** Which transport produced this result */
  transportId: string;
  /** Whether this result indicates the transport should fallback */
  shouldFallback: boolean;
  /** Reason for fallback (if shouldFallback is true) */
  fallbackReason?: string;
}

/**
 * StreamJsonTransport: Uses --output-format stream-json for rich structured output.
 * This is the preferred transport as it provides token usage, tool calls, and session info.
 * However, some third-party providers may not fully support this mode.
 */
export class StreamJsonTransport implements Transport {
  readonly id = "stream-json";
  readonly description = "Stream JSON mode with structured output parsing";

  constructor(
    private readonly invocation: InvocationSpec,
    private readonly extraArgs: string[] = []
  ) {}

  async send(
    prompt: string,
    cwd: string,
    environment?: NodeJS.ProcessEnv,
    timeoutMs?: number
  ): Promise<TransportResult> {
    const args = [
      ...this.invocation.argsPrefix,
      ...this.extraArgs,
      "-p",                        // Read prompt from stdin
      "--output-format",
      "stream-json",               // Structured JSON events (one per line)
      "--verbose",                 // Required for full structured output (undocumented requirement)
      "--permission-mode",
      "bypassPermissions",         // Skip interactive permission prompts (internal flag)
      "--no-session-persistence",  // Don't save session state between runs
    ];

    const processResult = await runProcess(
      this.invocation.command,
      args,
      cwd,
      timeoutMs,
      environment,
      undefined,
      prompt
    );

    const parsed = parseClaudeEvents(processResult.stdout);

    // Determine if we should fallback
    const shouldFallback = this.shouldFallback(processResult, parsed);

    return {
      processResult,
      parsed: {
        summary: parsed.summaryFromEvents,
        tokenUsage: parsed.tokenUsage,
        estimatedCostUsd: parsed.estimatedCostUsd,
        costKnown: parsed.costKnown,
        toolCalls: parsed.toolCalls,
        sessionId: parsed.sessionId,
        error: parsed.error,
      },
      transportId: this.id,
      shouldFallback,
      fallbackReason: shouldFallback
        ? this.getFallbackReason(processResult, parsed)
        : undefined,
    };
  }

  /**
   * Determine if this transport's output indicates a fundamental failure
   * that warrants falling back to TextTransport.
   *
   * FALLBACK THRESHOLDS (empirical, based on observed Claude Code behavior):
   * - Timeout + <100 bytes stdout → likely provider incompatibility or hanging
   * - Process error (spawn failure, command not found) → cannot proceed
   * - Exit code other than 0 or 1 → unexpected failure mode (0 = success, 1 = task failure)
   * - Non-zero exit + no parsed content → stream-json mode produced nothing useful
   *
   * These thresholds are NOT documented by the CLI tools. They are reverse-engineered
   * from how Claude Code behaves with third-party providers.
   */
  private shouldFallback(
    result: ProcessResult,
    parsed: ReturnType<typeof parseClaudeEvents>
  ): boolean {
    // Timeout with very little output — likely provider incompatibility
    if (result.timedOut && result.stdout.length < 100) {
      return true;
    }
    // Process error — command not found or similar
    if (result.error && result.exitCode !== 0) {
      return true;
    }
    // Exit code indicates fundamental failure (not just task failure)
    // 0 = success, 1 = task failure (normal). Anything else = transport issue.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return true;
    }
    // Stream parsing produced nothing useful and exit was non-zero
    if (
      result.exitCode !== 0 &&
      !parsed.summaryFromEvents &&
      parsed.toolCalls.length === 0
    ) {
      return true;
    }
    return false;
  }

  private getFallbackReason(
    result: ProcessResult,
    parsed: ReturnType<typeof parseClaudeEvents>
  ): string {
    if (result.timedOut) {
      return `Stream-JSON transport timed out after producing ${result.stdout.length} bytes`;
    }
    if (result.error) {
      return `Stream-JSON transport process error: ${result.error}`;
    }
    if (result.exitCode !== 0 && !parsed.summaryFromEvents) {
      return `Stream-JSON transport exited with code ${result.exitCode} and no parsed output`;
    }
    return "Stream-JSON transport produced unusable output";
  }
}

/**
 * TextTransport: Uses --output-format text for simpler, more compatible output.
 * This is the fallback transport for providers that don't fully support stream-json.
 * It sacrifices rich metadata (token usage, tool calls) for broader compatibility.
 */
export class TextTransport implements Transport {
  readonly id = "text";
  readonly description = "Text mode with basic output capture";

  constructor(
    private readonly invocation: InvocationSpec,
    private readonly extraArgs: string[] = []
  ) {}

  async send(
    prompt: string,
    cwd: string,
    environment?: NodeJS.ProcessEnv,
    timeoutMs?: number
  ): Promise<TransportResult> {
    const args = [
      ...this.invocation.argsPrefix,
      ...this.extraArgs,
      "-p",
      "--output-format",
      "text",
      "--permission-mode",
      "bypassPermissions",
      "--no-session-persistence",
    ];

    const processResult = await runProcess(
      this.invocation.command,
      args,
      cwd,
      timeoutMs,
      environment,
      undefined,
      prompt
    );

    // Parse text output - extract summary from last non-empty line
    const lines = processResult.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const summary = lines.length > 0 ? lines[lines.length - 1] : undefined;

    return {
      processResult,
      parsed: {
        summary,
        // Text mode doesn't provide token usage or tool calls
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        toolCalls: [],
        error: processResult.error,
      },
      transportId: this.id,
      // Text transport should never fallback further - it's the last resort
      shouldFallback: false,
    };
  }
}

/**
 * RawTransport: Most basic transport using --help to verify CLI works.
 * Used only for preflight checks, not for actual task execution.
 */
export class RawTransport implements Transport {
  readonly id = "raw";
  readonly description = "Raw mode for basic CLI verification";

  constructor(private readonly invocation: InvocationSpec) {}

  async send(
    _prompt: string,
    cwd: string,
    environment?: NodeJS.ProcessEnv,
    timeoutMs?: number
  ): Promise<TransportResult> {
    // For raw transport, we just check if CLI responds to --help
    const processResult = await runProcess(
      this.invocation.command,
      [...this.invocation.argsPrefix, "--help"],
      cwd,
      timeoutMs ?? 10_000,
      environment
    );

    return {
      processResult,
      parsed: {
        summary: processResult.exitCode === 0 ? "CLI responds to --help" : undefined,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        error: processResult.error,
      },
      transportId: this.id,
      shouldFallback: false,
    };
  }
}

/**
 * TransportChain: Manages a sequence of transports with automatic fallback.
 * Tries each transport in order until one succeeds or all fail.
 */
export interface TransportChainOptions {
  /** Timeout for each individual transport attempt */
  transportTimeoutMs?: number;
  /** Whether to log fallback attempts */
  logFallbacks?: boolean;
}

export interface TransportChainResult {
  /** The successful transport result */
  result: TransportResult;
  /** All attempted transports (including failed ones) */
  attempts: Array<{
    transportId: string;
    success: boolean;
    duration: number;
    error?: string;
  }>;
  /** Whether the final result came from a fallback transport */
  usedFallback: boolean;
}

export class TransportChain {
  private readonly transports: Transport[];
  private readonly timeoutMs: number;
  private readonly logFallbacks: boolean;

  constructor(
    transports: Transport[],
    options?: TransportChainOptions
  ) {
    if (transports.length === 0) {
      throw new Error("TransportChain requires at least one transport");
    }
    this.transports = transports;
    this.timeoutMs = options?.transportTimeoutMs ?? 8_000;
    this.logFallbacks = options?.logFallbacks ?? true;
  }

  /**
   * Execute the transport chain, falling back through transports as needed.
   */
  async execute(
    prompt: string,
    cwd: string,
    environment?: NodeJS.ProcessEnv
  ): Promise<TransportChainResult> {
    const attempts: TransportChainResult["attempts"] = [];
    let lastResult: TransportResult | undefined;

    for (const transport of this.transports) {
      const startTime = Date.now();

      if (this.logFallbacks) {
        adapterWarn(`Attempting transport: ${transport.id}`, {
          description: transport.description,
        });
      }

      try {
        const result = await transport.send(
          prompt,
          cwd,
          environment,
          this.timeoutMs
        );

        const duration = Date.now() - startTime;
        attempts.push({
          transportId: transport.id,
          success: !result.shouldFallback,
          duration,
          error: result.fallbackReason,
        });

        if (!result.shouldFallback) {
          // Success! Return this result
          return {
            result,
            attempts,
            usedFallback: attempts.length > 1,
          };
        }

        // Log fallback reason
        if (this.logFallbacks) {
          adapterWarn(
            `Transport ${transport.id} failed, falling back to next transport`,
            {
              reason: result.fallbackReason,
              duration,
            }
          );
        }

        lastResult = result;
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        attempts.push({
          transportId: transport.id,
          success: false,
          duration,
          error: errorMessage,
        });

        if (this.logFallbacks) {
          adapterWarn(
            `Transport ${transport.id} threw error, falling back`,
            {
              error: errorMessage,
              duration,
            }
          );
        }
      }
    }

    // All transports failed - return the last result or throw
    if (lastResult) {
      return {
        result: lastResult,
        attempts,
        usedFallback: true,
      };
    }

    // Should not happen if we have at least one transport and all threw
    throw new Error(
      `All transports in chain failed. Attempts: ${JSON.stringify(attempts)}`
    );
  }

  /**
   * Get the number of transports in this chain.
   */
  get length(): number {
    return this.transports.length;
  }

  /**
   * Get transport IDs in order.
   */
  get transportIds(): string[] {
    return this.transports.map((t) => t.id);
  }
}

/**
 * Create a default transport chain for Claude Code with fallback.
 * - Official providers: StreamJson only (most reliable)
 * - Third-party providers: StreamJson → Text fallback
 */
export function createClaudeTransportChain(
  invocation: InvocationSpec,
  isThirdPartyProvider: boolean,
  extraArgs: string[] = [],
  options?: TransportChainOptions
): TransportChain {
  const transports: Transport[] = [
    new StreamJsonTransport(invocation, extraArgs),
  ];

  // Add text transport as fallback for third-party providers
  if (isThirdPartyProvider) {
    transports.push(new TextTransport(invocation, extraArgs));
  }

  return new TransportChain(transports, {
    transportTimeoutMs: options?.transportTimeoutMs ?? 8_000,
    logFallbacks: options?.logFallbacks ?? true,
  });
}
