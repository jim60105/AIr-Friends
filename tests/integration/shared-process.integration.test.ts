// tests/integration/shared-process.integration.test.ts
//
// Integration tests for the shared OpenCode ACP process pool (pinned
// OpenCode 1.18.21): verify that one long-lived agent process serves
// multiple sessions, and that killing the shared process mid-tool-call
// triggers controlled recovery (reconnect + session/load) without duplicate
// replies or memory events.
//
// The agent process is mocked: instead of spawning a real `opencode acp`
// subprocess, the tests spawn `tests/mocks/mock-acp-agent.ts` — a scripted
// ACP agent that speaks JSON-RPC over stdio and drives the bot's Skill API.
// No model tokens are spent. Tests are skipped when the `dumb-init` or
// `deno` binaries are not installed locally (the container bundles both).

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AgentProcessPool } from "../../src/core/agent-process-pool.ts";
import { AgentConnector } from "../../src/acp/agent-connector.ts";
import type { AgentConfig, AgentConnectorOptions } from "../../src/acp/types.ts";
import { createAgentConfig } from "../../src/acp/agent-factory.ts";
import { SkillAPIServer } from "../../src/skill-api/server.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { SkillRegistry } from "../../src/skills/registry.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { createLogger } from "../../src/utils/logger.ts";
import type { Config } from "../../src/types/config.ts";
import type { NormalizedEvent, Platform } from "../../src/types/events.ts";
import { PlatformAdapter } from "../../src/platforms/platform-adapter.ts";
import type {
  PlatformCapabilities,
  ReplyOptions,
  SendFileOptions,
  SendFilePayload,
} from "../../src/types/platform.ts";

/** Minimal in-memory platform adapter so the send-reply skill has a working target. */
class MockPlatformAdapter extends PlatformAdapter {
  readonly platform: Platform = "discord";
  readonly capabilities: PlatformCapabilities = {
    canFetchHistory: true,
    canSearchMessages: false,
    supportsDm: true,
    supportsGuild: true,
    supportsReactions: true,
    maxMessageLength: 2000,
  };
  determineSpontaneousTarget(_config: unknown) {
    return Promise.resolve(null);
  }
  connect() {
    return Promise.resolve();
  }
  disconnect() {
    return Promise.resolve();
  }
  sendTyping() {
    return Promise.resolve();
  }
  sendReply(
    _channelId: string,
    _content: string,
    _options?: ReplyOptions,
  ) {
    return Promise.resolve({ success: true, messageId: "mock-reply-1" });
  }
  fetchRecentMessages(_channelId: string, _limit: number) {
    return Promise.resolve([]);
  }
  fetchEmojis() {
    return Promise.resolve([]);
  }
  addReaction(_channelId: string, _messageId: string, _emoji: string) {
    return Promise.resolve({ success: true });
  }
  editMessage(
    _channelId: string,
    _messageId: string,
    _newContent: string,
    _replyToMessageId?: string,
  ) {
    return Promise.resolve({ success: true, messageId: "mock-reply-1" });
  }
  sendFile(_channelId: string, _files: SendFilePayload[], _options?: SendFileOptions) {
    return Promise.resolve({
      success: true,
      messageId: "mock-file-1",
      messageIds: ["mock-file-1"],
    });
  }
  getUsername(_userId: string) {
    return Promise.resolve("tester");
  }
  isSelf(_userId: string) {
    return false;
  }
  getBotId() {
    return null;
  }
  getDmChannelId(userId: string) {
    return Promise.resolve(`dm:${userId}`);
  }
  hasBotReaction(_channelId: string, _messageId: string) {
    return Promise.resolve(false);
  }
  hasBotMention(_channelId: string, _messageId: string) {
    return Promise.resolve(false);
  }
  fetchMessage(_channelId: string, _messageId: string) {
    return Promise.resolve(null);
  }
}

const TEST_SKILL_SECRET = "0123456789abcdef0123456789abcdef01"; // 36 bytes (>= 32)
const SKILL_API_PORT = 3001;
/** Model ID passed to the (mocked) agent's session/set_model. The mock
 * accepts any model ID, so this is purely for configuration fidelity; local
 * dev can override with a local provider via INTEGRATION_TEST_MODEL. */
const TEST_MODEL = Deno.env.get("INTEGRATION_TEST_MODEL") ?? "opencode/hy3-free";

async function binaryAvailable(name: string): Promise<boolean> {
  try {
    const res = await new Deno.Command("which", { args: [name] }).output();
    return res.code === 0;
  } catch {
    return false;
  }
}

function buildTestConfig(tempDir: string, jwtDir: string): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "test" },
      misskey: { enabled: false, host: "http://localhost", token: "test" },
    },
    agent: {
      defaultAgentType: "opencode",
      model: TEST_MODEL,
      sharedProcess: { enabled: true, jwtDir, reclaimIdleMs: 120_000 },
      idleTimeout: { enabled: true, timeoutMs: 300_000, checkIntervalMs: 10_000 },
    },
    memory: { searchLimit: 10, maxChars: 2000 },
    workspace: { repoPath: tempDir, workspacesDir: "workspaces" },
    logging: { level: "info" },
    replyPolicy: "channels",
    channels: [],
  } as unknown as Config;
}

/**
 * Wait until the process with the given PID has fully exited (polls `kill -0`).
 * Needed because `AgentConnector.disconnect()` only waits DISCONNECT_TIMEOUT_MS
 * (2s) for the process to exit — a still-flushing opencode process can otherwise
 * race the recursive remove of the temp dir ("Directory not empty").
 */
async function waitForProcessGone(pid: number, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Deno.Command("kill", { args: ["-0", String(pid)] }).output();
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      return true; // process no longer exists
    }
  }
  return false;
}

/** Kill an agent process tree: tool children -> opencode -> dumb-init root. */
async function killProcessTree(rootPid: number): Promise<void> {
  const childrenOut = await new Deno.Command("pgrep", { args: ["-P", String(rootPid)] }).output();
  const childPids = childrenOut.stdout
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((s) => parseInt(s.trim(), 10));
  for (const cpid of childPids) {
    // Kill the tool-call subprocesses (e.g. bash children of opencode).
    await new Deno.Command("pkill", { args: ["-9", "-P", String(cpid)] }).output();
    await new Deno.Command("kill", { args: ["-9", String(cpid)] }).output();
  }
  await new Deno.Command("kill", { args: ["-9", String(rootPid)] }).output();
}

/**
 * Prompt with bounded retry on provider quota/rate-limit errors (free-tier
 * keys, e.g. the 20-req/min Gemini free tier). Honors the provider's
 * "retry in Xs" hint when present.
 */
async function promptWithQuotaRetry(
  connector: AgentConnector,
  sessionId: string,
  promptText: string,
  maxAttempts = 3,
): Promise<{ stopReason: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await connector.prompt(sessionId, promptText);
    } catch (error) {
      const msg = error instanceof Error ? error.message : JSON.stringify(error);
      const isQuota = msg.includes("quota") || msg.includes("Quota");
      if (!isQuota || attempt === maxAttempts) throw error;
      const m = /retry in ([0-9.]+)s/.exec(msg ?? "");
      // Wait at least past the 60-second rate-limit window (or the provider's
      // "retry in" hint, whichever is longer) so the next attempt lands in a
      // fresh window.
      const hintMs = m ? parseFloat(m[1]) * 1000 : 5_000;
      const waitMs = Math.max(Math.min(hintMs, 120_000), 60_000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("unreachable");
}

/** Recursively remove a directory, retrying when a still-writing process races the removal. */
async function removeDirWithRetry(dir: string, attempts = 6): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await Deno.remove(dir, { recursive: true });
      return;
    } catch {
      if (attempt === attempts) {
        await Deno.remove(dir, { recursive: true });
      } else {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
}

/**
 * Swap the agent spawn (normally `opencode acp`) for the mock ACP agent so
 * integration tests run hermetically without spending model tokens. The
 * AgentConnector wraps the spawn with dumb-init, so the mock is launched as:
 *   dumb-init -- deno run --no-check --allow-env --allow-read --allow-write --allow-net <script>
 */
function useMockAgent(agentConfig: AgentConfig): void {
  const mockAgentScript = join(import.meta.dirname!, "../mocks/mock-acp-agent.ts");
  agentConfig.command = "deno";
  agentConfig.args = [
    "run",
    "--no-check",
    "--allow-env",
    "--allow-read",
    "--allow-write",
    "--allow-net",
    mockAgentScript,
  ];
}

Deno.test({
  name: "Integration: shared process is reused across pool-key sessions (OpenCode 1.18.21)",
  ignore: !(await binaryAvailable("dumb-init") && await binaryAvailable("deno")),
  sanitizeExit: false,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    const jwtDir = join(tempDir, "skill-jwt");
    await Deno.mkdir(jwtDir, { recursive: true });
    let pid1: number | undefined;
    let pid2: number | undefined;
    let server: SkillAPIServer | undefined;
    try {
      const config = buildTestConfig(tempDir, jwtDir);
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
      const logger = createLogger("IntegrationSharedProcess");

      // Skill API server so the agent's skill callbacks (memory-save, send-reply) work.
      server = new SkillAPIServer(
        sessionRegistry,
        skillRegistry,
        { port: SKILL_API_PORT, host: "127.0.0.1" },
        TEST_SKILL_SECRET,
      );
      server.start();
      await new Promise((r) => setTimeout(r, 200));

      const event = {
        platform: "discord",
        channelId: "discord/456",
        userId: "123",
        messageId: "msg-int-1",
        isDm: false,
        guildId: "",
        content: "hi",
        timestamp: new Date(),
      } satisfies NormalizedEvent;
      const workspace = await workspaceManager.getOrCreateWorkspace(event);

      const mockAdapter = new MockPlatformAdapter();
      const sessionId = sessionRegistry.register({
        platform: "discord",
        channelId: "discord/456",
        userId: "123",
        isDm: false,
        workspace,
        platformAdapter: mockAdapter,
        triggerEvent: event,
      });

      const poolKey = "discord:discord/456";
      const agentConfig = createAgentConfig(
        "opencode",
        workspace.path,
        config,
        false,
        join(tempDir, "agent-workspace"),
        sessionId,
        poolKey,
      );
      // Point the skill scripts at this test's Skill API instance, and expose the
      // mock agent's prompt-delay knob so the kill test's timing can be tuned.
      agentConfig.env = {
        ...agentConfig.env,
        SKILL_API_URL: `http://127.0.0.1:${SKILL_API_PORT}`,
        MOCK_PROMPT_DELAY_MS: Deno.env.get("INTEGRATION_TEST_MOCK_PROMPT_DELAY_MS") ?? "12000",
      };
      useMockAgent(agentConfig);
      const clientConfig = {
        workingDir: workspace.path,
        platform: "discord",
        userId: "123",
        channelId: "discord/456",
        isDM: false,
        yolo: false,
        sessionId,
        xdgDataHome: agentConfig.env?.["XDG_DATA_HOME"],
      };

      const spawned: AgentConnector[] = [];
      const pool = new AgentProcessPool(
        config,
        sessionRegistry,
        TEST_SKILL_SECRET,
        (options: AgentConnectorOptions) => {
          const connector = new AgentConnector(options);
          spawned.push(connector);
          return connector;
        },
        60_000,
      );

      let lastPid: number | undefined;
      const runSession = async (label: string) => {
        const result = await pool.run(
          {
            poolKey,
            sessionType: label,
            shellSessionId: sessionId,
            priority: "interactive",
            connectorOptions: {
              agentConfig,
              clientConfig,
              skillRegistry,
              logger,
              agentType: "opencode",
              idleTimeoutConfig: config.agent.idleTimeout,
            },
            sessionCwd: workspace.path,
          },
          async (connector) => {
            lastPid = connector.getProcessPid();
            const acpSessionId = await connector.createSession([], workspace.path);
            await connector.setSessionModel(acpSessionId, config.agent.model!);
            connector.getClient()?.setSessionCwd(acpSessionId, workspace.path);
            const response = await promptWithQuotaRetry(
              connector,
              acpSessionId,
              "Reply with the single word: ok",
            );
            assertEquals(response.stopReason, "end_turn");
            return acpSessionId;
          },
        );
        assertEquals(result.cancelledByDeadline, false, label);
        assert(result.acpSessionId !== null, label);
        return lastPid;
      };

      pid1 = await runSession("session-1");
      pid2 = await runSession("session-2");

      // One process must serve both sessions (lazy spawn + reuse, no respawn).
      assertEquals(spawned.length, 1, "shared process must be reused, not respawned");
      assert(pid1 !== undefined && pid1 === pid2, "same process PID across sessions");

      for (const connector of spawned) {
        await connector.disconnect();
      }
      pool.stop();
      sessionRegistry.stop();
      if (server) await server.stop();
    } finally {
      if (server) await server.stop();
      const procPid = pid2 ?? pid1;
      if (procPid !== undefined) {
        // Wait for the shared process to fully exit so the dying opencode
        // process cannot race the recursive remove of the temp dir.
        await waitForProcessGone(procPid);
      }
      await removeDirWithRetry(tempDir);
    }
  },
});

Deno.test({
  name: "Integration: killing the shared process mid-tool-call triggers controlled recovery",
  ignore: !(await binaryAvailable("dumb-init") && await binaryAvailable("deno")),
  sanitizeExit: false,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    const jwtDir = join(tempDir, "skill-jwt");
    await Deno.mkdir(jwtDir, { recursive: true });
    let finalPid: number | undefined;
    try {
      const config = buildTestConfig(tempDir, jwtDir);
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
      const logger = createLogger("IntegrationSharedProcess");

      // Skill API server so the agent's skill callbacks (memory-save, send-reply) work.
      const server = new SkillAPIServer(
        sessionRegistry,
        skillRegistry,
        { port: SKILL_API_PORT, host: "127.0.0.1" },
        TEST_SKILL_SECRET,
      );
      server.start();
      await new Promise((r) => setTimeout(r, 200));

      const event = {
        platform: "discord",
        channelId: "discord/456",
        userId: "123",
        messageId: "msg-int-2",
        isDm: false,
        guildId: "",
        content: "hi",
        timestamp: new Date(),
      } satisfies NormalizedEvent;
      const workspace = await workspaceManager.getOrCreateWorkspace(event);

      const mockAdapter = new MockPlatformAdapter();
      const sessionId = sessionRegistry.register({
        platform: "discord",
        channelId: "discord/456",
        userId: "123",
        isDm: false,
        workspace,
        platformAdapter: mockAdapter,
        triggerEvent: event,
      });

      const poolKey = "discord:discord/456";
      const agentConfig = createAgentConfig(
        "opencode",
        workspace.path,
        config,
        false,
        join(tempDir, "agent-workspace"),
        sessionId,
        poolKey,
      );
      // Point the skill scripts at this test's Skill API instance, and expose the
      // mock agent's prompt-delay knob so the kill test's timing can be tuned.
      agentConfig.env = {
        ...agentConfig.env,
        SKILL_API_URL: `http://127.0.0.1:${SKILL_API_PORT}`,
        MOCK_PROMPT_DELAY_MS: Deno.env.get("INTEGRATION_TEST_MOCK_PROMPT_DELAY_MS") ?? "12000",
      };
      useMockAgent(agentConfig);
      const clientConfig = {
        workingDir: workspace.path,
        platform: "discord",
        userId: "123",
        channelId: "discord/456",
        isDM: false,
        yolo: false,
        sessionId,
        xdgDataHome: agentConfig.env?.["XDG_DATA_HOME"],
      };

      const spawned: AgentConnector[] = [];
      const pool = new AgentProcessPool(
        config,
        sessionRegistry,
        TEST_SKILL_SECRET,
        (options: AgentConnectorOptions) => {
          const connector = new AgentConnector(options);
          spawned.push(connector);
          return connector;
        },
        60_000,
      );

      let killedPid: number | undefined;
      let acpSessionIdRef: string | undefined;

      const runPromise = pool.run(
        {
          poolKey,
          sessionType: "message",
          shellSessionId: sessionId,
          priority: "interactive",
          connectorOptions: {
            agentConfig,
            clientConfig,
            skillRegistry,
            logger,
            agentType: "opencode",
            idleTimeoutConfig: config.agent.idleTimeout,
          },
          sessionCwd: workspace.path,
        },
        async (connector, options) => {
          killedPid = connector.getProcessPid();

          const acpSessionId = await connector.createSession([], options.sessionCwd);
          acpSessionIdRef = acpSessionId;
          await connector.setSessionModel(acpSessionId, config.agent.model!);
          connector.getClient()?.setSessionCwd(acpSessionId, options.sessionCwd);

          const prompt = [
            "Task (keep it concise; use each tool/skill exactly once):",
            "1. Run `ls` using the bash tool.",
            "2. Invoke the `skill` tool with skill name `memory-save`, then run its script via the bash tool to save the fact 'integration recovery fact' (visibility: public).",
            "3. Invoke the `skill` tool with skill name `send-reply`, then run its script via the bash tool to send the reply 'done'.",
          ].join("\n");

          try {
            const response = await promptWithQuotaRetry(connector, acpSessionId, prompt);
            assertEquals(response.stopReason, "end_turn");
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            const isProcessExit = msg.includes("ACP connection dead") ||
              msg.includes("ACP agent process exited unexpectedly") ||
              msg.includes("Agent process exited unexpectedly");
            if (!isProcessExit) throw error;

            // Controlled recovery: reconnect the pool-key process and resume the
            // SAME session via session/load. Re-issue the prompt ONLY when no
            // response (reply/reaction/file) was recorded yet — the bot-side
            // registry state survives the process restart.
            const resumed = await connector.reconnectAndResumeSession(
              acpSessionId,
              options.sessionCwd,
              [],
            );
            assert(resumed, "session/load must succeed on the respawned process");
            const replySent = skillRegistry.getReplyHandler().hasReplySent(
              workspace.key,
              "discord/456",
            );
            const reactionSent = skillRegistry.getReactionHandler().hasReactionSent(
              workspace.key,
              "discord/456",
            );
            const fileSent = sessionRegistry.hasFileSent(sessionId);
            if (!replySent && !reactionSent && !fileSent) {
              const response = await promptWithQuotaRetry(connector, acpSessionId, prompt);
              assertEquals(response.stopReason, "end_turn");
            }
          }
          return acpSessionId;
        },
      );

      // Wait for the shared process to spawn.
      const spawnDeadline = Date.now() + 30_000;
      while (killedPid === undefined && Date.now() < spawnDeadline) {
        await new Promise((r) => setTimeout(r, 500));
      }
      assert(killedPid !== undefined, "shared process must have spawned");
      const originalPid = killedPid;

      // Kill the process tree while the mock agent is mid-prompt (the mock holds
      // the prompt open for MOCK_PROMPT_DELAY_MS, default 12s; the kill lands 2s
      // into that window), then the pool respawn + session/load path runs.
      const mockDelayMs = parseInt(
        Deno.env.get("INTEGRATION_TEST_MOCK_PROMPT_DELAY_MS") ?? "12000",
        10,
      );
      await new Promise((r) => setTimeout(r, Math.max(1000, mockDelayMs - 2000)));
      await killProcessTree(originalPid);

      const result = await runPromise;
      assertEquals(
        result.cancelledByDeadline,
        false,
        "killed session recovered, not deadline-cancelled",
      );
      assert(result.acpSessionId !== null, "session resumed via session/load");
      assert(
        acpSessionIdRef !== undefined && result.acpSessionId === acpSessionIdRef,
        "same ACP session resumed",
      );

      // The process was respawned: a new connector with a new PID.
      const lastConnector = spawned[spawned.length - 1];
      const newPid = lastConnector.getProcessPid();
      finalPid = newPid;
      assert(newPid !== undefined && newPid !== originalPid, "respawned process has a new PID");

      // No duplicate side effects (state lives in the bot process, surviving the restart).
      const replyHandler = skillRegistry.getReplyHandler();
      assertEquals(
        replyHandler.hasReplySent(workspace.key, "discord/456"),
        true,
        "exactly one reply sent",
      );
      const memoryFile = join(workspace.path, "memory.public.jsonl");
      const lines = (await Deno.readTextFile(memoryFile)).trim().split("\n").filter(Boolean);
      assertEquals(lines.length, 1, "exactly one memory event (no duplicates)");

      for (const connector of spawned) {
        await connector.disconnect();
      }
      await server.stop();
      pool.stop();
      sessionRegistry.stop();
    } finally {
      if (finalPid !== undefined) {
        // Wait for the respawned process to fully exit so a still-flushing
        // opencode process cannot race the recursive remove of the temp dir.
        await waitForProcessGone(finalPid);
      }
      await removeDirWithRetry(tempDir);
    }
  },
});
