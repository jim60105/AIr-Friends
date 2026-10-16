// src/core/workspace-manager.ts

import { isAbsolute, join, relative, resolve, SEPARATOR } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import type { Logger } from "@utils/logger.ts";
import {
  ensureDirectory,
  pathExists,
  sanitizePathComponent,
  validatePathWithinBoundary,
} from "@utils/path-validator.ts";
import { OMP_AGENT_TMP_ENTRY } from "@utils/omp-paths.ts";
import { OPENCODE_DATA_TMP_ENTRY } from "@utils/opencode-paths.ts";
import type {
  ChannelWorkspaceInfo,
  WorkspaceInfo,
  WorkspaceKeyComponents,
  WorkspaceManagerConfig,
} from "../types/workspace.ts";
import { MemoryFileType } from "../types/workspace.ts";
import type { NormalizedEvent } from "../types/events.ts";
import { ErrorCode, WorkspaceError } from "../types/errors.ts";

const logger = createLogger("WorkspaceManager");

/** Container directory of channel workspaces below a platform directory. */
const CHANNELS_DIR = "channels";

/**
 * Reserved direct-child names of a workspace `tmp/` directory. They hold the
 * engines' native state (per mode / per session), so they are preserved
 * verbatim — never inspected, never followed, never inferred disposable —
 * regardless of the currently selected engine or mode.
 */
const RESERVED_TMP_ENTRIES: Record<string, true> = {
  [OMP_AGENT_TMP_ENTRY]: true,
  [OPENCODE_DATA_TMP_ENTRY]: true,
};

/** Default bound on disposable filesystem nodes examined per workspace and pass. */
export const TMP_CLEANUP_MAX_NODES = 2048;
/** Default bound on directory depth below one workspace `tmp/` root. */
export const TMP_CLEANUP_MAX_DEPTH = 64;

/** Injectable traversal bounds (tests drive bounded retention with small values). */
export interface WorkspaceTmpCleanupLimits {
  maxNodes?: number;
  maxDepth?: number;
}

/**
 * Options shared by the idle-checked cleanup entry points. `isWorkspaceBusy` is
 * the caller's conservative "another owner exists" probe (the session registry),
 * and `limits` overrides the traversal bounds for tests.
 */
export interface WorkspaceTmpCleanupOptions {
  isWorkspaceBusy?: () => boolean;
  logger?: Logger;
  limits?: WorkspaceTmpCleanupLimits;
}

/** Outcome of one idle-checked cleanup attempt for a single workspace `tmp/`. */
export interface WorkspaceTmpCleanupOutcome {
  /** `cleaned` ran the pass, `absent` found no tmp directory, `skipped` retained it
   * by policy (live use, unconfirmed teardown, unsafe shape), `failed` could not
   * inspect it. */
  status: "cleaned" | "absent" | "skipped" | "failed";
  /** Stable machine-readable reason for `skipped`/`failed`. */
  reason?: string;
  /** Disposable entries removed by this pass. */
  removed: number;
  /** Disposable entries intentionally left in place (bounds, failures, special nodes). */
  retained: number;
  /** True when the pass stopped at a traversal bound and left work for a later pass. */
  budgetExhausted: boolean;
}

/** Result of the awaited startup reclamation pass over the workspace layout. */
export interface WorkspaceTmpReclaimReport {
  /** Recognized workspace `tmp/` directories visited. */
  workspaces: number;
  /** Disposable entries removed. */
  removed: number;
  /** Disposable entries intentionally left in place. */
  retained: number;
  /** Workspaces skipped or stopped early (live use, uncertainty, unsafe shape, bound). */
  skipped: number;
  /** True when at least one workspace pass stopped at its traversal bound. */
  budgetExhausted: boolean;
}

/**
 * Narrow sink the shared process pool uses to retain one workspace's cleanup
 * protection when it cannot confirm that a pooled producer's tool children
 * stopped using the workspace (`WorkspaceManager` implements it directly).
 */
export interface WorkspaceTmpUnreclaimableSink {
  markTmpUseUncertain(tmpPath: string, reason: string): void;
}

/** Mutable counters of one synchronous workspace traversal. */
interface TmpTraversalState {
  maxNodes: number;
  maxDepth: number;
  examined: number;
  removed: number;
  retained: number;
  budgetExhausted: boolean;
}

export class WorkspaceManager {
  private readonly repoPath: string;
  private readonly workspacesRoot: string;
  /**
   * Live temporary-use reference counts per workspace `tmp/` path. Independent
   * of Skill API registry expiry: an expired registry entry never clears a
   * reference, so a running producer keeps its workspace protected (design D2).
   */
  private readonly tmpUseCounts = new Map<string, number>();
  /**
   * Workspace `tmp/` paths whose producer teardown could not be confirmed.
   * Retained for this bot lifetime: releasing ownership never clears a marker,
   * so uncertain teardown is never declared idle (design D2).
   */
  private readonly unreclaimableTmp = new Set<string>();
  /** Resolved (canonical) anchor of the configured workspace root, memoized. */
  private canonicalRoot?: string;

  constructor(config: WorkspaceManagerConfig) {
    this.repoPath = resolve(config.repoPath);
    this.workspacesRoot = resolve(join(this.repoPath, config.workspacesDir));

    logger.info("WorkspaceManager initialized", {
      repoPath: this.repoPath,
      workspacesRoot: this.workspacesRoot,
    });
  }

  /**
   * Compute workspace key from event components
   * Format: {platform}/{user_id}
   * Memory is per-user, not per-channel — the same user's memories are shared
   * across all channels/threads they interact in.
   */
  computeWorkspaceKey(components: WorkspaceKeyComponents): string {
    const { platform, userId } = components;

    // Sanitize each component to prevent path traversal
    const safePlatform = sanitizePathComponent(platform);
    const safeUserId = sanitizePathComponent(userId);

    return `${safePlatform}/${safeUserId}`;
  }

  /**
   * Get workspace key from a normalized event
   */
  getWorkspaceKeyFromEvent(event: NormalizedEvent): string {
    return this.computeWorkspaceKey({
      platform: event.platform,
      userId: event.userId,
    });
  }

  /**
   * Get the absolute path for a workspace
   */
  getWorkspacePath(workspaceKey: string): string {
    const path = resolve(join(this.workspacesRoot, workspaceKey));

    // Validate path is still within workspace root (security check)
    validatePathWithinBoundary(path, this.workspacesRoot);

    return path;
  }

  /**
   * Get or create workspace for an event
   */
  async getOrCreateWorkspace(event: NormalizedEvent): Promise<WorkspaceInfo> {
    const key = this.getWorkspaceKeyFromEvent(event);
    const path = this.getWorkspacePath(key);

    // Check if workspace exists
    const exists = await pathExists(path);
    let createdAt: Date | undefined;

    if (!exists) {
      logger.info("Creating new workspace: {workspaceKey}", { workspaceKey: key });
      await ensureDirectory(path);
      createdAt = new Date();

      // Memory files are created lazily on first write
      this.initializeWorkspaceFiles(path, event.isDm);
    } else {
      // Try to get creation time from directory stat
      try {
        const stat = await Deno.stat(path);
        createdAt = stat.birthtime ?? stat.mtime ?? undefined;
      } catch {
        // Ignore stat errors
      }
    }

    // Ensure tmp/ subdirectory exists (always, even for existing workspaces)
    const tmpPath = join(path, "tmp");
    await ensureDirectory(tmpPath);

    return {
      key,
      components: {
        platform: event.platform,
        userId: event.userId,
      },
      path,
      tmpPath,
      isDm: event.isDm,
      createdAt,
    };
  }

  /**
   * Initialize workspace with required files.
   * Memory files (public/private JSONL) are created lazily on first write,
   * not eagerly at workspace creation time.
   */
  private initializeWorkspaceFiles(
    _workspacePath: string,
    _isDm: boolean,
  ): void {
    // Memory files are created lazily on first write (Deno.writeTextFile with append:true
    // auto-creates the file). No eager file creation needed.
  }

  /**
   * Get memory file path for a workspace
   * Both public and private memory files always exist in per-user workspaces.
   */
  getMemoryFilePath(
    workspace: WorkspaceInfo,
    fileType: MemoryFileType,
  ): string {
    return join(workspace.path, fileType);
  }

  /**
   * Validate that a file path is within a workspace
   * Throws WorkspaceError if validation fails
   */
  validateFileAccess(filePath: string, workspace: WorkspaceInfo): void {
    validatePathWithinBoundary(filePath, workspace.path);
  }

  /**
   * Read a file within workspace boundary
   */
  async readWorkspaceFile(
    workspace: WorkspaceInfo,
    relativePath: string,
  ): Promise<string> {
    const absolutePath = resolve(join(workspace.path, relativePath));
    this.validateFileAccess(absolutePath, workspace);

    try {
      return await Deno.readTextFile(absolutePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new WorkspaceError(
          ErrorCode.WORKSPACE_NOT_FOUND,
          `File not found: ${relativePath}`,
          { workspaceKey: workspace.key, relativePath },
        );
      }
      throw error;
    }
  }

  /**
   * Write a file within workspace boundary
   */
  async writeWorkspaceFile(
    workspace: WorkspaceInfo,
    relativePath: string,
    content: string,
  ): Promise<void> {
    const absolutePath = resolve(join(workspace.path, relativePath));
    this.validateFileAccess(absolutePath, workspace);

    // Ensure parent directory exists
    const parentDir = absolutePath.substring(0, absolutePath.lastIndexOf("/"));
    await ensureDirectory(parentDir);

    await Deno.writeTextFile(absolutePath, content);
  }

  /**
   * Append to a file within workspace boundary
   */
  async appendWorkspaceFile(
    workspace: WorkspaceInfo,
    relativePath: string,
    content: string,
  ): Promise<void> {
    const absolutePath = resolve(join(workspace.path, relativePath));
    this.validateFileAccess(absolutePath, workspace);

    await Deno.writeTextFile(absolutePath, content, { append: true });
  }

  /**
   * Get or create the Agent's global workspace.
   * Path: {repoPath}/agent-workspace/
   * This workspace is shared across all users and conversations.
   */
  async getOrCreateAgentWorkspace(): Promise<string> {
    const agentWorkspacePath = resolve(join(this.repoPath, "agent-workspace"));

    // Validate path is within repoPath boundary
    validatePathWithinBoundary(agentWorkspacePath, this.repoPath);

    const exists = await pathExists(agentWorkspacePath);

    if (!exists) {
      logger.info("Creating agent workspace at {path}", { path: agentWorkspacePath });

      // Create directory structure
      await ensureDirectory(agentWorkspacePath);
      await ensureDirectory(join(agentWorkspacePath, "notes"));
      await ensureDirectory(join(agentWorkspacePath, "journal"));

      // Initialize default files
      await this.initializeAgentWorkspaceFiles(agentWorkspacePath);
    }

    return agentWorkspacePath;
  }

  /**
   * Initialize agent workspace with default files (only if they don't exist)
   */
  private async initializeAgentWorkspaceFiles(workspacePath: string): Promise<void> {
    const readmePath = join(workspacePath, "README.md");
    if (!(await pathExists(readmePath))) {
      await Deno.writeTextFile(
        readmePath,
        `# Agent Workspace

This is your personal workspace for long-term knowledge and notes.

## Structure
- \`notes/\` - Knowledge notes organized by topic
  - \`_index.md\` - Index of all notes (maintain this when adding/modifying notes)
  - \`{topic-slug}.md\` - Individual topic files
- \`journal/\` - Daily reflections and logs
  - \`{YYYY-MM-DD}.md\` - Daily entries

## Guidelines
- Use kebab-case for filenames (e.g., \`typescript-patterns.md\`)
- Keep \`_index.md\` updated with topic names and brief summaries
- Do NOT store user private information here (use memory-save skill instead)
`,
      );
    }

    const indexPath = join(workspacePath, "notes", "_index.md");
    if (!(await pathExists(indexPath))) {
      await Deno.writeTextFile(indexPath, "# Notes Index\n\n");
    }

    logger.debug("Agent workspace files initialized", { workspacePath });
  }

  /**
   * Get channel workspace path
   */
  getChannelWorkspacePath(platform: string, channelId: string): string {
    const safePlatform = sanitizePathComponent(platform);
    const safeChannelId = sanitizePathComponent(channelId);
    const path = resolve(join(this.workspacesRoot, safePlatform, CHANNELS_DIR, safeChannelId));
    validatePathWithinBoundary(path, this.workspacesRoot);
    return path;
  }

  /**
   * Get or create channel workspace directory and memory file
   */
  async getOrCreateChannelWorkspace(
    platform: string,
    channelId: string,
  ): Promise<ChannelWorkspaceInfo> {
    const safePlatform = sanitizePathComponent(platform);
    const safeChannelId = sanitizePathComponent(channelId);
    const key = `${safePlatform}/${safeChannelId}`;
    const path = this.getChannelWorkspacePath(platform, channelId);

    const exists = await pathExists(path);
    if (!exists) {
      logger.info("Creating channel workspace: {key}", { key });
      await ensureDirectory(path);
      // Channel memory file is created lazily on first write
    }

    return { key, platform: safePlatform, channelId: safeChannelId, path };
  }

  /**
   * Get the channel memory file path
   */
  getChannelMemoryFilePath(channelWorkspace: ChannelWorkspaceInfo): string {
    return join(channelWorkspace.path, MemoryFileType.CHANNEL);
  }

  /**
   * List all channel workspaces, optionally filtered by platform
   */
  async listChannelWorkspaces(platform?: string): Promise<string[]> {
    const workspaces: string[] = [];
    try {
      for await (const platformEntry of Deno.readDir(this.workspacesRoot)) {
        if (!platformEntry.isDirectory) continue;
        if (platform && platformEntry.name !== platform) continue;

        const channelsDir = join(this.workspacesRoot, platformEntry.name, CHANNELS_DIR);
        try {
          for await (const channelEntry of Deno.readDir(channelsDir)) {
            if (!channelEntry.isDirectory) continue;
            workspaces.push(`${platformEntry.name}/${channelEntry.name}`);
          }
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return workspaces;
  }

  /**
   * List workspaces (for debugging/admin purposes)
   */
  async listWorkspaces(platform?: string): Promise<string[]> {
    const workspaces: string[] = [];

    try {
      for await (const platformEntry of Deno.readDir(this.workspacesRoot)) {
        if (!platformEntry.isDirectory) continue;
        if (platform && platformEntry.name !== platform) continue;

        const platformPath = join(this.workspacesRoot, platformEntry.name);

        for await (const userEntry of Deno.readDir(platformPath)) {
          if (!userEntry.isDirectory) continue;

          workspaces.push(
            `${platformEntry.name}/${userEntry.name}`,
          );
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    return workspaces;
  }

  /**
   * Absolute `tmp/` path of a workspace key, computable BEFORE the workspace
   * exists. Producers acquire their temporary-use reference with this value, so
   * ownership precedes workspace creation (design D2).
   */
  getWorkspaceTmpPath(workspaceKey: string): string {
    return join(this.getWorkspacePath(workspaceKey), "tmp");
  }

  /**
   * Acquire one temporary-use reference for a workspace `tmp/` directory.
   * Called before the first await that may create the directory, and always
   * paired with exactly one {@link releaseTmpUse}.
   */
  acquireTmpUse(tmpPath: string): void {
    this.tmpUseCounts.set(tmpPath, (this.tmpUseCounts.get(tmpPath) ?? 0) + 1);
  }

  /**
   * Release one temporary-use reference. The FINAL release — reference count
   * back to zero, no registered session for the workspace and no unconfirmed
   * producer teardown — reclaims eligible disposable entries synchronously,
   * with no await between those checks and the filesystem mutation, so another
   * same-workspace session cannot start and lose its files mid-cleanup.
   *
   * A release without a matching acquire is ignored (and warned): an extra
   * teardown path must never unlock a live producer.
   */
  releaseTmpUse(
    tmpPath: string,
    options: WorkspaceTmpCleanupOptions = {},
  ): WorkspaceTmpCleanupOutcome | null {
    const current = this.tmpUseCounts.get(tmpPath) ?? 0;
    if (current <= 0) {
      (options.logger ?? logger).warn(
        "Ignoring temporary-use release without a matching acquire for {tmpPath}",
        { tmpPath },
      );
      return null;
    }
    if (current > 1) {
      this.tmpUseCounts.set(tmpPath, current - 1);
      return null;
    }
    this.tmpUseCounts.delete(tmpPath);
    return this.cleanupTmpIfIdle(tmpPath, options);
  }

  /**
   * Mark a workspace's producer teardown as unconfirmed. The workspace keeps
   * its cleanup protection for this bot lifetime; releasing ownership never
   * clears the marker.
   */
  markTmpUseUncertain(tmpPath: string, reason: string): void {
    if (this.unreclaimableTmp.has(tmpPath)) return;
    this.unreclaimableTmp.add(tmpPath);
    logger.warn(
      "Retaining workspace temporary files: producer teardown unconfirmed for {tmpPath} ({reason})",
      { tmpPath, reason },
    );
  }

  /** Whether a workspace's producer teardown is still unconfirmed. */
  isTmpUseUncertain(tmpPath: string): boolean {
    return this.unreclaimableTmp.has(tmpPath);
  }

  /**
   * Current temporary-use reference count of one workspace `tmp/` path.
   * Diagnostics/tests only: the count decides whether the next release (or an
   * idle cleanup) may reclaim the workspace's disposable entries.
   */
  getTmpUseCount(tmpPath: string): number {
    return this.tmpUseCounts.get(tmpPath) ?? 0;
  }

  /**
   * Synchronously reclaim disposable entries of one workspace `tmp/` directory
   * when the workspace is idle. Delegated to by every teardown callsite and by
   * the final ownership release (design D1/D2).
   */
  cleanupTmpIfIdle(
    tmpPath: string,
    options: WorkspaceTmpCleanupOptions = {},
  ): WorkspaceTmpCleanupOutcome {
    const log = options.logger ?? logger;
    const idle: WorkspaceTmpCleanupOutcome = {
      status: "skipped",
      removed: 0,
      retained: 0,
      budgetExhausted: false,
    };

    const useCount = this.tmpUseCounts.get(tmpPath) ?? 0;
    if (useCount > 0) {
      log.debug("Skipping tmp cleanup — live temporary-use owner for {tmpPath}", {
        tmpPath,
        useCount,
      });
      return { ...idle, reason: "live-temporary-use" };
    }
    if (this.unreclaimableTmp.has(tmpPath)) {
      log.warn("Skipping tmp cleanup — producer teardown unconfirmed for {tmpPath}", { tmpPath });
      return { ...idle, reason: "uncertain-teardown" };
    }
    if (options.isWorkspaceBusy?.()) {
      log.debug(
        "Skipping tmp cleanup — other active sessions exist for {tmpPath}",
        { tmpPath },
      );
      return { ...idle, reason: "registered-session" };
    }

    const inspection = this.inspectTmpTarget(tmpPath);
    if (inspection.status === "absent") return { ...idle, status: "absent" };
    if (inspection.status === "unsafe") {
      log.warn("Skipping tmp cleanup — unsafe workspace ancestry for {tmpPath} ({reason})", {
        tmpPath,
        reason: inspection.reason,
      });
      return { ...idle, reason: inspection.reason };
    }

    const state: TmpTraversalState = {
      maxNodes: options.limits?.maxNodes ?? TMP_CLEANUP_MAX_NODES,
      maxDepth: options.limits?.maxDepth ?? TMP_CLEANUP_MAX_DEPTH,
      examined: 0,
      removed: 0,
      retained: 0,
      budgetExhausted: false,
    };
    // The tmp root itself is never removed: only its disposable contents are.
    this.removeDisposableChildren(tmpPath, 0, state, log);
    if (state.budgetExhausted) {
      log.debug("Traversal bound reached for {tmpPath}; remaining entries are retained", {
        tmpPath,
        examined: state.examined,
      });
    }
    return {
      status: "cleaned",
      removed: state.removed,
      retained: state.retained,
      budgetExhausted: state.budgetExhausted,
    };
  }

  /**
   * Awaited startup reclamation over the configured workspace layout: it walks
   * the recognized user and channel workspace shapes once, reuses the same
   * conservative entry policy as teardown, and creates no periodic service
   * (design D3/D4). Pool, runtime, backup, memory and shared-agent roots live
   * outside this layout and are never visited.
   */
  async reclaimOrphanTmpDirs(
    options: {
      isWorkspaceBusy?: (tmpPath: string) => boolean;
      limits?: WorkspaceTmpCleanupLimits;
      logger?: Logger;
    } = {},
  ): Promise<WorkspaceTmpReclaimReport> {
    const log = options.logger ?? logger;
    const report: WorkspaceTmpReclaimReport = {
      workspaces: 0,
      removed: 0,
      retained: 0,
      skipped: 0,
      budgetExhausted: false,
    };

    // A root that simply does not exist yet is a harmless no-op (the first
    // session creates it); a root that exists but is a link or cannot be read
    // is unsafe ancestry and must be reported, not silently skipped.
    let rootInfo: Deno.FileInfo;
    try {
      rootInfo = Deno.lstatSync(this.workspacesRoot);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        log.debug("Workspace root absent — no orphan temporary reclamation needed");
        return report;
      }
      log.warn("Workspace root could not be inspected; skipping orphan reclamation", {
        error: error instanceof Error ? error.message : String(error),
        path: this.workspacesRoot,
      });
      report.skipped++;
      return report;
    }
    if (rootInfo.isSymlink || !rootInfo.isDirectory) {
      log.warn("Workspace root is a link or not a directory; skipping orphan reclamation", {
        path: this.workspacesRoot,
      });
      report.skipped++;
      return report;
    }

    const root = this.canonicalWorkspaceRoot();
    if (root === undefined) {
      log.warn("Workspace root could not be resolved; skipping orphan reclamation", {
        path: this.workspacesRoot,
      });
      report.skipped++;
      return report;
    }

    let platformNames: string[];
    try {
      platformNames = [];
      for (const entry of Deno.readDirSync(root)) {
        if (entry.isSymlink) {
          // A linked or replaced platform container is never a cleanup target.
          log.warn("Skipping workspace platform with a linked or replaced component", {
            path: join(root, entry.name),
          });
          report.skipped++;
          continue;
        }
        if (entry.isDirectory) platformNames.push(entry.name);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return report;
      log.warn("Failed to enumerate the workspace root", {
        error: error instanceof Error ? error.message : String(error),
        path: root,
      });
      report.skipped++;
      return report;
    }

    for (const platformName of platformNames) {
      const platformPath = join(root, platformName);
      if (!isOrdinaryDirectory(platformPath)) {
        log.warn("Skipping workspace platform with a linked or replaced component", {
          path: platformPath,
        });
        report.skipped++;
        continue;
      }

      const recognized = this.listRecognizedTmpPaths(platformPath, platformName, log);
      report.skipped += recognized.skipped;
      for (const tmpPath of recognized.tmpPaths) {
        report.workspaces++;
        // Startup may await between workspace passes; no ingress is reachable yet.
        await yieldToEventLoop();
        const outcome = this.cleanupTmpIfIdle(tmpPath, {
          isWorkspaceBusy: options.isWorkspaceBusy
            ? () => options.isWorkspaceBusy!(tmpPath)
            : undefined,
          limits: options.limits,
          logger: log,
        });
        report.removed += outcome.removed;
        report.retained += outcome.retained;
        report.budgetExhausted = report.budgetExhausted || outcome.budgetExhausted;
        if (outcome.status !== "cleaned" || outcome.budgetExhausted) report.skipped++;
      }
    }

    log.info("Workspace orphan temporary reclamation finished", {
      workspaces: report.workspaces,
      removed: report.removed,
      retained: report.retained,
      skipped: report.skipped,
    });
    return report;
  }

  /**
   * `tmp/` paths of the recognized workspace shapes below one platform
   * directory: `{platform}/{user}` and `{platform}/channels/{channel}`, each
   * only when it actually has a `tmp` child. The `channels` container itself is
   * never treated as a workspace (design D3).
   */
  private listRecognizedTmpPaths(
    platformPath: string,
    platformName: string,
    log: Logger,
  ): { tmpPaths: string[]; skipped: number } {
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(platformPath)];
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        log.warn("Failed to enumerate a platform workspace directory", {
          error: error instanceof Error ? error.message : String(error),
          path: platformPath,
        });
      }
      return { tmpPaths: [], skipped: 0 };
    }

    let skipped = 0;
    const workspaceDirs: string[] = [];
    for (const entry of entries) {
      const name = entry.name;
      if (name !== CHANNELS_DIR) {
        if (entry.isSymlink) {
          log.warn("Skipping workspace with a linked or replaced component", {
            path: join(platformPath, name),
          });
          skipped++;
          continue;
        }
        if (!entry.isDirectory) continue;
        workspaceDirs.push(join(platformPath, name));
        continue;
      }
      const channelsPath = join(platformPath, CHANNELS_DIR);
      // The container itself must be an ordinary, link-free directory before it
      // is enumerated: a linked `channels` component would otherwise make the
      // walk cross ancestry that D4 requires us to skip (its per-candidate
      // deletion check would still refuse, but discovery must not follow it).
      if (!isOrdinaryDirectory(channelsPath)) {
        log.warn("Skipping channel container with a linked or replaced component", {
          path: channelsPath,
        });
        skipped++;
        continue;
      }
      try {
        for (const channel of Deno.readDirSync(channelsPath)) {
          if (channel.isSymlink) {
            log.warn("Skipping channel workspace with a linked or replaced component", {
              path: join(channelsPath, channel.name),
            });
            skipped++;
            continue;
          }
          if (channel.isDirectory) workspaceDirs.push(join(channelsPath, channel.name));
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          log.warn("Failed to enumerate a channel workspace directory", {
            error: error instanceof Error ? error.message : String(error),
            path: channelsPath,
          });
        }
      }
    }

    const tmpPaths: string[] = [];
    for (const workspaceDir of workspaceDirs) {
      let hasTmp = false;
      try {
        for (const entry of Deno.readDirSync(workspaceDir)) {
          if (entry.name === "tmp") {
            hasTmp = true;
            break;
          }
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          log.warn("Failed to inspect a workspace directory", {
            error: error instanceof Error ? error.message : String(error),
            path: workspaceDir,
            platform: platformName,
          });
        }
        continue;
      }
      if (hasTmp) tmpPaths.push(join(workspaceDir, "tmp"));
    }
    return { tmpPaths, skipped };
  }

  /**
   * Canonical anchor of the configured workspace root: its real path when it is
   * an ordinary directory, `null` when it is absent or a link. Memoized, so the
   * host-provisioned layout is validated once (design D4).
   */
  private canonicalWorkspaceRoot(): string | undefined {
    // Only a successful resolution is memoized: an absent root is legitimate at
    // startup (the first session creates it), so a later call must be able to
    // observe it instead of pinning this manager to "no workspace root".
    if (this.canonicalRoot !== undefined) return this.canonicalRoot;
    try {
      const stat = Deno.lstatSync(this.workspacesRoot);
      if (!stat.isDirectory || stat.isSymlink) return undefined;
      this.canonicalRoot = Deno.realPathSync(this.workspacesRoot);
    } catch {
      return undefined;
    }
    return this.canonicalRoot;
  }

  /**
   * Classify one candidate `tmp/` target before touching it: `ok` when every
   * component below the canonical root is an ordinary, link-free directory and
   * the shape is a recognized workspace; `absent` when the target, a component
   * or the configured root itself does not exist; `unsafe` otherwise. Never
   * follows a link.
   */
  private inspectTmpTarget(
    tmpPath: string,
  ): { status: "ok" } | { status: "absent" } | { status: "unsafe"; reason: string } {
    const root = this.canonicalWorkspaceRoot();
    if (root === undefined) {
      // An absent configured root is harmless — the first session creates it —
      // and the trust-boundary policy treats a missing entry as a silent
      // no-op. Any other unresolvable root state stays unsafe ancestry.
      try {
        Deno.lstatSync(this.workspacesRoot);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return { status: "absent" };
      }
      return { status: "unsafe", reason: "workspace-root-unavailable" };
    }

    const rel = relative(this.workspacesRoot, tmpPath);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      return { status: "unsafe", reason: "outside-workspace-root" };
    }
    const parts = rel.split(SEPARATOR);
    const recognized = (parts.length === 3 && parts[1] !== CHANNELS_DIR) ||
      (parts.length === 4 && parts[1] === CHANNELS_DIR);
    if (!recognized) return { status: "unsafe", reason: "unrecognized-workspace-layout" };

    let current = root;
    for (const part of parts) {
      current = join(current, part);
      let stat: Deno.FileInfo;
      try {
        stat = Deno.lstatSync(current);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return { status: "absent" };
        return { status: "unsafe", reason: "unreadable-workspace-component" };
      }
      if (stat.isSymlink || !stat.isDirectory) {
        return { status: "unsafe", reason: "linked-or-replaced-component" };
      }
    }
    return { status: "ok" };
  }

  /**
   * Depth-first, depth- and node-bounded removal of the disposable entries
   * directly below `dir` (design D4). Returns whether `dir` now holds only
   * preserved entries — i.e. whether its caller may remove it.
   *
   * Disposable symlink entries are unlinked without being visited; reserved
   * engine-state names are preserved before any inspection; unexpected special
   * nodes are preserved with a warning; a missing entry is harmless; every
   * other failure warns, retains the affected candidate and lets the remaining
   * eligible candidates proceed within the same budget.
   */
  private removeDisposableChildren(
    dir: string,
    depth: number,
    state: TmpTraversalState,
    log: Logger,
  ): boolean {
    let emptied = true;
    // The directory iterator is consumed LAZILY and abandoned the moment the
    // budget is reached: materialising a whole directory (or walking a long
    // run of failing entries) would reintroduce the unbounded work the node
    // bound exists to prevent (design D4).
    try {
      for (const entry of Deno.readDirSync(dir)) {
        if (depth === 0 && RESERVED_TMP_ENTRIES[entry.name] === true) continue;
        // Every ATTEMPTED inspection consumes budget, including entries whose
        // `lstat` then fails: the bound limits the pass's work, not its luck.
        if (state.examined >= state.maxNodes) {
          state.budgetExhausted = true;
          return false;
        }
        state.examined++;

        const childPath = join(dir, entry.name);
        let stat: Deno.FileInfo;
        try {
          stat = Deno.lstatSync(childPath);
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) continue;
          log.warn("Failed to inspect a workspace tmp entry", {
            error: error instanceof Error ? error.message : String(error),
            path: childPath,
          });
          state.retained++;
          emptied = false;
          continue;
        }

        if (stat.isDirectory) {
          if (depth + 1 > state.maxDepth) {
            // The depth bound is an eligibility decision, NOT a work-budget
            // exhaustion: content deeper than the limit is intentionally
            // retained, and the pass CONTINUES with the remaining candidates so
            // an over-deep subtree can never starve its shallow siblings on this
            // and every later pass. Only the node budget stops the pass.
            state.retained++;
            emptied = false;
            continue;
          }
          if (!this.removeDisposableChildren(childPath, depth + 1, state, log)) {
            // A bound reached ANYWHERE in this subtree stops this workspace's
            // pass outright; retaining one entry is not a reason to keep
            // deleting the rest of the workspace past its limit.
            if (state.budgetExhausted) return false;
            emptied = false;
            continue;
          }
          emptied = this.removeTmpEntry(childPath, state, log) && emptied;
          continue;
        }
        if (stat.isSymlink || stat.isFile) {
          emptied = this.removeTmpEntry(childPath, state, log) && emptied;
          continue;
        }

        log.warn(
          "Preserving unexpected workspace tmp node (not a file, directory or symlink)",
          { path: childPath },
        );
        state.retained++;
        emptied = false;
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        log.warn("Failed to read a workspace tmp directory", {
          error: error instanceof Error ? error.message : String(error),
          path: dir,
        });
        state.retained++;
      }
      return false;
    }
    return emptied && !state.budgetExhausted;
  }

  /** Remove one disposable entry, reporting whether it is now gone. */
  private removeTmpEntry(
    path: string,
    state: TmpTraversalState,
    log: Logger,
  ): boolean {
    try {
      Deno.removeSync(path);
      state.removed++;
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        state.removed++;
        return true;
      }
      log.warn("Failed to remove a workspace tmp entry", {
        error: error instanceof Error ? error.message : String(error),
        path,
      });
      state.retained++;
      return false;
    }
  }
}

/** Whether a path is an existing ordinary directory (never a link). */
function isOrdinaryDirectory(path: string): boolean {
  try {
    const stat = Deno.lstatSync(path);
    return stat.isDirectory && !stat.isSymlink;
  } catch {
    return false;
  }
}

/** Yield to the event loop between startup workspace passes. */
function yieldToEventLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}
