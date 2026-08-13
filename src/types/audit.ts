// src/types/audit.ts

/**
 * Audit log phases matching session lifecycle
 */
export type AuditPhase =
  | "trigger_received"
  | "session_start"
  | "rate_limit_checked"
  | "context_assembly"
  | "yolo_resolution"
  | "agent_connect"
  | "prompt_sent"
  | "agent_message"
  | "skill_call"
  | "memory_operation"
  | "agent_response"
  | "agent_complete_message"
  | "agent_complete_thought"
  | "reply_sent"
  | "reply_edited"
  | "file_sent"
  | "retry_triggered"
  | "session_end"
  | "permission_approved"
  | "permission_denied";

/**
 * A single audit log entry written as one line in JSONL
 */
export interface SessionAuditEntry {
  /** ISO 8601 timestamp */
  ts: string;
  /** Session lifecycle phase */
  phase: AuditPhase;
  /** Phase-specific payload */
  data: {
    // trigger_received (messageId also used by file_sent: the last delivered
    // message ID / reply anchor)
    channelId?: string;
    userId?: string;
    messageId?: string;
    isDm?: boolean;
    contentLength?: number;
    attachmentCount?: number;

    // session_start
    sessionId?: string;
    sessionType?: string;
    workspaceKey?: string;
    model?: string;
    /** Resolved (effective) reasoning effort for the session ("default" = not configured) */
    reasoningEffort?: string;
    yolo?: boolean;

    // rate_limit_checked
    requestCount?: number;
    maxRequests?: number;
    cooldownRemainingMs?: number;

    // context_assembly
    memoriesCount?: number;
    recentMessagesCount?: number;
    relatedMessagesCount?: number;
    estimatedTokens?: number;

    // agent_connect
    agentType?: string;
    capabilities?: Record<string, unknown>;

    // prompt_sent
    promptLength?: number;
    imageCount?: number;
    modelId?: string;

    // agent_message
    promptContentHash?: string;

    // skill_call
    skillName?: string;
    skillParams?: Record<string, unknown>;
    skillResult?: { success: boolean; error?: string };
    skillDurationMs?: number;

    // memory_operation
    operation?: string;
    memoryId?: string;
    visibility?: string;
    tier?: string;
    category?: string;
    resultCount?: number;

    // agent_response
    stopReason?: string;
    isRetry?: boolean;

    // agent_complete_message
    messageContentHash?: string;
    messageLength?: number;
    chunkCount?: number;

    // agent_complete_thought
    thoughtContentHash?: string;
    thoughtLength?: number;

    // reply_sent
    replyContentHash?: string;
    replyLength?: number;
    platform?: string;

    // file_sent
    filesCount?: number;
    /** All delivered message IDs in send order */
    messageIds?: string[];
    captionHash?: string;
    fileNamesHash?: string;
    fileNames?: string;

    // reply_edited
    originalMessageId?: string;
    newMessageId?: string;

    // retry_triggered
    retryCount?: number;
    maxRetries?: number;

    // session_end
    success?: boolean;
    replySent?: boolean;
    reactionSent?: boolean;
    fileSent?: boolean;
    durationMs?: number;
    error?: string;
    repliesCount?: number;
    skillCallsCount?: number;
    memoryOpsCount?: number;
    permissionDecisionsCount?: number;

    // permission_approved / permission_denied
    toolName?: string;
    permissionKind?: string;
    command?: string;
    decision?: string;
    reason?: string;

    // common
    [key: string]: unknown;
  };
}
