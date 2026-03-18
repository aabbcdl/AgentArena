export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger utility for the CLI package.
 * Note: This is a duplicate of the core logger and should be consolidated.
 */
export class Logger {
  private prefix: string;
  private level: LogLevel;
  private timestamps: boolean;

  constructor(prefix: string, level: LogLevel = "info", timestamps = true) {
    this.prefix = prefix;
    this.level = level;
    this.timestamps = timestamps;
  }

  private getTimestamp(): string {
    return this.timestamps ? `[${new Date().toISOString()}] ` : "";
  }

  debug(message: string): void {
    if (this.shouldLog("debug")) {
      console.log(`${this.getTimestamp()}[DEBUG] [${this.prefix}] ${message}`);
    }
  }

  info(message: string): void {
    if (this.shouldLog("info")) {
      console.log(`${this.getTimestamp()}[INFO] [${this.prefix}] ${message}`);
    }
  }

  warn(message: string): void {
    if (this.shouldLog("warn")) {
      console.warn(`${this.getTimestamp()}[WARN] [${this.prefix}] ${message}`);
    }
  }

  error(message: string, error?: Error): void {
    if (this.shouldLog("error")) {
      console.error(`${this.getTimestamp()}[ERROR] [${this.prefix}] ${message}`, error ?? "");
    }
  }

  private shouldLog(msgLevel: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(msgLevel) >= levels.indexOf(this.level);
  }
}
