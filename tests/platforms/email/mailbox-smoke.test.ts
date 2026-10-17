// tests/platforms/email/mailbox-smoke.test.ts
//
// Controlled integration smoke test for OpenSpec change `email-mailbox-journal`.
// Verifies scenarios from specs/email-mailbox-state/spec.md:
// 1. First activation boundary survives restart, excluding earlier inbox entries
// 2. Failure is terminal or review-required while later work remains processable
// 3. Crash after agent start quarantines started entry to review-required without re-running agent

import { assertEquals, assertRejects } from "@std/assert";
import {
  buildMailboxFingerprint,
  MailboxKey,
  MailboxStore,
  MailboxStoreError,
} from "../../../src/platforms/email/mailbox-store.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "mailbox-smoke-test-" });
  try {
    await fn(dir);
  } finally {
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

const SMOKE_FINGERPRINT = buildMailboxFingerprint("imap.smoke.test", "bot@smoke.test", "INBOX");
const SMOKE_UIDVALIDITY = 987654321;

function makeKey(uid: number): MailboxKey {
  return { fingerprint: SMOKE_FINGERPRINT, uidValidity: SMOKE_UIDVALIDITY, uid };
}

Deno.test("Smoke Scenario: First activation boundary survives crash and excludes existing inbox entries", async () => {
  await withTempDir(async (root) => {
    // 1. First activation: inbox has existing messages up to UID 250
    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: SMOKE_FINGERPRINT,
    });
    await store.initialize(250, SMOKE_UIDVALIDITY);

    const snap = store.getSnapshot();
    assertEquals(snap?.initializedBoundary, 250);
    assertEquals(snap?.cursor, 250);

    // 2. Bot restarts before any new mail arrives
    const restartedStore = new MailboxStore({
      emailRoot: root,
      fingerprint: SMOKE_FINGERPRINT,
    });
    const recovery = await restartedStore.recover();

    // Verification: existing entries (<= 250) remain excluded, cursor at 250, unstarted is empty
    assertEquals(recovery.initializedBoundary, 250);
    assertEquals(recovery.cursor, 250);
    assertEquals(recovery.unstarted.length, 0);
    assertEquals(recovery.reviewRequired.length, 0);
  });
});

Deno.test("Smoke Scenario: Message failure is terminal or review-required while later work remains processable", async () => {
  await withTempDir(async (root) => {
    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: SMOKE_FINGERPRINT,
    });
    await store.initialize(100, SMOKE_UIDVALIDITY);

    const k101 = makeKey(101);
    const k102 = makeKey(102);

    // 1. UID 101 discovered and fails pre-acceptance (e.g. malformed or auth rejected)
    await store.discover(k101);
    await store.finish(k101, "failed", { detail: "Malformed MIME headers" });
    assertEquals(store.getEntry(k101)?.state, "failed");

    // 2. Later UID 102 discovered and accepted
    await store.discover(k102);
    await store.accept(k102, "source-102");
    assertEquals(store.getEntry(k102)?.state, "accepted");

    // 3. Scan cursor advances past failed message (101) up to 102
    await store.checkpoint(102);
    assertEquals(store.getSnapshot()?.cursor, 102);

    // 4. Later work (102) proceeds through execution
    await store.start(k102, "work-session-102");
    await store.finish(k102, "completed", { workId: "work-session-102" });
    assertEquals(store.getEntry(k102)?.state, "completed");

    // Terminal failed entry (101) cannot be started or accepted again
    await assertRejects(
      () => store.start(k101, "work-101"),
      MailboxStoreError,
      "[INVALID_TRANSITION]",
    );
  });
});

Deno.test("Smoke Scenario: Crash after agent start quarantines to review-required without starting a new agent", async () => {
  await withTempDir(async (root) => {
    const store1 = new MailboxStore({
      emailRoot: root,
      fingerprint: SMOKE_FINGERPRINT,
    });
    await store1.initialize(100, SMOKE_UIDVALIDITY);

    const k101 = makeKey(101);
    await store1.discover(k101);
    await store1.accept(k101, "source-101");
    await store1.start(k101, "agent-run-101");

    // Bot crashes while agent is executing (no finish call)
    // Restart bot and recover
    const store2 = new MailboxStore({
      emailRoot: root,
      fingerprint: SMOKE_FINGERPRINT,
    });
    const recovery = await store2.recover();

    // Verification:
    // k101 is quarantined to review-required (NOT in unstarted queue)
    assertEquals(recovery.unstarted.length, 0);
    assertEquals(recovery.reviewRequired.length, 1);
    assertEquals(recovery.reviewRequired[0].key.uid, 101);
    assertEquals(recovery.reviewRequired[0].state, "review-required");
    assertEquals(recovery.reviewRequired[0].workId, "agent-run-101");

    // Proves that no new agent can be started for k101 without manual review
    await assertRejects(
      () => store2.start(k101, "agent-run-101-retry"),
      MailboxStoreError,
      "[INVALID_TRANSITION]",
    );
  });
});
