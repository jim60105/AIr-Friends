// tests/platforms/email/message-store.test.ts

import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import {
  EmailMessageStore,
  formatEmailChannelId,
  MessageStoreDiagnosticCode,
  MessageStoreError,
  parseEmailChannelId,
  validateOwnerId,
  validateUuid,
} from "../../../src/platforms/email/message-store.ts";

const OWNER_A = "e_" + "a".repeat(64);
const OWNER_B = "e_" + "b".repeat(64);

async function withTempStore(
  fn: (store: EmailMessageStore, tempDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "email-store-test-" });
  const store = new EmailMessageStore({ workspacesRoot: tempDir });
  try {
    await fn(store, tempDir);
  } finally {
    store.close();
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

Deno.test("EmailMessageStore - Channel & Identifier Validation", () => {
  // Valid owner
  assertEquals(validateOwnerId(OWNER_A), OWNER_A);
  assertThrows(
    () => validateOwnerId("not-an-email-owner"),
    MessageStoreError,
    MessageStoreDiagnosticCode.INVALID_OWNER,
  );

  // Valid UUID
  const validUuid = crypto.randomUUID().toLowerCase();
  assertEquals(validateUuid(validUuid), validUuid);
  assertThrows(
    () => validateUuid("not-a-uuid"),
    MessageStoreError,
    MessageStoreDiagnosticCode.INVALID_RECORD_ID,
  );

  // Channel parsing
  const channel = formatEmailChannelId(OWNER_A, validUuid);
  assertEquals(channel, `mail:${OWNER_A}:${validUuid}`);

  const parsed = parseEmailChannelId(channel);
  assertEquals(parsed.owner, OWNER_A);
  assertEquals(parsed.threadId, validUuid);

  // Hostile channel parsing
  assertThrows(
    () => parseEmailChannelId("mail:invalid-owner:1234"),
    MessageStoreError,
    MessageStoreDiagnosticCode.INVALID_CHANNEL_ID,
  );
  assertThrows(
    () => parseEmailChannelId("discord/channel/123"),
    MessageStoreError,
    MessageStoreDiagnosticCode.INVALID_CHANNEL_ID,
  );
});

Deno.test("EmailMessageStore - Scenario: Forged reference / Cross-owner isolation", async () => {
  await withTempStore(async (store) => {
    // User A receives an initial email with wire Message-ID <msg-a-1@example.com>
    const wireIdA = "<msg-a-1@example.com>";
    const recordIdA = await store.putSource(
      OWNER_A,
      "From: Alice <alice@example.com>\r\nSubject: Hi\r\n\r\nHello A",
      {
        from: "alice@example.com",
        subject: "Hi",
        plainBody: "Hello A",
        wireIds: { messageId: wireIdA },
      },
    );

    const recordA = await store.getByOwnerRecord(OWNER_A, recordIdA);
    assertEquals(recordA !== undefined, true);
    const threadIdA = recordA!.threadId;

    // User B sends or receives a message that references User A's wire Message-ID
    const recordIdB = await store.putSource(
      OWNER_B,
      "From: Bob <bob@example.com>\r\nSubject: Spoofed ref\r\n\r\nHello B",
      {
        from: "bob@example.com",
        subject: "Spoofed ref",
        plainBody: "Hello B",
        wireIds: {
          messageId: "<msg-b-1@example.com>",
          inReplyTo: wireIdA, // Referencing User A's message-id
        },
      },
    );

    const recordB = await store.getByOwnerRecord(OWNER_B, recordIdB);
    assertEquals(recordB !== undefined, true);
    const threadIdB = recordB!.threadId;

    // User B's message MUST NOT join User A's thread!
    assertNotEquals(threadIdB, threadIdA);

    // Fetching thread A using Owner B MUST return empty / denial
    const bFetchA = await store.history(OWNER_B, threadIdA);
    assertEquals(bFetchA.length, 0);

    const bGetA = await store.get(OWNER_B, threadIdA, recordIdA);
    assertEquals(bGetA, undefined);

    const bSourceA = await store.getSourceBytes(OWNER_B, recordIdA);
    assertEquals(bSourceA, undefined);
  });
});

Deno.test("EmailMessageStore - Thread derivation strictly from references (never subject)", async () => {
  await withTempStore(async (store) => {
    // Message 1 with subject "Meeting Discussion"
    const rec1Id = await store.putSource(
      OWNER_A,
      "Subject: Meeting Discussion\r\n\r\nBody 1",
      {
        from: "colleague@example.com",
        subject: "Meeting Discussion",
        plainBody: "Body 1",
        wireIds: { messageId: "<meeting-1@example.com>" },
      },
    );
    const rec1 = (await store.getByOwnerRecord(OWNER_A, rec1Id))!;

    // Message 2 with IDENTICAL subject "Meeting Discussion", but NO references
    const rec2Id = await store.putSource(
      OWNER_A,
      "Subject: Meeting Discussion\r\n\r\nBody 2",
      {
        from: "colleague@example.com",
        subject: "Meeting Discussion",
        plainBody: "Body 2",
        wireIds: { messageId: "<meeting-2-unrelated@example.com>" },
      },
    );
    const rec2 = (await store.getByOwnerRecord(OWNER_A, rec2Id))!;

    // Identical subject alone MUST NOT join threads
    assertNotEquals(rec1.threadId, rec2.threadId);

    // Message 3 with DIFFERENT subject but in-reply-to <meeting-1@example.com>
    const rec3Id = await store.putSource(
      OWNER_A,
      "Subject: Re: Completely Changed Subject\r\n\r\nBody 3",
      {
        from: "colleague@example.com",
        subject: "Re: Completely Changed Subject",
        plainBody: "Body 3",
        wireIds: {
          messageId: "<meeting-3-reply@example.com>",
          inReplyTo: "<meeting-1@example.com>",
        },
      },
    );
    const rec3 = (await store.getByOwnerRecord(OWNER_A, rec3Id))!;

    // Must join Thread 1 despite different subject!
    assertEquals(rec3.threadId, rec1.threadId);

    const history1 = await store.history(OWNER_A, rec1.threadId);
    assertEquals(history1.length, 2);
    assertEquals(history1[0].recordId, rec1Id);
    assertEquals(history1[1].recordId, rec3Id);
  });
});

Deno.test("EmailMessageStore - Scenario: Duplicate wire ID preserves both records with review required", async () => {
  await withTempStore(async (store) => {
    const wireId = "<shared-id@example.com>";

    const rec1Id = await store.putSource(
      OWNER_A,
      "From: Alice\r\nSubject: Original\r\n\r\nOriginal Body",
      {
        from: "alice@example.com",
        subject: "Original",
        plainBody: "Original Body",
        wireIds: { messageId: wireId },
      },
    );

    const rec2Id = await store.putSource(
      OWNER_A,
      "From: Malicious/Duplicate\r\nSubject: Duplicate\r\n\r\nDuplicate Body",
      {
        from: "other@example.com",
        subject: "Duplicate",
        plainBody: "Duplicate Body",
        wireIds: { messageId: wireId },
      },
    );

    assertNotEquals(rec1Id, rec2Id);

    // Both records survive intact!
    const rec1 = (await store.getByOwnerRecord(OWNER_A, rec1Id))!;
    const rec2 = (await store.getByOwnerRecord(OWNER_A, rec2Id))!;
    assertEquals(rec1.body, "Original Body");
    assertEquals(rec2.body, "Duplicate Body");

    // Second record flagged reviewRequired
    assertEquals(rec2.reviewRequired, true);

    // Both source raw bytes survive
    const bytes1 = await store.getSourceBytes(OWNER_A, rec1Id);
    const bytes2 = await store.getSourceBytes(OWNER_A, rec2Id);
    assertEquals(
      new TextDecoder().decode(bytes1),
      "From: Alice\r\nSubject: Original\r\n\r\nOriginal Body",
    );
    assertEquals(
      new TextDecoder().decode(bytes2),
      "From: Malicious/Duplicate\r\nSubject: Duplicate\r\n\r\nDuplicate Body",
    );
  });
});

Deno.test("EmailMessageStore - Conflicting thread references flag review required without destructive merge", async () => {
  await withTempStore(async (store) => {
    // Thread 1
    const rec1Id = await store.putSource(
      OWNER_A,
      "Subject: T1\r\n\r\nBody 1",
      {
        from: "a@example.com",
        plainBody: "Body 1",
        wireIds: { messageId: "<msg-t1@example.com>" },
      },
    );
    const t1 = (await store.getByOwnerRecord(OWNER_A, rec1Id))!.threadId;

    // Thread 2
    const rec2Id = await store.putSource(
      OWNER_A,
      "Subject: T2\r\n\r\nBody 2",
      {
        from: "b@example.com",
        plainBody: "Body 2",
        wireIds: { messageId: "<msg-t2@example.com>" },
      },
    );
    const t2 = (await store.getByOwnerRecord(OWNER_A, rec2Id))!.threadId;
    assertNotEquals(t1, t2);

    // Message 3 references BOTH <msg-t1@example.com> and <msg-t2@example.com>
    const rec3Id = await store.putSource(
      OWNER_A,
      "Subject: Bridge\r\n\r\nBody 3",
      {
        from: "c@example.com",
        plainBody: "Body 3",
        wireIds: {
          messageId: "<msg-bridge@example.com>",
          inReplyTo: "<msg-t1@example.com>",
          references: ["<msg-t2@example.com>"],
        },
      },
    );

    const rec3 = (await store.getByOwnerRecord(OWNER_A, rec3Id))!;
    assertEquals(rec3.reviewRequired, true);
    assertEquals(rec3.reviewReason?.includes("Conflicting thread references"), true);
  });
});

Deno.test("EmailMessageStore - Unresolved references stored as metadata without invented content", async () => {
  await withTempStore(async (store) => {
    const unknownRef = "<unknown-parent@example.com>";
    const recId = await store.putSource(
      OWNER_A,
      "Subject: Orphan\r\n\r\nOrphan Body",
      {
        from: "sender@example.com",
        plainBody: "Orphan Body",
        wireIds: {
          messageId: "<orphan-child@example.com>",
          inReplyTo: unknownRef,
        },
      },
    );

    const rec = (await store.getByOwnerRecord(OWNER_A, recId))!;
    assertEquals(rec.inReplyTo, unknownRef);

    // Only 1 message in thread history (parent was not invented)
    const history = await store.history(OWNER_A, rec.threadId);
    assertEquals(history.length, 1);
    assertEquals(history[0].recordId, recId);
  });
});

Deno.test("EmailMessageStore - Scenario: Forward later / Immutable source and attachment bytes", async () => {
  await withTempStore(async (store) => {
    const sourceBytes = new TextEncoder().encode("RFC 5322 Raw Message Bytes with Attachments");
    const attachmentContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    const attId = crypto.randomUUID().toLowerCase();

    const recordId = await store.putSource(
      OWNER_A,
      sourceBytes,
      {
        from: "alice@example.com",
        subject: "Invoice & Receipt",
        plainBody: "Please see attached receipt.",
        wireIds: { messageId: "<invoice-1@example.com>" },
        attachmentPayloads: [
          {
            id: attId,
            filename: "receipt.png",
            mimeType: "image/png",
            content: attachmentContent,
          },
        ],
      },
    );

    // Verify source bytes
    const fetchedSource = await store.getSourceBytes(OWNER_A, recordId);
    assertEquals(fetchedSource, sourceBytes);

    // Verify attachment bytes
    const fetchedAtt = await store.attachment(OWNER_A, recordId, attId);
    assertEquals(fetchedAtt, attachmentContent);

    // Attempting to read attachment from wrong owner
    const crossAtt = await store.attachment(OWNER_B, recordId, attId);
    assertEquals(crossAtt, undefined);
  });
});

Deno.test("EmailMessageStore - putSent: Third-party conversation separation and idempotency", async () => {
  await withTempStore(async (store) => {
    // 1. Initial user inbound thread
    const inRecId = await store.putSource(
      OWNER_A,
      "Subject: Help\r\n\r\nHelp me",
      {
        from: "user@example.com",
        plainBody: "Help me",
        wireIds: { messageId: "<user-help@example.com>" },
      },
    );
    const userThread = (await store.getByOwnerRecord(OWNER_A, inRecId))!.threadId;

    // 2. PutSent for ordinary reply to user
    const replyOp = { workId: "session-1", actionSlot: "reply" };
    const replySent = await store.putSent(
      OWNER_A,
      {
        emlBytes: "Subject: Re: Help\r\n\r\nReply content",
        historyBody: "Reply content",
        to: "user@example.com",
        targetKind: "user",
        threadId: userThread,
      },
      replyOp,
    );
    assertEquals(replySent.threadId, userThread);

    // 3. PutSent for third-party send
    const thirdPartyOp = { workId: "session-1", actionSlot: "third-party:grant-1" };
    const thirdPartySent = await store.putSent(
      OWNER_A,
      {
        emlBytes: "Subject: External\r\n\r\nThird party notice",
        historyBody: "Third party notice",
        to: "vendor@example.com",
        targetKind: "third-party",
        threadId: userThread, // Even if caller accidentally provides userThread
      },
      thirdPartyOp,
    );

    // Outbound third-party conversation data MUST NOT be inserted into initiating-user reply thread!
    assertNotEquals(thirdPartySent.threadId, userThread);

    // Verify user thread history has ONLY inbound + reply
    const userHistory = await store.history(OWNER_A, userThread);
    assertEquals(userHistory.length, 2);
    assertEquals(userHistory[0].recordId, inRecId);
    assertEquals(userHistory[1].recordId, replySent.recordId);

    // Verify third-party thread history has the third-party sent record
    const tpHistory = await store.history(OWNER_A, thirdPartySent.threadId);
    assertEquals(tpHistory.length, 1);
    assertEquals(tpHistory[0].recordId, thirdPartySent.recordId);

    // 4. Test idempotency of putSent
    const repeatReply = await store.putSent(
      OWNER_A,
      {
        emlBytes: "Subject: Re: Help\r\n\r\nReply content",
        historyBody: "Reply content",
        to: "user@example.com",
        targetKind: "user",
      },
      replyOp,
    );
    assertEquals(repeatReply.recordId, replySent.recordId);
    assertEquals(repeatReply.threadId, replySent.threadId);
  });
});

Deno.test("EmailMessageStore - Crash recovery & index rebuild from disk", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-recovery-test-" });
  try {
    const store1 = new EmailMessageStore({ workspacesRoot: tempDir });

    const rec1Id = await store1.putSource(
      OWNER_A,
      "Subject: First\r\n\r\nFirst message",
      {
        from: "alice@example.com",
        plainBody: "First message",
        wireIds: { messageId: "<first@example.com>" },
      },
    );
    const rec1 = (await store1.getByOwnerRecord(OWNER_A, rec1Id))!;
    const threadId = rec1.threadId;

    const rec2Id = await store1.putSource(
      OWNER_A,
      "Subject: Reply\r\n\r\nSecond message",
      {
        from: "alice@example.com",
        plainBody: "Second message",
        wireIds: {
          messageId: "<second@example.com>",
          inReplyTo: "<first@example.com>",
        },
      },
    );

    store1.close();

    // Instantiate fresh store instance on same filesystem root (simulating reboot)
    const store2 = new EmailMessageStore({ workspacesRoot: tempDir });

    // History and thread relations must be accurately rebuilt
    const history = await store2.history(OWNER_A, threadId);
    assertEquals(history.length, 2);
    assertEquals(history[0].recordId, rec1Id);
    assertEquals(history[0].body, "First message");
    assertEquals(history[1].recordId, rec2Id);
    assertEquals(history[1].body, "Second message");

    // Resolving thread with reply to second message joins existing thread
    const res = await store2.resolveThread(OWNER_A, {
      inReplyTo: "<second@example.com>",
    });
    assertEquals(res.threadId, threadId);
    assertEquals(res.isNew, false);

    store2.close();
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
