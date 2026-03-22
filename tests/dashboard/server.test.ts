// tests/dashboard/server.test.ts

import { assertEquals } from "@std/assert";
import { DashboardServer } from "../../src/dashboard/server.ts";
import { CompletedSessionStore } from "../../src/dashboard/completed-session-store.ts";
import type { ActiveSession, SessionRegistry } from "../../src/skill-api/session-registry.ts";
import type { Config, DashboardConfig } from "../../src/types/config.ts";
import type { Registry } from "prom-client";

// --- Helpers ---

function createMockSessionRegistry(sessions: ActiveSession[] = []): SessionRegistry {
  return {
    getAll: () => sessions,
    get: () => undefined,
    has: () => false,
    register: () => "",
    generateSessionId: () => "mock",
    markReplySent: () => false,
    unmarkReplySent: () => {},
    incrementReplyCount: () => 0,
    getReplyCount: () => 0,
    incrementEditCount: () => 0,
    getEditCount: () => 0,
    hasReplySent: () => false,
    setAuditWriter: () => {},
    setTerminateCallback: () => {},
    setLastSentMessageId: () => {},
    getLastSentMessageId: () => undefined,
    touch: () => {},
    remove: () => {},
    hasActiveSessionsForWorkspace: () => false,
    activeCount: 0,
    stop: () => {},
  } as unknown as SessionRegistry;
}

function createMockMetricsRegistry(): Registry {
  return {
    getMetricsAsJSON: () => Promise.resolve([]),
  } as unknown as Registry;
}

function createMockSkillRegistry() {
  return {
    getAll: () => [],
    get: () => undefined,
    register: () => {},
    getSkillNames: () => [],
  } as never;
}

function createMinimalConfig(): Config {
  return {
    platforms: {
      discord: { token: "", enabled: false },
      misskey: { host: "", token: "", enabled: false },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: "./prompts/system_reply.md",
      tokenLimit: 20000,
      autoApproveSkills: [],
    },
    memory: { searchLimit: 10, maxChars: 2000 },
    workspace: { repoPath: "./data", workspacesDir: "workspaces" },
    replyPolicy: "channels",
    channels: [],
  } as unknown as Config;
}

interface TestServer {
  server: DashboardServer;
  port: number;
  baseUrl: string;
  agentWorkspacePath: string;
  cleanup: () => Promise<void>;
}

async function createTestServer(overrides?: {
  sessionRegistry?: SessionRegistry;
  completedSessionStore?: CompletedSessionStore;
  metricsRegistry?: Registry;
  appConfig?: Config;
}): Promise<TestServer> {
  const dashboardConfig: DashboardConfig = {
    enabled: true,
    port: 0,
    passphrase: "test-passphrase",
  };

  const tempDir = await Deno.makeTempDir();
  const agentWorkspacePath = `${tempDir}/agent-workspace`;
  await Deno.mkdir(agentWorkspacePath, { recursive: true });

  const server = new DashboardServer({
    config: dashboardConfig,
    appConfig: overrides?.appConfig ?? createMinimalConfig(),
    sessionRegistry: overrides?.sessionRegistry ?? createMockSessionRegistry(),
    completedSessionStore: overrides?.completedSessionStore ?? new CompletedSessionStore(),
    agentWorkspacePath,
    auditBasePath: `${tempDir}/audit`,
    metricsRegistry: overrides?.metricsRegistry ?? createMockMetricsRegistry(),
    skillRegistry: createMockSkillRegistry(),
  });

  // Use a random available port by starting with port 0
  // DashboardServer uses the config port, so we need to find a free port
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  // Update config to use found port
  (dashboardConfig as { port: number }).port = port;

  server.start();
  // Wait for server to be ready
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(`http://localhost:${port}/api/auth/status`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return {
    server,
    port,
    baseUrl: `http://localhost:${port}`,
    agentWorkspacePath,
    cleanup: async () => {
      await server.stop();
      await Deno.remove(tempDir, { recursive: true });
    },
  };
}

async function loginAndGetCookie(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase: "test-passphrase" }),
  });
  assertEquals(res.status, 200);
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  // Extract the cookie key=value part
  const match = setCookie.match(/dashboard_session=[^;]+/);
  return match ? match[0] : "";
}

// ============================
// Auth flow tests (Task 13.7)
// ============================

Deno.test({
  name: "DashboardServer - login with correct passphrase returns 200 + Set-Cookie",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "test-passphrase" }),
    });
    assertEquals(res.status, 200);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    assertEquals(setCookie.includes("HttpOnly"), true);
    assertEquals(setCookie.includes("SameSite=Strict"), true);
    await res.body?.cancel();
  } finally {
    // Clear global tokenStore between tests
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - login with wrong passphrase returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "wrong" }),
    });
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - protected endpoint without cookie returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/sessions/active`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - protected endpoint with valid cookie returns 200",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/sessions/active`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - logout clears cookie",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    assertEquals(setCookie.includes("Max-Age=0"), true);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - access endpoint after logout returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    // Logout
    const logoutRes = await fetch(`${t.baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    await logoutRes.body?.cancel();
    // Try to access protected endpoint with same cookie
    const res = await fetch(`${t.baseUrl}/api/sessions/active`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/auth/status without cookie returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/auth/status`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/auth/status with cookie returns 200",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/auth/status`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.authenticated, true);
  } finally {
    await t.cleanup();
  }
});

// ============================
// Session monitor APIs (Task 13.2)
// ============================

Deno.test({
  name: "DashboardServer - GET /api/sessions/active without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/sessions/active`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/sessions/active with auth, empty returns []",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/sessions/active`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body, []);
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/sessions/active with sessions returns data",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const mockSession: ActiveSession = {
    id: "sess_test1",
    platform: "discord",
    channelId: "ch1",
    userId: "u1",
    isDm: false,
    workspace: {
      key: "discord/u1",
      path: "/tmp/ws",
      tmpPath: "/tmp/ws/tmp",
      components: { platform: "discord", userId: "u1" },
      isDm: false,
    },
    platformAdapter: {} as never,
    triggerEvent: {
      platform: "discord",
      channelId: "ch1",
      userId: "u1",
      messageId: "m1",
      isDm: false,
      guildId: "",
      content: "hello",
      timestamp: new Date(),
    },
    startedAt: new Date(),
    lastActivityAt: new Date(),
    timeoutMs: 60000,
    replySent: false,
    replyCount: 0,
    editCount: 0,
  };
  const registry = createMockSessionRegistry([mockSession]);
  const t = await createTestServer({ sessionRegistry: registry });
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/sessions/active`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.length, 1);
    assertEquals(body[0].id, "sess_test1");
    assertEquals(body[0].platform, "discord");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/sessions/history without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/sessions/history`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/sessions/history with auth, empty returns []",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/sessions/history`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body, []);
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/sessions/history with entries returns data",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const store = new CompletedSessionStore();
  store.add({
    id: "s1",
    type: "message",
    platform: "discord",
    userId: "u1",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    status: "success",
    durationMs: 500,
  });
  const t = await createTestServer({ completedSessionStore: store });
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/sessions/history`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.length, 1);
    assertEquals(body[0].id, "s1");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/stats without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/stats`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/stats with auth returns stats object",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/stats`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(typeof body.sessions_total, "number");
    assertEquals(typeof body.active_sessions, "number");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/sessions/:id/audit without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/sessions/nonexistent/audit`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/sessions/:id/audit not found returns 404",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/sessions/nonexistent/audit`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 404);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

// ============================
// Workspace browser (Task 13.3)
// ============================

Deno.test({
  name: "DashboardServer - GET /api/workspace/tree without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/workspace/tree`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/workspace/tree with auth returns tree",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/tree`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.name, "agent-workspace");
    assertEquals(body.type, "directory");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/workspace/file without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/workspace/file?path=test.md`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/workspace/file valid .md returns 200",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  // Need to create a file in the workspace
  const dashboardConfig: DashboardConfig = {
    enabled: true,
    port: 0,
    passphrase: "test-passphrase",
  };
  const tempDir = await Deno.makeTempDir();
  const wsPath = `${tempDir}/agent-workspace`;
  await Deno.mkdir(wsPath, { recursive: true });
  await Deno.writeTextFile(`${wsPath}/test.md`, "# Hello");

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  dashboardConfig.port = port;

  const server = new DashboardServer({
    config: dashboardConfig,
    appConfig: createMinimalConfig(),
    sessionRegistry: createMockSessionRegistry(),
    completedSessionStore: new CompletedSessionStore(),
    agentWorkspacePath: wsPath,
    auditBasePath: `${tempDir}/audit`,
    metricsRegistry: createMockMetricsRegistry(),
    skillRegistry: createMockSkillRegistry(),
  });
  server.start();
  try {
    // Wait for server
    for (let i = 0; i < 20; i++) {
      try {
        await fetch(`http://localhost:${port}/api/auth/status`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const cookie = await loginAndGetCookie(`http://localhost:${port}`);
    const res = await fetch(`http://localhost:${port}/api/workspace/file?path=test.md`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.content, "# Hello");
  } finally {
    await server.stop();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test({
  name: "DashboardServer - GET /api/workspace/file disallowed extension returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/file?path=secret.json`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 400);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/workspace/file not found returns 404",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/file?path=nonexistent.md`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 404);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - path traversal with ../ returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/file?path=../etc/passwd.md`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 400);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - path traversal with absolute path returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    // After leading-slash normalization, /etc/passwd.md becomes etc/passwd.md
    // which is a valid relative path within workspace (returns 404 if not found).
    // Use .. traversal to test actual path traversal rejection.
    const res = await fetch(`${t.baseUrl}/api/workspace/file?path=/../etc/passwd.md`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 400);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - path traversal with encoded %2F.. returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    // Use %252F to ensure %2F reaches the server (fetch decodes once)
    const res = await fetch(
      `${t.baseUrl}/api/workspace/file?path=notes%2F..%2F..%2Fetc%2Fpasswd.md`,
      {
        headers: { Cookie: cookie },
      },
    );
    assertEquals(res.status, 400);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

// ============================
// Chat (Task 13.4)
// ============================

Deno.test({
  name: "DashboardServer - POST /api/chat/connect without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/chat/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentType: "copilot" }),
    });
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/connect with invalid agentType returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ agentType: "invalid-agent" }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Invalid agent type");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/disconnect without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/chat/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatSessionId: "nonexistent" }),
    });
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/disconnect idempotent returns 200",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ chatSessionId: "nonexistent" }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
  } finally {
    await t.cleanup();
  }
});

// ============================
// Restart (Task 13.5)
// ============================

Deno.test({
  name: "DashboardServer - POST /api/restart without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: false }),
    });
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/restart with confirm: false returns warning",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ confirm: false }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(typeof body.activeSessionCount, "number");
    assertEquals(typeof body.warning, "string");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/restart with invalid body returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "not json",
    });
    assertEquals(res.status, 400);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

// ============================
// Workspace file path normalization (Task 1.2)
// ============================

Deno.test({
  name: "DashboardServer - GET /api/workspace/file with leading slash is normalized and served",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    // Create a file inside the agent workspace
    const notesDir = `${t.agentWorkspacePath}/notes`;
    await Deno.mkdir(notesDir, { recursive: true });
    await Deno.writeTextFile(`${notesDir}/test.md`, "# Leading slash test");

    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/file?path=/notes/test.md`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.content, "# Leading slash test");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - path traversal with leading slash /../ returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/file?path=/../etc/passwd.md`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 400);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

// ============================
// Model config endpoint (Task 3.3)
// ============================

Deno.test({
  name: "DashboardServer - GET /api/config/models returns default model",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/config/models`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body, ["gpt-4"]);
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name:
    "DashboardServer - GET /api/config/models returns unique models from routing rules + default",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const config = createMinimalConfig();
  config.agent.modelRouting = {
    enabled: true,
    rules: [
      { match: { channel: "discord/account/123" }, model: "claude-sonnet-4" },
      { match: { sessionType: "spontaneous" }, model: "gemini-2.5-pro" },
      { match: { channel: "discord/channel/456" }, model: "gpt-4" }, // duplicate of default
    ],
  };
  const t = await createTestServer({ appConfig: config });
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/config/models`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json() as string[];
    assertEquals(body.length, 3); // gpt-4, claude-sonnet-4, gemini-2.5-pro (deduped)
    assertEquals(body.includes("gpt-4"), true);
    assertEquals(body.includes("claude-sonnet-4"), true);
    assertEquals(body.includes("gemini-2.5-pro"), true);
  } finally {
    await t.cleanup();
  }
});

// ============================
// Audit session ID in history (Task 4.4)
// ============================

Deno.test({
  name: "DashboardServer - GET /api/sessions/history includes auditSessionId",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const store = new CompletedSessionStore();
  store.add({
    id: "s_with_audit",
    type: "message",
    platform: "discord",
    userId: "u1",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    status: "success",
    durationMs: 1200,
    auditSessionId: "skill_sess_abc123",
  });
  const t = await createTestServer({ completedSessionStore: store });
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/sessions/history`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.length, 1);
    assertEquals(body[0].id, "s_with_audit");
    assertEquals(body[0].auditSessionId, "skill_sess_abc123");
  } finally {
    await t.cleanup();
  }
});
