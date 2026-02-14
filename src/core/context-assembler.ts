// src/core/context-assembler.ts

import { createLogger } from "@utils/logger.ts";
import { combinedTokenCount, estimateTokens } from "@utils/token-counter.ts";
import { MemoryStore } from "./memory-store.ts";
import { loadSystemPrompt } from "./config-loader.ts";
import type {
  AssembledContext,
  AssembledSpontaneousContext,
  ContextAssemblyConfig,
  FormattedContext,
  MessageFetcher,
} from "../types/context.ts";
import type { WorkspaceInfo } from "../types/workspace.ts";
import type { NormalizedEvent, Platform, PlatformMessage } from "../types/events.ts";
import type { ResolvedMemory } from "../types/memory.ts";
import type { PlatformEmoji } from "../types/platform.ts";

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

    // Fetch available emojis
    let availableEmojis: PlatformEmoji[] | undefined;
    if (messageFetcher.fetchEmojis) {
      try {
        const emojis = await messageFetcher.fetchEmojis();
        if (emojis.length > 0) {
          availableEmojis = emojis;
          logger.debug("Fetched available emojis", { count: emojis.length });
        }
      } catch (error) {
        logger.warn("Failed to fetch emojis", {
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
      attachments: event.attachments,
    };

    // Estimate token count
    const estimatedTokens = this.calculateTokenEstimate(
      systemPrompt,
      importantMemories,
      recentMessages,
      relatedMessages,
      triggerMessage,
      availableEmojis,
    );

    const context: AssembledContext = {
      importantMemories,
      recentMessages,
      relatedMessages,
      systemPrompt,
      triggerMessage,
      estimatedTokens,
      availableEmojis,
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
    emojis?: PlatformEmoji[],
  ): number {
    const memoriesText = memories.map((m) => m.content).join("\n");
    const recentText = recentMessages
      .map((m) => `${m.username}: ${m.content}`)
      .join("\n");
    const relatedText = relatedMessages
      ?.map((m) => `${m.username}: ${m.content}`)
      .join("\n") ?? "";
    const triggerText = `${triggerMessage.username}: ${triggerMessage.content}`;
    const emojiText = emojis?.map((e) => e.name).join(", ") ?? "";

    return combinedTokenCount(
      systemPrompt,
      memoriesText,
      recentText,
      relatedText,
      triggerText,
      emojiText,
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

    // Calculate tokens used by mandatory sections (memories + trigger)
    const mandatoryTokens = estimateTokens(memoriesSection) + estimateTokens(triggerSection);
    const remainingAfterMandatory = availableTokens - mandatoryTokens;

    // Allocate conversation budget FIRST, then give remaining to emojis.
    // This prevents large emoji sections from starving conversation history.
    const conversationSection = this.formatConversationSectionWithBudget(
      context.recentMessages,
      context.relatedMessages,
      remainingAfterMandatory,
    );
    const conversationTokens = estimateTokens(conversationSection);

    // Emoji section gets whatever budget remains after conversation
    const emojiBudget = remainingAfterMandatory - conversationTokens;
    const emojiSection = context.availableEmojis && context.availableEmojis.length > 0 &&
        emojiBudget > 0
      ? this.formatEmojiSectionWithBudget(context.availableEmojis, emojiBudget)
      : "";

    // Build user message with context
    const userMessage = this.buildUserMessage(
      memoriesSection,
      conversationSection,
      emojiSection,
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
   * Format available emojis into a readable section for the agent.
   * Groups emojis by category if categories are available.
   * Limits the list to fit within a reasonable token budget.
   */
  private formatEmojiSection(emojis: PlatformEmoji[]): string {
    return this.formatEmojiSectionWithBudget(emojis, Infinity);
  }

  /**
   * Format emoji section with a token budget constraint.
   * Includes as many emojis as fit within the budget.
   */
  private formatEmojiSectionWithBudget(emojis: PlatformEmoji[], tokenBudget: number): string {
    const MAX_EMOJIS = 50;

    const header = [
      "## Available Custom Emojis",
      "",
      "You can use these custom emojis in your replies (embed in text) or as reactions. Format: <e> = emoji, <t> = text embed, <r> = reaction. Note that you should use the raw content inside those tags, they may be another <xml> tag or :text: format. Strictly use those emojis and never make up new ones that are not in this list. Any emoji not on the list cannot be used.",
      "",
    ];

    const headerTokens = estimateTokens(header.join("\n"));
    if (headerTokens >= tokenBudget) return "";

    // Group by category
    const grouped = new Map<string, PlatformEmoji[]>();
    for (const emoji of emojis) {
      const category = emoji.category ?? "Uncategorized";
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(emoji);
    }

    const lines = [...header];
    let usedTokens = headerTokens;
    let count = 0;

    for (const [category, categoryEmojis] of grouped) {
      if (count >= MAX_EMOJIS) break;

      const categoryHeader = `### ${category}`;
      const categoryHeaderTokens = estimateTokens(categoryHeader);
      if (usedTokens + categoryHeaderTokens > tokenBudget) break;

      lines.push(categoryHeader);
      usedTokens += categoryHeaderTokens;

      for (const emoji of categoryEmojis) {
        if (count >= MAX_EMOJIS) break;

        const line = `<e><t>${emoji.useInText}</t><r>${emoji.useAsReaction}</r></e>`;
        const lineTokens = estimateTokens(line);

        if (usedTokens + lineTokens > tokenBudget) break;

        lines.push(line);
        usedTokens += lineTokens;
        count++;
      }
      lines.push("");
    }

    if (count > 0 && isFinite(tokenBudget)) {
      logger.debug("Emoji section formatted with budget", {
        emojisIncluded: count,
        emojisTotal: emojis.length,
        tokensUsed: usedTokens,
        tokenBudget,
      });
    }

    return count > 0 ? lines.join("\n") : "";
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
        lines.push(this.formatMessageLine(msg));
      }
      lines.push("");
    }

    // Add related messages if present
    if (relatedMessages && relatedMessages.length > 0) {
      lines.push("## Related Messages from this Server");
      lines.push("");
      for (const msg of relatedMessages) {
        lines.push(this.formatMessageLine(msg));
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
      const line = this.formatMessageLine(msg);
      formattedRecent.push(line);
      recentTokens.push(estimateTokens(line));
    }

    const formattedRelated: string[] = [];
    const relatedTokens: number[] = [];

    if (relatedMessages) {
      for (const msg of relatedMessages) {
        const line = this.formatMessageLine(msg);
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
    let section = `## Current Message\n\n${triggerMessage.username}: ${triggerMessage.content}`;

    if (triggerMessage.attachments && triggerMessage.attachments.length > 0) {
      const attachmentDescs = triggerMessage.attachments.map((att) => {
        const sizeStr = att.size ? ` ${formatFileSize(att.size)}` : "";
        return `📎 ${att.filename} (${att.mimeType}${sizeStr}) ${att.url}`;
      });
      section += `\n  Attachments: ${attachmentDescs.join(" | ")}`;
    }

    return section + "\n";
  }

  /**
   * Build the complete user message
   */
  private buildUserMessage(
    memoriesSection: string,
    conversationSection: string,
    emojiSection: string,
    triggerMessage: PlatformMessage,
  ): string {
    const parts: string[] = [];

    if (memoriesSection) {
      parts.push(memoriesSection);
    }

    if (conversationSection) {
      parts.push(conversationSection);
    }

    if (emojiSection) {
      parts.push(emojiSection);
    }

    // Add current message
    parts.push("## Current Message");
    parts.push("");
    let triggerLine = `${triggerMessage.username}: ${triggerMessage.content}`;
    if (triggerMessage.attachments && triggerMessage.attachments.length > 0) {
      const attachmentDescs = triggerMessage.attachments.map((att) => {
        const sizeStr = att.size ? ` ${formatFileSize(att.size)}` : "";
        return `📎 ${att.filename} (${att.mimeType}${sizeStr}) ${att.url}`;
      });
      triggerLine += `\n  Attachments: ${attachmentDescs.join(" | ")}`;
    }
    parts.push(triggerLine);
    parts.push("");

    return parts.join("\n");
  }

  /**
   * Assemble context for a spontaneous post session.
   * Unlike assembleContext(), this does not have a trigger message.
   */
  async assembleSpontaneousContext(
    platform: Platform,
    channelId: string,
    workspace: WorkspaceInfo,
    messageFetcher: MessageFetcher,
    options: { fetchRecentMessages: boolean },
  ): Promise<AssembledSpontaneousContext> {
    logger.info("Assembling spontaneous context", {
      platform,
      channelId,
      fetchRecentMessages: options.fetchRecentMessages,
    });

    const systemPrompt = await this.getSystemPrompt();
    const importantMemories = await this.memoryStore.getImportantMemories(workspace);

    let recentMessages: PlatformMessage[] = [];
    if (options.fetchRecentMessages) {
      try {
        recentMessages = await messageFetcher.fetchRecentMessages(
          channelId,
          this.config.recentMessageLimit,
        );
      } catch (error) {
        logger.warn("Failed to fetch recent messages for spontaneous context", {
          platform,
          channelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let availableEmojis: PlatformEmoji[] | undefined;
    if (messageFetcher.fetchEmojis) {
      try {
        const emojis = await messageFetcher.fetchEmojis();
        if (emojis.length > 0) {
          availableEmojis = emojis;
        }
      } catch (error) {
        logger.warn("Failed to fetch emojis for spontaneous context", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const memoriesText = importantMemories.map((m) => m.content).join("\n");
    const recentText = recentMessages.map((m) => `${m.username}: ${m.content}`).join("\n");
    const emojiText = availableEmojis?.map((e) => e.name).join(", ") ?? "";
    const estimatedTokens = combinedTokenCount(systemPrompt, memoriesText, recentText, emojiText);

    return {
      systemPrompt,
      importantMemories,
      recentMessages,
      availableEmojis,
      recentMessagesFetched: options.fetchRecentMessages,
      estimatedTokens,
    };
  }

  /**
   * Format the assembled spontaneous context into system + user messages.
   */
  formatSpontaneousContext(context: AssembledSpontaneousContext): FormattedContext {
    const parts: string[] = [];

    if (context.importantMemories.length > 0) {
      parts.push(this.formatMemoriesSection(context.importantMemories));
    }

    if (context.recentMessages.length > 0) {
      parts.push(this.formatConversationSection(context.recentMessages));
    }

    if (context.availableEmojis && context.availableEmojis.length > 0) {
      parts.push(this.formatEmojiSection(context.availableEmojis));
    }

    parts.push(this.buildSpontaneousInstructions(context.recentMessagesFetched));

    const userMessage = parts.join("\n");
    const estimatedTokens = combinedTokenCount(context.systemPrompt, userMessage);

    return {
      systemMessage: context.systemPrompt,
      userMessage,
      estimatedTokens,
    };
  }

  /**
   * Build instructions specific to spontaneous post mode.
   */
  private buildSpontaneousInstructions(hasRecentMessages: boolean): string {
    const lines: string[] = [];

    lines.push("## Spontaneous Post Mode");
    lines.push("");
    lines.push("You are creating a spontaneous post. This is NOT a response to any user message.");
    lines.push("There is no current message to reply to or react to.");
    lines.push("");
    lines.push("Guidelines:");
    lines.push("- Create original content that fits your character and personality");
    lines.push(
      "- Use your creativity to craft a post that could spark new conversations or entertain readers",
    );
    lines.push(
      `- If you mention a specific event (for example, you saw an interesting project), make sure that the event actually exists (you are talking about a real project) and that you know enough about it to discuss it (you can draw on your previous knowledge to help you talk about this event). If you are not familiar with it, please state so when discussing it (for example, "I'm not too clear on the details but it seems interesting!"), rather than pretending to have in-depth knowledge.`,
    );
    lines.push("- Use the `send-reply` skill to post your content");
    lines.push("- Do NOT use the `react-message` skill (there is no message to react to)");
    lines.push("- Do NOT address or respond to any specific user");

    if (hasRecentMessages) {
      lines.push(
        "- You may reference recent conversation topics for inspiration, but do not reply to them directly",
      );
      lines.push(
        "- Feel free to draw on themes or ideas from recent messages, but your post should stand on its own and not be the same as any recent message",
      );
    } else {
      lines.push(
        "- Create something entirely original — share a thought, observation, or topic you find interesting",
      );
    }

    return lines.join("\n");
  }

  /**
   * Invalidate system prompt cache (for hot reload)
   */
  invalidateSystemPromptCache(): void {
    this.systemPromptCache = null;
  }

  /**
   * Format a single message line with optional attachment descriptions
   */
  private formatMessageLine(msg: PlatformMessage): string {
    const prefix = msg.isBot ? "[Bot]" : "[User]";
    let line = `${prefix} ${msg.username}: ${msg.content}`;

    if (msg.attachments && msg.attachments.length > 0) {
      const attachmentDescs = msg.attachments.map((att) => {
        const sizeStr = att.size ? ` ${formatFileSize(att.size)}` : "";
        return `📎 ${att.filename} (${att.mimeType}${sizeStr}) ${att.url}`;
      });
      line += `\n  Attachments: ${attachmentDescs.join(" | ")}`;
    }

    return line;
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

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
