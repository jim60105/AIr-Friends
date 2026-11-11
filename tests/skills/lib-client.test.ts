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
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";
import { makeTempDir, makeTempDirSync } from "../../src/utils/fs-compat.ts";

const TEST_SKILL_SECRET = "0123456789abcdef0123456789abcdef01";

function withEnv(key: string, value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  return fn().finally(() => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  });
}

test("resolveOwningSessionId - uses the active.json pointer in shared mode", async () => {
  const jwtDir = makeTempDirSync();
  await fsp.writeFile(`${jwtDir}/active.json`, JSON.stringify({ sessionId: "sess_pointer" }));
  await withEnv("SKILL_SHARED_PROCESS", "1", async () => {
    await withEnv("SKILL_JWT_DIR", jwtDir, async () => {
      await withEnv("SESSION_ID", "sess_stale_env", async () => {
        await Promise.resolve();
        assertEquals(resolveOwningSessionId(), "sess_pointer");
      });
    });
  });
  await fsp.rm(jwtDir, { recursive: true });
});

test("resolveOwningSessionId - $SESSION_ID wins over a stale pointer in per-spawn mode", async () => {
  const jwtDir = makeTempDirSync();
  await fsp.writeFile(`${jwtDir}/active.json`, JSON.stringify({ sessionId: "sess_stale_pointer" }));
  await withEnv("SKILL_JWT_DIR", jwtDir, async () => {
    await withEnv("SESSION_ID", "sess_env_owner", async () => {
      await Promise.resolve();
      assertEquals(resolveOwningSessionId(), "sess_env_owner");
    });
  });
  await fsp.rm(jwtDir, { recursive: true });
});

test("resolveOwningSessionId - shared mode without a pointer fails SKILL_SESSION_UNRESOLVED (no env fallback)", async () => {
  const jwtDir = makeTempDirSync();
  try {
    await withEnv("SKILL_SHARED_PROCESS", "1", async () => {
      await withEnv("SKILL_JWT_DIR", jwtDir, async () => {
        // A stale frozen env value must NOT be honored in shared mode: the
        // pointer is the sole identity source and its absence fails loud.
        await withEnv("SESSION_ID", "sess_stale_env", async () => {
          await Promise.resolve();
          assertThrows(
            () => resolveOwningSessionId(),
            Error,
            "SKILL_SESSION_UNRESOLVED",
          );
          assertThrows(
            () => resolveOwningSessionId(),
            Error,
            `${jwtDir}/active.json`,
          );
        });
      });
    });
  } finally {
    await fsp.rm(jwtDir, { recursive: true });
  }
});

test("resolveOwningSessionId - shared mode with a malformed pointer (non-string sessionId) fails loud", async () => {
  const jwtDir = makeTempDirSync();
  try {
    await fsp.writeFile(`${jwtDir}/active.json`, JSON.stringify({ sessionId: 42 }));
    await withEnv("SKILL_SHARED_PROCESS", "1", async () => {
      await withEnv("SKILL_JWT_DIR", jwtDir, async () => {
        await Promise.resolve();
        // A truthy-but-wrong-typed session id must not pass the schema check.
        const err = assertThrows(
          () => resolveOwningSessionId(),
          Error,
          "SKILL_SESSION_UNRESOLVED",
        );
        // The typed error carries the stable code for structured exit output.
        assertEquals(
          (err as { code?: string }).code,
          "SKILL_SESSION_UNRESOLVED",
        );
      });
    });
  } finally {
    await fsp.rm(jwtDir, { recursive: true });
  }
});

test("resolveOwningSessionId - falls back to $SESSION_ID in per-spawn mode", async () => {
  await withEnv("SKILL_JWT_DIR", undefined, async () => {
    await withEnv("SESSION_ID", "sess_env", async () => {
      await Promise.resolve();
      assertEquals(resolveOwningSessionId(), "sess_env");
    });
  });
});

test("resolveOwningSessionId - throws when neither source is available", async () => {
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

test("readSkillJwt - reads the per-session JWT file", async () => {
  const jwtDir = makeTempDirSync();
  const jwt = await createSkillJwt(TEST_SKILL_SECRET, {
    sub: "sess_ab12",
    channel: "discord/123",
    jti: "tok1",
  });
  await fsp.writeFile(`${jwtDir}/sess_ab12.jwt`, jwt + "\n");
  await withEnv("SKILL_JWT_DIR", jwtDir, async () => {
    await Promise.resolve();
    assertEquals(readSkillJwt("sess_ab12"), jwt);
  });
  await fsp.rm(jwtDir, { recursive: true });
});

// Pooled skill scripts run with the tool cwd chosen by OpenCode (the session
// workspace), NOT the bot process cwd. With an absolute SKILL_JWT_DIR the
// pointer + JWT lookups must succeed on the first attempt from ANY cwd. Runs in
// a subprocess so its cwd truly differs from the JWT directory's parent.
test("SKILL_JWT_DIR is cwd-independent (pointer + JWT from a foreign working directory)", async () => {
  const jwtDir = makeTempDirSync();
  const foreignCwd = makeTempDirSync();
  try {
    const sessionId = "sess_cwd_indep";
    const jwt = await createSkillJwt(TEST_SKILL_SECRET, {
      sub: sessionId,
      channel: "discord/123",
      jti: "tok1",
    });
    await fsp.writeFile(`${jwtDir}/active.json`, JSON.stringify({ sessionId }));
    await fsp.writeFile(`${jwtDir}/${sessionId}.jwt`, jwt + "\n");

    const clientPath = fileURLToPath(new URL("../../skills/lib/client.ts", import.meta.url));
    const script = `
import { resolveOwningSessionId, readSkillJwt } from ${JSON.stringify(clientPath)};
const owned = resolveOwningSessionId();
const jwt = readSkillJwt(owned);
console.log(JSON.stringify({ owned, jwt }));
`;
    const scriptPath = `${jwtDir}/probe.ts`;
    await fsp.writeFile(scriptPath, script);

    const baseEnv = { ...process.env };
    const env: Record<string, string> = {
      SKILL_SHARED_PROCESS: "1",
      SKILL_JWT_DIR: jwtDir,
      SESSION_ID: "sess_stale_env", // must be ignored: the pointer is authoritative
    };
    for (const k of ["PATH", "HOME", "XDG_CACHE_HOME"]) {
      if (baseEnv[k] !== undefined) env[k] = baseEnv[k];
    }

    const output = Bun.spawn([process.execPath, "run", scriptPath], {
      cwd: foreignCwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(output.stdout).text(),
      new Response(output.stderr).text(),
      output.exited,
    ]);
    assertEquals(
      code,
      0,
      `child failed: ${stdout}${stderr}`,
    );
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!) as {
      owned: string;
      jwt: string;
    };
    assertEquals(result.owned, sessionId);
    assertEquals(result.jwt, jwt);
  } finally {
    await fsp.rm(jwtDir, { recursive: true });
    await fsp.rm(foreignCwd, { recursive: true });
  }
});

test("callSkillApi - presents the per-session JWT end-to-end", async () => {
  const tempDir = await makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {});
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
    await fsp.mkdir(jwtDir, { recursive: true });
    const jwt = await createSkillJwt(TEST_SKILL_SECRET, {
      sub: sessionId,
      channel: "discord/456",
      jti: callerToken,
    });
    await fsp.writeFile(`${jwtDir}/${sessionId}.jwt`, jwt + "\n");
    // Write the active pointer (the pool writes it while the lease is held).
    await fsp.writeFile(`${jwtDir}/active.json`, JSON.stringify({ sessionId }));

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
    await fsp.rm(tempDir, { recursive: true });
  }
});
