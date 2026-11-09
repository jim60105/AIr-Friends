// tests/platforms/email/attachment-materializer.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "node:path";
import {
  EmailMessageStore,
  MessageStoreError,
} from "../../../src/platforms/email/message-store.ts";
import {
  materializeEmailAttachment,
} from "../../../src/platforms/email/attachment-materializer.ts";
import type { LocalEmailAttachment } from "../../../src/types/events.ts";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { isNotFoundError, makeTempDir } from "../../../src/utils/fs-compat.ts";

const OWNER_1 = "e_" + "1".repeat(64);
const OWNER_2 = "e_" + "2".repeat(64);

async function withTempEnv(
  fn: (store: EmailMessageStore, stagingDir: string, tempDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await makeTempDir({ prefix: "materializer-test-" });
  const workspacesRoot = resolve(tempDir, "workspaces");
  const stagingDir = resolve(tempDir, "staging");
  await fsp.mkdir(workspacesRoot, { recursive: true });
  await fsp.mkdir(stagingDir, { recursive: true });

  const store = new EmailMessageStore({ workspacesRoot });
  try {
    await fn(store, stagingDir, tempDir);
  } finally {
    try {
      store.close();
      await fsp.rm(tempDir, { recursive: true });
    } catch {
      // ignore cleanup errors in tests
    }
  }
}

test("materializeEmailAttachment - succeeds with valid owner and attachment", async () => {
  await withTempEnv(async (store, stagingDir) => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.4 test payload");
    const attId = crypto.randomUUID();

    const recordId = await store.putSource(
      OWNER_1,
      new TextEncoder().encode("From: a@b.com\r\nSubject: Test\r\n\r\nHi"),
      {
        from: "a@b.com",
        subject: "Test",
        plainBody: "Hi",
        attachmentPayloads: [{
          id: attId,
          filename: "test-doc.pdf",
          content: pdfBytes,
          mimeType: "application/pdf",
        }],
      },
    );

    const ref: LocalEmailAttachment = {
      kind: "email-local",
      id: attId,
      owner: OWNER_1,
      recordId,
      attachmentId: attId,
      filename: "test-doc.pdf",
      mimeType: "application/pdf",
      size: pdfBytes.byteLength,
      isImage: false,
    };

    const stagedPath = await materializeEmailAttachment({
      store,
      sessionOwner: OWNER_1,
      ref,
      stagingDir,
      trustedRoot: resolve(stagingDir, ".."),
    });

    const fileContent = new Uint8Array(await fsp.readFile(stagedPath));
    assertEquals(fileContent, pdfBytes);
    assertEquals(stagedPath.endsWith(`attachments/${attId}/test-doc.pdf`), true);
  });
});

test("materializeEmailAttachment - cross-owner access is strictly refused", async () => {
  await withTempEnv(async (store, stagingDir) => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const attId = crypto.randomUUID();

    const recordId = await store.putSource(
      OWNER_1,
      new TextEncoder().encode("From: a@b.com\r\nSubject: Secret\r\n\r\nSecret"),
      {
        from: "a@b.com",
        subject: "Secret",
        plainBody: "Secret",
        attachmentPayloads: [{
          id: attId,
          filename: "secret.png",
          content: pngBytes,
          mimeType: "image/png",
        }],
      },
    );

    const ref: LocalEmailAttachment = {
      kind: "email-local",
      id: attId,
      owner: OWNER_1, // Stored under OWNER_1
      recordId,
      attachmentId: attId,
      filename: "secret.png",
      mimeType: "image/png",
      size: pngBytes.byteLength,
      isImage: true,
    };

    // Attempting to materialize with sessionOwner === OWNER_2 must fail
    await assertRejects(
      async () => {
        await materializeEmailAttachment({
          store,
          sessionOwner: OWNER_2,
          ref,
          stagingDir,
          trustedRoot: resolve(stagingDir, ".."),
        });
      },
      MessageStoreError,
      "Cross-owner attachment access is strictly denied",
    );
  });
});

test("materializeEmailAttachment - traversal in attachment filename is sanitized", async () => {
  await withTempEnv(async (store, stagingDir) => {
    const data = new TextEncoder().encode("safe payload");
    const attId = crypto.randomUUID();

    const recordId = await store.putSource(
      OWNER_1,
      new TextEncoder().encode("From: a@b.com\r\nSubject: Traversal\r\n\r\nHi"),
      {
        from: "a@b.com",
        subject: "Traversal",
        plainBody: "Hi",
        attachmentPayloads: [{
          id: attId,
          filename: "../../evil.sh",
          content: data,
          mimeType: "text/plain",
        }],
      },
    );

    const ref: LocalEmailAttachment = {
      kind: "email-local",
      id: attId,
      owner: OWNER_1,
      recordId,
      attachmentId: attId,
      filename: "../../evil.sh",
      mimeType: "text/plain",
      size: data.byteLength,
      isImage: false,
    };

    const stagedPath = await materializeEmailAttachment({
      store,
      sessionOwner: OWNER_1,
      ref,
      stagingDir,
      trustedRoot: resolve(stagingDir, ".."),
    });

    // Filename should be sanitized to evil.sh without traversal
    assertEquals(stagedPath.includes(".."), false);
    assertEquals(stagedPath.endsWith(`attachments/${attId}/evil.sh`), true);
  });
});

test("materializeEmailAttachment - symlink staging escape is refused", async () => {
  await withTempEnv(async (store, stagingDir, tempDir) => {
    const data = new TextEncoder().encode("symlink target test");
    const attId = crypto.randomUUID();

    const recordId = await store.putSource(
      OWNER_1,
      new TextEncoder().encode("From: a@b.com\r\nSubject: Symlink\r\n\r\nHi"),
      {
        from: "a@b.com",
        subject: "Symlink",
        plainBody: "Hi",
        attachmentPayloads: [{
          id: attId,
          filename: "target.txt",
          content: data,
          mimeType: "text/plain",
        }],
      },
    );

    // Create a symlink under stagingDir targeting external dir
    const outsideTarget = resolve(tempDir, "outside");
    await fsp.mkdir(outsideTarget, { recursive: true });
    const symlinkAttDir = resolve(stagingDir, "attachments");
    await fsp.symlink(outsideTarget, symlinkAttDir);

    const ref: LocalEmailAttachment = {
      kind: "email-local",
      id: attId,
      owner: OWNER_1,
      recordId,
      attachmentId: attId,
      filename: "target.txt",
      mimeType: "text/plain",
      isImage: false,
    };

    await assertRejects(
      async () => {
        await materializeEmailAttachment({
          store,
          sessionOwner: OWNER_1,
          ref,
          stagingDir,
          trustedRoot: tempDir,
        });
      },
    );
  });
});

/** A store whose only observable behavior is counting archive reads. */
function countingStore(): { store: EmailMessageStore; reads: () => number } {
  let reads = 0;
  return {
    store: {
      attachment: () => {
        reads++;
        return Promise.resolve(undefined);
      },
    } as unknown as EmailMessageStore,
    reads: () => reads,
  };
}

test("materializeEmailAttachment - staging outside the trusted workspace is refused before any read", async () => {
  const tempDir = await makeTempDir({ prefix: "materializer-boundary-" });
  try {
    const workspace = resolve(tempDir, "workspace");
    const outside = resolve(tempDir, "outside", "session");
    await fsp.mkdir(workspace, { recursive: true });
    await fsp.mkdir(outside, { recursive: true });
    const { store, reads } = countingStore();

    await assertRejects(() =>
      materializeEmailAttachment({
        store,
        sessionOwner: OWNER_1,
        ref: {
          kind: "email-local",
          id: crypto.randomUUID(),
          owner: OWNER_1,
          recordId: crypto.randomUUID(),
          attachmentId: crypto.randomUUID(),
          filename: "private.pdf",
          mimeType: "application/pdf",
          isImage: false,
        },
        stagingDir: outside,
        trustedRoot: workspace,
      })
    );
    assertEquals(reads(), 0);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("materializeEmailAttachment - a symlinked tmp ancestor with an existing session child is refused before outside writes or reads", async () => {
  const tempDir = await makeTempDir({ prefix: "materializer-symlink-" });
  try {
    const workspace = resolve(tempDir, "workspace");
    const outside = resolve(tempDir, "outside");
    const outsideSession = resolve(outside, "session-1");
    await fsp.mkdir(workspace, { recursive: true });
    await fsp.mkdir(outsideSession, { recursive: true });
    await fsp.symlink(outside, resolve(workspace, "tmp"));
    const { store, reads } = countingStore();

    await assertRejects(() =>
      materializeEmailAttachment({
        store,
        sessionOwner: OWNER_1,
        ref: {
          kind: "email-local",
          id: crypto.randomUUID(),
          owner: OWNER_1,
          recordId: crypto.randomUUID(),
          attachmentId: crypto.randomUUID(),
          filename: "private.pdf",
          mimeType: "application/pdf",
          isImage: false,
        },
        stagingDir: resolve(workspace, "tmp", "session-1"),
        trustedRoot: workspace,
      })
    );

    assertEquals(reads(), 0);
    // Nothing was written into the symlink target, not even the attachments
    // parent directory.
    assertEquals([...fs.readdirSync(outsideSession, { withFileTypes: true })], []);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("materializeEmailAttachment - a missing attachment fails without writing an unstaged file", async () => {
  await withTempEnv(async (store, stagingDir, tempDir) => {
    const recordId = await store.putSource(
      OWNER_1,
      new TextEncoder().encode("From: a@b.com\r\nSubject: Empty\r\n\r\nHi"),
      { from: "a@b.com", subject: "Empty", plainBody: "Hi" },
    );
    const attachmentId = crypto.randomUUID();

    await assertRejects(
      () =>
        materializeEmailAttachment({
          store,
          sessionOwner: OWNER_1,
          ref: {
            kind: "email-local",
            id: attachmentId,
            owner: OWNER_1,
            recordId,
            attachmentId,
            filename: "missing.pdf",
            mimeType: "application/pdf",
            isImage: false,
          },
          stagingDir,
          trustedRoot: tempDir,
        }),
      MessageStoreError,
      "not found",
    );

    const unstagedFile = resolve(stagingDir, "attachments", attachmentId, "missing.pdf");
    const unstagedStat = await assertRejects(() => fsp.stat(unstagedFile));
    assertEquals(isNotFoundError(unstagedStat), true);
  });
});

test("materializeEmailAttachment - a destination symlink is refused before the archive read", async () => {
  const tempDir = await makeTempDir({ prefix: "materializer-dest-symlink-" });
  try {
    const workspace = resolve(tempDir, "workspace");
    const staging = resolve(workspace, "tmp", "session-1");
    const outside = resolve(tempDir, "outside");
    await fsp.mkdir(staging, { recursive: true });
    await fsp.mkdir(outside, { recursive: true });
    await fsp.symlink(outside, resolve(staging, "attachments"));
    const { store, reads } = countingStore();

    await assertRejects(() =>
      materializeEmailAttachment({
        store,
        sessionOwner: OWNER_1,
        ref: {
          kind: "email-local",
          id: crypto.randomUUID(),
          owner: OWNER_1,
          recordId: crypto.randomUUID(),
          attachmentId: crypto.randomUUID(),
          filename: "private.pdf",
          mimeType: "application/pdf",
          isImage: false,
        },
        stagingDir: staging,
        trustedRoot: workspace,
      })
    );

    assertEquals(reads(), 0);
    assertEquals([...fs.readdirSync(outside, { withFileTypes: true })], []);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("materializeEmailAttachment - a symlinked tmp ancestor is refused before creating a missing session child", async () => {
  const tempDir = await makeTempDir({ prefix: "materializer-symlink-missing-" });
  try {
    const workspace = resolve(tempDir, "workspace");
    const outside = resolve(tempDir, "outside");
    await fsp.mkdir(workspace, { recursive: true });
    await fsp.mkdir(outside, { recursive: true });
    await fsp.symlink(outside, resolve(workspace, "tmp"));
    const { store, reads } = countingStore();

    await assertRejects(() =>
      materializeEmailAttachment({
        store,
        sessionOwner: OWNER_1,
        ref: {
          kind: "email-local",
          id: crypto.randomUUID(),
          owner: OWNER_1,
          recordId: crypto.randomUUID(),
          attachmentId: crypto.randomUUID(),
          filename: "private.pdf",
          mimeType: "application/pdf",
          isImage: false,
        },
        stagingDir: resolve(workspace, "tmp", "session-1"),
        trustedRoot: workspace,
      })
    );

    // The missing session child was never created through the symlink.
    assertEquals(reads(), 0);
    assertEquals([...fs.readdirSync(outside, { withFileTypes: true })], []);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});
