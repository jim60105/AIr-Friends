// src/platforms/email/attachment-materializer.ts

import { resolve } from "@std/path";
import type { LocalEmailAttachment } from "../../types/events.ts";
import type { EmailMessageStore } from "./message-store.ts";
import { assertSafePath, assertStagingRootBoundary, canonicalizeRoot } from "./durable-files.ts";
import { sanitizeAttachmentDisplayName } from "./incoming-mime.ts";
import {
  MessageStoreDiagnosticCode,
  MessageStoreError,
  validateOwnerId,
  validateUuid,
} from "./message-store.ts";

export interface MaterializeAttachmentOptions {
  store: EmailMessageStore;
  sessionOwner: string;
  ref: LocalEmailAttachment;
  stagingDir: string;
  /**
   * Host-trusted workspace root that MUST contain `stagingDir`. Every existing
   * component between them is inspected before canonicalization, directory
   * creation or any archive read, so a symlinked workspace/tmp ancestor is
   * refused rather than becoming the authorized staging base.
   */
  trustedRoot: string;
}

/**
 * Materializes an email attachment from owner-scoped EmailMessageStore into
 * the current session's staging directory (<stagingDir>/attachments/<attachmentId>/<filename>).
 *
 * Security & containment invariants:
 * 1. Owner authorization: ref.owner must match sessionOwner strictly.
 * 2. Path confinement: staging directory hierarchy is canonicalized, and symlinks are refused.
 * 3. Store reads: private bytes from EmailMessageStore are read ONLY after owner validation
 *    and staging destination containment checks have passed.
 * 4. Traversal-safe filename: display name is sanitized to a single safe component.
 */
export async function materializeEmailAttachment(
  options: MaterializeAttachmentOptions,
): Promise<string> {
  const { store, sessionOwner, ref, stagingDir, trustedRoot } = options;

  // 1. Strict owner validation & authorization
  const validOwner = validateOwnerId(sessionOwner);
  if (ref.owner !== validOwner) {
    throw new MessageStoreError(
      MessageStoreDiagnosticCode.CROSS_OWNER_DENIED,
      "Cross-owner attachment access is strictly denied",
    );
  }

  // 2. Validate IDs
  validateUuid(ref.recordId, MessageStoreDiagnosticCode.INVALID_RECORD_ID);
  validateUuid(ref.attachmentId, MessageStoreDiagnosticCode.INVALID_ATTACHMENT_ID);

  // 3. Validate the staging root against the host-trusted workspace boundary
  //    BEFORE canonicalization or any filesystem mutation.
  await assertStagingRootBoundary(trustedRoot, stagingDir);

  // 4. Canonicalize the validated staging root.
  const canonicalStaging = await canonicalizeRoot(stagingDir);
  const safeFilename = sanitizeAttachmentDisplayName(ref.filename, 0);

  // Build relative path: attachments/<attachmentId>/<safeFilename>
  const relativeDest = `attachments/${ref.attachmentId}/${safeFilename}`;
  const destDirRel = `attachments/${ref.attachmentId}`;

  // 5. Validate the destination path BEFORE creating any directory or reading
  //    archive bytes. `assertSafePath` refuses traversal, symlinks and
  //    non-file targets that already exist.
  const destDir = resolve(canonicalStaging, destDirRel);
  await assertSafePath(canonicalStaging, relativeDest);

  // 6. Create the private attachment directory, then re-validate the
  //    destination in case a component was replaced between the checks.
  await Deno.mkdir(destDir, { recursive: true, mode: 0o700 });
  await assertSafePath(canonicalStaging, relativeDest);

  // 7. Retrieve attachment bytes only after owner authorization and every
  //    destination check have passed.
  const bytes = await store.attachment(ref.owner, ref.recordId, ref.attachmentId);
  if (!bytes) {
    throw new MessageStoreError(
      MessageStoreDiagnosticCode.ATTACHMENT_NOT_FOUND,
      `Attachment ${ref.attachmentId} not found for record ${ref.recordId}`,
    );
  }

  // 8. The archive read yielded control. Re-authorize the whole staging
  //    boundary IMMEDIATELY before publishing, so a component replaced while
  //    the read was pending is refused instead of adopted.
  await assertStagingRootBoundary(trustedRoot, stagingDir);
  const publishStaging = await canonicalizeRoot(stagingDir);
  const safeDestPath = await assertSafePath(publishStaging, relativeDest);

  // 9. Publish through a private, randomly named sibling created exclusively,
  //    then rename onto the destination. `rename(2)` replaces a symlink ENTRY
  //    rather than following it, so a concurrently planted link can never
  //    redirect the archived bytes outside the session.
  const scratchRel = `${destDirRel}/.${crypto.randomUUID()}.tmp`;
  const scratchPath = await assertSafePath(publishStaging, scratchRel);
  await Deno.writeFile(scratchPath, bytes, { mode: 0o600, createNew: true });
  try {
    await Deno.rename(scratchPath, safeDestPath);
  } catch (error) {
    try {
      await Deno.remove(scratchPath);
    } catch { /* the scratch file may already be gone */ }
    throw error;
  }

  return await assertSafePath(publishStaging, relativeDest);
}
