// tests/platforms/email/message-smoke.test.ts

import { assertEquals, assertNotEquals } from "@std/assert";
import { EmailMessageStore } from "../../../src/platforms/email/message-store.ts";

const OWNER_1 = "e_" + "1".repeat(64);
const OWNER_2 = "e_" + "2".repeat(64);

async function withTempSmokeStore(
  fn: (store: EmailMessageStore, tempDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "email-smoke-test-" });
  const store = new EmailMessageStore({ workspacesRoot: tempDir });
  try {
    await fn(store, tempDir);
  } finally {
    store.close();
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

Deno.test("Smoke 2.1 - Spec Scenario 1: Forged reference", async () => {
  // Scenario: Forged reference
  // WHEN user B references user A wire Message-ID
  // THEN no A message is returned or joined
  await withTempSmokeStore(async (store) => {
    const rawMsgA = "From: a@example.com\r\nSubject: Secret\r\n\r\nPrivate message for A";
    const recordIdA = await store.putSource(
      OWNER_1,
      rawMsgA,
      {
        from: "a@example.com",
        subject: "Secret",
        plainBody: "Private message for A",
        wireIds: { messageId: "<wire-msg-a@example.com>" },
      },
    );

    const recA = (await store.getByOwnerRecord(OWNER_1, recordIdA))!;
    const threadA = recA.threadId;

    // User B attempts to join Thread A by spoofing inReplyTo / references
    const recordIdB = await store.putSource(
      OWNER_2,
      "From: b@example.com\r\nSubject: Attack\r\n\r\nTrying to join A",
      {
        from: "b@example.com",
        subject: "Attack",
        plainBody: "Trying to join A",
        wireIds: {
          messageId: "<wire-msg-b@example.com>",
          inReplyTo: "<wire-msg-a@example.com>",
          references: ["<wire-msg-a@example.com>"],
        },
      },
    );

    const recB = (await store.getByOwnerRecord(OWNER_2, recordIdB))!;
    const threadB = recB.threadId;

    // 1. Thread IDs must not match
    assertNotEquals(threadA, threadB);

    // 2. User B fetch of threadA returns empty
    const bHistory = await store.history(OWNER_2, threadA);
    assertEquals(bHistory.length, 0);

    // 3. User B get of recordA returns undefined
    const bGet = await store.get(OWNER_2, threadA, recordIdA);
    assertEquals(bGet, undefined);

    // 4. User B raw source get of recordA returns undefined
    const bSource = await store.getSourceBytes(OWNER_2, recordIdA);
    assertEquals(bSource, undefined);
  });
});

Deno.test("Smoke 2.1 - Spec Scenario 2: Duplicate wire ID", async () => {
  // Scenario: Duplicate wire ID
  // WHEN distinct raw messages claim the same Message-ID
  // THEN both immutable source records survive and ambiguous threading requires review
  await withTempSmokeStore(async (store) => {
    const wireId = "<collision-123@example.com>";
    const raw1 = "Subject: One\r\n\r\nFirst occurrence";
    const raw2 = "Subject: Two\r\n\r\nSecond occurrence with distinct body";

    const rec1Id = await store.putSource(
      OWNER_1,
      raw1,
      {
        from: "sender1@example.com",
        plainBody: "First occurrence",
        wireIds: { messageId: wireId },
      },
    );

    const rec2Id = await store.putSource(
      OWNER_1,
      raw2,
      {
        from: "sender2@example.com",
        plainBody: "Second occurrence with distinct body",
        wireIds: { messageId: wireId },
      },
    );

    assertNotEquals(rec1Id, rec2Id);

    // Both immutable source records survive
    const bytes1 = await store.getSourceBytes(OWNER_1, rec1Id);
    const bytes2 = await store.getSourceBytes(OWNER_1, rec2Id);
    assertEquals(new TextDecoder().decode(bytes1), raw1);
    assertEquals(new TextDecoder().decode(bytes2), raw2);

    const rec1 = (await store.getByOwnerRecord(OWNER_1, rec1Id))!;
    const rec2 = (await store.getByOwnerRecord(OWNER_1, rec2Id))!;
    assertEquals(rec1.body, "First occurrence");
    assertEquals(rec2.body, "Second occurrence with distinct body");

    // Second record flagged review-required
    assertEquals(rec2.reviewRequired, true);
    assertEquals(rec2.reviewReason?.toLowerCase().includes("duplicate wire message-id"), true);
  });
});

Deno.test("Smoke 2.1 - Spec Scenario 3: Forward later", async () => {
  // Scenario: Forward later
  // WHEN the originating session tmp area has been reclaimed
  // THEN the selected original and every attachment remain available by internal ID
  await withTempSmokeStore(async (store) => {
    // Simulate disposable session tmp dir
    const sessionTmp = await Deno.makeTempDir({ prefix: "disposable-session-" });
    const tmpSourceFile = `${sessionTmp}/received.eml`;
    const tmpAttFile = `${sessionTmp}/contract.pdf`;

    const originalEml = "Subject: Legal Contract\r\n\r\nSee attached contract.";
    const originalPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]); // %PDF-1.5
    await Deno.writeTextFile(tmpSourceFile, originalEml);
    await Deno.writeFile(tmpAttFile, originalPdf);

    const attId = crypto.randomUUID().toLowerCase();

    // Ingest into message store
    const recordId = await store.putSource(
      OWNER_1,
      originalEml,
      {
        from: "legal@example.com",
        subject: "Legal Contract",
        plainBody: "See attached contract.",
        wireIds: { messageId: "<contract-1@example.com>" },
        attachmentPayloads: [
          {
            id: attId,
            filename: "contract.pdf",
            mimeType: "application/pdf",
            content: originalPdf,
          },
        ],
      },
    );

    // Reclaim / wipe disposable session tmp directory completely
    await Deno.remove(sessionTmp, { recursive: true });

    // The selected original source and every attachment remain available by internal ID
    const preservedSource = await store.getSourceBytes(OWNER_1, recordId);
    assertEquals(new TextDecoder().decode(preservedSource), originalEml);

    const preservedAtt = await store.attachment(OWNER_1, recordId, attId);
    assertEquals(preservedAtt, originalPdf);

    // Also verify PlatformMessage conversion for adapter consumption
    const history = await store.history(
      OWNER_1,
      (await store.getByOwnerRecord(OWNER_1, recordId))!.threadId,
    );
    const platformMessages = store.toPlatformMessages(history);
    assertEquals(platformMessages.length, 1);
    assertEquals(platformMessages[0].attachments?.length, 1);
    assertEquals(platformMessages[0].attachments![0].id, attId);
    assertEquals(platformMessages[0].attachments![0].filename, "contract.pdf");
    assertEquals(platformMessages[0].attachments![0].mimeType, "application/pdf");
    assertEquals(platformMessages[0].attachments![0].size, originalPdf.byteLength);
  });
});
