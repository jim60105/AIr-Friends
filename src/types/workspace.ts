// src/types/workspace.ts

import type { Platform } from "./events.ts";

/**
 * Components that make up a workspace key
 */
export interface WorkspaceKeyComponents {
  platform: Platform;
  userId: string;
}

/**
 * Workspace information
 */
export interface WorkspaceInfo {
  /** Full workspace key (e.g., "discord/123456") */
  key: string;

  /** Components of the workspace key */
  components: WorkspaceKeyComponents;

  /** Absolute path to the workspace directory */
  path: string;

  /** Absolute path to the workspace tmp directory */
  tmpPath: string;

  /** Whether this workspace is for a DM conversation */
  isDm: boolean;

  /** Timestamp when workspace was first created */
  createdAt?: Date;
}

/**
 * Channel workspace information (for channel-scoped shared memories)
 */
export interface ChannelWorkspaceInfo {
  /** Channel key (e.g., "discord/general-chat") */
  key: string;
  /** Platform name */
  platform: string;
  /** Channel ID */
  channelId: string;
  /** Absolute path to the channel workspace directory */
  path: string;
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
  CHANNEL = "memory.channel.jsonl",
}
