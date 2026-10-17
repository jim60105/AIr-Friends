// src/skills/email-handler.ts
//
// User-directed third-party email composition (`email-compose-skill`, row 20) and
// user-directed source-preserving forwarding (`email-forward-skill`, row 21).
//
// Contract (design `Owned interfaces and callsites`, rows 20 and 21):
// - This handler is the HOST AUTHORIZATION PRODUCER for `EmailMailService.send(draft)`: it
//   matches the requested destination against the session's IMMUTABLE destination grants
//   (row 19), which the host recorded before the agent started, and only then constructs the
//   draft. The mail service trusts this boundary; no model parameter and no HTTP field can add,
//   replace or widen a grant, and no other module may submit third-party mail.
// - All free text (recipient, subject, body) arrives through the session-contained request file
//   the script read; the request is re-validated here. `Cc`/`Bcc` and arbitrary headers have no
//   representation at all: an unknown request key is refused.
// - A forward (`request.action === "forward"`) is the SAME endpoint with one extra, host-bound
//   input: `request.sourceRecordId`, the stored source the commentary quotes. It requires a
//   `forward` grant whose `sourceRecordId` is exactly that record, and the record is then read
//   ONLY through the owner scope of the forwarded source store: a source another user owns, a
//   record the grant does not name, and a source whose archived bytes are missing, unreadable or
//   no longer match their recorded size are all refused before any SMTP submission. The original
//   body and every original attachment travel byte-for-byte (the immutable `.eml` is attached as
//   `message/rfc822`), the central signature is applied once BEFORE the original reference
//   section, and the source's own addresses, bodies and attachments never authorize anything:
//   the destination comes from the grant alone.
// - Attachment accounting is all-or-nothing: the returned `.eml` reference, every original
//   attachment and every added attachment are checked together against the existing send-file
//   count, per-file and aggregate limits BEFORE any byte is read, and any failure rejects the
//   whole operation instead of truncating or dropping material.
// - The operation key is host-derived: the session's durable email work id plus either
//   `third-party:<grantId>` (a granted third-party send) or the ordinary `compose` slot (a
//   compose addressed to the session's own verified sender, i.e. the ordinary reply target).
//   A repeated call for the same operation therefore returns the recorded result instead of
//   submitting a second message.
// - The signature is applied centrally by the MIME builder: nothing here (or in the skill
//   document) may add one.
// - Errors are content-free and typed (`code` + guidance), because the Skill API audit records
//   the error text verbatim: no address, subject or body ever appears in them.
//
// This module is intentionally NOT registered in production bootstrap; email activation
// remains guarded until the final batch cutover.

import { isAbsolute, resolve, SEPARATOR } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import { sha256Hash } from "@utils/hash.ts";
import { sessionStagingDir } from "@core/session-staging.ts";
import type { DestinationGrant } from "@core/email-intent-preflight.ts";
import { normalizeEmailMailbox } from "@platforms/email/email-identity.ts";
import { DEFAULT_MAX_MESSAGE_BYTES } from "@platforms/email/incoming-mime.ts";
import type {
  EmailDraft,
  EmailForwardSource,
  EmailOutgoingAttachment,
} from "@platforms/email/outgoing-mime.ts";
import type {
  StoredAttachmentMetadata,
  StoredEmailRecord,
} from "@platforms/email/message-store.ts";
import type { EmailSendOutcome } from "@platforms/email/mail-service.ts";
import type { SendFileSkillConfig } from "../types/config.ts";
import type { SkillContext, SkillHandler, SkillResult } from "./types.ts";

const logger = createLogger("EmailComposeHandler");

/**
 * Operation slot bound for a compose addressed to the session's own verified sender. It is
 * the ordinary (non-partitioned) slot of this skill, so it can never share an operation key
 * with `reply`/`files` or with a granted third-party send.
 */
export const EMAIL_COMPOSE_ACTION_SLOT = "compose";

/** Host operation-slot prefix naming a whole granted third-party operation (row 15 vocabulary). */
const EMAIL_THIRD_PARTY_SLOT_PREFIX = "third-party:";

/**
 * Request `action` value that asks for a forward (`email-forward-skill`, row 21). The forwarded
 * source record travels in the same request file as `sourceRecordId`.
 */
export const EMAIL_FORWARD_REQUEST_ACTION = "forward";

/** Request keys the compose contract accepts; anything else (Cc/Bcc/headers/…) is refused. */
const ALLOWED_REQUEST_KEYS: Readonly<Record<string, true>> = Object.freeze({
  to: true,
  subject: true,
  body: true,
  attachments: true,
});

/**
 * Request keys the forward extension accepts: the compose keys plus the action selector and the
 * designated source record. Cc/Bcc/arbitrary headers stay unavailable in both modes.
 */
const ALLOWED_FORWARD_REQUEST_KEYS: Readonly<Record<string, true>> = Object.freeze({
  action: true,
  sourceRecordId: true,
  to: true,
  subject: true,
  body: true,
  attachments: true,
});

/** Stable typed error codes surfaced to the agent through the Skill API response. */
export const EMAIL_COMPOSE_CODES = {
  UNAVAILABLE: "SKILL_EMAIL_COMPOSE_UNAVAILABLE",
  SESSION: "SKILL_EMAIL_COMPOSE_SESSION",
  REQUEST: "SKILL_EMAIL_COMPOSE_REQUEST",
  GRANT: "SKILL_EMAIL_COMPOSE_GRANT",
  ATTACHMENT: "SKILL_EMAIL_COMPOSE_ATTACHMENT",
} as const;

/**
 * Stable typed error codes of the forward extension (row 21).
 *
 * `SOURCE` covers every incomplete or unauthorized designated source: an absent store, a record
 * the owner scope does not expose, archived bytes that are missing/unreadable, and archived bytes
 * that no longer match their recorded size. It never names the source and never carries content.
 * The shared request-shape, session and destination refusals keep their row-20 codes.
 */
export const EMAIL_FORWARD_CODES = {
  UNAVAILABLE: "SKILL_EMAIL_FORWARD_UNAVAILABLE",
  SOURCE: "SKILL_EMAIL_FORWARD_SOURCE",
} as const;

/** Default attachment limits, mirroring the send-file skill's documented defaults. */
const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_FILE_SIZE_MB = 25;
const DEFAULT_MAX_TOTAL_SIZE_MB = 50;

/** Display name and media type of the immutable raw source carried by a forward. */
const FORWARD_SOURCE_FILENAME = "original-message.eml";
const FORWARD_SOURCE_CONTENT_TYPE = "message/rfc822";

/** One bracketed RFC 5322 wire identifier, as `OutgoingMimeBuilder` requires for references. */
const WIRE_ID_REGEX = /^<[^<>\s]+>$/;

/**
 * Display media type for an outgoing attachment filename. The wire builder only echoes this
 * value as the part's Content-Type; an unknown extension stays `application/octet-stream`.
 */
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

/**
 * The only mail-service surface this handler uses. The real `EmailMailService` satisfies it
 * structurally, so production wiring passes the durable service while tests pass a scripted
 * double. Nothing else can reach the service through this seam.
 */
export interface EmailComposeMailService {
  send(draft: EmailDraft): Promise<EmailSendOutcome>;
}

/**
 * The only source-access surface a forward may use (row 05 `EmailMessageStore`). The real store
 * satisfies it structurally, so production wiring passes the durable store while tests pass a
 * scripted double.
 *
 * Every method is OWNER-SCOPED by contract: a record another owner owns is not reachable through
 * it, so a foreign source can only ever come back as `undefined`. This handler never accepts a
 * filesystem path or a wire Message-ID in place of a record id.
 */
export interface EmailForwardSourceStore {
  /** Owner-scoped record lookup; `undefined` for an unknown or foreign-owner record. */
  getByOwnerRecord(owner: string, recordId: string): Promise<StoredEmailRecord | undefined>;
  /** Raw immutable `.eml` source bytes; `undefined` when the archive no longer holds them. */
  getSourceBytes(owner: string, recordId: string): Promise<Uint8Array | undefined>;
  /** Decoded original attachment bytes; `undefined` when the archive no longer holds them. */
  attachment(
    owner: string,
    recordId: string,
    attachmentId: string,
  ): Promise<Uint8Array | undefined>;
}

/** One resolved (metadata only) forward source plus the byte accounting reserved for it. */
interface ForwardSource {
  readonly record: StoredEmailRecord;
  /** Recorded bytes of the raw source and of every original attachment, summed. */
  readonly reservedBytes: number;
}

/** One loaded forward source: the archived bytes that will actually be serialized. */
interface ForwardSourcePayload {
  readonly record: StoredEmailRecord;
  readonly sourceBytes: Uint8Array;
  readonly attachments: EmailOutgoingAttachment[];
}

/** Construction inputs of {@link EmailComposeHandler}. */
export interface EmailComposeHandlerOptions {
  /**
   * The durable submission service. When absent the skill is not registered (the Skill
   * Registry only registers it with a service) and an accidental direct call fails closed.
   */
  mailService?: EmailComposeMailService;
  /**
   * The owner-scoped message store a forward resolves and reads its designated source from
   * (row 21). Absent means forwarding fails closed with
   * {@link EMAIL_FORWARD_CODES.UNAVAILABLE}: composing still works, and no source is ever read
   * through another seam.
   */
  forwardSourceStore?: EmailForwardSourceStore;
  /**
   * The existing send-file skill limits, reused verbatim for compose attachments (count,
   * per-file size, aggregate size, extension whitelist). The `enabled` flag is NOT consulted:
   * composing with an attachment does not depend on the send-file skill being enabled.
   */
  limits?: SendFileSkillConfig;
}

/**
 * Handles the `send-email` skill.
 *
 * Every refusal happens BEFORE any attachment byte is read, and the destination authorization
 * is decided BEFORE any file read at all: the request file was already consumed by the script,
 * and nothing here touches the filesystem until the grant (or the reply-to-sender identity)
 * has been matched. A forward resolves and reads its designated source only AFTER that same
 * grant match, and only through the owner-scoped source store.
 */
export class EmailComposeHandler {
  constructor(private readonly options: EmailComposeHandlerOptions) {}

  handleSendEmail: SkillHandler = async (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    // 1. The durable service must be wired (production registers this skill only with one).
    const mailService = this.options.mailService;
    if (!mailService || typeof mailService.send !== "function") {
      return refuse(
        EMAIL_COMPOSE_CODES.UNAVAILABLE,
        "Email composition is unavailable: the durable email submission service is not wired " +
          "in this deployment. Nothing was sent.",
      );
    }

    // 2. Only an authenticated, user-triggered EMAIL session may compose. The work id and the
    //    owner come from the host, never from the request.
    const identity = resolveSessionIdentity(context);
    if (!identity.ok) {
      return refuse(identity.code, identity.error);
    }
    const { sessionId, owner, workId } = identity;

    // 3. Request shape. Cc/Bcc/headers have no representation: an unknown key is refused.
    //    `action: "forward"` selects the row-21 extension; every other action is refused, and an
    //    absent action keeps the row-20 compose contract byte-for-byte.
    const request = parameters?.request;
    if (!isPlainObject(request)) {
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        'Missing or invalid "request" parameter: it must be the object read from the ' +
          "request file, carrying exactly to, subject, body and (optionally) attachments. " +
          "Nothing was sent.",
      );
    }
    const declaredAction = request.action === undefined
      ? undefined
      : readOptionalString(request.action);
    if (request.action !== undefined && declaredAction !== EMAIL_FORWARD_REQUEST_ACTION) {
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        'The request carries an unsupported "action": the only operation this skill accepts ' +
          `beyond composing a new message is "${EMAIL_FORWARD_REQUEST_ACTION}" (forwarding a ` +
          "designated stored source). Nothing was sent.",
      );
    }
    const isForward = declaredAction === EMAIL_FORWARD_REQUEST_ACTION;
    const allowedKeys = isForward ? ALLOWED_FORWARD_REQUEST_KEYS : ALLOWED_REQUEST_KEYS;
    const unknownKeys = Object.keys(request).filter(
      (key) => !Object.hasOwn(allowedKeys, key),
    );
    if (unknownKeys.length > 0) {
      // Only identifier-shaped names are named: a JSON key is model-supplied and could itself
      // carry an address, a path or a sentence, and this text is written to the audit verbatim.
      const named = unknownKeys.filter(isOpaqueIdentifierToken);
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        `The ${isForward ? "forward" : "compose"} request carries ${unknownKeys.length} ` +
          "unsupported field(s)" +
          (named.length > 0 ? ` (${named.join(", ")})` : "") +
          (isForward
            ? ". A forward accepts exactly action, sourceRecordId, to, subject, body and " +
              "optional attachments — additional recipients (Cc/Bcc) and arbitrary headers are " +
              "not available. Nothing was sent."
            : ". A composed message accepts exactly to, subject, body and optional attachments — " +
              "additional recipients (Cc/Bcc) and arbitrary headers are not available. " +
              "Nothing was sent."),
      );
    }

    // The designated source is an opaque host identifier, never a path or a wire Message-ID.
    let sourceRecordId: string | undefined;
    if (isForward) {
      sourceRecordId = readHeaderValue(request.sourceRecordId);
      if (sourceRecordId === undefined) {
        return refuse(
          EMAIL_COMPOSE_CODES.REQUEST,
          'A forward requires a non-empty single-line "sourceRecordId": the stored message the ' +
            "user designated, exactly as the host published it in this session's grant. " +
            "Nothing was sent.",
        );
      }
    }

    const to = readHeaderValue(request.to);
    if (to === undefined) {
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        'Missing or invalid "to" field: it must be one non-empty single-line mailbox address. ' +
          "Nothing was sent.",
      );
    }
    const subject = readHeaderValue(request.subject);
    if (subject === undefined || subject.trim() === "") {
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        'Missing or invalid "subject" field: it must be a non-empty single-line subject. ' +
          "Nothing was sent.",
      );
    }
    const body = typeof request.body === "string" ? request.body : undefined;
    if (body === undefined) {
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        'Missing or invalid "body" field: it must be the composed message text as a string. ' +
          "Nothing was sent.",
      );
    }
    const attachmentPaths = readAttachmentPaths(request.attachments);
    if (attachmentPaths === null) {
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        'Invalid "attachments" field: it must be an array of non-empty path strings inside the ' +
          "session staging directory. Nothing was sent.",
      );
    }
    if (!isForward && body.trim() === "" && attachmentPaths.length === 0) {
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        "Refusing an empty message: the request must carry body text or at least one attachment. " +
          "Nothing was sent.",
      );
    }
    // A forwarded message carries the designated original, so empty commentary is a valid pure
    // forward; the attachment set of a forward must still reference an added file at most once.
    if (isForward && firstDuplicatePath(attachmentPaths, context) !== undefined) {
      return refuse(
        EMAIL_COMPOSE_CODES.ATTACHMENT,
        "The forward request references the same staged attachment file more than once, so the " +
          "forwarded set would duplicate material. Reference each staged file at most once. " +
          "Nothing was sent.",
      );
    }

    // 4. Canonical destination + immutable-grant authorization, before any file read.
    let canonicalTo: string;
    let canonicalToUserId: string;
    try {
      const mailbox = normalizeEmailMailbox(to);
      canonicalTo = mailbox.canonicalAddress;
      canonicalToUserId = mailbox.userId;
    } catch {
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        '"to" is not a single valid mailbox address (multiple addresses, whitespace, path ' +
          "characters and malformed domains are not accepted). Nothing was sent.",
      );
    }

    const grantId = readOptionalString(parameters.grantId);
    let actionSlot: string;
    let targetKind: EmailDraft["targetKind"];
    if (grantId !== undefined) {
      const granted = matchDestinationGrant(context, grantId, {
        sessionId,
        owner,
        workId,
        action: isForward ? "forward" : "compose",
        canonicalRecipient: canonicalTo,
        ...(sourceRecordId === undefined ? {} : { sourceRecordId }),
      });
      if (!granted.ok) {
        return refuse(granted.code, granted.error);
      }
      actionSlot = granted.slot;
      targetKind = "third-party";
    } else if (!isForward && canonicalToUserId === owner) {
      // The session's own verified sender is the ordinary reply target: it needs no
      // third-party grant, and `targetKind: "user"` keeps the mail service's own current
      // allowlist recheck in force for it.
      actionSlot = EMAIL_COMPOSE_ACTION_SLOT;
      targetKind = "user";
    } else if (isForward) {
      return refuse(
        EMAIL_COMPOSE_CODES.GRANT,
        "Forwarding is not authorized for this destination. A forward needs a dedicated grant " +
          "the host recorded from the user's own current message: it names this session, work " +
          "item and owner, the destination, the action forward AND the exact stored source " +
          "record, and you must pass its grant id with --grant-id. Forwarding never happens " +
          "without one. Nothing was sent.",
      );
    } else {
      return refuse(
        EMAIL_COMPOSE_CODES.GRANT,
        "The requested destination is not authorized by this session. A third-party address is " +
          "allowed only when the user's own current message explicitly asked for it: the host " +
          "must have recorded an immutable compose grant for that destination and for exactly " +
          "this session, work item and owner before you started, and you must pass its grant id " +
          "with --grant-id. No grant can be created by this skill. Nothing was sent.",
      );
    }

    // 5. Attachments. A forward first resolves its designated source (metadata only) and folds
    //    the immutable `.eml` reference plus every original attachment into the SAME count and
    //    aggregate accounting as the added files, so one combined preflight decides the whole
    //    operation before any byte is read.
    const source = isForward
      ? await this.resolveForwardSource(owner, sourceRecordId ?? "")
      : undefined;
    if (source !== undefined && !source.ok) {
      return refuse(source.code, source.error);
    }
    const reserved = source?.ok
      ? { count: source.value.record.attachments.length + 1, bytes: source.value.reservedBytes }
      : undefined;
    const attachments = await this.loadAttachments(attachmentPaths, context, sessionId, reserved);
    if (!attachments.ok) {
      return refuse(EMAIL_COMPOSE_CODES.ATTACHMENT, attachments.error);
    }
    const sourcePayload = source?.ok
      ? await this.loadForwardSourcePayload(owner, source.value)
      : undefined;
    if (sourcePayload !== undefined && !sourcePayload.ok) {
      return refuse(sourcePayload.code, sourcePayload.error);
    }
    if (sourcePayload?.ok && !this.withinForwardLimits(sourcePayload.value, attachments.value)) {
      return refuse(
        EMAIL_COMPOSE_CODES.ATTACHMENT,
        "The forwarded source and the added attachments together exceed the configured " +
          "attachment limits, so the operation was rejected as a whole. Nothing was sent.",
      );
    }

    // 6. Submit through the durable service under the host-derived operation key. The raw source
    //    is attached as `message/rfc822` (unencoded by the composer) so the original headers,
    //    signatures and encoding survive the forward byte-for-byte; the original decoded
    //    attachments ride along as themselves, and the builder places the signature BEFORE the
    //    original reference section it derives from `forwardSource.body`.
    const forwardPart = sourcePayload?.ok
      ? [{
        filename: FORWARD_SOURCE_FILENAME,
        contentType: FORWARD_SOURCE_CONTENT_TYPE,
        content: sourcePayload.value.sourceBytes,
      }]
      : [];
    const draftAttachments = [...forwardPart, ...attachments.value];
    let forwardSource: EmailForwardSource | undefined;
    let thread: EmailDraft["thread"];
    if (sourcePayload?.ok) {
      const record = sourcePayload.value.record;
      const date = new Date(record.timestamp);
      forwardSource = {
        from: record.from,
        ...(record.to === undefined ? {} : { to: record.to }),
        subject: record.subject,
        ...(isNaN(date.getTime()) ? {} : { date }),
        body: record.body,
        ...(sourcePayload.value.attachments.length === 0
          ? {}
          : { attachments: sourcePayload.value.attachments }),
      };
      // References to the source and its ancestors, deliberately WITHOUT In-Reply-To: a forward
      // starts a new header chain, so the builder mints a fresh Message-ID for it.
      const chain = [...record.references, ...(record.wireMessageId ? [record.wireMessageId] : [])]
        .filter((id, index, all) => WIRE_ID_REGEX.test(id) && all.indexOf(id) === index);
      if (chain.length > 0) {
        thread = { references: chain };
      }
    }
    const draft: EmailDraft = {
      owner,
      operationKey: { workId, actionSlot },
      targetKind,
      to: canonicalTo,
      subject,
      authoredBody: body,
      ...(forwardSource === undefined ? {} : { forwardSource }),
      ...(thread === undefined ? {} : { thread }),
      ...(draftAttachments.length === 0 ? {} : { attachments: draftAttachments }),
    };

    return await this.submitDraft(mailService, draft, context, {
      attachmentsCount: draftAttachments.length +
        (sourcePayload?.ok ? sourcePayload.value.attachments.length : 0),
      ...(sourcePayload?.ok ? { forwardSourceRecordId: sourcePayload.value.record.recordId } : {}),
    });
  };

  /**
   * Submit one fully authorized draft through the durable service and map its outcome to the
   * skill result. Both operations share this tail so their refusal and result contracts cannot
   * drift apart.
   */
  private async submitDraft(
    mailService: EmailComposeMailService,
    draft: EmailDraft,
    context: SkillContext,
    data: Record<string, unknown>,
  ): Promise<SkillResult> {
    let outcome: EmailSendOutcome;
    try {
      outcome = await mailService.send(draft);
    } catch (error) {
      logger.error("Email submission failed to execute", {
        workspaceKey: context.workspace?.key,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: "Email submission did not complete: the durable submission service failed while " +
          "preparing or submitting the message, so nothing is confirmed delivered. Do not retry " +
          "blindly.",
      };
    }

    if (outcome.phase !== "submitted") {
      logger.warn("Email submission is not confirmed delivered: {Phase}", {
        Phase: outcome.phase,
        SafeCode: outcome.safeCode ?? "none",
        workspaceKey: context.workspace?.key,
      });
      return {
        success: false,
        error: submissionErrorText(outcome),
        data: {
          operationId: outcome.operationId,
          phase: outcome.phase,
          reused: outcome.reused,
          ...data,
        },
        emailSubmission: outcome,
      };
    }

    logger.info("Email submitted ({TargetKind}, {Attachments} attachments)", {
      TargetKind: draft.targetKind,
      Attachments: data.attachmentsCount,
      Reused: outcome.reused,
      workspaceKey: context.workspace?.key,
    });

    return {
      success: true,
      data: {
        messageId: outcome.recordId ?? outcome.messageId,
        operationId: outcome.operationId,
        phase: outcome.phase,
        reused: outcome.reused,
        ...data,
        nextAction:
          "The message is submitted. Exit immediately; do not send it again — a repeated call " +
          "returns this recorded result instead of resubmitting, and a repeated call with " +
          "different commentary does NOT send that commentary.",
      },
      emailSubmission: outcome,
    };
  }

  /**
   * Resolve one designated forward source through the OWNER SCOPE only.
   *
   * Metadata first (so the combined attachment accounting can include the source before any
   * byte is read), then the immutable raw bytes and each decoded attachment. Every absent,
   * unreadable or size-mismatched part is one content-free `SOURCE` refusal: a forward is
   * complete or it does not happen.
   */
  private async resolveForwardSource(
    owner: string,
    recordId: string,
  ): Promise<
    { ok: true; value: ForwardSource } | { ok: false; code: string; error: string }
  > {
    const store = this.options.forwardSourceStore;
    if (!store || typeof store.getByOwnerRecord !== "function") {
      return {
        ok: false,
        code: EMAIL_FORWARD_CODES.UNAVAILABLE,
        error:
          "Forwarding is unavailable: this deployment has no owner-scoped message store wired " +
          "for source access, so no stored message can be designated. Nothing was sent.",
      };
    }

    let record: StoredEmailRecord | undefined;
    try {
      record = await store.getByOwnerRecord(owner, recordId);
    } catch {
      record = undefined;
    }
    if (!record) {
      return {
        ok: false,
        code: EMAIL_FORWARD_CODES.SOURCE,
        error:
          "The designated source is not a stored message in YOUR OWN accessible history, so it " +
          "cannot be forwarded. Only a message the user can already read may be forwarded, and " +
          "the grant must name that exact record. Nothing was sent.",
      };
    }

    const reservedBytes = record.rawSize +
      record.attachments.reduce((sum, attachment) => sum + attachment.size, 0);

    // The raw message bound and the per-file bound are decided on the recorded sizes, before the
    // archived bytes (which the combined aggregate check below also bounds) are read.
    const limits = this.options.limits;
    const maxFileSizeMb = limits?.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB;
    if (
      record.rawSize > DEFAULT_MAX_MESSAGE_BYTES ||
      (maxFileSizeMb > 0 && record.rawSize / (1024 * 1024) > maxFileSizeMb)
    ) {
      return {
        ok: false,
        code: EMAIL_FORWARD_CODES.SOURCE,
        error:
          "The designated source's raw message is over the configured email message size limit, " +
          "so it cannot be forwarded as a whole. Nothing was sent.",
      };
    }
    if (
      record.attachments.some((attachment) =>
        maxFileSizeMb > 0 && attachment.size / (1024 * 1024) > maxFileSizeMb
      )
    ) {
      return {
        ok: false,
        code: EMAIL_FORWARD_CODES.SOURCE,
        error: "An original attachment of the designated source is over the configured per-file " +
          "attachment limit, so it cannot be forwarded as a whole. Nothing was sent.",
      };
    }
    return { ok: true, value: { record, reservedBytes } };
  }

  /**
   * Read the archived bytes of one already-resolved source and prove they are the recorded ones.
   *
   * Length identity is the byte-preservation evidence: a `.eml` or an attachment whose archived
   * bytes no longer match the recorded `rawSize`/`size` is refused as an incomplete source
   * instead of being forwarded as if the original had been preserved.
   */
  private async loadForwardSourcePayload(
    owner: string,
    source: ForwardSource,
  ): Promise<
    { ok: true; value: ForwardSourcePayload } | { ok: false; code: string; error: string }
  > {
    const store = this.options.forwardSourceStore as EmailForwardSourceStore;
    const { record } = source;

    let sourceBytes: Uint8Array | undefined;
    try {
      sourceBytes = await store.getSourceBytes(owner, record.recordId);
    } catch {
      sourceBytes = undefined;
    }
    if (!sourceBytes) {
      return {
        ok: false,
        code: EMAIL_FORWARD_CODES.SOURCE,
        error: "The designated source's original message bytes are unavailable in the owner's " +
          "archive, so the forward would be incomplete. Nothing was sent.",
      };
    }
    if (sourceBytes.byteLength !== record.rawSize) {
      return {
        ok: false,
        code: EMAIL_FORWARD_CODES.SOURCE,
        error: "The designated source's archived message bytes no longer match the recorded " +
          "size, so the original cannot be preserved exactly. Nothing was sent.",
      };
    }

    const attachments: EmailOutgoingAttachment[] = [];
    for (const attachment of record.attachments) {
      const bytes = await this.readSourceAttachment(owner, record.recordId, attachment);
      if (!bytes.ok) {
        return { ok: false, code: EMAIL_FORWARD_CODES.SOURCE, error: bytes.error };
      }
      attachments.push({
        filename: attachment.filename ?? attachment.displayName ?? attachment.id,
        contentType: attachment.mimeType,
        content: bytes.value,
      });
    }
    return { ok: true, value: { record, sourceBytes, attachments } };
  }

  /** Read ONE original attachment, or return the safe refusal text. */
  private async readSourceAttachment(
    owner: string,
    recordId: string,
    attachment: StoredAttachmentMetadata,
  ): Promise<{ ok: true; value: Uint8Array } | { ok: false; error: string }> {
    const store = this.options.forwardSourceStore as EmailForwardSourceStore;
    let bytes: Uint8Array | undefined;
    try {
      bytes = await store.attachment(owner, recordId, attachment.id);
    } catch {
      bytes = undefined;
    }
    if (!bytes) {
      return {
        ok: false,
        error: "An original attachment of the designated source is unavailable in the owner's " +
          "archive, so the forward would be incomplete. Nothing was sent.",
      };
    }
    if (bytes.byteLength !== attachment.size) {
      return {
        ok: false,
        error: "An original attachment of the designated source no longer matches its recorded " +
          "size, so the original cannot be preserved exactly. Nothing was sent.",
      };
    }
    return { ok: true, value: bytes };
  }

  /**
   * The final combined accounting over the ACTUAL bytes that will be serialized: the raw source
   * reference, every original attachment and every added attachment. It is decided after the
   * loads (which proved each part matches its recorded size) and before submission, so a forward
   * can never be truncated or delivered without part of its material.
   */
  private withinForwardLimits(
    source: ForwardSourcePayload,
    added: readonly EmailOutgoingAttachment[],
  ): boolean {
    const limits = this.options.limits;
    const maxFiles = limits?.maxFilesPerInvocation ?? DEFAULT_MAX_FILES;
    if (source.attachments.length + 1 + added.length > maxFiles) {
      return false;
    }
    const totalBytes = source.sourceBytes.byteLength +
      source.attachments.reduce((sum, attachment) => sum + attachment.content.byteLength, 0) +
      added.reduce((sum, attachment) => sum + attachment.content.byteLength, 0);
    const maxTotalSizeMb = limits?.maxTotalSizeMb ?? DEFAULT_MAX_TOTAL_SIZE_MB;
    if (maxTotalSizeMb > 0 && totalBytes / (1024 * 1024) > maxTotalSizeMb) {
      return false;
    }
    return true;
  }

  /**
   * Preflight and read the session-contained attachments of one compose request.
   *
   * Containment is the SAME boundary the request file itself lives in: the session staging
   * directory. A lexical containment check runs first, then the symlink-resolved real path is
   * re-checked, so neither `..` escapes nor a staging symlink pointing outside can read
   * workspace memory, notes or another session's files. The existing send-file limits (count,
   * per-file size, aggregate size, extension whitelist) are applied before any byte is read.
   *
   * `reserved` is the count and byte total a forward already holds for the designated source
   * (its raw `.eml` reference plus every original attachment). It is folded into the SAME count
   * and aggregate checks, and it is checked even when no added file was requested, so a forward's
   * limits are decided over the complete outgoing set.
   */
  private async loadAttachments(
    paths: readonly string[],
    context: SkillContext,
    sessionId: string,
    reserved?: { count: number; bytes: number },
  ): Promise<
    { ok: true; value: EmailOutgoingAttachment[] } | { ok: false; error: string }
  > {
    const limits = this.options.limits;
    const maxFiles = limits?.maxFilesPerInvocation ?? DEFAULT_MAX_FILES;
    const reservedCount = reserved?.count ?? 0;
    const reservedBytes = reserved?.bytes ?? 0;
    const maxTotalSizeMb = limits?.maxTotalSizeMb ?? DEFAULT_MAX_TOTAL_SIZE_MB;
    if (paths.length + reservedCount > maxFiles) {
      return {
        ok: false,
        error: `Too many attachments: ${paths.length + reservedCount} exceeds the limit of ` +
          `${maxFiles} per message. Nothing was sent.`,
      };
    }
    if (maxTotalSizeMb > 0 && reservedBytes / (1024 * 1024) > maxTotalSizeMb) {
      return {
        ok: false,
        error: "The designated source alone is over the configured aggregate attachment size " +
          "limit. Nothing was sent.",
      };
    }
    if (paths.length === 0) {
      return { ok: true, value: [] };
    }

    const configuredExtensions = limits?.allowedExtensions ?? [];
    const workspacePath = context.workspace?.path;
    // The boundary is the LEXICAL staging root the host computed (`{workspace}/tmp/{sessionId}`).
    // Both the requested path and its symlink-resolved real path must stay inside it, exactly like
    // the shared payload contract: a staging root or any intermediate component that is itself a
    // symlink pointing outside therefore fails closed instead of becoming the authorized base.
    const stagingBase = resolve(sessionStagingDir(context.workspace ?? { tmpPath: "" }, sessionId));

    const maxFileSizeMb = limits?.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB;

    const validated: Array<{ fullPath: string; fileName: string; size: number }> = [];
    let totalBytes = 0;
    for (const attachmentPath of paths) {
      const lexical = isAbsolute(attachmentPath)
        ? resolve(attachmentPath)
        : resolve(workspacePath ?? ".", attachmentPath);
      if (!isWithinDir(lexical, stagingBase)) {
        return {
          ok: false,
          error:
            "An attachment path is outside the session staging directory — the absolute staging " +
            "directory rendered in your system prompt. Attachments must be staged there with your " +
            "edit/write tool (never a workspace memory, note or another session's file). " +
            "Nothing was sent.",
        };
      }

      // The extension is the last dot component of the FILE NAME, never of the whole path.
      const fileName = attachmentPath.split("/").pop() ?? attachmentPath;
      const extension = "." + (fileName.split(".").pop() ?? "").toLowerCase();
      if (
        configuredExtensions.length > 0 &&
        !configuredExtensions.some((allowed) => allowed.toLowerCase() === extension)
      ) {
        // Only an identifier-shaped extension is echoed: a file name is model-supplied and must
        // never travel through the (audited) refusal text verbatim.
        const named = isOpaqueIdentifierToken(extension.slice(1)) ? ` "${extension}"` : "";
        return {
          ok: false,
          error: `The attachment extension${named} is not allowed. Allowed: ` +
            `${configuredExtensions.join(", ")}. Nothing was sent.`,
        };
      }

      let info: Deno.FileInfo;
      try {
        info = await Deno.stat(lexical);
      } catch {
        return {
          ok: false,
          error: "An attachment file does not exist or cannot be read. Write it into the session " +
            "staging directory FIRST with your edit/write tool. Nothing was sent.",
        };
      }
      if (!info.isFile) {
        return {
          ok: false,
          error: "An attachment path is not a regular file. Nothing was sent.",
        };
      }

      let realPath: string | undefined;
      try {
        realPath = Deno.realPathSync(lexical);
      } catch {
        realPath = undefined;
      }
      if (!realPath || !isWithinDir(realPath, stagingBase)) {
        return {
          ok: false,
          error: "An attachment path resolves (through a symlink) outside the session staging " +
            "directory. Nothing was sent.",
        };
      }

      const size = info.size;
      const fileSizeMb = size / (1024 * 1024);
      if (maxFileSizeMb > 0 && fileSizeMb > maxFileSizeMb) {
        return {
          ok: false,
          error: `An attachment is ${fileSizeMb.toFixed(2)} MB, over the ${maxFileSizeMb} MB ` +
            "per-file limit. Nothing was sent.",
        };
      }

      totalBytes += size;
      validated.push({ fullPath: realPath, fileName, size });
    }

    const totalSizeMb = (totalBytes + reservedBytes) / (1024 * 1024);
    if (maxTotalSizeMb > 0 && totalSizeMb > maxTotalSizeMb) {
      return {
        ok: false,
        error: `The outgoing attachments total ${totalSizeMb.toFixed(2)} MB, over the ` +
          `${maxTotalSizeMb} MB ` +
          "aggregate limit. Nothing was sent.",
      };
    }

    const value: EmailOutgoingAttachment[] = [];
    for (const file of validated) {
      let content: Uint8Array | null;
      try {
        content = await readPreflightedFile(file.fullPath, file.size);
      } catch {
        return {
          ok: false,
          error: "An attachment could not be read after preflight. Nothing was sent.",
        };
      }
      if (content === null) {
        return {
          ok: false,
          error: "An attachment changed between preflight and read (its size or target differs " +
            "from the validated one), so it was not attached. Nothing was sent.",
        };
      }
      // Re-check containment after the read: a component replaced by an escaping symlink during
      // the read is refused instead of being attached.
      let realAfter: string | undefined;
      try {
        realAfter = Deno.realPathSync(file.fullPath);
      } catch {
        realAfter = undefined;
      }
      if (!realAfter || !isWithinDir(realAfter, stagingBase)) {
        return {
          ok: false,
          error: "An attachment no longer resolves inside the session staging directory after " +
            "being read. Nothing was sent.",
        };
      }
      value.push({
        filename: file.fileName,
        contentType: MIME_TYPES_BY_EXTENSION[
          (file.fileName.split(".").pop() ?? "").toLowerCase()
        ] ?? "application/octet-stream",
        content,
      });
    }
    return { ok: true, value };
  }
}

/**
 * Content-safe audit projection for one compose invocation (the Skill API writes the returned
 * object into its `skill_call` audit entry).
 *
 * The compose request carries private correspondence: recipient, subject and body are NEVER
 * recorded, not even with content hashing disabled — the projection keeps opaque host identifiers
 * (a non-identifier-shaped value is hashed instead), always-hashed digests, lengths and the
 * attachment count only. A forward additionally records its action and designated source record
 * under the same identifier-or-hash rule: both are opaque internal ids, and neither the source's
 * body nor its addresses can reach the audit through them.
 */
export async function emailComposeAuditParams(
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const request = isPlainObject(parameters?.request) ? parameters.request : undefined;
  const grantId = readOptionalString(parameters?.grantId);
  const to = request ? readHeaderValue(request.to) : undefined;
  const subject = typeof request?.subject === "string" ? request.subject : undefined;
  const body = typeof request?.body === "string" ? request.body : undefined;
  const attachments = request && Array.isArray(request.attachments) ? request.attachments : [];
  const action = request ? readOptionalString(request.action) : undefined;
  const sourceRecordId = request ? readOptionalString(request.sourceRecordId) : undefined;

  return {
    ...(action === undefined
      ? {}
      : isOpaqueIdentifierToken(action)
      ? { action }
      : { actionHash: `sha256:${await sha256Hash(action)}` }),
    ...(grantId === undefined
      ? {}
      : isOpaqueIdentifierToken(grantId)
      ? { grantId }
      : { grantIdHash: `sha256:${await sha256Hash(grantId)}` }),
    ...(sourceRecordId === undefined
      ? {}
      : isOpaqueIdentifierToken(sourceRecordId)
      ? { sourceRecordId }
      : { sourceRecordIdHash: `sha256:${await sha256Hash(sourceRecordId)}` }),
    ...(to !== undefined ? { destinationHash: `sha256:${await sha256Hash(to)}` } : {}),
    ...(subject !== undefined
      ? { subjectHash: `sha256:${await sha256Hash(subject)}`, subjectLength: subject.length }
      : {}),
    ...(body !== undefined
      ? { bodyHash: `sha256:${await sha256Hash(body)}`, bodyLength: body.length }
      : {}),
    attachmentsCount: attachments.length,
  };
}

/** Outcome of resolving the host-derived session identity of a compose invocation. */
type SessionIdentity =
  | { ok: true; sessionId: string; owner: string; workId: string }
  | { ok: false; code: string; error: string };

/**
 * Resolve the host-derived identity the compose belongs to: the registry session id, the
 * mailbox owner (the session's verified sender) and the durable email work id.
 *
 * Every value comes from the host: the session context the Skill API builds. A host operation
 * context (`emailSend`) that disagrees with the session's own binding is refused rather than
 * quietly overridden, and a missing work id is refused because a model-chosen operation id
 * does not exist here.
 */
function resolveSessionIdentity(context: SkillContext): SessionIdentity {
  const sessionCode = EMAIL_COMPOSE_CODES.SESSION;
  if (context.workspace?.components?.platform !== "email") {
    return {
      ok: false,
      code: sessionCode,
      error:
        "send-email is only available in an authenticated email request session. Nothing was sent.",
    };
  }

  const sessionId = readOptionalString(context.sessionId);
  if (sessionId === undefined) {
    return {
      ok: false,
      code: sessionCode,
      error:
        "This session has no Skill API session identity, so no e-mail can be composed in it. " +
        "Nothing was sent.",
    };
  }

  const sessionOwner = readOptionalString(context.userId)?.toLowerCase();
  if (sessionOwner === undefined) {
    return {
      ok: false,
      code: sessionCode,
      error: "This session has no verified sender identity. Nothing was sent.",
    };
  }
  const hostOwner = readOptionalString(context.emailSend?.owner)?.toLowerCase();
  if (hostOwner !== undefined && hostOwner !== sessionOwner) {
    return {
      ok: false,
      code: sessionCode,
      error:
        "The host email operation context belongs to a different owner than this session, so it " +
        "cannot authorize a composed message. Nothing was sent.",
    };
  }

  const sessionWorkId = readOptionalString(context.emailWorkId);
  const hostWorkId = readOptionalString(context.emailSend?.workId);
  if (hostWorkId !== undefined && sessionWorkId !== undefined && hostWorkId !== sessionWorkId) {
    return {
      ok: false,
      code: sessionCode,
      error: "The host email operation context names a different work item than this session. " +
        "Nothing was sent.",
    };
  }
  const workId = hostWorkId ?? sessionWorkId;
  if (workId === undefined) {
    return {
      ok: false,
      code: sessionCode,
      error:
        "This session carries no durable email work id, so a composed message cannot be bound to " +
        "a logical operation. Nothing was sent.",
    };
  }

  return { ok: true, sessionId, owner: sessionOwner, workId };
}

/** Outcome of matching one request against the session's immutable destination grants. */
type GrantMatch = { ok: true; slot: string } | { ok: false; code: string; error: string };

/**
 * Match the requested action, destination, designated source and session/work/owner binding
 * against the immutable grants this session holds. The list is read-only: a handler can only USE
 * a grant it already has, and the grant must be of exactly this session, work item and owner.
 *
 * The action and the source record are matched here, so a `compose` grant can never authorize a
 * forward, a `forward` grant can never authorize a compose, and a forward grant authorizes
 * exactly the one source the host proved owner-accessible. Every mismatch is the same typed
 * refusal and never discloses the requested or granted source.
 */
function matchDestinationGrant(
  context: SkillContext,
  grantId: string,
  expected: {
    sessionId: string;
    owner: string;
    workId: string;
    action: DestinationGrant["action"];
    canonicalRecipient: string;
    sourceRecordId?: string;
  },
): GrantMatch {
  const grants = context.emailDestinationGrants ?? [];
  const grant = grants.find((candidate) => candidate.grantId === grantId);
  if (!grant) {
    return {
      ok: false,
      code: EMAIL_COMPOSE_CODES.GRANT,
      error:
        "No destination grant with that id belongs to this session. Grants are created by the " +
        "host from the user's own current message and cannot be created or widened by this " +
        "skill. Nothing was sent.",
    };
  }
  if (grant.action !== expected.action) {
    return {
      ok: false,
      code: EMAIL_COMPOSE_CODES.GRANT,
      error:
        "That grant authorizes a different action than the one requested, so it cannot authorize " +
        "this send. Nothing was sent.",
    };
  }
  if (
    grant.sessionId !== expected.sessionId ||
    grant.owner.toLowerCase() !== expected.owner ||
    grant.workId !== expected.workId
  ) {
    return {
      ok: false,
      code: EMAIL_COMPOSE_CODES.GRANT,
      error:
        "That grant belongs to a different session, work item or owner than this send, so it " +
        "cannot authorize it. A grant never carries into another session. Nothing was sent.",
    };
  }
  if (grant.canonicalRecipient !== expected.canonicalRecipient) {
    return {
      ok: false,
      code: EMAIL_COMPOSE_CODES.GRANT,
      error:
        "The requested destination is a different address than the granted one, so the grant " +
        "does not authorize it. A grant authorizes exactly one destination. Nothing was sent.",
    };
  }
  if (expected.sourceRecordId === undefined && grant.sourceRecordId !== undefined) {
    return {
      ok: false,
      code: EMAIL_COMPOSE_CODES.GRANT,
      error:
        "That grant authorizes forwarding one designated stored message, not composing a new " +
        "one, so it cannot authorize this send. Nothing was sent.",
    };
  }
  if (
    expected.sourceRecordId !== undefined && grant.sourceRecordId !== expected.sourceRecordId
  ) {
    return {
      ok: false,
      code: EMAIL_COMPOSE_CODES.GRANT,
      error:
        "That grant authorizes forwarding a DIFFERENT stored message than the one this request " +
        "designated, so it cannot authorize it. A forward grant binds exactly one source record, " +
        "and the source must be the one the user's own current message selected. Nothing was sent.",
    };
  }
  return { ok: true, slot: `${EMAIL_THIRD_PARTY_SLOT_PREFIX}${grant.grantId}` };
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

/** One typed, content-free refusal result. */
function refuse(code: string, error: string): SkillResult {
  return { success: false, code, error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A single-line header-bound value: rejects CR/LF/NUL and blank input. */
function readHeaderValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || /[\r\n\0]/.test(value)) return undefined;
  return trimmed;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The path strings of a composed attachment list; `null` when the field is invalid. */
function readAttachmentPaths(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const paths: string[] = [];
  for (const entry of value) {
    const path = readOptionalString(entry);
    if (path === undefined) return null;
    paths.push(path);
  }
  return paths;
}

/**
 * The first path of an attachment list that names the same file as an earlier entry, or
 * `undefined` when every reference is distinct.
 *
 * Resolution mirrors the preflight's own lexical resolution (absolute stays absolute, relative
 * resolves against the workspace), so two spellings of one staged file are one duplicate. A
 * forward refuses a duplicated reference instead of serializing the same material twice.
 */
function firstDuplicatePath(
  paths: readonly string[],
  context: SkillContext,
): string | undefined {
  const workspacePath = context.workspace?.path;
  const seen = new Set<string>();
  for (const path of paths) {
    const resolved = isAbsolute(path) ? resolve(path) : resolve(workspacePath ?? ".", path);
    if (seen.has(resolved)) return resolved;
    seen.add(resolved);
  }
  return undefined;
}

/** Boundary-safe containment: equal to `base` or prefixed by `base` + separator. */
function isWithinDir(path: string, base: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedBase = resolve(base);
  if (resolvedPath === resolvedBase) return true;
  return resolvedPath.startsWith(resolvedBase + SEPARATOR);
}

/**
 * Whether a value is shaped like an opaque host identifier (letters, digits, `_`, `-`, at most 64
 * characters). Only such values are safe to repeat verbatim in a refusal message or an audit entry:
 * an address, path, subject or free-text sentence cannot match this shape.
 */
function isOpaqueIdentifierToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/**
 * Read exactly the preflighted byte count of one already-validated regular file.
 *
 * Returns `null` when the file no longer holds exactly `size` bytes (grown, shrunk or replaced
 * since the stat), so a changed file is refused instead of attached. The read is bounded by
 * `size + 1`, so a file grown after preflight cannot pull an unbounded amount of memory either.
 */
async function readPreflightedFile(path: string, size: number): Promise<Uint8Array | null> {
  const handle = await Deno.open(path, { read: true });
  try {
    const buffer = new Uint8Array(size + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const read = await handle.read(buffer.subarray(filled));
      if (read === null || read === 0) break;
      filled += read;
    }
    return filled === size ? buffer.subarray(0, filled) : null;
  } finally {
    handle.close();
  }
}
