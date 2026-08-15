// src/bootstrap.ts

import { loadConfig } from "@core/config-loader.ts";
import type { Config } from "./types/config.ts";
import { verifyOpenCodeVersion } from "@utils/opencode-version.ts";
import { AgentCore } from "@core/agent-core.ts";
import { SpontaneousScheduler } from "@core/spontaneous-scheduler.ts";
import { ChannelLurkScheduler } from "@core/channel-lurk-scheduler.ts";
import { extractChannelLurkIds } from "@platforms/discord/index.ts";
import { SelfResearchScheduler } from "@core/self-research-scheduler.ts";
import { MemoryMaintenanceScheduler } from "@core/memory-maintenance-scheduler.ts";
import { ReminderScheduler } from "@core/reminder-scheduler.ts";
import { GitBackupScheduler } from "@core/git-backup-scheduler.ts";
import { GitBackupService } from "@core/git-backup-service.ts";
import { fetchRssItems, pickRandom } from "@utils/rss-fetcher.ts";
import { getPlatformRegistry } from "@platforms/platform-registry.ts";
import { DiscordAdapter } from "@platforms/discord/index.ts";
import { MisskeyAdapter } from "@platforms/misskey/index.ts";
import { HealthCheckServer } from "./healthcheck.ts";
import { configureLogger, createLogger } from "@utils/logger.ts";
import { GelfTransport } from "@utils/gelf-transport.ts";
import { cleanupAuditLogs } from "@core/audit-retention.ts";
import { AuditRetentionScheduler } from "@core/audit-retention-scheduler.ts";
import { installExternalSkills } from "@core/skill-installer.ts";
import { SchedulerStateStore } from "@core/scheduler-state-store.ts";
import { join } from "@std/path";
import type { Platform } from "./types/events.ts";
import { isValidPlatform } from "./types/events.ts";
import { DashboardServer } from "./dashboard/server.ts";
import { CompletedSessionStore } from "./dashboard/completed-session-store.ts";
import { metricsRegistry } from "@utils/metrics.ts";
import { configureEgressAllowHosts, ensureEgressProxy } from "@utils/egress-proxy.ts";
import { canConfineFilesystem, canIsolateNetwork } from "@acp/sandbox-capabilities.ts";

const logger = createLogger("Bootstrap");

/**
 * Application context containing all initialized components
 */
export interface AppContext {
  config: Config;
  agentCore: AgentCore;
  platformRegistry: ReturnType<typeof getPlatformRegistry>;
  healthCheckServer: HealthCheckServer | null;
  spontaneousScheduler: SpontaneousScheduler | null;
  channelLurkScheduler: ChannelLurkScheduler | null;
  selfResearchScheduler: SelfResearchScheduler | null;
  memoryMaintenanceScheduler: MemoryMaintenanceScheduler | null;
  gitBackupScheduler: GitBackupScheduler | null;
  gitBackupService: GitBackupService | null;
  reminderScheduler: ReminderScheduler | null;
  auditRetentionScheduler: AuditRetentionScheduler | null;
  schedulerStateStore: SchedulerStateStore | null;
  savedSchedulerState: Record<string, string>;
  gelfTransport: GelfTransport | null;
  yolo: boolean;
  dashboardServer: DashboardServer | null;
  completedSessionStore: CompletedSessionStore | null;
}

/**
 * Bootstrap the application
 */
export async function bootstrap(
  configPath?: string,
  yolo = false,
  dryRun = false,
): Promise<AppContext> {
  logger.info("Starting bootstrap", { yolo, dryRun });

  // Load configuration
  const configFile = configPath ?? "./config.yaml";
  logger.info("Loading configuration", { path: configFile });
  const config = await loadConfig(configPath ? configPath.replace(/\/[^/]+$/, "") : ".");

  // Initialize GELF transport if configured
  let gelfTransport: GelfTransport | null = null;
  if (config.logging.gelf?.enabled && config.logging.gelf.endpoint) {
    gelfTransport = new GelfTransport(config.logging.gelf);
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      module: "Bootstrap",
      message: "GELF transport initialized",
      context: {
        endpoint: config.logging.gelf.endpoint,
        hostname: config.logging.gelf.hostname ?? "air-friends",
      },
    }));
  }

  // Configure logger based on config
  configureLogger({
    level: config.logging.level,
    format: "json",
    gelfTransport: gelfTransport ?? undefined,
  });

  // Verify the installed OpenCode CLI version (non-fatal, observable). The container
  // pin (Containerfile OPENCODE_VERSION) is the prevention; this surfaces drift early.
  await verifyOpenCodeVersion();

  // Agent sandbox egress + confinement (F12/F14). Start the validating egress proxy once
  // and verify the required namespace capabilities up front, failing closed at startup with
  // an actionable error rather than at first agent spawn.
  const sandbox = config.agent.sandbox;
  if (sandbox) {
    if (sandbox.filesystemConfinement && !canConfineFilesystem()) {
      throw new Error(
        "agent.sandbox.filesystemConfinement is enabled but bwrap could not establish a mount " +
          "namespace in this runtime (unprivileged user namespaces appear disabled). Enable them / " +
          "install bubblewrap, or set filesystemConfinement:false to accept the risk. " +
          "Run scripts/probe-sandbox-caps.sh to diagnose.",
      );
    }
    const wantsFullIsolation = !sandbox.unrestrictedEgress && !sandbox.egressProxy &&
      sandbox.networkIsolation;
    if (wantsFullIsolation && !canIsolateNetwork()) {
      throw new Error(
        "agent.sandbox.networkIsolation is enabled but a network namespace could not be " +
          "established in this runtime. Enable unprivileged user namespaces, or use " +
          "agent.sandbox.egressProxy instead. Run scripts/probe-sandbox-caps.sh to diagnose.",
      );
    }
    if (sandbox.egressProxy && !sandbox.unrestrictedEgress) {
      configureEgressAllowHosts(sandbox.egressAllowHosts ?? []);
      const proxy = ensureEgressProxy(sandbox.egressProxyPort ?? 0);
      logger.info("Agent egress mediated by validating proxy on 127.0.0.1:{port}", {
        port: proxy.port,
      });
    } else if (sandbox.unrestrictedEgress) {
      logger.warn(
        "⚠️  agent.sandbox.unrestrictedEgress is ENABLED — the agent has UNMEDIATED network " +
          "egress. Only appropriate for trusted single-tenant deployments.",
      );
    }
  }

  // Log configured MCP servers
  if (config.agent.mcpServers && config.agent.mcpServers.length > 0) {
    logger.info("External MCP servers configured: {servers}", {
      servers: config.agent.mcpServers.map((s) => `${s.name} (${s.transport ?? "stdio"})`).join(
        ", ",
      ),
    });
  }

  // CLI --dry-run flag overrides config
  if (dryRun) {
    if (!config.agent.dryRun) {
      config.agent.dryRun = {
        enabled: true,
        outputPath: "./data/dry-run/",
        mockReply: "（Dry run 模式 — 此為測試回覆）",
      };
    } else {
      config.agent.dryRun.enabled = true;
    }
  }

  // Log dry run mode activation
  if (config.agent.dryRun?.enabled) {
    logger.warn("🧪 Dry run mode ENABLED — Agent will NOT be called", {
      outputPath: config.agent.dryRun.outputPath,
      mockReply: config.agent.dryRun.mockReply ? "(configured)" : "(none)",
    });
  }

  // Install external skills before agent core initialization
  if (config.agent.externalSkills && config.agent.externalSkills.length > 0) {
    await installExternalSkills(config.agent.externalSkills);
  }

  if (config.agent.gitCredential?.enabled) {
    const { setupGitCredentials } = await import("@core/git-credential-setup.ts");
    await setupGitCredentials(config.agent.gitCredential, config.gitBackup);
  }

  // Initialize agent core (this initializes all necessary components)
  logger.info("Initializing agent core");
  const agentCore = new AgentCore(config, yolo);

  // Initialize platform registry
  logger.info("Initializing platform registry");
  const platformRegistry = getPlatformRegistry();

  // Register Discord adapter if configured
  if (config.platforms.discord.enabled) {
    logger.info("Registering Discord adapter");
    const discordAdapter = new DiscordAdapter(config.platforms.discord);
    platformRegistry.register(discordAdapter);
    agentCore.registerPlatform(discordAdapter);
  }

  // Register Misskey adapter if configured
  if (config.platforms.misskey.enabled) {
    logger.info("Registering Misskey adapter");
    const misskeyAdapter = new MisskeyAdapter(config.platforms.misskey);
    platformRegistry.register(misskeyAdapter);
    agentCore.registerPlatform(misskeyAdapter);
  }

  // Initialize Health Check server if enabled
  let healthCheckServer: HealthCheckServer | null = null;
  if (config.health?.enabled) {
    logger.info("Initializing Health Check server", { port: config.health.port });
    healthCheckServer = new HealthCheckServer(config.health.port, config.metrics);
    healthCheckServer.start();
  }

  // Initialize Spontaneous Scheduler
  const spontaneousScheduler = new SpontaneousScheduler(config);
  spontaneousScheduler.setCallback(async (platform: Platform) => {
    const adapter = platformRegistry.getAdapter(platform);
    if (!adapter) {
      logger.warn("Platform adapter not found: {platform}", { platform });
      return;
    }

    if (adapter.getConnectionStatus().state !== "connected") {
      logger.warn("Platform {platform} not connected, skipping spontaneous post", { platform });
      return;
    }

    const botId = adapter.getBotId();
    if (!botId) {
      logger.warn("Bot ID not available for {platform}, skipping spontaneous post", { platform });
      return;
    }

    const target = await adapter.determineSpontaneousTarget(config);
    if (!target) {
      logger.warn("No valid target for spontaneous post on {platform}", { platform });
      return;
    }

    const sp = config.platforms[platform].spontaneousPost!;
    const fetchRecentMessages = Math.random() < sp.contextFetchProbability;

    logger.info("Triggering spontaneous post", {
      platform,
      channelId: target.channelId,
      fetchRecentMessages,
    });

    const response = await agentCore.getOrchestrator().processSpontaneousPost(
      platform,
      target.channelId,
      adapter,
      { botId, fetchRecentMessages },
    );

    if (!response.success) {
      logger.warn("Spontaneous post did not succeed", {
        platform,
        error: response.error,
      });
    }
  });

  // Initialize Self-Research Scheduler
  let selfResearchScheduler: SelfResearchScheduler | null = null;

  // Initialize Channel Lurk Scheduler (Discord only)
  let channelLurkScheduler: ChannelLurkScheduler | null = null;
  if (config.platforms.discord?.enabled && config.platforms.discord.channelLurk?.enabled) {
    const discordAdapter = platformRegistry.getAdapter("discord");
    const channelIds = extractChannelLurkIds(config.channels);

    if (discordAdapter && channelIds.length > 0) {
      channelLurkScheduler = new ChannelLurkScheduler(
        config.platforms.discord.channelLurk,
        discordAdapter,
        channelIds,
        async (target, lastMessage) => {
          const adapter = platformRegistry.getAdapter("discord");
          if (!adapter) return;

          // Build NormalizedEvent from the last message
          const event = {
            platform: "discord" as const,
            channelId: target.channelId,
            userId: lastMessage.userId,
            messageId: lastMessage.messageId,
            isDm: false,
            guildId: "",
            content: lastMessage.content,
            timestamp: lastMessage.timestamp,
            attachments: lastMessage.attachments,
          };

          const response = await agentCore.getOrchestrator().processChannelLurkMessage(
            event,
            adapter,
          );

          if (!response.success) {
            logger.warn("Channel lurk reply did not succeed", {
              channelId: target.channelId,
              error: response.error,
            });
          }
        },
      );
      logger.info("Channel lurk scheduler initialized", { channelCount: channelIds.length });
    } else if (channelIds.length === 0) {
      logger.info("Channel lurk enabled but no Discord channels configured for lurk");
    }
  }

  if (config.selfResearch?.enabled) {
    selfResearchScheduler = new SelfResearchScheduler(config);
    selfResearchScheduler.setCallback(async () => {
      const allItems = await fetchRssItems(config.selfResearch!.rssFeeds);
      if (allItems.length === 0) {
        logger.warn("No RSS items fetched, skipping self-research");
        return;
      }

      const selectedItems = pickRandom(allItems, 20);

      const response = await agentCore.getOrchestrator().processSelfResearch(
        selectedItems,
        config.selfResearch!,
      );

      if (!response.success) {
        logger.warn("Self-research session did not succeed", { error: response.error });
      }
    });
  }

  // Initialize Memory Maintenance Scheduler
  let memoryMaintenanceScheduler: MemoryMaintenanceScheduler | null = null;
  if (config.memoryMaintenance?.enabled) {
    memoryMaintenanceScheduler = new MemoryMaintenanceScheduler(config.memoryMaintenance);
    memoryMaintenanceScheduler.setCallback(async () => {
      const orchestrator = agentCore.getOrchestrator();
      const workspaceManager = agentCore.getWorkspaceManager();
      const memoryStore = agentCore.getMemoryStore();
      const workspaceKeys = await workspaceManager.listWorkspaces();

      for (const workspaceKey of workspaceKeys) {
        try {
          const [platform, userId] = workspaceKey.split("/");
          if (!isValidPlatform(platform) || !userId) {
            logger.warn("Skipping invalid workspace key", { workspaceKey });
            continue;
          }

          const workspaceInfo = await workspaceManager.getOrCreateWorkspace({
            platform,
            userId,
            channelId: "internal",
            messageId: `maintenance_check_${Date.now()}`,
            isDm: true,
            guildId: "",
            content: "",
            timestamp: new Date(),
          });

          const count = await memoryStore.countEnabledMemories(workspaceInfo);
          if (count < config.memoryMaintenance!.minMemoryCount) {
            logger.debug("Skipping workspace, below memory maintenance threshold", {
              workspaceKey,
              count,
              threshold: config.memoryMaintenance!.minMemoryCount,
            });
            continue;
          }

          logger.info("Starting memory maintenance for workspace {workspaceKey}", {
            workspaceKey,
            count,
          });
          await orchestrator.processMemoryMaintenance(workspaceKey, config.memoryMaintenance!);
          logger.info("Memory maintenance completed for workspace {workspaceKey}", {
            workspaceKey,
          });
        } catch (error) {
          logger.error("Memory maintenance failed for workspace {workspaceKey}", {
            workspaceKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Scan channel workspaces
      const channelKeys = await workspaceManager.listChannelWorkspaces();
      for (const channelKey of channelKeys) {
        try {
          const [platform, channelId] = channelKey.split("/");
          if (!isValidPlatform(platform) || !channelId) {
            logger.warn("Skipping invalid channel workspace key", { channelKey });
            continue;
          }

          const channelWorkspace = await workspaceManager.getOrCreateChannelWorkspace(
            platform,
            channelId,
          );
          const channelMemories = await memoryStore.loadChannelMemories(channelWorkspace);
          const enabledCount = channelMemories.filter((m) => m.enabled).length;
          if (enabledCount < config.memoryMaintenance!.minMemoryCount) {
            logger.debug("Skipping channel workspace, below memory maintenance threshold", {
              channelKey,
              count: enabledCount,
              threshold: config.memoryMaintenance!.minMemoryCount,
            });
            continue;
          }

          logger.info("Starting memory maintenance for channel workspace {channelKey}", {
            channelKey,
            count: enabledCount,
          });
          await orchestrator.processChannelMemoryMaintenance(
            channelKey,
            channelWorkspace,
            config.memoryMaintenance!,
          );
          logger.info("Memory maintenance completed for channel workspace {channelKey}", {
            channelKey,
          });
        } catch (error) {
          logger.error("Memory maintenance failed for channel workspace {channelKey}", {
            channelKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
  }

  // Initialize Git Backup
  let gitBackupScheduler: GitBackupScheduler | null = null;
  let gitBackupService: GitBackupService | null = null;
  if (config.gitBackup?.enabled && config.gitBackup.remoteUrl) {
    gitBackupService = new GitBackupService(
      config.gitBackup,
      config.workspace.repoPath,
    );

    await gitBackupService.initialize();

    gitBackupScheduler = new GitBackupScheduler(config.gitBackup);
    gitBackupScheduler.setCallback(async () => {
      await gitBackupService!.performBackup();
    });
  }

  // Initialize Reminder Scheduler
  let reminderScheduler: ReminderScheduler | null = null;
  if (config.reminders?.enabled) {
    const reminderStore = agentCore.getReminderStore()!;
    reminderScheduler = new ReminderScheduler(config.reminders);

    reminderScheduler.setCallback(async () => {
      const orchestrator = agentCore.getOrchestrator();
      const workspaceManager = agentCore.getWorkspaceManager();
      const workspaceKeys = await workspaceManager.listWorkspaces();

      for (const workspaceKey of workspaceKeys) {
        try {
          const [platformStr, userId] = workspaceKey.split("/");
          if (!isValidPlatform(platformStr) || !userId) {
            continue;
          }

          const workspaceInfo = await workspaceManager.getOrCreateWorkspace({
            platform: platformStr,
            userId,
            channelId: "internal",
            messageId: `reminder_check_${Date.now()}`,
            isDm: true,
            guildId: "",
            content: "",
            timestamp: new Date(),
          });

          const dueReminders = await reminderStore.getDueReminders(workspaceInfo);

          for (const reminder of dueReminders) {
            try {
              const adapter = platformRegistry.getAdapter(reminder.platform as Platform);
              if (!adapter) {
                logger.warn("No adapter for platform {platform}, skipping reminder {reminderId}", {
                  platform: reminder.platform,
                  reminderId: reminder.id,
                });
                continue;
              }

              await orchestrator.processReminder(reminder, adapter, reminderStore);
            } catch (error) {
              logger.error("Failed to process reminder {reminderId}: {error}", {
                reminderId: reminder.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        } catch (error) {
          logger.error("Failed to check reminders for workspace {workspaceKey}: {error}", {
            workspaceKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    logger.info("Reminder scheduler initialized");
  }

  // Initialize Audit Log Retention Scheduler
  let auditRetentionScheduler: AuditRetentionScheduler | null = null;
  if (config.audit?.enabled && config.audit.retentionDays > 0) {
    const auditBasePath = join(config.workspace.repoPath, "audit");
    auditRetentionScheduler = new AuditRetentionScheduler(config.audit);
    auditRetentionScheduler.setCallback(async () => {
      await cleanupAuditLogs(auditBasePath, config.audit!.retentionDays);
    });
    logger.info("Audit retention scheduler initialized", {
      retentionDays: config.audit.retentionDays,
    });
  }

  logger.info("Bootstrap completed");

  // Initialize CompletedSessionStore
  const completedSessionStore = new CompletedSessionStore();

  // Pass completedSessionStore to SessionOrchestrator
  agentCore.getOrchestrator().setCompletedSessionStore(completedSessionStore);

  // Initialize Dashboard Server
  let dashboardServer: DashboardServer | null = null;
  if (config.dashboard?.enabled && config.dashboard.passphrase) {
    const agentWorkspacePath = join(config.workspace.repoPath, "agent-workspace");
    const auditBasePath = join(config.workspace.repoPath, "audit");
    dashboardServer = new DashboardServer({
      config: config.dashboard,
      appConfig: config,
      sessionRegistry: agentCore.getSessionRegistry(),
      completedSessionStore,
      agentWorkspacePath,
      auditConfig: config.audit,
      auditBasePath,
      metricsRegistry: config.metrics?.enabled ? metricsRegistry : undefined,
      skillRegistry: agentCore.getSkillRegistry(),
      memoryStore: agentCore.getMemoryStore(),
      workspaceManager: agentCore.getWorkspaceManager(),
    });
    dashboardServer.start();
    logger.info("Dashboard server initialized", { port: config.dashboard.port });
  }

  // Initialize scheduler state store
  const schedulerStateStore = new SchedulerStateStore(
    join(config.workspace.repoPath, "scheduler-state.json"),
  );
  const savedSchedulerState = await schedulerStateStore.load();

  // Inject state store into schedulers
  spontaneousScheduler.setStateStore(schedulerStateStore);
  if (selfResearchScheduler) selfResearchScheduler.setStateStore(schedulerStateStore);
  if (memoryMaintenanceScheduler) memoryMaintenanceScheduler.setStateStore(schedulerStateStore);
  if (gitBackupScheduler) gitBackupScheduler.setStateStore(schedulerStateStore);
  if (auditRetentionScheduler) auditRetentionScheduler.setStateStore(schedulerStateStore);
  if (channelLurkScheduler) channelLurkScheduler.setStateStore(schedulerStateStore);

  const context: AppContext = {
    config,
    agentCore,
    platformRegistry,
    healthCheckServer,
    spontaneousScheduler,
    channelLurkScheduler,
    selfResearchScheduler,
    memoryMaintenanceScheduler,
    gitBackupScheduler,
    gitBackupService,
    reminderScheduler,
    auditRetentionScheduler,
    schedulerStateStore,
    savedSchedulerState,
    gelfTransport,
    yolo,
    dashboardServer,
    completedSessionStore,
  };

  // Set Health Check server context after all components initialized
  if (healthCheckServer) {
    healthCheckServer.setContext(context);
  }

  return context;
}

/**
 * Connect all platforms and start listening
 */
export async function startPlatforms(context: AppContext): Promise<void> {
  const { platformRegistry } = context;
  const adapters = platformRegistry.getAllAdapters();

  if (adapters.length === 0) {
    logger.warn("No platform adapters configured");
    return;
  }

  logger.info("Connecting to {count} platforms", { count: adapters.length });

  // Connect all platforms
  await platformRegistry.connectAll();

  // Start spontaneous scheduler after platforms are connected
  if (context.spontaneousScheduler) {
    context.spontaneousScheduler.start(context.savedSchedulerState);
  }

  // Start channel lurk scheduler after platforms are connected
  if (context.channelLurkScheduler) {
    context.channelLurkScheduler.start(context.savedSchedulerState);
  }

  // Start self-research scheduler (independent of platforms)
  if (context.selfResearchScheduler) {
    context.selfResearchScheduler.start(context.savedSchedulerState);
  }

  if (context.memoryMaintenanceScheduler) {
    context.memoryMaintenanceScheduler.start(context.savedSchedulerState);
  }

  // Start git backup scheduler (independent of platforms)
  if (context.gitBackupScheduler) {
    context.gitBackupScheduler.start(context.savedSchedulerState);
  }

  // Start reminder scheduler (independent of platforms, but needs them connected)
  if (context.reminderScheduler) {
    context.reminderScheduler.start();
  }

  // Start audit retention scheduler with restored state
  if (context.auditRetentionScheduler) {
    context.auditRetentionScheduler.start(context.savedSchedulerState);
  }

  logger.info("All platforms connected");
}
