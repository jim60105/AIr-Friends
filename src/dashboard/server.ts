// src/dashboard/server.ts

import { createLogger } from "@utils/logger.ts";
import { join, resolve } from "@std/path";
import {
  canonicalizeHost,
  clearSessionCookie,
  createSessionCookie,
  generateSessionToken,
  LoginRateLimiter,
  parseCookies,
  tokenStore,
  validatePassphrase,
} from "./auth.ts";
import type { CompletedSessionStore } from "./completed-session-store.ts";
import { loadSessionsFromAuditLogs } from "./audit-history-loader.ts";
import type { SessionRegistry } from "../skill-api/session-registry.ts";
import type { AuditConfig, Config, DashboardConfig } from "../types/config.ts";
import type { AgentType } from "@acp/types.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import { createAgentConfig, getDefaultAgentType } from "@acp/agent-factory.ts";
import type { AgentConnectorOptions, ClientConfig } from "@acp/types.ts";
import { loadSystemPrompt } from "@core/config-loader.ts";
import type { TemplateVariables } from "../types/template.ts";
import type { SkillRegistry } from "@skills/registry.ts";
import type { MemoryStore } from "@core/memory-store.ts";
import type { WorkspaceManager } from "@core/workspace-manager.ts";
import type { Registry } from "prom-client";

const logger = createLogger("DashboardServer");

/** Add security headers to a response */
function withSecurityHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  );
  newResponse.headers.set("X-Frame-Options", "DENY");
  newResponse.headers.set("X-Content-Type-Options", "nosniff");
  newResponse.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return newResponse;
}

/** Chat session idle timeout (10 minutes) */
const CHAT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** Allowed file extensions for workspace browser */
const ALLOWED_EXTENSIONS = new Set([".md", ".txt"]);

/**
 * Active chat session state
 */
interface ChatSession {
  id: string;
  connector: AgentConnector;
  acpSessionId: string;
  messageCount: number;
  sseController: ReadableStreamDefaultController<Uint8Array> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  disconnected: boolean;
}

/**
 * Dependencies for DashboardServer
 */
export interface DashboardServerDeps {
  config: DashboardConfig;
  appConfig: Config;
  sessionRegistry: SessionRegistry;
  completedSessionStore: CompletedSessionStore;
  agentWorkspacePath: string;
  auditConfig?: AuditConfig;
  auditBasePath: string;
  metricsRegistry?: Registry;
  skillRegistry: SkillRegistry;
  memoryStore: MemoryStore;
  workspaceManager: WorkspaceManager;
}

/**
 * Web dashboard HTTP server providing session monitoring,
 * workspace browsing, chat, and restart capabilities.
 */
export class DashboardServer {
  private server: Deno.HttpServer | null = null;
  private deps: DashboardServerDeps;
  private chatSession: ChatSession | null = null;
  private loginRateLimiter = new LoginRateLimiter();

  constructor(deps: DashboardServerDeps) {
    this.deps = deps;
  }

  /** Start the dashboard HTTP server */
  start(): void {
    const port = this.deps.config.port;
    const hostname = this.deps.config.host;
    this.server = Deno.serve(
      { port, hostname, onListen: () => {} },
      (req, info) => this.handleRequest(req, info),
    );
    logger.info("Dashboard server started on {hostname}:{port}", { hostname, port });

    // Asynchronously load historical sessions from audit logs (non-blocking)
    if (this.deps.auditConfig?.enabled && this.deps.auditBasePath) {
      loadSessionsFromAuditLogs(this.deps.auditBasePath).then((sessions) => {
        if (sessions.length > 0) {
          this.deps.completedSessionStore.addMany(sessions);
          logger.info("Loaded {count} historical sessions from audit logs", {
            count: sessions.length,
          });
        }
      }).catch((error) => {
        logger.warn("Failed to load historical sessions from audit logs", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  /** Stop the dashboard server */
  async stop(): Promise<void> {
    // Clean up chat session
    if (this.chatSession) {
      await this.disconnectChat();
    }
    if (this.server) {
      await this.server.shutdown();
      this.server = null;
      logger.info("Dashboard server stopped");
    }
  }

  private async handleRequest(req: Request, info?: Deno.ServeHandlerInfo): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    let response: Response;
    try {
      // Public endpoints (no auth required)
      if (path === "/api/auth/login" && req.method === "POST") {
        response = await this.handleLogin(req, info);
        return withSecurityHeaders(response);
      }

      // Auth check for all other routes
      if (!this.isAuthenticated(req)) {
        if (!path.startsWith("/api/")) {
          // Serve static files (login page is rendered client-side)
          response = await this.serveStaticFile(path);
          return withSecurityHeaders(response);
        }
        response = this.json({ error: "Unauthorized" }, 401);
        return withSecurityHeaders(response);
      }

      // Auth endpoints
      if (path === "/api/auth/logout" && req.method === "POST") {
        response = this.handleLogout(req);
        return withSecurityHeaders(response);
      }
      if (path === "/api/auth/status" && req.method === "GET") {
        response = this.json({ authenticated: true });
        return withSecurityHeaders(response);
      }

      // Session monitor endpoints
      if (path === "/api/sessions/active" && req.method === "GET") {
        response = this.handleActiveSessions();
        return withSecurityHeaders(response);
      }
      if (path === "/api/sessions/history" && req.method === "GET") {
        response = this.handleSessionHistory();
        return withSecurityHeaders(response);
      }
      if (path === "/api/stats" && req.method === "GET") {
        response = await this.handleStats();
        return withSecurityHeaders(response);
      }
      // Audit endpoint: /api/sessions/:id/audit
      const auditMatch = path.match(/^\/api\/sessions\/([^/]+)\/audit$/);
      if (auditMatch && req.method === "GET") {
        response = await this.handleSessionAudit(auditMatch[1]);
        return withSecurityHeaders(response);
      }

      // Workspace browser endpoints
      if (path === "/api/workspace/tree" && req.method === "GET") {
        response = await this.handleWorkspaceTree();
        return withSecurityHeaders(response);
      }
      if (path === "/api/workspace/file" && req.method === "GET") {
        response = await this.handleWorkspaceFile(url);
        return withSecurityHeaders(response);
      }

      // Channel-memory moderation endpoints (F15)
      if (path === "/api/channel-memory/channels" && req.method === "GET") {
        response = await this.handleChannelMemoryChannels();
        return withSecurityHeaders(response);
      }
      if (path === "/api/channel-memory/list" && req.method === "GET") {
        response = await this.handleChannelMemoryList(url);
        return withSecurityHeaders(response);
      }
      if (path === "/api/channel-memory/disable" && req.method === "POST") {
        response = await this.handleChannelMemoryDisable(req);
        return withSecurityHeaders(response);
      }

      // Chat endpoints
      if (path === "/api/chat/connect" && req.method === "POST") {
        response = await this.handleChatConnect(req);
        return withSecurityHeaders(response);
      }
      if (path === "/api/chat/message" && req.method === "POST") {
        response = await this.handleChatMessage(req);
        return withSecurityHeaders(response);
      }
      if (path === "/api/chat/stream" && req.method === "GET") {
        response = this.handleChatStream(url);
        return withSecurityHeaders(response);
      }
      if (path === "/api/chat/disconnect" && req.method === "POST") {
        response = await this.handleChatDisconnect(req);
        return withSecurityHeaders(response);
      }

      // Restart endpoint
      if (path === "/api/restart" && req.method === "POST") {
        response = await this.handleRestart(req);
        return withSecurityHeaders(response);
      }

      // Config endpoints
      if (path === "/api/config/models" && req.method === "GET") {
        response = this.handleConfigModels();
        return withSecurityHeaders(response);
      }

      // Static file serving
      response = await this.serveStaticFile(path);
      return withSecurityHeaders(response);
    } catch (error) {
      logger.error("Request handler error: {error}", {
        error: error instanceof Error ? error.message : String(error),
        path,
      });
      return withSecurityHeaders(this.json({ error: "Internal server error" }, 500));
    }
  }

  // --- Auth ---

  /**
   * Derive the login rate-limit key from the REAL connection address (F5).
   *
   * `X-Forwarded-For` is honored ONLY when the real socket address is in the
   * configured `dashboard.trustedProxies` allow-list (compared after canonicalization).
   * Otherwise the header is ignored and the real socket address is used, so header
   * rotation cannot bypass the per-key limit.
   */
  private resolveRateLimitKey(req: Request, info?: Deno.ServeHandlerInfo): string {
    const remoteAddr = info?.remoteAddr;
    const realHost = remoteAddr && "hostname" in remoteAddr
      ? canonicalizeHost(remoteAddr.hostname)
      : "unknown";

    const trusted = (this.deps.config.trustedProxies ?? []).map(canonicalizeHost);
    if (trusted.includes(realHost)) {
      const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      if (forwarded) {
        return canonicalizeHost(forwarded);
      }
    }
    return realHost;
  }

  private async handleLogin(req: Request, info?: Deno.ServeHandlerInfo): Promise<Response> {
    try {
      const key = this.resolveRateLimitKey(req, info);

      if (!this.loginRateLimiter.isAllowed(key)) {
        return new Response(JSON.stringify({ error: "Too many login attempts" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        });
      }

      const body = await req.json();
      const { passphrase } = body as { passphrase?: string };

      if (!passphrase || !(await validatePassphrase(passphrase, this.deps.config.passphrase))) {
        this.loginRateLimiter.recordAttempt(key);
        return this.json({ error: "Invalid passphrase" }, 401);
      }

      const token = generateSessionToken();
      tokenStore.add(token);
      logger.info("Dashboard login successful");

      // F10: Secure cookie is driven by explicit config, NOT the spoofable
      // X-Forwarded-Proto header.
      const secure = this.deps.config.behindHttpsProxy === true;

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": createSessionCookie(token, {
            maxAgeSeconds: Math.floor(tokenStore.maxAgeMs / 1000),
            secure,
          }),
        },
      });
    } catch {
      return this.json({ error: "Invalid request body" }, 400);
    }
  }

  private handleLogout(req: Request): Response {
    const cookies = parseCookies(req.headers.get("Cookie") ?? "");
    const token = cookies["dashboard_session"];
    if (token) {
      tokenStore.remove(token);
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": clearSessionCookie(),
      },
    });
  }

  private isAuthenticated(req: Request): boolean {
    const cookies = parseCookies(req.headers.get("Cookie") ?? "");
    const token = cookies["dashboard_session"];
    return !!token && tokenStore.has(token);
  }

  // --- Session Monitor ---

  private handleActiveSessions(): Response {
    const sessions = this.deps.sessionRegistry.getAll();
    const active = sessions.map((s) => ({
      id: s.id,
      type: s.triggerEvent ? "message" : "spontaneous",
      platform: s.platform,
      userId: s.userId,
      channelId: s.channelId,
      startTime: s.startedAt.toISOString(),
      status: "running",
    }));
    return this.json(active);
  }

  private handleSessionHistory(): Response {
    const sessions = this.deps.completedSessionStore.getAll();
    const mapped = sessions.map((s) => ({
      auditSessionId: s.auditSessionId,
      type: s.type,
      platform: s.platform,
      userId: s.userId,
      startTime: s.startedAt,
      endTime: s.endedAt,
      status: s.status,
      durationMs: s.durationMs,
    }));
    return this.json(mapped);
  }

  private async handleStats(): Promise<Response> {
    if (!this.deps.metricsRegistry) {
      return this.json({
        sessions_total: 0,
        active_sessions: 0,
        replies_sent_total: 0,
        messages_received_total: 0,
        memory_operations_total: 0,
        skill_api_calls_total: 0,
      });
    }

    try {
      const metrics = await this.deps.metricsRegistry.getMetricsAsJSON();
      const findMetric = (name: string) => {
        const m = metrics.find((m) => m.name === name);
        if (!m || !("values" in m)) return 0;
        const values = m.values as Array<{ value: number }>;
        return values.reduce((sum, v) => sum + v.value, 0);
      };

      return this.json({
        sessions_total: findMetric("airfriends_sessions_total"),
        active_sessions: findMetric("airfriends_active_sessions"),
        replies_sent_total: findMetric("airfriends_replies_sent_total"),
        messages_received_total: findMetric("airfriends_messages_received_total"),
        memory_operations_total: findMetric("airfriends_memory_operations_total"),
        skill_api_calls_total: findMetric("airfriends_skill_api_calls_total"),
      });
    } catch (error) {
      logger.error("Failed to get metrics: {error}", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.json({ error: "Failed to fetch metrics" }, 500);
    }
  }

  private async handleSessionAudit(sessionId: string): Promise<Response> {
    // Validate sessionId format
    if (!/^sess_[a-zA-Z0-9_]+$/.test(sessionId)) {
      return this.json({ error: "Invalid session ID format" }, 400);
    }

    if (!this.deps.auditConfig?.enabled) {
      return this.json({ error: "Audit logging is not enabled" }, 404);
    }

    // Search for audit file across all platform/user directories
    const auditBase = this.deps.auditBasePath;
    try {
      const entries = await this.findAuditFile(auditBase, `${sessionId}.jsonl`);
      if (!entries) {
        return this.json({ error: "Audit log not found" }, 404);
      }

      const content = await Deno.readTextFile(entries);
      const lines = content.trim().split("\n").filter((l) => l.length > 0);
      const parsed = lines.map((line) => JSON.parse(line));
      return this.json(parsed);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return this.json({ error: "Audit log not found" }, 404);
      }
      throw error;
    }
  }

  /** Recursively search for an audit file by name */
  private async findAuditFile(dir: string, filename: string): Promise<string | null> {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory) {
          const found = await this.findAuditFile(fullPath, filename);
          if (found) return found;
        } else if (entry.name === filename) {
          return fullPath;
        }
      }
    } catch {
      // Directory doesn't exist
    }
    return null;
  }

  // --- Workspace Browser ---

  private async handleWorkspaceTree(): Promise<Response> {
    const wsPath = this.deps.agentWorkspacePath;
    try {
      const tree = await this.buildDirectoryTree(wsPath, wsPath);
      return this.json(tree);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return this.json({ name: "agent-workspace", path: "/", type: "directory", children: [] });
      }
      throw error;
    }
  }

  private async buildDirectoryTree(
    rootPath: string,
    currentPath: string,
    depth: number = 0,
    counter: { count: number } = { count: 0 },
    maxDepth: number = 10,
    maxEntries: number = 1000,
  ): Promise<Record<string, unknown>> {
    counter.count++;
    if (counter.count > maxEntries) {
      return { name: "…", path: "", type: "file", truncated: true };
    }

    const stat = await Deno.stat(currentPath);
    const name = currentPath === rootPath ? "agent-workspace" : currentPath.split("/").pop() ?? "";
    const relativePath = currentPath === rootPath
      ? "/"
      : "/" + currentPath.substring(rootPath.length + 1);

    if (!stat.isDirectory) {
      return {
        name,
        path: relativePath,
        type: "file",
        size: stat.size,
        mtime: stat.mtime?.getTime() ?? null,
      };
    }

    if (depth >= maxDepth) {
      return { name, path: relativePath, type: "directory", children: [], truncated: true };
    }

    const children: Record<string, unknown>[] = [];
    for await (const entry of Deno.readDir(currentPath)) {
      const childPath = join(currentPath, entry.name);
      children.push(
        await this.buildDirectoryTree(
          rootPath,
          childPath,
          depth + 1,
          counter,
          maxDepth,
          maxEntries,
        ),
      );
    }

    // Sort: directories first, then alphabetically by name (case-insensitive)
    children.sort((a, b) => {
      const aIsDir = a.type === "directory" ? 0 : 1;
      const bIsDir = b.type === "directory" ? 0 : 1;
      if (aIsDir !== bIsDir) return aIsDir - bIsDir;
      return (a.name as string).localeCompare(b.name as string, undefined, { sensitivity: "base" });
    });

    return {
      name,
      path: relativePath,
      type: "directory",
      children,
      mtime: stat.mtime?.getTime() ?? null,
    };
  }

  private async handleWorkspaceFile(url: URL): Promise<Response> {
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      return this.json({ error: "Missing path parameter" }, 400);
    }

    // Normalize: strip leading slash (tree builder generates absolute-style paths)
    const normalizedPath = filePath.replace(/^\/+/, "");
    if (!normalizedPath) {
      return this.json({ error: "Invalid path" }, 400);
    }

    // Path traversal protection
    if (normalizedPath.includes("..") || normalizedPath.includes("%2F")) {
      return this.json({ error: "Invalid path" }, 400);
    }

    // Extension check
    const ext = "." + normalizedPath.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return this.json({ error: "File type not allowed. Only .md and .txt files." }, 400);
    }

    const fullPath = resolve(this.deps.agentWorkspacePath, normalizedPath);
    const canonicalWs = resolve(this.deps.agentWorkspacePath);

    // Verify resolved path is within workspace
    if (!fullPath.startsWith(canonicalWs + "/") && fullPath !== canonicalWs) {
      return this.json({ error: "Invalid path" }, 400);
    }

    try {
      const content = await Deno.readTextFile(fullPath);
      const stat = await Deno.stat(fullPath);
      return this.json({ path: normalizedPath, content, size: stat.size });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return this.json({ error: "File not found" }, 404);
      }
      throw error;
    }
  }

  // --- Chat ---

  private async handleChatConnect(req: Request): Promise<Response> {
    if (this.chatSession && !this.chatSession.disconnected) {
      return this.json({ error: "A chat session is already active" }, 409);
    }

    let body: { agentType?: string; model?: string };
    try {
      body = await req.json();
    } catch {
      return this.json({ error: "Invalid request body" }, 400);
    }

    const rawAgentType = body.agentType ?? getDefaultAgentType(this.deps.appConfig);
    if (rawAgentType !== "opencode") {
      return this.json({ error: "Invalid agent type" }, 400);
    }
    const agentType: AgentType = rawAgentType;

    const model = body.model ?? this.deps.appConfig.agent.model;
    const chatSessionId = crypto.randomUUID();

    try {
      // Create workspace for web chat
      const workspacePath = join(
        this.deps.appConfig.workspace.repoPath,
        "workspaces",
        "dashboard",
        "web-chat",
      );
      await Deno.mkdir(workspacePath, { recursive: true });

      const agentWorkspacePath = this.deps.agentWorkspacePath;

      const clientConfig: ClientConfig = {
        workingDir: workspacePath,
        agentWorkspacePath,
        platform: "web",
        userId: "dashboard",
        channelId: "web-chat",
        isDM: true,
        yolo: false,
        autoApproveSkills: this.deps.appConfig.agent.autoApproveSkills,
        allowedWriteExtensions: this.deps.appConfig.agent.sandbox?.allowedWriteExtensions,
      };

      const connectorOptions: AgentConnectorOptions = {
        agentConfig: createAgentConfig(
          agentType,
          workspacePath,
          this.deps.appConfig,
          false,
          agentWorkspacePath,
        ),
        clientConfig,
        skillRegistry: this.deps.skillRegistry,
        logger: logger,
        idleTimeoutConfig: this.deps.appConfig.agent.idleTimeout,
      };

      const connector = new AgentConnector(connectorOptions);
      await connector.connect();

      const acpSessionId = await connector.createSession();
      await connector.setSessionModel(acpSessionId, model);
      // Dashboard / manual sessions have no routing context or section value:
      // use the global reasoning effort as the fallback (best-effort, non-fatal).
      const dashboardReasoningEffort = this.deps.appConfig.agent.reasoningEffort ?? "default";
      const reasoningOutcome = await connector.setReasoningEffort(
        acpSessionId,
        dashboardReasoningEffort,
      );
      logger.info("Dashboard reasoning effort outcome {outcome}", {
        requested: dashboardReasoningEffort,
        outcome: reasoningOutcome,
      });

      this.chatSession = {
        id: chatSessionId,
        connector,
        acpSessionId,
        messageCount: 0,
        sseController: null,
        idleTimer: null,
        disconnected: false,
      };

      this.resetIdleTimer();

      logger.info("Chat session {chatSessionId} connected with agent {agentType}", {
        chatSessionId,
        agentType,
      });

      return this.json({ chatSessionId });
    } catch (error) {
      logger.error("Failed to connect chat session: {error}", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.json({ error: "Failed to connect to agent" }, 500);
    }
  }

  private async handleChatMessage(req: Request): Promise<Response> {
    let body: { chatSessionId?: string; content?: string };
    const contentType = req.headers.get("Content-Type") ?? "";

    try {
      if (contentType.includes("text/plain")) {
        // navigator.sendBeacon sends as text/plain
        const text = await req.text();
        body = JSON.parse(text);
      } else {
        body = await req.json();
      }
    } catch {
      return this.json({ error: "Invalid request body" }, 400);
    }

    if (!body.chatSessionId || !body.content) {
      return this.json({ error: "Missing chatSessionId or content" }, 400);
    }

    if (!this.chatSession || this.chatSession.id !== body.chatSessionId) {
      return this.json({ error: "Chat session not found" }, 404);
    }

    if (this.chatSession.disconnected) {
      return this.json({ error: "Chat session is disconnected" }, 410);
    }

    this.resetIdleTimer();
    this.chatSession.messageCount++;

    let content = body.content;

    // On first message, prepend rendered system prompt
    if (this.chatSession.messageCount === 1) {
      try {
        const promptFile = join(Deno.cwd(), "prompts", "system_web_chat.md");
        const variables: TemplateVariables = {
          isDm: true,
          platform: "internal",
          userId: "dashboard",
          channelId: "web-chat",
          guildId: "",
          yolo: false,
          canWriteAgentWorkspace: false,
        };
        const systemPrompt = await loadSystemPrompt(promptFile, variables);
        content = systemPrompt + "\n\n---\n\n" + content;
      } catch (error) {
        logger.warn("Failed to load web chat system prompt, using message as-is: {error}", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Send prompt asynchronously — response streamed via SSE
    const session = this.chatSession;
    const connector = session.connector;

    // Run prompt in background, stream via SSE
    (async () => {
      try {
        // Hook into sessionUpdate for streaming
        const client = connector.getClient();
        const originalUpdate = client?.sessionUpdate.bind(client);
        if (client) {
          const sseController = session.sseController;
          client.sessionUpdate = async (params) => {
            // Forward to SSE
            const update = params.update;
            if (
              "sessionUpdate" in update && update.sessionUpdate === "agent_message_chunk" &&
              "content" in update && update.content.type === "text"
            ) {
              this.sendSSE(sseController, "message", {
                type: "text",
                text: update.content.text,
              });
            } else if (
              "sessionUpdate" in update && update.sessionUpdate === "agent_thought_chunk" &&
              "text" in update
            ) {
              this.sendSSE(sseController, "think", {
                type: "think",
                text: (update as { text: string }).text,
              });
            }
            // Call original handler
            if (originalUpdate) {
              await originalUpdate(params);
            }
          };
        }

        const response = await connector.prompt(session.acpSessionId, content);
        this.sendSSE(session.sseController, "done", {
          stopReason: response.stopReason,
        });
      } catch (error) {
        logger.error("Chat prompt failed: {error}", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.sendSSE(session.sseController, "error", {
          error: "Agent processing error",
        });
      }
    })();

    return this.json({ success: true });
  }

  private handleChatStream(url: URL): Response {
    const chatSessionId = url.searchParams.get("chatSessionId");

    if (!this.chatSession || this.chatSession.id !== chatSessionId) {
      return this.json({ error: "Chat session not found" }, 404);
    }

    const session = this.chatSession;
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        session.sseController = controller;
        // Send initial connection event
        controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));
      },
      cancel: () => {
        session.sseController = null;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  private async handleChatDisconnect(req: Request): Promise<Response> {
    let body: { chatSessionId?: string };
    const contentType = req.headers.get("Content-Type") ?? "";

    try {
      if (contentType.includes("text/plain")) {
        const text = await req.text();
        body = JSON.parse(text);
      } else {
        body = await req.json();
      }
    } catch {
      return this.json({ error: "Invalid request body" }, 400);
    }

    if (!body.chatSessionId) {
      return this.json({ error: "Missing chatSessionId" }, 400);
    }

    if (!this.chatSession || this.chatSession.id !== body.chatSessionId) {
      // Idempotent — session already gone
      return this.json({ success: true });
    }

    await this.disconnectChat();
    return this.json({ success: true });
  }

  private async disconnectChat(reason = "user_disconnect"): Promise<void> {
    if (!this.chatSession) return;
    const session = this.chatSession;

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }

    if (!session.disconnected) {
      session.disconnected = true;
      this.sendSSE(session.sseController, "disconnect", { reason });

      try {
        session.sseController?.close();
      } catch {
        // Controller may already be closed
      }

      try {
        await session.connector.disconnect();
      } catch (error) {
        logger.warn("Error disconnecting chat agent: {error}", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      logger.info("Chat session {chatSessionId} disconnected: {reason}", {
        chatSessionId: session.id,
        reason,
      });
    }

    this.chatSession = null;
  }

  private resetIdleTimer(): void {
    if (!this.chatSession) return;
    if (this.chatSession.idleTimer) {
      clearTimeout(this.chatSession.idleTimer);
    }
    this.chatSession.idleTimer = setTimeout(() => {
      this.disconnectChat("idle_timeout");
    }, CHAT_IDLE_TIMEOUT_MS);
  }

  private sendSSE(
    controller: ReadableStreamDefaultController<Uint8Array> | null,
    event: string,
    data: unknown,
  ): void {
    if (!controller) return;
    try {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
    } catch {
      // Controller may be closed
    }
  }

  // --- Config ---

  private handleConfigModels(): Response {
    const models = new Set<string>();
    const defaultModel = this.deps.appConfig.agent.model;
    if (defaultModel) models.add(defaultModel);

    const rules = this.deps.appConfig.agent.modelRouting?.rules ?? [];
    for (const rule of rules) {
      if (rule.model) models.add(rule.model);
    }

    return this.json([...models]);
  }

  // --- Restart ---

  private async handleRestart(req: Request): Promise<Response> {
    let body: { confirm?: boolean };
    try {
      body = await req.json();
    } catch {
      return this.json({ error: "Invalid request body" }, 400);
    }

    const activeSessions = this.deps.sessionRegistry.getAll();
    const activeSessionCount = activeSessions.length;

    if (body.confirm === undefined) {
      return this.json({ error: "The 'confirm' field is required" }, 400);
    }

    if (!body.confirm) {
      return this.json({
        activeSessionCount,
        warning: activeSessionCount > 0
          ? `There are ${activeSessionCount} active session(s). Restarting will interrupt them.`
          : "No active sessions. Safe to restart.",
      });
    }

    logger.info("Restart requested via dashboard, sending SIGTERM");

    // Send SIGTERM to trigger graceful shutdown
    setTimeout(() => {
      Deno.kill(Deno.pid, "SIGTERM");
    }, 100);

    return this.json({ success: true, message: "Restart initiated" });
  }

  // --- Static Files ---

  private async serveStaticFile(path: string): Promise<Response> {
    // Default to index.html
    const filePath = path === "/" || path === "/login" ? "/index.html" : path;

    const staticDir = join(new URL(".", import.meta.url).pathname, "public");
    const fullPath = resolve(staticDir, filePath.substring(1));

    // Prevent path traversal
    if (!fullPath.startsWith(resolve(staticDir))) {
      return new Response("Not Found", { status: 404 });
    }

    try {
      const content = await Deno.readFile(fullPath);
      const contentType = this.getContentType(filePath);
      return new Response(content, {
        headers: { "Content-Type": contentType },
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }

  private getContentType(path: string): string {
    if (path.endsWith(".html")) return "text/html; charset=utf-8";
    if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
    if (path.endsWith(".css")) return "text/css; charset=utf-8";
    if (path.endsWith(".json")) return "application/json";
    if (path.endsWith(".svg")) return "image/svg+xml";
    return "application/octet-stream";
  }

  // --- Helpers ---

  // --- Channel memory moderation (F15) ---

  /** List channels that have a channel-memory store. */
  private async handleChannelMemoryChannels(): Promise<Response> {
    try {
      const keys = await this.deps.workspaceManager.listChannelWorkspaces();
      return this.json({ channels: keys });
    } catch (error) {
      logger.warn("Failed to list channel workspaces: {error}", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.json({ error: "Failed to list channels" }, 500);
    }
  }

  /**
   * List the channel memories for a channel key (`platform/channelId`).
   * Returns id, content, author, tier, enabled, and timestamps.
   */
  private async handleChannelMemoryList(url: URL): Promise<Response> {
    const key = url.searchParams.get("channel");
    const parsed = this.parseChannelKey(key);
    if (!parsed) {
      return this.json({ error: "Missing or invalid channel parameter" }, 400);
    }

    try {
      const channelWorkspace = await this.deps.workspaceManager.getOrCreateChannelWorkspace(
        parsed.platform,
        parsed.channelId,
      );
      const memories = await this.deps.memoryStore.loadChannelMemories(channelWorkspace);
      return this.json({
        channel: key,
        memories: memories.map((m) => ({
          id: m.id,
          content: m.content,
          author: m.author ?? null,
          tier: m.tier,
          category: m.category,
          enabled: m.enabled,
          createdAt: m.createdAt,
          lastModifiedAt: m.lastModifiedAt,
        })),
      });
    } catch (error) {
      logger.warn("Failed to list channel memories: {error}", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.json({ error: "Failed to list channel memories" }, 500);
    }
  }

  /** Disable (moderate away) a channel memory entry via `patchChannelMemory`. */
  private async handleChannelMemoryDisable(req: Request): Promise<Response> {
    let body: { channel?: string; id?: string };
    try {
      body = await req.json();
    } catch {
      return this.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = this.parseChannelKey(body.channel);
    if (!parsed || !body.id) {
      return this.json({ error: "Missing or invalid channel/id" }, 400);
    }

    try {
      const channelWorkspace = await this.deps.workspaceManager.getOrCreateChannelWorkspace(
        parsed.platform,
        parsed.channelId,
      );
      await this.deps.memoryStore.patchChannelMemory(channelWorkspace, body.id, {
        enabled: false,
      });
      logger.info("Channel memory {id} disabled via dashboard moderation", { id: body.id });
      return this.json({ success: true });
    } catch (error) {
      logger.warn("Failed to disable channel memory: {error}", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.json({ error: "Failed to disable channel memory" }, 500);
    }
  }

  /**
   * Parse and validate a `platform/channelId` channel key, rejecting anything
   * with path-traversal or extra path segments.
   */
  private parseChannelKey(
    key: string | null | undefined,
  ): { platform: string; channelId: string } | null {
    if (!key) return null;
    const parts = key.split("/");
    if (parts.length !== 2) return null;
    // Allow-list each segment (matches the on-disk sanitized workspace naming);
    // this rejects traversal (`..`), encoded separators, and any other unexpected
    // characters rather than blocklisting specific traversal tokens.
    const segment = /^[A-Za-z0-9_.-]+$/;
    if (parts[0] === ".." || parts[1] === "..") return null;
    if (!segment.test(parts[0]) || !segment.test(parts[1])) return null;
    return { platform: parts[0], channelId: parts[1] };
  }

  private json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
