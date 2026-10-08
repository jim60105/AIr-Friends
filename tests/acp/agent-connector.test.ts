// tests/acp/agent-connector.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import * as acp from "@agentclientprotocol/sdk";
import { AgentConnector } from "@acp/agent-connector.ts";
import { ChatbotClient } from "@acp/client.ts";
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

Deno.test("reconnectAndResumeSession - post-load catalog miss rejects without unstable fallback or reasoning work", async () => {
  const connector = createMockConnectorWithCapabilities({ loadSession: true });
  const rpcCalls: string[] = [];

  (connector["sessionModelIds"] as Map<string, string>).set("sess_fail", "missing-model");

  connector.connect = () => {
    connector["connection"] = {
      loadSession: () => {
        rpcCalls.push("loadSession");
        return Promise.resolve({
          configOptions: [
            {
              id: "cfg_model",
              category: "model",
              name: "Model",
              options: [{ value: "other-model", name: "Other" }],
            },
          ],
        });
      },
      unstable_setSessionModel: () => {
        rpcCalls.push("unstable_setSessionModel");
        return Promise.resolve();
      },
      setSessionConfigOption: () => {
        rpcCalls.push("setSessionConfigOption");
        return Promise.resolve({ configOptions: [] });
      },
    } as unknown as typeof connector["connection"];
    return Promise.resolve();
  };
  connector.disconnect = () => {
    (connector["sessionConfigOptions"] as Map<string, unknown>).clear();
    (connector["sessionModelIds"] as Map<string, unknown>).clear();
    return Promise.resolve();
  };

  await assertRejects(
    () =>
      connector.reconnectAndResumeSession("sess_fail", "/workspace", [], {
        reasoningEffort: "high",
      }),
    Error,
    "Requested model 'missing-model' is not offered in advertised catalog",
  );

  assertEquals(rpcCalls, ["loadSession"]);
});

Deno.test("reconnectAndResumeSession - load response without configOptions clears cache and takes unstable fallback", async () => {
  const connector = createMockConnectorWithCapabilities({ loadSession: true });
  const rpcCalls: string[] = [];

  (connector["sessionModelIds"] as Map<string, string>).set("sess_unstable", "prior-model");

  connector.connect = () => {
    connector["connection"] = {
      loadSession: () => {
        rpcCalls.push("loadSession");
        return Promise.resolve({}); // No configOptions in response
      },
      unstable_setSessionModel: (params: { modelId: string }) => {
        rpcCalls.push(`unstable_setSessionModel:${params.modelId}`);
        return Promise.resolve();
      },
    } as unknown as typeof connector["connection"];
    return Promise.resolve();
  };
  connector.disconnect = () => {
    (connector["sessionConfigOptions"] as Map<string, unknown>).clear();
    (connector["sessionModelIds"] as Map<string, unknown>).clear();
    return Promise.resolve();
  };

  const success = await connector.reconnectAndResumeSession("sess_unstable", "/workspace");
  assertEquals(success, true);
  assertEquals(rpcCalls, ["loadSession", "unstable_setSessionModel:prior-model"]);
});

Deno.test("setSessionModel - response omitting configOptions clears cache (nullish-clear semantics)", async () => {
  const connector = createMockConnectorWithCapabilities({});
  connector["connection"] = {
    setSessionConfigOption: () => Promise.resolve({}), // No configOptions returned
  } as unknown as typeof connector["connection"];

  (connector["sessionConfigOptions"] as Map<string, acp.SessionConfigOption[]>).set("s1", [
    {
      id: "cfg_model",
      category: "model",
      name: "Model",
      type: "select",
      currentValue: "m1",
      options: [{ value: "m1", name: "M1" }],
    },
  ]);

  await connector.setSessionModel("s1", "m1");
  const cached = (connector["sessionConfigOptions"] as Map<string, acp.SessionConfigOption[]>).get(
    "s1",
  );
  assertEquals(cached, []);
});

// --- setSessionModel & reconnectAndResumeSession tests ---

Deno.test("setSessionModel - stable advertised model catalog sends session/set_config_option with canonical value and refreshes cache", async () => {
  const connector = createMockConnectorWithCapabilities({});
  const setCalls: { sessionId: string; configId: string; value: string }[] = [];
  let unstableCalled = false;

  connector["connection"] = {
    setSessionConfigOption: (params: { sessionId: string; configId: string; value: string }) => {
      setCalls.push(params);
      return Promise.resolve({
        configOptions: [
          {
            id: "model",
            category: "model",
            currentValue: params.value,
            options: [{ value: "gpt-4o", name: "GPT-4o" }],
          },
        ],
      });
    },
    unstable_setSessionModel: () => {
      unstableCalled = true;
      return Promise.resolve();
    },
  } as unknown as typeof connector["connection"];

  // Seed grouped + mixed-casing model option
  (connector["sessionConfigOptions"] as Map<string, acp.SessionConfigOption[]>).set("s1", [
    {
      id: "cfg_model",
      category: "model",
      name: "Model",
      type: "select",
      currentValue: "gpt-4o",
      options: [
        {
          group: "openai",
          name: "OpenAI",
          options: [{ value: "OpenAI/GPT-4o", name: "GPT-4o" }],
        },
        { value: "anthropic/claude-3-5-sonnet", name: "Claude" },
      ] as unknown as acp.SessionConfigSelectOption[],
    },
  ]);

  await connector.setSessionModel("s1", "openai/gpt-4o");
  assertEquals(unstableCalled, false);
  assertEquals(setCalls.length, 1);
  assertEquals(setCalls[0], {
    sessionId: "s1",
    configId: "cfg_model",
    value: "OpenAI/GPT-4o",
  });
  assertEquals((connector["sessionModelIds"] as Map<string, string>).get("s1"), "OpenAI/GPT-4o");

  // Cache refreshed from response
  const cached = (connector["sessionConfigOptions"] as Map<string, acp.SessionConfigOption[]>).get(
    "s1",
  )!;
  assertEquals(cached[0].currentValue, "OpenAI/GPT-4o");
});

Deno.test("setSessionModel - stable option absence sends exact unstable request", async () => {
  const connector = createMockConnectorWithCapabilities({});
  let setConfigCalled = false;
  const unstableCalls: { sessionId: string; modelId: string }[] = [];

  connector["connection"] = {
    setSessionConfigOption: () => {
      setConfigCalled = true;
      return Promise.resolve({ configOptions: [] });
    },
    unstable_setSessionModel: (params: { sessionId: string; modelId: string }) => {
      unstableCalls.push(params);
      return Promise.resolve();
    },
  } as unknown as typeof connector["connection"];

  // No model option cached (only thought_level)
  (connector["sessionConfigOptions"] as Map<string, acp.SessionConfigOption[]>).set("s1", [
    {
      id: "thought_level",
      category: "thought_level",
      name: "Thought",
      type: "select",
      currentValue: "high",
      options: [{ value: "high", name: "High" }],
    },
  ]);

  await connector.setSessionModel("s1", "opencode/custom-model");
  assertEquals(setConfigCalled, false);
  assertEquals(unstableCalls.length, 1);
  assertEquals(unstableCalls[0], { sessionId: "s1", modelId: "opencode/custom-model" });
  assertEquals(
    (connector["sessionModelIds"] as Map<string, string>).get("s1"),
    "opencode/custom-model",
  );
});

Deno.test("setSessionModel - catalog miss rejects with explicit error and zero model-setting calls", async () => {
  const connector = createMockConnectorWithCapabilities({});
  let setConfigCalled = false;
  let unstableCalled = false;

  connector["connection"] = {
    setSessionConfigOption: () => {
      setConfigCalled = true;
      return Promise.resolve({ configOptions: [] });
    },
    unstable_setSessionModel: () => {
      unstableCalled = true;
      return Promise.resolve();
    },
  } as unknown as typeof connector["connection"];

  (connector["sessionConfigOptions"] as Map<string, acp.SessionConfigOption[]>).set("s1", [
    {
      id: "cfg_model",
      category: "model",
      name: "Model",
      type: "select",
      currentValue: "m1",
      options: [{ value: "m1", name: "M1" }],
    },
  ]);

  await assertRejects(
    () => connector.setSessionModel("s1", "non-existent-model"),
    Error,
    "Requested model 'non-existent-model' is not offered in advertised catalog",
  );

  assertEquals(setConfigCalled, false);
  assertEquals(unstableCalled, false);
});

Deno.test("setSessionModel - config_option_update between sessions makes selection use refreshed catalog", async () => {
  const connector = createMockConnectorWithCapabilities({});
  const setCalls: { sessionId: string; configId: string; value: string }[] = [];

  connector["connection"] = {
    setSessionConfigOption: (params: { sessionId: string; configId: string; value: string }) => {
      setCalls.push(params);
      return Promise.resolve({ configOptions: [] });
    },
  } as unknown as typeof connector["connection"];

  // Initial catalog lacks new-model
  (connector["sessionConfigOptions"] as Map<string, acp.SessionConfigOption[]>).set("s1", [
    {
      id: "cfg_model",
      category: "model",
      name: "Model",
      type: "select",
      currentValue: "m1",
      options: [{ value: "m1", name: "M1" }],
    },
  ]);

  await assertRejects(() => connector.setSessionModel("s1", "new-model"), Error);

  // Agent fires config_option_update (simulated via listener)
  connector["refreshSessionConfigOptions"]("s1", [
    {
      id: "cfg_model",
      category: "model",
      name: "Model",
      type: "select",
      currentValue: "m1",
      options: [
        { value: "m1", name: "M1" },
        { value: "New-Model", name: "New Model" },
      ],
    },
  ]);

  await connector.setSessionModel("s1", "new-model");
  assertEquals(setCalls.length, 1);
  assertEquals(setCalls[0].value, "New-Model");
});

Deno.test("setReasoningEffort - none/off cases end-to-end including applied on Off", async () => {
  const connector = createMockConnectorWithCapabilities({});
  const { calls } = injectThoughtLevel(connector, [
    { value: "low", name: "Low" },
    { value: "Off", name: "Off" },
  ]);

  const outcome = await connector.setReasoningEffort("s", "none");
  assertEquals(outcome, "applied");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].value, "Off");
});

Deno.test("reconnectAndResumeSession - restores cache from load response and re-sends model/reasoning", async () => {
  const connector = createMockConnectorWithCapabilities({ loadSession: true });
  const rpcOrder: string[] = [];

  // Pre-seed model ID before reconnect
  (connector["sessionModelIds"] as Map<string, string>).set(
    "sess_restore",
    "provider/target-model",
  );

  // Mock connect() and disconnect() so process spawning is bypassed
  connector.connect = () => {
    connector["connection"] = {
      loadSession: () => {
        rpcOrder.push("loadSession");
        return Promise.resolve({
          configOptions: [
            {
              id: "cfg_model",
              category: "model",
              name: "Model",
              type: "select",
              currentValue: "initial",
              options: [{ value: "provider/Target-Model", name: "Target" }],
            },
            {
              id: "thought_level",
              category: "thought_level",
              name: "Thought",
              type: "select",
              currentValue: "low",
              options: [{ value: "high", name: "High" }],
            },
          ],
        });
      },
      setSessionConfigOption: (params: { configId: string; value: string }) => {
        rpcOrder.push(`set_config_option:${params.configId}:${params.value}`);
        return Promise.resolve({
          configOptions: [
            {
              id: "cfg_model",
              category: "model",
              name: "Model",
              currentValue: params.value,
            },
            {
              id: "thought_level",
              category: "thought_level",
              name: "Thought",
              options: [{ value: "high", name: "High" }],
            },
          ],
        });
      },
    } as unknown as typeof connector["connection"];
    return Promise.resolve();
  };
  connector.disconnect = () => {
    (connector["sessionConfigOptions"] as Map<string, unknown>).clear();
    (connector["sessionModelIds"] as Map<string, unknown>).clear();
    return Promise.resolve();
  };

  const success = await connector.reconnectAndResumeSession("sess_restore", "/workspace", [], {
    reasoningEffort: "high",
  });

  assertEquals(success, true);
  assertEquals(rpcOrder, [
    "loadSession",
    "set_config_option:cfg_model:provider/Target-Model",
    "set_config_option:thought_level:high",
  ]);
  assertEquals(
    (connector["sessionModelIds"] as Map<string, string>).get("sess_restore"),
    "provider/Target-Model",
  );
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
  // Session-scoped cache: seed the entries the tests use ("s" and "sess_1").
  connector["sessionConfigOptions"] = new Map([
    ["s", [opt]],
    ["sess_1", [opt]],
  ]) as unknown as typeof connector["sessionConfigOptions"];

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

Deno.test("setReasoningEffort - extended levels applied with agent canonical casing when offered", async () => {
  const connector = createMockConnectorWithCapabilities({});
  // Agent advertises distinct-cased extended levels.
  const { calls } = injectThoughtLevel(connector, [
    { value: "medium", name: "Medium" },
    { value: "XHigh", name: "X-High" },
    { value: "MAX", name: "Max" },
  ]);

  // Configured lowercase, agent advertises "XHigh" -> sent as-is canonical "XHigh".
  const outXHigh = await connector.setReasoningEffort("s", "xhigh");
  assertEquals(outXHigh, "applied");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].value, "XHigh");

  // Configured lowercase, agent advertises "MAX" -> sent as-is canonical "MAX".
  const outMax = await connector.setReasoningEffort("s", "max");
  assertEquals(outMax, "applied");
  assertEquals(calls.length, 2);
  assertEquals(calls[1].value, "MAX");
});

Deno.test("setReasoningEffort - extended levels skipped_unavailable when not offered", async () => {
  const connector = createMockConnectorWithCapabilities({});
  // Non-empty advertised list that excludes the extended levels.
  const { calls } = injectThoughtLevel(connector, [
    { value: "low", name: "Low" },
    { value: "medium", name: "Medium" },
    { value: "high", name: "High" },
  ]);

  const outXHigh = await connector.setReasoningEffort("s", "xhigh");
  assertEquals(outXHigh, "skipped_unavailable");
  assertEquals(calls.length, 0); // not sent

  const outMax = await connector.setReasoningEffort("s", "max");
  assertEquals(outMax, "skipped_unavailable");
  assertEquals(calls.length, 0); // still not sent
});

Deno.test("setReasoningEffort - extended levels sent as-is when advertised list is empty (open-ended)", async () => {
  const connector = createMockConnectorWithCapabilities({});
  // Empty enumerated list means the option is open-ended (existing behavior for all known tokens).
  const { calls } = injectThoughtLevel(connector, []);

  const outXHigh = await connector.setReasoningEffort("s", "xhigh");
  assertEquals(outXHigh, "applied");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].value, "xhigh");
});

Deno.test("setReasoningEffort - skipped_unavailable warning includes model and agent type", async () => {
  const warns: Record<string, unknown>[] = [];
  const connector = new AgentConnector({
    agentConfig: { command: "mock-agent", args: [], cwd: "/tmp" },
    clientConfig: {
      workingDir: "/tmp/workspace",
      platform: "test",
      userId: "user1",
      channelId: "channel1",
      isDM: false,
    },
    skillRegistry: null,
    agentType: "opencode",
    logger: {
      debug: () => {},
      info: () => {},
      warn: (_msg: string, ctx?: Record<string, unknown>) => warns.push(ctx ?? {}),
      error: () => {},
    },
  });
  const { calls } = injectThoughtLevel(connector, [
    { value: "low", name: "Low" },
    { value: "high", name: "High" },
  ]);
  (connector["sessionModelIds"] as Map<string, string>).set("s", "openrouter/model/xhigh-capable");

  const outcome = await connector.setReasoningEffort("s", "max");
  assertEquals(outcome, "skipped_unavailable");
  assertEquals(calls.length, 0);
  assertEquals(warns.length, 1);
  assertEquals(warns[0].requested, "max");
  assertEquals(warns[0].model, "openrouter/model/xhigh-capable");
  assertEquals(warns[0].agentType, "opencode");
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
  const cached = (connector["sessionConfigOptions"] as unknown as Map<string, MockConfigOption[]>)
    .get("s")!;
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
  connector["sessionConfigOptions"] = new Map([["s", [
    grouped,
  ]]]) as unknown as typeof connector["sessionConfigOptions"];
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
  connector["sessionConfigOptions"] =
    new Map() as unknown as typeof connector["sessionConfigOptions"];
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
  connector["refreshSessionConfigOptions"]("s", [
    {
      id: "thought_level",
      category: "thought_level",
      currentValue: "high",
      options: [{ value: "high", name: "High" }],
    },
  ] as unknown as acp.SessionConfigOption[]);

  // Now it applies.
  assertEquals(await connector.setReasoningEffort("s", "high"), "applied");
  assertEquals(calls.length, 1);
});

Deno.test("AgentConnector - cache is single-session: refresh replaces (not appends)", () => {
  const connector = createMockConnectorWithCapabilities({});
  connector["refreshSessionConfigOptions"]("s", [
    { id: "a", category: "model", currentValue: "x", options: [{ value: "x", name: "X" }] },
  ] as unknown as acp.SessionConfigOption[]);
  connector["refreshSessionConfigOptions"]("s", [
    {
      id: "thought_level",
      category: "thought_level",
      currentValue: "high",
      options: [{ value: "high", name: "High" }],
    },
  ] as unknown as acp.SessionConfigOption[]);
  const cache = connector["sessionConfigOptions"] as unknown as Map<string, MockConfigOption[]>;
  // Replaced, not accumulated.
  const cached = cache.get("s")!;
  assertEquals(cached.length, 1);
  assertEquals(cached[0].id, "thought_level");
  // Nullish clears.
  connector["refreshSessionConfigOptions"]("s", undefined);
  assertEquals(cache.get("s")!.length, 0);
});

// --- Permission-rejection buffer lifecycle (Design Decision 2/3) ---
// createSession() clears the records; prompt() (whose reset() runs at its start)
// must NOT clear them, so the retry prompt can still read them.

Deno.test("AgentConnector - createSession clears rejection records, prompt() does NOT", async () => {
  const connector = createMockConnectorWithCapabilities({});
  const tempDir = Deno.makeTempDirSync();
  try {
    // Real ChatbotClient so the buffer semantics are the production ones.
    const client = new ChatbotClient(
      // deno-lint-ignore no-explicit-any
      { hasSkill: () => false } as any,
      // deno-lint-ignore no-explicit-any
      { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
      // deno-lint-ignore no-explicit-any
      { workingDir: tempDir, platform: "test", userId: "u", channelId: "c", isDM: false } as any,
      // deno-lint-ignore no-explicit-any
      { scriptPaths: new Set(), commandPrefixes: new Set() } as any,
    );
    connector["client"] = client;

    // Record two rejections via real denial paths (unknown tool call).
    for (let i = 0; i < 2; i++) {
      await client.requestPermission({
        sessionId: "s",
        toolCall: {
          title: `unknown_${i}`,
          kind: "other",
          status: "pending",
          content: [],
          toolCallId: `t${i}`,
          rawInput: {},
          locations: [],
        },
        options: [
          { kind: "allow_once", optionId: "a", name: "A" },
          { kind: "reject_once", optionId: "r", name: "R" },
        ],
      });
    }
    assertEquals(client.getRecentPermissionRejections().length, 2);

    // createSession() (new logical session) clears the buffer.
    connector["connection"] = {
      newSession: () =>
        Promise.resolve({
          sessionId: "sess_1",
          protocolVersion: 1,
          agentCapabilities: {},
          authMethods: [],
        }),
      setSessionConfigOption: () => Promise.resolve({ configOptions: [] }),
    } as unknown as typeof connector["connection"];
    await connector.createSession([]);
    assertEquals(client.getRecentPermissionRejections().length, 0, "createSession clears");

    // Record again, then prompt() — its reset() must NOT clear the records.
    await client.requestPermission({
      sessionId: "s",
      toolCall: {
        title: "unknown_2",
        kind: "other",
        status: "pending",
        content: [],
        toolCallId: "t2",
        rawInput: {},
        locations: [],
      },
      options: [
        { kind: "allow_once", optionId: "a", name: "A" },
        { kind: "reject_once", optionId: "r", name: "R" },
      ],
    });
    connector["connection"] = {
      prompt: () => Promise.resolve({ stopReason: "end_turn" }),
    } as unknown as typeof connector["connection"];
    await connector.prompt("sess_1", "retry prompt");
    assertEquals(
      client.getRecentPermissionRejections().length,
      1,
      "prompt() reset() must NOT clear rejection records",
    );
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});
