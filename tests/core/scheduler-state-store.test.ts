// tests/core/scheduler-state-store.test.ts

import { assert, assertEquals } from "@std/assert";
import { resolveScheduleTime, SchedulerStateStore } from "@core/scheduler-state-store.ts";

Deno.test("SchedulerStateStore - load returns empty object when file not found", async () => {
  const store = new SchedulerStateStore("/tmp/nonexistent-scheduler-state.json");
  const state = await store.load();
  assertEquals(state, {});
});

Deno.test("SchedulerStateStore - load returns empty object on invalid JSON", async () => {
  const tmpFile = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(tmpFile, "not valid json{{{");
    const store = new SchedulerStateStore(tmpFile);
    const state = await store.load();
    assertEquals(state, {});
  } finally {
    await Deno.remove(tmpFile);
  }
});

Deno.test("SchedulerStateStore - load parses valid JSON file", async () => {
  const tmpFile = await Deno.makeTempFile({ suffix: ".json" });
  try {
    const data = {
      selfResearch: "2025-01-15T14:30:00.000Z",
      gitBackup: "2025-01-15T15:00:00.000Z",
    };
    await Deno.writeTextFile(tmpFile, JSON.stringify(data));
    const store = new SchedulerStateStore(tmpFile);
    const state = await store.load();
    assertEquals(state["selfResearch"], "2025-01-15T14:30:00.000Z");
    assertEquals(state["gitBackup"], "2025-01-15T15:00:00.000Z");
  } finally {
    await Deno.remove(tmpFile);
  }
});

Deno.test("SchedulerStateStore - save and load round-trip", async () => {
  const tmpFile = await Deno.makeTempFile({ suffix: ".json" });
  try {
    const store = new SchedulerStateStore(tmpFile);
    await store.load();
    const nextAt = new Date("2025-01-15T14:30:00.000Z");
    await store.save("selfResearch", nextAt);

    const store2 = new SchedulerStateStore(tmpFile);
    const state = await store2.load();
    assertEquals(state["selfResearch"], "2025-01-15T14:30:00.000Z");
  } finally {
    await Deno.remove(tmpFile);
  }
});

Deno.test("SchedulerStateStore - save accumulates multiple keys in cache", async () => {
  const tmpFile = await Deno.makeTempFile({ suffix: ".json" });
  try {
    const store = new SchedulerStateStore(tmpFile);
    await store.load();
    await store.save("selfResearch", new Date("2025-01-15T14:30:00.000Z"));
    await store.save("gitBackup", new Date("2025-01-15T15:00:00.000Z"));

    const store2 = new SchedulerStateStore(tmpFile);
    const state = await store2.load();
    assertEquals(state["selfResearch"], "2025-01-15T14:30:00.000Z");
    assertEquals(state["gitBackup"], "2025-01-15T15:00:00.000Z");
  } finally {
    await Deno.remove(tmpFile);
  }
});

Deno.test("SchedulerStateStore - save does not throw on write failure", async () => {
  const store = new SchedulerStateStore("/nonexistent/path/state.json");
  await store.load();
  // Should not throw
  await store.save("test", new Date());
});

Deno.test("SchedulerStateStore - remove deletes key from cache", async () => {
  const tmpFile = await Deno.makeTempFile({ suffix: ".json" });
  try {
    const store = new SchedulerStateStore(tmpFile);
    await store.load();
    await store.save("a", new Date("2025-01-15T14:30:00.000Z"));
    await store.save("b", new Date("2025-01-15T15:00:00.000Z"));
    await store.remove("a");

    const store2 = new SchedulerStateStore(tmpFile);
    const state = await store2.load();
    assertEquals(state["a"], undefined);
    assertEquals(state["b"], "2025-01-15T15:00:00.000Z");
  } finally {
    await Deno.remove(tmpFile);
  }
});

Deno.test("SchedulerStateStore - remove does not throw when file missing", async () => {
  const store = new SchedulerStateStore("/nonexistent/path/state.json");
  await store.load();
  // Should not throw
  await store.remove("nonexistent");
});

Deno.test("SchedulerStateStore - load returns shallow copy", async () => {
  const tmpFile = await Deno.makeTempFile({ suffix: ".json" });
  try {
    const store = new SchedulerStateStore(tmpFile);
    await store.load();
    await store.save("test", new Date("2025-01-15T14:30:00.000Z"));

    const state = await store.load();
    state["test"] = "modified";

    // Internal cache should be unaffected
    const state2 = await store.load();
    assertEquals(state2["test"], "2025-01-15T14:30:00.000Z");
  } finally {
    await Deno.remove(tmpFile);
  }
});

// resolveScheduleTime tests

Deno.test("resolveScheduleTime - returns delayMs 0 when restored time is past", () => {
  const pastDate = new Date(Date.now() - 60000);
  const result = resolveScheduleTime(pastDate, 1000, 5000, () => 3000);
  assertEquals(result.delayMs, 0);
});

Deno.test("resolveScheduleTime - reschedules when restored time exceeds max", () => {
  const farFuture = new Date(Date.now() + 999999999);
  const result = resolveScheduleTime(farFuture, 1000, 5000, () => 3000);
  assertEquals(result.delayMs, 3000);
});

Deno.test("resolveScheduleTime - uses restored time within range", () => {
  const futureDate = new Date(Date.now() + 3000);
  const result = resolveScheduleTime(futureDate, 1000, 5000, () => 2000);
  assert(result.delayMs > 2500 && result.delayMs <= 3100);
  assertEquals(result.nextAt, futureDate);
});

Deno.test("resolveScheduleTime - uses restored time even if less than minInterval", () => {
  const futureDate = new Date(Date.now() + 500); // less than min (1000)
  const result = resolveScheduleTime(futureDate, 1000, 5000, () => 2000);
  assert(result.delayMs >= 0 && result.delayMs <= 600);
  assertEquals(result.nextAt, futureDate);
});
