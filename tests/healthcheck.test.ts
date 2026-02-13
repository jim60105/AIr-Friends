// tests/healthcheck.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import { HealthCheckServer } from "../src/healthcheck.ts";

// Helper to find an available port
function getTestPort(): number {
  return 9100 + Math.floor(Math.random() * 900);
}

Deno.test("HealthCheckServer - /metrics returns prometheus format when enabled", async () => {
  const port = getTestPort();
  const server = new HealthCheckServer(port, { enabled: true, path: "/metrics" });
  server.start();
  try {
    // Wait for server to be ready
    await new Promise((r) => setTimeout(r, 200));
    const resp = await fetch(`http://localhost:${port}/metrics`);
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.headers.get("content-type") ?? "", "text/plain");
    const body = await resp.text();
    assertStringIncludes(body, "airfriends_sessions_total");
  } finally {
    await server.stop();
  }
});

Deno.test("HealthCheckServer - /metrics returns 404 when disabled", async () => {
  const port = getTestPort();
  const server = new HealthCheckServer(port);
  server.start();
  try {
    await new Promise((r) => setTimeout(r, 200));
    const resp = await fetch(`http://localhost:${port}/metrics`);
    assertEquals(resp.status, 404);
    await resp.body?.cancel();
  } finally {
    await server.stop();
  }
});

Deno.test("HealthCheckServer - custom metrics path works", async () => {
  const port = getTestPort();
  const server = new HealthCheckServer(port, { enabled: true, path: "/custom-metrics" });
  server.start();
  try {
    await new Promise((r) => setTimeout(r, 200));
    // Default path should 404
    const resp1 = await fetch(`http://localhost:${port}/metrics`);
    assertEquals(resp1.status, 404);
    await resp1.body?.cancel();

    // Custom path should work
    const resp2 = await fetch(`http://localhost:${port}/custom-metrics`);
    assertEquals(resp2.status, 200);
    const body = await resp2.text();
    assertStringIncludes(body, "airfriends_");
  } finally {
    await server.stop();
  }
});

Deno.test("HealthCheckServer - /health still works with metrics enabled", async () => {
  const port = getTestPort();
  const server = new HealthCheckServer(port, { enabled: true, path: "/metrics" });
  server.start();
  try {
    await new Promise((r) => setTimeout(r, 200));
    const resp = await fetch(`http://localhost:${port}/health`);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(typeof body.status, "string");
  } finally {
    await server.stop();
  }
});
