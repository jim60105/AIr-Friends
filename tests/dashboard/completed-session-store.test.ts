// tests/dashboard/completed-session-store.test.ts

import { assertEquals, assertNotStrictEquals } from "@std/assert";
import {
  type CompletedSession,
  CompletedSessionStore,
} from "../../src/dashboard/completed-session-store.ts";

function makeEntry(id: string): CompletedSession {
  return {
    id,
    type: "message",
    platform: "discord",
    userId: "user1",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    status: "success",
    durationMs: 1000,
  };
}

Deno.test("CompletedSessionStore - empty store returns empty array", () => {
  const store = new CompletedSessionStore();
  assertEquals(store.getAll(), []);
});

Deno.test("CompletedSessionStore - add and getAll", () => {
  const store = new CompletedSessionStore();
  const entry = makeEntry("s1");
  store.add(entry);
  const all = store.getAll();
  assertEquals(all.length, 1);
  assertEquals(all[0].id, "s1");
});

Deno.test("CompletedSessionStore - getAll returns copies", () => {
  const store = new CompletedSessionStore();
  store.add(makeEntry("s1"));
  const a = store.getAll();
  const b = store.getAll();
  assertNotStrictEquals(a, b);
});

Deno.test("CompletedSessionStore - ring buffer evicts oldest at 101 entries", () => {
  const store = new CompletedSessionStore();
  for (let i = 0; i < 101; i++) {
    store.add(makeEntry(`s${i}`));
  }
  const all = store.getAll();
  assertEquals(all.length, 100);
  // First entry (s0) should be evicted, s1 should be first
  assertEquals(all[0].id, "s1");
  assertEquals(all[99].id, "s100");
});
