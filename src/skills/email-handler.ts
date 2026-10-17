// src/skills/email-handler.ts
//
// User-directed third-party email composition (`email-compose-skill`, row 20).
//
// Contract (design `Owned interfaces and callsites`, row 20):
// - This handler is the HOST AUTHORIZATION PRODUCER for `EmailMailService.send(draft)`: it
//   matches the requested destination against the session's IMMUTABLE destination grants
//   (row 19), which the host recorded before the agent started, and only then constructs the
//   draft. The mail service trusts this boundary; no model parameter and no HTTP field can add,
//   replace or widen a grant, and no other module may submit third-party mail.
// - All free text (recipient, subject, body) arrives through the session-contained request file
//   the script read; the request is re-validated here. `Cc`/`Bcc` and arbitrary headers have no
//   representation at all: an unknown request key is refused.
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
import { normalizeEmailMailbox } from "@platforms/email/email-identity.ts";
import type { EmailDraft, EmailOutgoingAttachment } from "@platforms/email/outgoing-mime.ts";
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

/** Request keys the compose contract accepts; anything else (Cc/Bcc/headers/…) is refused. */
const ALLOWED_REQUEST_KEYS: Readonly<Record<string, true>> = Object.freeze({
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

/** Default attachment limits, mirroring the send-file skill's documented defaults. */
const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_FILE_SIZE_MB = 25;
const DEFAULT_MAX_TOTAL_SIZE_MB = 50;

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

/** Construction inputs of {@link EmailComposeHandler}. */
export interface EmailComposeHandlerOptions {
  /**
   * The durable submission service. When absent the skill is not registered (the Skill
   * Registry only registers it with a service) and an accidental direct call fails closed.
   */
  mailService?: EmailComposeMailService;
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
 * has been matched.
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
    const request = parameters?.request;
    if (!isPlainObject(request)) {
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        'Missing or invalid "request" parameter: it must be the object read from the ' +
          "request file, carrying exactly to, subject, body and (optionally) attachments. " +
          "Nothing was sent.",
      );
    }
    const unknownKeys = Object.keys(request).filter(
      (key) => !Object.hasOwn(ALLOWED_REQUEST_KEYS, key),
    );
    if (unknownKeys.length > 0) {
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        `The compose request carries unsupported field(s): ${unknownKeys.join(", ")}. A composed ` +
          "message accepts exactly to, subject, body and optional attachments — additional " +
          "recipients (Cc/Bcc) and arbitrary headers are not available. Nothing was sent.",
      );
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
    if (body.trim() === "" && attachmentPaths.length === 0) {
      return refuse(
        EMAIL_COMPOSE_CODES.REQUEST,
        "Refusing an empty message: the request must carry body text or at least one attachment. " +
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
        '"to" is not a single valid mailbox address (display names, multiple addresses and ' +
          "malformed domains are not accepted). Nothing was sent.",
      );
    }

    const grantId = readOptionalString(parameters.grantId);
    let actionSlot: string;
    let targetKind: EmailDraft["targetKind"];
    if (grantId !== undefined) {
      const granted = matchComposeGrant(context, grantId, {
        sessionId,
        owner,
        workId,
        canonicalRecipient: canonicalTo,
      });
      if (!granted.ok) {
        return refuse(granted.code, granted.error);
      }
      actionSlot = granted.slot;
      targetKind = "third-party";
    } else if (canonicalToUserId === owner) {
      // The session's own verified sender is the ordinary reply target: it needs no
      // third-party grant, and `targetKind: "user"` keeps the mail service's own current
      // allowlist recheck in force for it.
      actionSlot = EMAIL_COMPOSE_ACTION_SLOT;
      targetKind = "user";
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

    // 5. Attachments: two-pass preflight (validate + stat every path and the aggregate size,
    //    then read bytes), so a rejected batch never reads anything.
    const attachments = await this.loadAttachments(attachmentPaths, context, sessionId);
    if (!attachments.ok) {
      return refuse(EMAIL_COMPOSE_CODES.ATTACHMENT, attachments.error);
    }

    // 6. Submit through the durable service under the host-derived operation key.
    const draft: EmailDraft = {
      owner,
      operationKey: { workId, actionSlot },
      targetKind,
      to: canonicalTo,
      subject,
      authoredBody: body,
      ...(attachments.value.length > 0 ? { attachments: attachments.value } : {}),
    };

    let outcome: EmailSendOutcome;
    try {
      outcome = await mailService.send(draft);
    } catch (error) {
      logger.error("Compose submission failed to execute", {
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
      logger.warn("Compose submission is not confirmed delivered: {Phase}", {
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
          attachmentsCount: attachments.value.length,
        },
        emailSubmission: outcome,
      };
    }

    logger.info("Composed email submitted ({TargetKind}, {Attachments} attachments)", {
      TargetKind: targetKind,
      Attachments: attachments.value.length,
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
        attachmentsCount: attachments.value.length,
        nextAction:
          "The message is submitted. Exit immediately; do not send it again — a repeated call " +
          "returns this recorded result instead of resubmitting.",
      },
      emailSubmission: outcome,
    };
  };

  /**
   * Preflight and read the session-contained attachments of one compose request.
   *
   * Containment is the SAME boundary the request file itself lives in: the session staging
   * directory. A lexical containment check runs first, then the symlink-resolved real path is
   * re-checked, so neither `..` escapes nor a staging symlink pointing outside can read
   * workspace memory, notes or another session's files. The existing send-file limits (count,
   * per-file size, aggregate size, extension whitelist) are applied before any byte is read.
   */
  private async loadAttachments(
    paths: readonly string[],
    context: SkillContext,
    sessionId: string,
  ): Promise<
    { ok: true; value: EmailOutgoingAttachment[] } | { ok: false; error: string }
  > {
    if (paths.length === 0) {
      return { ok: true, value: [] };
    }

    const limits = this.options.limits;
    const maxFiles = limits?.maxFilesPerInvocation ?? DEFAULT_MAX_FILES;
    if (paths.length > maxFiles) {
      return {
        ok: false,
        error:
          `Too many attachments: ${paths.length} exceeds the limit of ${maxFiles} per message. ` +
          "Nothing was sent.",
      };
    }

    const configuredExtensions = limits?.allowedExtensions ?? [];
    const workspacePath = context.workspace?.path;
    const stagingDir = sessionStagingDir(context.workspace ?? { tmpPath: "" }, sessionId);
    let realBase: string | undefined;
    try {
      realBase = Deno.realPathSync(stagingDir);
    } catch {
      realBase = undefined;
    }
    if (!realBase) {
      return {
        ok: false,
        error:
          "The session staging directory is not available, so no attachment can be read from it. " +
          "Nothing was sent.",
      };
    }

    const maxFileSizeMb = limits?.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB;
    const maxTotalSizeMb = limits?.maxTotalSizeMb ?? DEFAULT_MAX_TOTAL_SIZE_MB;

    const validated: Array<{ fullPath: string; fileName: string; size: number }> = [];
    let totalBytes = 0;
    for (const attachmentPath of paths) {
      const lexical = isAbsolute(attachmentPath)
        ? resolve(attachmentPath)
        : resolve(workspacePath ?? ".", attachmentPath);
      if (!isWithinDir(lexical, resolve(stagingDir))) {
        return {
          ok: false,
          error:
            "An attachment path is outside the session staging directory — the absolute staging " +
            "directory rendered in your system prompt. Attachments must be staged there with your " +
            "edit/write tool (never a workspace memory, note or another session's file). " +
            "Nothing was sent.",
        };
      }

      const extension = "." + (attachmentPath.split(".").pop() ?? "").toLowerCase();
      if (
        configuredExtensions.length > 0 &&
        !configuredExtensions.some((allowed) => allowed.toLowerCase() === extension)
      ) {
        return {
          ok: false,
          error: `The attachment extension "${extension}" is not allowed. Allowed: ` +
            `${configuredExtensions.join(", ")}. Nothing was sent.`,
        };
      }

      let size: number;
      try {
        size = (await Deno.stat(lexical)).size;
      } catch {
        return {
          ok: false,
          error: "An attachment file does not exist or cannot be read. Write it into the session " +
            "staging directory FIRST with your edit/write tool. Nothing was sent.",
        };
      }

      let realPath: string | undefined;
      try {
        realPath = Deno.realPathSync(lexical);
      } catch {
        realPath = undefined;
      }
      if (!realPath || !isWithinDir(realPath, realBase)) {
        return {
          ok: false,
          error: "An attachment path resolves (through a symlink) outside the session staging " +
            "directory. Nothing was sent.",
        };
      }

      const fileSizeMb = size / (1024 * 1024);
      if (maxFileSizeMb > 0 && fileSizeMb > maxFileSizeMb) {
        return {
          ok: false,
          error: `An attachment is ${fileSizeMb.toFixed(2)} MB, over the ${maxFileSizeMb} MB ` +
            "per-file limit. Nothing was sent.",
        };
      }

      totalBytes += size;
      validated.push({
        fullPath: realPath,
        fileName: attachmentPath.split("/").pop() ?? attachmentPath,
        size,
      });
    }

    const totalSizeMb = totalBytes / (1024 * 1024);
    if (maxTotalSizeMb > 0 && totalSizeMb > maxTotalSizeMb) {
      return {
        ok: false,
        error:
          `The attachments total ${totalSizeMb.toFixed(2)} MB, over the ${maxTotalSizeMb} MB ` +
          "aggregate limit. Nothing was sent.",
      };
    }

    const value: EmailOutgoingAttachment[] = [];
    for (const file of validated) {
      try {
        value.push({
          filename: file.fileName,
          contentType: MIME_TYPES_BY_EXTENSION[
            (file.fileName.split(".").pop() ?? "").toLowerCase()
          ] ?? "application/octet-stream",
          content: await Deno.readFile(file.fullPath),
        });
      } catch {
        return {
          ok: false,
          error: "An attachment could not be read after preflight. Nothing was sent.",
        };
      }
    }
    return { ok: true, value };
  }
}

/**
 * Content-safe audit projection for one compose invocation (the Skill API writes the returned
 * object into its `skill_call` audit entry).
 *
 * The compose request carries private correspondence: recipient, subject and body are NEVER
 * recorded, not even with content hashing disabled — the projection keeps the opaque grant id,
 * always-hashed digests, lengths and the attachment count only.
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

  return {
    ...(grantId !== undefined ? { grantId } : {}),
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

/** Outcome of matching one request against the session's immutable compose grants. */
type GrantMatch = { ok: true; slot: string } | { ok: false; code: string; error: string };

/**
 * Match the requested destination, action and session/work/owner binding against the immutable
 * grants this session holds. The list is read-only: a handler can only USE a grant it already
 * has, and the grant must be a `compose` grant of exactly this session, work item and owner.
 */
function matchComposeGrant(
  context: SkillContext,
  grantId: string,
  expected: { sessionId: string; owner: string; workId: string; canonicalRecipient: string },
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
  if (grant.action !== "compose") {
    return {
      ok: false,
      code: EMAIL_COMPOSE_CODES.GRANT,
      error:
        "That grant authorizes a different action than composing a new message, so it cannot " +
        "authorize this send. Nothing was sent.",
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

/** Boundary-safe containment: equal to `base` or prefixed by `base` + separator. */
function isWithinDir(path: string, base: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedBase = resolve(base);
  if (resolvedPath === resolvedBase) return true;
  return resolvedPath.startsWith(resolvedBase + SEPARATOR);
}
