// tests/platforms/email/submission-smoke.test.ts
//
// Controlled integration smoke test for `email-submission-state` capability.
// Exercises scenarios defined in `specs/email-submission-state/spec.md`:
// 1. Concurrent repeats: concurrent callers request same logical action -> one reserved, changed payload conflicts.
// 2. Tail lacks outcome: crash leaves submitting record without outcome -> absorbing unknown, zero resubmission.
// 3. Unattributable corrupt intent: journal corruption blocks whole mailbox submission lane.

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  _resetSharedRegistryForTesting,
  EmailOperationKey,
  SubmissionDiagnosticCode,
  SUBMISSIONS_JOURNAL_FILENAME,
  SubmissionStore,
  SubmissionStoreError,
} from "../../../src/platforms/email/submission-store.ts";

async function withIsolatedState(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "submission-smoke-" });
  try {
    _resetSharedRegistryForTesting();
    await fn(dir);
  } finally {
    _resetSharedRegistryForTesting();
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // ignore cleanup
    }
  }
}

Deno.test("Smoke Scenario: Concurrent repeats - Stable logical operation and payload conflict", async () => {
  await withIsolatedState(async (root) => {
    const store = new SubmissionStore(root);
    const key: EmailOperationKey = { workId: "smoke-op-1", actionSlot: "reply" };
    const ownerId = "e_smoke_owner_1";
    const digestA = "sha256-payload-a";
    const digestB = "sha256-payload-b";
    const emlRef = "email/sent/smoke-op-1.eml";

    // Caller 1 & 2 concurrently invoke prepare for the same logical operation
    const [op1, op2] = await Promise.all([
      store.prepare(ownerId, key, digestA, emlRef),
      store.prepare(ownerId, key, digestA, emlRef),
    ]);

    assertEquals(op1.phase, "prepared");
    assertEquals(op1.contentDigest, digestA);
    assertEquals(op2.operationId, op1.operationId);

    // Concurrent race with conflicting payload returns conflict
    await assertRejects(
      () => store.prepare(ownerId, key, digestB, emlRef),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.KEY_PAYLOAD_CONFLICT}]`,
    );

    store.close();
  });
});

Deno.test("Smoke Scenario: Tail lacks outcome - Submitting without outcome becomes unknown, auto-send blocked", async () => {
  await withIsolatedState(async (root) => {
    let externalSmtpSendCalls = 0;

    const key: EmailOperationKey = { workId: "smoke-op-tail", actionSlot: "reply" };
    const ownerId = "e_smoke_owner_tail";

    // 1. Initial process prepares and marks submitting, then halts/crashes
    const store1 = new SubmissionStore(root);
    await store1.prepare(ownerId, key, "digest-tail", "email/sent/tail.eml");
    await store1.markSubmitting(ownerId, key, { verifyEvidence: false });
    externalSmtpSendCalls++; // Outgoing attempt #1 initiated before crash
    store1.close();

    assertEquals(externalSmtpSendCalls, 1);

    // Fresh process restart
    _resetSharedRegistryForTesting();

    // 2. Restart and recovery
    const store2 = new SubmissionStore(root);
    const recovery = await store2.recover();

    assertEquals(recovery.unknownRecovered.length, 1);
    assertEquals(recovery.unknownRecovered[0].operationId, recovery.unknown[0].operationId);
    assertEquals(recovery.unknown[0].phase, "unknown");

    // 3. Sender checks whether it can dispatch:
    // Any automatic send must verify phase is prepared before invoking SMTP
    const snap = store2.lookup(ownerId, key);
    assertEquals(snap?.phase, "unknown");

    if (snap?.phase === "prepared") {
      externalSmtpSendCalls++;
    }

    // Must have made ZERO additional SMTP calls
    assertEquals(externalSmtpSendCalls, 1);

    // Attempting markSubmitting on unknown operation throws INVALID_TRANSITION
    await assertRejects(
      () => store2.markSubmitting(ownerId, key, { verifyEvidence: false }),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.INVALID_TRANSITION}]`,
    );

    store2.close();
  });
});

Deno.test("Smoke Scenario: Unattributable corrupt intent - Whole mailbox submission lane is blocked for review", async () => {
  await withIsolatedState(async (root) => {
    const journalPath = join(root, SUBMISSIONS_JOURNAL_FILENAME);

    // Corrupt the journal directly with garbage bytes
    await Deno.writeTextFile(journalPath, "INVALID_GARBAGE_LINE\n");

    const store = new SubmissionStore(root);

    // Recovery fails with STORE_CORRUPT
    await assertRejects(
      () => store.recover(),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.STORE_CORRUPT}]`,
    );

    // Submission lane is blocked: any subsequent operation reservation is refused
    await assertRejects(
      () =>
        store.prepare(
          "e_owner",
          { workId: "smoke-op-blocked", actionSlot: "reply" },
          "digest",
          "eml",
        ),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED}]`,
    );

    store.close();
  });
});
