// src/types/platform.ts

import type { NormalizedEvent } from "./events.ts";

/**
 * Platform connection state
 */
export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  ERROR = "error",
}

/**
 * Platform adapter capabilities
 */
export interface PlatformCapabilities {
  /** Can fetch message history */
  canFetchHistory: boolean;

  /** Can search messages */
  canSearchMessages: boolean;

  /** Supports direct messages */
  supportsDm: boolean;

  /** Supports guild/server concept */
  supportsGuild: boolean;

  /** Supports message reactions */
  supportsReactions: boolean;

  /** Maximum message length */
  maxMessageLength: number;
}

/**
 * Platform connection status
 */
export interface ConnectionStatus {
  state: ConnectionState;
  lastConnected?: Date;
  lastError?: string;
  reconnectAttempts: number;
}

/**
 * Event handler for normalized events
 */
export type EventHandler = (event: NormalizedEvent) => Promise<void>;

/**
 * Reply options for platform-specific features
 */
export interface ReplyOptions {
  /** Reply to a specific message (thread) */
  replyToMessageId?: string;

  /** Mention the user in the reply */
  mentionUser?: boolean;

  /** Additional platform-specific options */
  platformSpecific?: Record<string, unknown>;
}

/**
 * Result of sending a reply
 */
export interface ReplyResult {
  success: boolean;
  messageId?: string;
  error?: string;
}
