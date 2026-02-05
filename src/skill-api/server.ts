// src/skill-api/server.ts

import { createLogger } from "@utils/logger.ts";
import { SessionRegistry } from "./session-registry.ts";
import { SkillRegistry } from "@skills/registry.ts";
import type { SkillContext } from "@skills/types.ts";

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
}

export class SkillAPIServer {
  private server: Deno.HttpServer | null = null;
  private sessionRegistry: SessionRegistry;
  private skillRegistry: SkillRegistry;
  private config: SkillAPIConfig;

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
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
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

      // Validate session
      const session = this.sessionRegistry.get(body.sessionId);
      if (!session) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid or expired session" }),
          { status: 401, headers },
        );
      }

      // Check if skill exists
      if (!this.skillRegistry.hasSkill(skillName)) {
        return new Response(
          JSON.stringify({ success: false, error: `Unknown skill: ${skillName}` }),
          { status: 404, headers },
        );
      }

      // Special handling for send-reply (single reply rule)
      if (skillName === "send-reply") {
        if (session.replySent) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Reply already sent for this session",
            }),
            { status: 409, headers },
          );
        }
      }

      // Build skill context
      const skillContext: SkillContext = {
        workspace: session.workspace,
        channelId: session.channelId,
        userId: session.userId,
        platformAdapter: session.platformAdapter,
        replyToMessageId: session.triggerEvent.messageId,
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

      // Mark reply sent if successful
      if (skillName === "send-reply" && result.success) {
        this.sessionRegistry.markReplySent(body.sessionId);
      }

      logger.info("Skill executed via API", {
        skillName,
        sessionId: body.sessionId,
        success: result.success,
      });

      return new Response(
        JSON.stringify(result),
        { status: result.success ? 200 : 400, headers },
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
}
