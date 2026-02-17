// src/types/reminder.ts

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
}
