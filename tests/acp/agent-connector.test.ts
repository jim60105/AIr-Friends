// tests/acp/agent-connector.test.ts

import { assertEquals } from "@std/assert";
import { AgentConnector } from "@acp/agent-connector.ts";
import type {
  AgentCapabilities,
  HTTPMCPServerConfig,
  MCPServerConfig,
  SSEMCPServerConfig,
  StdioMCPServerConfig,
} from "@acp/types.ts";

/**
 * Test suite for AgentConnector transport capability verification
 * Verifies that the ACP Client properly checks Agent capabilities before using HTTP/SSE transports
 */

Deno.test("AgentConnector - capabilities checking", async (t) => {
  await t.step("should store capabilities after initialization", () => {
    // This is tested implicitly through the other tests
    // since we need capabilities to be stored for validation to work
  });

  await t.step("should detect HTTP transport support correctly", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: { http: true },
    });

    assertEquals(connector.supportsHTTPTransport(), true);
  });

  await t.step("should detect HTTP transport not supported", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: { http: false },
    });

    assertEquals(connector.supportsHTTPTransport(), false);
  });

  await t.step("should detect HTTP transport not supported when missing", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: {},
    });

    assertEquals(connector.supportsHTTPTransport(), false);
  });

  await t.step("should detect SSE transport support correctly", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: { sse: true },
    });

    assertEquals(connector.supportsSSETransport(), true);
  });

  await t.step("should detect SSE transport not supported", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: { sse: false },
    });

    assertEquals(connector.supportsSSETransport(), false);
  });

  await t.step("should detect loadSession capability", () => {
    const connector = createMockConnectorWithCapabilities({
      loadSession: true,
    });

    assertEquals(connector.supportsLoadSession(), true);
  });
});

Deno.test("AgentConnector - MCP transport validation", async (t) => {
  await t.step("should allow stdio transport (always supported)", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: {},
    });

    const stdioServer: StdioMCPServerConfig = {
      name: "test-server",
      command: "/path/to/server",
      args: ["--stdio"],
    };

    // Should not throw
    connector["validateMCPServerTransports"]([stdioServer]);
  });

  await t.step("should allow HTTP transport when supported", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: { http: true },
    });

    const httpServer: HTTPMCPServerConfig = {
      type: "http",
      name: "http-server",
      url: "https://api.example.com/mcp",
      headers: [],
    };

    // Should not throw
    connector["validateMCPServerTransports"]([httpServer]);
  });

  await t.step("should reject HTTP transport when not supported", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: { http: false },
    });

    const httpServer: HTTPMCPServerConfig = {
      type: "http",
      name: "http-server",
      url: "https://api.example.com/mcp",
    };

    try {
      connector["validateMCPServerTransports"]([httpServer]);
      throw new Error("Should have thrown error");
    } catch (error) {
      assertEquals(
        (error as Error).message,
        "Agent does not support HTTP transport for MCP servers (server: http-server)",
      );
    }
  });

  await t.step("should allow SSE transport when supported", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: { sse: true },
    });

    const sseServer: SSEMCPServerConfig = {
      type: "sse",
      name: "sse-server",
      url: "https://events.example.com/mcp",
    };

    // Should not throw
    connector["validateMCPServerTransports"]([sseServer]);
  });

  await t.step("should reject SSE transport when not supported", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: {},
    });

    const sseServer: SSEMCPServerConfig = {
      type: "sse",
      name: "sse-server",
      url: "https://events.example.com/mcp",
    };

    try {
      connector["validateMCPServerTransports"]([sseServer]);
      throw new Error("Should have thrown error");
    } catch (error) {
      assertEquals(
        (error as Error).message,
        "Agent does not support SSE transport for MCP servers (server: sse-server)",
      );
    }
  });

  await t.step("should validate multiple servers correctly", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: { http: true, sse: false },
    });

    const servers: MCPServerConfig[] = [
      {
        name: "stdio-server",
        command: "/path/to/server",
        args: [],
      },
      {
        type: "http",
        name: "http-server",
        url: "https://api.example.com/mcp",
      },
    ];

    // Should not throw - stdio always works, http is supported
    connector["validateMCPServerTransports"](servers);
  });

  await t.step("should reject when one server uses unsupported transport", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: { http: true, sse: false },
    });

    const servers: MCPServerConfig[] = [
      {
        name: "stdio-server",
        command: "/path/to/server",
        args: [],
      },
      {
        type: "sse",
        name: "sse-server",
        url: "https://events.example.com/mcp",
      },
    ];

    try {
      connector["validateMCPServerTransports"](servers);
      throw new Error("Should have thrown error");
    } catch (error) {
      assertEquals(
        (error as Error).message,
        "Agent does not support SSE transport for MCP servers (server: sse-server)",
      );
    }
  });
});

Deno.test("AgentConnector - MCP config conversion", async (t) => {
  await t.step("should convert stdio config correctly", () => {
    const connector = createMockConnectorWithCapabilities({});

    const stdioServer: StdioMCPServerConfig = {
      name: "test-server",
      command: "/usr/bin/mcp-server",
      args: ["--mode", "stdio"],
      env: [{ name: "API_KEY", value: "secret" }],
    };

    const converted = connector["convertMCPServerConfig"](stdioServer);

    assertEquals(converted, {
      name: "test-server",
      command: "/usr/bin/mcp-server",
      args: ["--mode", "stdio"],
      env: [{ name: "API_KEY", value: "secret" }],
    });
  });

  await t.step("should convert HTTP config correctly", () => {
    const connector = createMockConnectorWithCapabilities({});

    const httpServer: HTTPMCPServerConfig = {
      type: "http",
      name: "http-server",
      url: "https://api.example.com/mcp",
      headers: [
        { name: "Authorization", value: "Bearer token" },
        { name: "Content-Type", value: "application/json" },
      ],
    };

    const converted = connector["convertMCPServerConfig"](httpServer);

    assertEquals(converted, {
      type: "http",
      name: "http-server",
      url: "https://api.example.com/mcp",
      headers: [
        { name: "Authorization", value: "Bearer token" },
        { name: "Content-Type", value: "application/json" },
      ],
    });
  });

  await t.step("should handle missing optional fields", () => {
    const connector = createMockConnectorWithCapabilities({});

    const stdioServer: StdioMCPServerConfig = {
      name: "simple-server",
      command: "/usr/bin/server",
      args: [],
    };

    const converted = connector["convertMCPServerConfig"](stdioServer);

    assertEquals(converted, {
      name: "simple-server",
      command: "/usr/bin/server",
      args: [],
      env: [],
    });
  });
});

/**
 * Helper: Create a mock AgentConnector with specific capabilities
 * This allows us to test capability checking without spawning real agent processes
 */
function createMockConnectorWithCapabilities(
  capabilities: AgentCapabilities,
): AgentConnector {
  const connector = new AgentConnector({
    agentConfig: {
      command: "mock-agent",
      args: [],
      cwd: "/tmp",
    },
    clientConfig: {
      workingDir: "/tmp/workspace",
      platform: "test",
      userId: "user1",
      channelId: "channel1",
      isDM: false,
    },
    skillRegistry: null,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  });

  // Inject capabilities directly (bypassing initialization)
  connector["capabilities"] = capabilities;

  return connector;
}

Deno.test("AgentConnector - supportsImageContent cases", () => {
  const connectorTrue = createMockConnectorWithCapabilities({
    promptCapabilities: { image: true } as any,
  });
  const connectorFalse = createMockConnectorWithCapabilities({
    promptCapabilities: { image: false } as any,
  });
  const connectorMissing = createMockConnectorWithCapabilities({} as any);
  const connectorEmpty = createMockConnectorWithCapabilities({ promptCapabilities: {} as any });

  // @ts-ignore access private method
  assertEquals(connectorTrue.supportsImageContent(), true);
  // @ts-ignore
  assertEquals(connectorFalse.supportsImageContent(), false);
  // @ts-ignore
  assertEquals(connectorMissing.supportsImageContent(), false);
  // @ts-ignore
  assertEquals(connectorEmpty.supportsImageContent(), false);
});
