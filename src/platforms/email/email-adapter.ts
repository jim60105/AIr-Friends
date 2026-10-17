// src/platforms/email/email-adapter.ts
//
// Email `PlatformAdapter` composing the owned email modules. Owned by `email-adapter`.
//
// Contract (design `EmailAdapter / PlatformAdapter wiring`, row 15):
// - The adapter is the ONLY platform-facing face of the email platform. It composes the
//   serialized IMAP poller (receiving), the owner message store (thread history) and the
//   durable mail service (every outbound path). It never talks to IMAP or SMTP itself and
//   never invents durable state.
// - Receiving: polled work is emitted through the SAME normalized-event entry point as every
//   other platform, with the channel `mail:<owner>:<thread>`, the verified sender as the user
//   identity, owner-scoped local attachment references and the typed durable work receipt the
//   session lifecycle fences on.
// - Sending: ordinary replies and file deliveries go ONLY to the verified original sender
//   re-derived from the owner thread (never `Reply-To`/`Cc`/`Bcc`, never a stored string used
//   unchecked), inside the owner-bound thread, and only when the host supplied the operation
//   context. A send without that context is refused instead of guessed.
// - Capabilities: email supports owner-thread history, private messages, replies and files.
//   Editing, reactions, typing indicators, guilds and message search are NOT supported and are
//   reported as explicit unsupported results — an edit is NEVER emulated by another send.
//
// This module is intentionally NOT registered in production bootstrap; email activation remains
// guarded until the final batch cutover.

import { createLogger } from "@utils/logger.ts";
import { PlatformAdapter } from "../platform-adapter.ts";
import type {
  EmailWorkReceipt,
  NormalizedEvent,
  Platform,
  PlatformMessage,
} from "../../types/events.ts";
import type { ChannelConfig, Config, EmailConfig } from "../../types/config.ts";
import { parseChannelId } from "../../types/config.ts";
import type { SpontaneousTarget } from "../../core/spontaneous-target.ts";
import {
  ConnectionState,
  type EmailSendContext,
  type PlatformCapabilities,
  type PlatformEmoji,
  type ReactionResult,
  type ReplyOptions,
  type ReplyResult,
  type SendFileOptions,
  type SendFilePayload,
  type SendFileResult,
} from "../../types/platform.ts";
import type { ImapTransport } from "./imap-client.ts";
import type { MailboxStore } from "./mailbox-store.ts";
import {
  EmailMailboxPoller,
  type IncomingWork,
  type PollCycleResult,
  type ReviewItem,
} from "./mailbox-poller.ts";
import type { EmailMailService, EmailSendOutcome } from "./mail-service.ts";
import type { EmailDraft, EmailOutgoingAttachment } from "./outgoing-mime.ts";
import {
  formatEmailChannelId,
  OWNER_USER_ID_REGEX,
  parseEmailChannelId,
  type StoredEmailRecord,
} from "./message-store.ts";
import type { EmailMessageStore } from "./message-store.ts";
import { normalizeEmailMailbox } from "./email-identity.ts";

const logger = createLogger("EmailAdapter");

/** Operation slot bound for an ordinary reply (matches the shared operation-key vocabulary). */
export const EMAIL_REPLY_ACTION_SLOT = "reply";

/** Operation slot bound for an ordinary file delivery. */
export const EMAIL_FILES_ACTION_SLOT = "files";

/**
 * Host-assigned slot prefixes that name a whole non-ordinary operation
 * (`third-party:<grantId>`, `reminder:<id>`, `spontaneous:<tickId>`).
 */
const PARTITIONED_SLOT_PREFIXES = ["third-party:", "reminder:", "spontaneous:"] as const;

/** Bounded thread scan used to resolve a reply's sender and thread anchor. */
const SEND_HISTORY_LIMIT = 200;

/** Bounded upper limit accepted by {@link EmailAdapter.fetchRecentMessages}. */
const FETCH_HISTORY_LIMIT = 200;

/** Safe unsupported-capability wording; email never emulates a missing capability. */
const UNSUPPORTED_EDIT =
  "Email cannot edit a sent message. Nothing was changed and no replacement message was sent.";
const UNSUPPORTED_REACTION =
  "Email cannot add a reaction. No reaction was added and no message was sent.";
const UNSUPPORTED_TYPING = "Email has no typing indicator. No network action was performed.";

/** Display media type for an outgoing attachment filename (bounded, conservative default). */
const MIME_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
};

/** Kind of ordinary send; selects the operation slot bound when the host assigned none. */
type EmailSendKind = typeof EMAIL_REPLY_ACTION_SLOT | typeof EMAIL_FILES_ACTION_SLOT;

/** Options for constructing an {@link EmailAdapter}. */
export interface EmailAdapterOptions {
  /** Email platform configuration (identity, folders, limits, signature). */
  config: EmailConfig;
  /** IMAP transport owned by the mailbox poller (production: `EmailImapClient`). */
  transport: ImapTransport;
  /** Durable mailbox journal; its fingerprint MUST match the configured mailbox. */
  mailboxStore: MailboxStore;
  /** Owner-scoped message and thread history store. */
  messageStore: EmailMessageStore;
  /** Common durable outbound send service; the only path that may submit mail. */
  mailService: EmailMailService;
  /** Configured channels; the sender allowlist and the enabled email accounts. */
  channels: ChannelConfig[];
  /** Reports mailbox entries requiring operator review (forwarded from the poller). */
  onReviewRequired?: (item: ReviewItem) => void | Promise<void>;
  /** Reports an aborted poll round's safe diagnostic code. */
  onCycleError?: (code: string) => void | Promise<void>;
  /** Override the poller's bounded UID batch size. */
  batchLimit?: number;
  /** Override the poller's bounded reconciliation history scan size. */
  historyLimit?: number;
  /** Injectable work-id factory for the poller (defaults to `crypto.randomUUID`). */
  workIdFactory?: () => string;
}

/** Resolved send target for one outbound email. */
interface SendPreparation {
  owner: string;
  workId: string;
  threadId: string;
  slot: string;
  /** Verified original sender; the only SMTP recipient of this thread's mail. */
  recipient: string;
  subject: string;
  /** Thread linkage headers, or undefined when the source carries no wire identifiers. */
  thread: EmailDraft["thread"];
}

/** Outcome of resolving an outbound send, or the explicit reason it was refused. */
type SendResolution =
  | { ok: true; value: SendPreparation }
  | { ok: false; error: string };

/** Outcome of submitting one draft through the durable mail service. */
type Submission =
  | { ok: true; outcome: EmailSendOutcome }
  | { ok: false; error: string; outcome?: EmailSendOutcome };

/**
 * Email platform adapter.
 *
 * Wire-up is deliberately manual: no production bootstrap registers this class until the
 * activation change removes the config guard.
 */
export class EmailAdapter extends PlatformAdapter {
  readonly platform: Platform = "email";
  readonly capabilities: PlatformCapabilities;

  private readonly messageStore: EmailMessageStore;
  private readonly mailService: EmailMailService;
  private readonly channels: ChannelConfig[];
  private readonly poller: EmailMailboxPoller;
  private readonly botOwnerId: string;

  /** In-flight `connect()`, shared by concurrent callers so the poller starts exactly once. */
  private startPromise: Promise<void> | null = null;
  /** Set while a `disconnect()` is in flight, so a start that is still running stops instead. */
  private stopping = false;
  private started = false;

  constructor(options: EmailAdapterOptions) {
    super();

    this.messageStore = options.messageStore;
    this.mailService = options.mailService;
    this.channels = options.channels ?? [];
    this.botOwnerId = normalizeEmailMailbox(options.config.address).userId;
    this.capabilities = {
      canFetchHistory: true,
      canSearchMessages: false,
      supportsDm: true,
      supportsGuild: false,
      supportsReactions: false,
      supportsEditing: false,
      // Email has no message-length truncation: the bound is the configured MIME byte limit
      // enforced by construction and the submission service, so content is never sliced.
      maxMessageLength: options.config.maxMessageBytes,
    };

    this.poller = new EmailMailboxPoller({
      config: options.config,
      transport: options.transport,
      mailboxStore: options.mailboxStore,
      messageStore: options.messageStore,
      channels: this.channels,
      emit: (work) => this.onIncomingWork(work),
      onReviewRequired: options.onReviewRequired,
      onCycleError: options.onCycleError,
      batchLimit: options.batchLimit,
      historyLimit: options.historyLimit,
      workIdFactory: options.workIdFactory,
    });
  }

  // ============ Lifecycle ============

  /**
   * Start receiving: recovery first, then the poller's own serialized rounds.
   *
   * Concurrent callers share one start, so a repeated connect never arms a second round timer.
   * A `disconnect()` that lands while the first round is still in flight wins: the poller is
   * stopped instead of arming the repeating timer behind the caller's back.
   */
  async connect(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) return await this.startPromise;

    this.stopping = false;
    this.updateConnectionState(ConnectionState.CONNECTING);
    const start = (async () => {
      try {
        await this.poller.start();
      } catch (error) {
        this.updateConnectionState(
          ConnectionState.ERROR,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      if (this.stopping) {
        // The caller asked to stop while the first round was running.
        await this.poller.stop();
        this.updateConnectionState(ConnectionState.DISCONNECTED);
        return;
      }
      this.started = true;
      this.updateConnectionState(ConnectionState.CONNECTED);
    })().finally(() => {
      this.startPromise = null;
    });
    this.startPromise = start;
    return await start;
  }

  /**
   * Stop receiving: no new work is accepted, the in-flight round (and its hand-off) settles, the
   * round timer is cleared and the transport is disconnected.
   *
   * A start that is still running is awaited and then stopped, so no polling loop survives a
   * disconnect that arrived mid-start.
   */
  async disconnect(): Promise<void> {
    this.stopping = true;
    const pending = this.startPromise;
    if (pending) {
      try {
        await pending;
      } catch {
        // A failed start left nothing running.
      }
    }
    if (this.started) {
      this.started = false;
      await this.poller.stop();
      this.updateConnectionState(ConnectionState.DISCONNECTED);
    }
    this.stopping = false;
  }

  /**
   * Run exactly one poll round through the owned poller.
   *
   * Exposed for the controlled smoke checks and deterministic tests that must not wait for the
   * configured interval; rounds still never overlap, may also be driven before `connect()`, and
   * still honour `disconnect()`.
   */
  poll(): Promise<PollCycleResult> {
    return this.poller.poll();
  }

  // ============ Receiving ============

  /**
   * Normalize one accepted mailbox work item into the common event entry point.
   *
   * The event carries the durable work receipt so the session lifecycle fences the same work id
   * the poller accepted; a work item whose stored record is unreadable emits NOTHING rather than
   * fabricating an empty message. The poller logs the failed hand-off and the entry stays
   * accepted-unstarted, so the retry boundary is the next startup recovery — an empty event would
   * instead fence the receipt on fabricated content and consume real mail.
   */
  private async onIncomingWork(work: IncomingWork): Promise<void> {
    const record = await this.messageStore.getByOwnerRecord(work.owner, work.recordId);
    if (!record) {
      throw new Error(
        `Accepted email work ${work.workId} has no stored record; refusing to emit an empty event`,
      );
    }

    const [message] = this.messageStore.toPlatformMessages([record]);
    if (!message) {
      throw new Error(
        `Accepted email work ${work.workId} produced no message view; refusing to emit`,
      );
    }

    const receipt: EmailWorkReceipt = {
      kind: "email-work",
      workId: work.workId,
      mailboxKey: {
        fingerprint: work.mailboxKey.fingerprint,
        uidValidity: work.mailboxKey.uidValidity,
        uid: work.mailboxKey.uid,
      },
      recordId: work.recordId,
    };

    const event: NormalizedEvent = {
      platform: "email",
      channelId: formatEmailChannelId(work.owner, work.threadId),
      userId: work.owner,
      username: work.verifiedSender.canonicalAddress,
      messageId: work.recordId,
      isDm: true,
      guildId: "",
      content: message.content,
      timestamp: message.timestamp,
      attachments: message.attachments,
      emailWork: receipt,
    };

    await this.emitEvent(event);
  }

  // ============ History ============

  /**
   * Owner-thread history. The channel id is the only thread selector, so a caller can never read
   * another owner's or another thread's records.
   */
  async fetchRecentMessages(channelId: string, limit: number): Promise<PlatformMessage[]> {
    const parsed = this.parseChannelQuietly(channelId);
    if (!parsed) return [];

    const bounded = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), FETCH_HISTORY_LIMIT)
      : FETCH_HISTORY_LIMIT;

    try {
      const records = await this.messageStore.history(parsed.owner, parsed.threadId, bounded);
      return this.messageStore.toPlatformMessages(records);
    } catch (error) {
      logger.warn("Failed to read email thread history: {Error}", {
        Error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * One message from the owner thread. Both the owner and the thread from the channel id must
   * contain the record, so a cross-thread or cross-owner lookup yields `null`.
   */
  async fetchMessage(channelId: string, messageId: string): Promise<PlatformMessage | null> {
    const parsed = this.parseChannelQuietly(channelId);
    if (!parsed) return null;

    try {
      const record = await this.messageStore.get(parsed.owner, parsed.threadId, messageId);
      if (!record) return null;
      return this.messageStore.toPlatformMessages([record])[0] ?? null;
    } catch {
      // An identifier that is not a stored record UUID is simply not found here.
      return null;
    }
  }

  // ============ Sending ============

  /**
   * Send an ordinary reply into the owner thread, addressed only to the verified original
   * sender, through the durable mail service.
   */
  async sendReply(
    channelId: string,
    content: string,
    options?: ReplyOptions,
  ): Promise<ReplyResult> {
    const resolution = await this.resolveSend(
      channelId,
      options?.emailSend,
      EMAIL_REPLY_ACTION_SLOT,
      options?.replyToMessageId,
    );
    if (!resolution.ok) {
      logger.warn("Refused an email reply: {Reason}", { Reason: resolution.error });
      return { success: false, error: resolution.error };
    }

    const draft: EmailDraft = {
      owner: resolution.value.owner,
      operationKey: { workId: resolution.value.workId, actionSlot: resolution.value.slot },
      targetKind: "user",
      to: resolution.value.recipient,
      subject: resolution.value.subject,
      authoredBody: content,
      thread: resolution.value.thread,
    };

    const submission = await this.submit(draft);
    if (!submission.ok) {
      return { success: false, error: submission.error, emailSubmission: submission.outcome };
    }
    return {
      success: true,
      messageId: submission.outcome.recordId ?? submission.outcome.messageId,
      emailSubmission: submission.outcome,
    };
  }

  /**
   * Deliver files as ONE email with the supplied attachments into the owner thread, addressed
   * only to the verified original sender.
   *
   * Delivery is reported from the submission's own phase: nothing is reported as delivered while
   * the outcome is uncertain, and a partially constructed batch never reaches SMTP at all.
   */
  async sendFile(
    channelId: string,
    files: SendFilePayload[],
    options?: SendFileOptions,
  ): Promise<SendFileResult> {
    if (!Array.isArray(files) || files.length === 0) {
      return { success: false, error: "No files supplied for an email delivery" };
    }

    const resolution = await this.resolveSend(
      channelId,
      options?.emailSend,
      EMAIL_FILES_ACTION_SLOT,
      options?.replyToMessageId,
    );
    if (!resolution.ok) {
      logger.warn("Refused an email file delivery: {Reason}", { Reason: resolution.error });
      return { success: false, error: resolution.error };
    }

    const attachments: EmailOutgoingAttachment[] = files.map((file) => ({
      filename: file.fileName,
      contentType: MIME_TYPES_BY_EXTENSION[
        /\.([A-Za-z0-9]+)$/.exec(file.fileName.trim())?.[1]?.toLowerCase() ?? ""
      ] ?? "application/octet-stream",
      content: file.content,
    }));

    const draft: EmailDraft = {
      owner: resolution.value.owner,
      operationKey: { workId: resolution.value.workId, actionSlot: resolution.value.slot },
      targetKind: "user",
      to: resolution.value.recipient,
      subject: resolution.value.subject,
      authoredBody: options?.comment ?? "",
      thread: resolution.value.thread,
      attachments,
    };

    const submission = await this.submit(draft);
    if (!submission.ok) {
      return { success: false, error: submission.error, emailSubmission: submission.outcome };
    }

    // One email carries the whole batch: a single delivered message id, never a partial claim.
    const messageId = submission.outcome.recordId ?? submission.outcome.messageId;
    return {
      success: true,
      messageId,
      messageIds: messageId ? [messageId] : undefined,
      emailSubmission: submission.outcome,
    };
  }

  /**
   * Resolve one outbound send.
   *
   * Every refusal happens BEFORE any construction or SMTP work, and the recipient is the verified
   * original sender re-derived from the owner thread — the stored address is not trusted as-is,
   * `Reply-To`/`Cc`/`Bcc` are never consulted, and the mail service re-checks the allowlist
   * immediately before submission.
   */
  private async resolveSend(
    channelId: string,
    emailSend: EmailSendContext | undefined,
    kind: EmailSendKind,
    replyToMessageId: string | undefined,
  ): Promise<SendResolution> {
    const parsed = this.parseChannelQuietly(channelId);
    if (!parsed) {
      return { ok: false, error: `Not a valid email channel id: "${channelId}"` };
    }
    const { owner, threadId } = parsed;

    if (!emailSend || typeof emailSend !== "object") {
      return {
        ok: false,
        error:
          "Email sending requires the host-provided operation context (workId and owner); nothing was sent.",
      };
    }
    const workId = typeof emailSend.workId === "string" ? emailSend.workId.trim() : "";
    if (workId === "") {
      return {
        ok: false,
        error: "The email operation context has no workId; nothing was sent.",
      };
    }
    const contextOwner = typeof emailSend.owner === "string"
      ? emailSend.owner.trim().toLowerCase()
      : "";
    if (contextOwner !== owner) {
      return {
        ok: false,
        error:
          "The email operation context belongs to a different owner than this channel; nothing was sent.",
      };
    }

    const history = await this.messageStore.history(owner, threadId, SEND_HISTORY_LIMIT);
    if (history.length === 0) {
      return {
        ok: false,
        error: "This email thread has no stored source message; nothing was sent.",
      };
    }

    let anchor = history[history.length - 1];
    if (replyToMessageId !== undefined) {
      const requested = history.find((record) => record.recordId === replyToMessageId);
      if (!requested) {
        return {
          ok: false,
          error: "The reply anchor is not part of this owner thread; nothing was sent.",
        };
      }
      anchor = requested;
    }

    const thread = threadReferenceOf(anchor);
    if (!thread) {
      return {
        ok: false,
        error:
          "The thread source carries no RFC 5322 wire identifiers, so the reply cannot stay in the thread; nothing was sent.",
      };
    }

    const inbound = [...history].reverse().find((record) => record.direction === "inbound");
    if (!inbound) {
      return {
        ok: false,
        error: "This email thread has no inbound source message; nothing was sent.",
      };
    }

    let recipient: string;
    try {
      const sender = normalizeEmailMailbox(inbound.from);
      if (sender.userId !== owner) {
        return {
          ok: false,
          error:
            "The stored thread sender does not match the thread owner, so it is not a verified recipient; nothing was sent.",
        };
      }
      recipient = sender.canonicalAddress;
    } catch {
      return {
        ok: false,
        error: "The stored thread sender is not a usable address; nothing was sent.",
      };
    }

    return {
      ok: true,
      value: {
        owner,
        workId,
        threadId,
        slot: operationSlot(emailSend.actionSlot, kind),
        recipient,
        subject: replySubject(anchor.subject),
        thread,
      },
    };
  }

  /** Submit one constructed draft and report the submission's own phase, never more. */
  private async submit(draft: EmailDraft): Promise<Submission> {
    try {
      const outcome = await this.mailService.send(draft);
      if (outcome.phase === "submitted") return { ok: true, outcome };
      return { ok: false, error: submissionErrorText(outcome), outcome };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown email submission failure",
      };
    }
  }

  // ============ Unsupported capabilities (explicit, never emulated) ============

  /**
   * Email has no typing indicator. The inherited contract is void, so this performs no network
   * action; {@link supportsTypingIndicator} reports the unsupported status to callers.
   */
  async sendTyping(_channelId: string): Promise<void> {
    logger.debug(UNSUPPORTED_TYPING);
    // No network action is performed; this resolves the inherited async contract directly.
    await Promise.resolve();
  }

  /** Email never reports typing support; see {@link sendTyping}. */
  override supportsTypingIndicator(): boolean {
    return false;
  }

  /** Email has no reactions; an explicit unsupported result is returned. */
  async addReaction(
    _channelId: string,
    _messageId: string,
    _emoji: string,
  ): Promise<ReactionResult> {
    return await Promise.resolve({ success: false, error: UNSUPPORTED_REACTION });
  }

  /** Email never edits a sent message, and never sends a replacement in its place. */
  async editMessage(
    _channelId: string,
    _messageId: string,
    _newContent: string,
    _replyToMessageId?: string,
  ): Promise<ReplyResult> {
    return await Promise.resolve({ success: false, error: UNSUPPORTED_EDIT });
  }

  /** Email has no custom emoji catalog; Unicode emoji need no listing. */
  async fetchEmojis(): Promise<PlatformEmoji[]> {
    return await Promise.resolve([]);
  }

  /** Email has no reaction state to read back. */
  async hasBotReaction(_channelId: string, _messageId: string): Promise<boolean> {
    return await Promise.resolve(false);
  }

  /** Email has no mention concept; every admitted message is already addressed to this mailbox. */
  async hasBotMention(_channelId: string, _messageId: string): Promise<boolean> {
    return await Promise.resolve(false);
  }

  /**
   * Email resolves no display name from an opaque owner id, so the canonical user id itself is
   * the identity (the same identifier used for the channel, workspace and session).
   */
  async getUsername(userId: string): Promise<string> {
    return await Promise.resolve(userId);
  }

  /** Whether the given id is this mailbox's own canonical owner id. */
  isSelf(userId: string): boolean {
    return userId === this.botOwnerId;
  }

  /** The bot's canonical owner id, known from configuration without any connection. */
  getBotId(): string | null {
    return this.botOwnerId;
  }

  // ============ Threads & spontaneous targets ============

  /**
   * Create a new internal thread for an ENABLED email account.
   *
   * The owner id must be a canonical mailbox id and must currently be an enabled email account
   * channel; anything else yields `null`. The thread id is allocated by the message store, so it
   * becomes durable when the first record of the thread is written.
   *
   * A brand-new thread has no source message, so an ORDINARY reply into it is refused by
   * {@link sendReply}; the new-thread delivery for scheduled/spontaneous use is owned by
   * `email-spontaneous-targets`, which supplies the operation context and the draft for it.
   */
  async getDmChannelId(userId: string): Promise<string | null> {
    const owner = typeof userId === "string" ? userId.trim().toLowerCase() : "";
    if (!OWNER_USER_ID_REGEX.test(owner)) {
      logger.warn("Refusing to allocate an email thread for a non-owner identifier");
      return null;
    }
    const isEnabledAccount = this.channels.some((channel) => {
      if (channel.enabled === false) return false;
      const parsed = parseChannelId(channel.id);
      return parsed?.platform === "email" &&
        parsed.type === "account" &&
        parsed.value.trim().toLowerCase() === owner;
    });
    if (!isEnabledAccount) {
      logger.warn("Refusing to allocate an email thread for an account that is not enabled");
      return null;
    }

    const { threadId } = await this.messageStore.resolveThread(owner, {});
    return formatEmailChannelId(owner, threadId);
  }

  /**
   * Spontaneous target selection. Only enabled email accounts opted into spontaneous posting are
   * candidates, and each candidate gets its OWN new internal thread (per durable tick; the
   * occurrence identity that binds such a thread is owned by `email-spontaneous-targets`).
   */
  async determineSpontaneousTarget(config: Config): Promise<SpontaneousTarget | null> {
    const targets: SpontaneousTarget[] = [];

    for (const channel of config.channels ?? []) {
      if (channel.enabled === false || !channel.spontaneousPost) continue;
      const parsed = parseChannelId(channel.id);
      if (!parsed || parsed.platform !== "email" || parsed.type !== "account") continue;
      const channelId = await this.getDmChannelId(parsed.value);
      if (channelId) targets.push({ channelId });
    }

    if (targets.length === 0) {
      logger.warn("No email accounts configured for spontaneous posting");
      return null;
    }

    return targets[Math.floor(Math.random() * targets.length)];
  }

  /** Parse a channel id without letting an invalid one escape as an exception. */
  private parseChannelQuietly(channelId: string): { owner: string; threadId: string } | null {
    try {
      return parseEmailChannelId(channelId);
    } catch {
      return null;
    }
  }
}

/**
 * Bind the operation slot for one send.
 *
 * A partitioned host slot (`third-party:`/`reminder:`/`spontaneous:`) names the whole
 * operation and is used verbatim. Anything else — an ordinary session, or no host slot at all —
 * binds the kind's own slot, so an ordinary reply and an ordinary file delivery for one work item
 * can never share one operation key (which would silently reuse the first result instead of
 * sending the second message).
 */
function operationSlot(hostSlot: string | undefined, kind: EmailSendKind): string {
  const candidate = typeof hostSlot === "string" ? hostSlot.trim() : "";
  if (PARTITIONED_SLOT_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return candidate;
  if (candidate !== "") {
    // A host-supplied value that is not a partitioned operation is almost certainly a host bug:
    // the kind slot is bound instead, so the send still happens under its own operation key.
    logger.warn(
      "Ignoring unrecognized email action slot {Slot}; binding the {Kind} slot instead",
      { Slot: candidate, Kind: kind },
    );
  }
  return kind;
}

/** The thread linkage for a reply, or undefined when the source has no wire identifiers at all. */
function threadReferenceOf(anchor: StoredEmailRecord): EmailDraft["thread"] {
  const references = anchor.references ?? [];
  if (!anchor.wireMessageId && references.length === 0) return undefined;
  return {
    ...(anchor.wireMessageId ? { wireMessageId: anchor.wireMessageId } : {}),
    ...(references.length > 0 ? { references: [...references] } : {}),
  };
}

/** `Re: <subject>` unless the source already carries a reply prefix. */
function replySubject(subject: string): string {
  const trimmed = (subject ?? "").trim();
  if (trimmed === "") return "Re: (no subject)";
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/** Safe, content-free text for a submission that is not a clean success. */
function submissionErrorText(outcome: EmailSendOutcome): string {
  const code = outcome.safeCode ? ` (${outcome.safeCode})` : "";
  switch (outcome.phase) {
    case "unknown":
      return `Email submission outcome is unknown${code}; it is NOT confirmed delivered and must not be retried blindly.`;
    case "failed":
      return `Email submission failed${code}; nothing was delivered.`;
    default:
      break;
  }
  return `Email submission is not complete (phase=${outcome.phase})${code}; nothing was delivered.`;
}
