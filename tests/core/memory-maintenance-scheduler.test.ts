import { assertEquals } from "@std/assert";
import { MemoryMaintenanceScheduler } from "@core/memory-maintenance-scheduler.ts";
import type { MemoryMaintenanceConfig } from "../../src/types/config.ts";

function createConfig(overrides?: Partial<MemoryMaintenanceConfig>): MemoryMaintenanceConfig {
  return {
    enabled: true,
    model: "gpt-5-mini",
    minMemoryCount: 50,
    intervalMs: 30,
    ...overrides,
  };
}

Deno.test("MemoryMaintenanceScheduler - disabled config does not start scheduler", () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ enabled: false }));
  scheduler.setCallback(async () => {});
  scheduler.start();

  assertEquals(scheduler.getStatus().nextScheduledAt, null);
  scheduler.stop();
});

Deno.test("MemoryMaintenanceScheduler - scheduleNext sets correct interval", () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 100 }));
  scheduler.setCallback(async () => {});

  const before = Date.now();
  scheduler.start();
  const next = scheduler.getStatus().nextScheduledAt;
  assertEquals(next instanceof Date, true);

  const delta = (next as Date).getTime() - before;
  assertEquals(delta >= 80 && delta <= 200, true);
  scheduler.stop();
});

Deno.test("MemoryMaintenanceScheduler - prevents concurrent execution", async () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 20 }));
  let running = false;
  let overlapDetected = false;
  let callCount = 0;

  scheduler.setCallback(async () => {
    if (running) overlapDetected = true;
    running = true;
    callCount++;
    await new Promise((resolve) => setTimeout(resolve, 80));
    running = false;
  });
  scheduler.start();

  await new Promise((resolve) => setTimeout(resolve, 220));
  scheduler.stop();

  assertEquals(overlapDetected, false);
  assertEquals(callCount >= 2, true);
});

Deno.test("MemoryMaintenanceScheduler - reschedules after error", async () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 20 }));
  let callCount = 0;

  scheduler.setCallback(async () => {
    callCount++;
    if (callCount === 1) {
      throw new Error("expected");
    }
  });
  scheduler.start();

  await new Promise((resolve) => setTimeout(resolve, 140));
  scheduler.stop();

  assertEquals(callCount >= 2, true);
});

Deno.test("MemoryMaintenanceScheduler - stop clears timer", () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig());
  scheduler.setCallback(async () => {});
  scheduler.start();

  assertEquals(scheduler.getStatus().nextScheduledAt instanceof Date, true);
  scheduler.stop();
  assertEquals(scheduler.getStatus().nextScheduledAt, null);
});
