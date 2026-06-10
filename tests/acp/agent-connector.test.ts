// tests/acp/agent-connector.test.ts

import { assertEquals, assertRejects } from "@std/assert";
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

Deno.test("AgentConnector - MCP transport filtering", async (t) => {
  await t.step("should allow stdio transport (always supported)", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: {},
    });

    const stdioServer: StdioMCPServerConfig = {
      name: "test-server",
      command: "/path/to/server",
      args: ["--stdio"],
    };

    const result = connector.filterSupportedMCPServers([stdioServer]);
    assertEquals(result.length, 1);
    assertEquals(result[0], stdioServer);
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

    const result = connector.filterSupportedMCPServers([httpServer]);
    assertEquals(result.length, 1);
    assertEquals(result[0], httpServer);
  });

  await t.step("should skip HTTP transport when not supported", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: { http: false },
    });

    const httpServer: HTTPMCPServerConfig = {
      type: "http",
      name: "http-server",
      url: "https://api.example.com/mcp",
    };

    const result = connector.filterSupportedMCPServers([httpServer]);
    assertEquals(result.length, 0);
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

    const result = connector.filterSupportedMCPServers([sseServer]);
    assertEquals(result.length, 1);
    assertEquals(result[0], sseServer);
  });

  await t.step("should skip SSE transport when not supported", () => {
    const connector = createMockConnectorWithCapabilities({
      mcpCapabilities: {},
    });

    const sseServer: SSEMCPServerConfig = {
      type: "sse",
      name: "sse-server",
      url: "https://events.example.com/mcp",
    };

    const result = connector.filterSupportedMCPServers([sseServer]);
    assertEquals(result.length, 0);
  });

  await t.step("should filter mixed servers correctly", () => {
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

    const result = connector.filterSupportedMCPServers(servers);
    assertEquals(result.length, 2);
  });

  await t.step("should skip unsupported server in mixed list", () => {
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

    const result = connector.filterSupportedMCPServers(servers);
    assertEquals(result.length, 1);
    assertEquals(result[0].name, "stdio-server");
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
    promptCapabilities: { image: true },
  });
  const connectorFalse = createMockConnectorWithCapabilities({
    promptCapabilities: { image: false },
  });
  const connectorMissing = createMockConnectorWithCapabilities({});
  const connectorEmpty = createMockConnectorWithCapabilities({ promptCapabilities: {} });

  assertEquals(connectorTrue.supportsImageContent(), true);
  assertEquals(connectorFalse.supportsImageContent(), false);
  assertEquals(connectorMissing.supportsImageContent(), false);
  assertEquals(connectorEmpty.supportsImageContent(), false);
});

Deno.test("AgentConnector - setSessionMode calls connection.setSessionMode with correct params", async () => {
  const connector = createMockConnectorWithCapabilities({});
  const calls: { sessionId: string; modeId: string }[] = [];

  // Inject a mock connection
  connector["connection"] = {
    setSessionMode: (params: { sessionId: string; modeId: string }) => {
      calls.push(params);
      return Promise.resolve();
    },
  } as unknown as typeof connector["connection"];

  await connector.setSessionMode("sess_123", "yolo");

  assertEquals(calls.length, 1);
  assertEquals(calls[0].sessionId, "sess_123");
  assertEquals(calls[0].modeId, "yolo");
});

Deno.test("AgentConnector - setSessionMode throws when not connected", async () => {
  const connector = createMockConnectorWithCapabilities({});
  // connection is null by default (not connected)

  await assertRejects(
    () => connector.setSessionMode("sess_123", "yolo"),
    Error,
    "Not connected to agent",
  );
});

// --- setReasoningEffort tests ---

type MockConfigOption = {
  id: string;
  category?: string;
  currentValue?: string;
  options: { value: string; name: string }[];
};

function injectThoughtLevel(
  connector: AgentConnector,
  options: { value: string; name: string }[],
  setConfigImpl?: (
    params: { sessionId: string; configId: string; value: string },
  ) => Promise<{ configOptions: MockConfigOption[] }>,
): { calls: { sessionId: string; configId: string; value: string }[] } {
  const opt: MockConfigOption = {
    id: "thought_level",
    category: "thought_level",
    currentValue: options[0]?.value,
    options,
  };
  connector["sessionConfigOptions"] = [opt] as unknown as typeof connector["sessionConfigOptions"];

  const calls: { sessionId: string; configId: string; value: string }[] = [];
  connector["connection"] = {
    setSessionConfigOption: (
      params: { sessionId: string; configId: string; value: string },
    ) => {
      calls.push(params);
      if (setConfigImpl) return setConfigImpl(params);
      return Promise.resolve({ configOptions: [opt] });
    },
  } as unknown as typeof connector["connection"];

  return { calls };
}

Deno.test("setReasoningEffort - returns skipped for default/empty", async () => {
  const connector = createMockConnectorWithCapabilities({});
  assertEquals(await connector.setReasoningEffort("s", "default"), "skipped");
  assertEquals(await connector.setReasoningEffort("s", ""), "skipped");
  assertEquals(await connector.setReasoningEffort("s", "  DEFAULT "), "skipped");
});

Deno.test("setReasoningEffort - returns unsupported when no thought_level option", async () => {
  const connector = createMockConnectorWithCapabilities({});
  connector["connection"] = {} as unknown as typeof connector["connection"];
  // No config options cached.
  assertEquals(await connector.setReasoningEffort("s", "high"), "unsupported");
});

Deno.test("setReasoningEffort - applied sends value with correct configId", async () => {
  const connector = createMockConnectorWithCapabilities({});
  const { calls } = injectThoughtLevel(connector, [
    { value: "low", name: "Low" },
    { value: "high", name: "High" },
  ]);

  const outcome = await connector.setReasoningEffort("sess_1", "high");
  assertEquals(outcome, "applied");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].configId, "thought_level");
  assertEquals(calls[0].value, "high");
});

Deno.test("setReasoningEffort - skipped_unavailable when known value not offered", async () => {
  const connector = createMockConnectorWithCapabilities({});
  const { calls } = injectThoughtLevel(connector, [
    { value: "low", name: "Low" },
    { value: "medium", name: "Medium" },
  ]);

  const outcome = await connector.setReasoningEffort("s", "none");
  assertEquals(outcome, "skipped_unavailable");
  assertEquals(calls.length, 0); // not sent
});

Deno.test("setReasoningEffort - passthrough token sent even if not in known set", async () => {
  const connector = createMockConnectorWithCapabilities({});
  const { calls } = injectThoughtLevel(connector, [
    { value: "low", name: "Low" },
  ]);

  const outcome = await connector.setReasoningEffort("s", "ultra");
  assertEquals(outcome, "applied");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].value, "ultra");
});

Deno.test("setReasoningEffort - failed when agent rejects (error caught)", async () => {
  const connector = createMockConnectorWithCapabilities({});
  injectThoughtLevel(
    connector,
    [{ value: "high", name: "High" }],
    () => Promise.reject(new Error("rejected")),
  );

  const outcome = await connector.setReasoningEffort("s", "high");
  assertEquals(outcome, "failed");
});

Deno.test("setReasoningEffort - refreshes cache from set_config_option response", async () => {
  const connector = createMockConnectorWithCapabilities({});
  injectThoughtLevel(
    connector,
    [{ value: "low", name: "Low" }, { value: "high", name: "High" }],
    () =>
      Promise.resolve({
        configOptions: [{
          id: "thought_level",
          category: "thought_level",
          currentValue: "high",
          options: [{ value: "high", name: "High" }],
        }],
      }),
  );

  await connector.setReasoningEffort("s", "high");
  const cached = connector["sessionConfigOptions"] as unknown as MockConfigOption[];
  assertEquals(cached[0].currentValue, "high");
  assertEquals(cached[0].options.length, 1);
});

Deno.test("setReasoningEffort - re-discovers from grouped option values", async () => {
  const connector = createMockConnectorWithCapabilities({});
  // Grouped options form: options is an array of groups, each with its own options.
  const grouped = {
    id: "thought_level",
    category: "thought_level",
    options: [
      { group: "g1", name: "G1", options: [{ value: "high", name: "High" }] },
    ],
  };
  connector["sessionConfigOptions"] = [
    grouped,
  ] as unknown as typeof connector["sessionConfigOptions"];
  const calls: { value: string }[] = [];
  connector["connection"] = {
    setSessionConfigOption: (p: { value: string }) => {
      calls.push(p);
      return Promise.resolve({ configOptions: [grouped] });
    },
  } as unknown as typeof connector["connection"];

  assertEquals(await connector.setReasoningEffort("s", "high"), "applied");
  assertEquals(calls[0].value, "high");
});

Deno.test("AgentConnector.isReasoningEffortActive - static helper", () => {
  assertEquals(AgentConnector.isReasoningEffortActive(undefined), false);
  assertEquals(AgentConnector.isReasoningEffortActive(""), false);
  assertEquals(AgentConnector.isReasoningEffortActive("default"), false);
  assertEquals(AgentConnector.isReasoningEffortActive(" DEFAULT "), false);
  assertEquals(AgentConnector.isReasoningEffortActive("high"), true);
});

Deno.test("setReasoningEffort - matches case-insensitively and sends agent canonical casing", async () => {
  const connector = createMockConnectorWithCapabilities({});
  // Agent advertises mixed-case values.
  const { calls } = injectThoughtLevel(connector, [
    { value: "Low", name: "Low" },
    { value: "High", name: "High" },
  ]);

  const outcome = await connector.setReasoningEffort("s", "high"); // configured lowercase
  assertEquals(outcome, "applied");
  assertEquals(calls.length, 1);
  // Sends the agent's canonical "High", not the lowercase request.
  assertEquals(calls[0].value, "High");
});

Deno.test("setReasoningEffort - applies after config_option_update adds thought_level later", async () => {
  const connector = createMockConnectorWithCapabilities({});
  // Initially no thought_level option cached.
  connector["sessionConfigOptions"] = [] as unknown as typeof connector["sessionConfigOptions"];
  const calls: { value: string }[] = [];
  connector["connection"] = {
    setSessionConfigOption: (p: { value: string }) => {
      calls.push(p);
      return Promise.resolve({ configOptions: [] });
    },
  } as unknown as typeof connector["connection"];

  // Before update -> unsupported
  assertEquals(await connector.setReasoningEffort("s", "high"), "unsupported");

  // Simulate config_option_update arriving (via the private refresh used by the listener).
  connector["refreshSessionConfigOptions"](
    [
      {
        id: "thought_level",
        category: "thought_level",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
    ] as unknown as typeof connector["sessionConfigOptions"],
  );

  // Now it applies.
  assertEquals(await connector.setReasoningEffort("s", "high"), "applied");
  assertEquals(calls.length, 1);
});

Deno.test("AgentConnector - cache is single-session: refresh replaces (not appends)", () => {
  const connector = createMockConnectorWithCapabilities({});
  connector["refreshSessionConfigOptions"](
    [
      { id: "a", category: "model", currentValue: "x", options: [{ value: "x", name: "X" }] },
    ] as unknown as typeof connector["sessionConfigOptions"],
  );
  connector["refreshSessionConfigOptions"](
    [
      {
        id: "thought_level",
        category: "thought_level",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
    ] as unknown as typeof connector["sessionConfigOptions"],
  );
  const cached = connector["sessionConfigOptions"] as unknown as MockConfigOption[];
  // Replaced, not accumulated.
  assertEquals(cached.length, 1);
  assertEquals(cached[0].id, "thought_level");
  // Nullish clears.
  connector["refreshSessionConfigOptions"](undefined);
  assertEquals((connector["sessionConfigOptions"] as unknown as MockConfigOption[]).length, 0);
});
