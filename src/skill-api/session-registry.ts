// src/skill-api/session-registry.ts

import { createLogger } from "@utils/logger.ts";
import type { NormalizedEvent } from "../types/events.ts";
import type { WorkspaceInfo } from "../types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { SessionAuditWriter } from "@core/audit-logger.ts";
import type { WorkspaceManager } from "@core/workspace-manager.ts";

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
  platformAdapter?: PlatformAdapter;
  /** Trigger event (undefined for spontaneous posts) */
  triggerEvent?: NormalizedEvent;
  /** Session start time */
  startedAt: Date;

  /** Whether reply has been sent */
  replySent: boolean;
  /** Number of replies sent in this session */
  replyCount: number;
  /** Number of edit-reply calls in this session */
  editCount: number;
  /** Agent's global workspace path */
  agentWorkspacePath?: string;
  /** Audit writer for this session (null if audit disabled) */
  auditWriter?: SessionAuditWriter;
  /** Callback to request agent process termination (doom-loop protection) */
  onTerminateRequest?: () => Promise<void>;
  /** Last message ID sent by the bot in this session */
  lastSentMessageId?: string;
  /** WorkspaceManager for channel workspace resolution */
  workspaceManager?: WorkspaceManager;
}

/**
 * Session Registry - tracks active agent sessions
 */
export class SessionRegistry {
  private sessions: Map<string, ActiveSession> = new Map();

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
  register(
    session: Omit<
      ActiveSession,
      "id" | "startedAt" | "replySent" | "replyCount" | "editCount"
    >,
  ): string {
    const id = this.generateSessionId();
    const activeSession: ActiveSession = {
      ...session,
      id,
      startedAt: new Date(),
      replySent: false,
      replyCount: 0,
      editCount: 0,
    };

    this.sessions.set(id, activeSession);

    logger.info("Session {sessionId} registered for {platform}:{channelId}", {
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
    return this.sessions.get(sessionId);
  }

  /**
   * Check if session exists
   */
  has(sessionId: string): boolean {
    return this.get(sessionId) !== undefined;
  }

  /**
   * Mark reply as sent for a session
   * Returns true if session exists, false if session not found
   */
  markReplySent(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.replySent = true;
    logger.debug("Reply marked as sent for session {sessionId}", { sessionId });
    return true;
  }

  /**
   * Unmark reply sent (for rollback when execution fails)
   */
  unmarkReplySent(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.replySent = false;
      logger.debug("Reply unmarked (rollback) for session {sessionId}", { sessionId });
    }
  }

  /**
   * Increment the reply count for a session.
   * Returns the new count, or -1 if session not found.
   */
  incrementReplyCount(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) return -1;

    session.replyCount += 1;
    logger.debug("Reply count incremented to {replyCount} for session {sessionId}", {
      sessionId,
      replyCount: session.replyCount,
    });
    return session.replyCount;
  }

  /**
   * Get the current reply count for a session.
   * Returns 0 if session not found.
   */
  getReplyCount(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    return session?.replyCount ?? 0;
  }

  /**
   * Increment the edit count for a session.
   * Returns the new count, or -1 if session not found.
   */
  incrementEditCount(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) return -1;

    session.editCount += 1;
    logger.debug("Edit count incremented to {editCount} for session {sessionId}", {
      sessionId,
      editCount: session.editCount,
    });
    return session.editCount;
  }

  /**
   * Get the current edit count for a session.
   * Returns 0 if session not found.
   */
  getEditCount(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    return session?.editCount ?? 0;
  }

  /**
   * Check if reply was already sent
   */
  hasReplySent(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.replySent ?? false;
  }

  /**
   * Attach an audit writer to an existing session
   */
  setAuditWriter(sessionId: string, writer: SessionAuditWriter): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.auditWriter = writer;
    }
  }

  /**
   * Set a callback to terminate the agent process for a given session.
   * Called by SessionOrchestrator after creating the connector.
   */
  setTerminateCallback(sessionId: string, callback: () => Promise<void>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.onTerminateRequest = callback;
    }
  }

  /**
   * Set the last message ID sent by the bot in a session.
   */
  setLastSentMessageId(sessionId: string, messageId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastSentMessageId = messageId;
    }
  }

  /**
   * Get the last message ID sent by the bot in a session.
   */
  getLastSentMessageId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.lastSentMessageId;
  }

  /**
   * Remove a session
   */
  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    logger.debug("Session {sessionId} removed", { sessionId });
  }

  /**
   * Get all active (non-expired) sessions
   */
  getAll(): ActiveSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Check if there are any active (non-expired) sessions for the given workspace key.
   * Used to determine if it's safe to clean up the workspace tmp directory.
   */
  hasActiveSessionsForWorkspace(workspaceKey: string): boolean {
    for (const [, session] of this.sessions) {
      if (session.workspace.key === workspaceKey) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all active sessions count
   */
  get activeCount(): number {
    return this.sessions.size;
  }

  /**
   * Stop the registry (cleanup)
   */
  stop(): void {
    this.sessions.clear();
  }
}
