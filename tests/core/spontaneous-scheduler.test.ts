// tests/core/spontaneous-scheduler.test.ts

import { assertEquals } from "@std/assert";
import { SpontaneousScheduler } from "@core/spontaneous-scheduler.ts";
import type { Config } from "../../src/types/config.ts";

function createConfig(overrides?: {
  discordEnabled?: boolean;
  discordSpontaneous?: boolean;
  misskeyEnabled?: boolean;
  misskeySpontaneous?: boolean;
  minIntervalMs?: number;
  maxIntervalMs?: number;
}): Config {
  return {
    platforms: {
      discord: {
        token: "test",
        enabled: overrides?.discordEnabled ?? true,
        spontaneousPost: {
          enabled: overrides?.discordSpontaneous ?? false,
          minIntervalMs: overrides?.minIntervalMs ?? 100,
          maxIntervalMs: overrides?.maxIntervalMs ?? 200,
          contextFetchProbability: 0.5,
        },
      },
      misskey: {
        host: "test.com",
        token: "test",
        enabled: overrides?.misskeyEnabled ?? false,
        spontaneousPost: {
          enabled: overrides?.misskeySpontaneous ?? false,
          minIntervalMs: overrides?.minIntervalMs ?? 100,
          maxIntervalMs: overrides?.maxIntervalMs ?? 200,
          contextFetchProbability: 0.5,
        },
      },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: "./prompts/system_reply.md",
      tokenLimit: 20000,
    },
    memory: { searchLimit: 10, maxChars: 2000, recentMessageLimit: 20 },
    workspace: { repoPath: "./data", workspacesDir: "workspaces" },
    logging: { level: "INFO" },
    accessControl: { replyTo: "whitelist", whitelist: [] },
  };
}

Deno.test("SpontaneousScheduler - only schedules for enabled platforms", () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
    misskeyEnabled: false,
    misskeySpontaneous: false,
  });
  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback(async () => {});
  scheduler.start();

  const status = scheduler.getStatus();
  assertEquals("discord" in status, true);
  assertEquals("misskey" in status, false);

  scheduler.stop();
});

Deno.test("SpontaneousScheduler - does not schedule when platform disabled", () => {
  const config = createConfig({
    discordEnabled: false,
    discordSpontaneous: true,
  });
  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback(async () => {});
  scheduler.start();

  const status = scheduler.getStatus();
  assertEquals(Object.keys(status).length, 0);

  scheduler.stop();
});

Deno.test("SpontaneousScheduler - invokes callback on timer trigger", async () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
    minIntervalMs: 50,
    maxIntervalMs: 60,
  });

  let callbackPlatform: string | null = null;
  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback((platform) => {
    callbackPlatform = platform;
    return Promise.resolve();
  });
  scheduler.start();

  // Wait for the timer to trigger
  await new Promise((resolve) => setTimeout(resolve, 150));

  assertEquals(callbackPlatform, "discord");

  scheduler.stop();
});

Deno.test("SpontaneousScheduler - schedules next execution even on callback failure", async () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
    minIntervalMs: 30,
    maxIntervalMs: 40,
  });

  let callCount = 0;
  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback(() => {
    callCount++;
    if (callCount === 1) return Promise.reject(new Error("Test failure"));
    return Promise.resolve();
  });
  scheduler.start();

  // Wait for at least 2 executions
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Should have retried after failure
  assertEquals(callCount >= 2, true);

  scheduler.stop();
});

Deno.test("SpontaneousScheduler - stop() clears all timers", () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
  });
  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback(async () => {});
  scheduler.start();

  assertEquals(Object.keys(scheduler.getStatus()).length, 1);

  scheduler.stop();

  assertEquals(Object.keys(scheduler.getStatus()).length, 0);
});

Deno.test("SpontaneousScheduler - start() is idempotent", () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
  });
  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback(async () => {});

  scheduler.start();
  scheduler.start(); // Should not double-schedule

  assertEquals(Object.keys(scheduler.getStatus()).length, 1);

  scheduler.stop();
});

Deno.test("SpontaneousScheduler - getStatus() returns correct state", () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
  });
  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback(async () => {});
  scheduler.start();

  const status = scheduler.getStatus();
  assertEquals(status.discord.isRunning, false);
  assertEquals(status.discord.lastExecutedAt, null);
  assertEquals(status.discord.nextScheduledAt instanceof Date, true);

  scheduler.stop();
});

Deno.test("SpontaneousScheduler - schedules both platforms independently", () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
    misskeyEnabled: true,
    misskeySpontaneous: true,
  });
  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback(async () => {});
  scheduler.start();

  const status = scheduler.getStatus();
  assertEquals("discord" in status, true);
  assertEquals("misskey" in status, true);

  scheduler.stop();
});

Deno.test("SpontaneousScheduler - lastExecutedAt is set after callback runs", async () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
    minIntervalMs: 30,
    maxIntervalMs: 40,
  });

  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback(() => Promise.resolve());
  scheduler.start();

  // Wait for callback to execute
  await new Promise((resolve) => setTimeout(resolve, 120));

  const status = scheduler.getStatus();
  assertEquals(status.discord.lastExecutedAt instanceof Date, true);

  scheduler.stop();
});

// === State Restoration Tests ===

Deno.test("SpontaneousScheduler - uses restored schedule time within valid range", () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
    minIntervalMs: 100,
    maxIntervalMs: 5000,
  });
  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback(async () => {});

  const futureTime = new Date(Date.now() + 2000);
  scheduler.start({ "spontaneous:discord": futureTime.toISOString() });

  const status = scheduler.getStatus();
  assertEquals(status.discord.nextScheduledAt?.toISOString(), futureTime.toISOString());

  scheduler.stop();
});

Deno.test("SpontaneousScheduler - executes immediately when restored time is past", async () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
    minIntervalMs: 100,
    maxIntervalMs: 5000,
  });
  const scheduler = new SpontaneousScheduler(config);
  let executed = false;
  scheduler.setCallback(() => {
    executed = true;
    return Promise.resolve();
  });

  const pastTime = new Date(Date.now() - 60000);
  scheduler.start({ "spontaneous:discord": pastTime.toISOString() });

  await new Promise((resolve) => setTimeout(resolve, 100));
  assertEquals(executed, true);

  scheduler.stop();
});

Deno.test("SpontaneousScheduler - reschedules when restored time exceeds max range", () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
    minIntervalMs: 100,
    maxIntervalMs: 200,
  });
  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback(() => Promise.resolve());

  const farFuture = new Date(Date.now() + 999999999);
  scheduler.start({ "spontaneous:discord": farFuture.toISOString() });

  const status = scheduler.getStatus();
  const delta = status.discord.nextScheduledAt!.getTime() - Date.now();
  assertEquals(delta <= 300, true); // Within max range
  assertEquals(delta >= 0, true);

  scheduler.stop();
});

Deno.test("SpontaneousScheduler - works normally without restored state", () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
    minIntervalMs: 100,
    maxIntervalMs: 200,
  });
  const scheduler = new SpontaneousScheduler(config);
  scheduler.setCallback(async () => {});
  scheduler.start();

  const status = scheduler.getStatus();
  assertEquals(status.discord.nextScheduledAt instanceof Date, true);

  scheduler.stop();
});

Deno.test("SpontaneousScheduler - persists next time via stateStore in scheduleNext", () => {
  const config = createConfig({
    discordEnabled: true,
    discordSpontaneous: true,
    minIntervalMs: 50,
    maxIntervalMs: 100,
  });
  const scheduler = new SpontaneousScheduler(config);

  const saved: { key: string; nextAt: Date }[] = [];
  const mockStore = {
    save: (key: string, nextAt: Date) => {
      saved.push({ key, nextAt });
      return Promise.resolve();
    },
  };
  scheduler.setStateStore(mockStore as never);

  let callCount = 0;
  scheduler.setCallback(() => {
    callCount++;
    return Promise.resolve();
  });
  scheduler.start();

  // Initial scheduleNext should have saved
  assertEquals(saved.length >= 1, true);
  assertEquals(saved[0].key, "spontaneous:discord");

  scheduler.stop();
});
