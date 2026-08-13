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
  /**
   * Per-session caller token (F13). Provisioned into the owning agent
   * subprocess's environment as `SKILL_API_TOKEN`; a Skill API request must
   * present this token (not merely a valid session ID) to be authorized.
   */
  callerToken: string;
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
  /** Whether at least one file was delivered via send-file (session-scoped response state) */
  fileSent: boolean;
  /** Number of replies sent in this session */
  replyCount: number;
  /** Number of edit-reply calls in this session */
  editCount: number;
  /** Number of successful send-file calls in this session (multi-file batch = 1) */
  fileSendCount: number;
  /** Agent's global workspace path */
  agentWorkspacePath?: string;
  /** Last time this session was touched by an authenticated call (F13 idle TTL) */
  lastActivityAt: Date;
  /** Audit writer for this session (null if audit disabled) */
  auditWriter?: SessionAuditWriter;
  /** Callback to request agent process termination (doom-loop protection) */
  onTerminateRequest?: () => Promise<void>;
  /**
   * Last message ID sent via `send-reply` or `edit-reply` ONLY (including
   * Misskey's delete-and-recreate new ID). Consumed by `edit-reply` scoping
   * and the `get-message` fallback. A message delivered by `send-file` is
   * NEVER recorded here — see `lastFileMessageId`.
   */
  lastSentMessageId?: string;
  /**
   * Last message ID delivered by `send-file`, recorded ONLY when at least one
   * file was delivered (on Misskey chat partial delivery this is the last
   * *delivered* message ID). Consumed as the reply threading anchor and by
   * the `get-message` fallback. NEVER written by `send-reply`/`edit-reply`.
   */
  lastFileMessageId?: string;
  /**
   * The message ID the last text reply was created as a reply to (the reply
   * anchor in effect when `send-reply` succeeded). Recorded ONLY on a
   * successful `send-reply`; never changed by `edit-reply`, which consumes
   * it to preserve the edited reply's original thread parent.
   */
  lastReplyAnchorMessageId?: string;
  /** WorkspaceManager for channel workspace resolution */
  workspaceManager?: WorkspaceManager;
  /**
   * Whether this session may write channel-scoped memory (F15). Derived from
   * the configured channel-write policy at registration and copied into the
   * skill context to gate `memory-save --scope channel`.
   */
  canWriteChannelMemory?: boolean;
}

/**
 * Session Registry - tracks active agent sessions
 */
/** Default idle timeout for a session before it is treated as absent (30 min). */
export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export class SessionRegistry {
  private sessions: Map<string, ActiveSession> = new Map();
  private cleanupInterval?: ReturnType<typeof setInterval>;

  /**
   * @param timeoutMs idle timeout after which a session is treated as absent
   *   on {@link get} and reaped by the cleanup timer. Refreshed via {@link touch}
   *   on each authenticated call. Defaults to {@link DEFAULT_SESSION_TIMEOUT_MS},
   *   chosen to comfortably exceed the longest legitimate agent turn.
   */
  constructor(private readonly timeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS) {}

  /**
   * Generate a secure session ID
   */
  generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomUUID().replace(/-/g, "");
    return `sess_${timestamp}_${random}`;
  }

  /**
   * Generate a high-entropy per-session caller token (F13), distinct from the
   * session ID. 256 bits from a CSPRNG, hex-encoded.
   */
  private generateCallerToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Return true if a session has been idle beyond the configured timeout.
   */
  private isExpired(session: ActiveSession, now = Date.now()): boolean {
    return now - session.lastActivityAt.getTime() > this.timeoutMs;
  }

  /**
   * Register a new session
   */
  register(
    session: Omit<
      ActiveSession,
      | "id"
      | "callerToken"
      | "startedAt"
      | "lastActivityAt"
      | "replySent"
      | "fileSent"
      | "replyCount"
      | "editCount"
      | "fileSendCount"
    >,
  ): string {
    const id = this.generateSessionId();
    const now = new Date();
    const activeSession: ActiveSession = {
      ...session,
      id,
      callerToken: this.generateCallerToken(),
      startedAt: now,
      lastActivityAt: now,
      replySent: false,
      fileSent: false,
      replyCount: 0,
      editCount: 0,
      fileSendCount: 0,
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
   * Get session by ID. A session idle beyond the configured `timeoutMs` is
   * treated as absent (and evicted): it is deleted and `undefined` is returned,
   * so a leaked session ID cannot be used indefinitely (F13).
   */
  get(sessionId: string): ActiveSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (this.isExpired(session)) {
      this.sessions.delete(sessionId);
      logger.debug("Session {sessionId} expired (idle timeout), evicted", { sessionId });
      return undefined;
    }
    return session;
  }

  /**
   * Retrieve the caller token for a session without applying idle expiry.
   * Used at spawn time to provision the token into the agent subprocess env.
   */
  getCallerToken(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.callerToken;
  }

  /**
   * Refresh a session's idle timer. Called on each authenticated Skill API
   * request so an actively-used session does not expire mid-turn.
   */
  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date();
    }
  }

  /**
   * Start the periodic cleanup timer that reaps idle-expired sessions.
   * Must be started explicitly (e.g. by AgentCore) so that unit tests
   * constructing a registry directly do not leak a timer; {@link stop}
   * clears it.
   */
  startCleanupTimer(): void {
    if (this.cleanupInterval !== undefined) return;
    this.cleanupInterval = setInterval(() => this.reapExpired(), this.timeoutMs);
  }

  /**
   * Remove all idle-expired sessions from the registry.
   */
  private reapExpired(): void {
    const now = Date.now();
    let reaped = 0;
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session, now)) {
        this.sessions.delete(id);
        reaped++;
      }
    }
    if (reaped > 0) {
      logger.debug("Reaped {count} idle-expired sessions", { count: reaped });
    }
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
   * Mark that at least one file was delivered in this session (session-scoped
   * response state, read by the orchestrator's missing-response check).
   * Returns true if the session exists.
   */
  markFileSent(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.fileSent = true;
    logger.debug("File send marked as sent for session {sessionId}", { sessionId });
    return true;
  }

  /**
   * Check if at least one file was delivered in this session.
   * Returns false if session not found.
   */
  hasFileSent(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.fileSent ?? false;
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
   * Increment the send-file count for a session.
   * Used to reserve the per-session slot BEFORE execution (doom-loop-safe
   * against concurrent calls); rolled back via {@link decrementFileSendCount}
   * when nothing was delivered.
   * Returns the new count, or -1 if session not found.
   */
  incrementFileSendCount(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) return -1;

    session.fileSendCount += 1;
    logger.debug("File send count incremented to {fileSendCount} for session {sessionId}", {
      sessionId,
      fileSendCount: session.fileSendCount,
    });
    return session.fileSendCount;
  }

  /**
   * Get the current send-file count for a session.
   * Returns 0 if session not found.
   */
  getFileSendCount(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    return session?.fileSendCount ?? 0;
  }

  /**
   * Decrement the send-file count (rollback when nothing was delivered).
   */
  decrementFileSendCount(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.fileSendCount > 0) {
      session.fileSendCount -= 1;
      logger.debug("File send count rolled back to {fileSendCount} for session {sessionId}", {
        sessionId,
        fileSendCount: session.fileSendCount,
      });
    }
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
   * Set the last message ID sent by the bot via send-reply/edit-reply in a session.
   */
  setLastSentMessageId(sessionId: string, messageId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastSentMessageId = messageId;
    }
  }

  /**
   * Get the last message ID sent by the bot via send-reply/edit-reply in a session.
   */
  getLastSentMessageId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.lastSentMessageId;
  }

  /**
   * Set the last `send-file`-delivered message ID for a session (the reply
   * threading anchor for subsequent replies).
   */
  setLastFileMessageId(sessionId: string, messageId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastFileMessageId = messageId;
    }
  }

  /**
   * Get the last `send-file`-delivered message ID for a session.
   */
  getLastFileMessageId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.lastFileMessageId;
  }

  /**
   * Set the reply anchor recorded when the last text reply was created (set
   * only on `send-reply` success; never changed by `edit-reply`).
   */
  setLastReplyAnchorMessageId(sessionId: string, messageId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastReplyAnchorMessageId = messageId;
    }
  }

  /**
   * Get the reply anchor recorded when the last text reply was created.
   */
  getLastReplyAnchorMessageId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.lastReplyAnchorMessageId;
  }

  /**
   * Remove a session
   */
  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    logger.debug("Session {sessionId} removed", { sessionId });
  }

  /**
   * Get all currently-registered sessions.
   *
   * Note: this returns every entry still in the map, including sessions that
   * are past their idle timeout but not yet reaped. Idle expiry is enforced
   * lazily on {@link get} and by the cleanup timer; this accessor deliberately
   * does not filter, so callers that use it for liveness (e.g. workspace tmp
   * cleanup) err on the side of treating a session as still active.
   */
  getAll(): ActiveSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Check if there are any registered sessions for the given workspace key.
   * Used to determine if it's safe to clean up the workspace tmp directory.
   *
   * Like {@link getAll}, this counts every registered session (including ones
   * past their idle timeout but not yet reaped) so tmp cleanup never races
   * ahead of a still-running agent.
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
    if (this.cleanupInterval !== undefined) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.sessions.clear();
  }
}
