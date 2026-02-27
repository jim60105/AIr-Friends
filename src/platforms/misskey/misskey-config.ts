// src/platforms/misskey/misskey-config.ts

/**
 * Misskey adapter configuration
 */
export interface MisskeyAdapterConfig {
  /** Instance URL (e.g., "misskey.io") */
  host: string;

  /** API token */
  token: string;

  /** Whether to use secure WebSocket (wss://) */
  secure?: boolean;

  /** Whether to respond to mentions */
  respondToMention?: boolean;

  /** Whether to respond to DMs */
  allowDm?: boolean;
}

/**
 * Default Misskey configuration
 */
export const DEFAULT_MISSKEY_CONFIG: Partial<MisskeyAdapterConfig> = {
  secure: true,
  respondToMention: true,
  allowDm: false,
};

/**
 * Misskey streaming channels
 */
export const MISSKEY_STREAMING_CHANNELS = {
  /** Personal timeline (includes mentions and DMs) */
  MAIN: "main",
  /** Home timeline */
  HOME_TIMELINE: "homeTimeline",
  /** Global timeline */
  GLOBAL_TIMELINE: "globalTimeline",
} as const;

/** Misskey IDs vary by instance (aid, aidx, meid, ulid, etc.), keep generic pattern */
export const MISSKEY_WHITELIST_PATTERN = /^misskey\/(account|channel)\/[a-zA-Z0-9_\-@.]+$/;
