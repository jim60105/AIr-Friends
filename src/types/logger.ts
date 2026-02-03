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

export interface LoggerConfig {
  level: LogLevel;
  sensitivePatterns?: RegExp[];
}
