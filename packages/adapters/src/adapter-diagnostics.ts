export function adapterWarn(message: string, metadata?: Record<string, unknown>): void {
  const detail = metadata ? ` ${JSON.stringify(metadata)}` : "";
  // biome-ignore lint/suspicious/noConsole: intentional diagnostic output
  console.warn(`[adapters] ${message}${detail}`);
}

interface ErrorHint {
  pattern: RegExp;
  suggestion: (adapterTitle: string, command: string) => string;
}

const ERROR_HINTS: ErrorHint[] = [
  {
    pattern: /ENOENT|spawn .* ENOENT|not found|not recognized/i,
    suggestion: (title, cmd) => `${title} CLI not found. Install it or ensure "${cmd}" is on your PATH.`
  },
  {
    pattern: /EACCES|permission denied/i,
    suggestion: (_title, cmd) => `Permission denied running "${cmd}". Check file permissions or run with appropriate access.`
  },
  {
    pattern: /timed? ?out/i,
    suggestion: (title) => `${title} timed out. Increase timeout with AGENTARENA_AGENT_TIMEOUT_MS env var, or check if the agent is hanging.`
  },
  {
    pattern: /EPIPE|broken pipe|connection reset/i,
    suggestion: (title) => `${title} process connection lost. The agent may have crashed mid-execution.`
  },
  {
    pattern: /ENOMEM|out of memory|heap|allocation failed/i,
    suggestion: (title) => `${title} ran out of memory. Try reducing concurrency with --max-concurrency 1 or increase available RAM.`
  },
  {
    pattern: /EADDRINUSE|address already in use/i,
    suggestion: (title) => `${title} port conflict. Another instance may still be running. Check for orphaned processes.`
  },
  {
    pattern: /401|unauthorized|authentication|auth.*fail/i,
    suggestion: (title) => `${title} authentication failed. Run "agentarena doctor --probe-auth" to verify credentials.`
  },
  {
    pattern: /429|rate.?limit|too many requests/i,
    suggestion: (title) => `${title} hit a rate limit. Wait a few minutes and retry, or reduce concurrency.`
  },
];

export function formatAdapterError(rawError: string, adapterTitle: string, command: string): string {
  for (const hint of ERROR_HINTS) {
    if (hint.pattern.test(rawError)) {
      return `${rawError}\n  Hint: ${hint.suggestion(adapterTitle, command)}`;
    }
  }
  return rawError;
}
