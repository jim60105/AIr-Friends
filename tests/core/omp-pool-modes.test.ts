import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { SessionOrchestrator } from "@core/session-orchestrator.ts";
import { AgentProcessPool, type PoolRunOptions } from "@core/agent-process-pool.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { ContextAssembler } from "@core/context-assembler.ts";
import { ReplyPolicyEvaluator } from "@core/reply-policy.ts";
import { ReminderStore } from "@core/reminder-store.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import type { AgentConnector } from "../../src/acp/agent-connector.ts";
import type { AgentConnectorOptions } from "../../src/acp/types.ts";
import type { Config } from "../../src/types/config.ts";
import type { NormalizedEvent } from "../../src/types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { SessionAuditEntry } from "../../src/types/audit.ts";
import { createAgentConfig } from "../../src/acp/agent-factory.ts";
import { ompAgentDir, ompLaunchCwd, ompProcessTmpDir, ompXdgDataHome } from "@utils/omp-paths.ts";

/** Offline asset fixture only: never imported or executed by a real agent. */
async function withExtensionFixture(run: () => Promise<void>): Promise<void> {
  const path = "src/acp/omp/extension/index.ts";
  let created = false;
  try {
    await Deno.stat(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    await Deno.mkdir("src/acp/omp/extension", { recursive: true });
    await Deno.writeTextFile(
      path,
      "// Offline acquisition test asset; not executable runtime policy.\n",
    );
    created = true;
  }
  try {
    await run();
  } finally {
    if (created) await Deno.remove(path);
  }
}

Deno.test("OMP acquisition matrix: entry points, resolved modes, ownership, audit and summary", async (t) => {
  await withExtensionFixture(async () => {
    for (const agentType of ["omp", "opencode"] as const) {
      for (const pooled of [false, true]) {
        for (const skillEnabled of [false, true]) {
          for (const decision of ["default", "global", "channel", "account"] as const) {
            for (
              const entry of [
                "message",
                "lurk",
                "spontaneous",
                "research",
                "memory",
                "channel-memory",
                "reminder",
              ] as const
            ) {
              await t.step(
                `${agentType}/${pooled ? "pool" : "spawn"}/${
                  skillEnabled ? "skills" : "internal"
                }/${decision}/${entry}`,
                async () => {
                  const root = await Deno.makeTempDir();
                  const registry = new SessionRegistry();
                  let pool: AgentProcessPool | null = null;
                  try {
                    const promptDir = join(root, "prompts");
                    await Deno.mkdir(promptDir);
                    for (
                      const name of [
                        "reply",
                        "spontaneous",
                        "self_research",
                        "memory_maintenance",
                        "reminder",
                        "summary",
                      ]
                    ) {
                      await Deno.writeTextFile(
                        join(promptDir, `system_${name}.md`),
                        `${
                          name === "summary" ? "SUMMARY" : "TURN {{ yolo }}"
                        }\nID={{ sessionId }}\nTMP={{ tmpDir }}`,
                      );
                    }
                    const config: Config = {
                      platforms: {
                        discord: { enabled: true, token: "mock" },
                        misskey: { enabled: false, host: "", token: "" },
                      },
                      agent: {
                        defaultAgentType: agentType,
                        model: "test",
                        tokenLimit: 20000,
                        systemPromptPath: join(promptDir, "system_reply.md"),
                        idleTimeout: { enabled: false, timeoutMs: 300000, checkIntervalMs: 30000 },
                        sharedProcess: {
                          enabled: pooled,
                          jwtDir: join(root, "jwt"),
                          queueDeadlineMs: 10000,
                        },
                      },
                      memory: { recentMessageLimit: 10, workingTierLimit: 10 },
                      workspace: { repoPath: root, workspacesDir: "workspaces" },
                      logging: { level: "FATAL" },
                      replyPolicy: "channels",
                      channels: decision === "channel"
                        ? [{ id: "discord/channel/channel", yolo: true }]
                        : decision === "account"
                        ? [{ id: "discord/account/user", yolo: true }, {
                          id: "discord/account/bot",
                          yolo: true,
                        }]
                        : [],
                      skillApi: { enabled: skillEnabled, host: "127.0.0.1", port: 3999 },
                      audit: {
                        enabled: true,
                        retentionDays: 7,
                        hashContent: true,
                        includedPhases: [],
                      },
                      conversationSummary: { enabled: entry === "message" || entry === "lurk" },
                    };
                    const wm = new WorkspaceManager(config.workspace);
                    const memory = new MemoryStore(wm, {});
                    const skills = new SkillRegistry(memory);
                    const assembler = new ContextAssembler(memory, {
                      systemPromptPath: config.agent.systemPromptPath,
                      recentMessageLimit: 10,
                      tokenLimit: 20000,
                    });
                    const order: string[] = [];
                    let sessionId = "";
                    const register = registry.register.bind(registry);
                    registry.register = (options) => {
                      sessionId = register(options);
                      return sessionId;
                    };
                    const expectedMode = decision === "global" ||
                        ((decision === "channel" || decision === "account") &&
                          !["research", "memory", "channel-memory"].includes(entry))
                      ? "native-yolo"
                      : "restricted";
                    const usesPool = pooled && entry !== "channel-memory" && entry !== "reminder";
                    const expectedOwnershipMode = agentType === "opencode" && usesPool
                      ? "yolo-switch"
                      : expectedMode;
                    let snapshot: {
                      permissionMode: string | undefined;
                      processNamespace: string | undefined;
                    } | undefined;
                    let acquiredOptions: AgentConnectorOptions | undefined;
                    let spawns = 0;
                    let acquisitions = 0;
                    let prompts = 0;
                    let creates = 0;
                    const checkOwnership = () => {
                      const session = registry.get(sessionId);
                      assertExists(session);
                      assertEquals(session.permissionMode, expectedOwnershipMode);
                      assertExists(acquiredOptions);
                      const namespace = agentType === "omp"
                        ? acquiredOptions.agentConfig.env?.PI_CODING_AGENT_DIR
                        : acquiredOptions.agentConfig.env?.XDG_DATA_HOME;
                      assertEquals(
                        session.processNamespace,
                        namespace ?? acquiredOptions.agentConfig.cwd,
                      );
                      const value = {
                        permissionMode: session.permissionMode,
                        processNamespace: session.processNamespace,
                      };
                      if (snapshot) assertEquals(value, snapshot);
                      else snapshot = value;
                      return session;
                    };
                    const makeConnector = (options: AgentConnectorOptions): AgentConnector => {
                      spawns++;
                      acquiredOptions = options;
                      order.push("spawn");
                      assert(
                        order.includes("resolve"),
                        "mode must be resolved before spawn configuration reaches connector",
                      );
                      assertEquals(options.clientConfig?.yolo, expectedMode === "native-yolo");
                      if (agentType === "omp") {
                        assert(
                          options.agentConfig.env?.PI_CODING_AGENT_DIR?.endsWith(
                            `/omp-agent/${expectedMode}`,
                          ),
                        );
                      }
                      assertEquals(
                        options.agentConfig.env?.SESSION_ID,
                        skillEnabled && !usesPool ? sessionId : undefined,
                      );
                      if (usesPool) {
                        assertEquals(options.agentConfig.env?.SKILL_SHARED_PROCESS, "1");
                      }
                      return {
                        isConnected: true,
                        connect: () => Promise.resolve(),
                        disconnect: () => Promise.resolve(),
                        getProcessPid: () => undefined,
                        createSession: () => {
                          creates++;
                          checkOwnership();
                          return Promise.resolve("acp-id");
                        },
                        setSessionModel: () => Promise.resolve(),
                        setSessionMode: () => Promise.resolve(),
                        setReasoningEffort: () => Promise.resolve("applied"),
                        setSessionGateContext: () => {},
                        supportsImageContent: () => false,
                        getClient: () => null,
                        prompt: async (_id: string, text: string) => {
                          assertEquals(_id, "acp-id");
                          const session = checkOwnership();
                          if (!skillEnabled) {
                            assert(
                              !text.includes(sessionId),
                              "Internal ID must not enter agent prompts",
                            );
                          }
                          const staging = text.match(/^TMP=(.+)$/m)?.[1];
                          if (staging) {
                            assert(
                              (await Deno.stat(staging)).isDirectory,
                              "Advertised staging directory must exist",
                            );
                            if (!skillEnabled) assertEquals(staging, session.workspace.tmpPath);
                          }
                          prompts++;
                          if (text.startsWith("SUMMARY")) {
                            assertEquals(creates, 1);
                            assertEquals(acquisitions, usesPool ? 1 : 0);
                            if (usesPool) {
                              assertEquals(
                                pool!.isIdle(),
                                false,
                                "summary retains execution lease",
                              );
                            }
                          } else {
                            const handler = skills.getReplyHandler() as unknown as {
                              replySentMap: Map<string, boolean>;
                            };
                            handler.replySentMap.set(
                              `${session.workspace.key}:${session.channelId}`,
                              true,
                            );
                          }
                          return Promise.resolve({ stopReason: "end_turn" });
                        },
                        cancel: () => Promise.resolve(),
                      } as unknown as AgentConnector;
                    };
                    if (pooled) {
                      // Both empty and valid secrets must remain unused when API is disabled.
                      pool = new AgentProcessPool(
                        config,
                        registry,
                        decision === "default" && !skillEnabled
                          ? ""
                          : "offline-secret-0123456789abcdef0123456789",
                        makeConnector,
                      );
                      const run = pool.run.bind(pool);
                      pool.run = (options: PoolRunOptions, runner) => {
                        acquisitions++;
                        assert(order.includes("resolve"));
                        assertEquals(options.permissionMode, expectedMode);
                        assertEquals(options.agentType, agentType);
                        assertEquals(options.shellSessionId, skillEnabled ? sessionId : null);
                        assertEquals(options.registrySessionId, sessionId);
                        return run(options, runner);
                      };
                    }
                    class Orchestrator extends SessionOrchestrator {
                      protected override createConnector(options: AgentConnectorOptions) {
                        return makeConnector(options);
                      }
                    }
                    const policy = new ReplyPolicyEvaluator(config.replyPolicy, config.channels);
                    const orchestrator = new Orchestrator(
                      wm,
                      assembler,
                      skills,
                      config,
                      registry,
                      memory,
                      decision === "global",
                      policy,
                      skillEnabled ? "offline-secret-0123456789abcdef0123456789" : "",
                      pool,
                    );
                    // Observe the decision source for scheduler and user-context resolution.
                    Object.defineProperty(orchestrator, "yolo", {
                      get: () => {
                        order.push("resolve");
                        return decision === "global";
                      },
                    });
                    const adapter = {
                      platform: "discord",
                      capabilities: {
                        supportsDm: true,
                        canFetchHistory: true,
                        supportsGuild: true,
                        supportsReactions: false,
                        maxMessageLength: 2000,
                      },
                      fetchRecentMessages: () =>
                        Promise.resolve(
                          entry === "lurk"
                            ? [{
                              messageId: "msg",
                              userId: "user",
                              content: "hello",
                              timestamp: new Date(),
                            }]
                            : [],
                        ),
                      hasBotMention: () => Promise.resolve(false),
                      hasBotReaction: () => Promise.resolve(false),
                      getUsername: () => Promise.resolve("user"),
                      getDmChannelId: () => Promise.resolve("channel"),
                      isSelf: () => false,
                      supportsTypingIndicator: () => false,
                    } as unknown as PlatformAdapter;
                    const event: NormalizedEvent = {
                      platform: "discord",
                      channelId: "channel",
                      userId: "user",
                      messageId: "msg",
                      isDm: false,
                      guildId: "guild",
                      content: "hello",
                      timestamp: new Date(),
                    };
                    const maintenance = {
                      enabled: true,
                      model: "test",
                      minMemoryCount: 1,
                      intervalMs: 1000,
                    };
                    let response;
                    switch (entry) {
                      case "message":
                        response = await orchestrator.processMessage(event, adapter);
                        break;
                      case "lurk":
                        response = await orchestrator.processChannelLurkMessage(event, adapter);
                        break;
                      case "spontaneous":
                        response = await orchestrator.processSpontaneousPost(
                          "discord",
                          "channel",
                          adapter,
                          { botId: "bot", fetchRecentMessages: false },
                        );
                        break;
                      case "research":
                        response = await orchestrator.processSelfResearch([{
                          title: "Test",
                          url: "https://example.com",
                          description: "test",
                          sourceName: "test",
                        }], {
                          enabled: true,
                          model: "test",
                          rssFeeds: [],
                          minIntervalMs: 1000,
                          maxIntervalMs: 2000,
                          verifyCompletion: false,
                        });
                        break;
                      case "memory":
                        response = await orchestrator.processMemoryMaintenance(
                          "discord/user",
                          maintenance,
                        );
                        break;
                      case "channel-memory":
                        response = await orchestrator.processChannelMemoryMaintenance(
                          "discord/channel",
                          await wm.getOrCreateChannelWorkspace("discord", "channel"),
                          maintenance,
                        );
                        break;
                      case "reminder":
                        response = await orchestrator.processReminder(
                          {
                            id: "rem",
                            createdAt: new Date().toISOString(),
                            scheduledAt: new Date().toISOString(),
                            message: "hello",
                            platform: "discord",
                            userId: "user",
                            enabled: true,
                          },
                          adapter,
                          new ReminderStore("reminders.jsonl"),
                        );
                        break;
                    }
                    assertEquals(response.success, true, response.error);
                    assertEquals(spawns, 1);
                    assertEquals(creates, 1);
                    assertEquals(acquisitions, usesPool ? 1 : 0);
                    assertEquals(prompts, entry === "message" || entry === "lurk" ? 2 : 1);
                    assertExists(snapshot);
                    assertEquals(
                      registry.get(sessionId),
                      undefined,
                      "internal ownership is removed on exit",
                    );
                    if (!skillEnabled) {
                      assertEquals(
                        await exists(join(root, "jwt")),
                        false,
                        "disabled API writes neither JWT nor active pointer",
                      );
                    }
                    const userId = entry === "research"
                      ? "self-research"
                      : entry === "channel-memory"
                      ? "channel-maintenance"
                      : entry === "spontaneous"
                      ? "bot"
                      : "user";
                    const audit = (await Deno.readTextFile(
                      join(root, "audit", "discord", userId, `${sessionId}.jsonl`),
                    )).trim().split("\n").map((line) => JSON.parse(line) as SessionAuditEntry);
                    const acquired = audit.filter((item) => item.phase === "process_acquired");
                    assertEquals(acquired.length, 1);
                    assertEquals(acquired[0].data, {
                      sessionId,
                      agentType,
                      permissionMode: snapshot.permissionMode,
                      processNamespace: snapshot.processNamespace,
                      pooled: usesPool,
                    });
                  } finally {
                    if (pool) {
                      while (!pool.isIdle()) await new Promise((r) => setTimeout(r, 5));
                      pool.stop();
                    }
                    registry.stop();
                    await Deno.remove(root, { recursive: true });
                  }
                },
              );
            }
          }
        }
      }
    }
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

Deno.test("Factory-backed pooled namespaces, skill identity and same-mode reuse", async () => {
  await withExtensionFixture(async () => {
    const root = await Deno.makeTempDir();
    const registry = new SessionRegistry();
    let pool: AgentProcessPool | undefined;
    try {
      const config: Config = {
        platforms: {
          discord: { enabled: false, token: "" },
          misskey: { enabled: false, host: "", token: "" },
        },
        agent: {
          model: "test",
          tokenLimit: 10000,
          systemPromptPath: "prompts/system_reply.md",
          sharedProcess: { enabled: true, jwtDir: join(root, "jwt") },
        },
        memory: { recentMessageLimit: 10, workingTierLimit: 10 },
        workspace: { repoPath: root, workspacesDir: "workspaces" },
        logging: { level: "FATAL" },
        replyPolicy: "channels",
        channels: [],
      };
      const spawned: AgentConnectorOptions[] = [];
      const identities: AgentConnector[] = [];
      pool = new AgentProcessPool(config, registry, "", (options) => {
        spawned.push(options);
        return {
          isConnected: true,
          connect: () => Promise.resolve(),
          disconnect: () => Promise.resolve(),
          getProcessPid: () => undefined,
        } as unknown as AgentConnector;
      });
      for (const agentType of ["omp", "opencode"] as const) {
        for (const mode of ["restricted", "restricted", "native-yolo"] as const) {
          const poolKey = `${agentType}:channel`;
          const agentConfig = createAgentConfig(
            agentType,
            join(root, "workspace"),
            config,
            mode === "native-yolo",
            undefined,
            "must-not-freeze",
            poolKey,
          );
          const result = await pool.run({
            poolKey,
            agentType,
            permissionMode: mode,
            sessionType: "message",
            shellSessionId: null,
            priority: "interactive",
            sessionCwd: join(root, "workspace"),
            connectorOptions: {
              agentConfig,
              clientConfig: {
                workingDir: root,
                platform: "discord",
                userId: "user",
                channelId: "channel",
                isDM: false,
              },
              skillRegistry: {},
              logger: {},
            },
          }, (connector) => {
            identities.push(connector);
            return Promise.resolve("acp");
          });
          assertEquals(result.acpSessionId, "acp");
          assertEquals(agentConfig.env?.SKILL_SHARED_PROCESS, "1");
          assertEquals(agentConfig.env?.SESSION_ID, undefined);
          if (agentType === "omp") {
            const base = join(root, "omp-pools", poolKey);
            assertEquals(agentConfig.env?.PI_CODING_AGENT_DIR, ompAgentDir(base, mode));
            assertEquals(agentConfig.env?.TMPDIR, ompProcessTmpDir(base, mode));
            assertEquals(agentConfig.env?.XDG_DATA_HOME, ompXdgDataHome(base, mode));
            assertEquals(agentConfig.cwd, ompLaunchCwd(base, mode));
          } else {
            assertEquals(agentConfig.env?.TMPDIR, join(root, "channel-tmp", poolKey));
            assertEquals(agentConfig.env?.XDG_DATA_HOME, join(root, "opencode-data", poolKey));
            assertEquals(agentConfig.cwd, join(root, "channel-cwd", poolKey));
          }
          for (
            const path of [agentConfig.cwd, agentConfig.env!.TMPDIR, agentConfig.env!.XDG_DATA_HOME]
          ) assert((await Deno.stat(path)).isDirectory);
        }
      }
      assertEquals(spawned.length, 3);
      assertEquals(identities[0], identities[1]);
      assert(identities[0] !== identities[2]);
      assertEquals(identities[3], identities[4]);
      assertEquals(identities[3], identities[5]);
      assert(
        spawned[0].agentConfig.env!.PI_CODING_AGENT_DIR !==
          spawned[1].agentConfig.env!.PI_CODING_AGENT_DIR,
      );
      const perSpawn = ["restricted", "native-yolo"].map((mode) =>
        createAgentConfig("omp", join(root, "workspace"), config, mode === "native-yolo")
      );
      assert(perSpawn[0].env!.PI_CODING_AGENT_DIR !== perSpawn[1].env!.PI_CODING_AGENT_DIR);
    } finally {
      if (pool) {
        // The release path includes asynchronous filesystem I/O; yield to its completion.
        while (!pool.isIdle()) await new Promise((r) => setTimeout(r, 5));
        pool.stop();
      }
      registry.stop();
      await Deno.remove(root, { recursive: true });
    }
  });
});
