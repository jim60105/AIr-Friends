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

  /** The agent type used for this session (e.g. "opencode") */
  agentType?: string;

  /**
   * The deployment-owned ABSOLUTE skill-script root rendered literally into
   * every skill-instructing prompt (`repair-omp-owned-skill-handoff` D1).
   * Internal render input — never public configuration: the render layer
   * resolves it per agent type through `core/skills-root.ts` (omp: the
   * installed owned root the settings overlays declare, validated-dev
   * fallback; opencode: the existing installed-root resolution), NEVER from
   * the agent child's isolated HOME. A prompt template may render skill
   * script recipes ONLY from this literal; an unresolved root is a render
   * failure, never an empty expansion.
   */
  skillsDir: string;

  /** RSS items formatted block (for self-research prompt) */
  rssItems?: string;

  /** Workspace key (for memory maintenance prompt) */
  workspaceKey?: string;

  /** JSON dump of enabled memories (for memory maintenance prompt) */
  memoriesDump?: string;

  /** Minimum memory count threshold for maintenance (memory maintenance prompt only) */
  minMemoryCount?: number;

  /** Whether recent messages were fetched (spontaneous post only) */
  recentMessagesFetched?: boolean;

  /** Formatted important memories text (spontaneous post only) */
  importantMemories?: string;

  /** Formatted recent messages text (spontaneous post only) */
  recentMessages?: string;

  /** Formatted available emojis text (spontaneous post only) */
  availableEmojis?: string;

  /** Pre-formatted user context message (normal message prompt only) */
  userContextMessage?: string;

  /** Reminder message content (reminder delivery prompt only) */
  reminderMessage?: string;

  /** Reminder creation timestamp (reminder delivery prompt only) */
  reminderCreatedAt?: string;

  /** Reminder scheduled timestamp (reminder delivery prompt only) */
  reminderScheduledAt?: string;

  /** Model identifier (e.g., "openrouter/deepseek/deepseek-v4-pro", "openrouter/google/gemini-2.5-pro") */
  model?: string;

  /** Whether YOLO mode is enabled for this session (bypasses permission restrictions) */
  yolo?: boolean;

  /** Whether this session allows writing to agent workspace (regardless of YOLO mode) */
  canWriteAgentWorkspace?: boolean;

  /**
   * The session's ABSOLUTE payload staging directory
   * (`{session workspace}/tmp/{sessionId}` — the canonical staging root the
   * payload helper enforces containment against, independent of any
   * process-level `TMPDIR`, which in shared-process mode is a channel-scoped
   * data root outside the user's workspace). Every render of a
   * payload-staging-instructing bundled template supplies this literal —
   * per-spawn and pooled alike; the bundled templates no longer fall back to
   * the `$TMPDIR`/`$SESSION_ID` shell tokens (operator-mounted legacy
   * templates may still render the optional-absent form).
   */
  tmpDir?: string;

  /**
   * The literal active Skill API session id for this run ("sess_...").
   * Rendered into prompts so the agent passes the CURRENT session to skills
   * (`--session-id <literal id>`) in EVERY spawn shape — pooled processes
   * carry no `SESSION_ID` environment variable at all, and per-spawn ones
   * must not be depended on for it. Mandatory render input on every bundled
   * payload-staging prompt path alongside `tmpDir`.
   */
  sessionId?: string;
}
