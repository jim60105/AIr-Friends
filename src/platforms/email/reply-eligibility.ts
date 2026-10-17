// src/platforms/email/reply-eligibility.ts
//
// Durable explicit reply-anchor eligibility (owned by `resolve-durable-email-reply-anchors`).
//
// Contract:
// - ONE anchor is resolved by authenticated owner, internal owner thread and immutable record id
//   through the durable owner-thread archive. Recent-context bounds play no part: an anchor that
//   has fallen out of the bounded history window is still eligible while the archive retains it.
// - The selected record alone determines wire threading. An INBOUND anchor must itself be a
//   verified sender for the owner; an OUTBOUND anchor takes its recipient from the thread's own
//   durable verified inbound source (never from an owner-wide sender lookup, and never from a
//   substitute anchor).
// - Missing, cross-owner, cross-thread, unthreadable or unverified anchors are explicit refusals
//   with content-free wording. Lookup failures are refusals too, so both the reminder preflight
//   and the adapter fail closed instead of sending into a guessed thread.
//
// This module is host-owned: it exposes no message body, subject or address to a model-facing
// surface, only the recipient and threading metadata one authorized send needs.

import type { EmailMessageStore, StoredEmailRecord } from "./message-store.ts";
import { normalizeEmailMailbox } from "./email-identity.ts";
import type { EmailThreadReference } from "./outgoing-mime.ts";

/** Durable identity of one explicit reply anchor. */
export interface EmailReplyAnchor {
  /** Canonical mailbox owner id (`e_<sha256>`). */
  owner: string;
  /** Internal owner thread the record must belong to. */
  threadId: string;
  /** Immutable record id of the selected anchor. */
  recordId: string;
}

/** What an eligible anchor contributes to one outbound draft. */
export interface EmailReplyEligibility {
  /** Wire linkage of the selected anchor; always usable (a missing one is a refusal). */
  thread: EmailThreadReference;
  /** Verified initiating sender; the only SMTP recipient of this send. */
  recipient: string;
  /** Subject of the selected anchor; the caller applies the reply prefix. */
  subject: string;
}

/** Outcome of resolving one explicit anchor, or the explicit reason it is refused. */
export type EmailReplyEligibilityResult =
  | { ok: true; value: EmailReplyEligibility }
  | { ok: false; error: string };

/** Host-owned resolver shared by the reminder preflight and adapter send resolution. */
export interface EmailReplyEligibilityResolver {
  resolve(anchor: EmailReplyAnchor): Promise<EmailReplyEligibilityResult>;
}

/**
 * Build the durable eligibility resolver over an owner-scoped message store.
 *
 * The returned resolver never throws for an unusable anchor: a validated miss, a cross-owner or
 * cross-thread id, an unparseable id, an unthreadable record and an unverified sender are all
 * refusals, so a caller cannot mistake a lookup error for an eligible anchor.
 */
export function createEmailReplyEligibilityResolver(
  store: EmailMessageStore,
): EmailReplyEligibilityResolver {
  return {
    async resolve(anchor: EmailReplyAnchor): Promise<EmailReplyEligibilityResult> {
      let record: StoredEmailRecord | undefined;
      try {
        record = await store.get(anchor.owner, anchor.threadId, anchor.recordId);
      } catch {
        // A malformed owner/thread/record id, a damaged archive or a closed store cannot prove
        // that the anchor is usable.
        return { ok: false, error: MISSING_ANCHOR_ERROR };
      }
      if (!record) return { ok: false, error: MISSING_ANCHOR_ERROR };

      const thread = threadReferenceOf(record);
      if (!thread) return { ok: false, error: UNTHREADABLE_ANCHOR_ERROR };

      let recipient: string | undefined;
      if (record.direction === "inbound") {
        try {
          const sender = normalizeEmailMailbox(record.from);
          if (sender.userId === anchor.owner) recipient = sender.canonicalAddress;
        } catch {
          // An unparseable stored sender is never a verified recipient.
        }
      } else {
        try {
          recipient = await store.threadInboundRecipient(anchor.owner, anchor.threadId);
        } catch {
          // A damaged archive cannot prove a verified same-thread inbound source.
        }
      }
      if (!recipient) return { ok: false, error: UNVERIFIED_RECIPIENT_ERROR };

      return { ok: true, value: { thread, recipient, subject: record.subject } };
    },
  };
}

/** The thread linkage of one anchor, or undefined when it carries no wire identifiers at all. */
export function threadReferenceOf(anchor: StoredEmailRecord): EmailThreadReference | undefined {
  const references = anchor.references ?? [];
  if (!anchor.wireMessageId && references.length === 0) return undefined;
  return {
    ...(anchor.wireMessageId ? { wireMessageId: anchor.wireMessageId } : {}),
    ...(references.length > 0 ? { references: [...references] } : {}),
  };
}

const MISSING_ANCHOR_ERROR =
  "The reply anchor is not a retained record of this owner thread; nothing was sent.";
const UNTHREADABLE_ANCHOR_ERROR =
  "The reply anchor carries no RFC 5322 wire identifiers, so the reply cannot stay in the thread; nothing was sent.";
const UNVERIFIED_RECIPIENT_ERROR =
  "The stored thread sender does not match the thread owner, so it is not a verified recipient; nothing was sent.";
