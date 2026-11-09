import { assertEquals, assertExists } from "@std/assert";
import { SkillRegistry } from "@skills/registry.ts";
import { ReminderStore } from "@core/reminder-store.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import type { RemindersConfig } from "../../src/types/config.ts";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

test("SkillRegistry - registers reminder skills when enabled", async () => {
  const tempDir = await makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {});
    const remindersConfig: RemindersConfig = {
      enabled: true,
      maxRemindersPerUser: 20,
      minIntervalMs: 60000,
      persistPath: "reminders.jsonl",
      checkIntervalMs: 30000,
    };
    const reminderStore = new ReminderStore("reminders.jsonl");
    const registry = new SkillRegistry(memoryStore, remindersConfig, reminderStore);

    assertExists(registry.getReminderHandler());
    assertEquals(registry.hasSkill("set-reminder"), true);
    assertEquals(registry.hasSkill("cancel-reminder"), true);
    assertEquals(registry.hasSkill("list-reminders"), true);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("SkillRegistry - does not register reminder skills when disabled", async () => {
  const tempDir = await makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {});
    const registry = new SkillRegistry(memoryStore);

    assertEquals(registry.getReminderHandler(), null);
    assertEquals(registry.hasSkill("set-reminder"), false);
    assertEquals(registry.hasSkill("cancel-reminder"), false);
    assertEquals(registry.hasSkill("list-reminders"), false);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});
