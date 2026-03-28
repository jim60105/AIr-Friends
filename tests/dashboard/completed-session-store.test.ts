// tests/dashboard/completed-session-store.test.ts

import { assertEquals, assertNotStrictEquals } from "@std/assert";
import {
  type CompletedSession,
  CompletedSessionStore,
} from "../../src/dashboard/completed-session-store.ts";

function makeEntry(auditSessionId: string, endedAt?: string): CompletedSession {
  return {
    auditSessionId,
    type: "message",
    platform: "discord",
    userId: "user1",
    startedAt: new Date().toISOString(),
    endedAt: endedAt ?? new Date().toISOString(),
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
  const entry = makeEntry("sess_s1");
  store.add(entry);
  const all = store.getAll();
  assertEquals(all.length, 1);
  assertEquals(all[0].auditSessionId, "sess_s1");
});

Deno.test("CompletedSessionStore - getAll returns copies", () => {
  const store = new CompletedSessionStore();
  store.add(makeEntry("sess_s1"));
  const a = store.getAll();
  const b = store.getAll();
  assertNotStrictEquals(a, b);
});

Deno.test("CompletedSessionStore - ring buffer evicts oldest at 101 entries", () => {
  const store = new CompletedSessionStore();
  for (let i = 0; i < 101; i++) {
    store.add(makeEntry(`sess_s${i}`, new Date(Date.now() + i * 1000).toISOString()));
  }
  const all = store.getAll();
  assertEquals(all.length, 100);
  // s0 should be evicted; newest first means s100 is first
  assertEquals(all[0].auditSessionId, "sess_s100");
  assertEquals(all[99].auditSessionId, "sess_s1");
});

Deno.test("CompletedSessionStore - getAll returns newest first", () => {
  const store = new CompletedSessionStore();
  store.add(makeEntry("sess_old", "2024-01-01T00:00:00Z"));
  store.add(makeEntry("sess_new", "2024-06-01T00:00:00Z"));
  store.add(makeEntry("sess_mid", "2024-03-01T00:00:00Z"));
  const all = store.getAll();
  assertEquals(all[0].auditSessionId, "sess_new");
  assertEquals(all[1].auditSessionId, "sess_mid");
  assertEquals(all[2].auditSessionId, "sess_old");
});

Deno.test("CompletedSessionStore - addMany loads multiple sessions", () => {
  const store = new CompletedSessionStore();
  const sessions = [
    makeEntry("sess_a", "2024-01-01T00:00:00Z"),
    makeEntry("sess_b", "2024-02-01T00:00:00Z"),
    makeEntry("sess_c", "2024-03-01T00:00:00Z"),
  ];
  store.addMany(sessions);
  const all = store.getAll();
  assertEquals(all.length, 3);
  assertEquals(all[0].auditSessionId, "sess_c");
});

Deno.test("CompletedSessionStore - addMany respects capacity limit", () => {
  const store = new CompletedSessionStore();
  const sessions: CompletedSession[] = [];
  for (let i = 0; i < 120; i++) {
    sessions.push(makeEntry(`sess_s${i}`, new Date(Date.now() + i * 1000).toISOString()));
  }
  store.addMany(sessions);
  assertEquals(store.getAll().length, 100);
});
