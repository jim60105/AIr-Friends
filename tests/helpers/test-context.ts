// tests/helpers/test-context.ts

import type { NormalizedEvent } from "../../src/types/events.ts";
import type { SkillContext } from "../../src/skills/types.ts";
import { MockPlatformAdapter } from "../mocks/mock-platform-adapter.ts";
import { MockWorkspaceManager } from "../mocks/mock-workspace.ts";

/**
 * Create a test skill context
 */
export function createTestSkillContext(
  event?: Partial<NormalizedEvent>,
): SkillContext {
  const mockEvent: NormalizedEvent = {
    platform: "discord",
    channelId: "test-channel",
    userId: "test-user",
    messageId: "test-message",
    isDm: false,
    guildId: "test-guild",
    content: "test content",
    timestamp: new Date(),
    raw: {},
    ...event,
  };

  const workspace = new MockWorkspaceManager();
  const workspaceInfo = workspace.createWorkspaceInfo(
    mockEvent.platform,
    mockEvent.userId,
    mockEvent.isDm,
  );
  const platform = new MockPlatformAdapter();

  return {
    workspace: workspaceInfo,
    platformAdapter: platform,
    channelId: mockEvent.channelId,
    userId: mockEvent.userId,
  };
}

/**
 * Create isolated test environment
 */
export interface TestEnvironment {
  workspace: MockWorkspaceManager;
  platform: MockPlatformAdapter;
  event: NormalizedEvent;
  cleanup: () => void;
}

export function createTestEnvironment(
  eventOverrides?: Partial<NormalizedEvent>,
): TestEnvironment {
  const workspace = new MockWorkspaceManager();
  const platform = new MockPlatformAdapter();
  const event: NormalizedEvent = {
    platform: "discord",
    channelId: "test-channel",
    userId: "test-user",
    messageId: "test-message",
    isDm: false,
    guildId: "test-guild",
    content: "test content",
    timestamp: new Date(),
    raw: {},
    ...eventOverrides,
  };

  return {
    workspace,
    platform,
    event,
    cleanup: () => {
      workspace.reset();
      platform.reset();
    },
  };
}
