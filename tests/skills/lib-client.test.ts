// tests/skills/lib-client.test.ts
// Unit tests for the skill library's JWT presentation (JWT skill auth):
// owning-session resolution (active.json pointer or $SESSION_ID), JWT file
// reading, and end-to-end Skill API calls with a live server.

import { assertEquals, assertThrows } from "@std/assert";
import { callSkillApi, readSkillJwt, resolveOwningSessionId } from "../../skills/lib/client.ts";
import { SkillAPIServer } from "../../src/skill-api/server.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { SkillRegistry } from "../../src/skills/registry.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { createSkillJwt } from "../../src/utils/skill-jwt.ts";

const TEST_SKILL_SECRET = "0123456789abcdef0123456789abcdef01";

function withEnv(key: string, value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get(key);
  if (value === undefined) {
    Deno.env.delete(key);
  } else {
    Deno.env.set(key, value);
  }
  return fn().finally(() => {
    if (prev === undefined) Deno.env.delete(key);
    else Deno.env.set(key, prev);
  });
}

Deno.test("resolveOwningSessionId - uses the active.json pointer in shared mode", async () => {
  const jwtDir = Deno.makeTempDirSync();
  await Deno.writeTextFile(`${jwtDir}/active.json`, JSON.stringify({ sessionId: "sess_pointer" }));
  await withEnv("SKILL_SHARED_PROCESS", "1", async () => {
    await withEnv("SKILL_JWT_DIR", jwtDir, async () => {
      await withEnv("SESSION_ID", "sess_stale_env", async () => {
        assertEquals(resolveOwningSessionId(), "sess_pointer");
      });
    });
  });
  await Deno.remove(jwtDir, { recursive: true });
});

Deno.test("resolveOwningSessionId - $SESSION_ID wins over a stale pointer in per-spawn mode", async () => {
  const jwtDir = Deno.makeTempDirSync();
  await Deno.writeTextFile(
    `${jwtDir}/active.json`,
    JSON.stringify({ sessionId: "sess_stale_pointer" }),
  );
  await withEnv("SKILL_JWT_DIR", jwtDir, async () => {
    await withEnv("SESSION_ID", "sess_env_owner", async () => {
      assertEquals(resolveOwningSessionId(), "sess_env_owner");
    });
  });
  await Deno.remove(jwtDir, { recursive: true });
});

Deno.test("resolveOwningSessionId - falls back to $SESSION_ID in per-spawn mode", async () => {
  await withEnv("SKILL_JWT_DIR", undefined, async () => {
    await withEnv("SESSION_ID", "sess_env", async () => {
      await Promise.resolve();
      assertEquals(resolveOwningSessionId(), "sess_env");
    });
  });
});

Deno.test("resolveOwningSessionId - throws when neither source is available", async () => {
  await withEnv("SKILL_JWT_DIR", undefined, async () => {
    await withEnv("SESSION_ID", undefined, async () => {
      await Promise.resolve();
      assertThrows(
        () => resolveOwningSessionId(),
        Error,
        "available",
      );
    });
  });
});

Deno.test("readSkillJwt - reads the per-session JWT file", async () => {
  const jwtDir = Deno.makeTempDirSync();
  const jwt = await createSkillJwt(TEST_SKILL_SECRET, {
    sub: "sess_ab12",
    channel: "discord/123",
    jti: "tok1",
  });
  await Deno.writeTextFile(`${jwtDir}/sess_ab12.jwt`, jwt + "\n");
  await withEnv("SKILL_JWT_DIR", jwtDir, async () => {
    await Promise.resolve();
    assertEquals(readSkillJwt("sess_ab12"), jwt);
  });
  await Deno.remove(jwtDir, { recursive: true });
});

Deno.test("callSkillApi - presents the per-session JWT end-to-end", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    // Register a session; capture its caller token for the JWT `jti`.
    const mockWorkspace = {
      key: "discord/123",
      components: { platform: "discord" as const, userId: "123" },
      path: tempDir,
      tmpPath: `${tempDir}/tmp`,
      isDm: false,
    };
    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "discord/456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
    });
    const callerToken = sessionRegistry.getCallerToken(sessionId) ?? "";

    // Issue the per-session JWT exactly as the process pool does at lease acquisition.
    const jwtDir = `${tempDir}/skill-jwt`;
    await Deno.mkdir(jwtDir, { recursive: true });
    const jwt = await createSkillJwt(TEST_SKILL_SECRET, {
      sub: sessionId,
      channel: "discord/456",
      jti: callerToken,
    });
    await Deno.writeTextFile(`${jwtDir}/${sessionId}.jwt`, jwt + "\n");
    // Write the active pointer (the pool writes it while the lease is held).
    await Deno.writeTextFile(`${jwtDir}/active.json`, JSON.stringify({ sessionId }));

    const port = 3301;
    const server = new SkillAPIServer(
      sessionRegistry,
      skillRegistry,
      { port, host: "127.0.0.1" },
      TEST_SKILL_SECRET,
    );
    server.start();
    await new Promise((r) => setTimeout(r, 200));

    await withEnv("SKILL_JWT_DIR", jwtDir, async () => {
      const result = await callSkillApi(
        `http://localhost:${port}`,
        "memory-save",
        sessionId,
        { content: "test memory", visibility: "public" },
      );
      assertEquals(result.success, true);
    });

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
