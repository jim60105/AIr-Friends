// tests/skills/end-to-end-delivery.test.ts
//
// End-to-end mocked delivery (make-skill-staging-agent-portable, design §14
// reply-flow row): the REAL send-reply script (payload-file contract) against
// the REAL Skill API server + reply handling (SessionRegistry reply state +
// mock platform adapter), in BOTH spawn shapes:
//   - per-spawn env: SESSION_ID set, no shared-process marker;
//   - pooled env: SKILL_SHARED_PROCESS=1 + valid active.json pointer +
//     SKILL_JWT_DIR and NO SESSION_ID environment variable.
// In both the agent writes the payload to the prompt-rendered ABSOLUTE
// staging path and invokes the script with the literal session id; exactly
// one intended reply reaches the platform — no duplicate retry/fallback
// delivery, no duplicate reply accounting.

import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { SkillAPIServer } from "../../src/skill-api/server.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { SkillRegistry } from "../../src/skills/registry.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { createSkillJwt } from "../../src/utils/skill-jwt.ts";
import { sessionStagingDir } from "../../src/core/session-staging.ts";
import type { PlatformAdapter } from "../../src/platforms/platform-adapter.ts";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";
import { fileURLToPath } from "node:url";

const TEST_SKILL_SECRET = "0123456789abcdef0123456789abcdef01"; // 36 bytes (>= 32)
const SCRIPT_PATH = fileURLToPath(
  new URL("../../skills/send-reply/scripts/send-reply.ts", import.meta.url),
);

// Integration exception to the no-test-timers guideline: SkillAPIServer wraps
// a real Bun.serve bind, so readiness is awaited by polling the real socket
// (deterministic time control cannot observe an OS-level listen).
async function waitForServer(port: number, deadlineMs = 5000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/api/skill/probe`);
      await response.body?.cancel();
      return; // any HTTP answer (even 404) proves the socket is live
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("skill API server did not come up");
}

async function runShape(opts: { label: string; shared: boolean; port: number }): Promise<void> {
  const tempDir = await makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {});
    const skillRegistry = new SkillRegistry(memoryStore);

    const deliveries: string[] = [];
    // The delivery path only calls sendReply; unchecked cast because the full
    // PlatformAdapter surface is unimplemented for this single-method mock.
    const mockAdapter = {
      sendReply: (_channelId: string, message: string) => {
        deliveries.push(message);
        return Promise.resolve({ success: true, messageId: `msg_${deliveries.length}` });
      },
    } as unknown as PlatformAdapter;

    const workspace = {
      key: "discord/123",
      components: { platform: "discord" as const, userId: "123" },
      path: tempDir,
      tmpPath: join(tempDir, "tmp"),
      isDm: false,
    };

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "chan_1",
      userId: "123",
      isDm: false,
      workspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "chan_1",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "trigger",
        timestamp: new Date(),
      },
    });

    // The prompt-rendered absolute staging dir (helper = what every payload-
    // staging render now supplies as `{{ tmpDir }}`).
    const stagingDir = sessionStagingDir(workspace, sessionId);
    fs.mkdirSync(stagingDir, { recursive: true });

    // JWT material: per-session token file (both shapes present it; the pool
    // writes it at lease acquisition).
    const jwtDir = join(tempDir, "jwt");
    fs.mkdirSync(jwtDir, { mode: 0o700 });
    const callerToken = sessionRegistry.getCallerToken(sessionId) ?? "";
    const jwt = await createSkillJwt(TEST_SKILL_SECRET, {
      sub: sessionId,
      channel: "chan_1",
      jti: callerToken,
    });
    fs.writeFileSync(join(jwtDir, `${sessionId}.jwt`), jwt);

    const server = new SkillAPIServer(
      sessionRegistry,
      skillRegistry,
      { port: opts.port, host: "127.0.0.1" },
      TEST_SKILL_SECRET,
    );
    server.start();
    await waitForServer(opts.port);

    // The agent writes the payload to the prompt-rendered absolute path...
    const payloadFile = join(stagingDir, "reply.md");
    fs.writeFileSync(payloadFile, "造好的回复 $HOME 內容 verbatim\n第二行");

    // ...then invokes the script with the literal session id + absolute path.
    const env: Record<string, string> = {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "/tmp",
      SKILL_JWT_DIR: jwtDir,
    };
    if (opts.shared) {
      // Pooled process: pointer is the sole identity source; NO SESSION_ID.
      env.SKILL_SHARED_PROCESS = "1";
      fs.writeFileSync(
        join(jwtDir, "active.json"),
        JSON.stringify({ sessionId, staging: workspace.tmpPath }),
      );
    } else {
      // Per-spawn: SESSION_ID is set (the legacy carrier) — still literal-first.
      env.SESSION_ID = sessionId;
    }

    const run = Bun.spawn([
      SCRIPT_PATH,
      "--session-id",
      sessionId, // literal rendered in the prompt
      "--api-url",
      `http://localhost:${opts.port}`,
      "--message-file",
      payloadFile, // absolute staging path rendered in the prompt
    ], {
      cwd: tempDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
      run.exited,
    ]);
    assertEquals(code, 0, `${opts.label}: script failed: ${stdout}${stderr}`);

    // Exactly one intended reply reached the mock platform.
    assertEquals(deliveries.length, 1, `${opts.label}: exactly one platform delivery`);
    assertEquals(deliveries[0], "造好的回复 $HOME 內容 verbatim\n第二行");

    // Reply state recorded once — no duplicate retry/fallback accounting.
    assertEquals(sessionRegistry.hasReplySent(sessionId), true, opts.label);
    assertEquals(sessionRegistry.getReplyCount(sessionId), 1, opts.label);

    // The payload file was consumed.
    let consumed = false;
    try {
      fs.statSync(payloadFile);
    } catch {
      consumed = true;
    }
    assertEquals(consumed, true, `${opts.label}: payload consumed`);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
}

test("e2e delivery - per-spawn env: literal staging path -> send-reply -> exactly one reply", async () => {
  await runShape({ label: "per-spawn", shared: false, port: 3181 });
});

test("e2e delivery - pooled env: no SESSION_ID, pointer + literals -> exactly one reply", async () => {
  await runShape({ label: "pooled", shared: true, port: 3182 });
});
