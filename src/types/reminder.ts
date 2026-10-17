// src/types/reminder.ts

/**
 * Originating user thread and reply anchor of an email reminder.
 *
 * Persisted at creation (required for a new EMAIL reminder, absent for every
 * Discord/Misskey record) and replayed by {@link ReminderStore} so a due email
 * reminder is delivered into its ORIGINAL owner thread instead of a newly
 * allocated DM thread.
 */
export interface ReminderOrigin {
  /** Email channel id `mail:<owner>:<threadId>` of the initiating user thread. */
  channelId: string;
  /** Durable message-store record id of the reply anchor inside that owner thread. */
  replyAnchorRecordId: string;
}

/**
 * Host-bound scheduled email reminder session identity (row 23).
 *
 * Written by the host scheduler when it starts a due email reminder session,
 * exactly like the durable work binding of an inbound email session; the agent
 * can never supply or widen it.
 */
export interface EmailReminderSession {
  reminderId: string;
  origin: ReminderOrigin;
}

/**
 * A single reminder entry persisted in workspace/reminders.jsonl
 * Follows the same append-only pattern as the memory system.
 */
export interface ReminderEntry {
  /** Event type discriminator */
  type: "reminder";

  /** Unique reminder ID (format: "rem_TIMESTAMP_UUID") */
  id: string;

  /** ISO 8601 timestamp when the reminder was created */
  createdAt: string;

  /** ISO 8601 timestamp when the reminder should fire */
  scheduledAt: string;

  /** The reminder message content */
  message: string;

  /** Platform where the reminder should be delivered */
  platform: string;

  /** User ID who set the reminder (reminder is always delivered via DM to this user) */
  userId: string;

  /** Whether this reminder is still active */
  enabled: boolean;

  /**
   * Origin of an EMAIL reminder (required on creation, never written for
   * Discord/Misskey reminders). Optional so every existing record keeps
   * parsing unchanged — no migration is required.
   */
  origin?: ReminderOrigin;
}

/**
 * Patch event for modifying reminder state (e.g., cancelling).
 * Follows the same append-only pattern as memory patches.
 */
export interface ReminderPatch {
  /** Event type discriminator */
  type: "reminder-patch";

  /** ID of the target reminder to modify */
  targetId: string;

  /** ISO 8601 timestamp of this patch */
  ts: string;

  /** Changes to apply */
  changes: {
    enabled?: boolean;
  };
}

/** Union type for all reminder log events */
export type ReminderLogEvent = ReminderEntry | ReminderPatch;

/** Resolved reminder after applying all patches */
export interface ResolvedReminder {
  id: string;
  createdAt: string;
  scheduledAt: string;
  message: string;
  platform: string;
  userId: string;
  enabled: boolean;
  /** ISO 8601 timestamp of last modification (from patch) */
  lastModifiedAt?: string;
  /** Origin of an email reminder, replayed from the stored entry (row 23). */
  origin?: ReminderOrigin;
}
