// src/utils/logger.ts

import type { LogEntry, LoggerConfig } from "../types/logger.ts";
import { LogLevel } from "../types/logger.ts";

// Default patterns for sensitive data detection
const DEFAULT_SENSITIVE_PATTERNS: RegExp[] = [
  /(?:token|api[_-]?key|secret|password|auth)[\s]*[=:]\s*["']?[\w\-\.]+["']?/gi,
  /Bearer\s+[\w\-\.]+/gi,
  /[A-Za-z0-9+/]{40,}/g, // Long base64-like strings (potential tokens)
];

export class Logger {
  private config: LoggerConfig;
  private module: string;

  constructor(module: string, config?: Partial<LoggerConfig>) {
    this.module = module;
    this.config = {
      level: config?.level ?? LogLevel.INFO,
      sensitivePatterns: config?.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  private sanitize(value: unknown): unknown {
    if (typeof value === "string") {
      let sanitized = value;
      for (const pattern of this.config.sensitivePatterns!) {
        sanitized = sanitized.replace(pattern, "[REDACTED]");
      }
      return sanitized;
    }
    if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        return value.map((item) => this.sanitize(item));
      }
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        // Always redact keys that look sensitive
        if (/token|password|secret|key|auth/i.test(key)) {
          sanitized[key] = "[REDACTED]";
        } else {
          sanitized[key] = this.sanitize(val);
        }
      }
      return sanitized;
    }
    return value;
  }

  private formatEntry(
    level: keyof typeof LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      context: context ? this.sanitize(context) as Record<string, unknown> : undefined,
    };
  }

  private output(entry: LogEntry, isError: boolean = false): void {
    const line = JSON.stringify(entry);
    if (isError) {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.output(this.formatEntry("DEBUG", message, context));
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.output(this.formatEntry("INFO", message, context));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.output(this.formatEntry("WARN", message, context));
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.output(this.formatEntry("ERROR", message, context), true);
    }
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.FATAL)) {
      this.output(this.formatEntry("FATAL", message, context), true);
    }
  }

  // Create a child logger with inherited config
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`, this.config);
  }
}

// Global logger configuration
let globalLoggerConfig: Partial<LoggerConfig> = {};

/**
 * Configure global logger settings
 */
export function configureLogger(config: { level?: string; format?: string }): void {
  const levelStr = config.level ?? Deno.env.get("LOG_LEVEL") ?? "INFO";
  const level = LogLevel[levelStr.toUpperCase() as keyof typeof LogLevel] ?? LogLevel.INFO;
  globalLoggerConfig = { level };
}

// Factory function to create logger with environment-based level
export function createLogger(module: string): Logger {
  if (Object.keys(globalLoggerConfig).length === 0) {
    const levelStr = Deno.env.get("LOG_LEVEL") ?? "INFO";
    const level = LogLevel[levelStr as keyof typeof LogLevel] ?? LogLevel.INFO;
    globalLoggerConfig = { level };
  }
  return new Logger(module, globalLoggerConfig);
}

// Re-export LogLevel for convenience
export { LogLevel };
