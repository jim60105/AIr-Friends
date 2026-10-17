// src/platforms/email/attachment-preparation.ts
//
// Session-bound preparation of owner-scoped email attachments.
//
// The email adapter stays session-neutral: it returns opaque `email-local`
// references and knows nothing about any session. This capability is composed
// by email activation from the same `EmailMessageStore` and installed on the
// host seams (orchestrator + Skill API) that DO know the calling session. Every
// returned message receives CURRENT-session paths; any path already present on
// incoming metadata is ignored, never reused.

import { sessionStagingDir } from "../../core/session-staging.ts";
import type { Attachment, PlatformMessage } from "../../types/events.ts";
import type { WorkspaceInfo } from "../../types/workspace.ts";
import { materializeEmailAttachment } from "./attachment-materializer.ts";
import type { EmailMessageStore } from "./message-store.ts";

/** Fixed, content-free failure code for an attachment that cannot be staged. */
export const EMAIL_ATTACHMENT_UNAVAILABLE = "email_attachment_unavailable";

/** Bounded, content-free error for every attachment-preparation failure. */
export class EmailAttachmentPreparationError extends Error {
  readonly code = "EMAIL_ATTACHMENT_UNAVAILABLE";

  constructor(options?: { cause?: unknown }) {
    super(EMAIL_ATTACHMENT_UNAVAILABLE, options);
    this.name = "EmailAttachmentPreparationError";
  }
}

/**
 * The host-owned session boundary one preparation call may use.
 *
 * Every field is derived from the authenticated workspace and the host-assigned
 * Skill API session id. None of it is ever read from tool parameters, email
 * body text, attachment metadata or process environment.
 */
export interface EmailAttachmentPreparationScope {
  /** Authenticated email owner whose archive may be read. */
  sessionOwner: string;
  /** Host-trusted workspace root containing the staging directory. */
  trustedRoot: string;
  /** Canonical session staging directory (`{workspace}/tmp/{sessionId}` or tmp root). */
  stagingDir: string;
}

/** Attachment/message preparation for one already-authenticated session. */
export interface EmailAttachmentPreparation {
  /** Stage every local reference of the supplied messages (deduplicated per call). */
  prepareMessages(
    scope: EmailAttachmentPreparationScope,
    messages: readonly PlatformMessage[],
  ): Promise<PlatformMessage[]>;
}

/**
 * Build the canonical, host-owned scope of one email session.
 *
 * The workspace MUST belong to the authenticated email owner; a mismatch is a
 * host invariant violation and fails closed. The staging directory is the same
 * literal the session prompt renders (the Skill API session id), falling back
 * to the workspace tmp root when the Skill API is disabled.
 */
export function emailAttachmentScope(params: {
  workspace: WorkspaceInfo;
  sessionOwner: string;
  skillSessionId?: string | null;
}): EmailAttachmentPreparationScope {
  const { workspace, sessionOwner, skillSessionId } = params;
  if (
    workspace.components.platform !== "email" ||
    workspace.components.userId !== sessionOwner
  ) {
    throw new EmailAttachmentPreparationError();
  }
  return {
    sessionOwner,
    trustedRoot: workspace.path,
    stagingDir: sessionStagingDir(workspace, skillSessionId),
  };
}

/**
 * Compose the production preparation capability over the owner-scoped archive.
 *
 * Every failure (owner mismatch, unsafe path, symlink escape, missing bytes,
 * unwritable destination) is projected to the SAME content-free error, so no
 * filename, body text, archive path or source byte can reach a caller.
 */
export function createEmailAttachmentPreparation(
  store: EmailMessageStore,
): EmailAttachmentPreparation {
  /**
   * One preparation batch shares a reference cache, so two messages naming the
   * same owner/record/attachment are staged once. The cache lives only for the
   * call; no session path is retained globally.
   */
  const prepareBatch = async (
    scope: EmailAttachmentPreparationScope,
    attachments: readonly Attachment[],
    preparedByReference: Map<string, string>,
  ): Promise<Attachment[]> => {
    const prepared: Attachment[] = [];
    for (const attachment of attachments) {
      if (attachment.kind !== "email-local") {
        prepared.push(attachment);
        continue;
      }
      const referenceKey =
        `${attachment.owner}\u0000${attachment.recordId}\u0000${attachment.attachmentId}`;
      let sessionPath = preparedByReference.get(referenceKey);
      if (sessionPath === undefined) {
        try {
          sessionPath = await materializeEmailAttachment({
            store,
            sessionOwner: scope.sessionOwner,
            // Never reuse an incoming sessionPath: a reference recorded by
            // another session must not be presented as this session's copy.
            ref: { ...attachment, sessionPath: undefined },
            stagingDir: scope.stagingDir,
            trustedRoot: scope.trustedRoot,
          });
        } catch (error) {
          throw new EmailAttachmentPreparationError({ cause: error });
        }
        preparedByReference.set(referenceKey, sessionPath);
      }
      prepared.push({ ...attachment, sessionPath });
    }
    return prepared;
  };

  return {
    async prepareMessages(scope, messages) {
      const preparedByReference = new Map<string, string>();
      const prepared: PlatformMessage[] = [];
      for (const message of messages) {
        if (!message.attachments?.some((attachment) => attachment.kind === "email-local")) {
          prepared.push(message);
          continue;
        }
        prepared.push({
          ...message,
          attachments: await prepareBatch(
            scope,
            message.attachments!,
            preparedByReference,
          ),
        });
      }
      return prepared;
    },
  };
}
