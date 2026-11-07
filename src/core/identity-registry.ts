// src/core/identity-registry.ts

import { join } from "@std/path";
import type { IdentityGroupConfig } from "../types/config.ts";
import type { Platform } from "../types/events.ts";
import type { WorkspaceInfo } from "../types/workspace.ts";
import type { WorkspaceManager } from "./workspace-manager.ts";

/** Split a canonical `{platform}/{userId}` key at its first separator. */
function splitWorkspaceKey(key: string): [string, string] {
  const index = key.indexOf("/");
  return index < 0 ? [key, ""] : [key.slice(0, index), key.slice(index + 1)];
}

/**
 * Read-only lookup over operator-declared identity groups (identity-linked memory).
 *
 * Answers "which group is this workspace in" and "which other workspaces share its
 * group". It never creates a directory, workspace or file, and never reads one: a
 * linked account that has never interacted with the bot simply resolves to a path
 * whose memory files do not exist.
 */
export class IdentityRegistry {
  private readonly groups = new Map<string, IdentityGroupConfig>();
  private readonly workspaceManager: WorkspaceManager;
  /** Number of configured groups, for startup observability. */
  readonly groupCount: number;

  constructor(groups: readonly IdentityGroupConfig[], workspaceManager: WorkspaceManager) {
    this.workspaceManager = workspaceManager;
    this.groupCount = groups.length;

    for (const group of groups) {
      for (const account of group.accounts) {
        const key = this.keyOf(account);
        // Defensive: the config loader already rejects a duplicate account.
        if (this.groups.has(key)) {
          throw new Error(`Identity account listed in more than one group: ${group.id}`);
        }
        this.groups.set(key, group);
      }
    }
  }

  /** Group label of a workspace key, when the account is linked. */
  groupOf(workspaceKey: string): string | undefined {
    return this.groups.get(workspaceKey)?.id;
  }

  /**
   * Other workspaces of the current account's group, in configuration order.
   * Empty when the account is not linked or the group has one account.
   */
  linkedWorkspaces(current: WorkspaceInfo): WorkspaceInfo[] {
    const group = this.groups.get(current.key);
    if (group === undefined) return [];

    return group.accounts
      .filter((account) => this.keyOf(account) !== current.key)
      .map((account) => this.workspaceInfoFor(account, current.isDm));
  }

  private keyOf(accountKey: string): string {
    const [platform, userId] = splitWorkspaceKey(accountKey);
    return this.workspaceManager.computeWorkspaceKey({ platform: platform as Platform, userId });
  }

  private workspaceInfoFor(accountKey: string, isDm: boolean): WorkspaceInfo {
    const [platform, userId] = splitWorkspaceKey(accountKey);
    const key = this.workspaceManager.computeWorkspaceKey({
      platform: platform as Platform,
      userId,
    });
    const path = this.workspaceManager.getWorkspacePath(key);
    return {
      key,
      components: { platform: platform as Platform, userId },
      path,
      tmpPath: join(path, "tmp"),
      isDm,
    };
  }
}
