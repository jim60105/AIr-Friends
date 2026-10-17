// tests/platforms/email/submission-store.test.ts
//
// Tests for SubmissionStore owned by `email-submission-journal`.
// Verifies real-file reservation keys, digest conflict detection, serialized transitions,
// torn intents, crash-recovery boundaries, absorbing unknown semantics, exclusive submission claims,
// multi-root isolation, delimiter collision resistance, and zero-resubmission counting seams.

import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  _resetSharedRegistryForTesting,
  computeSha256Hex,
  EmailOperationKey,
  SubmissionDiagnosticCode,
  SUBMISSIONS_JOURNAL_FILENAME,
  SubmissionStore,
  SubmissionStoreError,
} from "../../../src/platforms/email/submission-store.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "submission-store-test-" });
  try {
    _resetSharedRegistryForTesting();
    await fn(dir);
  } finally {
    _resetSharedRegistryForTesting();
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

const DEFAULT_OWNER = "e_user1234567890abcdef";

function makeKey(workId: string, actionSlot = "reply"): EmailOperationKey {
  return { workId, actionSlot };
}

Deno.test("SubmissionStore - 1.1 Reservation keys, digest conflict detection, and idempotent repetition", async () => {
  await withTempDir(async (root) => {
    const store = new SubmissionStore(root);

    const key = makeKey("work-1", "reply");
    const digest1 = "sha256-abcdef123456";
    const emlRef1 = "email/sent/work-1.eml";

    // 1. Initial reservation succeeds
    const snap1 = await store.prepare(DEFAULT_OWNER, key, digest1, emlRef1, {
      targetKind: "user",
      recipientRef: "user@example.com",
    });
    assertEquals(snap1.phase, "prepared");
    assertEquals(snap1.ownerId, DEFAULT_OWNER);
    assertEquals(snap1.contentDigest, digest1);
    assertEquals(snap1.emlRef, emlRef1);
    assertEquals(snap1.targetKind, "user");
    assertEquals(snap1.sentCopy, "pending");
    assertNotEquals(snap1.operationId, "");

    // 2. Lookup finds it by key and by operationId
    const foundByKey = store.lookup(DEFAULT_OWNER, key);
    assertEquals(foundByKey?.operationId, snap1.operationId);
    const foundById = store.lookupById(snap1.operationId);
    assertEquals(foundById?.key.workId, "work-1");

    // 3. Repeated reservation with IDENTICAL digest returns existing snapshot (idempotent)
    const snapRepeat = await store.prepare(DEFAULT_OWNER, key, digest1, emlRef1);
    assertEquals(snapRepeat.operationId, snap1.operationId);
    assertEquals(snapRepeat.firstPreparedAt, snap1.firstPreparedAt);

    // 4. Repeated reservation with CHANGED digest throws KEY_PAYLOAD_CONFLICT
    await assertRejects(
      () => store.prepare(DEFAULT_OWNER, key, "sha256-different-digest", emlRef1),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.KEY_PAYLOAD_CONFLICT}]`,
    );

    // 5. Different action slot with same workId represents a distinct operation
    const fileKey = makeKey("work-1", "files");
    const fileSnap = await store.prepare(
      DEFAULT_OWNER,
      fileKey,
      "sha256-files-digest",
      "email/sent/work-1-files.eml",
    );
    assertNotEquals(fileSnap.operationId, snap1.operationId);
    assertEquals(fileSnap.key.actionSlot, "files");

    store.close();
  });
});

Deno.test("SubmissionStore - 1.2 Full lifecycle transitions, exclusive submitting, and terminal immutability", async () => {
  await withTempDir(async (root) => {
    const store = new SubmissionStore(root);

    const key = makeKey("work-lifecycle", "reply");
    const digest = "sha256-lifecycle-digest";
    const emlRef = "email/sent/lifecycle.eml";

    // Prepare
    const prep = await store.prepare(DEFAULT_OWNER, key, digest, emlRef);
    assertEquals(prep.phase, "prepared");

    // Cannot transition terminal outcome from prepared directly (must be submitting)
    await assertRejects(
      () => store.recordOutcome(DEFAULT_OWNER, key, "submitted"),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.INVALID_TRANSITION}]`,
    );

    // Mark submitting without evidence verification check for pure transition test
    const submitting = await store.markSubmitting(DEFAULT_OWNER, key, { verifyEvidence: false });
    assertEquals(submitting.phase, "submitting");

    // Exclusive submitting: second caller attempting markSubmitting is rejected!
    await assertRejects(
      () => store.markSubmitting(DEFAULT_OWNER, key, { verifyEvidence: false }),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.OPERATION_ALREADY_SUBMITTING}]`,
    );

    // Record outcome: submitted
    const submitted = await store.recordOutcome(DEFAULT_OWNER, key, "submitted", {
      wireMessageId: "<wire-msg-123@example.com>",
    });
    assertEquals(submitted.phase, "submitted");
    assertEquals(submitted.wireMessageId, "<wire-msg-123@example.com>");

    // Terminal outcome is immutable: cannot transition submitted -> failed or unknown
    await assertRejects(
      () => store.recordOutcome(DEFAULT_OWNER, key, "failed"),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.INVALID_TRANSITION}]`,
    );
    await assertRejects(
      () => store.recordOutcome(DEFAULT_OWNER, key, "unknown"),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.INVALID_TRANSITION}]`,
    );

    // Repeating submitted is idempotent
    const submittedRepeat = await store.recordOutcome(DEFAULT_OWNER, key, "submitted");
    assertEquals(submittedRepeat.phase, "submitted");

    // Update sent-copy
    assertEquals(submitted.sentCopy, "pending");
    const sentAppended = await store.updateSentCopy(DEFAULT_OWNER, key, "appended");
    assertEquals(sentAppended.sentCopy, "appended");
    assertEquals(sentAppended.phase, "submitted"); // Phase preserved!

    // Sent copy cannot regress from appended to failed
    const sentRegressAttempt = await store.updateSentCopy(DEFAULT_OWNER, key, "failed");
    assertEquals(sentRegressAttempt.sentCopy, "appended");

    store.close();
  });
});

Deno.test("SubmissionStore - 1.3 Sent copy failure preserves submitted state", async () => {
  await withTempDir(async (root) => {
    const store = new SubmissionStore(root);
    const key = makeKey("work-sent-copy-fail", "reply");

    await store.prepare(DEFAULT_OWNER, key, "digest-copy-fail", "email/sent/copy-fail.eml");
    await store.markSubmitting(DEFAULT_OWNER, key, { verifyEvidence: false });
    await store.recordOutcome(DEFAULT_OWNER, key, "submitted");

    // Sent copy fails
    const updated = await store.updateSentCopy(DEFAULT_OWNER, key, "failed");
    assertEquals(updated.sentCopy, "failed");
    assertEquals(updated.phase, "submitted"); // CRITICAL: submitted is never downgraded!

    store.close();
  });
});

Deno.test("SubmissionStore - 1.4 Startup recovery: unclosed submitting converts durably to absorbing unknown", async () => {
  await withTempDir(async (root) => {
    // 1. Simulate process 1 running and crashing during SMTP dispatch
    const store1 = new SubmissionStore(root);
    const key1 = makeKey("crash-work-1", "reply");
    const key2 = makeKey("prep-work-2", "files");

    await store1.prepare(DEFAULT_OWNER, key1, "digest-crash-1", "email/sent/crash-1.eml");
    await store1.markSubmitting(DEFAULT_OWNER, key1, { verifyEvidence: false });
    // Process 1 "crashes" here while key1 is in "submitting"!

    await store1.prepare(DEFAULT_OWNER, key2, "digest-prep-2", "email/sent/prep-2.eml");
    // key2 remains in "prepared"

    store1.close();

    // Reset module-level in-memory state to simulate fresh process restart
    _resetSharedRegistryForTesting();

    // 2. Process 2 restarts and calls recover()
    const store2 = new SubmissionStore(root);
    const recovery = await store2.recover();

    assertEquals(recovery.totalTracked, 2);
    assertEquals(recovery.unknownRecovered.length, 1);
    assertEquals(recovery.unknownRecovered[0].key.workId, "crash-work-1");
    assertEquals(recovery.unknownRecovered[0].phase, "unknown");

    assertEquals(recovery.prepared.length, 1);
    assertEquals(recovery.prepared[0].key.workId, "prep-work-2");
    assertEquals(recovery.prepared[0].phase, "prepared");

    // 3. Inspect recovered state: key1 is absorbing unknown
    const snap1 = store2.lookup(DEFAULT_OWNER, key1);
    assertEquals(snap1?.phase, "unknown");

    // Attempting to markSubmitting on unknown operation MUST fail
    await assertRejects(
      () => store2.markSubmitting(DEFAULT_OWNER, key1, { verifyEvidence: false }),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.INVALID_TRANSITION}]`,
    );

    // Attempting to record outcome submitted on unknown operation MUST fail
    await assertRejects(
      () => store2.recordOutcome(DEFAULT_OWNER, key1, "submitted"),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.INVALID_TRANSITION}]`,
    );

    // Second recovery attempt rejected (recover is startup-only)
    await assertRejects(
      () => store2.recover(),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.INVALID_TRANSITION}]`,
    );

    store2.close();
  });
});

Deno.test("SubmissionStore - 1.5 Real file replay and counting test seam for zero resubmission", async () => {
  await withTempDir(async (root) => {
    // Counting seam for external SMTP side-effects
    let smtpAttempts = 0;
    async function fakeSmtpSend(key: EmailOperationKey, store: SubmissionStore): Promise<void> {
      try {
        await store.markSubmitting(DEFAULT_OWNER, key, { verifyEvidence: false });
      } catch {
        return; // Exclusivity or phase gate rejected send!
      }
      smtpAttempts++;
      // Simulate successful send
      await store.recordOutcome(DEFAULT_OWNER, key, "submitted");
    }

    const key = makeKey("counting-work", "reply");

    // First run prepares and simulates crash during SMTP
    const store1 = new SubmissionStore(root);
    await store1.prepare(DEFAULT_OWNER, key, "digest-count", "email/sent/count.eml");
    await store1.markSubmitting(DEFAULT_OWNER, key, { verifyEvidence: false });
    smtpAttempts++; // First attempt made
    store1.close();

    // Crash happens. Total SMTP attempts so far: 1
    assertEquals(smtpAttempts, 1);

    // Fresh restart and recover
    _resetSharedRegistryForTesting();
    const store2 = new SubmissionStore(root);
    const recovery = await store2.recover();
    assertEquals(recovery.unknownRecovered.length, 1);

    // Smtp sender evaluates whether to send
    await fakeSmtpSend(key, store2);

    // VERIFICATION: SMTP attempts must remain exactly 1! Zero additional sends.
    assertEquals(smtpAttempts, 1);

    store2.close();
  });
});

Deno.test("SubmissionStore - 1.6 Torn tail and interior corruption fail closed and prohibit append", async () => {
  await withTempDir(async (root) => {
    const journalPath = join(root, SUBMISSIONS_JOURNAL_FILENAME);

    // 1. Write one valid record
    const store1 = new SubmissionStore(root);
    const key = makeKey("work-torn", "reply");
    await store1.prepare(DEFAULT_OWNER, key, "digest-torn", "email/sent/torn.eml");
    store1.close();

    // Append a torn trailing line directly to file (e.g. truncated JSON without newline)
    const tornLine = '{"v":1,"seq":2,"data":{"operationId":"op_torn","phase":"submitt';
    await Deno.writeTextFile(journalPath, tornLine, { append: true });
    const bytesBefore = await Deno.readFile(journalPath);

    _resetSharedRegistryForTesting();

    // Startup recovery must fail with STORE_CORRUPT
    const store2 = new SubmissionStore(root);
    await assertRejects(
      () => store2.recover(),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.STORE_CORRUPT}]`,
    );

    // Subsequent appends must be refused with STORE_DAMAGED_APPEND_REFUSED
    await assertRejects(
      () => store2.prepare(DEFAULT_OWNER, makeKey("work-after-torn"), "digest", "eml"),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED}]`,
    );

    // Byte-for-byte evidence preservation: damaged journal was NOT trimmed or altered!
    const bytesAfter = await Deno.readFile(journalPath);
    assertEquals(bytesAfter, bytesBefore);

    store2.close();
  });
});

Deno.test("SubmissionStore - 1.7 Real SHA-256 evidence verification gates markSubmitting", async () => {
  await withTempDir(async (root) => {
    const store = new SubmissionStore(root);
    const key = makeKey("work-evidence", "reply");
    const emlRel = "email/sent/evidence.eml";
    const emlAbs = join(root, emlRel);

    const messageContent = new TextEncoder().encode(
      "From: me@example.com\r\nSubject: Test\r\n\r\nHello",
    );
    const realDigest = computeSha256Hex(messageContent);

    // Prepare operation with real digest
    await store.prepare(DEFAULT_OWNER, key, realDigest, emlRel);

    // 1. Evidence file is missing: markSubmitting fails with MISSING_SUBMISSION_EVIDENCE
    await assertRejects(
      () => store.markSubmitting(DEFAULT_OWNER, key),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.MISSING_SUBMISSION_EVIDENCE}]`,
    );

    // 2. Create evidence file with corrupted/wrong bytes: markSubmitting fails with EVIDENCE_DIGEST_MISMATCH
    await Deno.mkdir(join(root, "email", "sent"), { recursive: true });
    await Deno.writeFile(emlAbs, new TextEncoder().encode("Different altered content"));

    await assertRejects(
      () => store.markSubmitting(DEFAULT_OWNER, key),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.EVIDENCE_DIGEST_MISMATCH}]`,
    );

    // 3. Write real matching content: markSubmitting succeeds!
    await Deno.writeFile(emlAbs, messageContent);
    const snap = await store.markSubmitting(DEFAULT_OWNER, key);
    assertEquals(snap.phase, "submitting");

    store.close();
  });
});

Deno.test("SubmissionStore - 1.8 Multi-root isolation, cross-owner scope, and delimiter safety", async () => {
  await withTempDir(async (rootA) => {
    await withTempDir(async (rootB) => {
      const storeA = new SubmissionStore(rootA);
      const storeB = new SubmissionStore(rootB);

      const ownerA = "e_owner_aaaaaa";
      const ownerB = "e_owner_bbbbbb";
      const sharedKey = makeKey("shared-work-id", "reply");

      // Reserve in Store A
      const snapA = await storeA.prepare(ownerA, sharedKey, "digest-a", "sent/a.eml");

      // 1. Multi-root isolation: Store B cannot see Store A's entry
      assertEquals(storeB.lookup(ownerA, sharedKey), undefined);
      assertEquals(storeB.lookupById(snapA.operationId), undefined);

      // 2. Cross-owner scope: Same store, different owners do NOT collide
      const snapB = await storeA.prepare(ownerB, sharedKey, "digest-b", "sent/b.eml");
      assertNotEquals(snapA.operationId, snapB.operationId);
      assertEquals(storeA.lookup(ownerA, sharedKey)?.contentDigest, "digest-a");
      assertEquals(storeA.lookup(ownerB, sharedKey)?.contentDigest, "digest-b");

      // 3. Delimiter collision safety: w="a:s:b", s="c" vs w="a", s="b:s:c"
      const colKey1 = makeKey("a:s:b", "c");
      const colKey2 = makeKey("a", "b:s:c");
      const colSnap1 = await storeA.prepare(ownerA, colKey1, "digest-col1", "sent/col1.eml");
      const colSnap2 = await storeA.prepare(ownerA, colKey2, "digest-col2", "sent/col2.eml");
      assertNotEquals(colSnap1.operationId, colSnap2.operationId);
      assertEquals(storeA.lookup(ownerA, colKey1)?.contentDigest, "digest-col1");
      assertEquals(storeA.lookup(ownerA, colKey2)?.contentDigest, "digest-col2");

      storeA.close();
      storeB.close();
    });
  });
});
