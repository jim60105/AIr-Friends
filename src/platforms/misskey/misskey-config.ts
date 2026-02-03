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

  /** Reconnect options */
  reconnect?: {
    /** Whether to auto-reconnect */
    enabled: boolean;
    /** Max reconnect attempts */
    maxAttempts?: number;
    /** Base delay between attempts (ms) */
    baseDelay?: number;
  };
}

/**
 * Default Misskey configuration
 */
export const DEFAULT_MISSKEY_CONFIG: Partial<MisskeyAdapterConfig> = {
  secure: true,
  respondToMention: true,
  allowDm: true,
  reconnect: {
    enabled: true,
    maxAttempts: 5,
    baseDelay: 1000,
  },
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
