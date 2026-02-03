// src/core/workspace-manager.ts

import { join, resolve } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import {
  ensureDirectory,
  pathExists,
  sanitizePathComponent,
  validatePathWithinBoundary,
} from "@utils/path-validator.ts";
import type {
  WorkspaceInfo,
  WorkspaceKeyComponents,
  WorkspaceManagerConfig,
} from "../types/workspace.ts";
import { MemoryFileType } from "../types/workspace.ts";
import type { NormalizedEvent } from "../types/events.ts";
import { ErrorCode, WorkspaceError } from "../types/errors.ts";

const logger = createLogger("WorkspaceManager");

export class WorkspaceManager {
  private readonly repoPath: string;
  private readonly workspacesRoot: string;

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
   * Format: {platform}/{user_id}/{channel_id}
   */
  computeWorkspaceKey(components: WorkspaceKeyComponents): string {
    const { platform, userId, channelId } = components;

    // Sanitize each component to prevent path traversal
    const safePlatform = sanitizePathComponent(platform);
    const safeUserId = sanitizePathComponent(userId);
    const safeChannelId = sanitizePathComponent(channelId);

    return `${safePlatform}/${safeUserId}/${safeChannelId}`;
  }

  /**
   * Get workspace key from a normalized event
   */
  getWorkspaceKeyFromEvent(event: NormalizedEvent): string {
    return this.computeWorkspaceKey({
      platform: event.platform,
      userId: event.userId,
      channelId: event.channelId,
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
      logger.info("Creating new workspace", { workspaceKey: key });
      await ensureDirectory(path);
      createdAt = new Date();

      // Create empty memory files
      await this.initializeWorkspaceFiles(path, event.isDm);
    } else {
      // Try to get creation time from directory stat
      try {
        const stat = await Deno.stat(path);
        createdAt = stat.birthtime ?? stat.mtime ?? undefined;
      } catch {
        // Ignore stat errors
      }
    }

    return {
      key,
      components: {
        platform: event.platform,
        userId: event.userId,
        channelId: event.channelId,
      },
      path,
      isDm: event.isDm,
      createdAt,
    };
  }

  /**
   * Initialize workspace with required files
   */
  private async initializeWorkspaceFiles(
    workspacePath: string,
    isDm: boolean,
  ): Promise<void> {
    // Create public memory file
    const publicMemoryPath = join(workspacePath, MemoryFileType.PUBLIC);
    if (!(await pathExists(publicMemoryPath))) {
      await Deno.writeTextFile(publicMemoryPath, "");
    }

    // Create private memory file only for DM workspaces
    if (isDm) {
      const privateMemoryPath = join(workspacePath, MemoryFileType.PRIVATE);
      if (!(await pathExists(privateMemoryPath))) {
        await Deno.writeTextFile(privateMemoryPath, "");
      }
    }

    logger.debug("Workspace files initialized", { workspacePath, isDm });
  }

  /**
   * Get memory file path for a workspace
   * Returns null for private memory in non-DM contexts
   */
  getMemoryFilePath(
    workspace: WorkspaceInfo,
    fileType: MemoryFileType,
  ): string | null {
    // Private memory only accessible in DM contexts
    if (fileType === MemoryFileType.PRIVATE && !workspace.isDm) {
      logger.warn("Attempted to access private memory in non-DM context", {
        workspaceKey: workspace.key,
      });
      return null;
    }

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

          const userPath = join(platformPath, userEntry.name);

          for await (const channelEntry of Deno.readDir(userPath)) {
            if (!channelEntry.isDirectory) continue;

            workspaces.push(
              `${platformEntry.name}/${userEntry.name}/${channelEntry.name}`,
            );
          }
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    return workspaces;
  }
}
