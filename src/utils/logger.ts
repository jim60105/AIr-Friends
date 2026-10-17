// src/utils/logger.ts

import type { GelfTransportLike, LogEntry, LoggerConfig } from "../types/logger.ts";
import { LogLevel } from "../types/logger.ts";
import { isEmailMetadataScalarKey, isSafeEmailAuditScalar } from "../types/audit.ts";
import { AsyncLocalStorage } from "node:async_hooks";

// Default patterns for sensitive data detection
const DEFAULT_SENSITIVE_PATTERNS: RegExp[] = [
  /(?:token|api[_-]?key|secret|password|auth)[\s]*[=:]\s*["']?[\w\-\.]+["']?/gi,
  /Bearer\s+[\w\-\.]+/gi,
  /[A-Za-z0-9+/]{40,}/g, // Long base64-like strings (potential tokens)
];

/**
 * Effective privacy of a log entry.
 *
 * `private-email` means the entry belongs to an email execution context whose
 * data is private correspondence: only identifiers, bounded enums, counts and
 * digests may be emitted, and placeholders holding anything else render as
 * `[redacted]`.
 */
export type LogPrivacy = "normal" | "private-email";

/** Mail-address-shaped text, redacted from module names of private entries. */
const MAIL_ADDRESS_PATTERN = /[^\s:@{}\/]+@[^\s:@{}\/]+/g;

/**
 * Whether a logger module belongs to the email context: an email module
 * (`EmailMailService`, …) or a session logger naming the email platform as a
 * segment (`SessionOrchestrator:email:e_…`,
 * `SessionOrchestrator:reminder:email:e_…:id`).
 */
export function isPrivateEmailLogModule(module: string): boolean {
  const segments = module.split(":");
  if (segments[0].startsWith("Email")) return true;
  return segments.slice(1).some((segment) => {
    const normalized = segment.trim().toLowerCase();
    return normalized === "email" || normalized.startsWith("email/");
  });
}

/**
 * Ambient privacy scope of the current async execution. The Skill API enters it
 * for one email skill call, so loggers that belong to other modules (skill
 * registry, session registry, audit writer) are private for exactly that
 * execution and never for a concurrent non-email one.
 */
const privateEmailScope = new AsyncLocalStorage<true>();

/** Run one email-context execution with private logging in effect. */
export function runWithPrivateEmailScope<T>(fn: () => T): T {
  return privateEmailScope.run(true, fn);
}

/**
 * Keys whose values may stay readable in a private email log entry. Every one
 * is host-assigned and validated by {@link isSafeEmailAuditScalar}; a number or
 * boolean is always safe (it cannot carry text).
 */
const PRIVATE_LOG_SAFE_KEYS: Record<string, true> = {
  sessionid: true,
  operationid: true,
  workid: true,
  actionslot: true,
  grantid: true,
  sourcerecordid: true,
  memoryid: true,
  sessiontype: true,
  phase: true,
  targetkind: true,
  sentcopy: true,
  safecode: true,
  code: true,
  action: true,
  skillname: true,
  platform: true,
  agenttype: true,
  model: true,
  modelid: true,
  reasoningeffort: true,
  permissionmode: true,
  permissionkind: true,
  processnamespace: true,
  decision: true,
  reason: true,
  operation: true,
  visibility: true,
  tier: true,
  category: true,
  stopreason: true,
  kind: true,
  status: true,
  classification: true,
  execution: true,
  verdict: true,
};

export class Logger {
  private config: LoggerConfig;
  private module: string;
  private defaultContext: Record<string, unknown>;
  private privacy: LogPrivacy;

  constructor(
    module: string,
    config?: Partial<LoggerConfig>,
    defaultContext?: Record<string, unknown>,
    privacy?: LogPrivacy,
  ) {
    this.module = module;
    this.config = {
      level: config?.level ?? LogLevel.INFO,
      sensitivePatterns: config?.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS,
      gelfTransport: config?.gelfTransport,
    };
    this.defaultContext = defaultContext ?? {};
    this.privacy = privacy ?? (isPrivateEmailLogModule(module) ? "private-email" : "normal");
  }

  /**
   * Create a new Logger with additional default context fields.
   * These fields are automatically merged into every log call's context.
   * Call-site context takes precedence over default context.
   */
  withContext(ctx: Record<string, unknown>): Logger {
    const merged = { ...this.defaultContext, ...ctx };
    return new Logger(this.module, this.config, merged, this.privacy);
  }

  /**
   * This logger restricted to the private email shape: identifiers, bounded
   * enums, counts and digests only. Used by mixed modules (the Skill API server,
   * the ACP client) whose email-context calls run alongside ordinary ones.
   */
  withPrivateEmail(): Logger {
    return new Logger(this.module, this.config, this.defaultContext, "private-email");
  }

  /** Whether this entry is emitted in the private email shape. */
  private isPrivate(): boolean {
    return this.privacy === "private-email" || privateEmailScope.getStore() === true;
  }

  /**
   * Drop everything a private email entry may not carry: content, addresses,
   * file names, agent-provided titles/ids, exception strings and nested
   * payloads. Only an allowlisted key holding a host-format value (or a number /
   * boolean) survives.
   */
  private projectPrivateContext(
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === "number" || typeof value === "boolean") {
        // The KEY is validated, not just the value: an attacker-supplied
        // property name must not become a place to hide text.
        if (isEmailMetadataScalarKey(key)) projected[key] = value;
        continue;
      }
      if (
        typeof value === "string" &&
        PRIVATE_LOG_SAFE_KEYS[key.toLowerCase()] === true &&
        isSafeEmailAuditScalar(key, value)
      ) {
        projected[key] = value;
      }
    }
    return projected;
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
    // Merge defaultContext with call-site context (call-site takes precedence)
    const mergedContext = Object.keys(this.defaultContext).length > 0 || context
      ? { ...this.defaultContext, ...context }
      : undefined;

    const hasTemplate = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(message);

    if (this.isPrivate()) {
      const safeContext = mergedContext ? this.projectPrivateContext(mergedContext) : {};
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        // The session logger names its platform and channel as module segments,
        // and an email channel/owner carries the mailbox address.
        module: this.module.replace(MAIL_ADDRESS_PATTERN, "[redacted-address]"),
        message: hasTemplate ? this.renderPrivateTemplate(message, safeContext) : message,
        context: Object.keys(safeContext).length > 0
          ? this.sanitize(safeContext) as Record<string, unknown>
          : undefined,
      };
      if (hasTemplate) {
        entry.messageTemplate = message;
      }
      return entry;
    }

    let renderedMessage = message;
    if (hasTemplate && mergedContext) {
      renderedMessage = this.renderTemplate(message, mergedContext);
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message: renderedMessage,
      context: mergedContext ? this.sanitize(mergedContext) as Record<string, unknown> : undefined,
    };

    if (hasTemplate) {
      entry.messageTemplate = message;
    }

    return entry;
  }

  /**
   * Replace {PropertyName} placeholders in template with context values.
   * Follows messagetemplates.org specification.
   * Unmatched placeholders are preserved as-is.
   * Double braces {{ and }} are escape sequences.
   */
  private renderTemplate(
    template: string,
    context: Record<string, unknown>,
  ): string {
    return template.replace(
      /\{\{|\}\}|\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
      (match, propName) => {
        if (match === "{{") return "{";
        if (match === "}}") return "}";
        if (propName in context) {
          const value = context[propName];
          if (value === null || value === undefined) return "";
          if (typeof value === "object") return JSON.stringify(value);
          return String(value);
        }
        return match;
      },
    );
  }

  /**
   * The private counterpart of {@link renderTemplate}: a placeholder whose value
   * was dropped from the private context renders as `[redacted]` instead of
   * being interpolated (or left as a literal `{name}` that a human reader could
   * mistake for a real value). Escape sequences keep their ordinary meaning.
   */
  private renderPrivateTemplate(
    template: string,
    safeContext: Record<string, unknown>,
  ): string {
    return template.replace(
      /\{\{|\}\}|\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
      (match, propName) => {
        if (match === "{{") return "{";
        if (match === "}}") return "}";
        const value = safeContext[propName];
        if (value === null || value === undefined) return "[redacted]";
        return typeof value === "object" ? JSON.stringify(value) : String(value);
      },
    );
  }

  private output(entry: LogEntry, isError: boolean = false): void {
    const line = JSON.stringify(entry);
    if (isError) {
      console.error(line);
    } else {
      console.log(line);
    }

    // Send to GELF if transport is configured
    if (this.config.gelfTransport) {
      this.config.gelfTransport.send(entry);
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

  // Create a child logger with inherited config and default context
  child(subModule: string): Logger {
    const childModule = `${this.module}:${subModule}`;
    // A child of a private logger stays private; a child that names the email
    // platform (the per-session logger) becomes private even from a mixed parent.
    const privacy: LogPrivacy = this.privacy === "private-email" ||
        isPrivateEmailLogModule(childModule)
      ? "private-email"
      : "normal";
    return new Logger(childModule, this.config, this.defaultContext, privacy);
  }
}

// Global logger configuration
let globalLoggerConfig: Partial<LoggerConfig> = {};

/**
 * Configure global logger settings
 */
export function configureLogger(
  config: { level?: string; format?: string; gelfTransport?: GelfTransportLike },
): void {
  const levelStr = config.level ?? Deno.env.get("LOG_LEVEL") ?? "INFO";
  const level = LogLevel[levelStr.toUpperCase() as keyof typeof LogLevel] ?? LogLevel.INFO;
  globalLoggerConfig = { level, gelfTransport: config.gelfTransport };
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
