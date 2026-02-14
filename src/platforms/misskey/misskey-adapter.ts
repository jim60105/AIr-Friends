// src/platforms/misskey/misskey-adapter.ts

import { ChannelConnection, type Channels } from "misskey-js";
import { createLogger } from "@utils/logger.ts";
import { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { Platform, PlatformMessage } from "../../types/events.ts";
import {
  ConnectionState,
  PlatformCapabilities,
  type PlatformEmoji,
  type ReactionResult,
  type ReplyOptions,
  type ReplyResult,
} from "../../types/platform.ts";
import { ErrorCode, PlatformError } from "../../types/errors.ts";
import { MisskeyClient } from "./misskey-client.ts";
import {
  DEFAULT_MISSKEY_CONFIG,
  MISSKEY_STREAMING_CHANNELS,
  MisskeyAdapterConfig,
} from "./misskey-config.ts";
import {
  buildReplyParams,
  ChatMessageLite,
  chatMessageToPlatformMessage,
  MisskeyMessage,
  MisskeyNote,
  normalizeMisskeyChatMessage,
  normalizeMisskeyNote,
  noteToPlatformMessage,
  removeBotMention,
  shouldRespondToChatMessage,
  shouldRespondToNote,
} from "./misskey-utils.ts";

const logger = createLogger("MisskeyAdapter");

export class MisskeyAdapter extends PlatformAdapter {
  readonly platform: Platform = "misskey";
  readonly capabilities: PlatformCapabilities = {
    canFetchHistory: true,
    canSearchMessages: true,
    supportsDm: true,
    supportsGuild: false,
    supportsReactions: true,
    maxMessageLength: 3000,
  };

  private readonly client: MisskeyClient;
  private readonly config: Required<MisskeyAdapterConfig>;
  private botId: string | null = null;
  private botUsername: string | null = null;
  private mainChannel: ChannelConnection<Channels["main"]> | null = null;
  private reconnectAttempts = 0;
  private emojiCache: PlatformEmoji[] | null = null;
  private emojiCacheTimestamp = 0;
  private readonly EMOJI_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: MisskeyAdapterConfig) {
    super();

    this.config = {
      ...DEFAULT_MISSKEY_CONFIG,
      ...config,
    } as Required<MisskeyAdapterConfig>;

    this.client = new MisskeyClient(this.config);
  }

  /**
   * Connect to Misskey
   */
  async connect(): Promise<void> {
    logger.info("Connecting to Misskey", { host: this.config.host });
    this.updateConnectionState(ConnectionState.CONNECTING);

    try {
      // Get bot info
      const self = await this.client.getSelf();
      this.botId = self.id;
      this.botUsername = self.username;

      // Connect to streaming API
      const stream = this.client.connectStream();

      // Subscribe to main channel for mentions and DMs
      this.mainChannel = stream.useChannel(MISSKEY_STREAMING_CHANNELS.MAIN);

      // Set up event handlers
      this.mainChannel.on("mention", (note: MisskeyNote) => {
        this.handleNote(note, false);
      });

      this.mainChannel.on("newChatMessage", (message: MisskeyMessage) => {
        this.handleChatMessage(message);
      });

      // Handle stream events
      stream.on("_connected_", () => {
        this.reconnectAttempts = 0;
        this.updateConnectionState(ConnectionState.CONNECTED);
        logger.info("Connected to Misskey streaming API", {
          host: this.config.host,
          botUsername: this.botUsername,
        });
      });

      stream.on("_disconnected_", () => {
        logger.warn("Disconnected from Misskey streaming API");
        this.updateConnectionState(ConnectionState.DISCONNECTED);
        this.handleReconnect();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateConnectionState(ConnectionState.ERROR, message);

      throw new PlatformError(
        ErrorCode.PLATFORM_AUTH_FAILED,
        `Failed to connect to Misskey: ${message}`,
        { platform: this.platform, host: this.config.host },
      );
    }
  }

  /**
   * Handle incoming note
   */
  private async handleNote(note: MisskeyNote, isDm: boolean): Promise<void> {
    if (!this.botId || !this.botUsername) {
      logger.warn("Received note before bot info was set");
      return;
    }

    // Check if we should respond
    if (
      !shouldRespondToNote(note, this.botId, this.botUsername, {
        allowDm: this.config.allowDm,
        respondToMention: this.config.respondToMention,
      })
    ) {
      return;
    }

    logger.debug("Processing note", {
      noteId: note.id,
      isDm,
      visibility: note.visibility,
    });

    // Normalize event
    const normalizedEvent = normalizeMisskeyNote(note, this.botId, isDm);

    // Clean up content (remove bot mention if present)
    normalizedEvent.content = removeBotMention(
      normalizedEvent.content,
      this.botUsername,
    );

    await this.emitEvent(normalizedEvent);
  }

  /**
   * Handle incoming chat message
   */
  private async handleChatMessage(message: MisskeyMessage): Promise<void> {
    if (!this.botId) {
      logger.warn("Received chat message before bot info was set");
      return;
    }

    // Check if we should respond
    if (
      !shouldRespondToChatMessage(message, this.botId, {
        allowDm: this.config.allowDm,
      })
    ) {
      return;
    }

    logger.debug("Processing chat message", {
      messageId: message.id,
      fromUserId: message.fromUserId,
    });

    // Normalize event
    const normalizedEvent = normalizeMisskeyChatMessage(message, this.botId);

    await this.emitEvent(normalizedEvent);
  }

  /**
   * Handle reconnection
   */
  private handleReconnect(): void {
    if (!this.config.reconnect.enabled) {
      return;
    }

    if (this.reconnectAttempts >= (this.config.reconnect.maxAttempts ?? 5)) {
      logger.error("Max reconnect attempts reached");
      this.updateConnectionState(
        ConnectionState.ERROR,
        "Max reconnect attempts reached",
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = (this.config.reconnect.baseDelay ?? 1000) *
      Math.pow(2, this.reconnectAttempts - 1);

    logger.info("Scheduling reconnect in {delay}ms (attempt {attempt})", {
      attempt: this.reconnectAttempts,
      delay,
    });

    this.updateConnectionState(ConnectionState.RECONNECTING);

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error("Reconnect failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.handleReconnect();
      }
    }, delay);
  }

  /**
   * Disconnect from Misskey
   */
  disconnect(): Promise<void> {
    logger.info("Disconnecting from Misskey");

    if (this.mainChannel) {
      this.mainChannel.dispose();
      this.mainChannel = null;
    }

    this.client.disconnectStream();
    this.updateConnectionState(ConnectionState.DISCONNECTED);

    return Promise.resolve();
  }

  /**
   * Send a reply (create a note or chat message based on channel type)
   */
  async sendReply(
    channelId: string,
    content: string,
    options?: ReplyOptions,
  ): Promise<ReplyResult> {
    try {
      // Truncate content if necessary
      const maxLength = channelId.startsWith("chat:")
        ? 2000 // Chat messages have 2000 char limit
        : this.capabilities.maxMessageLength;
      const truncatedContent = content.length > maxLength
        ? content.slice(0, maxLength - 3) + "..."
        : content;

      // Handle spontaneous post to bot's own timeline
      if (channelId === "timeline:self") {
        const result = await this.client.request<{ createdNote: MisskeyNote }>(
          "notes/create",
          { text: truncatedContent },
        );

        logger.debug("Spontaneous note posted", {
          noteId: result.createdNote.id,
        });

        return {
          success: true,
          messageId: result.createdNote.id,
        };
      }

      // Handle chat messages
      if (channelId.startsWith("chat:")) {
        return await this.sendChatMessage(channelId, truncatedContent);
      }

      // Handle notes
      const params: Record<string, unknown> = {
        text: truncatedContent,
      };

      // If replying to a specific note, set visibility appropriately
      if (options?.replyToMessageId) {
        params.replyId = options.replyToMessageId;

        // Get original note to determine visibility
        const originalNote = await this.client.request<MisskeyNote>(
          "notes/show",
          { noteId: options.replyToMessageId },
        );

        const replyParams = buildReplyParams(originalNote);
        Object.assign(params, replyParams);
      }

      const createdNote = await this.client.request<
        { createdNote: MisskeyNote }
      >(
        "notes/create",
        params,
      );

      logger.debug("Reply sent", {
        noteId: createdNote.createdNote.id,
        contentLength: content.length,
      });

      return {
        success: true,
        messageId: createdNote.createdNote.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error("Failed to send reply", {
        channelId,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send a chat message to a user
   */
  private async sendChatMessage(
    channelId: string,
    content: string,
  ): Promise<ReplyResult> {
    const userId = channelId.slice(5); // Remove "chat:" prefix

    try {
      const result = await this.client.request<ChatMessageLite>(
        "chat/messages/create-to-user",
        {
          toUserId: userId,
          text: content,
        },
      );

      logger.debug("Chat message sent", {
        messageId: result.id,
        toUserId: userId,
        contentLength: content.length,
      });

      return {
        success: true,
        messageId: result.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error("Failed to send chat message", {
        userId,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch recent messages (for context)
   * Supports notes, DMs, and chat messages
   */
  async fetchRecentMessages(
    channelId: string,
    limit: number,
  ): Promise<PlatformMessage[]> {
    try {
      // For timeline:self, fetch the bot's own recent notes
      if (channelId === "timeline:self") {
        if (!this.botId) return [];

        const notes = await this.client.request<MisskeyNote[]>(
          "users/notes",
          {
            userId: this.botId,
            limit,
            includeReplies: false,
          },
        );

        return notes.map((note) => noteToPlatformMessage(note, this.botId!));
      }

      // For chat:userId, fetch chat message timeline with that user
      if (channelId.startsWith("chat:")) {
        const userId = channelId.slice(5);
        const messages = await this.client.request<ChatMessageLite[]>(
          "chat/messages/user-timeline",
          { userId, limit },
        );

        return messages.map((msg) => chatMessageToPlatformMessage(msg, this.botId!));
      }

      // If channelId starts with "dm:", fetch DM history via notes
      if (channelId.startsWith("dm:")) {
        const userId = channelId.slice(3);
        const messages = await this.client.request<MisskeyNote[]>(
          "notes/mentions",
          { limit },
        );

        // Filter to only include messages from/to this user
        const filtered = messages.filter(
          (note) => note.userId === userId || note.replyId,
        );

        return filtered.map((note) => noteToPlatformMessage(note, this.botId!));
      }

      // For note:xxx, fetch the full conversation thread (ancestors + current + replies)
      if (channelId.startsWith("note:")) {
        const noteId = channelId.slice(5);

        // Fetch the current note first — notes/show is available on all forks
        const currentNote = await this.client.request<MisskeyNote>(
          "notes/show",
          { noteId },
        );

        // Fetch replies with fallback chain for fork compatibility:
        // notes/children (broader, available on most forks) → notes/replies → empty
        const replies = await this.fetchRepliesWithFallback(noteId, limit);

        // Fetch ancestor notes with fallback chain for fork compatibility:
        // notes/conversation (single call) → replyId chain walk via notes/show
        const ancestors = await this.fetchAncestorsWithFallback(currentNote, limit);

        const allNotes = [...ancestors, currentNote, ...replies];

        // Deduplicate by note ID and sort chronologically, then apply limit
        const seen = new Set<string>();
        const unique = allNotes.filter((note) => {
          if (seen.has(note.id)) return false;
          seen.add(note.id);
          return true;
        });
        unique.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        logger.debug("Note thread assembled", {
          noteId,
          ancestorsCount: ancestors.length,
          repliesCount: replies.length,
          totalUnique: unique.length,
        });

        return unique.slice(-limit).map((note) => noteToPlatformMessage(note, this.botId!));
      }

      return [];
    } catch (error) {
      throw new PlatformError(
        ErrorCode.PLATFORM_API_ERROR,
        `Failed to fetch messages: ${error instanceof Error ? error.message : String(error)}`,
        { channelId },
      );
    }
  }

  /**
   * Fetch replies to a note with fallback chain for fork compatibility.
   * Tries notes/children first (available on most forks), then notes/replies,
   * and falls back to an empty array if neither endpoint exists.
   */
  private async fetchRepliesWithFallback(
    noteId: string,
    limit: number,
  ): Promise<MisskeyNote[]> {
    // Try notes/children first (broader — includes replies + quote renotes)
    try {
      return await this.client.request<MisskeyNote[]>(
        "notes/children",
        { noteId, limit },
      );
    } catch {
      logger.debug("notes/children endpoint unavailable, trying notes/replies", { noteId });
    }

    // Fallback to notes/replies
    try {
      return await this.client.request<MisskeyNote[]>(
        "notes/replies",
        { noteId, limit },
      );
    } catch {
      logger.debug("notes/replies endpoint unavailable, skipping replies fetch", { noteId });
    }

    // Both endpoints failed — return empty array
    return [];
  }

  /**
   * Fetch ancestor notes with fallback chain for fork compatibility.
   * Tries notes/conversation first (single API call), then falls back to
   * walking the replyId chain via repeated notes/show calls.
   */
  private async fetchAncestorsWithFallback(
    currentNote: MisskeyNote,
    limit: number,
  ): Promise<MisskeyNote[]> {
    if (!currentNote.replyId) return [];

    // Try notes/conversation first (returns ancestors in one call)
    try {
      const ancestors = await this.client.request<MisskeyNote[]>(
        "notes/conversation",
        { noteId: currentNote.id, limit },
      );
      logger.debug("Fetched ancestors via notes/conversation", {
        noteId: currentNote.id,
        count: ancestors.length,
      });
      return ancestors;
    } catch {
      logger.debug("notes/conversation endpoint unavailable, falling back to replyId chain walk", {
        noteId: currentNote.id,
      });
    }

    // Fallback: walk the replyId chain via notes/show
    const ancestors: MisskeyNote[] = [];
    let cursorReplyId: string | null | undefined = currentNote.replyId;
    while (cursorReplyId && ancestors.length < limit) {
      try {
        const parent: MisskeyNote = await this.client.request<MisskeyNote>(
          "notes/show",
          { noteId: cursorReplyId },
        );
        ancestors.unshift(parent);
        cursorReplyId = parent.replyId;
      } catch (error) {
        logger.warn("Ancestor fetch stopped: failed to fetch parent note", {
          noteId: cursorReplyId,
          error: error instanceof Error ? error.message : String(error),
          ancestorsFetched: ancestors.length,
        });
        break;
      }
    }

    logger.debug("Fetched ancestors via replyId chain walk", {
      noteId: currentNote.id,
      count: ancestors.length,
    });
    return ancestors;
  }

  /**
   * Search notes by keyword
   */
  override async searchRelatedMessages(
    _guildId: string,
    _channelId: string,
    query: string,
    limit: number,
  ): Promise<PlatformMessage[]> {
    try {
      const notes = await this.client.request<MisskeyNote[]>(
        "notes/search",
        { query, limit },
      );

      return notes.map((note) => noteToPlatformMessage(note, this.botId!));
    } catch (error) {
      logger.warn("Failed to search notes", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Fetch available custom emojis from the Misskey instance
   * Uses the public /emojis endpoint
   */
  async fetchEmojis(): Promise<PlatformEmoji[]> {
    const now = Date.now();
    if (this.emojiCache && (now - this.emojiCacheTimestamp) < this.EMOJI_CACHE_TTL_MS) {
      return this.emojiCache;
    }

    try {
      const response = await this.client.request<{
        emojis: Array<{
          name: string;
          category: string | null;
          aliases: string[];
          url: string;
        }>;
      }>("emojis", {});

      const emojis: PlatformEmoji[] = response.emojis.map((e) => ({
        name: e.name,
        animated: false, // Misskey doesn't distinguish animated in this API
        category: e.category,
        useInText: `:${e.name}:`,
        useAsReaction: `:${e.name}:`,
      }));

      this.emojiCache = emojis;
      this.emojiCacheTimestamp = now;

      logger.debug("Fetched Misskey emojis", { count: emojis.length });
      return emojis;
    } catch (error) {
      logger.error("Failed to fetch Misskey emojis", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.emojiCache ?? [];
    }
  }

  /**
   * Add a reaction to a Misskey note
   * @param emoji - Misskey emoji format: ":custom_emoji:" or Unicode character (e.g., "❤️")
   * Note: channelId for Misskey uses "note:xxx" format; this method extracts the note ID.
   * However, messageId is used directly as it is the actual note ID.
   */
  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<ReactionResult> {
    // Chat messages don't support reactions
    if (channelId.startsWith("chat:")) {
      return {
        success: false,
        error: "Reactions are not supported for chat messages",
      };
    }

    try {
      await this.client.request("notes/reactions/create", {
        noteId: messageId,
        reaction: emoji,
      });

      logger.debug("Reaction added", { noteId: messageId, emoji });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to add reaction", {
        noteId: messageId,
        emoji,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get username for a user ID
   */
  async getUsername(userId: string): Promise<string> {
    try {
      const user = await this.client.request<
        { username: string; name: string | null }
      >(
        "users/show",
        { userId },
      );
      return user.name ?? user.username;
    } catch {
      return userId;
    }
  }

  /**
   * Edit an existing message (note or chat message)
   * Misskey has no edit API — uses delete-and-recreate strategy
   */
  async editMessage(
    channelId: string,
    messageId: string,
    newContent: string,
    replyToMessageId?: string,
  ): Promise<ReplyResult> {
    const maxLength = channelId.startsWith("chat:") ? 2000 : this.capabilities.maxMessageLength;
    const truncatedContent = newContent.length > maxLength
      ? newContent.slice(0, maxLength - 3) + "..."
      : newContent;

    if (channelId.startsWith("chat:")) {
      return await this.editChatMessage(channelId, messageId, truncatedContent);
    }
    return await this.editNote(messageId, truncatedContent, replyToMessageId);
  }

  private async editNote(
    noteId: string,
    newContent: string,
    replyToMessageId?: string,
  ): Promise<ReplyResult> {
    try {
      // Step 1: Fetch old note to preserve visibility
      let visibility: "public" | "home" | "followers" | "specified" = "public";
      let visibleUserIds: string[] | undefined;

      try {
        const oldNote = await this.client.request<MisskeyNote>(
          "notes/show",
          { noteId },
        );
        visibility = oldNote.visibility;
        if (oldNote.visibility === "specified" && oldNote.visibleUserIds) {
          visibleUserIds = oldNote.visibleUserIds;
        }
      } catch {
        logger.warn("Could not fetch original note for visibility, using default", { noteId });
      }

      // Step 2: Delete old note
      await this.client.request("notes/delete", { noteId });
      logger.debug("Old note deleted for edit", { noteId });

      // Step 3: Create new note, replying to the original trigger note
      const createParams: Record<string, unknown> = {
        text: newContent,
        visibility,
      };

      if (visibleUserIds) {
        createParams.visibleUserIds = visibleUserIds;
      }

      // If replyToMessageId is provided, set reply target to the original trigger note
      if (replyToMessageId) {
        createParams.replyId = replyToMessageId;

        try {
          const originalNote = await this.client.request<MisskeyNote>(
            "notes/show",
            { noteId: replyToMessageId },
          );
          const replyParams = buildReplyParams(originalNote);
          Object.assign(createParams, replyParams);
        } catch {
          logger.warn("Could not fetch original trigger note for reply params", {
            replyToMessageId,
          });
        }
      }

      const result = await this.client.request<{ createdNote: MisskeyNote }>(
        "notes/create",
        createParams,
      );

      logger.debug("Note recreated for edit", {
        oldNoteId: noteId,
        newNoteId: result.createdNote.id,
        contentLength: newContent.length,
      });

      return { success: true, messageId: result.createdNote.id };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : (typeof error === "object" && error !== null && "message" in error)
        ? String((error as Record<string, unknown>).message)
        : JSON.stringify(error);
      logger.error("Failed to edit note", { noteId, error: errorMessage });
      return { success: false, error: `Failed to edit note: ${errorMessage}` };
    }
  }

  private async editChatMessage(
    channelId: string,
    messageId: string,
    newContent: string,
  ): Promise<ReplyResult> {
    try {
      const userId = channelId.slice(5); // Remove "chat:" prefix

      // Step 1: Delete old message
      await this.client.request("chat/messages/delete", { messageId });
      logger.debug("Old chat message deleted for edit", { messageId });

      // Step 2: Recreate message
      const result = await this.client.request<ChatMessageLite>(
        "chat/messages/create-to-user",
        {
          toUserId: userId,
          text: newContent,
        },
      );

      logger.debug("Chat message recreated for edit", {
        oldMessageId: messageId,
        newMessageId: result.id,
        contentLength: newContent.length,
      });

      return { success: true, messageId: result.id };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : (typeof error === "object" && error !== null && "message" in error)
        ? String((error as Record<string, unknown>).message)
        : JSON.stringify(error);
      logger.error("Failed to edit chat message", { messageId, error: errorMessage });
      return { success: false, error: `Failed to edit chat message: ${errorMessage}` };
    }
  }

  /**
   * Check if a user ID is the bot itself
   */
  isSelf(userId: string): boolean {
    return userId === this.botId;
  }

  /**
   * Get the bot user ID
   */
  getBotId(): string | null {
    return this.botId;
  }

  /**
   * Get the bot username
   */
  getBotUsername(): string | null {
    return this.botUsername;
  }
}
