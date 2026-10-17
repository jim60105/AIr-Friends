// tests/platforms/email/mailbox-store.test.ts
//
// Tests for MailboxStore owned by `email-mailbox-journal`.
// Verifies real-file state machine transitions, crash recovery boundaries,
// atomic snapshot replacement, torn-tail preservation, immutable identity,
// and monotonic cursor advancement.

import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import {
  buildMailboxFingerprint,
  MailboxEntryRecord,
  MailboxKey,
  MailboxStore,
  MailboxStoreError,
} from "../../../src/platforms/email/mailbox-store.ts";
import {
  appendDurable,
  DurableDiagnosticCode,
} from "../../../src/platforms/email/durable-files.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "mailbox-store-test-" });
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

const DEFAULT_FINGERPRINT = buildMailboxFingerprint("imap.example.com", "bot@example.com", "INBOX");
const DEFAULT_UIDVALIDITY = 123456789;

function makeKey(
  uid: number,
  fingerprint = DEFAULT_FINGERPRINT,
  uidValidity = DEFAULT_UIDVALIDITY,
): MailboxKey {
  return { fingerprint, uidValidity, uid };
}

Deno.test("MailboxStore - 1.1 First activation boundary and initial cursor", async () => {
  await withTempDir(async (root) => {
    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });

    // Before initialization, operations reject with NOT_INITIALIZED
    await assertRejects(
      () => store.checkpoint(10),
      MailboxStoreError,
      "[NOT_INITIALIZED]",
    );

    // Initial recovery on empty directory returns clean empty state
    const emptyRecovery = await store.recover();
    assertEquals(emptyRecovery.cursor, 0);
    assertEquals(emptyRecovery.unstarted.length, 0);

    // Initialize at boundary 100
    await store.initialize(100, DEFAULT_UIDVALIDITY);

    const snapshot = store.getSnapshot();
    assertEquals(snapshot?.fingerprint, DEFAULT_FINGERPRINT);
    assertEquals(snapshot?.initializedBoundary, 100);
    assertEquals(snapshot?.cursor, 100);
    assertEquals(snapshot?.uidValidity, DEFAULT_UIDVALIDITY);

    // Re-initialization with identical parameters is idempotent
    await store.initialize(100, DEFAULT_UIDVALIDITY);

    // Re-initialization with different boundary fails
    await assertRejects(
      () => store.initialize(200, DEFAULT_UIDVALIDITY),
      MailboxStoreError,
      "[ALREADY_INITIALIZED]",
    );

    // Reopen in a new store instance: snapshot survives crash/restart
    const reopened = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });
    const recovery = await reopened.recover();
    assertEquals(recovery.initializedBoundary, 100);
    assertEquals(recovery.cursor, 100);
    assertEquals(recovery.uidValidity, DEFAULT_UIDVALIDITY);
    assertEquals(recovery.unstarted.length, 0);
  });
});

Deno.test("MailboxStore - 4.1 Fingerprint preserves account case and escapes delimiters", () => {
  const fp1 = buildMailboxFingerprint("imap.example.com", "Bot@example.com", "INBOX");
  const fp2 = buildMailboxFingerprint("imap.example.com", "bot@example.com", "INBOX");
  assertEquals(fp1 === fp2, false); // case sensitivity preserved

  const fpColons = buildMailboxFingerprint("imap.example.com", "user:name", "INBOX:Sub");
  assertEquals(fpColons.includes("%3A"), true);
});

Deno.test("MailboxStore - 4.2 Queued mutations fail closed when prior mutation poisons store", async () => {
  await withTempDir(async (root) => {
    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
      durableOptions: { maxRecordBytes: 10 }, // tiny record limit to cause write error
    });
    await store.initialize(100, DEFAULT_UIDVALIDITY);

    const k101 = makeKey(101);
    const k102 = makeKey(102);

    // Both mutations queued concurrently; first fails due to size limit, poisoning store
    const p1 = store.accept(k101, "a-very-long-source-record-id-exceeding-limit");
    const p2 = store.accept(k102, "short");

    await assertRejects(() => p1);
    await assertRejects(
      () => p2,
      MailboxStoreError,
      "[STORE_DAMAGED_APPEND_REFUSED]",
    );
  });
});

Deno.test("MailboxStore - 4.3 Direct initialize with orphaned journal fails closed", async () => {
  await withTempDir(async (root) => {
    const record: MailboxEntryRecord = {
      key: makeKey(101),
      state: "accepted",
      sourceRecordId: "rec-101",
      timestamp: new Date().toISOString(),
    };
    await appendDurable(root, "processing.jsonl", record);

    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });

    // initialize() must check journal and refuse to bypass existing journal evidence
    await assertRejects(
      () => store.initialize(100, DEFAULT_UIDVALIDITY),
      MailboxStoreError,
      "[MISSING_SNAPSHOT_WITH_JOURNAL]",
    );
  });
});

Deno.test("MailboxStore - 4.4 recover() is startup-only and rejects calls on active store", async () => {
  await withTempDir(async (root) => {
    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });
    await store.initialize(100, DEFAULT_UIDVALIDITY);

    await assertRejects(
      () => store.recover(),
      MailboxStoreError,
      "[INVALID_TRANSITION]",
    );
  });
});

Deno.test("MailboxStore - 1.2 Changed fingerprint fails closed", async () => {
  await withTempDir(async (root) => {
    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });
    await store.initialize(50, DEFAULT_UIDVALIDITY);

    // Reopen with different host/account
    const differentFingerprint = buildMailboxFingerprint(
      "imap.diff.com",
      "other@diff.com",
      "INBOX",
    );
    const diffStore = new MailboxStore({
      emailRoot: root,
      fingerprint: differentFingerprint,
    });

    await assertRejects(
      () => diffStore.recover(),
      MailboxStoreError,
      "[FINGERPRINT_MISMATCH]",
    );
  });
});

Deno.test("MailboxStore - 1.3 Missing snapshot with existing journal fails closed", async () => {
  await withTempDir(async (root) => {
    // Append a record directly to processing.jsonl without mailbox.json
    const record: MailboxEntryRecord = {
      key: makeKey(1),
      state: "accepted",
      sourceRecordId: "rec-1",
      timestamp: new Date().toISOString(),
    };
    await appendDurable(root, "processing.jsonl", record);

    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });

    await assertRejects(
      () => store.recover(),
      MailboxStoreError,
      "[MISSING_SNAPSHOT_WITH_JOURNAL]",
    );
  });
});

Deno.test("MailboxStore - 2.1 State machine: discovered -> accepted -> started -> completed", async () => {
  await withTempDir(async (root) => {
    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });
    await store.initialize(100, DEFAULT_UIDVALIDITY);

    const key = makeKey(101);

    // 1. Discover
    await store.discover(key);
    let entry = store.getEntry(key);
    assertEquals(entry?.state, "discovered");

    // Idempotent discover
    await store.discover(key);
    assertEquals(store.getEntry(key)?.state, "discovered");

    // Cannot start from discovered
    await assertRejects(
      () => store.start(key, "work-101"),
      MailboxStoreError,
      "[INVALID_TRANSITION]",
    );

    // 2. Accept
    await store.accept(key, "source-msg-101");
    entry = store.getEntry(key);
    assertEquals(entry?.state, "accepted");
    assertEquals(entry?.sourceRecordId, "source-msg-101");

    // Idempotent accept with same sourceRecordId
    await store.accept(key, "source-msg-101");

    // Accept with different sourceRecordId rejected
    await assertRejects(
      () => store.accept(key, "different-source"),
      MailboxStoreError,
      "[IMMUTABLE_ID_MISMATCH]",
    );

    // 3. Start
    await store.start(key, "work-101");
    entry = store.getEntry(key);
    assertEquals(entry?.state, "started");
    assertEquals(entry?.workId, "work-101");
    assertEquals(entry?.sourceRecordId, "source-msg-101");

    // Cannot start again
    await assertRejects(
      () => store.start(key, "work-101-second"),
      MailboxStoreError,
      "[INVALID_TRANSITION]",
    );

    // 4. Finish completed
    await store.finish(key, "completed", { workId: "work-101" });
    entry = store.getEntry(key);
    assertEquals(entry?.state, "completed");

    // Terminal idempotency
    await store.finish(key, "completed", { workId: "work-101" });

    // Terminal transition to another outcome rejected
    await assertRejects(
      () => store.finish(key, "failed"),
      MailboxStoreError,
      "[INVALID_TRANSITION]",
    );
  });
});

Deno.test("MailboxStore - 2.2 Pre-acceptance terminal failures isolate malformed entries", async () => {
  await withTempDir(async (root) => {
    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });
    await store.initialize(100, DEFAULT_UIDVALIDITY);

    const badKey = makeKey(101);
    const goodKey = makeKey(102);

    await store.discover(badKey);

    // Malformed message fails directly from discovered to failed (terminal)
    await store.finish(badKey, "failed", { detail: "Authentication rejected or malformed MIME" });
    assertEquals(store.getEntry(badKey)?.state, "failed");

    // Good key accepted
    await store.discover(goodKey);
    await store.accept(goodKey, "rec-102");

    // Checkpoint can advance past the badKey because it is in a terminal state (not stuck discovered)
    await store.checkpoint(102);
    assertEquals(store.getSnapshot()?.cursor, 102);
  });
});

Deno.test("MailboxStore - 2.3 Checkpoint refuses to advance past discovered entries", async () => {
  await withTempDir(async (root) => {
    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });
    await store.initialize(100, DEFAULT_UIDVALIDITY);

    const k101 = makeKey(101);
    const k102 = makeKey(102);

    await store.discover(k101);
    await store.discover(k102);

    // k102 is accepted, but k101 is still discovered
    await store.accept(k102, "rec-102");

    // Attempting to checkpoint to 102 must be rejected to prevent skipping k101
    await assertRejects(
      () => store.checkpoint(102),
      MailboxStoreError,
      "[CHECKPOINT_SKIPS_DISCOVERED]",
    );

    // Once k101 is ignored or accepted, checkpoint succeeds
    await store.finish(k101, "ignored", { detail: "Filtered sender" });
    await store.checkpoint(102);
    assertEquals(store.getSnapshot()?.cursor, 102);
  });
});

Deno.test("MailboxStore - 2.4 Monotonic cursor enforcement rejects regressions", async () => {
  await withTempDir(async (root) => {
    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });
    await store.initialize(100, DEFAULT_UIDVALIDITY);

    await store.checkpoint(150);
    assertEquals(store.getSnapshot()?.cursor, 150);

    // Regressing cursor rejected
    await assertRejects(
      () => store.checkpoint(120),
      MailboxStoreError,
      "[CHECKPOINT_REGRESSION]",
    );
  });
});

Deno.test("MailboxStore - 3.1 Crash recovery: unstarted accepted resumes; started work quarantined to review-required", async () => {
  await withTempDir(async (root) => {
    // Session 1: process several items then simulate crash
    const store1 = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });
    await store1.initialize(100, DEFAULT_UIDVALIDITY);

    const k101 = makeKey(101);
    const k102 = makeKey(102);
    const k103 = makeKey(103);

    // 101: accepted but not started
    await store1.discover(k101);
    await store1.accept(k101, "rec-101");

    // 102: started but crashed before finish
    await store1.discover(k102);
    await store1.accept(k102, "rec-102");
    await store1.start(k102, "work-102");

    // 103: started and completed
    await store1.discover(k103);
    await store1.accept(k103, "rec-103");
    await store1.start(k103, "work-103");
    await store1.finish(k103, "completed", { workId: "work-103" });

    // Advance discovery cursor
    await store1.checkpoint(103);

    // Simulate crash: do NOT call close cleanly, instantiate store2
    const store2 = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });

    const recovery = await store2.recover();
    assertEquals(recovery.cursor, 103);

    // 101 must be in unstarted queue
    assertEquals(recovery.unstarted.length, 1);
    assertEquals(recovery.unstarted[0].key.uid, 101);
    assertEquals(recovery.unstarted[0].sourceRecordId, "rec-101");

    // 102 must be in reviewRequired queue
    assertEquals(recovery.reviewRequired.length, 1);
    assertEquals(recovery.reviewRequired[0].key.uid, 102);
    assertEquals(recovery.reviewRequired[0].state, "review-required");
    assertEquals(recovery.reviewRequired[0].sourceRecordId, "rec-102");
    assertEquals(recovery.reviewRequired[0].workId, "work-102");

    // 103 is completed
    const e103 = store2.getEntry(k103);
    assertEquals(e103?.state, "completed");

    // The quarantine of 102 was durably appended to processing.jsonl:
    // A subsequent restart (store3) should read 102 as review-required directly
    const store3 = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });
    const recovery3 = await store3.recover();
    assertEquals(recovery3.reviewRequired.length, 1);
    assertEquals(recovery3.reviewRequired[0].key.uid, 102);
    assertEquals(recovery3.unstarted.length, 1);
    assertEquals(recovery3.unstarted[0].key.uid, 101);
  });
});

Deno.test("MailboxStore - 3.2 Corrupt or torn-tail journal halts recovery without erasing evidence", async () => {
  await withTempDir(async (root) => {
    const store1 = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });
    await store1.initialize(100, DEFAULT_UIDVALIDITY);

    const k101 = makeKey(101);
    await store1.discover(k101);
    await store1.accept(k101, "rec-101");

    // Append torn line to processing.jsonl
    const journalPath = resolve(root, "processing.jsonl");
    const tornBytes = new TextEncoder().encode('{"v":1,"seq":3,"data":{"key":{"fingerprint');
    const f = await Deno.open(journalPath, { append: true });
    await f.write(tornBytes);
    f.close();

    const store2 = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });

    // Recovery must detect torn-tail and fail closed
    const err = await assertRejects(
      () => store2.recover(),
      MailboxStoreError,
      "[STORE_CORRUPT]",
    );
    assertEquals(err.durableCode, DurableDiagnosticCode.TORN_TAIL_MISSING_NEWLINE);

    // Verify torn evidence is preserved on disk
    const rawContent = await Deno.readTextFile(journalPath);
    assertEquals(rawContent.includes('{"key":{"fingerprint'), true);

    // Further mutation on damaged store is rejected
    await assertRejects(
      () => store2.discover(makeKey(105)),
      MailboxStoreError,
      "[STORE_DAMAGED_APPEND_REFUSED]",
    );
  });
});

Deno.test("MailboxStore - 3.3 Unknown UIDVALIDITY or mismatched key rejected", async () => {
  await withTempDir(async (root) => {
    const store = new MailboxStore({
      emailRoot: root,
      fingerprint: DEFAULT_FINGERPRINT,
    });
    await store.initialize(100, DEFAULT_UIDVALIDITY);

    // Key with different UIDVALIDITY
    const wrongValidityKey = makeKey(101, DEFAULT_FINGERPRINT, 999999);
    await assertRejects(
      () => store.discover(wrongValidityKey),
      MailboxStoreError,
      "[UIDVALIDITY_MISMATCH]",
    );

    // Key with different fingerprint
    const wrongFingerprintKey = makeKey(101, "wrong:fp:box", DEFAULT_UIDVALIDITY);
    await assertRejects(
      () => store.discover(wrongFingerprintKey),
      MailboxStoreError,
      "[FINGERPRINT_MISMATCH]",
    );
  });
});
