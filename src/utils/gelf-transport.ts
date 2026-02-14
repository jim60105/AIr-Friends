// src/utils/gelf-transport.ts

import type { LogEntry } from "../types/logger.ts";
import type { GelfConfig } from "../types/config.ts";

/**
 * GELF message structure (GELF Payload Specification version 1.1)
 * @see https://go2docs.graylog.org/current/getting_in_log_data/gelf.html
 */
interface GelfMessage {
  version: "1.1";
  host: string;
  short_message: string;
  full_message?: string;
  timestamp: number;
  level: number;
  [key: `_${string}`]: string | number | undefined;
}

/**
 * Map internal LogLevel names to Syslog severity levels used by GELF.
 *
 * Syslog levels (RFC 5424):
 *   0 = Emergency, 1 = Alert, 2 = Critical, 3 = Error,
 *   4 = Warning, 5 = Notice, 6 = Informational, 7 = Debug
 */
const LOG_LEVEL_TO_SYSLOG: Record<string, number> = {
  FATAL: 2,
  ERROR: 3,
  WARN: 4,
  INFO: 6,
  DEBUG: 7,
};

/**
 * GelfTransport sends log entries to a GELF HTTP endpoint asynchronously.
 * Errors during sending are silently caught and logged to stderr
 * to avoid disrupting the main application flow.
 */
export class GelfTransport {
  private readonly endpoint: string;
  private readonly hostname: string;

  constructor(config: GelfConfig) {
    this.endpoint = config.endpoint;
    this.hostname = config.hostname ?? "air-friends";
  }

  /**
   * Convert a LogEntry to a GELF message and send it to the endpoint.
   * This method is fire-and-forget; errors are caught internally.
   */
  send(entry: LogEntry): void {
    const message = this.toGelfMessage(entry);

    fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(5000),
    }).then((res) => {
      // Consume the response body to prevent resource leaks
      res.body?.cancel();
    }).catch((err) => {
      console.error(
        `[GelfTransport] Failed to send log to ${this.endpoint}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  /**
   * Convert a LogEntry to GELF message format.
   */
  private toGelfMessage(entry: LogEntry): GelfMessage {
    const gelf: GelfMessage = {
      version: "1.1",
      host: this.hostname,
      short_message: entry.message,
      timestamp: new Date(entry.timestamp).getTime() / 1000,
      level: LOG_LEVEL_TO_SYSLOG[entry.level] ?? 6,
      _module: entry.module,
      _log_level: entry.level,
    };

    if (entry.messageTemplate) {
      gelf._messageTemplate = entry.messageTemplate;
    }

    if (entry.context) {
      for (const [key, value] of Object.entries(entry.context)) {
        if (value !== undefined && value !== null) {
          const gelfKey = `_${key}` as `_${string}`;
          gelf[gelfKey] = typeof value === "object"
            ? JSON.stringify(value)
            : (value as string | number);
        }
      }
    }

    return gelf;
  }
}
