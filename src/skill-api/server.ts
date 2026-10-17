// src/skill-api/server.ts

import { createLogger, runWithPrivateEmailScope } from "@utils/logger.ts";
import { type ActiveSession, SessionRegistry } from "./session-registry.ts";
import { SkillRegistry } from "@skills/registry.ts";
import type { SkillContext, SkillResult } from "@skills/types.ts";
import { emailComposeAuditParams } from "@skills/email-handler.ts";
import { buildEmailReminderOrigin } from "@skills/reminder-handler.ts";
import { reminderOperationKey, sessionEmailOperation } from "@core/reminder-store.ts";
import {
  type EmailAttachmentPreparation,
  emailAttachmentScope,
} from "../platforms/email/attachment-preparation.ts";
import { spontaneousOperationKey } from "@platforms/email/spontaneous-store.ts";
import { projectEmailAuditData } from "@core/audit-logger.ts";
import { EMAIL_AUDIT_PLATFORM } from "../types/audit.ts";
import {
  EMAIL_HOST_SKILL_SLOTS,
  emailSessionOwner,
  type EmailSubmissionEvidenceSource,
} from "@core/email-response-accounting.ts";
import type { EmailSendContext, EmailSubmissionMetadata } from "../types/platform.ts";

import { skillApiCallsTotal } from "@utils/metrics.ts";
import { sanitizeSkillParams, sha256Hash } from "@utils/hash.ts";
import { verifySkillJwt } from "@utils/skill-jwt.ts";

const logger = createLogger("SkillAPIServer");

/** Failure code of the Skill API's own outer error log in a private context. */
const SKILL_API_ERROR_CODE = "SKILL_API_ERROR";

/**
 * Extract the bearer token from an `Authorization: Bearer <token>` header.
 */
function extractBearerToken(authHeader: string | null): string | undefined {
  if (!authHeader) return undefined;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : undefined;
}

/** Maximum number of send-reply calls allowed per session */
const MAX_REPLIES_PER_SESSION = 1;
const MAX_REPLY_ATTEMPTS_BEFORE_TERMINATE = 4;
const MAX_EDIT_CALLS_BEFORE_TERMINATE = 3;

/** Maximum number of successful send-file calls allowed per session (a multi-file batch = 1) */
const MAX_FILE_SENDS_PER_SESSION = 1;
const MAX_FILE_SEND_ATTEMPTS_BEFORE_TERMINATE = 4;

/**
 * Skills whose execution mutates external state (platform messages, memory
 * store, reminders). These are rejected while a session is recovery-fenced.
 * Read-only skills (memory-search, memory-stats, fetch-context, get-message,
 * memory-export) are deliberately excluded.
 */
const SIDE_EFFECT_SKILLS = new Set([
  "send-reply",
  "edit-reply",
  "send-file",
  // Outbound email is an irreversible external effect (and its durable result must
  // survive the session): a recovery-fenced session may not compose, and crash
  // recovery waits on the in-flight lease this membership grants.
  "send-email",
  "react-message",
  "memory-save",
  "memory-patch",
  "set-reminder",
  "cancel-reminder",
]);

export interface SkillAPIConfig {
  port: number;
  host: string; // Should be "localhost" or "127.0.0.1"
}

export interface SkillRequest {
  sessionId: string;
  parameters: Record<string, unknown>;
}

export interface SkillResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  /** Error code passthrough from SkillResult (carried verbatim in the response body) */
  code?: string;
  statusCode?: number; // Optional HTTP status code override
}

/** Request cache entry for deduplication */
interface RequestCacheEntry {
  timestamp: number;
  response: SkillResponse;
  promise?: Promise<SkillResponse>;
}

export class SkillAPIServer {
  private server: Deno.HttpServer | null = null;
  private sessionRegistry: SessionRegistry;
  private skillRegistry: SkillRegistry;
  private config: SkillAPIConfig;
  /**
   * Deployment-level HMAC secret (256-bit). The bot process is the only holder
   * of this key: it both issues per-session JWTs and verifies them.
   */
  private skillApiSecret: string;
  private requestCache: Map<string, RequestCacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 1000; // 1 second cache for duplicate detection
  private cleanupInterval?: ReturnType<typeof setInterval>;
  /**
   * Durable email submission evidence (row 13 `lookup`), injected by the email
   * ingress wiring. Null until then: without it the server accounts only the
   * metadata an executed skill actually reported, which is exactly the
   * pre-activation behavior.
   */
  private emailSubmissionEvidence: EmailSubmissionEvidenceSource | null = null;
  /**
   * Session-bound email attachment staging, injected by email ingress. While
   * null an email retrieval of messages with local references fails closed in
   * the handlers instead of returning opaque identifiers.
   */
  private emailAttachmentPreparation: EmailAttachmentPreparation | null = null;

  constructor(
    sessionRegistry: SessionRegistry,
    skillRegistry: SkillRegistry,
    config: SkillAPIConfig,
    skillApiSecret: string = "",
  ) {
    this.sessionRegistry = sessionRegistry;
    this.skillRegistry = skillRegistry;
    this.config = config;
    this.skillApiSecret = skillApiSecret;
  }

  /**
   * Install (or clear) the durable email submission evidence source (row 13
   * `lookup`). Email ingress wires it before its first poll; while it is null
   * an email skill whose handler reports no metadata simply falls back to the
   * existing rollback behavior.
   */
  setEmailSubmissionEvidence(source: EmailSubmissionEvidenceSource | null): void {
    this.emailSubmissionEvidence = source;
  }

  /** Install (or clear) the session-bound email attachment preparation capability. */
  setEmailAttachmentPreparation(preparation: EmailAttachmentPreparation | null): void {
    this.emailAttachmentPreparation = preparation;
  }

  /**
   * Host-assigned email operation context of this call (row 15 contract).
   *
   * It is derived from the SESSION alone — the work id the host recorded before
   * the agent ran, the mailbox owner of the session's own user id, and the
   * ordinary slot of the skill whose send goes through the adapter. No request
   * parameter can reach it, so a model can never choose the logical operation
   * its mail is bound to. When the session carries no owner or work id, the
   * context is omitted entirely and the adapter refuses the send (fail closed)
   * instead of guessing one.
   */
  private hostEmailSendContext(
    session: ActiveSession,
    skillName: string,
  ): EmailSendContext | undefined {
    const owner = emailSessionOwner(session);
    if (owner === undefined) return undefined;
    // Row 23: a scheduled email reminder carries its OWN stable operation
    // (`workId` = reminder id, partitioned slot `reminder:<id>`), never the
    // session's random id, so a restarted reminder is answered by the durable
    // journal instead of submitting a second message.
    const reminder = session.emailReminder;
    if (reminder !== undefined) {
      return { ...reminderOperationKey(reminder.reminderId), owner };
    }
    // Row 25: an email spontaneous session sends under the ONE partitioned operation of
    // its durable tick, so a repeated tool call is answered by the recorded result.
    const spontaneous = session.emailSpontaneous;
    if (spontaneous !== undefined) {
      return { ...spontaneousOperationKey(spontaneous.tickId), owner };
    }
    const workId = session.emailWorkId;
    if (workId === undefined || workId.trim() === "") return undefined;
    const actionSlot = EMAIL_HOST_SKILL_SLOTS[skillName];
    return {
      workId,
      owner,
      ...(actionSlot === undefined ? {} : { actionSlot }),
    };
  }

  /**
   * The logical operation slot a skill's submission metadata belongs to.
   *
   * The ordinary adapter-backed skills keep their kind slot; only a scheduled
   * email reminder binds the partitioned `reminder:<id>` slot (row 23), and
   * ONLY for those adapter-backed skills — relabeling a different operation
   * (e.g. a compose) with the reminder slot would merge unrelated operations in
   * the accounting.
   */
  private hostEmailSkillSlot(session: ActiveSession, skillName: string): string | undefined {
    const ordinarySlot = EMAIL_HOST_SKILL_SLOTS[skillName];
    if (ordinarySlot === undefined) return undefined;
    const reminder = session.emailReminder;
    if (reminder !== undefined) {
      return reminderOperationKey(reminder.reminderId).actionSlot;
    }
    const spontaneous = session.emailSpontaneous;
    return spontaneous === undefined
      ? ordinarySlot
      : spontaneousOperationKey(spontaneous.tickId).actionSlot;
  }

  /**
   * Record one executed email-capable skill result into the session's explicit
   * response accounting (row 22) and report whether the pre-execution
   * reservation is consumed.
   *
   * Returns true only for a CONFIRMED submission: its logical slot may not be
   * rolled back, because the mail is already out of the process. Unresolved
   * evidence (`unknown`, or an unclosed `submitting` slot) is latched into the
   * accounting as well — that latch is what suppresses every automatic retry
   * and escalates the work to review-required — but it leaves the in-memory
   * delivery flags and counters to the existing rollback, since no delivery was
   * confirmed and a later same-slot attempt is answered from the durable
   * journal instead of reaching SMTP twice.
   *
   * A failing email send that reported no metadata at all is looked up in the
   * durable journal (row 13) BEFORE the caller rolls anything back: the journal,
   * not a boolean, is the authority on whether mail left the process.
   */
  private accountEmailSkillOutcome(
    session: ActiveSession,
    skillName: string,
    result: SkillResult,
  ): { slotConsumed: boolean; outcomes: EmailSubmissionMetadata[] } {
    if (session.platform !== "email") return { slotConsumed: false, outcomes: [] };
    const actionSlot = this.hostEmailSkillSlot(session, skillName);
    const metadata = result.emailSubmission;
    if (metadata) {
      this.sessionRegistry.recordEmailSubmission(session.id, metadata, actionSlot);
      return { slotConsumed: metadata.phase === "submitted", outcomes: [metadata] };
    }
    // No metadata: only a failure needs the durable second opinion (a success
    // that reported nothing recorded no email effect).
    if (result.success) return { slotConsumed: false, outcomes: [] };
    const recorded = this.reconcileDurableEmailEvidence(session);
    return {
      slotConsumed: recorded.some((outcome) => outcome.phase === "submitted"),
      outcomes: recorded,
    };
  }

  /**
   * Read this session's durable email evidence for its own logical slots — the
   * ordinary slots plus one partition per immutable grant — and record every
   * result that is not a recorded non-delivery. The recorded outcomes are
   * returned so the caller can audit the evidence it just recovered: a lost
   * skill response must not lose the operator's operation record with it.
   */
  private reconcileDurableEmailEvidence(session: ActiveSession): EmailSubmissionMetadata[] {
    const evidence = this.emailSubmissionEvidence;
    const owner = emailSessionOwner(session);
    const identity = sessionEmailOperation(session);
    if (!evidence || owner === undefined || identity === undefined) {
      return [];
    }
    const recorded: EmailSubmissionMetadata[] = [];
    for (const actionSlot of identity.slots) {
      const outcome = evidence.lookup(owner, { workId: identity.workId, actionSlot });
      if (!outcome || outcome.phase === "prepared" || outcome.phase === "failed") continue;
      this.sessionRegistry.recordEmailSubmission(session.id, outcome, actionSlot);
      recorded.push(outcome);
    }
    return recorded;
  }

  /**
   * Start the HTTP server
   */
  start(): void {
    this.server = Deno.serve(
      {
        port: this.config.port,
        hostname: this.config.host,
        onListen: ({ hostname, port }) => {
          logger.info("Skill API server started on {hostname}:{port}", { hostname, port });
        },
      },
      (request) => this.handleRequest(request),
    );

    // Start cleanup interval for request cache
    this.cleanupInterval = setInterval(() => {
      this.cleanupRequestCache();
    }, this.CACHE_TTL_MS);
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    // Clear cleanup interval
    if (this.cleanupInterval !== undefined) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Clear request cache
    this.requestCache.clear();

    if (this.server) {
      await this.server.shutdown();
      this.server = null;
      logger.info("Skill API server stopped");
    }
  }

  /**
   * Handle incoming requests
   */
  private async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers (not needed for local Deno scripts, but included for completeness)
    const headers = {
      "Content-Type": "application/json",
    };

    // Handle preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Only allow POST
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Method not allowed" }),
        { status: 405, headers },
      );
    }

    // Route: POST /api/skill/{skill-name}
    const match = url.pathname.match(/^\/api\/skill\/([a-z-]+)$/);
    if (!match) {
      return new Response(
        JSON.stringify({ success: false, error: "Not found" }),
        { status: 404, headers },
      );
    }

    const skillName = match[1];
    return await this.handleSkillRequest(request, skillName, headers);
  }

  /**
   * Handle skill execution request
   */
  private async handleSkillRequest(
    request: Request,
    skillName: string,
    headers: Record<string, string>,
  ): Promise<Response> {
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch (error) {
      // Never log the parser message: it embeds a snippet of the request body,
      // which for email codecs is private correspondence (recipient, subject,
      // body or staged attachment names).
      logger.error("Skill API request body was not valid JSON", {
        code: "SKILL_API_INVALID_JSON_BODY",
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        { status: 400, headers },
      );
    }

    // The envelope is validated before it is dereferenced: a valid `null` (or
    // any other non-object) body must reach the same structured 400 as a
    // missing session id instead of escaping as a server-level rejection.
    if (parsed === null || typeof parsed !== "object") {
      return new Response(
        JSON.stringify({ success: false, error: "Missing sessionId" }),
        { status: 400, headers },
      );
    }
    const body = parsed as SkillRequest;
    if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing sessionId" }),
        { status: 400, headers },
      );
    }

    // An email session's skill call handles private correspondence end to end:
    // the whole execution (including the skill registry's and the audit
    // writer's own loggers, and any deferred callback started here) runs inside
    // the ambient private scope, so a thrown provider error can never print a
    // password, a body or an attachment name.
    if (this.sessionRegistry.get(body.sessionId)?.platform === EMAIL_AUDIT_PLATFORM) {
      return await runWithPrivateEmailScope(() =>
        this.runSkillRequest(
          skillName,
          body,
          headers,
          request.headers.get("authorization"),
        )
      );
    }
    return await this.runSkillRequest(
      skillName,
      body,
      headers,
      request.headers.get("authorization"),
    );
  }

  /**
   * Authenticate, gate and execute one parsed skill request.
   */
  private async runSkillRequest(
    skillName: string,
    body: SkillRequest,
    headers: Record<string, string>,
    authorization: string | null,
  ): Promise<Response> {
    try {
      // Authenticate BEFORE the dedup cache: a valid session ID is not
      // sufficient — the caller must present the owning session's signed JWT.
      // Authentication failures are returned immediately and are NOT cached, so
      // an unauthorized attempt holding a leaked session ID cannot poison a
      // legitimate caller's cached result.
      const auth = await this.authenticate(
        body.sessionId,
        extractBearerToken(authorization),
      );
      if (!auth.ok) {
        return new Response(
          JSON.stringify(auth.response),
          { status: auth.response.statusCode ?? 403, headers },
        );
      }
      // Refresh the session's idle timer on each authenticated call.
      this.sessionRegistry.touch(body.sessionId);

      // Recovery fence (crash recovery): while a session's recovery decision is
      // being made, side-effect skill calls from orphaned tool children of the
      // dead agent process are rejected so no duplicate effects can land.
      if (
        SIDE_EFFECT_SKILLS.has(skillName) &&
        this.sessionRegistry.get(body.sessionId)?.recoveryFenced === true
      ) {
        logger.warn("Skill call rejected: session is recovery-fenced", {
          skillName,
          sessionId: body.sessionId,
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: "Session is in crash recovery; side-effect skill calls are temporarily blocked",
          }),
          { status: 409, headers },
        );
      }

      // Generate cache key for deduplication
      const cacheKey = this.generateCacheKey(skillName, body.sessionId, body.parameters ?? {});

      // Check if we have a cached response for this exact request
      const cached = this.requestCache.get(cacheKey);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < this.CACHE_TTL_MS) {
          logger.warn("Detected duplicate request, returning cached response", {
            skillName,
            sessionId: body.sessionId,
            cacheAge: age,
          });

          // If there's a pending promise, wait for it
          if (cached.promise) {
            const result = await cached.promise;
            const statusCode = result.statusCode ?? (result.success ? 200 : 400);
            return new Response(
              JSON.stringify(result),
              { status: statusCode, headers },
            );
          }

          // Return cached response
          const statusCode = cached.response.statusCode ??
            (cached.response.success ? 200 : 400);
          return new Response(
            JSON.stringify(cached.response),
            { status: statusCode, headers },
          );
        }
      }

      // Create a promise for this request (for concurrent duplicate detection)
      // Side-effect executions are counted on the session so crash recovery can
      // wait for in-flight effects to settle before making its decision.
      // The counter is incremented AND decremented on the SAME object: teardown
      // may remove the registry entry while the effect is still running, and a
      // later registry lookup would then never roll the counter back to zero.
      const countedSession: { inflightSideEffects?: number } | undefined =
        SIDE_EFFECT_SKILLS.has(skillName) ? this.sessionRegistry.get(body.sessionId) : undefined;
      if (countedSession) {
        countedSession.inflightSideEffects = (countedSession.inflightSideEffects ?? 0) + 1;
      }
      try {
        const executionPromise = this.executeSkillRequest(skillName, body, headers);

        // Store the pending promise in cache
        this.requestCache.set(cacheKey, {
          timestamp: Date.now(),
          response: { success: false }, // Placeholder, will be updated
          promise: executionPromise,
        });

        // Wait for execution to complete
        const result = await executionPromise;

        // Never cache authentication/authorization failures (F13): only cache
        // executed results. (Auth failures are already gated out above; this is a
        // defense-in-depth guard for the executeSkillRequest safety-net 401.)
        // send-file results are ALSO never cached: the skill is quota-gated
        // (1 successful call per session with doom-loop termination), so serving
        // a cached success or rejection would let the agent bypass the quota gate
        // and starve doom-loop detection. Concurrent in-flight duplicates still
        // deduplicate via the pending-promise path above. send-email results are
        // never cached either: a repeated call is answered by the DURABLE journal
        // (same operation key returns the recorded result), and a cached response
        // would hide that recorded phase — including an `unknown` outcome the agent
        // must not retry blindly — behind a stale `submitted`.
        if (
          result.statusCode === 401 ||
          result.statusCode === 403 ||
          skillName === "send-file" ||
          skillName === "send-email"
        ) {
          this.requestCache.delete(cacheKey);
        } else {
          // Update cache with the actual result
          this.requestCache.set(cacheKey, {
            timestamp: Date.now(),
            response: result,
          });
        }

        // Track successful memory-save calls for the crash-recovery ops note
        // (lives in the bot process; audit-writer counters need audit.enabled).
        if (skillName === "memory-save" && result.success) {
          const counted = this.sessionRegistry.get(body.sessionId);
          if (counted) counted.memorySaveCount = (counted.memorySaveCount ?? 0) + 1;
        }

        const statusCode = result.statusCode ?? (result.success ? 200 : 400);
        return new Response(
          JSON.stringify(result),
          { status: statusCode, headers },
        );
      } finally {
        if (countedSession) {
          countedSession.inflightSideEffects = Math.max(
            0,
            (countedSession.inflightSideEffects ?? 1) - 1,
          );
        }
      }
    } catch (error) {
      // In an email execution the ambient private scope already strips the
      // message; the constant code keeps the failure diagnosable either way.
      logger.error("Skill API error", {
        code: SKILL_API_ERROR_CODE,
        error: error instanceof Error ? error.message : String(error),
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Internal error",
        }),
        { status: 500, headers },
      );
    }
  }

  /**
   * Authenticate a Skill API request: resolve the session by ID (which also
   * enforces the idle TTL), then verify the presented per-session JWT with
   * four server-side checks (HMAC signature, `sub == sessionId`,
   * `channel == session.channelId`, `jti == session.callerToken` + `exp`).
   * Returns a typed result so the caller can reject un-cached before the
   * dedup/execute path.
   */
  private async authenticate(
    sessionId: string,
    presentedToken: string | undefined,
  ): Promise<{ ok: true } | { ok: false; response: SkillResponse }> {
    const session = this.sessionRegistry.get(sessionId);
    if (!session) {
      return {
        ok: false,
        response: { success: false, error: "Invalid or expired session", statusCode: 401 },
      };
    }
    if (!presentedToken) {
      logger.warn("Skill API request rejected: missing Authorization token", { sessionId });
      return {
        ok: false,
        response: { success: false, error: "Missing Authorization header", statusCode: 403 },
      };
    }
    const result = await verifySkillJwt(presentedToken, this.skillApiSecret, {
      sessionId,
      channelId: session.channelId,
      callerToken: session.callerToken,
    });
    if (result.valid) {
      return { ok: true };
    }
    const statusCode = result.reason === "expired" ? 401 : 403;
    logger.warn(
      "Skill API request rejected: JWT verification failed ({reason})",
      { sessionId, reason: result.reason, detail: result.detail },
    );
    return {
      ok: false,
      response: { success: false, error: `JWT verification failed: ${result.reason}`, statusCode },
    };
  }

  /**
   * Execute skill request (extracted for caching)
   */
  private async executeSkillRequest(
    skillName: string,
    body: SkillRequest,
    _headers: Record<string, string>,
  ): Promise<SkillResponse> {
    // Validate session
    const session = this.sessionRegistry.get(body.sessionId);
    if (!session) {
      return {
        success: false,
        error: "Invalid or expired session",
        statusCode: 401,
      };
    }

    // Check if skill exists
    if (!this.skillRegistry.hasSkill(skillName)) {
      return {
        success: false,
        error: `Unknown skill: ${skillName}`,
        statusCode: 404,
      };
    }

    // Mark reply as sent BEFORE execution for session tracking
    if (skillName === "send-reply") {
      const currentCount = this.sessionRegistry.getReplyCount(body.sessionId);
      if (currentCount >= MAX_REPLIES_PER_SESSION) {
        // Still increment count even when rejecting (doom-loop tracking)
        this.sessionRegistry.incrementReplyCount(body.sessionId);
        const newCount = currentCount + 1;

        logger.warn(
          "Reply limit reached for session {sessionId} ({replyCount}/{maxReplies})",
          {
            sessionId: body.sessionId,
            replyCount: newCount,
            maxReplies: MAX_REPLIES_PER_SESSION,
          },
        );

        // Check doom-loop threshold
        if (newCount >= MAX_REPLY_ATTEMPTS_BEFORE_TERMINATE) {
          logger.error(
            "Doom-loop detected: reply attempts {replyCount} reached threshold {threshold}, terminating agent",
            {
              sessionId: body.sessionId,
              replyCount: newCount,
              threshold: MAX_REPLY_ATTEMPTS_BEFORE_TERMINATE,
            },
          );

          // Schedule termination after response is sent
          const session = this.sessionRegistry.get(body.sessionId);
          if (session?.onTerminateRequest) {
            setTimeout(() => {
              session.onTerminateRequest!().catch((err: unknown) => {
                logger.error("Failed to terminate agent process", {
                  error: err instanceof Error ? err.message : String(err),
                });
              });
            }, 100);
          }
        }

        return {
          success: false,
          error: `Reply limit reached (${MAX_REPLIES_PER_SESSION}/${MAX_REPLIES_PER_SESSION}). ` +
            "Use edit-reply to modify your last sent message instead of sending a new one.",
          statusCode: 429,
        };
      }

      const marked = this.sessionRegistry.markReplySent(body.sessionId);
      if (!marked) {
        return {
          success: false,
          error: "Session not found",
          statusCode: 404,
        };
      }
    }

    // Edit-reply count limiting and doom-loop protection
    if (skillName === "edit-reply") {
      const currentEditCount = this.sessionRegistry.getEditCount(body.sessionId);

      if (currentEditCount + 1 >= MAX_EDIT_CALLS_BEFORE_TERMINATE) {
        logger.error(
          "Doom-loop detected: edit-reply calls {editCount} reached threshold {threshold}, terminating agent",
          {
            sessionId: body.sessionId,
            editCount: currentEditCount + 1,
            threshold: MAX_EDIT_CALLS_BEFORE_TERMINATE,
          },
        );

        // Schedule termination after response is sent
        const session = this.sessionRegistry.get(body.sessionId);
        if (session?.onTerminateRequest) {
          setTimeout(() => {
            session.onTerminateRequest!().catch((err: unknown) => {
              logger.error("Failed to terminate agent process", {
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }, 100);
        }

        return {
          success: false,
          error:
            `Edit limit reached (${currentEditCount + 1}/${MAX_EDIT_CALLS_BEFORE_TERMINATE}). ` +
            "Agent process will be terminated.",
          statusCode: 429,
        };
      }
    }

    // A scheduled email reminder session may only reply into its own reminder
    // operation; composing a NEW message is a different (unthreaded) operation
    // that no reminder authorizes, so it is refused at the host boundary before
    // any request file is read.
    if (skillName === "send-email" && session.emailReminder !== undefined) {
      return {
        success: false,
        error: "send-email is not available in a scheduled reminder session; only a reply into " +
          "the reminder's own thread is authorized. Nothing was sent.",
        statusCode: 403,
      };
    }

    // Send-file quota and doom-loop protection (independent of the reply counters)
    if (skillName === "send-file") {
      // send-file delivers externally visible output; it is only meaningful in
      // user-triggered message/channelLurk sessions. Triggerless sessions
      // (spontaneous, self-research, memory-maintenance, reminders) only track
      // replies — an untracked file send would cause duplicate output or repeat
      // delivery, so it is rejected here.
      if (!session.triggerEvent) {
        return {
          success: false,
          error: "send-file is only available in user-triggered message sessions. " +
            "This session type cannot send files.",
          statusCode: 403,
        };
      }

      const currentCount = this.sessionRegistry.getFileSendCount(body.sessionId);
      if (currentCount >= MAX_FILE_SENDS_PER_SESSION) {
        // Still increment count even when rejecting (doom-loop tracking)
        this.sessionRegistry.incrementFileSendCount(body.sessionId);
        const newCount = currentCount + 1;

        logger.warn(
          "File send limit reached for session {sessionId} ({fileSendCount}/{maxFileSends})",
          {
            sessionId: body.sessionId,
            fileSendCount: newCount,
            maxFileSends: MAX_FILE_SENDS_PER_SESSION,
          },
        );

        // Check doom-loop threshold
        if (newCount >= MAX_FILE_SEND_ATTEMPTS_BEFORE_TERMINATE) {
          logger.error(
            "Doom-loop detected: send-file attempts {fileSendCount} reached threshold {threshold}, terminating agent",
            {
              sessionId: body.sessionId,
              fileSendCount: newCount,
              threshold: MAX_FILE_SEND_ATTEMPTS_BEFORE_TERMINATE,
            },
          );

          // Schedule termination after response is sent
          const session = this.sessionRegistry.get(body.sessionId);
          if (session?.onTerminateRequest) {
            setTimeout(() => {
              session.onTerminateRequest!().catch((err: unknown) => {
                logger.error("Failed to terminate agent process", {
                  error: err instanceof Error ? err.message : String(err),
                });
              });
            }, 100);
          }
        }

        return {
          success: false,
          error:
            `File send limit reached (${MAX_FILE_SENDS_PER_SESSION}/${MAX_FILE_SENDS_PER_SESSION}). ` +
            "Only one file send is allowed per session and there is no edit-file skill, " +
            "so further send-file calls cannot succeed.",
          statusCode: 429,
        };
      }

      // Reserve the per-session slot BEFORE execution; rolled back when nothing
      // is delivered so a failed attempt does not consume the quota.
      this.sessionRegistry.incrementFileSendCount(body.sessionId);
    }

    // Build skill context. The reply anchor is resolved once per call and
    // captured in a local so it can be recorded as the per-reply anchor
    // (`lastReplyAnchorMessageId`) when a send-reply succeeds.
    // Row 23: a scheduled email reminder reuses its PERSISTED reply anchor, so
    // the reminder's reply threads to the message the user originally asked
    // about — not to whatever the current (possibly foreign) session last sent.
    const reminder = session.emailReminder;
    const replyAnchor = reminder?.origin.replyAnchorRecordId ??
      session.lastFileMessageId ?? session.triggerEvent?.messageId;
    // Row 25: an email spontaneous session OPENS a new owner thread, so no reply anchor is
    // ever offered to its deliveries — a later call in the same tick (for example after a
    // `send-file`) must still reach the tick's one recorded operation instead of being
    // turned into a reply to the bot's own message.
    const deliveryAnchor = session.platform === "email" && session.emailSpontaneous !== undefined
      ? undefined
      : replyAnchor;
    // Session-bound attachment staging: capture the capability and the
    // host-derived scope once for this call. Handlers receive only this bound
    // function, never owner/staging parameters supplied by the caller.
    const attachmentPreparation = this.emailAttachmentPreparation;
    let prepareEmailMessages: SkillContext["prepareEmailMessages"];
    if (attachmentPreparation !== null && session.platform === "email") {
      const scope = emailAttachmentScope({
        workspace: session.workspace,
        sessionOwner: session.userId,
        skillSessionId: session.id,
      });
      prepareEmailMessages = (messages) => attachmentPreparation.prepareMessages(scope, messages);
    }
    const skillContext: SkillContext = {
      // The Skill API session id IS the literal the session prompt renders as
      // `--session-id`, and it keys the payload staging directory; handlers that
      // must resolve staged files read it here rather than re-deriving an id.
      sessionId: session.id,
      prepareEmailMessages,
      workspace: session.workspace,
      channelId: session.channelId,
      userId: session.userId,
      platformAdapter: session.platformAdapter!,
      replyToMessageId: deliveryAnchor,
      triggerMessageId: session.triggerEvent?.messageId,
      agentWorkspacePath: session.agentWorkspacePath,
      lastSentMessageId: session.lastSentMessageId,
      lastFileMessageId: session.lastFileMessageId,
      lastReplyAnchorMessageId: session.lastReplyAnchorMessageId,
      workspaceManager: session.workspaceManager,
      canWriteChannelMemory: session.canWriteChannelMemory,
      emailWorkId: session.emailWorkId,
      // Row 23: the host-resolved origin of the reminder this email session may
      // set. For a reminder session it is the persisted origin; for an ordinary
      // inbound email session it is derived from this session's own channel and
      // reply anchor. Never populated for a non-email session.
      emailReminderOrigin: session.platform === "email"
        ? (reminder?.origin ?? buildEmailReminderOrigin(session.channelId, replyAnchor))
        : undefined,
      // Row 19: the session's immutable grants, exactly as the host recorded
      // them. Read-only for handlers; no request parameter can reach this field.
      emailDestinationGrants: session.emailDestinationGrants,
      // Row 22: the host side of the row-15 `EmailSendContext`, derived from this
      // session alone. Omitted (and therefore refused by the email adapter)
      // whenever the host did not bind the session's work item.
      emailSend: session.platform === "email"
        ? this.hostEmailSendContext(session, skillName)
        : undefined,
    };

    // Execute skill
    logger.debug("Executing skill {skillName} via API for session {sessionId}", {
      skillName,
      sessionId: body.sessionId,
    });

    const auditWriter = session.auditWriter;
    const skillStartTime = Date.now();
    // An email session handles private correspondence, so its whole audit trail is
    // metadata-only whatever the general content-hashing setting says.
    const privateEmail = session.platform === EMAIL_AUDIT_PLATFORM;

    // Sanitize params for audit before execution (fire-and-forget safe). A composed
    // message is private correspondence, so `send-email` is projected to digests and
    // lengths FIRST — its recipient, subject and body are never recorded, whatever
    // the configured content-hashing setting is. Every other email-session skill is
    // projected the same way, so a reply body, a memory payload or a staged file
    // name cannot reach the entry through the generic hashing rule.
    const sanitizedParams = auditWriter
      ? privateEmail
        ? await projectEmailAuditData(
          await sanitizeSkillParams(
            skillName === "send-email"
              ? await emailComposeAuditParams(body.parameters ?? {})
              : body.parameters ?? {},
            true,
          ),
        )
        : await sanitizeSkillParams(
          skillName === "send-email"
            ? await emailComposeAuditParams(body.parameters ?? {})
            : body.parameters ?? {},
          auditWriter.getConfig().hashContent,
        )
      : undefined;

    const result = await this.skillRegistry.executeSkill(
      skillName,
      body.parameters ?? {},
      skillContext,
    );

    // Audit: skill_call
    await auditWriter?.write("skill_call", {
      skillName,
      skillParams: sanitizedParams,
      // An email failure is reported by its typed code: the message text can echo
      // a provider/agent error and has no place in a private audit entry. The
      // `code` field itself stays email-only, so non-email `skillResult`
      // serialization is byte-identical to what it was.
      skillResult: {
        success: result.success,
        ...(privateEmail && result.code !== undefined ? { code: result.code } : {}),
        ...(privateEmail || result.error === undefined ? {} : { error: result.error }),
      },
      skillDurationMs: Date.now() - skillStartTime,
    });
    auditWriter?.incrementSkillCalls();

    // Row 22: classify this result into the session's explicit email response
    // accounting before anything is rolled back. `emailSlotConsumed` is true only
    // for a confirmed submission, whose reservation must survive the rollback;
    // unresolved evidence keeps its `unknown` latch (which suppresses automatic
    // retry) while the existing rollback still clears unconfirmed delivery state.
    const emailAccounting = this.accountEmailSkillOutcome(session, skillName, result);
    const emailSlotConsumed = emailAccounting.slotConsumed;

    // Audit: email_operation — the operator's stable correlation of one submitted,
    // failed or unknown email (and its sent-copy state) without any content. A
    // result that reported nothing but whose durable evidence the accounting just
    // recovered is audited from that same evidence.
    if (privateEmail && auditWriter) {
      // The work id recorded here must be the one the durable evidence is filed
      // under: a scheduled reminder session has no inbound work item, so its
      // logical operation carries the reminder's own id.
      const emailWorkId = sessionEmailOperation(session)?.workId;
      for (const emailSubmission of emailAccounting.outcomes) {
        await auditWriter.writeEmailOperation({
          ...(emailSubmission.operationId === undefined
            ? {}
            : { operationId: emailSubmission.operationId }),
          ...(emailWorkId === undefined ? {} : { workId: emailWorkId }),
          phase: emailSubmission.phase,
          ...(emailSubmission.targetKind === undefined
            ? {}
            : { targetKind: emailSubmission.targetKind }),
          ...(emailSubmission.sentCopy === undefined ? {} : { sentCopy: emailSubmission.sentCopy }),
          ...(emailSubmission.safeCode === undefined ? {} : { safeCode: emailSubmission.safeCode }),
        });
      }
    }

    // Rollback if send-reply failed
    if (skillName === "send-reply" && !result.success && !emailSlotConsumed) {
      this.sessionRegistry.unmarkReplySent(body.sessionId);
      logger.warn("Send-reply failed, unmarked session", {
        sessionId: body.sessionId,
        error: result.error,
      });
    }

    // Increment reply count on successful send-reply
    if (skillName === "send-reply" && result.success) {
      this.sessionRegistry.incrementReplyCount(body.sessionId);
      // Track last sent message ID
      if (result.data && typeof result.data === "object" && "messageId" in result.data) {
        this.sessionRegistry.setLastSentMessageId(
          body.sessionId,
          (result.data as Record<string, unknown>).messageId as string,
        );
      }
      // Record the per-reply anchor: the message this reply was created as a
      // reply to (the replyAnchor resolved when the context was built).
      // `edit-reply` consumes this to preserve the reply's original thread
      // parent; it is NOT updated by edit-reply itself.
      if (replyAnchor) {
        this.sessionRegistry.setLastReplyAnchorMessageId(body.sessionId, replyAnchor);
      }
    }

    // Track last sent message ID after successful edit-reply
    // (Misskey returns new ID after delete-recreate)
    if (skillName === "edit-reply" && result.success) {
      if (result.data && typeof result.data === "object" && "messageId" in result.data) {
        this.sessionRegistry.setLastSentMessageId(
          body.sessionId,
          (result.data as Record<string, unknown>).messageId as string,
        );
      }
    }

    // Increment edit count on successful edit-reply
    if (skillName === "edit-reply" && result.success) {
      this.sessionRegistry.incrementEditCount(body.sessionId);
    }

    // Send-file: roll back the reserved slot when nothing was delivered; when at
    // least one file was delivered, keep the reservation, mark the session's
    // fileSent response state, record the delivered message ID as the reply
    // anchor, and write the file_sent audit entry (partial delivery included).
    if (skillName === "send-file") {
      const resultData = result.data && typeof result.data === "object"
        ? result.data as Record<string, unknown>
        : undefined;
      const deliveredCount = resultData?.filesCount;
      const filesDelivered = typeof deliveredCount === "number" && deliveredCount > 0;

      // Resolve the last delivered message ID: `messageId`, else the last
      // non-empty entry of `messageIds` (defensive — the result types mark it
      // optional; on Misskey chat partial delivery this is the most recent
      // delivered chat message, the correct anchor for a follow-up reply).
      const deliveredMessageIds = Array.isArray(resultData?.messageIds)
        ? (resultData.messageIds as unknown[]).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
        : [];
      const deliveredMessageId = typeof resultData?.messageId === "string" &&
          resultData.messageId.length > 0
        ? resultData.messageId
        : deliveredMessageIds[deliveredMessageIds.length - 1];

      if (!filesDelivered) {
        if (emailSlotConsumed) {
          logger.warn(
            "Send-file failed with no delivery, but a recorded submission keeps the file-send slot",
            { sessionId: body.sessionId, error: result.error },
          );
        } else {
          this.sessionRegistry.decrementFileSendCount(body.sessionId);
          logger.warn("Send-file failed with no delivery, file-send slot rolled back", {
            sessionId: body.sessionId,
            error: result.error,
          });
        }
      } else {
        this.sessionRegistry.markFileSent(body.sessionId);
        if (deliveredMessageId) {
          this.sessionRegistry.setLastFileMessageId(body.sessionId, deliveredMessageId);
        } else {
          // Defensive: delivery reported without a usable message ID. Never
          // record a bogus anchor — the reply anchor stays on the trigger.
          logger.warn(
            "Send-file delivered files but no usable message ID; no file reply anchor recorded",
            { sessionId: body.sessionId },
          );
        }
        if (auditWriter) {
          // An email attachment name is private metadata: it is hashed even when
          // general content hashing is disabled.
          const hashContent = auditWriter.getConfig().hashContent || privateEmail;
          const params = (body.parameters ?? {}) as Record<string, unknown>;
          const caption = typeof params.caption === "string" ? params.caption : "";
          const fileNames = Array.isArray(params.filePaths)
            ? (params.filePaths as string[])
              .map((p) => p.split("/").pop() ?? p)
              .join(",")
            : "";
          await auditWriter.write("file_sent", {
            filesCount: deliveredCount,
            // Message IDs are platform message identifiers, not user content —
            // recorded verbatim regardless of hashContent.
            ...(deliveredMessageId ? { messageId: deliveredMessageId } : {}),
            messageIds: deliveredMessageIds,
            ...(hashContent
              ? {
                captionHash: `sha256:${await sha256Hash(caption)}`,
                fileNamesHash: `sha256:${await sha256Hash(fileNames)}`,
              }
              : { fileNames }),
            platform: session.platform,
          });
        }
      }
    }

    // Audit: reply_sent (when send-reply succeeds)
    if (skillName === "send-reply" && result.success && auditWriter) {
      const replyContent = typeof (body.parameters ?? {}).message === "string"
        ? (body.parameters as Record<string, string>).message
        : "";
      await auditWriter.write("reply_sent", {
        replyContentHash: (auditWriter.getConfig().hashContent || privateEmail)
          ? `sha256:${await sha256Hash(replyContent)}`
          : undefined,
        replyLength: replyContent.length,
        platform: session.platform,
      });
      auditWriter.incrementReplies();
    }

    // Audit: reply_edited (when edit-reply succeeds)
    if (skillName === "edit-reply" && result.success && auditWriter) {
      const editContent = typeof (body.parameters ?? {}).message === "string"
        ? (body.parameters as Record<string, string>).message
        : "";
      const originalMsgId = typeof (body.parameters ?? {}).messageId === "string"
        ? (body.parameters as Record<string, string>).messageId
        : "";
      const newMsgId = result.data && typeof result.data === "object" && "messageId" in result.data
        ? (result.data as Record<string, unknown>).messageId as string
        : originalMsgId;
      await auditWriter.write("reply_edited", {
        originalMessageId: originalMsgId,
        newMessageId: newMsgId,
        replyContentHash: (auditWriter.getConfig().hashContent || privateEmail)
          ? `sha256:${await sha256Hash(editContent)}`
          : undefined,
        replyLength: editContent.length,
        platform: session.platform,
      });
    }

    // Audit: memory_operation (for memory skills)
    const memorySkillMap: Record<string, string> = {
      "memory-save": "save",
      "memory-search": "search",
      "memory-patch": "patch",
      "memory-stats": "stats",
    };
    if (skillName in memorySkillMap && auditWriter) {
      const params = body.parameters as Record<string, unknown> ?? {};
      await auditWriter.write("memory_operation", {
        operation: memorySkillMap[skillName],
        memoryId: typeof params.id === "string" ? params.id : (
          result.data && typeof result.data === "object" && "id" in result.data
            ? (result.data as Record<string, unknown>).id as string
            : ""
        ),
        visibility: typeof params.visibility === "string" ? params.visibility : undefined,
        tier: typeof params.tier === "string" ? params.tier : undefined,
        category: typeof params.category === "string" ? params.category : undefined,
        resultCount: result.data && typeof result.data === "object" && "results" in result.data
          ? (result.data as { results?: unknown[] }).results?.length ?? 0
          : 0,
      });
      auditWriter.incrementMemoryOps();
    }

    logger.info("Skill {skillName} executed via API for session {sessionId}", {
      skillName,
      sessionId: body.sessionId,
      success: result.success,
    });
    skillApiCallsTotal.labels(skillName, result.success ? "success" : "error").inc();

    return {
      ...result,
      statusCode: result.success ? 200 : 400,
    };
  }

  /**
   * Generate cache key for request deduplication
   */
  private generateCacheKey(
    skillName: string,
    sessionId: string,
    parameters: Record<string, unknown>,
  ): string {
    // Create a stable string representation of parameters
    const paramStr = JSON.stringify(parameters, Object.keys(parameters).sort());
    return `${skillName}:${sessionId}:${paramStr}`;
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupRequestCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.requestCache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL_MS) {
        this.requestCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug("Cleaned up request cache", { entriesRemoved: cleaned });
    }
  }
}
