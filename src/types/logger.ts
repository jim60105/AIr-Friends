// src/types/logger.ts

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

export interface LogEntry {
  timestamp: string; // ISO 8601 format
  level: keyof typeof LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

/** Interface for GELF transport to avoid circular dependency */
export interface GelfTransportLike {
  send(entry: LogEntry): void;
}

export interface LoggerConfig {
  level: LogLevel;
  sensitivePatterns?: RegExp[];
  /** Optional GELF transport instance for sending logs to a GELF server */
  gelfTransport?: GelfTransportLike;
}
