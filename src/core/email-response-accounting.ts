// src/core/email-response-accounting.ts
//
// Explicit email response accounting (row 22, `email-response-accounting`).
//
// Contract (design `Owned interfaces and callsites`):
// - One session owns ONE `EmailResponseAccounting`: which logical email
//   operations were certainly submitted, to the initiating user or to a third
//   party, and whether any operation's outcome is unresolved.
// - `submitted` counts as a session response; `unknown` (and an unclosed
//   `submitting` journal slot) suppresses every automatic retry and is
//   escalated to review-required instead of claiming success.
// - A third-party submission NEVER writes a user reply anchor: this module
//   records accounting only and mutates no message-ID role.
// - The accounting is derived from evidence only — a skill result's
//   `emailSubmission` metadata and/or the durable row-13 `lookup` — never from
//   a skill's `success` flag, which cannot distinguish "nothing was sent" from
//   "the response was lost after acceptance".
//
// This module is pure classification plus the durable-evidence read; the
// session store, the Skill API and the orchestrator own when it is called.

import { OWNER_USER_ID_REGEX } from "@platforms/email/message-store.ts";
import {
  EMAIL_FILES_ACTION_SLOT,
  EMAIL_REPLY_ACTION_SLOT,
} from "@platforms/email/email-adapter.ts";
import { EMAIL_COMPOSE_ACTION_SLOT } from "@skills/email-handler.ts";
import type { EmailOperationKey } from "@platforms/email/submission-store.ts";
import type { EmailSendOutcome } from "@platforms/email/mail-service.ts";
import type { EmailSubmissionMetadata, EmailSubmissionPhase } from "../types/platform.ts";

/**
 * One recorded logical email operation of a session.
 *
 * `phase` is the RECORDED phase of that logical slot: `submitted`, `failed` or
 * `unknown` are terminal results; `prepared`/`submitting` are the durable
 * in-flight states a journal lookup can expose.
 */
export interface EmailResponseOperation {
  operationId: string;
  phase: EmailSubmissionPhase;
  /** Recorded recipient class, when the recording producer knew it. */
  targetKind?: "user" | "third-party";
  /** Host-assigned logical slot, when known (`reply`, `files`, `compose`, `third-party:<grantId>`). */
  actionSlot?: string;
  /** True when the record was served from the journal instead of a new submission. */
  reused?: boolean;
}

/**
 * Immutable accounting snapshot of one session's outbound email.
 */
export interface EmailResponseAccounting {
  /** Mail certainly submitted to the initiating user. */
  submittedToUser: boolean;
  /** Mail certainly submitted to a third party. */
  submittedToThirdParty: boolean;
  /** At least one logical operation's outcome is unresolved (may have been accepted). */
  unknown: boolean;
  /** Every logical operation observed for this session, in first-seen order. */
  operations: readonly EmailResponseOperation[];
}

/** The accounting of a session with no observed email operation. */
export const EMPTY_EMAIL_RESPONSE: EmailResponseAccounting = Object.freeze({
  submittedToUser: false,
  submittedToThirdParty: false,
  unknown: false,
  operations: Object.freeze([]) as readonly EmailResponseOperation[],
});

/** Prefix of the host slot naming a whole granted third-party operation (row 15 vocabulary). */
export const EMAIL_THIRD_PARTY_SLOT_PREFIX = "third-party:";

/**
 * The ordinary (non-partitioned) host slots of an email work item. A reply, a
 * file delivery and a compose are three distinct logical operations and can
 * never share one key.
 */
export const EMAIL_ORDINARY_ACTION_SLOTS: readonly string[] = Object.freeze([
  EMAIL_REPLY_ACTION_SLOT,
  EMAIL_FILES_ACTION_SLOT,
  EMAIL_COMPOSE_ACTION_SLOT,
]);

/**
 * Host-assigned ordinary slot of each skill whose send goes through the email
 * adapter (row 15). `send-email` is absent on purpose: the row-20 handler binds
 * its own slot (`compose` or `third-party:<grantId>`) from the matched grant.
 */
export const EMAIL_HOST_SKILL_SLOTS: Readonly<Record<string, string>> = Object.freeze({
  "send-reply": EMAIL_REPLY_ACTION_SLOT,
  "send-file": EMAIL_FILES_ACTION_SLOT,
});

/** The mailbox owner of an email session, or undefined for any non-email/!owner identity. */
export function emailSessionOwner(session: {
  platform: string;
  userId: string;
}): string | undefined {
  if (session.platform !== "email") return undefined;
  const owner = typeof session.userId === "string" ? session.userId.trim().toLowerCase() : "";
  return OWNER_USER_ID_REGEX.test(owner) ? owner : undefined;
}

/** True when a slot names a third-party operation. */
export function isThirdPartySlot(slot: string | undefined): boolean {
  return typeof slot === "string" && slot.startsWith(EMAIL_THIRD_PARTY_SLOT_PREFIX);
}

/**
 * Every logical slot this session's work item can have used: the ordinary
 * slots plus one partition per immutable destination grant.
 */
export function emailResponseSlots(
  grants: readonly { grantId: string }[] | undefined,
): string[] {
  const slots = [...EMAIL_ORDINARY_ACTION_SLOTS];
  for (const grant of grants ?? []) {
    slots.push(`${EMAIL_THIRD_PARTY_SLOT_PREFIX}${grant.grantId}`);
  }
  return slots;
}

/**
 * Classify one recorded phase into the accounting.
 *
 * - `submitted` counts as a response, split by the recorded recipient class
 *   (`third-party:<grantId>` slot as a fallback when the producer omitted it).
 * - `unknown` and an unclosed `submitting` are unresolved: the operation may
 *   already have been accepted, so they suppress automatic retry.
 * - `prepared` and `failed` are recorded non-delivery evidence: nothing is
 *   claimed delivered, and no automatic-duplicate protection is needed because
 *   a same-slot resend is answered from the journal.
 */
function classifyPhase(
  phase: EmailSubmissionPhase,
): { submitted: boolean; unknown: boolean } {
  switch (phase) {
    case "submitted":
      return { submitted: true, unknown: false };
    case "unknown":
    case "submitting":
      return { submitted: false, unknown: true };
    case "prepared":
    case "failed":
      return { submitted: false, unknown: false };
  }
}

/**
 * Merge one recorded submission into the accounting.
 *
 * The recorded result is immutable and monotonic:
 * - entries are matched by operation id, then by known slot (enriching a
 *   slot-less entry when the slot becomes known), so one logical operation is
 *   never represented twice;
 * - an absorbing entry (`submitted`/`unknown`) is never downgraded or replaced
 *   by a later observation of the same slot, so a completed or unresolved slot
 *   can never be re-classified as "nothing was sent";
 * - `submittedToUser`/`submittedToThirdParty`/`unknown` are latched once true.
 */
export function recordEmailSubmission(
  accounting: EmailResponseAccounting | undefined,
  metadata: EmailSubmissionMetadata,
  actionSlot?: string,
): EmailResponseAccounting {
  const current = accounting ?? EMPTY_EMAIL_RESPONSE;
  const slot = actionSlot;
  const operation: EmailResponseOperation = {
    operationId: metadata.operationId,
    phase: metadata.phase,
    ...(metadata.targetKind === undefined ? {} : { targetKind: metadata.targetKind }),
    ...(slot === undefined ? {} : { actionSlot: slot }),
    ...(metadata.reused === undefined ? {} : { reused: metadata.reused }),
  };

  const operations = [...current.operations];
  const index = operations.findIndex((existing) =>
    existing.operationId === operation.operationId ||
    (slot !== undefined && existing.actionSlot === slot)
  );
  if (index === -1) {
    operations.push(operation);
  } else if (operations[index].phase !== "submitted" && operations[index].phase !== "unknown") {
    // A later observation may upgrade a non-terminal entry, and may supply the
    // slot the earlier one lacked.
    operations[index] = operation;
  } else if (
    operations[index].actionSlot === undefined && operation.actionSlot !== undefined
  ) {
    operations[index] = { ...operations[index], actionSlot: operation.actionSlot };
  }

  // Classify the entry that is actually recorded — an absorbing
  // `submitted`/`unknown` entry is NOT replaced by a later observation of the
  // same slot, so its phase (not the incoming one) decides the flags.
  const effective = index === -1 ? operation : operations[index];
  const thirdParty = effective.targetKind === "third-party" ||
    isThirdPartySlot(effective.actionSlot);
  const classified = classifyPhase(effective.phase);
  const submittedToThirdParty = current.submittedToThirdParty ||
    (classified.submitted && thirdParty);
  const submittedToUser = current.submittedToUser ||
    (classified.submitted && !thirdParty);
  const unknown = current.unknown || classified.unknown;

  if (
    submittedToThirdParty === current.submittedToThirdParty &&
    submittedToUser === current.submittedToUser && unknown === current.unknown &&
    index !== -1 && operations[index] === current.operations[index]
  ) {
    // Nothing changed (a repeated read of the same recorded result).
    return current;
  }

  return Object.freeze({
    submittedToUser,
    submittedToThirdParty,
    unknown,
    operations: Object.freeze(operations),
  });
}

/**
 * Record that this session's email outcome could not be settled: the durable
 * evidence could not be read, or side effects never settled. No operation is
 * invented — only the uncertainty flag is latched.
 */
export function recordEmailUncertainty(
  accounting: EmailResponseAccounting | undefined,
): EmailResponseAccounting {
  const current = accounting ?? EMPTY_EMAIL_RESPONSE;
  if (current.unknown) return current;
  return Object.freeze({ ...current, unknown: true });
}

/** True when at least one logical operation was certainly submitted. */
export function hasEmailSubmitted(accounting: EmailResponseAccounting | undefined): boolean {
  const current = accounting ?? EMPTY_EMAIL_RESPONSE;
  return current.submittedToUser || current.submittedToThirdParty;
}

/**
 * True when this session's email state forbids an automatic retry: a submission
 * already happened (`submitted`) or an outcome is unresolved (`unknown`).
 */
export function hasEmailResponseOrUncertainty(
  accounting: EmailResponseAccounting | undefined,
): boolean {
  const current = accounting ?? EMPTY_EMAIL_RESPONSE;
  return hasEmailSubmitted(current) || current.unknown || hasEmailUncertaintyEvidence(current);
}

/**
 * True when a recorded operation is unresolved (`unknown` or an unclosed
 * `submitting`), so the durable evidence itself requires review.
 */
export function hasEmailUncertaintyEvidence(
  accounting: EmailResponseAccounting | undefined,
): boolean {
  for (const operation of (accounting ?? EMPTY_EMAIL_RESPONSE).operations) {
    if (operation.phase === "unknown" || operation.phase === "submitting") return true;
  }
  return false;
}

/**
 * Durable operation evidence of one email work item: the row-13 lookup.
 * Structurally satisfied by `EmailMailService`.
 */
export interface EmailSubmissionEvidenceSource {
  lookup(owner: string, operationKey: EmailOperationKey): EmailSendOutcome | undefined;
}

/**
 * Read every logical slot of one work item from the durable journal.
 *
 * A recorded result is merged with its slot, so the accounting knows which
 * operation it came from. Nothing is invented when a slot has no record; an
 * unreadable lookup is the caller's problem (it must then fail closed).
 */
export function emailResponseFromEvidence(params: {
  owner: string;
  workId: string;
  slots: readonly string[];
  accounting?: EmailResponseAccounting;
  lookup: (owner: string, operationKey: EmailOperationKey) => EmailSendOutcome | undefined;
}): EmailResponseAccounting {
  let accounting = params.accounting ?? EMPTY_EMAIL_RESPONSE;
  for (const actionSlot of params.slots) {
    const recorded = params.lookup(params.owner, {
      workId: params.workId,
      actionSlot,
    });
    if (!recorded) continue;
    accounting = recordEmailSubmission(accounting, recorded, actionSlot);
  }
  return accounting;
}
