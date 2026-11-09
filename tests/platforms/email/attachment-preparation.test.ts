// tests/platforms/email/attachment-preparation.test.ts

import { assert, assertEquals, assertRejects } from "@std/assert";
import { resolve } from "node:path";
import { EmailMessageStore } from "../../../src/platforms/email/message-store.ts";
import {
  createEmailAttachmentPreparation,
  EmailAttachmentPreparationError,
  type EmailAttachmentPreparationScope,
  emailAttachmentScope,
} from "../../../src/platforms/email/attachment-preparation.ts";
import type {
  Attachment,
  LocalEmailAttachment,
  PlatformMessage,
} from "../../../src/types/events.ts";
import type { WorkspaceInfo } from "../../../src/types/workspace.ts";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { isNotFoundError, makeTempDir } from "../../../src/utils/fs-compat.ts";

const OWNER_1 = "e_" + "1".repeat(64);
const OWNER_2 = "e_" + "2".repeat(64);

interface Fixture {
  store: EmailMessageStore;
  root: string;
  workspace: WorkspaceInfo;
  stagingDir: string;
}

async function withFixture(fn: (fixture: Fixture) => Promise<void> | void): Promise<void> {
  const root = await makeTempDir({ prefix: "attachment-preparation-" });
  const workspacesRoot = resolve(root, "workspaces");
  const workspacePath = resolve(workspacesRoot, "email", OWNER_1);
  await fsp.mkdir(workspacePath, { recursive: true });
  const store = new EmailMessageStore({ workspacesRoot });
  const workspace: WorkspaceInfo = {
    key: `email/${OWNER_1}`,
    components: { platform: "email", userId: OWNER_1 },
    path: workspacePath,
    tmpPath: resolve(workspacePath, "tmp"),
    isDm: true,
  };
  await fsp.mkdir(workspace.tmpPath, { recursive: true });
  try {
    await fn({
      store,
      root,
      workspace,
      stagingDir: resolve(workspace.tmpPath, "session-a"),
    });
  } finally {
    store.close();
    await fsp.rm(root, { recursive: true });
  }
}

async function archivedMessage(
  store: EmailMessageStore,
  owner: string,
  options: { filename: string; mimeType: string; bytes: Uint8Array },
): Promise<PlatformMessage> {
  const attachmentId = crypto.randomUUID();
  const recordId = await store.putSource(
    owner,
    new TextEncoder().encode("From: sender@example.org\r\nSubject: Test\r\n\r\nHi"),
    {
      from: "sender@example.org",
      subject: "Test",
      plainBody: "Hi",
      attachmentPayloads: [{
        id: attachmentId,
        filename: options.filename,
        mimeType: options.mimeType,
        content: options.bytes,
      }],
    },
  );
  const record = await store.getByOwnerRecord(owner, recordId);
  assert(record !== undefined);
  const [message] = store.toPlatformMessages([record!]);
  assert(message !== undefined);
  return message!;
}

function localAttachment(message: PlatformMessage): LocalEmailAttachment {
  const attachment = message.attachments?.[0];
  assert(attachment !== undefined && attachment.kind === "email-local");
  return attachment as LocalEmailAttachment;
}

test("attachment preparation - stages message bytes into the calling session without mutating input", async () => {
  await withFixture(async ({ store, workspace, stagingDir }) => {
    const bytes = new TextEncoder().encode("private attachment bytes");
    const message = await archivedMessage(store, OWNER_1, {
      filename: "report.pdf",
      mimeType: "application/pdf",
      bytes,
    });
    const originalAttachment = localAttachment(message);
    Object.freeze(originalAttachment);
    Object.freeze(message.attachments);
    Object.freeze(message);

    const preparation = createEmailAttachmentPreparation(store);
    const scope = emailAttachmentScope({
      workspace,
      sessionOwner: OWNER_1,
      skillSessionId: "session-a",
    });
    const [prepared] = await preparation.prepareMessages(scope, [message]);
    const preparedAttachment = prepared.attachments![0] as LocalEmailAttachment;

    assert(preparedAttachment.sessionPath !== undefined);
    assert(preparedAttachment.sessionPath!.startsWith(`${stagingDir}/attachments/`));
    assertEquals(new Uint8Array(await fsp.readFile(preparedAttachment.sessionPath!)), bytes);
    assertEquals(originalAttachment.sessionPath, undefined);
    assertEquals(message.attachments![0], originalAttachment);
  });
});

test("attachment preparation - two sessions get independent copies of the same source", async () => {
  await withFixture(async ({ store, workspace }) => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const message = await archivedMessage(store, OWNER_1, {
      filename: "image.png",
      mimeType: "image/png",
      bytes,
    });
    const preparation = createEmailAttachmentPreparation(store);
    const sessionA = resolve(workspace.tmpPath, "session-a");
    const sessionB = resolve(workspace.tmpPath, "session-b");
    await fsp.mkdir(sessionA, { recursive: true });
    await fsp.mkdir(sessionB, { recursive: true });

    const [preparedA] = await preparation.prepareMessages(
      { sessionOwner: OWNER_1, trustedRoot: workspace.path, stagingDir: sessionA },
      [message],
    );
    const [preparedB] = await preparation.prepareMessages(
      { sessionOwner: OWNER_1, trustedRoot: workspace.path, stagingDir: sessionB },
      [message],
    );

    const pathA = (preparedA.attachments![0] as LocalEmailAttachment).sessionPath!;
    const pathB = (preparedB.attachments![0] as LocalEmailAttachment).sessionPath!;
    assert(pathA.startsWith(`${sessionA}/`));
    assert(pathB.startsWith(`${sessionB}/`));
    assertEquals(pathA === pathB, false);
    assertEquals(new Uint8Array(await fsp.readFile(pathA)), bytes);
    assertEquals(new Uint8Array(await fsp.readFile(pathB)), bytes);
  });
});

test("attachment preparation - a stale incoming sessionPath is ignored and left untouched", async () => {
  await withFixture(async ({ store, workspace, stagingDir }) => {
    const message = await archivedMessage(store, OWNER_1, {
      filename: "notes.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("notes"),
    });
    const stale = "/tmp/another-session/attachments/stale/notes.txt";
    const frozenAttachment = Object.freeze({
      ...localAttachment(message),
      sessionPath: stale,
    });
    const frozenMessage = Object.freeze({
      ...message,
      attachments: Object.freeze([frozenAttachment]) as unknown as Attachment[],
    }) as PlatformMessage;

    const preparation = createEmailAttachmentPreparation(store);
    const [prepared] = await preparation.prepareMessages(
      { sessionOwner: OWNER_1, trustedRoot: workspace.path, stagingDir },
      [frozenMessage],
    );

    const preparedAttachment = prepared.attachments![0] as LocalEmailAttachment;
    assert(preparedAttachment.sessionPath !== undefined);
    assert(preparedAttachment.sessionPath!.startsWith(`${stagingDir}/`));
    assertEquals(preparedAttachment.sessionPath === stale, false);
    assertEquals(frozenAttachment.sessionPath, stale);
  });
});

test("attachment preparation - duplicate references in one batch are staged once", async () => {
  await withFixture(async ({ store, workspace, stagingDir }) => {
    const message = await archivedMessage(store, OWNER_1, {
      filename: "dedup.bin",
      mimeType: "application/octet-stream",
      bytes: new Uint8Array([9, 9, 9]),
    });
    let archiveReads = 0;
    const countingStore = {
      attachment: (owner: string, recordId: string, attachmentId: string) => {
        archiveReads++;
        return store.attachment(owner, recordId, attachmentId);
      },
    } as unknown as EmailMessageStore;

    const preparation = createEmailAttachmentPreparation(countingStore);
    const prepared = await preparation.prepareMessages(
      { sessionOwner: OWNER_1, trustedRoot: workspace.path, stagingDir },
      [message, message],
    );

    assertEquals(prepared.length, 2);
    const first = (prepared[0].attachments![0] as LocalEmailAttachment).sessionPath;
    const second = (prepared[1].attachments![0] as LocalEmailAttachment).sessionPath;
    assertEquals(first, second);
    assertEquals(archiveReads, 1);
  });
});

test("attachment preparation - another owner's reference fails explicitly", async () => {
  await withFixture(async ({ store, workspace, stagingDir }) => {
    const message = await archivedMessage(store, OWNER_1, {
      filename: "foreign.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([7]),
    });
    const preparation = createEmailAttachmentPreparation(store);

    await assertRejects(
      () =>
        preparation.prepareMessages(
          { sessionOwner: OWNER_2, trustedRoot: workspace.path, stagingDir },
          [message],
        ),
      EmailAttachmentPreparationError,
    );
  });
});

test("attachment preparation - a missing archived attachment fails explicitly", async () => {
  await withFixture(async ({ store, workspace, stagingDir }) => {
    const message = await archivedMessage(store, OWNER_1, {
      filename: "present.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("present"),
    });
    const source = localAttachment(message);
    const missing: LocalEmailAttachment = {
      ...source,
      id: crypto.randomUUID(),
      attachmentId: crypto.randomUUID(),
      filename: "missing.txt",
    };
    const preparation = createEmailAttachmentPreparation(store);

    await assertRejects(
      () =>
        preparation.prepareMessages(
          { sessionOwner: OWNER_1, trustedRoot: workspace.path, stagingDir },
          [{ ...message, attachments: [missing] }],
        ),
      EmailAttachmentPreparationError,
    );
  });
});

test("attachment preparation - scope uses the canonical session dir and the Skill-API-disabled fallback", async () => {
  await withFixture(({ workspace }) => {
    const enabled = emailAttachmentScope({
      workspace,
      sessionOwner: OWNER_1,
      skillSessionId: "sess_1",
    });
    const disabled = emailAttachmentScope({
      workspace,
      sessionOwner: OWNER_1,
      skillSessionId: undefined,
    });

    assertEquals(enabled.stagingDir, `${workspace.tmpPath}/sess_1`);
    assertEquals(disabled.stagingDir, workspace.tmpPath);
    assertEquals(enabled.trustedRoot, workspace.path);
    assertEquals(disabled.trustedRoot, workspace.path);
  });
});

test("attachment preparation - a workspace owned by another user is refused", () => {
  const workspace: WorkspaceInfo = {
    key: `email/${OWNER_1}`,
    components: { platform: "email", userId: OWNER_1 },
    path: "/tmp/workspace-owner-1",
    tmpPath: "/tmp/workspace-owner-1/tmp",
    isDm: true,
  };

  try {
    emailAttachmentScope({
      workspace,
      sessionOwner: OWNER_2,
      skillSessionId: "sess_1",
    });
    throw new Error("expected the scope to fail");
  } catch (error) {
    assert(error instanceof EmailAttachmentPreparationError);
  }
});

test("attachment preparation - cleanup removes only session copies and preserves archive bytes", async () => {
  await withFixture(async ({ store, workspace, stagingDir }) => {
    const bytes = new TextEncoder().encode("durable archive bytes");
    const message = await archivedMessage(store, OWNER_1, {
      filename: "durable.bin",
      mimeType: "application/octet-stream",
      bytes,
    });
    const source = localAttachment(message);
    const preparation = createEmailAttachmentPreparation(store);
    const [prepared] = await preparation.prepareMessages(
      { sessionOwner: OWNER_1, trustedRoot: workspace.path, stagingDir },
      [message],
    );
    const stagedPath = (prepared.attachments![0] as LocalEmailAttachment).sessionPath!;

    await fsp.rm(stagingDir, { recursive: true });

    const removedStagedPath = await assertRejects(() => fsp.stat(stagedPath));
    assertEquals(isNotFoundError(removedStagedPath), true);
    const archived = await store.attachment(
      OWNER_1,
      source.recordId,
      source.attachmentId,
    );
    assertEquals(archived, bytes);
    // Backend forwarding reads the same durable archive directly: staging and
    // cleanup never alter the immutable source bytes it forwards.
    assertEquals(
      await store.getSourceBytes(OWNER_1, source.recordId),
      new TextEncoder().encode("From: sender@example.org\r\nSubject: Test\r\n\r\nHi"),
    );
  });
});

test("attachment preparation - concurrent owner scopes cannot read each other's archive", async () => {
  await withFixture(async ({ store, workspace }) => {
    const bytes = new TextEncoder().encode("owner one only");
    const message = await archivedMessage(store, OWNER_1, {
      filename: "one.txt",
      mimeType: "text/plain",
      bytes,
    });
    const preparation = createEmailAttachmentPreparation(store);

    const ownerTwoWorkspace: WorkspaceInfo = {
      key: `email/${OWNER_2}`,
      components: { platform: "email", userId: OWNER_2 },
      path: resolve(workspace.path, "..", OWNER_2),
      tmpPath: resolve(workspace.path, "..", OWNER_2, "tmp"),
      isDm: true,
    };
    await fsp.mkdir(ownerTwoWorkspace.tmpPath, { recursive: true });

    const ownerOneScope = emailAttachmentScope({
      workspace,
      sessionOwner: OWNER_1,
      skillSessionId: "session-owner-one",
    });
    const ownerTwoScope: EmailAttachmentPreparationScope = emailAttachmentScope({
      workspace: ownerTwoWorkspace,
      sessionOwner: OWNER_2,
      skillSessionId: "session-owner-two",
    });
    await fsp.mkdir(ownerOneScope.stagingDir, { recursive: true });
    await fsp.mkdir(ownerTwoScope.stagingDir, { recursive: true });

    // The two preparations genuinely overlap; owner two's scope sees a
    // reference owned by owner one and must fail instead of reading it.
    const [allowed, denied] = await Promise.allSettled([
      preparation.prepareMessages(ownerOneScope, [message]),
      preparation.prepareMessages(ownerTwoScope, [message]),
    ]);

    assertEquals(allowed.status, "fulfilled");
    assertEquals(denied.status, "rejected");
    assert(
      denied.status === "rejected" && denied.reason instanceof EmailAttachmentPreparationError,
    );
    if (allowed.status !== "fulfilled") throw new Error("unreachable");
    const preparedPath = (allowed.value[0].attachments![0] as LocalEmailAttachment).sessionPath!;
    assert(preparedPath.startsWith(`${ownerOneScope.stagingDir}/attachments/`));
    assertEquals(new Uint8Array(await fsp.readFile(preparedPath)), bytes);
    // Owner two's boundary gained no copy of owner one's bytes.
    assertEquals([...fs.readdirSync(ownerTwoScope.stagingDir, { withFileTypes: true })], []);

    // The scope helper itself refuses a workspace owned by the other user.
    await assertRejects(() =>
      Promise.resolve().then(() =>
        emailAttachmentScope({
          workspace: ownerTwoWorkspace,
          sessionOwner: OWNER_1,
          skillSessionId: "session-owner-two",
        })
      )
    );
  });
});
