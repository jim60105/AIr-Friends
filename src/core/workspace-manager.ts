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
      },
      path,
      isDm: event.isDm,
      createdAt,
    };
  }

  /**
   * Initialize workspace with required files
   * Both public and private memory files are always created since
   * the same workspace serves both DM and non-DM interactions.
   */
  private async initializeWorkspaceFiles(
    workspacePath: string,
    _isDm: boolean,
  ): Promise<void> {
    // Create public memory file
    const publicMemoryPath = join(workspacePath, MemoryFileType.PUBLIC);
    if (!(await pathExists(publicMemoryPath))) {
      await Deno.writeTextFile(publicMemoryPath, "");
    }

    // Always create private memory file (workspace is per-user, may be used in DM later)
    const privateMemoryPath = join(workspacePath, MemoryFileType.PRIVATE);
    if (!(await pathExists(privateMemoryPath))) {
      await Deno.writeTextFile(privateMemoryPath, "");
    }

    logger.debug("Workspace files initialized", { workspacePath });
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
}
