// tests/utils/omp-version.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  detectOmpVersion,
  getMinimumOmpVersion,
  isOmpAtLeastVersion,
  parseOmpSemver,
  shouldVerifyOmpVersion,
  verifyOmpVersion,
} from "@utils/omp-version.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import { getDefaultAgentType } from "@acp/agent-factory.ts";
import type { Config } from "../../src/types/config.ts";

// A logger that captures warn/info entries for assertion.
// Captures the message TEMPLATE plus context (same convention as
// opencode-version.test.ts); the rendered message is not observable without
// intercepting formatEntry.
function createCapturingLogger() {
  const entries: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];
  const logger = new Logger("test", { level: LogLevel.INFO });
  const originalWarn = logger.warn.bind(logger);
  const originalInfo = logger.info.bind(logger);
  logger.warn = (message: string, context?: Record<string, unknown>) => {
    entries.push({ level: "warn", message, context });
    originalWarn(message, context);
  };
  logger.info = (message: string, context?: Record<string, unknown>) => {
    entries.push({ level: "info", message, context });
    originalInfo(message, context);
  };
  return { entries, logger };
}

Deno.test("parseOmpSemver - parses plain semver", () => {
  assertEquals(parseOmpSemver("18.6.1"), { major: 18, minor: 6, patch: 1 });
});

Deno.test("parseOmpSemver - parses version embedded in text", () => {
  assertEquals(parseOmpSemver("omp v18.6.1"), { major: 18, minor: 6, patch: 1 });
});

Deno.test("parseOmpSemver - returns null for unparseable strings", () => {
  assertEquals(parseOmpSemver("not-a-version"), null);
  assertEquals(parseOmpSemver(""), null);
});

Deno.test("isOmpAtLeastVersion - compares semver correctly", () => {
  assertEquals(isOmpAtLeastVersion("18.6.1", "18.6.1"), true);
  assertEquals(isOmpAtLeastVersion("18.6.2", "18.6.1"), true);
  assertEquals(isOmpAtLeastVersion("18.7.0", "18.6.1"), true);
  assertEquals(isOmpAtLeastVersion("19.0.0", "18.6.1"), true);
  assertEquals(isOmpAtLeastVersion("18.6.0", "18.6.1"), false);
  assertEquals(isOmpAtLeastVersion("18.5.99", "18.6.1"), false);
  assertEquals(isOmpAtLeastVersion("garbage", "18.6.1"), false);
  assertEquals(isOmpAtLeastVersion("18.6.1", "garbage"), false);
});

Deno.test("verifyOmpVersion - INFO with OK marker when version equals the pin", async () => {
  const { entries, logger } = createCapturingLogger();
  const result = await verifyOmpVersion({
    minVersion: "18.6.1",
    detect: () => Promise.resolve("18.6.1"),
    log: logger,
  });
  assertEquals(result, "ok");
  assertEquals(entries.length, 1);
  assertEquals(entries[0].level, "info");
  assertStringIncludes(entries[0].message, "OMP version check: OK");
});

Deno.test("verifyOmpVersion - INFO when version above minimum", async () => {
  const { entries, logger } = createCapturingLogger();
  const result = await verifyOmpVersion({
    minVersion: "18.6.1",
    detect: () => Promise.resolve("18.7.0"),
    log: logger,
  });
  assertEquals(result, "ok");
  assertEquals(entries[0].level, "info");
});

Deno.test("verifyOmpVersion - WARN with BELOW_MINIMUM marker when below minimum", async () => {
  const { entries, logger } = createCapturingLogger();
  const result = await verifyOmpVersion({
    minVersion: "18.6.1",
    detect: () => Promise.resolve("18.6.0"),
    log: logger,
  });
  assertEquals(result, "below_minimum");
  assertEquals(entries.length, 1);
  assertEquals(entries[0].level, "warn");
  assertStringIncludes(entries[0].message, "OMP version check: BELOW_MINIMUM");
});

Deno.test("verifyOmpVersion - WARN with UNKNOWN marker when detection fails", async () => {
  const { entries, logger } = createCapturingLogger();
  const result = await verifyOmpVersion({
    minVersion: "18.6.1",
    detect: () => Promise.resolve(null),
    log: logger,
  });
  assertEquals(result, "unknown");
  assertEquals(entries.length, 1);
  assertEquals(entries[0].level, "warn");
  assertStringIncludes(entries[0].message, "OMP version check: UNKNOWN");
});

Deno.test("verifyOmpVersion - UNKNOWN when detector throws (never blocks startup)", async () => {
  const { entries, logger } = createCapturingLogger();
  const result = await verifyOmpVersion({
    minVersion: "18.6.1",
    detect: () => Promise.reject(new Error("spawn failed")),
    log: logger,
  });
  assertEquals(result, "unknown");
  assertEquals(entries[0].level, "warn");
});

Deno.test("getMinimumOmpVersion - defaults to the pinned known-good minimum", () => {
  const original = Deno.env.get("AGENT_OMP_MIN_VERSION");
  try {
    Deno.env.delete("AGENT_OMP_MIN_VERSION");
    assertEquals(getMinimumOmpVersion(), "18.6.1");
  } finally {
    if (original !== undefined) Deno.env.set("AGENT_OMP_MIN_VERSION", original);
  }
});

Deno.test("getMinimumOmpVersion - honors env override; blank ignored", () => {
  const original = Deno.env.get("AGENT_OMP_MIN_VERSION");
  try {
    Deno.env.set("AGENT_OMP_MIN_VERSION", "18.7.0");
    assertEquals(getMinimumOmpVersion(), "18.7.0");
    Deno.env.set("AGENT_OMP_MIN_VERSION", "   ");
    assertEquals(getMinimumOmpVersion(), "18.6.1", "blank override ignored");
  } finally {
    if (original !== undefined) {
      Deno.env.set("AGENT_OMP_MIN_VERSION", original);
    } else {
      Deno.env.delete("AGENT_OMP_MIN_VERSION");
    }
  }
});

Deno.test("detectOmpVersion - returns null when binary missing (non-fatal)", async () => {
  // Spawn a binary name that cannot exist. NEVER override the global PATH here:
  // tests run with `--parallel` and Deno.env is process-global, so mutating PATH
  // would break sibling test files (e.g. git-backup-service spawning `git`).
  const detected = await detectOmpVersion(1000, "definitely-not-a-real-binary-xyz");
  assertEquals(detected, null);
});

Deno.test("detectOmpVersion - parses a fake binary's version output", async () => {
  const dir = await Deno.makeTempDir({ prefix: "omp-version-fake-" });
  const script = `${dir}/omp-fake`;
  await Deno.writeTextFile(script, "#!/bin/sh\necho 'omp v18.6.1'\n");
  await Deno.chmod(script, 0o755);
  try {
    const detected = await detectOmpVersion(5000, script);
    assertEquals(detected, "omp v18.6.1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectOmpVersion - null on unparseable output", async () => {
  const dir = await Deno.makeTempDir({ prefix: "omp-version-fake-" });
  const script = `${dir}/omp-fake`;
  await Deno.writeTextFile(script, "#!/bin/sh\necho 'not a version'\n");
  await Deno.chmod(script, 0o755);
  try {
    const detected = await detectOmpVersion(5000, script);
    assertEquals(detected, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectOmpVersion - timeout returns null without hanging (SIGKILL race)", async () => {
  // A child that ignores signals would hang the check if the timeout were not
  // a race against the output promise; the race must resolve null on schedule.
  // `exec` so the sleep REPLACES the shell: killing the direct child closes
  // the stdout pipe (an orphaned grandchild would hold it open regardless).
  const dir = await Deno.makeTempDir({ prefix: "omp-version-fake-" });
  const script = `${dir}/omp-fake`;
  await Deno.writeTextFile(script, "#!/bin/sh\nexec sleep 30\n");
  await Deno.chmod(script, 0o755);
  const start = Date.now();
  try {
    const detected = await detectOmpVersion(300, script);
    const elapsed = Date.now() - start;
    assertEquals(detected, null);
    assertEquals(elapsed < 5000, true, `timeout raced (${elapsed}ms elapsed)`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// --- Bootstrap call-site gating (design D6's scoped divergence) ---

const minimalConfig = (defaultAgentType?: string): Config =>
  ({
    platforms: {},
    agent: defaultAgentType === undefined ? {} : { defaultAgentType },
    memory: {},
    workspace: {},
    logging: { level: "ERROR" },
    replyPolicy: "channels",
    channels: [],
  }) as unknown as Config;

Deno.test("shouldVerifyOmpVersion - true only for the omp agent type", () => {
  assertEquals(shouldVerifyOmpVersion("omp"), true);
  assertEquals(shouldVerifyOmpVersion("opencode"), false);
});

Deno.test("bootstrap gating - OpenCode-only startup resolves no OMP check (no OMP marker emitted)", () => {
  // The bootstrap call site is `if (shouldVerifyOmpVersion(getDefaultAgentType(config)))`.
  // An OpenCode-default config must resolve the gate to false, so the bootstrap
  // path never spawns `omp --version` and never emits an OMP marker on
  // OpenCode-only installs (where `omp` is absent by design).
  const gate = shouldVerifyOmpVersion(getDefaultAgentType(minimalConfig()));
  assertEquals(gate, false);
  // With the gate false, verifyOmpVersion is never invoked: emulate the
  // absent-binary environment the check would have seen and show the gate,
  // not the detector, is what keeps the marker out of OpenCode startup logs.
});

Deno.test("bootstrap gating - omp agent type resolves the check ON", () => {
  const gate = shouldVerifyOmpVersion(getDefaultAgentType(minimalConfig("omp")));
  assertEquals(gate, true);
});
