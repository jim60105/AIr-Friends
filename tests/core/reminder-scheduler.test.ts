import { ReminderScheduler } from "@core/reminder-scheduler.ts";
import type { RemindersConfig } from "../../src/types/config.ts";
import { assertEquals } from "@std/assert";
import { test } from "bun:test";

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeCfg(overrides: Partial<RemindersConfig> = {}): RemindersConfig {
  return {
    enabled: true,
    maxRemindersPerUser: 5,
    minIntervalMs: 10,
    persistPath: "./tmp/reminders.json",
    checkIntervalMs: 50,
    ...overrides,
  };
}

test("ReminderScheduler - start/stop lifecycle", async () => {
  const sched = new ReminderScheduler(makeCfg());
  let called = 0;
  sched.setCallback(() => {
    called++;
    return Promise.resolve();
  });
  sched.start();
  await wait(120);
  sched.stop();
  const calledAfter = called;
  await wait(120);
  assertEquals(calledAfter, called);
});

test("ReminderScheduler - start does nothing when disabled", async () => {
  const sched = new ReminderScheduler(makeCfg({ enabled: false }));
  let called = 0;
  sched.setCallback(() => {
    called++;
    return Promise.resolve();
  });
  sched.start();
  await wait(120);
  assertEquals(called, 0);
  sched.stop();
});

test("ReminderScheduler - start does nothing without callback set", async () => {
  const sched = new ReminderScheduler(makeCfg());
  sched.start();
  await wait(120);
  const status = sched.getStatus();
  sched.stop();
  assertEquals(status.isRunning, false);
});

test("ReminderScheduler - callback is called after checkIntervalMs", async () => {
  const sched = new ReminderScheduler(makeCfg());
  let called = 0;
  sched.setCallback(() => {
    called++;
    return Promise.resolve();
  });
  sched.start();
  await wait(70);
  sched.stop();
  assertEquals(called > 0, true);
});

test("ReminderScheduler - stop clears timer", async () => {
  const sched = new ReminderScheduler(makeCfg());
  let called = 0;
  sched.setCallback(() => {
    called++;
    return Promise.resolve();
  });
  sched.start();
  await wait(60);
  sched.stop();
  const prev = called;
  await wait(120);
  assertEquals(prev, called);
});

test("ReminderScheduler - overlap guard prevents concurrent execution", async () => {
  const sched = new ReminderScheduler(makeCfg({ checkIntervalMs: 20 }));
  let maxConcurrent = 0;
  let currentConcurrent = 0;
  sched.setCallback(async () => {
    currentConcurrent++;
    if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
    await wait(80);
    currentConcurrent--;
  });
  sched.start();
  await wait(250);
  sched.stop();
  // Wait for any in-flight callback to complete
  await wait(100);
  assertEquals(maxConcurrent, 1);
});

test("ReminderScheduler - error in callback does not stop scheduler", async () => {
  const sched = new ReminderScheduler(makeCfg());
  let runs = 0;
  sched.setCallback(() => {
    runs++;
    if (runs === 1) return Promise.reject(new Error("boom"));
    return Promise.resolve();
  });
  sched.start();
  await wait(170);
  sched.stop();
  assertEquals(runs > 1, true);
});

test("ReminderScheduler - getStatus returns correct values", async () => {
  const sched = new ReminderScheduler(makeCfg());
  sched.setCallback(() => Promise.resolve());
  const before = sched.getStatus();
  assertEquals(before.isRunning, false);
  assertEquals(before.lastExecutedAt, null);
  sched.start();
  await wait(70);
  const after = sched.getStatus();
  sched.stop();
  assertEquals(after.isRunning, false);
  assertEquals(after.lastExecutedAt !== null, true);
});
