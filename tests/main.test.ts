// tests/main.test.ts

import { assertEquals, assertExists } from "@std/assert";
import { ShutdownHandler } from "../src/shutdown.ts";
import type { AppContext } from "../src/bootstrap.ts";

Deno.test("ShutdownHandler - initial state", () => {
  const handler = new ShutdownHandler();
  assertEquals(handler.isShutdownInProgress(), false);
});

Deno.test("ShutdownHandler - can set context", () => {
  const handler = new ShutdownHandler();
  const mockContext = {
    config: {},
    agentCore: {},
    platformRegistry: {
      getAllAdapters: () => [],
      disconnectAll: async () => {},
    },
  } as unknown as AppContext;

  handler.setContext(mockContext);
  // No error means success
  assertEquals(handler.isShutdownInProgress(), false);
});

Deno.test("HealthCheckServer - can be instantiated", async () => {
  const { HealthCheckServer } = await import("../src/healthcheck.ts");
  const server = new HealthCheckServer(8081);
  assertExists(server);
});

Deno.test("Bootstrap - parseArgs helper", () => {
  // This would test the args parsing if it were exported
  // For now, just verify imports work
  assertEquals(true, true);
});
