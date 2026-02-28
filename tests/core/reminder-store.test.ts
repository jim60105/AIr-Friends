import { assertEquals } from "@std/assert";
import { ReminderStore } from "@core/reminder-store.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { ReminderEntry } from "../../src/types/reminder.ts";

function makeWorkspace(dir: string): WorkspaceInfo {
  return {
    key: "test/workspace",
    components: { platform: "discord", userId: "user1" },
    path: dir,
    tmpPath: dir + "/tmp",
    isDm: true,
  } as WorkspaceInfo;
}

function makeEntry(overrides: Partial<ReminderEntry> = {}): ReminderEntry {
  return {
    type: "reminder",
    id: `rem_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    scheduledAt: new Date(Date.now() + 60000).toISOString(),
    message: "test reminder",
    platform: "discord",
    userId: "user1",
    enabled: true,
    ...overrides,
  };
}

Deno.test("ReminderStore - addReminder writes JSONL correctly", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new ReminderStore("reminders.jsonl");
    const ws = makeWorkspace(tmp);
    const entry = makeEntry({ message: "remind me" });
    await store.addReminder(ws, entry);

    const raw = await Deno.readTextFile(`${tmp}/reminders.jsonl`);
    const lines = raw.trim().split("\n");
    assertEquals(lines.length, 1);
    const obj = JSON.parse(lines[0]);
    assertEquals(obj.type, "reminder");
    assertEquals(obj.id, entry.id);
    assertEquals(obj.message, "remind me");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ReminderStore - cancelReminder appends a patch event", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new ReminderStore("reminders.jsonl");
    const ws = makeWorkspace(tmp);
    const entry = makeEntry();
    await store.addReminder(ws, entry);
    await store.cancelReminder(ws, entry.id);

    const raw = await Deno.readTextFile(`${tmp}/reminders.jsonl`);
    const lines = raw.trim().split("\n");
    assertEquals(lines.length, 2);
    const patch = JSON.parse(lines[1]);
    assertEquals(patch.type, "reminder-patch");
    assertEquals(patch.targetId, entry.id);
    assertEquals(patch.changes.enabled, false);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ReminderStore - loadReminders resolves patches correctly", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new ReminderStore("reminders.jsonl");
    const ws = makeWorkspace(tmp);
    const entry = makeEntry();
    await store.addReminder(ws, entry);
    await store.cancelReminder(ws, entry.id);

    const reminders = await store.loadReminders(ws);
    assertEquals(reminders.length, 1);
    assertEquals(reminders[0].id, entry.id);
    assertEquals(reminders[0].enabled, false);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ReminderStore - loadReminders returns empty array when file doesn't exist", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new ReminderStore("reminders.jsonl");
    const ws = makeWorkspace(tmp);
    const reminders = await store.loadReminders(ws);
    assertEquals(reminders, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ReminderStore - loadReminders handles invalid JSON lines gracefully", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const file = `${tmp}/reminders.jsonl`;
    const validEntry: ReminderEntry = {
      type: "reminder",
      id: "rem_valid",
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      message: "ok",
      platform: "discord",
      userId: "user1",
      enabled: true,
    };
    await Deno.writeTextFile(file, "not json\n" + JSON.stringify(validEntry) + "\n");

    const store = new ReminderStore("reminders.jsonl");
    const ws = makeWorkspace(tmp);
    const reminders = await store.loadReminders(ws);
    assertEquals(reminders.length, 1);
    assertEquals(reminders[0].id, "rem_valid");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ReminderStore - getDueReminders returns only enabled reminders with scheduledAt <= now", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new ReminderStore("reminders.jsonl");
    const ws = makeWorkspace(tmp);
    const pastEntry = makeEntry({
      id: "rem_past",
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
      message: "past",
    });
    const futureEntry = makeEntry({
      id: "rem_future",
      scheduledAt: new Date(Date.now() + 60000).toISOString(),
      message: "future",
    });
    await store.addReminder(ws, pastEntry);
    await store.addReminder(ws, futureEntry);

    const due = await store.getDueReminders(ws);
    assertEquals(due.length, 1);
    assertEquals(due[0].message, "past");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ReminderStore - getDueReminders excludes disabled reminders", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new ReminderStore("reminders.jsonl");
    const ws = makeWorkspace(tmp);
    const entry = makeEntry({
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
    });
    await store.addReminder(ws, entry);
    await store.cancelReminder(ws, entry.id);

    const due = await store.getDueReminders(ws);
    assertEquals(due.length, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ReminderStore - getActiveCount counts only enabled future reminders", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new ReminderStore("reminders.jsonl");
    const ws = makeWorkspace(tmp);
    const f1 = makeEntry({ id: "f1", scheduledAt: new Date(Date.now() + 10000).toISOString() });
    const f2 = makeEntry({ id: "f2", scheduledAt: new Date(Date.now() + 20000).toISOString() });
    const past = makeEntry({
      id: "past",
      scheduledAt: new Date(Date.now() - 10000).toISOString(),
    });
    await store.addReminder(ws, f1);
    await store.addReminder(ws, f2);
    await store.addReminder(ws, past);
    await store.cancelReminder(ws, f2.id);

    const count = await store.getActiveCount(ws);
    assertEquals(count, 1);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ReminderStore - multiple patches on same reminder, last patch wins", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const file = `${tmp}/reminders.jsonl`;
    const reminder: ReminderEntry = {
      type: "reminder",
      id: "r1",
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      message: "x",
      platform: "discord",
      userId: "user1",
      enabled: true,
    };
    await Deno.writeTextFile(file, JSON.stringify(reminder) + "\n");
    // first patch disables
    const p1 = {
      type: "reminder-patch",
      targetId: "r1",
      ts: new Date(Date.now() + 1).toISOString(),
      changes: { enabled: false },
    };
    await Deno.writeTextFile(file, JSON.stringify(p1) + "\n", { append: true });
    // second patch enables again
    const p2 = {
      type: "reminder-patch",
      targetId: "r1",
      ts: new Date(Date.now() + 2).toISOString(),
      changes: { enabled: true },
    };
    await Deno.writeTextFile(file, JSON.stringify(p2) + "\n", { append: true });

    const store = new ReminderStore("reminders.jsonl");
    const ws = makeWorkspace(tmp);
    const reminders = await store.loadReminders(ws);
    assertEquals(reminders.length, 1);
    assertEquals(reminders[0].enabled, true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ReminderStore - empty file returns empty array", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tmp}/reminders.jsonl`, "");
    const store = new ReminderStore("reminders.jsonl");
    const ws = makeWorkspace(tmp);
    const reminders = await store.loadReminders(ws);
    assertEquals(reminders, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
