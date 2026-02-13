// src/skill-api/server.ts

import { createLogger } from "@utils/logger.ts";
import { SessionRegistry } from "./session-registry.ts";
import { SkillRegistry } from "@skills/registry.ts";
import type { SkillContext } from "@skills/types.ts";

import { skillApiCallsTotal } from "@utils/metrics.ts";

const logger = createLogger("SkillAPIServer");

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
  private requestCache: Map<string, RequestCacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 1000; // 1 second cache for duplicate detection
  private cleanupInterval?: number;

  constructor(
    sessionRegistry: SessionRegistry,
    skillRegistry: SkillRegistry,
    config: SkillAPIConfig,
  ) {
    this.sessionRegistry = sessionRegistry;
    this.skillRegistry = skillRegistry;
    this.config = config;
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
          logger.info("Skill API server started", { hostname, port });
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
      const executionPromise = this.executeSkillRequest(skillName, body, headers);

      // Store the pending promise in cache
      this.requestCache.set(cacheKey, {
        timestamp: Date.now(),
        response: { success: false }, // Placeholder, will be updated
        promise: executionPromise,
      });

      // Wait for execution to complete
      const result = await executionPromise;

      // Update cache with the actual result
      this.requestCache.set(cacheKey, {
        timestamp: Date.now(),
        response: result,
      });

      const statusCode = result.statusCode ?? (result.success ? 200 : 400);
      return new Response(
        JSON.stringify(result),
        { status: statusCode, headers },
      );
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

    // Special handling for send-reply (single reply rule)
    // Mark as sent BEFORE execution to prevent race condition
    if (skillName === "send-reply") {
      const marked = this.sessionRegistry.markReplySent(body.sessionId);
      if (!marked) {
        return {
          success: false,
          error: "Reply already sent for this session",
          statusCode: 409,
        };
      }
    }

    // Build skill context
    const skillContext: SkillContext = {
      workspace: session.workspace,
      channelId: session.channelId,
      userId: session.userId,
      platformAdapter: session.platformAdapter,
      replyToMessageId: session.triggerEvent?.messageId,
      agentWorkspacePath: session.agentWorkspacePath,
    };

    // Execute skill
    logger.debug("Executing skill via API", {
      skillName,
      sessionId: body.sessionId,
    });

    const result = await this.skillRegistry.executeSkill(
      skillName,
      body.parameters ?? {},
      skillContext,
    );

    // Rollback if send-reply failed
    if (skillName === "send-reply" && !result.success) {
      this.sessionRegistry.unmarkReplySent(body.sessionId);
      logger.warn("Send-reply failed, unmarked session", {
        sessionId: body.sessionId,
        error: result.error,
      });
    }

    logger.info("Skill executed via API", {
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
