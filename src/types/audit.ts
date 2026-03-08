// src/types/audit.ts

/**
 * Audit log phases matching session lifecycle
 */
export type AuditPhase =
  | "context_assembly"
  | "yolo_resolution"
  | "agent_connect"
  | "prompt_sent"
  | "skill_call"
  | "agent_response"
  | "reply_sent"
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

    // skill_call
    skillName?: string;
    skillParams?: Record<string, unknown>;
    skillResult?: { success: boolean; error?: string };
    skillDurationMs?: number;

    // agent_response
    stopReason?: string;
    isRetry?: boolean;

    // reply_sent
    replyContentHash?: string;
    replyLength?: number;
    platform?: string;

    // session_end
    success?: boolean;
    replySent?: boolean;
    reactionSent?: boolean;
    durationMs?: number;
    error?: string;

    // permission_approved / permission_denied
    toolName?: string;
    permissionKind?: string;
    command?: string;
    decision?: "approved" | "denied";
    reason?: string;

    // common
    [key: string]: unknown;
  };
}
