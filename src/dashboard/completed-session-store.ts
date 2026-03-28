// src/dashboard/completed-session-store.ts

import type { SessionType } from "../types/config.ts";

/**
 * Completed session record
 */
export interface CompletedSession {
  /** Skill-API session ID (primary identifier, links to audit log) */
  auditSessionId: string;
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

  /** Get all completed sessions (newest first by endedAt) */
  getAll(): CompletedSession[] {
    return [...this.buffer].sort((a, b) =>
      new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
    );
  }

  /** Bulk-load sessions, maintaining capacity limit (oldest evicted first) */
  addMany(sessions: CompletedSession[]): void {
    // Sort oldest-first so newest entries end up at the tail of the buffer
    const sorted = [...sessions].sort((a, b) =>
      new Date(a.endedAt).getTime() - new Date(b.endedAt).getTime()
    );
    for (const session of sorted) {
      this.add(session);
    }
  }
}
