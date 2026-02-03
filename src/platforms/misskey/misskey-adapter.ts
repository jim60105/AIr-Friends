// src/platforms/misskey/misskey-adapter.ts

import { Channel } from "misskey-js/api.js";
import { createLogger } from "@utils/logger.ts";
import { PlatformAdapter } from "@platforms/platform-adapter.ts";
import {
  Platform,
  NormalizedEvent,
  PlatformMessage,
} from "@types/events.ts";
import {
  PlatformCapabilities,
  ConnectionState,
  ReplyOptions,
  ReplyResult,
} from "@types/platform.ts";
import { PlatformError, ErrorCode } from "@types/errors.ts";
import { MisskeyClient } from "./misskey-client.ts";
import {
  MisskeyAdapterConfig,
  DEFAULT_MISSKEY_CONFIG,
  MISSKEY_STREAMING_CHANNELS,
} from "./misskey-config.ts";
import {
  MisskeyNote,
  normalizeMisskeyNote,
  noteToPlatformMessage,
  shouldRespondToNote,
  removeBotMention,
  isDirectMessage,
  buildReplyParams,
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
  private mainChannel: Channel<{ name: "main" }> | null = null;
  private reconnectAttempts = 0;

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

      this.mainChannel.on("messagingMessage", (message: unknown) => {
        // Handle DM (if using messaging API)
        const note = message as MisskeyNote;
        this.handleNote(note, true);
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

    logger.info("Scheduling reconnect", {
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
  async disconnect(): Promise<void> {
    logger.info("Disconnecting from Misskey");

    if (this.mainChannel) {
      this.mainChannel.dispose();
      this.mainChannel = null;
    }

    this.client.disconnectStream();
    this.updateConnectionState(ConnectionState.DISCONNECTED);
  }

  /**
   * Send a reply (create a note)
   */
  async sendReply(
    channelId: string,
    content: string,
    options?: ReplyOptions,
  ): Promise<ReplyResult> {
    try {
      // Truncate content if necessary
      const truncatedContent = content.length > this.capabilities.maxMessageLength
        ? content.slice(0, this.capabilities.maxMessageLength - 3) + "..."
        : content;

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
   * Fetch recent notes (for context)
   */
  async fetchRecentMessages(
    channelId: string,
    limit: number,
  ): Promise<PlatformMessage[]> {
    try {
      // If channelId starts with "dm:", fetch DM history
      // Otherwise, fetch note replies/conversation
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

      // For note:xxx, fetch the conversation thread
      if (channelId.startsWith("note:")) {
        const noteId = channelId.slice(5);
        const notes = await this.client.request<MisskeyNote[]>(
          "notes/replies",
          { noteId, limit },
        );

        return notes.map((note) => noteToPlatformMessage(note, this.botId!));
      }

      return [];
    } catch (error) {
      throw new PlatformError(
        ErrorCode.PLATFORM_API_ERROR,
        `Failed to fetch messages: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { channelId },
      );
    }
  }

  /**
   * Search notes by keyword
   */
  override async searchRelatedMessages(
    guildId: string,
    channelId: string,
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
