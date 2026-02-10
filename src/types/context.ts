// src/types/context.ts

import type { ResolvedMemory } from "./memory.ts";
import type { PlatformMessage } from "./events.ts";
import type { PlatformEmoji } from "./platform.ts";

/**
 * Assembled context for an Agent session
 */
export interface AssembledContext {
  /** Important memories (high importance, fully loaded) */
  importantMemories: ResolvedMemory[];

  /** Recent messages from the current channel */
  recentMessages: PlatformMessage[];

  /** Related messages from the same guild (optional) */
  relatedMessages?: PlatformMessage[];

  /** System prompt content */
  systemPrompt: string;

  /** Current user's message that triggered this interaction */
  triggerMessage: PlatformMessage;

  /** Estimated token count */
  estimatedTokens: number;

  /** Available custom emojis on the platform */
  availableEmojis?: PlatformEmoji[];

  /** Timestamp when context was assembled */
  assembledAt: Date;
}

/**
 * Assembled context for a spontaneous post session.
 * Similar to AssembledContext but without a trigger message.
 */
export interface AssembledSpontaneousContext {
  /** System prompt content */
  systemPrompt: string;

  /** Important memories from the bot's workspace */
  importantMemories: ResolvedMemory[];

  /** Recent messages from the target channel (may be empty if not fetched) */
  recentMessages: PlatformMessage[];

  /** Available custom emojis */
  availableEmojis?: PlatformEmoji[];

  /** Whether recent messages were intentionally fetched */
  recentMessagesFetched: boolean;

  /** Estimated token count */
  estimatedTokens: number;
}

/**
 * Configuration for context assembly
 */
export interface ContextAssemblyConfig {
  /** Maximum number of recent messages to include */
  recentMessageLimit: number;

  /** Maximum characters for memory content */
  memoryMaxChars: number;

  /** Maximum total tokens for context */
  tokenLimit: number;

  /** Path to system prompt file */
  systemPromptPath: string;
}

/**
 * Formatted context ready to be sent to LLM
 */
export interface FormattedContext {
  /** System message content */
  systemMessage: string;

  /** User message content (includes context) */
  userMessage: string;

  /** Estimated total tokens */
  estimatedTokens: number;
}

/**
 * Interface for platform-specific message fetching
 * Implemented by each platform adapter
 */
export interface MessageFetcher {
  /**
   * Fetch recent messages from a channel
   */
  fetchRecentMessages(
    channelId: string,
    limit: number,
  ): Promise<PlatformMessage[]>;

  /**
   * Search for related messages (optional)
   * Returns messages related to the given query from the same guild
   */
  searchRelatedMessages?(
    guildId: string,
    channelId: string,
    query: string,
    limit: number,
  ): Promise<PlatformMessage[]>;

  /**
   * Fetch available custom emojis (optional)
   */
  fetchEmojis?(): Promise<PlatformEmoji[]>;
}
