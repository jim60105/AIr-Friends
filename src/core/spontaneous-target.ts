// src/core/spontaneous-target.ts
//
// Target selection and durable binding for spontaneous posts (row 25
// `email-spontaneous-targets`).
//
// Discord and Misskey select a channel for one best-effort post and forget it.
// An EMAIL spontaneous post is the autonomous half of a private one-to-one
// correspondence, so its destination is NOT a transient choice: one durable
// occurrence (tick) of the email lane is bound to exactly ONE owner and ONE
// newly allocated internal owner thread before any session or SMTP work, and a
// restarted lane reuses that binding instead of choosing again.

import { type ChannelConfig, type Config, parseChannelId } from "../types/config.ts";
import { formatEmailChannelId } from "@platforms/email/message-store.ts";
import type { SpontaneousOccurrence } from "@platforms/email/spontaneous-store.ts";
import { EmailSpontaneousStore } from "@platforms/email/spontaneous-store.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { Platform } from "../types/events.ts";
import { createLogger } from "@utils/logger.ts";

const logger = createLogger("EmailSpontaneousTarget");

/**
 * Represents a target destination for a spontaneous post.
 */
export interface SpontaneousTarget {
  /** Channel ID to send the message to */
  channelId: string;
}

/**
 * Host-assigned action-slot prefix of the ONE logical outgoing email of one
 * durable spontaneous tick (`spontaneous:<tickId>`). Both the session's
 * `send-reply`/`send-file` calls and the submission journal use this exact slot,
 * so a repeated call is answered by the recorded operation instead of sending a
 * second message.
 */
export const SPONTANEOUS_ACTION_SLOT_PREFIX = "spontaneous:";

/**
 * Email-only fields of one spontaneous target selection.
 *
 * The internal thread is allocated by the email adapter for THIS selection and
 * is durably bound to the occurrence before the session starts, so it survives
 * a restart and is never re-allocated for the same tick.
 */
export interface EmailSpontaneousSelection extends SpontaneousTarget {
  /** Canonical mailbox owner id of the selected account (`e_<sha256>`). */
  userId: string;
  /** Internal thread component of the newly allocated owner thread. */
  newThreadId: string;
}

/**
 * The durably bound email spontaneous target of ONE occurrence: the host-side
 * handoff between the durable schedule lane and the session that delivers it.
 * `tickId` is exactly the occurrence identity, so the session's one logical
 * outgoing email derives its operation key from the same identity.
 */
export interface EmailSpontaneousTarget extends EmailSpontaneousSelection {
  /** Durable occurrence identity (tick) this target was bound to. */
  tickId: string;
}

/**
 * Host-bound email spontaneous session identity.
 *
 * Written by the host before the agent starts and never derivable from a skill
 * call: the session's sends belong to the ONE stable logical operation of its
 * tick, so a repeated tool call (or a restarted tick) is answered by the durable
 * submission journal instead of submitting a second message.
 */
export interface EmailSpontaneousSession {
  /** Durable occurrence identity (tick) of this session. */
  tickId: string;
}

/** Narrow an abstract platform target to the email adapter's own selection. */
export function isEmailSpontaneousSelection(
  target: SpontaneousTarget,
): target is EmailSpontaneousSelection {
  const candidate = target as Partial<EmailSpontaneousSelection>;
  return typeof candidate.userId === "string" && candidate.userId.trim() !== "" &&
    typeof candidate.newThreadId === "string" && candidate.newThreadId.trim() !== "";
}

/**
 * Whether `userId` is a CURRENTLY permitted email spontaneous target: an enabled
 * `email/account/<userId>` channel entry that explicitly opts into spontaneous
 * posting.
 *
 * This is the ONE eligibility rule of the lane: selection, the fire-time recheck
 * of an already bound occurrence and the submission-time recheck all use it, so
 * an account that was disabled, removed or opted out after a target was chosen
 * can never be mailed again by an autonomous send.
 */
export function isSpontaneousTargetAllowed(
  userId: string,
  channels: readonly ChannelConfig[],
): boolean {
  if (typeof userId !== "string" || userId.trim() === "") return false;
  const owner = userId.trim().toLowerCase();
  for (const channel of channels ?? []) {
    if (channel.enabled === false || channel.spontaneousPost !== true) continue;
    const parsed = parseChannelId(channel.id);
    if (!parsed || parsed.platform !== "email" || parsed.type !== "account") continue;
    if (parsed.value.trim().toLowerCase() === owner) return true;
  }
  return false;
}

/**
 * The bound email spontaneous target of one durable occurrence, or `null` when
 * the occurrence carries no target (never dispatchable as an email send).
 */
export function emailSpontaneousTargetOf(
  occurrence: SpontaneousOccurrence,
): EmailSpontaneousTarget | null {
  const target = occurrence.target;
  if (!target) return null;
  return {
    userId: target.owner,
    newThreadId: target.threadId,
    channelId: formatEmailChannelId(target.owner, target.threadId),
    tickId: occurrence.occurrenceId,
  };
}

/** Options of {@link bindEmailSpontaneousOccurrence}. */
export interface BindEmailSpontaneousOccurrenceOptions {
  /** Durable occurrence store of the email spontaneous lane. */
  store: EmailSpontaneousStore;
  /** Platform target selection (the email adapter's own implementation). */
  adapter: { determineSpontaneousTarget(config: Config): Promise<SpontaneousTarget | null> };
  /** Application configuration: the account allowlist is re-read from it NOW. */
  config: Config;
  /** The occurrence the lane is about to dispatch. */
  occurrence: SpontaneousOccurrence;
}

/**
 * Resolve, durably bind and claim ONE occurrence before its session starts.
 *
 * Returns the occurrence with its bound target (`selected`→`started`), or `null`
 * when no eligible target exists at this moment: an already bound occurrence
 * whose account is no longer an enabled opted-in account, or a lane whose
 * selection finds no eligible account. A `null` result means NO session and NO
 * mail for that occurrence — the lane consumes the tick instead of guessing a
 * recipient or stopping for review.
 *
 * Never re-identifies a bound occurrence: the persisted owner/thread is reused
 * verbatim (and re-checked against the CURRENT allowlist), so a restarted tick
 * cannot be re-targeted to another account or another thread. A store rejection
 * propagates — the caller must treat the dispatch as unavailable rather than
 * inventing a replacement identity.
 */
export async function bindEmailSpontaneousOccurrence(
  options: BindEmailSpontaneousOccurrenceOptions,
): Promise<SpontaneousOccurrence | null> {
  const { store, occurrence } = options;

  // The durable snapshot is authoritative: a cached occurrence can never outvote it.
  const state = await store.restore();
  const active = store.activeOccurrence(state);
  if (!active || active.occurrenceId !== occurrence.occurrenceId) {
    return null;
  }

  if (active.target) {
    // Fire-time allowlist recheck of an ALREADY bound target.
    if (!isSpontaneousTargetAllowed(active.target.owner, options.config.channels ?? [])) {
      return null;
    }
    return await store.begin(active.occurrenceId);
  }

  if (active.status !== "scheduled") {
    throw new Error(
      `Email spontaneous occurrence ${active.occurrenceId} is ${active.status} without a bound ` +
        "target; refusing to select a replacement target",
    );
  }

  const selection = await options.adapter.determineSpontaneousTarget(options.config);
  if (!selection || !isEmailSpontaneousSelection(selection)) {
    return null;
  }
  const selected = await store.select(active.occurrenceId, {
    owner: selection.userId,
    threadId: selection.newThreadId,
  });
  const claimed = await store.begin(selected.occurrenceId);
  return claimed;
}

/** The email adapter surface this lane dispatches through. */
export interface EmailSpontaneousAdapter {
  determineSpontaneousTarget(config: Config): Promise<SpontaneousTarget | null>;
  getBotId(): string | null;
}

/** The spontaneous-session entry point this lane starts (the session orchestrator). */
export interface SpontaneousSessionRunner {
  processSpontaneousPost(
    platform: Platform,
    channelId: string,
    platformAdapter: PlatformAdapter,
    options: { botId: string; fetchRecentMessages: boolean; email?: EmailSpontaneousTarget },
  ): Promise<{ success: boolean; error?: string }>;
}

/** Options of {@link dispatchEmailSpontaneousOccurrence}. */
export interface DispatchEmailSpontaneousOccurrenceOptions {
  store: EmailSpontaneousStore;
  adapter: EmailSpontaneousAdapter & PlatformAdapter;
  config: Config;
  occurrence: SpontaneousOccurrence;
  orchestrator: SpontaneousSessionRunner;
}

/**
 * Dispatch ONE email spontaneous tick: bind the occurrence to its target, start the
 * session bound to that owner and NEW thread, and report the session's outcome.
 *
 * A tick with no eligible target is consumed without a session and without mail. A
 * rejection from the occurrence store propagates, so the scheduler records the dispatch
 * as unavailable (review-required) instead of pretending the tick ran.
 */
export async function dispatchEmailSpontaneousOccurrence(
  options: DispatchEmailSpontaneousOccurrenceOptions,
): Promise<void> {
  const bound = await bindEmailSpontaneousOccurrence({
    store: options.store,
    adapter: options.adapter,
    config: options.config,
    occurrence: options.occurrence,
  });
  if (!bound) {
    logger.warn(
      "Email spontaneous occurrence {occurrenceId} has no eligible opted-in target; " +
        "tick consumed without a session",
      { occurrenceId: options.occurrence.occurrenceId },
    );
    return;
  }
  const target = emailSpontaneousTargetOf(bound);
  if (!target) {
    throw new Error(
      `Email spontaneous occurrence ${bound.occurrenceId} was claimed without a bound target`,
    );
  }
  const fetchRecentMessages = Math.random() <
    (options.config.platforms.email?.spontaneousPost?.contextFetchProbability ?? 0.5);
  logger.info("Triggering spontaneous post", {
    platform: "email",
    channelId: target.channelId,
    fetchRecentMessages,
  });
  const response = await options.orchestrator.processSpontaneousPost(
    "email",
    target.channelId,
    options.adapter,
    {
      botId: options.adapter.getBotId() ?? target.userId,
      fetchRecentMessages,
      email: target,
    },
  );
  if (!response.success) {
    logger.warn("Spontaneous post did not succeed", {
      platform: "email",
      error: response.error,
    });
  }
}
