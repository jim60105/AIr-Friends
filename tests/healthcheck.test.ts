// tests/healthcheck.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import { HealthCheckServer } from "../src/healthcheck.ts";
import { metricsRegistry } from "../src/utils/metrics.ts";
import { DEV_SOURCE_SKILLS_ROOT } from "../src/core/skills-root.ts";

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

Deno.test("HealthCheckServer - /readyz without context returns 503", async () => {
  const port = getTestPort();
  const server = new HealthCheckServer(port);
  server.start();
  try {
    await new Promise((r) => setTimeout(r, 200));
    const resp = await fetch(`http://localhost:${port}/readyz`);
    assertEquals(resp.status, 503);
    const body = await resp.json();
    assertEquals(body.ready, false);
  } finally {
    await server.stop();
  }
});

Deno.test("HealthCheckServer - checkSkillReadiness returns empty checks without context", async () => {
  const server = new HealthCheckServer(9999);
  const result = await server.checkSkillReadiness();
  assertEquals(result.allReady, true);
  assertEquals(result.checks.length, 0);
});

Deno.test("HealthCheckServer - checkSkillReadiness caches results", async () => {
  const server = new HealthCheckServer(9999);
  const result1 = await server.checkSkillReadiness();
  const result2 = await server.checkSkillReadiness();
  assertEquals(result1, result2);
});

Deno.test("HealthCheckServer - skill readiness updates Prometheus gauge", async () => {
  const server = new HealthCheckServer(9999);
  // Run check to populate gauges (no context = empty checks, but gauge code path is exercised)
  await server.checkSkillReadiness();

  // Verify the gauge metric exists in registry output
  const metrics = await metricsRegistry.metrics();
  // With no context, no individual gauges are set, but the metric definition exists
  assertStringIncludes(metrics, "airfriends_skill_readiness");
});

Deno.test("HealthCheckServer - workspace write permission check with temp dir", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const port = getTestPort();
    const server = new HealthCheckServer(port);

    // Create a minimal mock context
    const mockContext = {
      config: {
        agent: { skillsDir: tmpDir + "/nonexistent-skills" },
        workspace: { repoPath: tmpDir },
        skillApi: undefined,
      },
      agentCore: {
        getSkillRegistry: () => ({
          getAvailableSkills: () => [],
        }),
      },
      platformRegistry: {
        isAllConnected: () => true,
      },
    };

    // deno-lint-ignore no-explicit-any
    server.setContext(mockContext as any);
    const result = await server.checkSkillReadiness();

    // workspace:writable should pass since tmpDir is writable
    const workspaceCheck = result.checks.find((c) => c.name === "workspace:writable");
    assertEquals(workspaceCheck?.ready, true);

    // binary checks for rg, deno, git should be present
    const binaryChecks = result.checks.filter((c) => c.name.startsWith("binary:"));
    assertEquals(binaryChecks.length, 3);

    // deno should always be available in test environment
    const denoCheck = result.checks.find((c) => c.name === "binary:deno");
    assertEquals(denoCheck?.ready, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HealthCheckServer - skill readiness reports missing script", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const server = new HealthCheckServer(9999);

    // The trusted root must exist (an absent root is a separate, explicit
    // `skill-root` failure); here it resolves and the registered skill's
    // script is what is missing.
    const skillsDir = tmpDir + "/skills";
    await Deno.mkdir(skillsDir, { recursive: true });

    const mockContext = {
      config: {
        agent: { skillsDir },
        workspace: { repoPath: tmpDir },
        skillApi: undefined,
      },
      agentCore: {
        getSkillRegistry: () => ({
          getAvailableSkills: () => ["fake-skill"],
        }),
      },
      platformRegistry: {
        isAllConnected: () => true,
      },
    };

    // deno-lint-ignore no-explicit-any
    server.setContext(mockContext as any);
    const result = await server.checkSkillReadiness();

    const scriptCheck = result.checks.find((c) => c.name === "scripts:fake-skill");
    assertEquals(scriptCheck?.ready, false);
    assertStringIncludes(scriptCheck?.message ?? "", "not found");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- Resolver-scoped readiness (`unify-omp-skill-root-resolution` D4 / 4.2) ---

Deno.test("HealthCheckServer - OMP readiness resolves the development owned root, not agent.skillsDir", async () => {
  // Image/dev parity: for the OMP default agent the readiness root is the
  // resolver's OWNED selection (here: the validated development source tree),
  // NOT the OpenCode `agent.skillsDir` value, which points elsewhere.
  const tmpDir = await Deno.makeTempDir();
  try {
    const server = new HealthCheckServer(9999);
    const mockContext = {
      config: {
        agent: { skillsDir: tmpDir + "/elsewhere-skills", defaultAgentType: "omp" },
        workspace: { repoPath: tmpDir },
        skillApi: undefined,
      },
      agentCore: {
        getSkillRegistry: () => ({ getAvailableSkills: () => ["memory-save", "fake-skill"] }),
      },
      platformRegistry: { isAllConnected: () => true },
    };
    // deno-lint-ignore no-explicit-any
    server.setContext(mockContext as any);
    const result = await server.checkSkillReadiness();

    // The repository's real bundled script passes at the dev owned root…
    assertEquals(result.checks.find((c) => c.name === "scripts:memory-save")?.ready, true);
    const missing = result.checks.find((c) => c.name === "scripts:fake-skill");
    assertEquals(missing?.ready, false);
    // …and every script check names the OWNED root path, never skillsDir.
    assertStringIncludes(missing?.message ?? "", DEV_SOURCE_SKILLS_ROOT);
    assertEquals((missing?.message ?? "").includes("elsewhere-skills"), false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HealthCheckServer - owned script missing fails despite a personal copy elsewhere", async () => {
  // Removing an owned registered script fails its readiness check even when a
  // same-named copy exists in a personal/alternate tree: readiness consults
  // ONLY the resolved root, and the failure message names that root.
  const tmpDir = await Deno.makeTempDir();
  try {
    const root = tmpDir + "/trusted-skills";
    await Deno.mkdir(root, { recursive: true });
    // A personal copy that must NOT satisfy the check:
    const personal = `${tmpDir}/personal/memory-save/scripts`;
    await Deno.mkdir(personal, { recursive: true });
    await Deno.writeTextFile(`${personal}/memory-save.ts`, "// copy\n");

    const server = new HealthCheckServer(9999);
    const mockContext = {
      config: {
        agent: { skillsDir: root },
        workspace: { repoPath: tmpDir },
        skillApi: undefined,
      },
      agentCore: {
        getSkillRegistry: () => ({ getAvailableSkills: () => ["memory-save"] }),
      },
      platformRegistry: { isAllConnected: () => true },
    };
    // deno-lint-ignore no-explicit-any
    server.setContext(mockContext as any);
    const result = await server.checkSkillReadiness();

    const check = result.checks.find((c) => c.name === "scripts:memory-save");
    assertEquals(check?.ready, false);
    assertStringIncludes(check?.message ?? "", `${root}/memory-save/scripts/memory-save.ts`);
    assertEquals(result.allReady, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HealthCheckServer - resolver error yields explicit skill-root failure and Not-checked scripts", async () => {
  // An unresolvable configured root (missing directory) becomes an explicit
  // failed `skill-root` entry — never a fallback tree — and the registered
  // script checks are recorded as honest not-checked failures (HTTP 503 via
  // allReady in handleReadyz).
  const tmpDir = await Deno.makeTempDir();
  try {
    const server = new HealthCheckServer(9999);
    const mockContext = {
      config: {
        agent: { skillsDir: tmpDir + "/absent-skills" },
        workspace: { repoPath: tmpDir },
        skillApi: undefined,
      },
      agentCore: {
        getSkillRegistry: () => ({ getAvailableSkills: () => ["memory-save"] }),
      },
      platformRegistry: { isAllConnected: () => true },
    };
    // deno-lint-ignore no-explicit-any
    server.setContext(mockContext as any);
    const result = await server.checkSkillReadiness();

    const rootCheck = result.checks.find((c) => c.name === "skill-root");
    assertEquals(rootCheck?.ready, false);
    assertStringIncludes(rootCheck?.message ?? "", "absent-skills");
    const scriptCheck = result.checks.find((c) => c.name === "scripts:memory-save");
    assertEquals(scriptCheck?.ready, false);
    assertStringIncludes(scriptCheck?.message ?? "", "Not checked");
    assertEquals(result.allReady, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HealthCheckServer - readiness cache holds across context changes for the TTL window", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const root = tmpDir + "/skills";
    await Deno.mkdir(root, { recursive: true });
    const server = new HealthCheckServer(9999);
    const mkContext = (skills: string[]) => ({
      config: { agent: { skillsDir: root }, workspace: { repoPath: tmpDir }, skillApi: undefined },
      agentCore: {
        getSkillRegistry: () => ({ getAvailableSkills: () => skills }),
      },
      platformRegistry: { isAllConnected: () => true },
    });
    // deno-lint-ignore no-explicit-any
    server.setContext(mkContext(["memory-save"]) as any);
    const first = await server.checkSkillReadiness();
    // Replacement context registers a different skill list, but the 30-second
    // cache must keep serving the previous result unchanged.
    // deno-lint-ignore no-explicit-any
    server.setContext(mkContext(["totally-new-skill"]) as any);
    const second = await server.checkSkillReadiness();
    assertEquals(second, first);
    assertEquals(second.checks.some((c) => c.name === "scripts:totally-new-skill"), false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HealthCheckServer - skill API connectivity check", async () => {
  // Start a simple HTTP server to simulate skill API
  const port = getTestPort();
  const testServer = Deno.serve({ port }, () => new Response("OK"));

  try {
    await new Promise((r) => setTimeout(r, 200));

    const server = new HealthCheckServer(9999);
    const tmpDir = await Deno.makeTempDir();

    const mockContext = {
      config: {
        agent: { skillsDir: tmpDir + "/nonexistent-skills" },
        workspace: { repoPath: tmpDir },
        skillApi: { enabled: true, port, host: "localhost" },
      },
      agentCore: {
        getSkillRegistry: () => ({
          getAvailableSkills: () => [],
        }),
      },
      platformRegistry: {
        isAllConnected: () => true,
      },
    };

    // deno-lint-ignore no-explicit-any
    server.setContext(mockContext as any);
    const result = await server.checkSkillReadiness();

    const apiCheck = result.checks.find((c) => c.name === "skill-api");
    assertEquals(apiCheck?.ready, true);

    await Deno.remove(tmpDir, { recursive: true });
  } finally {
    await testServer.shutdown();
  }
});

Deno.test("HealthCheckServer - /readyz includes skillReadiness field", async () => {
  const port = getTestPort();
  const server = new HealthCheckServer(port);
  const tmpDir = await Deno.makeTempDir();

  const mockContext = {
    config: {
      agent: { skillsDir: tmpDir },
      workspace: { repoPath: tmpDir },
      skillApi: undefined,
    },
    agentCore: {
      getSkillRegistry: () => ({
        getAvailableSkills: () => [],
      }),
    },
    platformRegistry: {
      isAllConnected: () => true,
    },
  };

  // deno-lint-ignore no-explicit-any
  server.setContext(mockContext as any);
  server.start();

  try {
    await new Promise((r) => setTimeout(r, 200));
    const resp = await fetch(`http://localhost:${port}/readyz`);
    const body = await resp.json();

    assertEquals(typeof body.ready, "boolean");
    assertEquals(typeof body.platforms, "boolean");
    assertEquals(typeof body.skillReadiness, "object");
    assertEquals(typeof body.skillReadiness.allReady, "boolean");
    assertEquals(Array.isArray(body.skillReadiness.checks), true);
  } finally {
    await server.stop();
    await Deno.remove(tmpDir, { recursive: true });
  }
});
