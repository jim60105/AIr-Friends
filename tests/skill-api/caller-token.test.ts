// tests/skill-api/caller-token.test.ts
//
// F13 + JWT skill auth: the Skill API requires a per-session JWT bound to the
// owning session (sub/channel/jti=caller token). A valid session ID alone, a
// wrong token, or a legacy raw caller token is insufficient.

import { assertEquals, assertExists } from "@std/assert";
import { SkillAPIServer } from "../../src/skill-api/server.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { SkillRegistry } from "../../src/skills/registry.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { createSkillJwt } from "../../src/utils/skill-jwt.ts";

const TEST_SKILL_SECRET = "0123456789abcdef0123456789abcdef01";

interface TestRig {
  server: SkillAPIServer;
  sessionRegistry: SessionRegistry;
  port: number;
  tempDir: string;
  register: () => string;
}

let nextPort = 3400;

async function setup(timeoutMs?: number): Promise<TestRig> {
  const tempDir = await Deno.makeTempDir();
  await Deno.mkdir(`${tempDir}/workspaces/discord/123`, { recursive: true });

  const sessionRegistry = new SessionRegistry(timeoutMs);
  const workspaceManager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
  const memoryStore = new MemoryStore(workspaceManager, { searchLimit: 10, maxChars: 2000 });
  const skillRegistry = new SkillRegistry(memoryStore);

  const port = nextPort++;
  const server = new SkillAPIServer(
    sessionRegistry,
    skillRegistry,
    { port, host: "127.0.0.1" },
    TEST_SKILL_SECRET,
  );
  server.start();
  // Wait until listening
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/api/skill/test`, { method: "OPTIONS" });
      await r.body?.cancel();
      break;
    } catch {
      await new Promise((res) => setTimeout(res, 50));
    }
  }

  const register = () =>
    sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: {
        key: "discord/123",
        components: { platform: "discord" as const, userId: "123" },
        path: `${tempDir}/workspaces/discord/123`,
        tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
        isDm: false,
      },
      // deno-lint-ignore no-explicit-any
      platformAdapter: { platform: "discord" } as any,
    });

  return { server, sessionRegistry, port, tempDir, register };
}

async function teardown(rig: TestRig): Promise<void> {
  await rig.server.stop();
  rig.sessionRegistry.stop();
  await Deno.remove(rig.tempDir, { recursive: true });
}

function call(port: number, sessionId: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`http://localhost:${port}/api/skill/memory-stats`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId, parameters: {} }),
  });
}

/** Issue a valid per-session JWT exactly as the process pool does at lease acquisition. */
function jwtFor(rig: TestRig, sessionId: string): Promise<string> {
  const callerToken = rig.sessionRegistry.getCallerToken(sessionId) ?? "";
  return createSkillJwt(TEST_SKILL_SECRET, {
    sub: sessionId,
    channel: "456",
    jti: callerToken,
  });
}

Deno.test("F13 - valid session ID without token is rejected 403", async () => {
  const rig = await setup();
  try {
    const sessionId = rig.register();
    const res = await call(rig.port, sessionId);
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.success, false);
  } finally {
    await teardown(rig);
  }
});

Deno.test("F13 - valid session ID with wrong token is rejected 403", async () => {
  const rig = await setup();
  try {
    const sessionId = rig.register();
    const res = await call(rig.port, sessionId, "deadbeef".repeat(8));
    assertEquals(res.status, 403);
    await res.body?.cancel();
  } finally {
    await teardown(rig);
  }
});

Deno.test("F13 - a token of a different length is rejected 403", async () => {
  const rig = await setup();
  try {
    const sessionId = rig.register();
    const res = await call(rig.port, sessionId, "short");
    assertEquals(res.status, 403);
    await res.body?.cancel();
  } finally {
    await teardown(rig);
  }
});

Deno.test("F13 - valid session ID with matching JWT succeeds", async () => {
  const rig = await setup();
  try {
    const sessionId = rig.register();
    const res = await call(rig.port, sessionId, await jwtFor(rig, sessionId));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
  } finally {
    await teardown(rig);
  }
});

Deno.test("F13 - legacy raw caller token is rejected 403", async () => {
  const rig = await setup();
  try {
    const sessionId = rig.register();
    const rawToken = rig.sessionRegistry.getCallerToken(sessionId) ?? "";
    const res = await call(rig.port, sessionId, rawToken);
    assertEquals(res.status, 403);
    await res.body?.cancel();
  } finally {
    await teardown(rig);
  }
});

Deno.test("F13 - idle session past timeoutMs is treated as absent (401)", async () => {
  const rig = await setup(150); // 150ms idle timeout
  try {
    const sessionId = rig.register();
    const jwt = await jwtFor(rig, sessionId);
    // Immediately valid
    const ok = await call(rig.port, sessionId, jwt);
    assertEquals(ok.status, 200);
    await ok.body?.cancel();
    // Let it go idle past the timeout
    await new Promise((r) => setTimeout(r, 250));
    const expired = await call(rig.port, sessionId, jwt);
    assertEquals(expired.status, 401);
    await expired.body?.cancel();
  } finally {
    await teardown(rig);
  }
});

Deno.test("F13 - active calls keep a session alive across the idle window", async () => {
  const rig = await setup(200);
  try {
    const sessionId = rig.register();
    const jwt = await jwtFor(rig, sessionId);
    // Three calls spaced under the timeout; each touch() should refresh.
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 120));
      const res = await call(rig.port, sessionId, jwt);
      assertEquals(res.status, 200);
      await res.body?.cancel();
    }
    // Total elapsed (~360ms) exceeds the 200ms timeout, but activity kept it alive.
    assertExists(rig.sessionRegistry.get(sessionId));
  } finally {
    await teardown(rig);
  }
});

Deno.test("F13 - a wrong-token 403 is not cached and does not poison the legit caller", async () => {
  const rig = await setup();
  try {
    const sessionId = rig.register();
    const jwt = await jwtFor(rig, sessionId);
    // Attacker (leaked session ID, no token) fires first.
    const attacker = await call(rig.port, sessionId);
    assertEquals(attacker.status, 403);
    await attacker.body?.cancel();
    // Legitimate caller, identical request params, within the 1s dedup window.
    const legit = await call(rig.port, sessionId, jwt);
    assertEquals(legit.status, 200);
    const body = await legit.json();
    assertEquals(body.success, true);
  } finally {
    await teardown(rig);
  }
});

function saveMemory(
  rig: TestRig,
  sessionId: string,
  token: string,
  content: string,
): Promise<Response> {
  return fetch(`http://localhost:${rig.port}/api/skill/memory-save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ sessionId, parameters: { content } }),
  });
}

Deno.test("recovery fence - side-effect skill is rejected 409 while recoveryFenced", async () => {
  const rig = await setup();
  try {
    const sessionId = rig.register();
    const jwt = await jwtFor(rig, sessionId);
    const session = rig.sessionRegistry.get(sessionId);
    assertExists(session);
    session!.recoveryFenced = true;

    const res = await saveMemory(rig, sessionId, jwt, "should not land while fenced");
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.success, false);
    // Rejected-before-execution: the memory must not be written.
    const memFile = `${rig.tempDir}/workspaces/discord/123/memory.public.jsonl`;
    let written = true;
    try {
      await Deno.stat(memFile);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) written = false;
      else throw error;
    }
    assertEquals(written, false);
    // A rejected call never touches the in-flight counter.
    assertEquals(session!.inflightSideEffects ?? 0, 0);

    // Lifting the fence lets the same call execute normally.
    session!.recoveryFenced = false;
    const ok = await saveMemory(rig, sessionId, jwt, "landed after fence lifted");
    assertEquals(ok.status, 200);
    const okBody = await ok.json();
    assertEquals(okBody.success, true);
    assertEquals(session!.inflightSideEffects ?? 0, 0);
  } finally {
    await teardown(rig);
  }
});
