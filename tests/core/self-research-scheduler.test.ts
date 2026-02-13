// tests/core/self-research-scheduler.test.ts

import { assertEquals } from "@std/assert";
import { SelfResearchScheduler } from "@core/self-research-scheduler.ts";
import type { Config } from "../../src/types/config.ts";

function createConfig(overrides?: {
  enabled?: boolean;
  minIntervalMs?: number;
  maxIntervalMs?: number;
}): Config {
  return {
    platforms: {
      discord: {
        token: "test",
        enabled: true,
        spontaneousPost: {
          enabled: false,
          minIntervalMs: 100,
          maxIntervalMs: 200,
          contextFetchProbability: 0.5,
        },
      },
      misskey: {
        host: "test.com",
        token: "test",
        enabled: false,
        spontaneousPost: {
          enabled: false,
          minIntervalMs: 100,
          maxIntervalMs: 200,
          contextFetchProbability: 0.5,
        },
      },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: "./prompts/system.md",
      tokenLimit: 20000,
    },
    memory: { searchLimit: 10, maxChars: 2000, recentMessageLimit: 20 },
    workspace: { repoPath: "./data", workspacesDir: "workspaces" },
    logging: { level: "INFO" },
    accessControl: { replyTo: "whitelist", whitelist: [] },
    selfResearch: {
      enabled: overrides?.enabled ?? true,
      model: "gpt-5-mini",
      rssFeeds: [{ url: "https://example.com/feed.xml", name: "Test" }],
      minIntervalMs: overrides?.minIntervalMs ?? 50,
      maxIntervalMs: overrides?.maxIntervalMs ?? 60,
    },
  };
}

Deno.test("SelfResearchScheduler - does not start when disabled", () => {
  const config = createConfig({ enabled: false });
  const scheduler = new SelfResearchScheduler(config);
  scheduler.setCallback(async () => {});
  scheduler.start();

  const status = scheduler.getStatus();
  assertEquals(status.nextScheduledAt, null);

  scheduler.stop();
});

Deno.test("SelfResearchScheduler - starts when enabled", () => {
  const config = createConfig({ enabled: true });
  const scheduler = new SelfResearchScheduler(config);
  scheduler.setCallback(async () => {});
  scheduler.start();

  const status = scheduler.getStatus();
  assertEquals(status.nextScheduledAt instanceof Date, true);
  assertEquals(status.isRunning, false);
  assertEquals(status.lastExecutedAt, null);

  scheduler.stop();
});

Deno.test("SelfResearchScheduler - invokes callback on timer trigger", async () => {
  const config = createConfig({ enabled: true, minIntervalMs: 30, maxIntervalMs: 40 });

  let callbackInvoked = false;
  const scheduler = new SelfResearchScheduler(config);
  scheduler.setCallback(() => {
    callbackInvoked = true;
    return Promise.resolve();
  });
  scheduler.start();

  await new Promise((resolve) => setTimeout(resolve, 120));
  assertEquals(callbackInvoked, true);

  scheduler.stop();
});

Deno.test("SelfResearchScheduler - schedules next execution even on callback failure", async () => {
  const config = createConfig({ enabled: true, minIntervalMs: 30, maxIntervalMs: 40 });

  let callCount = 0;
  const scheduler = new SelfResearchScheduler(config);
  scheduler.setCallback(() => {
    callCount++;
    if (callCount === 1) return Promise.reject(new Error("Test failure"));
    return Promise.resolve();
  });
  scheduler.start();

  await new Promise((resolve) => setTimeout(resolve, 200));
  assertEquals(callCount >= 2, true);

  scheduler.stop();
});

Deno.test("SelfResearchScheduler - stop() clears timer", () => {
  const config = createConfig({ enabled: true });
  const scheduler = new SelfResearchScheduler(config);
  scheduler.setCallback(async () => {});
  scheduler.start();

  assertEquals(scheduler.getStatus().nextScheduledAt instanceof Date, true);

  scheduler.stop();
  assertEquals(scheduler.getStatus().nextScheduledAt, null);
});

Deno.test("SelfResearchScheduler - start() is idempotent", () => {
  const config = createConfig({ enabled: true });
  const scheduler = new SelfResearchScheduler(config);
  scheduler.setCallback(async () => {});

  scheduler.start();
  scheduler.start();

  // Should not crash or double-schedule
  assertEquals(scheduler.getStatus().nextScheduledAt instanceof Date, true);

  scheduler.stop();
});

Deno.test("SelfResearchScheduler - lastExecutedAt is set after callback runs", async () => {
  const config = createConfig({ enabled: true, minIntervalMs: 30, maxIntervalMs: 40 });

  const scheduler = new SelfResearchScheduler(config);
  scheduler.setCallback(() => Promise.resolve());
  scheduler.start();

  await new Promise((resolve) => setTimeout(resolve, 120));

  const status = scheduler.getStatus();
  assertEquals(status.lastExecutedAt instanceof Date, true);

  scheduler.stop();
});
