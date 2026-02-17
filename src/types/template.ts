// src/types/template.ts

import type { Platform } from "./events.ts";

/**
 * Variables available in all prompt templates.
 *
 * These are passed to Vento's render function and can be used
 * directly in templates with {{ variableName }} syntax.
 */
export interface TemplateVariables {
  /** Whether this is a direct message conversation */
  isDm: boolean;

  /** Platform identifier: "discord" | "misskey" */
  platform: Platform | "internal";

  /** The user's ID on the platform */
  userId: string;

  /** The channel ID where the message was sent */
  channelId: string;

  /** Guild/server ID (empty string if not applicable) */
  guildId: string;

  /** The session ID for skill API calls (empty string if skill API disabled) */
  sessionId: string;

  /** RSS items formatted block (for self-research prompt) */
  rssItems?: string;

  /** Workspace key (for memory maintenance prompt) */
  workspaceKey?: string;

  /** JSON dump of enabled memories (for memory maintenance prompt) */
  memoriesDump?: string;
}
