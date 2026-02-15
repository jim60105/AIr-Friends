import { assertEquals } from "@std/assert";
import { GitBackupScheduler } from "@core/git-backup-scheduler.ts";
import type { GitBackupConfig } from "../../src/types/config.ts";

function createConfig(overrides?: Partial<GitBackupConfig>): GitBackupConfig {
  return {
    enabled: true,
    remoteUrl: "https://github.com/test/repo.git",
    intervalMs: 30,
    authorName: "Test",
    authorEmail: "test@example.com",
    ...overrides,
  };
}

Deno.test("GitBackupScheduler - disabled config does not start scheduler", () => {
  const scheduler = new GitBackupScheduler(createConfig({ enabled: false }));
  scheduler.setCallback(async () => {});
  scheduler.start();

  assertEquals(scheduler.getStatus().nextScheduledAt, null);
  scheduler.stop();
});

Deno.test("GitBackupScheduler - scheduleNext sets correct interval", () => {
  const scheduler = new GitBackupScheduler(createConfig({ intervalMs: 100 }));
  scheduler.setCallback(async () => {});

  const before = Date.now();
  scheduler.start();
  const next = scheduler.getStatus().nextScheduledAt;
  assertEquals(next instanceof Date, true);

  const delta = (next as Date).getTime() - before;
  assertEquals(delta >= 80 && delta <= 200, true);
  scheduler.stop();
});

Deno.test("GitBackupScheduler - prevents concurrent execution", async () => {
  const scheduler = new GitBackupScheduler(createConfig({ intervalMs: 20 }));
  let running = false;
  let overlapDetected = false;
  let callCount = 0;

  scheduler.setCallback(async () => {
    if (running) overlapDetected = true;
    running = true;
    callCount++;
    await new Promise((resolve) => setTimeout(resolve, 40));
    running = false;
  });
  scheduler.start();

  await new Promise((resolve) => setTimeout(resolve, 140));
  scheduler.stop();
  await new Promise((resolve) => setTimeout(resolve, 60));

  assertEquals(overlapDetected, false);
  assertEquals(callCount >= 2, true);
});

Deno.test("GitBackupScheduler - reschedules after error", async () => {
  const scheduler = new GitBackupScheduler(createConfig({ intervalMs: 20 }));
  let callCount = 0;

  scheduler.setCallback(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.reject(new Error("expected"));
    }
    return Promise.resolve();
  });
  scheduler.start();

  await new Promise((resolve) => setTimeout(resolve, 140));
  scheduler.stop();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assertEquals(callCount >= 2, true);
});

Deno.test("GitBackupScheduler - stop clears timer", () => {
  const scheduler = new GitBackupScheduler(createConfig());
  scheduler.setCallback(async () => {});
  scheduler.start();

  assertEquals(scheduler.getStatus().nextScheduledAt instanceof Date, true);
  scheduler.stop();
  assertEquals(scheduler.getStatus().nextScheduledAt, null);
});

Deno.test("GitBackupScheduler - start is no-op when already started", () => {
  const scheduler = new GitBackupScheduler(createConfig({ intervalMs: 100 }));
  scheduler.setCallback(async () => {});
  scheduler.start();

  const nextFirst = scheduler.getStatus().nextScheduledAt;
  scheduler.start();
  const nextSecond = scheduler.getStatus().nextScheduledAt;

  assertEquals(nextFirst, nextSecond);
  scheduler.stop();
});

Deno.test("GitBackupScheduler - getStatus returns correct running state", async () => {
  const scheduler = new GitBackupScheduler(createConfig({ intervalMs: 20 }));
  let resolveCallback: () => void;
  const callbackPromise = new Promise<void>((resolve) => {
    resolveCallback = resolve;
  });

  scheduler.setCallback(async () => {
    assertEquals(scheduler.getStatus().isRunning, true);
    resolveCallback();
    await new Promise((r) => setTimeout(r, 30));
  });
  scheduler.start();

  await callbackPromise;
  scheduler.stop();
  await new Promise((r) => setTimeout(r, 50));

  assertEquals(scheduler.getStatus().isRunning, false);
  assertEquals(scheduler.getStatus().lastExecutedAt instanceof Date, true);
});

Deno.test("GitBackupScheduler - execute without callback", async () => {
  const scheduler = new GitBackupScheduler(createConfig({ intervalMs: 20 }));
  scheduler.start();

  await new Promise((resolve) => setTimeout(resolve, 60));
  scheduler.stop();

  assertEquals(scheduler.getStatus().lastExecutedAt instanceof Date, true);
});
