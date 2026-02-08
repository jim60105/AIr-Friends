// src/core/context-assembler.ts

import { createLogger } from "@utils/logger.ts";
import { combinedTokenCount, estimateTokens } from "@utils/token-counter.ts";
import { MemoryStore } from "./memory-store.ts";
import { loadSystemPrompt } from "./config-loader.ts";
import type {
  AssembledContext,
  ContextAssemblyConfig,
  FormattedContext,
  MessageFetcher,
} from "../types/context.ts";
import type { WorkspaceInfo } from "../types/workspace.ts";
import type { NormalizedEvent, PlatformMessage } from "../types/events.ts";
import type { ResolvedMemory } from "../types/memory.ts";

const logger = createLogger("ContextAssembler");

export class ContextAssembler {
  private readonly memoryStore: MemoryStore;
  private readonly config: ContextAssemblyConfig;
  private systemPromptCache: string | null = null;

  constructor(memoryStore: MemoryStore, config: ContextAssemblyConfig) {
    this.memoryStore = memoryStore;
    this.config = config;
  }

  /**
   * Load and cache system prompt
   */
  private async getSystemPrompt(): Promise<string> {
    if (this.systemPromptCache === null) {
      this.systemPromptCache = await loadSystemPrompt(this.config.systemPromptPath);
      logger.debug("System prompt loaded", {
        path: this.config.systemPromptPath,
        length: this.systemPromptCache.length,
      });
    }
    return this.systemPromptCache;
  }

  /**
   * Assemble initial context for an Agent session
   */
  async assembleContext(
    event: NormalizedEvent,
    workspace: WorkspaceInfo,
    messageFetcher: MessageFetcher,
  ): Promise<AssembledContext> {
    logger.info("Assembling context", {
      workspaceKey: workspace.key,
      channelId: event.channelId,
    });

    // Load system prompt
    const systemPrompt = await this.getSystemPrompt();

    // Get important memories
    const importantMemories = await this.memoryStore.getImportantMemories(workspace);
    logger.debug("Loaded important memories", { count: importantMemories.length });

    // Fetch recent messages
    const rawRecentMessages = await messageFetcher.fetchRecentMessages(
      event.channelId,
      this.config.recentMessageLimit,
    );
    logger.debug("Fetched recent messages", { count: rawRecentMessages.length });

    // Apply /clear command: drop everything before (and including) the last /clear message
    const recentMessages = this.applyClearCommand(rawRecentMessages);
    if (recentMessages.length !== rawRecentMessages.length) {
      logger.info("Applied /clear command to recent messages", {
        originalCount: rawRecentMessages.length,
        filteredCount: recentMessages.length,
      });
    }

    // Fetch related messages if available and in guild context
    let relatedMessages: PlatformMessage[] | undefined;
    if (
      event.guildId &&
      !event.isDm &&
      messageFetcher.searchRelatedMessages
    ) {
      try {
        // Use trigger message content as search query
        relatedMessages = await messageFetcher.searchRelatedMessages(
          event.guildId,
          event.channelId,
          event.content,
          10, // Limit related messages
        );
        logger.debug("Fetched related messages", {
          count: relatedMessages?.length ?? 0,
        });
      } catch (error) {
        logger.warn("Failed to fetch related messages", {
          error: String(error),
        });
      }
    }

    // Create trigger message from event
    const triggerMessage: PlatformMessage = {
      messageId: event.messageId,
      userId: event.userId,
      username: event.userId, // Will be enriched by platform adapter
      content: event.content,
      timestamp: event.timestamp,
      isBot: false,
    };

    // Estimate token count
    const estimatedTokens = this.calculateTokenEstimate(
      systemPrompt,
      importantMemories,
      recentMessages,
      relatedMessages,
      triggerMessage,
    );

    const context: AssembledContext = {
      importantMemories,
      recentMessages,
      relatedMessages,
      systemPrompt,
      triggerMessage,
      estimatedTokens,
      assembledAt: new Date(),
    };

    logger.info("Context assembled", {
      workspaceKey: workspace.key,
      memoriesCount: importantMemories.length,
      recentMessagesCount: recentMessages.length,
      relatedMessagesCount: relatedMessages?.length ?? 0,
      estimatedTokens,
    });

    return context;
  }

  /**
   * Calculate estimated token count for the context
   */
  private calculateTokenEstimate(
    systemPrompt: string,
    memories: ResolvedMemory[],
    recentMessages: PlatformMessage[],
    relatedMessages: PlatformMessage[] | undefined,
    triggerMessage: PlatformMessage,
  ): number {
    const memoriesText = memories.map((m) => m.content).join("\n");
    const recentText = recentMessages
      .map((m) => `${m.username}: ${m.content}`)
      .join("\n");
    const relatedText = relatedMessages
      ?.map((m) => `${m.username}: ${m.content}`)
      .join("\n") ?? "";
    const triggerText = `${triggerMessage.username}: ${triggerMessage.content}`;

    return combinedTokenCount(
      systemPrompt,
      memoriesText,
      recentText,
      relatedText,
      triggerText,
    );
  }

  /**
   * Format context for LLM consumption
   */
  formatContext(context: AssembledContext): FormattedContext {
    const availableTokens = this.config.tokenLimit - estimateTokens(context.systemPrompt);

    // Format memories section (always include all important memories)
    const memoriesSection = context.importantMemories.length > 0
      ? this.formatMemoriesSection(context.importantMemories)
      : "";

    // Calculate trigger message section
    const triggerSection = this.formatTriggerSection(context.triggerMessage);

    // Calculate tokens used by fixed sections
    const fixedTokens = estimateTokens(memoriesSection) + estimateTokens(triggerSection);
    const conversationTokenBudget = availableTokens - fixedTokens;

    // Format conversation with smart truncation (removes oldest messages if needed)
    const conversationSection = this.formatConversationSectionWithBudget(
      context.recentMessages,
      context.relatedMessages,
      conversationTokenBudget,
    );

    // Build user message with context
    const userMessage = this.buildUserMessage(
      memoriesSection,
      conversationSection,
      context.triggerMessage,
    );

    const estimatedTokens = combinedTokenCount(
      context.systemPrompt,
      userMessage,
    );

    return {
      systemMessage: context.systemPrompt,
      userMessage,
      estimatedTokens,
    };
  }

  /**
   * Format memories into a readable section
   */
  private formatMemoriesSection(memories: ResolvedMemory[]): string {
    const lines = [
      "## Important Memories",
      "",
      ...memories.map((m, i) => `${i + 1}. ${m.content}`),
      "",
    ];
    return lines.join("\n");
  }

  /**
   * Format conversation history section
   */
  private formatConversationSection(
    recentMessages: PlatformMessage[],
    relatedMessages?: PlatformMessage[],
  ): string {
    const lines: string[] = [];

    // Add recent messages
    if (recentMessages.length > 0) {
      lines.push("## Recent Conversation");
      lines.push("");
      for (const msg of recentMessages) {
        const prefix = msg.isBot ? "[Bot]" : "[User]";
        lines.push(`${prefix} ${msg.username}: ${msg.content}`);
      }
      lines.push("");
    }

    // Add related messages if present
    if (relatedMessages && relatedMessages.length > 0) {
      lines.push("## Related Messages from this Server");
      lines.push("");
      for (const msg of relatedMessages) {
        const prefix = msg.isBot ? "[Bot]" : "[User]";
        lines.push(`${prefix} ${msg.username}: ${msg.content}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Format conversation history section with token budget
   * Intelligently removes oldest messages if budget is exceeded
   */
  private formatConversationSectionWithBudget(
    recentMessages: PlatformMessage[],
    relatedMessages: PlatformMessage[] | undefined,
    tokenBudget: number,
  ): string {
    // If budget is negative or zero, skip conversation history
    if (tokenBudget <= 0) {
      logger.warn("No token budget for conversation history");
      return "";
    }

    // Format all messages first
    const formattedRecent: string[] = [];
    const recentTokens: number[] = [];

    for (const msg of recentMessages) {
      const prefix = msg.isBot ? "[Bot]" : "[User]";
      const line = `${prefix} ${msg.username}: ${msg.content}`;
      formattedRecent.push(line);
      recentTokens.push(estimateTokens(line));
    }

    const formattedRelated: string[] = [];
    const relatedTokens: number[] = [];

    if (relatedMessages) {
      for (const msg of relatedMessages) {
        const prefix = msg.isBot ? "[Bot]" : "[User]";
        const line = `${prefix} ${msg.username}: ${msg.content}`;
        formattedRelated.push(line);
        relatedTokens.push(estimateTokens(line));
      }
    }

    // Calculate header tokens
    const recentHeaderTokens = estimateTokens("## Recent Conversation\n\n");
    const relatedHeaderTokens = relatedMessages && relatedMessages.length > 0
      ? estimateTokens("## Related Messages from this Server\n\n")
      : 0;

    // Calculate total tokens needed
    const totalRecentTokens = recentTokens.reduce((sum, t) => sum + t, 0) + recentHeaderTokens;
    const totalRelatedTokens = relatedTokens.reduce((sum, t) => sum + t, 0) + relatedHeaderTokens;
    const totalTokens = totalRecentTokens + totalRelatedTokens;

    // If everything fits, return full conversation
    if (totalTokens <= tokenBudget) {
      return this.formatConversationSection(recentMessages, relatedMessages);
    }

    // Need to truncate - prioritize recent messages over related
    const lines: string[] = [];

    // Try to fit as many recent messages as possible (from oldest to newest)
    if (formattedRecent.length > 0) {
      lines.push("## Recent Conversation");
      lines.push("");

      let usedTokens = recentHeaderTokens;
      const includedMessages: string[] = [];

      // Always try to include at least the most recent message
      if (recentTokens.length > 0) {
        const lastMsgTokens = recentTokens[recentTokens.length - 1];
        if (usedTokens + lastMsgTokens <= tokenBudget) {
          // Work backwards from the newest message
          for (let i = recentTokens.length - 1; i >= 0; i--) {
            if (usedTokens + recentTokens[i] <= tokenBudget) {
              includedMessages.unshift(formattedRecent[i]);
              usedTokens += recentTokens[i];
            } else {
              break;
            }
          }
        }
      }

      if (includedMessages.length < formattedRecent.length) {
        logger.info("Truncated recent messages to fit token budget", {
          original: formattedRecent.length,
          included: includedMessages.length,
          tokenBudget,
          tokensUsed: usedTokens,
        });
      }

      lines.push(...includedMessages);
      lines.push("");

      // Try to fit related messages with remaining budget
      const remainingBudget = tokenBudget - usedTokens;
      if (formattedRelated.length > 0 && remainingBudget > relatedHeaderTokens) {
        lines.push("## Related Messages from this Server");
        lines.push("");

        let relatedUsed = relatedHeaderTokens;
        const includedRelated: string[] = [];

        for (let i = relatedTokens.length - 1; i >= 0; i--) {
          if (relatedUsed + relatedTokens[i] <= remainingBudget) {
            includedRelated.unshift(formattedRelated[i]);
            relatedUsed += relatedTokens[i];
          } else {
            break;
          }
        }

        if (includedRelated.length > 0) {
          lines.push(...includedRelated);
          lines.push("");
        } else {
          // Remove header if no messages fit
          lines.pop();
          lines.pop();
        }

        if (includedRelated.length < formattedRelated.length) {
          logger.info("Truncated related messages to fit token budget", {
            original: formattedRelated.length,
            included: includedRelated.length,
            remainingBudget,
            tokensUsed: relatedUsed,
          });
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Format trigger message section
   */
  private formatTriggerSection(triggerMessage: PlatformMessage): string {
    return `## Current Message\n\n${triggerMessage.username}: ${triggerMessage.content}\n`;
  }

  /**
   * Build the complete user message
   */
  private buildUserMessage(
    memoriesSection: string,
    conversationSection: string,
    triggerMessage: PlatformMessage,
  ): string {
    const parts: string[] = [];

    if (memoriesSection) {
      parts.push(memoriesSection);
    }

    if (conversationSection) {
      parts.push(conversationSection);
    }

    // Add current message
    parts.push("## Current Message");
    parts.push("");
    parts.push(`${triggerMessage.username}: ${triggerMessage.content}`);
    parts.push("");

    return parts.join("\n");
  }

  /**
   * Invalidate system prompt cache (for hot reload)
   */
  invalidateSystemPromptCache(): void {
    this.systemPromptCache = null;
  }

  /**
   * Apply /clear command to recent messages.
   *
   * If any message content starts with "/clear", drop that message and
   * everything before it. When multiple /clear messages exist, the last
   * one wins. This allows users to reset context within the same channel.
   */
  applyClearCommand(messages: PlatformMessage[]): PlatformMessage[] {
    // Find the index of the last message starting with "/clear"
    let lastClearIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].content.trimStart().startsWith("/clear")) {
        lastClearIndex = i;
        break;
      }
    }

    // No /clear found — return all messages unchanged
    if (lastClearIndex === -1) {
      return messages;
    }

    // Return only messages after the /clear message
    return messages.slice(lastClearIndex + 1);
  }
}
