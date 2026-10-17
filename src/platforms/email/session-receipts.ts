// src/platforms/email/session-receipts.ts
//
// Durable email work receipts owned by `email-session-receipts`.
//
// Translates accepted mailbox hand-off work (the poller's `IncomingWork`) into
// the mailbox journal's explicit lifecycle, preserving the receive-crash
// ordering the email design requires:
//
// - `beginEmailWork` fsyncs the journal `started` record with the hand-off
//   workId BEFORE the agent or a delivery side effect can act. Work that only
//   waits for the execution lease stays unstarted, so startup can requeue it.
// - `finishEmailWork` records the terminal receipt only after the session's
//   explicit lifecycle result AND a side-effect settler that proves every
//   in-flight email effect has landed or rolled back. An unconfirmed
//   `completed` is downgraded to `review-required` instead of claimed.
// - `requireReview` records the uncertain-outcome escalation (crash, teardown,
//   lost agent session, swallowed downstream handler failure), so the journal
//   says "needs review" rather than replaying or claiming success.
// - `denyAdmission` records work that will never execute as terminally
//   ignored (rejected policy, removed account, control command), so an
//   admission decision is never left pending forever.
//
// This module owns no mailbox storage itself: `MailboxStore`
// (`email-mailbox-journal`) stays the single durable authority.

import { createLogger } from "@utils/logger.ts";
import type { EmailWorkReceipt } from "../../types/events.ts";
import type { MailboxKey, MailboxStore } from "./mailbox-store.ts";

const logger = createLogger("EmailSessionReceipts");

/** Terminal outcomes an email work item may be finished with. */
export type EmailWorkOutcome = "completed" | "ignored" | "failed" | "review-required";

/**
 * Settler for one session's in-flight email side effects.
 *
 * Resolves `true` only when every effect the session started has landed or
 * rolled back, and `false` when settlement could not be confirmed. A `false`
 * result never yields a `completed` receipt.
 */
export type EmailSideEffectSettler = () => Promise<boolean>;

/** Completion evidence for one email work item. */
export interface EmailWorkCompletion {
  /** Terminal outcome derived from the session's explicit lifecycle result. */
  outcome: EmailWorkOutcome;
  /** Safe detail code (never message content, addresses or credentials). */
  detail?: string;
  /**
   * Awaited BEFORE the terminal receipt is written. Every outcome that makes a
   * claim about effects (`completed` and `failed`) requires this settler to
   * resolve `true`; an unconfirmed settlement is recorded as `review-required`
   * with `unsettled-side-effects` instead, because an effect that is still in
   * flight can land after the outcome was observed.
   */
  settle: EmailSideEffectSettler;
}

/** Maps the event-carried receipt onto the durable mailbox identity. */
export function mailboxKeyOf(receipt: EmailWorkReceipt): MailboxKey {
  return {
    fingerprint: receipt.mailboxKey.fingerprint,
    uidValidity: receipt.mailboxKey.uidValidity,
    uid: receipt.mailboxKey.uid,
  };
}

/**
 * Records the durable lifecycle receipts of email work items on one mailbox
 * journal. One instance serves the whole process; every method is idempotent
 * or fails closed through `MailboxStore`'s guarded transitions.
 */
export class EmailSessionReceipts {
  private readonly store: MailboxStore;

  constructor(store: MailboxStore) {
    this.store = store;
  }

  /**
   * Whether the entry still awaits execution, i.e. its durable state is
   * `accepted` (or a bare `discovered` entry that was never accepted).
   *
   * A caller that is about to perform an external delivery on behalf of this
   * work item uses this to decide whether it must take the fence itself.
   */
  isUnstarted(receipt: EmailWorkReceipt): boolean {
    const state = this.store.getEntry(mailboxKeyOf(receipt))?.state;
    return state === "accepted" || state === "discovered";
  }

  /**
   * The durable start fence.
   *
   * MUST be awaited before the first agent prompt or dry-run mock side effect
   * of the corresponding work item: it fsyncs the `started` journal record
   * (carrying the hand-off workId) before returning. Throws when the entry is
   * not in an `accepted` state, so a caller never prompts on unfenced work.
   */
  async beginEmailWork(receipt: EmailWorkReceipt): Promise<void> {
    await this.store.start(mailboxKeyOf(receipt), receipt.workId);
    logger.info("Email work started: {WorkId}", { WorkId: receipt.workId });
  }

  /**
   * Records the terminal receipt for a fenced work item.
   *
   * The completion's side-effect settler is awaited FIRST; `completed` is
   * written only when it confirms settlement, otherwise the outcome is
   * escalated to `review-required` so an uncertain delivery is never reported
   * as a clean completion.
   */
  async finishEmailWork(
    receipt: EmailWorkReceipt,
    completion: EmailWorkCompletion,
  ): Promise<void> {
    const claimsEffects = completion.outcome === "completed" || completion.outcome === "failed";
    if (claimsEffects && typeof completion.settle !== "function") {
      throw new Error(
        "Finishing email work with a claimed outcome requires a side-effect settler: an unproven settlement must not be recorded as completed or failed",
      );
    }

    let outcome = completion.outcome;
    let detail = completion.detail;
    if (claimsEffects && !(await completion.settle())) {
      outcome = "review-required";
      detail = "unsettled-side-effects";
    }

    await this.store.finish(mailboxKeyOf(receipt), outcome, {
      workId: receipt.workId,
      detail,
    });
    logger.info("Email work finished: {WorkId} outcome={Outcome}", {
      WorkId: receipt.workId,
      Outcome: outcome,
    });
  }

  /**
   * Escalates a fenced work item to `review-required`.
   *
   * Used whenever the outcome is uncertain — process/teardown crash, lost agent
   * session, swallowed downstream handler failure, or a start fence whose write
   * was interrupted. Later polls never replay a review-required entry.
   */
  async requireReview(receipt: EmailWorkReceipt, detail: string): Promise<void> {
    await this.store.finish(mailboxKeyOf(receipt), "review-required", {
      workId: receipt.workId,
      detail,
    });
    logger.warn("Email work requires review: {WorkId} detail={Detail}", {
      WorkId: receipt.workId,
      Detail: detail,
    });
  }

  /**
   * Records work that will never be executed as terminally `ignored`.
   *
   * Used for rejected policy, a removed account, a platform with no registered
   * adapter, and control commands that need no agent turn. Leaving such an
   * admission in `accepted` would make every later start re-emit it.
   */
  async denyAdmission(receipt: EmailWorkReceipt, reason: string): Promise<void> {
    await this.store.finish(mailboxKeyOf(receipt), "ignored", {
      workId: receipt.workId,
      detail: reason,
    });
    logger.info("Email work admission denied: {WorkId} reason={Reason}", {
      WorkId: receipt.workId,
      Reason: reason,
    });
  }
}
