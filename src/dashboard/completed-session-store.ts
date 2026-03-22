// src/dashboard/completed-session-store.ts

import type { SessionType } from "../types/config.ts";

/**
 * Completed session record
 */
export interface CompletedSession {
  /** Session identifier */
  id: string;
  /** Session type */
  type: SessionType;
  /** Platform identifier */
  platform: string;
  /** User who triggered the session */
  userId: string;
  /** Session start time (ISO 8601) */
  startedAt: string;
  /** Session end time (ISO 8601) */
  endedAt: string;
  /** Session outcome */
  status: "success" | "failure";
  /** Duration in milliseconds */
  durationMs: number;
  /** Skill-API session ID for audit log lookup */
  auditSessionId?: string;
}

const MAX_ENTRIES = 100;

/**
 * In-memory ring buffer storing recently completed sessions.
 * Evicts the oldest entry when capacity is exceeded.
 */
export class CompletedSessionStore {
  private buffer: CompletedSession[] = [];

  /** Add a completed session record, evicting oldest if at capacity */
  add(session: CompletedSession): void {
    if (this.buffer.length >= MAX_ENTRIES) {
      this.buffer.shift();
    }
    this.buffer.push(session);
  }

  /** Get all completed sessions (newest last) */
  getAll(): CompletedSession[] {
    return [...this.buffer];
  }
}
