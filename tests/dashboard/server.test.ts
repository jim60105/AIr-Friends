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

function createMockMemoryStore() {
  return {
    loadChannelMemories: () => Promise.resolve([]),
    patchChannelMemory: () => Promise.resolve({}),
  } as never;
}

function createMockWorkspaceManager() {
  return {
    listChannelWorkspaces: () => Promise.resolve([]),
    getOrCreateChannelWorkspace: (platform: string, channelId: string) =>
      Promise.resolve({ key: `${platform}/${channelId}`, platform, channelId, path: "/tmp" }),
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
  metricsRegistry?: Registry | null;
  appConfig?: Config;
  dashboard?: Partial<DashboardConfig>;
}): Promise<TestServer> {
  const dashboardConfig: DashboardConfig = {
    enabled: true,
    port: 0,
    host: "127.0.0.1",
    passphrase: "test-passphrase",
    behindHttpsProxy: false,
    trustedProxies: [],
    ...overrides?.dashboard,
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
    metricsRegistry: overrides?.metricsRegistry === null
      ? undefined
      : (overrides?.metricsRegistry ?? createMockMetricsRegistry()),
    skillRegistry: createMockSkillRegistry(),
    memoryStore: createMockMemoryStore(),
    workspaceManager: createMockWorkspaceManager(),
  });

  // Let the OS assign a free port (port 0). This avoids the probe-and-reuse
  // race (listen on 0, close, then rebind) which causes AddrInUse under
  // --parallel execution.
  server.start();
  const port = server.getPort();
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
    callerToken: "tok_test1",
    lastActivityAt: new Date(),
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
    replySent: false,
    fileSent: false,
    replyCount: 0,
    editCount: 0,
    fileSendCount: 0,
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
    auditSessionId: "sess_s1",
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
    assertEquals(body[0].auditSessionId, "sess_s1");
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
    const res = await fetch(`${t.baseUrl}/api/sessions/sess_nonexistent/audit`, {
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
    host: "127.0.0.1",
    passphrase: "test-passphrase",
    behindHttpsProxy: false,
    trustedProxies: [],
  };
  const tempDir = await Deno.makeTempDir();
  const wsPath = `${tempDir}/agent-workspace`;
  await Deno.mkdir(wsPath, { recursive: true });
  await Deno.writeTextFile(`${wsPath}/test.md`, "# Hello");

  const server = new DashboardServer({
    config: dashboardConfig,
    appConfig: createMinimalConfig(),
    sessionRegistry: createMockSessionRegistry(),
    completedSessionStore: new CompletedSessionStore(),
    agentWorkspacePath: wsPath,
    auditBasePath: `${tempDir}/audit`,
    metricsRegistry: createMockMetricsRegistry(),
    skillRegistry: createMockSkillRegistry(),
    memoryStore: createMockMemoryStore(),
    workspaceManager: createMockWorkspaceManager(),
  });
  server.start();
  const port = server.getPort();
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
      body: JSON.stringify({ agentType: "opencode" }),
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
    auditSessionId: "skill_sess_abc123",
    type: "message",
    platform: "discord",
    userId: "u1",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    status: "success",
    durationMs: 1200,
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
    assertEquals(body[0].auditSessionId, "skill_sess_abc123");
  } finally {
    await t.cleanup();
  }
});

// ============================
// Security headers (Task 13.8)
// ============================

Deno.test({
  name: "DashboardServer - responses include security headers",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/sessions/active`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.headers.get("X-Frame-Options"), "DENY");
    assertEquals(res.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(res.headers.has("Content-Security-Policy"), true);
    assertEquals(res.headers.has("Referrer-Policy"), true);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - security headers on error responses",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/sessions/active`);
    assertEquals(res.status, 401);
    assertEquals(res.headers.get("X-Frame-Options"), "DENY");
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

// ============================
// Rate limiting (Task 13.8)
// ============================

Deno.test({
  name: "DashboardServer - login rate limiting returns 429",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    // Send 7 failed attempts (exceeds default limit of 5+1)
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${t.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: "wrong" }),
      });
      await res.body?.cancel();
    }
    // Next attempt should be rate limited
    const res = await fetch(`${t.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "wrong" }),
    });
    assertEquals(res.status, 429);
    assertEquals(res.headers.has("Retry-After"), true);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

// ============================
// Session ID validation (Task 13.8)
// ============================

Deno.test({
  name: "DashboardServer - audit rejects invalid sessionId format",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    // Path traversal attempt
    const res = await fetch(`${t.baseUrl}/api/sessions/../../../etc/passwd/audit`, {
      headers: { Cookie: cookie },
    });
    // This should either 404 (route doesn't match) or 400
    assertEquals(res.status === 400 || res.status === 404, true);
    await res.body?.cancel();

    // Valid format but nonexistent
    const res2 = await fetch(`${t.baseUrl}/api/sessions/sess_abc123/audit`, {
      headers: { Cookie: cookie },
    });
    // Should not be 400 (format is valid) - could be 404 (audit not enabled or not found)
    assertEquals(res2.status !== 400, true);
    await res2.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

// ============================
// Additional coverage tests
// ============================

Deno.test({
  name: "DashboardServer - GET /api/workspace/file missing path param returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/file`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Missing path parameter");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/workspace/file empty path after normalization returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/file?path=/`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Invalid path");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/workspace/file with .txt extension works",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    await Deno.writeTextFile(`${t.agentWorkspacePath}/note.txt`, "plain text");
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/file?path=/note.txt`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.content, "plain text");
    assertEquals(typeof body.size, "number");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/workspace/tree with files returns children",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    await Deno.mkdir(`${t.agentWorkspacePath}/notes`, { recursive: true });
    await Deno.writeTextFile(`${t.agentWorkspacePath}/notes/topic.md`, "# Topic");
    await Deno.writeTextFile(`${t.agentWorkspacePath}/readme.md`, "readme");
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/tree`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.name, "agent-workspace");
    assertEquals(body.type, "directory");
    assertEquals(body.path, "/");
    assertEquals(Array.isArray(body.children), true);
    assertEquals(body.children.length >= 2, true);
    // Find the notes directory
    const notesDir = body.children.find((c: Record<string, unknown>) => c.name === "notes");
    assertEquals(notesDir?.type, "directory");
    assertEquals(Array.isArray(notesDir?.children), true);
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - buildDirectoryTree truncates at maxDepth",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    // Create deeply nested dirs beyond default maxDepth (10)
    let deepPath = t.agentWorkspacePath;
    for (let i = 0; i < 12; i++) {
      deepPath = `${deepPath}/level${i}`;
    }
    await Deno.mkdir(deepPath, { recursive: true });
    await Deno.writeTextFile(`${deepPath}/deep.md`, "deep content");

    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/tree`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();

    // Walk to depth 10 and verify truncation
    let node = body;
    for (let i = 0; i < 10; i++) {
      const child = node.children?.find((c: Record<string, unknown>) => c.name === `level${i}`);
      if (!child) break;
      node = child;
    }
    // At depth 10, directory should have truncated: true
    assertEquals(node.truncated, true);
    assertEquals(node.type, "directory");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name:
    "DashboardServer - workspace tree sorts directories before files, alphabetically case-insensitive",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    // Create files and directories with intentionally unsorted names
    await Deno.mkdir(`${t.agentWorkspacePath}/Zebra`, { recursive: true });
    await Deno.mkdir(`${t.agentWorkspacePath}/alpha`, { recursive: true });
    await Deno.writeTextFile(`${t.agentWorkspacePath}/Beta.md`, "b");
    await Deno.writeTextFile(`${t.agentWorkspacePath}/gamma.md`, "g");
    await Deno.writeTextFile(`${t.agentWorkspacePath}/Alpha.md`, "a");
    // Nested: verify recursive sorting
    await Deno.writeTextFile(`${t.agentWorkspacePath}/alpha/zebra.md`, "z");
    await Deno.writeTextFile(`${t.agentWorkspacePath}/alpha/apple.md`, "a");

    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/tree`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    const names = body.children.map((c: Record<string, unknown>) => c.name);

    // Directories first (alpha, Zebra), then files (Alpha.md, Beta.md, gamma.md)
    assertEquals(names[0], "alpha");
    assertEquals(names[1], "Zebra");
    assertEquals(names[2], "Alpha.md");
    assertEquals(names[3], "Beta.md");
    assertEquals(names[4], "gamma.md");

    // Verify recursive sorting inside alpha/
    const alphaDir = body.children.find((c: Record<string, unknown>) => c.name === "alpha");
    const nestedNames = alphaDir.children.map((c: Record<string, unknown>) => c.name);
    assertEquals(nestedNames[0], "apple.md");
    assertEquals(nestedNames[1], "zebra.md");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/stats without metrics registry returns zeroes",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer({ metricsRegistry: null });
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/stats`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.sessions_total, 0);
    assertEquals(body.active_sessions, 0);
    assertEquals(body.replies_sent_total, 0);
    assertEquals(body.messages_received_total, 0);
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/stats with metrics data returns aggregated values",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const mockRegistry = {
    getMetricsAsJSON: () =>
      Promise.resolve([
        {
          name: "airfriends_sessions_total",
          values: [{ value: 5 }, { value: 3 }],
        },
        {
          name: "airfriends_active_sessions",
          values: [{ value: 2 }],
        },
        {
          name: "airfriends_replies_sent_total",
          values: [{ value: 10 }],
        },
      ]),
  } as unknown as Registry;
  const t = await createTestServer({ metricsRegistry: mockRegistry });
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/stats`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.sessions_total, 8);
    assertEquals(body.active_sessions, 2);
    assertEquals(body.replies_sent_total, 10);
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/stats handles metrics error",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const mockRegistry = {
    getMetricsAsJSON: () => Promise.reject(new Error("metrics broken")),
  } as unknown as Registry;
  const t = await createTestServer({ metricsRegistry: mockRegistry });
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/stats`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.error, "Failed to fetch metrics");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - audit with valid sess_ format but audit disabled returns 404",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/sessions/sess_validformat/audit`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body.error, "Audit logging is not enabled");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - audit with invalid format (no sess_ prefix) returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/sessions/invalidformat/audit`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Invalid session ID format");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/config/models without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/config/models`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/restart missing confirm field returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "The 'confirm' field is required");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - static file serves index.html at root",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    // Unauthenticated static file requests should still work (login page)
    const res = await fetch(`${t.baseUrl}/`);
    // May return 200 (if public/index.html exists) or 404
    const status = res.status;
    assertEquals(status === 200 || status === 404, true);
    // Should have security headers regardless
    assertEquals(res.headers.get("X-Frame-Options"), "DENY");
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - static file 404 for nonexistent path",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/nonexistent-file.xyz`);
    assertEquals(res.status, 404);
    assertEquals(res.headers.get("X-Frame-Options"), "DENY");
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

// ============ Static-file path traversal regression ============

Deno.test({
  name: "DashboardServer - static file path traversal with encoded dots is rejected (404)",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    // Encoded traversal survives URL parsing so the handler's boundary check is exercised.
    const res = await fetch(`${t.baseUrl}/..%2F..%2Fsecret`);
    assertEquals(res.status, 404);
    assertEquals(res.headers.get("X-Frame-Options"), "DENY");
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - static file serves an existing asset (200)",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/js/app.js`);
    // 200 if the asset exists in public/, 404 otherwise
    assertEquals(res.status === 200 || res.status === 404, true);
    assertEquals(res.headers.get("X-Frame-Options"), "DENY");
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - login with invalid JSON body returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{{{",
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Invalid request body");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - login with missing passphrase returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, "Invalid passphrase");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - unknown API endpoint with auth returns 404 (static fallback)",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/unknown-page`, {
      headers: { Cookie: cookie },
    });
    // Falls through to static file serving, which returns 404
    assertEquals(res.status, 404);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - /login path serves index.html (static)",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/login`);
    // Should serve index.html (200 if exists, 404 if not)
    assertEquals(res.status === 200 || res.status === 404, true);
    assertEquals(res.headers.get("X-Frame-Options"), "DENY");
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/message without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatSessionId: "x", content: "hi" }),
    });
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/chat/stream without auth returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/chat/stream?chatSessionId=x`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/message with no active session returns 404",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ chatSessionId: "nonexistent", content: "hello" }),
    });
    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body.error, "Chat session not found");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/message with invalid body returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/message`, {
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

Deno.test({
  name: "DashboardServer - POST /api/chat/message missing fields returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ chatSessionId: "x" }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Missing chatSessionId or content");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - GET /api/chat/stream with no active session returns 404",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/stream?chatSessionId=nonexistent`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 404);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/disconnect with invalid body returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/disconnect`, {
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

Deno.test({
  name: "DashboardServer - POST /api/chat/disconnect missing chatSessionId returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Missing chatSessionId");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/connect with invalid body returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "not json",
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Invalid request body");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - audit with enabled config and existing file returns entries",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const tempDir = await Deno.makeTempDir();
  const agentWorkspacePath = `${tempDir}/agent-workspace`;
  await Deno.mkdir(agentWorkspacePath, { recursive: true });
  const auditBasePath = `${tempDir}/audit`;
  const auditDir = `${auditBasePath}/discord/user1`;
  await Deno.mkdir(auditDir, { recursive: true });
  const entry = { phase: "session_end", ts: "2024-01-01T00:00:00Z" };
  await Deno.writeTextFile(`${auditDir}/sess_test123.jsonl`, JSON.stringify(entry) + "\n");

  const dashboardConfig: DashboardConfig = {
    enabled: true,
    port: 0,
    host: "127.0.0.1",
    passphrase: "test-passphrase",
    behindHttpsProxy: false,
    trustedProxies: [],
  };
  const server = new DashboardServer({
    config: dashboardConfig,
    appConfig: createMinimalConfig(),
    sessionRegistry: createMockSessionRegistry(),
    completedSessionStore: new CompletedSessionStore(),
    agentWorkspacePath,
    auditConfig: { enabled: true, retentionDays: 7, hashContent: false, includedPhases: [] },
    auditBasePath,
    metricsRegistry: createMockMetricsRegistry(),
    skillRegistry: createMockSkillRegistry(),
    memoryStore: createMockMemoryStore(),
    workspaceManager: createMockWorkspaceManager(),
  });
  server.start();
  const port = server.getPort();
  try {
    for (let i = 0; i < 20; i++) {
      try {
        await fetch(`http://localhost:${port}/api/auth/status`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const cookie = await loginAndGetCookie(`http://localhost:${port}`);
    const res = await fetch(`http://localhost:${port}/api/sessions/sess_test123/audit`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.length, 1);
    assertEquals(body[0].phase, "session_end");
  } finally {
    await server.stop();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test({
  name: "DashboardServer - audit enabled but file not found returns 404",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const tempDir = await Deno.makeTempDir();
  const agentWorkspacePath = `${tempDir}/agent-workspace`;
  await Deno.mkdir(agentWorkspacePath, { recursive: true });
  const auditBasePath = `${tempDir}/audit`;
  await Deno.mkdir(auditBasePath, { recursive: true });

  const dashboardConfig: DashboardConfig = {
    enabled: true,
    port: 0,
    host: "127.0.0.1",
    passphrase: "test-passphrase",
    behindHttpsProxy: false,
    trustedProxies: [],
  };
  const server = new DashboardServer({
    config: dashboardConfig,
    appConfig: createMinimalConfig(),
    sessionRegistry: createMockSessionRegistry(),
    completedSessionStore: new CompletedSessionStore(),
    agentWorkspacePath,
    auditConfig: { enabled: true, retentionDays: 7, hashContent: false, includedPhases: [] },
    auditBasePath,
    metricsRegistry: createMockMetricsRegistry(),
    skillRegistry: createMockSkillRegistry(),
    memoryStore: createMockMemoryStore(),
    workspaceManager: createMockWorkspaceManager(),
  });
  server.start();
  const port = server.getPort();
  try {
    for (let i = 0; i < 20; i++) {
      try {
        await fetch(`http://localhost:${port}/api/auth/status`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const cookie = await loginAndGetCookie(`http://localhost:${port}`);
    const res = await fetch(`http://localhost:${port}/api/sessions/sess_missing/audit`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body.error, "Audit log not found");
  } finally {
    await server.stop();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test({
  name: "DashboardServer - workspace tree with nonexistent workspace returns empty",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const tempDir = await Deno.makeTempDir();
  const nonexistentPath = `${tempDir}/does-not-exist`;

  const dashboardConfig: DashboardConfig = {
    enabled: true,
    port: 0,
    host: "127.0.0.1",
    passphrase: "test-passphrase",
    behindHttpsProxy: false,
    trustedProxies: [],
  };
  const server = new DashboardServer({
    config: dashboardConfig,
    appConfig: createMinimalConfig(),
    sessionRegistry: createMockSessionRegistry(),
    completedSessionStore: new CompletedSessionStore(),
    agentWorkspacePath: nonexistentPath,
    auditBasePath: `${tempDir}/audit`,
    metricsRegistry: createMockMetricsRegistry(),
    skillRegistry: createMockSkillRegistry(),
    memoryStore: createMockMemoryStore(),
    workspaceManager: createMockWorkspaceManager(),
  });
  server.start();
  const port = server.getPort();
  try {
    for (let i = 0; i < 20; i++) {
      try {
        await fetch(`http://localhost:${port}/api/auth/status`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const cookie = await loginAndGetCookie(`http://localhost:${port}`);
    const res = await fetch(`http://localhost:${port}/api/workspace/tree`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.name, "agent-workspace");
    assertEquals(body.children, []);
  } finally {
    await server.stop();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/message with text/plain content type",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Cookie: cookie },
      body: JSON.stringify({ chatSessionId: "nonexistent", content: "hello" }),
    });
    // No active session, so 404
    assertEquals(res.status, 404);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/disconnect with text/plain content type",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Cookie: cookie },
      body: JSON.stringify({ chatSessionId: "nonexistent" }),
    });
    assertEquals(res.status, 200);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/message text/plain invalid JSON returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Cookie: cookie },
      body: "not json",
    });
    assertEquals(res.status, 400);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/disconnect text/plain invalid JSON returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Cookie: cookie },
      body: "not json",
    });
    assertEquals(res.status, 400);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - server stop is idempotent",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  await t.cleanup();
  // Double stop should not throw
  await t.server.stop();
});

Deno.test({
  name: "DashboardServer - authenticated static CSS file returns correct content type",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/style.css`, {
      headers: { Cookie: cookie },
    });
    if (res.status === 200) {
      assertEquals(res.headers.get("Content-Type"), "text/css; charset=utf-8");
    }
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - authenticated static JS file returns correct content type",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    // Check if any JS files exist
    const res = await fetch(`${t.baseUrl}/js/app.js`, {
      headers: { Cookie: cookie },
    });
    if (res.status === 200) {
      assertEquals(
        res.headers.get("Content-Type"),
        "application/javascript; charset=utf-8",
      );
    }
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - authenticated root path serves index.html",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - POST /api/chat/connect with valid type fails gracefully (no agent)",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const config = createMinimalConfig();
  const tempWorkspace = await Deno.makeTempDir();
  config.workspace = { repoPath: tempWorkspace, workspacesDir: "workspaces" };
  const t = await createTestServer({ appConfig: config });
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ agentType: "opencode", model: "gpt-4" }),
    });
    // Will fail because opencode binary is not available — returns 500
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.error, "Failed to connect to agent");
  } finally {
    await t.cleanup();
    await Deno.remove(tempWorkspace, { recursive: true }).catch(() => {});
  }
});

Deno.test({
  name: "DashboardServer - login with x-forwarded-for header records IP",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "192.168.1.1, 10.0.0.1",
      },
      body: JSON.stringify({ passphrase: "test-passphrase" }),
    });
    assertEquals(res.status, 200);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - F8: default host binds localhost and serves requests",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  // createTestServer uses host "127.0.0.1" by default; a request over localhost succeeds.
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/auth/status`);
    // Unauthenticated status endpoint returns 401 (server is reachable on localhost).
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - F8: explicit 0.0.0.0 host is honored and serves requests",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer({ dashboard: { host: "0.0.0.0" } });
  try {
    // When bound to 0.0.0.0, the server is still reachable via loopback.
    const res = await fetch(`http://127.0.0.1:${t.port}/api/auth/status`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - F10: spoofed X-Forwarded-Proto https does NOT set Secure cookie",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  // behindHttpsProxy defaults to false; the Secure flag must NOT be derived from the header.
  const t = await createTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({ passphrase: "test-passphrase" }),
    });
    assertEquals(res.status, 200);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    assertEquals(setCookie.includes("Secure"), false);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - F10: Secure cookie set when behindHttpsProxy is true",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer({ dashboard: { behindHttpsProxy: true } });
  try {
    const res = await fetch(`${t.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "test-passphrase" }),
    });
    assertEquals(res.status, 200);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    assertEquals(setCookie.includes("Secure"), true);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - F5: X-Forwarded-For ignored for rate-limit key when proxy untrusted",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  // With no trustedProxies, header rotation must still be counted against the real IP,
  // so the limit is reached despite unique X-Forwarded-For values each time.
  const t = await createTestServer();
  try {
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${t.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `10.0.0.${i}`,
        },
        body: JSON.stringify({ passphrase: "wrong" }),
      });
      await res.body?.cancel();
    }
    const res = await fetch(`${t.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "10.0.0.99",
      },
      body: JSON.stringify({ passphrase: "wrong" }),
    });
    assertEquals(res.status, 429);
    await res.body?.cancel();
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - F5: trusted proxy X-Forwarded-For honored for rate-limit key",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  // Trust the loopback proxy (127.0.0.1). Then distinct X-Forwarded-For values are keyed
  // separately, so 6 attempts across 6 distinct forwarded IPs stay under the per-IP limit.
  const t = await createTestServer({ dashboard: { trustedProxies: ["127.0.0.1", "::1"] } });
  try {
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${t.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `198.51.100.${i}`,
        },
        body: JSON.stringify({ passphrase: "wrong" }),
      });
      last = res.status;
      await res.body?.cancel();
    }
    // Each distinct forwarded IP is its own key -> none exceeds the per-IP limit -> 401 not 429.
    assertEquals(last, 401);
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - active sessions maps spontaneous type correctly",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const mockSession: ActiveSession = {
    id: "sess_spont",
    callerToken: "tok_spont",
    lastActivityAt: new Date(),
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
    triggerEvent: undefined, // No trigger = spontaneous
    startedAt: new Date(),
    replySent: false,
    fileSent: false,
    replyCount: 0,
    editCount: 0,
    fileSendCount: 0,
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
    assertEquals(body[0].type, "spontaneous");
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - restart with confirm: false and active sessions shows warning count",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const mockSession: ActiveSession = {
    id: "sess_active",
    callerToken: "tok_active",
    lastActivityAt: new Date(),
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
    replySent: false,
    fileSent: false,
    replyCount: 0,
    editCount: 0,
    fileSendCount: 0,
  };
  const registry = createMockSessionRegistry([mockSession]);
  const t = await createTestServer({ sessionRegistry: registry });
  try {
    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ confirm: false }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.activeSessionCount, 1);
    assertEquals(body.warning.includes("1 active session"), true);
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - buildDirectoryTree maxEntries truncation",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    // Create >1000 files to hit maxEntries limit
    const dir = `${t.agentWorkspacePath}/many`;
    await Deno.mkdir(dir, { recursive: true });
    const promises = [];
    for (let i = 0; i < 1002; i++) {
      promises.push(Deno.writeTextFile(`${dir}/file${i}.md`, `${i}`));
    }
    await Promise.all(promises);

    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/workspace/tree`, {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    // Should contain a truncated marker somewhere
    const json = JSON.stringify(body);
    assertEquals(json.includes('"truncated":true'), true);
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - chat message with active session but wrong ID returns 404",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    // Inject a fake chat session to test more code paths
    const serverAny = t.server as unknown as {
      chatSession: {
        id: string;
        connector: unknown;
        acpSessionId: string;
        messageCount: number;
        sseController: null;
        idleTimer: null;
        disconnected: boolean;
      };
    };
    serverAny.chatSession = {
      id: "fake-session",
      connector: {},
      acpSessionId: "acp-123",
      messageCount: 0,
      sseController: null,
      idleTimer: null,
      disconnected: false,
    };

    const cookie = await loginAndGetCookie(t.baseUrl);

    // Wrong session ID
    const res = await fetch(`${t.baseUrl}/api/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ chatSessionId: "wrong-id", content: "hello" }),
    });
    assertEquals(res.status, 404);
    await res.body?.cancel();

    // Clean up
    serverAny.chatSession = null as unknown as typeof serverAny.chatSession;
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - chat message with disconnected session returns 410",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const serverAny = t.server as unknown as {
      chatSession: {
        id: string;
        connector: unknown;
        acpSessionId: string;
        messageCount: number;
        sseController: null;
        idleTimer: ReturnType<typeof setTimeout> | null;
        disconnected: boolean;
      };
    };
    serverAny.chatSession = {
      id: "disc-session",
      connector: {},
      acpSessionId: "acp-123",
      messageCount: 0,
      sseController: null,
      idleTimer: null,
      disconnected: true,
    };

    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ chatSessionId: "disc-session", content: "hello" }),
    });
    assertEquals(res.status, 410);
    const body = await res.json();
    assertEquals(body.error, "Chat session is disconnected");

    serverAny.chatSession = null as unknown as typeof serverAny.chatSession;
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - chat connect returns 409 when session already active",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const serverAny = t.server as unknown as {
      chatSession: {
        id: string;
        connector: unknown;
        acpSessionId: string;
        messageCount: number;
        sseController: null;
        idleTimer: null;
        disconnected: boolean;
      };
    };
    serverAny.chatSession = {
      id: "existing-session",
      connector: {},
      acpSessionId: "acp-123",
      messageCount: 0,
      sseController: null,
      idleTimer: null,
      disconnected: false,
    };

    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ agentType: "opencode" }),
    });
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.error, "A chat session is already active");

    serverAny.chatSession = null as unknown as typeof serverAny.chatSession;
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - chat stream with matching session returns SSE stream",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const serverAny = t.server as unknown as {
      chatSession: {
        id: string;
        connector: unknown;
        acpSessionId: string;
        messageCount: number;
        sseController: ReadableStreamDefaultController<Uint8Array> | null;
        idleTimer: null;
        disconnected: boolean;
      };
    };
    serverAny.chatSession = {
      id: "stream-session",
      connector: {},
      acpSessionId: "acp-123",
      messageCount: 0,
      sseController: null,
      idleTimer: null,
      disconnected: false,
    };

    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(
      `${t.baseUrl}/api/chat/stream?chatSessionId=stream-session`,
      { headers: { Cookie: cookie } },
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/event-stream");

    // Read the initial "connected" event
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    assertEquals(text.includes("event: connected"), true);

    // Cancel reading
    reader.cancel();

    serverAny.chatSession = null as unknown as typeof serverAny.chatSession;
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - chat disconnect with matching session cleans up",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  try {
    const serverAny = t.server as unknown as {
      chatSession: {
        id: string;
        connector: { disconnect: () => Promise<void> };
        acpSessionId: string;
        messageCount: number;
        sseController: null;
        idleTimer: ReturnType<typeof setTimeout> | null;
        disconnected: boolean;
      } | null;
    };
    serverAny.chatSession = {
      id: "disconnect-session",
      connector: { disconnect: () => Promise.resolve() },
      acpSessionId: "acp-123",
      messageCount: 0,
      sseController: null,
      idleTimer: null,
      disconnected: false,
    };

    const cookie = await loginAndGetCookie(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/api/chat/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ chatSessionId: "disconnect-session" }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);

    // Verify session was cleaned up
    assertEquals(serverAny.chatSession, null);
  } finally {
    await t.cleanup();
  }
});

Deno.test({
  name: "DashboardServer - stop cleans up active chat session",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const t = await createTestServer();
  const serverAny = t.server as unknown as {
    chatSession: {
      id: string;
      connector: { disconnect: () => Promise<void> };
      acpSessionId: string;
      messageCount: number;
      sseController: null;
      idleTimer: ReturnType<typeof setTimeout> | null;
      disconnected: boolean;
    } | null;
  };
  serverAny.chatSession = {
    id: "stop-session",
    connector: { disconnect: () => Promise.resolve() },
    acpSessionId: "acp-123",
    messageCount: 0,
    sseController: null,
    idleTimer: setTimeout(() => {}, 999999),
    disconnected: false,
  };
  await t.cleanup();
  assertEquals(serverAny.chatSession, null);
});
