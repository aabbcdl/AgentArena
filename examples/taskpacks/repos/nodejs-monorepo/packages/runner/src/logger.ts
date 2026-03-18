export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger utility for the runner package.
 * Note: This is a duplicate of the core logger and should be consolidated.
 */
export class Logger {
  private prefix: string;
  private level: LogLevel;

  constructor(prefix: string, level: LogLevel = "info") {
    this.prefix = prefix;
    this.level = level;
  }

  debug(message: string): void {
    if (this.shouldLog("debug")) {
      console.log(`[DEBUG] [${this.prefix}] ${message}`);
    }
  }

  info(message: string): void {
    if (this.shouldLog("info")) {
      console.log(`[INFO] [${this.prefix}] ${message}`);
    }
  }

  warn(message: string): void {
    if (this.shouldLog("warn")) {
      console.warn(`[WARN] [${this.prefix}] ${message}`);
    }
  }

  error(message: string, error?: Error): void {
    if (this.shouldLog("error")) {
      console.error(`[ERROR] [${this.prefix}] ${message}`, error ?? "");
    }
  }

  private shouldLog(msgLevel: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(msgLevel) >= levels.indexOf(this.level);
  }
}
