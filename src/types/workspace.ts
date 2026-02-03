// src/types/workspace.ts

import type { Platform } from "./events.ts";

/**
 * Components that make up a workspace key
 */
export interface WorkspaceKeyComponents {
  platform: Platform;
  userId: string;
  channelId: string;
}

/**
 * Workspace information
 */
export interface WorkspaceInfo {
  /** Full workspace key (e.g., "discord/123456/789012") */
  key: string;

  /** Components of the workspace key */
  components: WorkspaceKeyComponents;

  /** Absolute path to the workspace directory */
  path: string;

  /** Whether this workspace is for a DM conversation */
  isDm: boolean;

  /** Timestamp when workspace was first created */
  createdAt?: Date;
}

/**
 * Workspace manager configuration
 */
export interface WorkspaceManagerConfig {
  /** Root path for all workspaces (local repo) */
  repoPath: string;

  /** Directory name under repoPath for workspaces */
  workspacesDir: string;
}

/**
 * Memory file types in a workspace
 */
export enum MemoryFileType {
  PUBLIC = "memory.public.jsonl",
  PRIVATE = "memory.private.jsonl",
}
