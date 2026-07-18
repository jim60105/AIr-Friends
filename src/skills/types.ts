// src/skills/types.ts

import type { WorkspaceInfo } from "../types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { AgentNoteSearchResult, ResolvedMemory } from "../types/memory.ts";
import type { PlatformMessage } from "../types/events.ts";
import type { WorkspaceManager } from "@core/workspace-manager.ts";

/**
 * Skill call parameters (from external Agent)
 */
export interface SkillCall {
  name: string;
  parameters: Record<string, unknown>;
}

/**
 * Result of a skill execution
 */
export interface SkillResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Context passed to skill handlers
 */
export interface SkillContext {
  workspace: WorkspaceInfo;
  platformAdapter: PlatformAdapter;
  channelId: string;
  userId: string;
  /** Original message ID that triggered this session (for reply threading) */
  replyToMessageId?: string;
  /** Agent's global workspace path for searching notes */
  agentWorkspacePath?: string;
  /** Last message ID sent by the bot in this session */
  lastSentMessageId?: string;
  /** Workspace manager for channel workspace resolution */
  workspaceManager?: WorkspaceManager;
  /**
   * Whether this session is authorized to write channel-scoped memory (F15).
   * Gates `memory-save --scope channel`. Set per the configured channel-write
   * policy; when not set, channel writes are rejected.
   */
  canWriteChannelMemory?: boolean;
}

/**
 * Skill handler function signature
 */
export type SkillHandler = (
  parameters: Record<string, unknown>,
  context: SkillContext,
) => Promise<SkillResult>;

/**
 * Parameters for memory-save skill
 */
export interface MemorySaveParams {
  content: string;
  visibility?: "public" | "private";
  importance?: "high" | "normal";
  tier?: string;
  category?: string;
  scope?: string;
  decay?: number;
}

/**
 * Parameters for memory-search skill
 */
export interface MemorySearchParams {
  query: string;
  limit?: number;
  category?: string;
  scope?: string;
}

/**
 * Result for memory-search skill
 */
export interface MemorySearchResult {
  memories: ResolvedMemory[];
  agentNotes?: AgentNoteSearchResult[];
}

/**
 * Parameters for memory-patch skill
 */
export interface MemoryPatchParams {
  memory_id: string;
  enabled?: boolean;
  visibility?: "public" | "private";
  importance?: "high" | "normal";
  relatedTo?: string[];
  supersedes?: string[];
  tier?: string;
  category?: string;
  decay?: number;
}

/**
 * Parameters for memory-export skill
 */
export interface MemoryExportParams {
  /** Output format: "markdown" (default) or "json" */
  format?: "markdown" | "json";
  /** Filter by importance: "high", "normal", or "all" (default: "all") */
  importance?: "high" | "normal" | "all";
  /** Only include enabled memories (default: true) */
  enabled_only?: boolean;
}

/**
 * Parameters for send-reply skill
 */
export interface SendReplyParams {
  message: string;
  attachments?: Array<{
    type: "image" | "file";
    url: string;
    filename?: string;
  }>;
}

/**
 * Parameters for edit-reply skill
 */
export interface EditReplyParams {
  /** ID of the message to edit (from send-reply result) */
  messageId: string;
  /** New message content */
  message: string;
}

/**
 * Parameters for react-message skill
 */
export interface ReactMessageParams {
  /** Emoji to react with (Unicode character or platform-specific format) */
  emoji: string;
}

/**
 * Parameters for fetch-context skill
 */
export interface FetchContextParams {
  type: "recent_messages" | "search_messages" | "user_info";
  query?: string;
  limit?: number;
}

/**
 * Result for fetch-context skill
 */
export interface FetchContextResult {
  type: string;
  data: PlatformMessage[] | Record<string, unknown>;
}

/**
 * Parameters for get-message skill
 */
export interface GetMessageParams {
  /** ID of the message to fetch (optional, defaults to last sent message) */
  messageId?: string;
}
