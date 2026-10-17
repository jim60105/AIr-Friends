// src/platforms/email/attachment-materializer.ts

import { resolve } from "@std/path";
import type { LocalEmailAttachment } from "../../types/events.ts";
import type { EmailMessageStore } from "./message-store.ts";
import { assertSafePath, canonicalizeRoot } from "./durable-files.ts";
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
  const { store, sessionOwner, ref, stagingDir } = options;

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

  // 3. Prepare staging destination root & containment check BEFORE reading store bytes
  const canonicalStaging = await canonicalizeRoot(stagingDir);
  const safeFilename = sanitizeAttachmentDisplayName(ref.filename, 0);

  // Build relative path: attachments/<attachmentId>/<safeFilename>
  const relativeDest = `attachments/${ref.attachmentId}/${safeFilename}`;
  const destDirRel = `attachments/${ref.attachmentId}`;

  // Ensure staging attachments parent directory exists with 0700 permissions
  const destDir = resolve(canonicalStaging, destDirRel);
  await Deno.mkdir(destDir, { recursive: true, mode: 0o700 });

  // Validate that destination path stays strictly within canonicalStaging and encounters no symlinks
  const safeDestPath = await assertSafePath(canonicalStaging, relativeDest);

  // 4. Retrieve attachment bytes from store now that authorization & destination checks have passed
  const bytes = await store.attachment(ref.owner, ref.recordId, ref.attachmentId);
  if (!bytes) {
    throw new MessageStoreError(
      MessageStoreDiagnosticCode.ATTACHMENT_NOT_FOUND,
      `Attachment ${ref.attachmentId} not found for record ${ref.recordId}`,
    );
  }

  // 5. Write exclusively (or overwrite session copy if already materialized)
  await Deno.writeFile(safeDestPath, bytes, { mode: 0o600 });

  return safeDestPath;
}
