// tests/core/session-orchestrator-idle-timeout.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import * as acp from "@agentclientprotocol/sdk";
import { AgentConnector } from "@acp/agent-connector.ts";
import { SessionOrchestrator } from "@core/session-orchestrator.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { ContextAssembler } from "@core/context-assembler.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import type { Config } from "../../src/types/config.ts";
import type { AgentConnectorOptions } from "@acp/types.ts";

/**
 * Test suite for SessionOrchestrator.promptWithIdleTimeoutHandling()
 */

class TestableOrchestrator extends SessionOrchestrator {
  async testPromptWithIdleTimeoutHandling(
    connector: AgentConnector,
    sessionId: string,
    content: string | acp.ContentBlock[],
  ): Promise<acp.PromptResponse | null> {
    return await (this as unknown as {
      promptWithIdleTimeoutHandling: (
        connector: AgentConnector,
        sessionId: string,
        content: string | acp.ContentBlock[],
      ) => Promise<acp.PromptResponse | null>;
    }).promptWithIdleTimeoutHandling(connector, sessionId, content);
  }

  protected override createConnector(_options: AgentConnectorOptions): AgentConnector {
    throw new Error("Not used in tests");
  }
}

class MockAgentConnector {
  promptCalls: Array<{ sessionId: string; content: string | acp.ContentBlock[] }> = [];
  promptResults: Array<acp.PromptResponse | Error> = [];
  reconnectResult = false;
  disconnectCalled = false;

  prompt(
    sessionId: string,
    content: string | acp.ContentBlock[],
  ): Promise<acp.PromptResponse> {
    this.promptCalls.push({ sessionId, content });
    const result = this.promptResults.shift();
    if (!result) return Promise.reject(new Error("No mock result configured"));
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result);
  }

  reconnectAndResumeSession(_sessionId: string): Promise<boolean> {
    return Promise.resolve(this.reconnectResult);
  }

  disconnect(): Promise<void> {
    this.disconnectCalled = true;
    return Promise.resolve();
  }
}

function createTestOrchestrator(): { orchestrator: TestableOrchestrator; cleanup: () => void } {
  const tempDir = Deno.makeTempDirSync();
  const config: Config = {
    platforms: {
      discord: { token: "test", enabled: true },
      misskey: { host: "", token: "", enabled: false },
    },
    agent: {
      model: "test",
      systemPromptPath: "./prompts/system_reply.md",
      tokenLimit: 20000,
      defaultAgentType: "copilot",
    },
    memory: {
      searchLimit: 10,
      maxChars: 2000,
      recentMessageLimit: 20,
    },
    workspace: {
      repoPath: tempDir,
      workspacesDir: "workspaces",
    },
    logging: { level: "FATAL" },
    accessControl: { replyTo: "all", whitelist: [] },
  };

  const workspaceManager = new WorkspaceManager({
    repoPath: config.workspace.repoPath,
    workspacesDir: config.workspace.workspacesDir,
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: config.memory.searchLimit,
    maxChars: config.memory.maxChars,
  });
  const skillRegistry = new SkillRegistry(memoryStore);
  const contextAssembler = new ContextAssembler(memoryStore, {
    systemPromptPath: config.agent.systemPromptPath,
    recentMessageLimit: config.memory.recentMessageLimit,
    tokenLimit: config.agent.tokenLimit,
    memoryMaxChars: config.memory.maxChars,
  });
  const sessionRegistry = new SessionRegistry();

  const orchestrator = new TestableOrchestrator(
    workspaceManager,
    contextAssembler,
    skillRegistry,
    config,
    sessionRegistry,
    memoryStore,
  );

  return {
    orchestrator,
    cleanup: () => {
      sessionRegistry.stop();
      Deno.removeSync(tempDir, { recursive: true });
    },
  };
}

Deno.test("promptWithIdleTimeoutHandling - returns response on successful prompt", async () => {
  const { orchestrator, cleanup } = createTestOrchestrator();
  try {
    const mockConnector = new MockAgentConnector();
    const expectedResponse = { stopReason: "end_turn" } as acp.PromptResponse;
    mockConnector.promptResults.push(expectedResponse);

    const result = await orchestrator.testPromptWithIdleTimeoutHandling(
      mockConnector as unknown as AgentConnector,
      "session-1",
      "test prompt",
    );

    assertEquals(result, expectedResponse);
    assertEquals(mockConnector.promptCalls.length, 1);
  } finally {
    cleanup();
  }
});

Deno.test("promptWithIdleTimeoutHandling - re-throws non-idle-timeout errors", async () => {
  const { orchestrator, cleanup } = createTestOrchestrator();
  try {
    const mockConnector = new MockAgentConnector();
    mockConnector.promptResults.push(new Error("Network error"));

    await assertRejects(
      () =>
        orchestrator.testPromptWithIdleTimeoutHandling(
          mockConnector as unknown as AgentConnector,
          "session-1",
          "test prompt",
        ),
      Error,
      "Network error",
    );
  } finally {
    cleanup();
  }
});

Deno.test("promptWithIdleTimeoutHandling - attempts reconnect on ACP connection dead", async () => {
  const { orchestrator, cleanup } = createTestOrchestrator();
  try {
    const mockConnector = new MockAgentConnector();
    mockConnector.promptResults.push(
      new Error("ACP connection dead: no activity for 300000ms"),
    );
    mockConnector.reconnectResult = false;

    await assertRejects(
      () =>
        orchestrator.testPromptWithIdleTimeoutHandling(
          mockConnector as unknown as AgentConnector,
          "session-1",
          "test prompt",
        ),
      Error,
      "ACP session session-1 lost",
    );
  } finally {
    cleanup();
  }
});

Deno.test("promptWithIdleTimeoutHandling - attempts reconnect on agent process exit", async () => {
  const { orchestrator, cleanup } = createTestOrchestrator();
  try {
    const mockConnector = new MockAgentConnector();
    mockConnector.promptResults.push(
      new Error("ACP agent process exited unexpectedly after 300000ms"),
    );
    mockConnector.reconnectResult = false;

    await assertRejects(
      () =>
        orchestrator.testPromptWithIdleTimeoutHandling(
          mockConnector as unknown as AgentConnector,
          "session-1",
          "test prompt",
        ),
      Error,
      "ACP session session-1 lost",
    );
  } finally {
    cleanup();
  }
});

Deno.test("promptWithIdleTimeoutHandling - returns null when resumed session also fails", async () => {
  const { orchestrator, cleanup } = createTestOrchestrator();
  try {
    const mockConnector = new MockAgentConnector();
    mockConnector.promptResults.push(new Error("ACP connection dead: test"));
    mockConnector.reconnectResult = true;
    mockConnector.promptResults.push(new Error("Second prompt also failed"));

    const result = await orchestrator.testPromptWithIdleTimeoutHandling(
      mockConnector as unknown as AgentConnector,
      "session-1",
      "test prompt",
    );

    assertEquals(result, null);
    assertEquals(mockConnector.disconnectCalled, true);
  } finally {
    cleanup();
  }
});
