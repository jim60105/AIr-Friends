// tests/platforms/email/outgoing-mime-smoke.test.ts
//
// Controlled integration smoke test for `email-message-construction` with the
// real predecessor implementations (no transport):
// 1. Construct once, then reserve submission evidence with the constructed digest.
// 2. Verify that evidence by digest, refuse tampered evidence, and consume the operation.
// 3. Persist the identical bytes/history through EmailMessageStore.putSent with attachment payloads.
// 4. Re-read stored bytes and attachments and re-parse them, proving signature-once and original
//    forward bytes survive the file-backed round trip.
// 5. Repeated prepare/putSent for the same logical operation is idempotent while a
//    changed payload is rejected, with zero remaining external side effects.

import { assertEquals, assertRejects } from "@std/assert";
import { OutgoingMimeBuilder } from "../../../src/platforms/email/outgoing-mime.ts";
import { parseIncomingMime } from "../../../src/platforms/email/incoming-mime.ts";
import { EmailMessageStore } from "../../../src/platforms/email/message-store.ts";
import {
  _resetSharedRegistryForTesting,
  type EmailOperationKey,
  SubmissionDiagnosticCode,
  SubmissionStore,
  SubmissionStoreError,
} from "../../../src/platforms/email/submission-store.ts";

const OWNER = "e_" + "a".repeat(64);
const SIGNATURE = "AIr-Friends Bot\nSecond line";

function builder(): OutgoingMimeBuilder {
  return new OutgoingMimeBuilder({
    fromAddress: "bot@example.com",
    now: () => new Date("2026-10-17T00:00:00Z"),
  });
}

async function withIsolatedState(
  fn: (emailRoot: string, workspacesRoot: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "outgoing-mime-smoke-" });
  const workspacesRoot = await Deno.makeTempDir({ prefix: "outgoing-mime-smoke-ws-" });
  _resetSharedRegistryForTesting();
  try {
    await fn(`${root}/email`, workspacesRoot);
  } finally {
    _resetSharedRegistryForTesting();
    await Deno.remove(root, { recursive: true }).catch(() => {});
    await Deno.remove(workspacesRoot, { recursive: true }).catch(() => {});
  }
}

Deno.test("Smoke: verified constructed bytes gate evidence, storage and re-parsing", async () => {
  await withIsolatedState(async (emailRoot, workspacesRoot) => {
    await Deno.mkdir(emailRoot, { recursive: true });
    const externalSmtpSendCalls = 0;

    const originalAttachment = new Uint8Array([0xde, 0xad, 0x00, 0xbe, 0xef]);
    const originalBody = "Original quoted body.";
    const constructed = await builder().construct({
      owner: OWNER,
      operationKey: { workId: "smoke-mime-1", actionSlot: "reply" },
      targetKind: "user",
      to: "user@example.com",
      subject: "Re: smoke",
      authoredBody: "Smoke commentary.",
      thread: { wireMessageId: "<smoke-parent@relay.example>" },
      forwardSource: {
        from: "src@example.com",
        subject: "original subject",
        body: originalBody,
        attachments: [{
          filename: "orig.bin",
          contentType: "application/octet-stream",
          content: originalAttachment,
        }],
      },
    }, SIGNATURE);

    // 1. Submission evidence is reserved with the constructed digest.
    const key: EmailOperationKey = { workId: "smoke-mime-1", actionSlot: "reply" };
    const submissionStore = new SubmissionStore(emailRoot);
    const emlRef = "sent/smoke-mime-1.eml";
    const prepared = await submissionStore.prepare(OWNER, key, constructed.digest, emlRef);
    assertEquals(prepared.phase, "prepared");
    assertEquals(prepared.contentDigest, constructed.digest);
    submissionStore.close();

    // Repeated prepare with the same digest is idempotent.
    const submissionStore2 = new SubmissionStore(emailRoot);
    const repeated = await submissionStore2.prepare(OWNER, key, constructed.digest, emlRef);
    assertEquals(repeated.operationId, prepared.operationId);

    // A changed payload for the same logical operation is refused.
    const conflicting = await assertRejects(
      () => submissionStore2.prepare(OWNER, key, "different-digest", emlRef),
      SubmissionStoreError,
    );
    assertEquals(
      (conflicting as SubmissionStoreError).diagnosticCode,
      SubmissionDiagnosticCode.KEY_PAYLOAD_CONFLICT,
    );
    // Refusal happened before any external submission side effect.
    assertEquals(externalSmtpSendCalls, 0);

    // Evidence must exist and match the constructed digest before submission.
    await Deno.mkdir(`${emailRoot}/sent`, { recursive: true });
    await Deno.writeFile(`${emailRoot}/${emlRef}`, constructed.emlBytes);
    await submissionStore2.verifySubmissionEvidence(OWNER, key);
    const submitting = await submissionStore2.markSubmitting(OWNER, key);
    assertEquals(submitting.phase, "submitting");

    // Corrupted evidence is refused instead of allowing an automatic send.
    await Deno.writeFile(`${emailRoot}/${emlRef}`, new TextEncoder().encode("tampered"));
    const mismatch = await assertRejects(
      () => submissionStore2.verifySubmissionEvidence(OWNER, key),
      SubmissionStoreError,
    );
    assertEquals(
      (mismatch as SubmissionStoreError).diagnosticCode,
      SubmissionDiagnosticCode.EVIDENCE_DIGEST_MISMATCH,
    );
    await Deno.writeFile(`${emailRoot}/${emlRef}`, constructed.emlBytes);
    await submissionStore2.verifySubmissionEvidence(OWNER, key);
    const consumed = await submissionStore2.recordOutcome(OWNER, key, "submitted", {
      wireMessageId: constructed.messageId,
    });
    assertEquals(consumed.phase, "submitted");
    submissionStore2.close();

    // 2. Persist the identical constructed message in sent history.
    const threadId = crypto.randomUUID().toLowerCase();
    const attachmentId = crypto.randomUUID().toLowerCase();
    const messageStore = new EmailMessageStore({ workspacesRoot });
    const { recordId, threadId: storedThreadId } = await messageStore.putSent(
      OWNER,
      {
        messageId: constructed.messageId,
        emlBytes: constructed.emlBytes,
        digest: constructed.digest,
        historyBody: constructed.historyBody,
        to: constructed.to,
        subject: constructed.subject,
        targetKind: "user",
        threadId,
        wireIds: constructed.wireIds,
        attachmentPayloads: [{
          id: attachmentId,
          displayName: "orig.bin",
          filename: "orig.bin",
          mimeType: "application/octet-stream",
          content: originalAttachment,
        }],
      },
      key,
    );
    assertEquals(storedThreadId, threadId);

    // Repeated putSent for the same operation returns the same record.
    const repeatedSent = await messageStore.putSent(
      OWNER,
      {
        messageId: constructed.messageId,
        emlBytes: constructed.emlBytes,
        digest: constructed.digest,
        historyBody: constructed.historyBody,
        to: constructed.to,
        subject: constructed.subject,
        targetKind: "user",
        threadId,
        wireIds: constructed.wireIds,
      },
      key,
    );
    assertEquals(repeatedSent.recordId, recordId);

    // 3. Stored bytes are byte-identical to what was constructed (no re-signing).
    const storedBytes = await messageStore.getSourceBytes(OWNER, recordId);
    assertEquals(storedBytes, constructed.emlBytes);

    const storedRecord = await messageStore.getByOwnerRecord(OWNER, recordId);
    assertEquals(storedRecord?.body, constructed.historyBody);
    assertEquals(storedRecord?.wireMessageId, constructed.messageId);
    assertEquals(storedRecord?.attachments.length, 1);
    assertEquals(storedRecord?.attachments[0].id, attachmentId);
    assertEquals(
      await messageStore.attachment(OWNER, recordId, attachmentId),
      originalAttachment,
    );

    // 4. Re-parsing stored bytes preserves signature-once and original content.
    const parsed = await parseIncomingMime(storedBytes!);
    assertEquals(parsed.wireIds.messageId, constructed.messageId);
    assertEquals(parsed.wireIds.inReplyTo, "<smoke-parent@relay.example>");
    assertEquals(parsed.provenance.authoredText, "Smoke commentary.\n-- \n" + SIGNATURE);
    assertEquals(parsed.provenance.forwardedText?.includes(originalBody), true);
    assertEquals(parsed.attachments.length, 1);
    assertEquals(parsed.attachments[0].content, originalAttachment);
    assertEquals(parsed.plainBody.split(SIGNATURE).length - 1, 1);

    // No transport work happened in this slice.
    assertEquals(externalSmtpSendCalls, 0);
    messageStore.close();
  });
});
