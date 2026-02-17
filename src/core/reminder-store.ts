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

const logger = createLogger("ReminderStore");

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

    const events = this.parseLog(content);
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
   * Parse JSONL content into log events
   */
  private parseLog(content: string): ReminderLogEvent[] {
    const events: ReminderLogEvent[] = [];
    const lines = content.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as ReminderLogEvent;
        events.push(event);
      } catch (error) {
        logger.warn("Failed to parse reminder log line", {
          line: line.substring(0, 100),
          error: String(error),
        });
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
