// tests/mocks/mock-workspace.ts

import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { Platform } from "../../src/types/events.ts";

/**
 * Mock workspace manager for testing
 */
export class MockWorkspaceManager {
  private root: string;
  private files: Map<string, string> = new Map();

  constructor(root: string = "/test-workspace") {
    this.root = root;
  }

  async initialize(): Promise<void> {
    // No-op for mock
  }

  getRoot(): string {
    return this.root;
  }

  getMemoryPath(): string {
    return `${this.root}/memory`;
  }

  isWithinBounds(path: string): boolean {
    return path.startsWith(this.root);
  }

  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  /**
   * Create a mock workspace info
   */
  createWorkspaceInfo(
    platform: Platform,
    userId: string,
    channelId: string,
    isDm = false,
  ): WorkspaceInfo {
    const key = `${platform}/${userId}/${channelId}`;
    return {
      key,
      components: {
        platform,
        userId,
        channelId,
      },
      path: `${this.root}/${key}`,
      isDm,
    };
  }

  /**
   * Set a mock file
   */
  setMockFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  /**
   * Reset mock state
   */
  reset(): void {
    this.files.clear();
  }
}
