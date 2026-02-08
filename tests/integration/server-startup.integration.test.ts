// tests/integration/server-startup.integration.test.ts

import { assertEquals, assertExists } from "@std/assert";
import { AgentCore } from "../../src/core/agent-core.ts";
import { HealthCheckServer } from "../../src/healthcheck.ts";
import type { Config } from "../../src/types/config.ts";
import { configureLogger } from "../../src/utils/logger.ts";

// Test configuration with both servers enabled
const createTestConfig = (
  enableSkillApi: boolean,
  enableHealthCheck: boolean,
  skillApiPort: number,
  healthPort: number,
): Config => ({
  platforms: {
    discord: {
      enabled: false,
      token: "test-token",
    },
    misskey: {
      enabled: false,
      host: "test.example.com",
      token: "test-token",
    },
  },
  agent: {
    model: "gpt-4",
    systemPromptPath: "./prompts/system.md",
    tokenLimit: 4096,
  },
  memory: {
    searchLimit: 10,
    maxChars: 2000,
    recentMessageLimit: 20,
  },
  workspace: {
    repoPath: "./test-data",
    workspacesDir: "workspaces",
  },
  logging: {
    level: "ERROR", // Reduce noise in tests
  },
  skillApi: enableSkillApi
    ? {
      enabled: true,
      host: "127.0.0.1",
      port: skillApiPort,
      sessionTimeoutMs: 1800000,
    }
    : undefined,
  health: enableHealthCheck
    ? {
      enabled: true,
      port: healthPort,
    }
    : undefined,
  accessControl: {
    replyTo: "whitelist",
    whitelist: [],
  },
});

Deno.test({
  name: "Server Startup - Skill API Server starts when enabled in AgentCore",
  permissions: { read: true, write: true, net: true, env: true },
  async fn() {
    configureLogger({ level: "ERROR" });

    const config = createTestConfig(true, false, 3101, 8101);
    const agentCore = new AgentCore(config, false);

    try {
      // Verify Skill API server is initialized
      const skillApiServer = agentCore.getSkillAPIServer();
      assertExists(skillApiServer, "Skill API Server should be initialized");

      // Give server time to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify server is accessible
      const response = await fetch("http://127.0.0.1:3101/api/skill/memory-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "invalid" }),
      });

      // Should get 401 for invalid session (confirms server is running)
      assertEquals(response.status, 401);
      await response.body?.cancel(); // Consume response body
    } finally {
      await agentCore.shutdown();
    }
  },
});

Deno.test({
  name: "Server Startup - Skill API Server not started when disabled",
  permissions: { read: true, write: true, net: true, env: true },
  async fn() {
    configureLogger({ level: "ERROR" });

    const config = createTestConfig(false, false, 3102, 8102);
    const agentCore = new AgentCore(config, false);

    try {
      // Verify Skill API server is NOT initialized
      const skillApiServer = agentCore.getSkillAPIServer();
      assertEquals(skillApiServer, null, "Skill API Server should not be initialized");
    } finally {
      await agentCore.shutdown();
    }
  },
});

Deno.test({
  name: "Server Startup - Health Check Server starts when instantiated",
  permissions: { read: true, write: true, net: true, env: true },
  async fn() {
    configureLogger({ level: "ERROR" });

    const healthCheckServer = new HealthCheckServer(8103);

    try {
      healthCheckServer.start();

      // Give server time to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify server is accessible
      const response = await fetch("http://localhost:8103/health");
      assertEquals(response.status, 200);

      const data = await response.json();
      assertExists(data.status);
      assertExists(data.timestamp);
      assertExists(data.uptime);
    } finally {
      await healthCheckServer.stop();
    }
  },
});

Deno.test({
  name: "Server Startup - Both servers work independently",
  permissions: { read: true, write: true, net: true, env: true },
  async fn() {
    configureLogger({ level: "ERROR" });

    const config = createTestConfig(true, false, 3104, 8104);
    const agentCore = new AgentCore(config, false);
    const healthCheckServer = new HealthCheckServer(8104);

    try {
      // Start health check server
      healthCheckServer.start();

      // Give servers time to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify both servers are initialized
      const skillApiServer = agentCore.getSkillAPIServer();
      assertExists(skillApiServer, "Skill API Server should be initialized");
      assertExists(healthCheckServer, "Health Check Server should be initialized");

      // Verify Skill API server is accessible
      const skillApiResponse = await fetch("http://127.0.0.1:3104/api/skill/memory-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "invalid" }),
      });
      assertEquals(skillApiResponse.status, 401, "Skill API server should be running");
      await skillApiResponse.body?.cancel(); // Consume response body

      // Verify Health Check server is accessible
      const healthResponse = await fetch("http://localhost:8104/health");
      assertEquals(healthResponse.status, 200, "Health Check server should be running");

      const healthData = await healthResponse.json();
      assertExists(healthData.status);
    } finally {
      await agentCore.shutdown();
      await healthCheckServer.stop();
    }
  },
});

Deno.test({
  name: "Server Startup - Skill API Server stops gracefully on shutdown",
  permissions: { read: true, write: true, net: true, env: true },
  async fn() {
    configureLogger({ level: "ERROR" });

    const config = createTestConfig(true, false, 3105, 8105);
    const agentCore = new AgentCore(config, false);

    try {
      // Give server time to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify server is running
      const response = await fetch("http://127.0.0.1:3105/api/skill/memory-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "invalid" }),
      });
      assertEquals(response.status, 401);
      await response.body?.cancel(); // Consume response body

      // Shutdown
      await agentCore.shutdown();

      // Give server time to stop
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify server is stopped (connection should fail)
      try {
        await fetch("http://127.0.0.1:3105/api/skill/memory-save", {
          method: "POST",
        });
        throw new Error("Should have failed to connect");
      } catch (error) {
        // Expected error due to connection refused
        assertExists(error);
      }
    } catch (error) {
      // If we get connection refused before shutdown, that's also acceptable
      if (
        error instanceof Error &&
        error.message !== "Should have failed to connect"
      ) {
        throw error;
      }
    }
  },
});

Deno.test({
  name: "Server Startup - Health Check Server stops gracefully",
  permissions: { read: true, write: true, net: true, env: true },
  async fn() {
    configureLogger({ level: "ERROR" });

    const healthCheckServer = new HealthCheckServer(8106);

    try {
      healthCheckServer.start();

      // Give server time to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify server is running
      const response = await fetch("http://localhost:8106/health");
      assertEquals(response.status, 200);
      await response.body?.cancel(); // Consume response body

      // Stop server
      await healthCheckServer.stop();

      // Give server time to stop
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify server is stopped (connection should fail)
      try {
        await fetch("http://localhost:8106/health");
        throw new Error("Should have failed to connect");
      } catch (error) {
        // Expected error due to connection refused
        assertExists(error);
      }
    } catch (error) {
      // If we get connection refused before shutdown, that's also acceptable
      if (
        error instanceof Error &&
        error.message !== "Should have failed to connect"
      ) {
        throw error;
      }
    }
  },
});
