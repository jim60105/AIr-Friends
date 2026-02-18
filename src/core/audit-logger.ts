// src/core/audit-logger.ts

import { createLogger } from "@utils/logger.ts";
import { join } from "@std/path";
import type { AuditConfig } from "../types/config.ts";
import type { AuditPhase, SessionAuditEntry } from "../types/audit.ts";
import { auditEntriesTotal } from "@utils/metrics.ts";

const logger = createLogger("AuditLogger");

/**
 * Manages audit log writing for a single session.
 * Created per-session by SessionOrchestrator.
 */
export class SessionAuditWriter {
  private filePath: string;
  private config: AuditConfig;
  private sessionId: string;

  constructor(
    auditBasePath: string,
    platform: string,
    userId: string,
    sessionId: string,
    config: AuditConfig,
  ) {
    this.sessionId = sessionId;
    this.config = config;
    this.filePath = join(auditBasePath, platform, userId, `${sessionId}.jsonl`);
  }

  /** Expose config for external use (e.g. skill audit) */
  getConfig(): AuditConfig {
    return this.config;
  }

  /**
   * Write an audit entry if the phase is included in config.
   * Fire-and-forget — errors are logged but never thrown.
   */
  async write(phase: AuditPhase, data: SessionAuditEntry["data"]): Promise<void> {
    // Phase filter
    if (
      this.config.includedPhases.length > 0 &&
      !this.config.includedPhases.includes(phase)
    ) {
      return;
    }

    // Update Prometheus counter
    auditEntriesTotal.inc({ phase });

    const entry: SessionAuditEntry = {
      ts: new Date().toISOString(),
      phase,
      data,
    };

    try {
      const dir = this.filePath.substring(0, this.filePath.lastIndexOf("/"));
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(
        this.filePath,
        JSON.stringify(entry) + "\n",
        { append: true },
      );
    } catch (error) {
      logger.warn("Failed to write audit entry for session {sessionId}", {
        sessionId: this.sessionId,
        phase,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
