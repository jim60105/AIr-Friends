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
  | "email_operation"
  | "retry_triggered"
  | "process_acquired"
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

    // process_acquired
    permissionMode?: string;
    processNamespace?: string;
    pooled?: boolean;

    // prompt_sent
    promptLength?: number;
    imageCount?: number;
    modelId?: string;

    // agent_message
    promptContentHash?: string;

    // skill_call
    skillName?: string;
    skillParams?: Record<string, unknown>;
    skillResult?: { success: boolean; error?: string; code?: string };
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

    // email_operation (private email context): the six-field allowlist below,
    // never any message content, address or file name.
    operationId?: string;
    workId?: string;
    actionSlot?: string;
    targetKind?: "user" | "third-party";
    sentCopy?: "pending" | "appended" | "failed";
    safeCode?: string;

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

/**
 * Platform identifier of the private email execution context. A session whose
 * platform is `email` carries private correspondence, so its audit entries are
 * serialized metadata-only regardless of the general `hashContent` setting.
 */
export const EMAIL_AUDIT_PLATFORM = "email";

/**
 * The exact field allowlist of the `email_operation` audit phase
 * (`email-private-observability` design). `phase` is the durable submission
 * phase (`prepared`/`submitting`/`submitted`/`failed`/`unknown`); the entry's
 * own `phase` field stays `email_operation`.
 */
export interface EmailOperationAuditData {
  operationId?: string;
  workId?: string;
  phase?: string;
  targetKind?: "user" | "third-party";
  sentCopy?: "pending" | "appended" | "failed";
  safeCode?: string;
}

/** The allowlisted `email_operation` data keys, in canonical spelling. */
export const EMAIL_OPERATION_AUDIT_FIELDS = [
  "operationId",
  "workId",
  "phase",
  "targetKind",
  "sentCopy",
  "safeCode",
] as const;

/** Canonical SHA-256 audit digest form (`sanitizeSkillParams` convention). */
export const EMAIL_HASH_VALUE_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Key suffix of a digest-bearing audit field. */
export const EMAIL_HASH_FIELD_PATTERN = /hash$/i;

/**
 * Fields that name a content payload. In the private email context these are
 * never recorded: only their digest (and string length / array count) is.
 * Deliberately includes agent-provided titles and raw command text, which can
 * carry a staged file name, a subject or quoted mail.
 */
export const EMAIL_CONTENT_FIELD_NAMES: Record<string, true> = {
  content: true,
  query: true,
  text: true,
  message: true,
  replycontent: true,
  body: true,
  subject: true,
  caption: true,
  title: true,
  toolname: true,
  command: true,
  authoredtext: true,
  intenttext: true,
  prompt: true,
  prompttext: true,
};

/** Fields carrying a collection of paths/names/ids: hashed into one digest. */
export const EMAIL_CONTENT_ARRAY_FIELD_NAMES: Record<string, true> = {
  filepaths: true,
  filenames: true,
  messageids: true,
  files: true,
  paths: true,
  attachments: true,
};

// Value formats of the fields that may be recorded verbatim. Every one of them
// is a host-assigned identifier, a bounded enum or a classification produced by
// the host — never a free-form model/agent payload. A value that does not match
// its field's format is dropped (or hashed) instead of being recorded.
const SESSION_ID_VALUE = /^sess_[A-Za-z0-9_]{1,64}$/;
const OPERATION_ID_VALUE = /^op_[A-Za-z0-9_-]{1,64}$/;
const HOST_ID_VALUE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HOST_SLOT_VALUE = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$/;
const LOWER_TOKEN_VALUE = /^[a-z][a-z0-9_-]{0,63}$/;
const UPPER_CODE_VALUE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MODEL_VALUE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

/** Format rules of the verbatim-recordable audit fields (keys are lowercased). */
const EMAIL_SAFE_TEXT_FIELDS: Record<string, RegExp> = {
  sessionid: SESSION_ID_VALUE,
  operationid: OPERATION_ID_VALUE,
  workid: HOST_ID_VALUE,
  actionslot: HOST_SLOT_VALUE,
  grantid: HOST_ID_VALUE,
  sourcerecordid: HOST_ID_VALUE,
  memoryid: HOST_ID_VALUE,
  sessiontype: LOWER_TOKEN_VALUE,
  phase: LOWER_TOKEN_VALUE,
  targetkind: /^(user|third-party)$/,
  sentcopy: /^(pending|appended|failed)$/,
  safecode: UPPER_CODE_VALUE,
  code: UPPER_CODE_VALUE,
  action: LOWER_TOKEN_VALUE,
  skillname: LOWER_TOKEN_VALUE,
  platform: /^(discord|misskey|email)$/,
  agenttype: /^(opencode|omp)$/,
  model: MODEL_VALUE,
  modelid: MODEL_VALUE,
  reasoningeffort: LOWER_TOKEN_VALUE,
  permissionmode: /^(restricted|native-yolo|yolo-switch)$/,
  permissionkind: /^(read|edit|delete|move|search|execute|think|fetch|other|unknown)$/,
  processnamespace: HOST_ID_VALUE,
  decision: LOWER_TOKEN_VALUE,
  reason: LOWER_TOKEN_VALUE,
  operation: LOWER_TOKEN_VALUE,
  visibility: /^(public|private)$/,
  tier: LOWER_TOKEN_VALUE,
  category: LOWER_TOKEN_VALUE,
  stopreason: /^[A-Za-z0-9_-]{1,32}$/,
};

/**
 * Whether a scalar string value may be recorded under `key` in the private
 * email context. Already-canonical digests are always accepted; everything else
 * must match its field's own host-assigned format.
 */
export function isSafeEmailAuditScalar(key: string, value: string): boolean {
  if (EMAIL_HASH_VALUE_PATTERN.test(value)) return true;
  const pattern = EMAIL_SAFE_TEXT_FIELDS[key.toLowerCase()];
  return pattern !== undefined && pattern.test(value);
}
