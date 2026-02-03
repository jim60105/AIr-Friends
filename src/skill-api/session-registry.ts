// src/skill-api/session-registry.ts

import { createLogger } from "@utils/logger.ts";
import type { NormalizedEvent } from "../types/events.ts";
import type { WorkspaceInfo } from "../types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

const logger = createLogger("SessionRegistry");

/**
 * Active session information
 */
export interface ActiveSession {
  /** Unique session identifier */
  id: string;
  /** Platform (discord/misskey) */
  platform: string;
  /** Channel ID for replies */
  channelId: string;
  /** User ID who triggered the session */
  userId: string;
  /** Guild ID (if applicable) */
  guildId?: string;
  /** Whether this is a DM */
  isDm: boolean;
  /** Workspace info for memory operations */
  workspace: WorkspaceInfo;
  /** Reference to platform adapter */
  platformAdapter: PlatformAdapter;
  /** Trigger event */
  triggerEvent: NormalizedEvent;
  /** Session start time */
  startedAt: Date;
  /** Session timeout (ms) */
  timeoutMs: number;
  /** Whether reply has been sent */
  replySent: boolean;
}

/**
 * Session Registry - tracks active agent sessions
 */
export class SessionRegistry {
  private sessions: Map<string, ActiveSession> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start periodic cleanup
    this.startCleanup();
  }

  /**
   * Generate a secure session ID
   */
  generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomUUID().replace(/-/g, "");
    return `sess_${timestamp}_${random}`;
  }

  /**
   * Register a new session
   */
  register(session: Omit<ActiveSession, "id" | "startedAt" | "replySent">): string {
    const id = this.generateSessionId();
    const activeSession: ActiveSession = {
      ...session,
      id,
      startedAt: new Date(),
      replySent: false,
    };

    this.sessions.set(id, activeSession);

    logger.info("Session registered", {
      sessionId: id,
      platform: session.platform,
      channelId: session.channelId,
      userId: session.userId,
    });

    return id;
  }

  /**
   * Get session by ID
   */
  get(sessionId: string): ActiveSession | undefined {
    const session = this.sessions.get(sessionId);

    if (session && this.isExpired(session)) {
      logger.warn("Session expired", { sessionId });
      this.sessions.delete(sessionId);
      return undefined;
    }

    return session;
  }

  /**
   * Check if session exists
   */
  has(sessionId: string): boolean {
    return this.get(sessionId) !== undefined;
  }

  /**
   * Mark reply as sent for a session
   */
  markReplySent(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.replySent) {
      logger.warn("Reply already sent for session", { sessionId });
      return false;
    }

    session.replySent = true;
    return true;
  }

  /**
   * Check if reply was already sent
   */
  hasReplySent(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.replySent ?? false;
  }

  /**
   * Remove a session
   */
  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    logger.debug("Session removed", { sessionId });
  }

  /**
   * Get all active sessions count
   */
  get activeCount(): number {
    return this.sessions.size;
  }

  /**
   * Check if a session is expired
   */
  private isExpired(session: ActiveSession): boolean {
    const elapsed = Date.now() - session.startedAt.getTime();
    return elapsed > session.timeoutMs;
  }

  /**
   * Start periodic cleanup of expired sessions
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      for (const [id, session] of this.sessions) {
        if (this.isExpired(session)) {
          logger.info("Cleaning up expired session", { sessionId: id });
          this.sessions.delete(id);
        }
      }
    }, 60_000); // Check every minute
  }

  /**
   * Stop the registry (cleanup)
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
  }
}
