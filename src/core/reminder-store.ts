// src/core/reminder-store.ts

import { join } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import type { WorkspaceInfo } from "../types/workspace.ts";
import type {
  ReminderEntry,
  ReminderLogEvent,
  ReminderPatch,
  ResolvedReminder,
} from "../types/reminder.ts";
import type { EmailOperationKey } from "@platforms/email/submission-store.ts";
import { spontaneousOperationKey } from "@platforms/email/spontaneous-store.ts";
import { emailResponseSlots } from "./email-response-accounting.ts";
import type { Platform } from "../types/events.ts";

const logger = createLogger("ReminderStore");

/**
 * Safe parse-failure code of a PRIVATE workspace's reminder line. A malformed
 * line in an email workspace may be private correspondence, and the parser's own
 * message quotes that line, so neither an excerpt nor the exception text is ever
 * logged there — only this code and the position to inspect by hand.
 */
const PRIVATE_PARSE_FAILURE_CODE = "REMINDER_LINE_PARSE_FAILED";

/**
 * UTF-8 byte offset of the start of `lines[index]` (0-based). Computed only on
 * the private failure path, so ordinary parsing stays as cheap as it was.
 */
function byteOffsetOfLine(lines: readonly string[], index: number): number {
  const encoder = new TextEncoder();
  let offset = 0;
  for (let i = 0; i < index; i++) {
    offset += encoder.encode(lines[i]).length + 1; // + the "\n" separator
  }
  return offset;
}

/** The logical email operation identity a host session's sends belong to. */
export interface SessionEmailOperation {
  workId: string;
  slots: readonly string[];
}

/**
 * Email operation identity of a host session (row 23 helper).
 *
 * An ordinary email session sends under its durable inbound work id and the
 * ordinary slots plus one partition per destination grant. A scheduled email
 * reminder session has no inbound work: its sends belong to the ONE stable
 * `reminder:<id>` operation of that reminder, so a restarted run is answered
 * from the durable journal instead of submitting again.
 *
 * An email spontaneous session (row 25) has no inbound work either: its sends
 * belong to the ONE stable `spontaneous:<tickId>` operation of its durable
 * schedule occurrence, derived through the occurrence's own key function.
 *
 * The parameter is structural on purpose: this is the shared identity rule for
 * the Skill API host and the orchestrator, and neither needs the full session
 * type to apply it.
 */
export function sessionEmailOperation(session: {
  emailWorkId?: string;
  emailReminder?: { reminderId: string };
  emailSpontaneous?: { tickId: string };
  emailDestinationGrants?: readonly { grantId: string }[];
}): SessionEmailOperation | undefined {
  const reminder = session.emailReminder;
  if (reminder !== undefined && reminder.reminderId.trim() !== "") {
    const operation = reminderOperationKey(reminder.reminderId);
    return { workId: operation.workId, slots: [operation.actionSlot] };
  }
  const spontaneous = session.emailSpontaneous;
  if (spontaneous !== undefined && spontaneous.tickId.trim() !== "") {
    const operation = spontaneousOperationKey(spontaneous.tickId);
    return { workId: operation.workId, slots: [operation.actionSlot] };
  }
  const workId = session.emailWorkId;
  if (workId === undefined || workId.trim() === "") return undefined;
  return { workId, slots: emailResponseSlots(session.emailDestinationGrants) };
}

/**
 * Stable logical email operation of ONE scheduled reminder (row 23).
 *
 * Both the work id and the action slot derive from the durable reminder id, so
 * a restarted reminder (a fresh session) reuses the SAME durable journal
 * operation instead of authorizing a second SMTP transaction. Mirrors the
 * row-24 `spontaneousOperationKey` contract.
 */
export function reminderOperationKey(reminderId: string): EmailOperationKey {
  return {
    workId: reminderId,
    actionSlot: `reminder:${reminderId}`,
  };
}

export class ReminderStore {
  constructor(private readonly persistPath: string) {}

  /** Get the full file path for reminders within a workspace */
  private getFilePath(workspace: WorkspaceInfo): string {
    return join(workspace.path, this.persistPath);
  }

  /**
   * Add a new reminder to the workspace JSONL file.
   */
  async addReminder(workspace: WorkspaceInfo, reminder: ReminderEntry): Promise<void> {
    const filePath = this.getFilePath(workspace);
    const line = JSON.stringify(reminder) + "\n";
    await Deno.writeTextFile(filePath, line, { append: true });
    logger.info("Reminder {reminderId} added for user {userId}", {
      reminderId: reminder.id,
      userId: reminder.userId,
      scheduledAt: reminder.scheduledAt,
    });
  }

  /**
   * Cancel a reminder by appending a patch event.
   */
  async cancelReminder(workspace: WorkspaceInfo, reminderId: string): Promise<void> {
    const patch: ReminderPatch = {
      type: "reminder-patch",
      targetId: reminderId,
      ts: new Date().toISOString(),
      changes: { enabled: false },
    };
    const filePath = this.getFilePath(workspace);
    const line = JSON.stringify(patch) + "\n";
    await Deno.writeTextFile(filePath, line, { append: true });
    logger.info("Reminder {reminderId} cancelled", { reminderId });
  }

  /**
   * Load and resolve all reminders from the workspace.
   * Two-pass resolution: collect all entries, then apply patches.
   */
  async loadReminders(workspace: WorkspaceInfo): Promise<ResolvedReminder[]> {
    const filePath = this.getFilePath(workspace);

    let content: string;
    try {
      content = await Deno.readTextFile(filePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }

    const events = this.parseLog(content, workspace.components.platform);
    return this.resolveReminders(events);
  }

  /**
   * Get all active (enabled) reminders that are due (scheduledAt <= now).
   */
  async getDueReminders(workspace: WorkspaceInfo): Promise<ResolvedReminder[]> {
    const all = await this.loadReminders(workspace);
    const now = new Date().toISOString();
    return all.filter((r) => r.enabled && r.scheduledAt <= now);
  }

  /**
   * Get count of active reminders that are still pending (enabled and in the future).
   */
  async getActiveCount(workspace: WorkspaceInfo): Promise<number> {
    const all = await this.loadReminders(workspace);
    const now = new Date().toISOString();
    return all.filter((r) => r.enabled && r.scheduledAt > now).length;
  }

  /**
   * Parse JSONL content into log events.
   *
   * `platform` is the trusted workspace identity, never anything read out of the
   * content: a due-reminder enumeration runs before any session logger exists,
   * and in an email workspace a malformed line may BE private correspondence.
   * There the failure is reported as a safe code plus the line's position, with
   * no excerpt and no content-bearing parser exception. Non-email workspaces keep
   * their historical diagnostic unchanged.
   */
  private parseLog(content: string, platform: Platform): ReminderLogEvent[] {
    const events: ReminderLogEvent[] = [];
    const privateWorkspace = platform === "email";
    const lines = content.split("\n");

    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as ReminderLogEvent;
        events.push(event);
      } catch (error) {
        if (privateWorkspace) {
          logger.warn("Failed to parse reminder log line", {
            code: PRIVATE_PARSE_FAILURE_CODE,
            line: index + 1,
            offset: byteOffsetOfLine(lines, index),
          });
        } else {
          logger.warn("Failed to parse reminder log line", {
            line: line.substring(0, 100),
            error: String(error),
          });
        }
      }
    }

    return events;
  }

  /**
   * Resolve reminders by applying patches
   */
  private resolveReminders(events: ReminderLogEvent[]): ResolvedReminder[] {
    const remindersMap = new Map<string, ResolvedReminder>();
    const patchesMap = new Map<string, ReminderPatch[]>();

    // First pass: collect all reminders and patches
    for (const event of events) {
      if (event.type === "reminder") {
        remindersMap.set(event.id, {
          id: event.id,
          createdAt: event.createdAt,
          scheduledAt: event.scheduledAt,
          message: event.message,
          platform: event.platform,
          userId: event.userId,
          enabled: event.enabled,
          // Row 23: the persisted email origin is replayed verbatim. Records
          // written before this field existed carry no origin and resolve
          // exactly as before (no migration, no synthesized origin).
          ...(isReminderOrigin(event.origin) ? { origin: event.origin } : {}),
        });
      } else if (event.type === "reminder-patch") {
        const patches = patchesMap.get(event.targetId) ?? [];
        patches.push(event);
        patchesMap.set(event.targetId, patches);
      }
    }

    // Second pass: apply patches
    for (const [targetId, patches] of patchesMap) {
      const reminder = remindersMap.get(targetId);
      if (!reminder) continue;

      patches.sort((a, b) => a.ts.localeCompare(b.ts));

      for (const patch of patches) {
        if (patch.changes.enabled !== undefined) reminder.enabled = patch.changes.enabled;
        reminder.lastModifiedAt = patch.ts;
      }
    }

    return Array.from(remindersMap.values());
  }
}

/**
 * Whether a replayed JSONL value is a structurally usable reminder origin.
 *
 * The JSONL parser returns asserted types, so this is the runtime guard that
 * decides whether the origin may be replayed at all. Anything else (a null, a
 * missing field, a non-string) is treated as ABSENT rather than propagated;
 * the scheduler then refuses to guess a thread for an email reminder.
 */
function isReminderOrigin(
  value: unknown,
): value is { channelId: string; replyAnchorRecordId: string } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { channelId?: unknown; replyAnchorRecordId?: unknown };
  return typeof candidate.channelId === "string" && candidate.channelId.trim() !== "" &&
    typeof candidate.replyAnchorRecordId === "string" &&
    candidate.replyAnchorRecordId.trim() !== "";
}
