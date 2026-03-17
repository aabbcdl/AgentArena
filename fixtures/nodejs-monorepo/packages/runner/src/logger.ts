/**
 * Logger utility for Runner package
 * Runner 包的日志工具
 * 
 * NOTE: This is a duplicate - should be consolidated into shared package
 * 注意：这是重复代码 - 应该合并到 shared 包中
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Creates a logger instance for Runner operations
 * 为 Runner 操作创建日志实例
 */
export function createLogger(prefix: string = 'Runner'): Logger {
  const log = (level: LogLevel, message: string, ...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] [${prefix}] ${message}`, ...args);
  };

  return {
    debug: (msg, ...args) => log('debug', msg, ...args),
    info: (msg, ...args) => log('info', msg, ...args),
    warn: (msg, ...args) => log('warn', msg, ...args),
    error: (msg, ...args) => log('error', msg, ...args)
  };
}

export const defaultLogger = createLogger();
