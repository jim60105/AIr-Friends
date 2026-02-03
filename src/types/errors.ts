// src/types/errors.ts

export enum ErrorCode {
  // Configuration errors (1xxx)
  CONFIG_NOT_FOUND = 1001,
  CONFIG_INVALID = 1002,
  CONFIG_MISSING_FIELD = 1003,

  // Platform errors (2xxx)
  PLATFORM_CONNECTION_FAILED = 2001,
  PLATFORM_AUTH_FAILED = 2002,
  PLATFORM_API_ERROR = 2003,
  PLATFORM_RATE_LIMITED = 2004,

  // Agent errors (3xxx)
  AGENT_EXECUTION_FAILED = 3001,
  AGENT_TIMEOUT = 3002,
  AGENT_INVALID_RESPONSE = 3003,

  // Memory errors (4xxx)
  MEMORY_READ_FAILED = 4001,
  MEMORY_WRITE_FAILED = 4002,
  MEMORY_INVALID_FORMAT = 4003,

  // Skill errors (5xxx)
  SKILL_NOT_FOUND = 5001,
  SKILL_EXECUTION_FAILED = 5002,
  SKILL_INVALID_PARAMS = 5003,

  // Workspace errors (6xxx)
  WORKSPACE_ACCESS_DENIED = 6001,
  WORKSPACE_NOT_FOUND = 6002,
  WORKSPACE_INVALID_PATH = 6003,
}

export abstract class BaseError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly isRetryable: boolean;
  readonly timestamp: string;
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    this.context = context;
    // Maintain proper stack trace for where the error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      context: this.context,
      isRetryable: this.isRetryable,
    };
  }
}

export class ConfigError extends BaseError {
  readonly code: ErrorCode;
  readonly isRetryable = false;

  constructor(
    code:
      | ErrorCode.CONFIG_NOT_FOUND
      | ErrorCode.CONFIG_INVALID
      | ErrorCode.CONFIG_MISSING_FIELD,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
    this.code = code;
  }
}

export class PlatformError extends BaseError {
  readonly code: ErrorCode;
  readonly isRetryable: boolean;

  constructor(
    code:
      | ErrorCode.PLATFORM_CONNECTION_FAILED
      | ErrorCode.PLATFORM_AUTH_FAILED
      | ErrorCode.PLATFORM_API_ERROR
      | ErrorCode.PLATFORM_RATE_LIMITED,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
    this.code = code;
    // Connection and rate limit errors are retryable
    this.isRetryable = code === ErrorCode.PLATFORM_CONNECTION_FAILED ||
      code === ErrorCode.PLATFORM_RATE_LIMITED;
  }
}

export class AgentError extends BaseError {
  readonly code: ErrorCode;
  readonly isRetryable: boolean;

  constructor(
    code:
      | ErrorCode.AGENT_EXECUTION_FAILED
      | ErrorCode.AGENT_TIMEOUT
      | ErrorCode.AGENT_INVALID_RESPONSE,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
    this.code = code;
    this.isRetryable = code === ErrorCode.AGENT_TIMEOUT;
  }
}

export class MemoryError extends BaseError {
  readonly code: ErrorCode;
  readonly isRetryable = false;

  constructor(
    code:
      | ErrorCode.MEMORY_READ_FAILED
      | ErrorCode.MEMORY_WRITE_FAILED
      | ErrorCode.MEMORY_INVALID_FORMAT,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
    this.code = code;
  }
}

export class SkillError extends BaseError {
  readonly code: ErrorCode;
  readonly isRetryable = false;

  constructor(
    code:
      | ErrorCode.SKILL_NOT_FOUND
      | ErrorCode.SKILL_EXECUTION_FAILED
      | ErrorCode.SKILL_INVALID_PARAMS,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
    this.code = code;
  }
}

export class WorkspaceError extends BaseError {
  readonly code: ErrorCode;
  readonly isRetryable = false;

  constructor(
    code:
      | ErrorCode.WORKSPACE_ACCESS_DENIED
      | ErrorCode.WORKSPACE_NOT_FOUND
      | ErrorCode.WORKSPACE_INVALID_PATH,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
    this.code = code;
  }
}
