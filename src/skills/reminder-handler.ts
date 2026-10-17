// src/skills/reminder-handler.ts

import { createLogger } from "@utils/logger.ts";
import { remindersCancelledTotal, remindersSetTotal } from "@utils/metrics.ts";
import type { SkillContext, SkillResult } from "./types.ts";
import type { ReminderStore } from "@core/reminder-store.ts";
import type { RemindersConfig } from "../types/config.ts";
import type { ReminderEntry, ReminderOrigin } from "../types/reminder.ts";
import { parseEmailChannelId } from "@platforms/email/message-store.ts";

const logger = createLogger("ReminderHandler");

/** Refusal text for an email reminder whose host-resolved origin is missing or invalid. */
export const EMAIL_REMINDER_ORIGIN_ERROR =
  "Email reminders require the host-resolved originating thread and reply anchor; none was supplied.";

/**
 * Build the origin of an EMAIL session from its channel id and reply anchor
 * (row 23). Returns undefined unless the channel is a valid
 * `mail:<owner>:<threadId>` id and the anchor is a non-empty record id.
 *
 * Only the HOST calls this: the value is derived from the session the host
 * established, never from a skill parameter, so a model cannot choose the
 * thread a reminder will later be delivered into.
 */
export function buildEmailReminderOrigin(
  channelId: string,
  replyAnchorRecordId: string | undefined,
): ReminderOrigin | undefined {
  const anchor = typeof replyAnchorRecordId === "string" ? replyAnchorRecordId.trim() : "";
  if (anchor === "") return undefined;
  try {
    const { owner, threadId } = parseEmailChannelId(channelId);
    return { channelId: `mail:${owner}:${threadId}`, replyAnchorRecordId: anchor };
  } catch {
    return undefined;
  }
}

/**
 * Validate a host-supplied origin against the reminder's owner before an EMAIL
 * reminder is created: the channel must parse, its encoded owner must BE this
 * reminder's owner, and the anchor record id must be non-empty.
 */
export function validateEmailReminderOrigin(
  origin: ReminderOrigin | undefined,
  userId: string,
): ReminderOrigin | undefined {
  if (
    !origin || typeof origin.channelId !== "string" ||
    typeof origin.replyAnchorRecordId !== "string"
  ) {
    return undefined;
  }
  const expectedOwner = typeof userId === "string" ? userId.trim().toLowerCase() : "";
  if (expectedOwner === "") return undefined;
  const anchor = origin.replyAnchorRecordId.trim();
  if (anchor === "") return undefined;
  try {
    const { owner, threadId } = parseEmailChannelId(origin.channelId);
    if (owner !== expectedOwner) return undefined;
    return { channelId: `mail:${owner}:${threadId}`, replyAnchorRecordId: anchor };
  } catch {
    return undefined;
  }
}

export class ReminderHandler {
  private reminderSetSessions: Set<string> = new Set();

  constructor(
    private readonly reminderStore: ReminderStore,
    private readonly config: RemindersConfig,
  ) {}

  /**
   * Handle set-reminder skill call.
   */
  handleSetReminder: (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ) => Promise<SkillResult> = async (parameters, context) => {
    // 1. DM-only check
    if (!context.workspace.isDm) {
      return {
        success: false,
        error: "Reminders can only be set in direct messages (DM). " +
          "Please ask the user to send you a DM to set a reminder.",
      };
    }

    // 2. Single set-reminder per session check
    const sessionKey = `${context.workspace.key}:${context.channelId}`;
    if (this.reminderSetSessions.has(sessionKey)) {
      return {
        success: false,
        error: "Only one reminder can be set per session. " +
          "The user can set another reminder in a new conversation.",
      };
    }

    // 3. Validate scheduledAt
    const scheduledAt = parameters.scheduledAt as string | undefined;
    if (!scheduledAt || typeof scheduledAt !== "string") {
      return { success: false, error: "Missing required parameter: scheduledAt" };
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return {
        success: false,
        error: "Invalid scheduledAt format. Must be a valid ISO 8601 timestamp.",
      };
    }

    // 4. Validate scheduledAt is in the future (at least minIntervalMs from now)
    const minTime = Date.now() + this.config.minIntervalMs;
    if (scheduledDate.getTime() < minTime) {
      return {
        success: false,
        error: `scheduledAt must be at least ${this.config.minIntervalMs}ms in the future.`,
      };
    }

    // 5. Validate message
    const message = parameters.message as string | undefined;
    if (!message || typeof message !== "string" || message.trim() === "") {
      return { success: false, error: "Missing or empty required parameter: message" };
    }

    // 6. Check active reminders limit
    const activeCount = await this.reminderStore.getActiveCount(context.workspace);
    if (activeCount >= this.config.maxRemindersPerUser) {
      return {
        success: false,
        error: `Maximum number of active reminders (${this.config.maxRemindersPerUser}) reached. ` +
          "Cancel an existing reminder before setting a new one.",
      };
    }

    // Row 23: an email reminder MUST carry the host-resolved origin of the
    // session it was created in. Discord/Misskey records never gain the field,
    // so their persisted shape and delivery behavior are unchanged.
    const platform = context.workspace.components.platform;
    let origin: ReminderOrigin | undefined;
    if (platform === "email") {
      origin = validateEmailReminderOrigin(context.emailReminderOrigin, context.userId);
      if (!origin) {
        return { success: false, error: EMAIL_REMINDER_ORIGIN_ERROR };
      }
    }

    // Create reminder entry
    const entry: ReminderEntry = {
      type: "reminder",
      id: `rem_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      scheduledAt: scheduledDate.toISOString(),
      message: message.trim(),
      platform,
      userId: context.userId,
      enabled: true,
      ...(origin === undefined ? {} : { origin }),
    };

    await this.reminderStore.addReminder(context.workspace, entry);

    // Mark session
    this.reminderSetSessions.add(sessionKey);

    // Metrics
    remindersSetTotal.labels(platform).inc();

    logger.info("Reminder {reminderId} set for {scheduledAt}", {
      reminderId: entry.id,
      scheduledAt: entry.scheduledAt,
      userId: context.userId,
    });

    return {
      success: true,
      data: { reminderId: entry.id, scheduledAt: entry.scheduledAt },
    };
  };

  /**
   * Clear the reminder-set tracking for a specific session.
   */
  clearSessionState(workspaceKey: string, channelId: string): void {
    const sessionKey = `${workspaceKey}:${channelId}`;
    this.reminderSetSessions.delete(sessionKey);
  }

  /**
   * Handle cancel-reminder skill call.
   */
  handleCancelReminder: (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ) => Promise<SkillResult> = async (parameters, context) => {
    if (!context.workspace.isDm) {
      return {
        success: false,
        error: "Reminder operations are only available in direct messages (DM).",
      };
    }

    const reminderId = parameters.reminderId as string | undefined;
    if (!reminderId || typeof reminderId !== "string" || reminderId.trim() === "") {
      return { success: false, error: "Missing required parameter: reminderId" };
    }

    // Load reminders and verify ownership
    const all = await this.reminderStore.loadReminders(context.workspace);
    const reminder = all.find((r) => r.id === reminderId);

    if (!reminder) {
      return { success: false, error: `Reminder not found: ${reminderId}` };
    }

    if (reminder.userId !== context.userId) {
      return { success: false, error: "Cannot cancel a reminder that belongs to another user." };
    }

    if (!reminder.enabled) {
      return { success: false, error: "Reminder is already cancelled or has been delivered." };
    }

    await this.reminderStore.cancelReminder(context.workspace, reminderId);

    remindersCancelledTotal.labels(context.workspace.components.platform).inc();

    logger.info("Reminder {reminderId} cancelled by user", {
      reminderId,
      userId: context.userId,
    });

    return {
      success: true,
      data: { reminderId, cancelled: true },
    };
  };

  /**
   * Handle list-reminders skill call.
   */
  handleListReminders: (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ) => Promise<SkillResult> = async (_parameters, context) => {
    if (!context.workspace.isDm) {
      return {
        success: false,
        error: "Reminder operations are only available in direct messages (DM).",
      };
    }

    const all = await this.reminderStore.loadReminders(context.workspace);
    const now = new Date().toISOString();
    const active = all
      .filter((r) => r.enabled && r.scheduledAt > now)
      .map((r) => ({
        id: r.id,
        message: r.message,
        scheduledAt: r.scheduledAt,
        createdAt: r.createdAt,
      }));

    return {
      success: true,
      data: { reminders: active, count: active.length },
    };
  };
}
