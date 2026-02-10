// src/skills/types.ts

import type { WorkspaceInfo } from "../types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { ResolvedMemory } from "../types/memory.ts";
import type { PlatformMessage } from "../types/events.ts";

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
}

/**
 * Parameters for memory-search skill
 */
export interface MemorySearchParams {
  query: string;
  limit?: number;
}

/**
 * Result for memory-search skill
 */
export interface MemorySearchResult {
  memories: ResolvedMemory[];
}

/**
 * Parameters for memory-patch skill
 */
export interface MemoryPatchParams {
  memory_id: string;
  enabled?: boolean;
  visibility?: "public" | "private";
  importance?: "high" | "normal";
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
