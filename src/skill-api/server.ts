// src/skill-api/server.ts

import { createLogger } from "@utils/logger.ts";
import { SessionRegistry } from "./session-registry.ts";
import { SkillRegistry } from "@skills/registry.ts";
import type { SkillContext } from "@skills/types.ts";

import { skillApiCallsTotal } from "@utils/metrics.ts";
import { sanitizeSkillParams, sha256Hash } from "@utils/hash.ts";
import { verifySkillJwt } from "@utils/skill-jwt.ts";

const logger = createLogger("SkillAPIServer");

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
    try {
      // Parse request body
      const body = await request.json() as SkillRequest;

      if (!body.sessionId) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing sessionId" }),
          { status: 400, headers },
        );
      }

      // Authenticate BEFORE the dedup cache: a valid session ID is not
      // sufficient — the caller must present the owning session's signed JWT.
      // Authentication failures are returned immediately and are NOT cached, so
      // an unauthorized attempt holding a leaked session ID cannot poison a
      // legitimate caller's cached result.
      const auth = await this.authenticate(
        body.sessionId,
        extractBearerToken(request.headers.get("authorization")),
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
      const countedSideEffect = SIDE_EFFECT_SKILLS.has(skillName);
      if (countedSideEffect) {
        const counted = this.sessionRegistry.get(body.sessionId);
        if (counted) counted.inflightSideEffects = (counted.inflightSideEffects ?? 0) + 1;
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
        // deduplicate via the pending-promise path above.
        if (
          result.statusCode === 401 ||
          result.statusCode === 403 ||
          skillName === "send-file"
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
        if (countedSideEffect) {
          const counted = this.sessionRegistry.get(body.sessionId);
          if (counted) {
            counted.inflightSideEffects = Math.max(0, (counted.inflightSideEffects ?? 1) - 1);
          }
        }
      }
    } catch (error) {
      logger.error("Skill API error", {
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
    const replyAnchor = session.lastFileMessageId ?? session.triggerEvent?.messageId;
    const skillContext: SkillContext = {
      workspace: session.workspace,
      channelId: session.channelId,
      userId: session.userId,
      platformAdapter: session.platformAdapter!,
      replyToMessageId: replyAnchor,
      triggerMessageId: session.triggerEvent?.messageId,
      agentWorkspacePath: session.agentWorkspacePath,
      lastSentMessageId: session.lastSentMessageId,
      lastFileMessageId: session.lastFileMessageId,
      lastReplyAnchorMessageId: session.lastReplyAnchorMessageId,
      workspaceManager: session.workspaceManager,
      canWriteChannelMemory: session.canWriteChannelMemory,
    };

    // Execute skill
    logger.debug("Executing skill {skillName} via API for session {sessionId}", {
      skillName,
      sessionId: body.sessionId,
    });

    const auditWriter = session.auditWriter;
    const skillStartTime = Date.now();

    // Sanitize params for audit before execution (fire-and-forget safe)
    const sanitizedParams = auditWriter
      ? await sanitizeSkillParams(
        body.parameters ?? {},
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
      skillResult: { success: result.success, error: result.error },
      skillDurationMs: Date.now() - skillStartTime,
    });
    auditWriter?.incrementSkillCalls();

    // Rollback if send-reply failed
    if (skillName === "send-reply" && !result.success) {
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
        this.sessionRegistry.decrementFileSendCount(body.sessionId);
        logger.warn("Send-file failed with no delivery, file-send slot rolled back", {
          sessionId: body.sessionId,
          error: result.error,
        });
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
          const hashContent = auditWriter.getConfig().hashContent;
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
        replyContentHash: auditWriter.getConfig().hashContent
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
        replyContentHash: auditWriter.getConfig().hashContent
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
