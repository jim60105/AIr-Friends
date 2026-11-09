// tests/utils/opencode-version.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  detectOpenCodeVersion,
  getMinimumOpenCodeVersion,
  isAtLeastVersion,
  parseSemver,
  verifyOpenCodeVersion,
} from "@utils/opencode-version.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import { test } from "bun:test";

// A logger that captures warn/info entries for assertion.
// Captures the message TEMPLATE plus context (same convention as client.test.ts);
// the rendered message is not observable without intercepting formatEntry.
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

test("parseSemver - parses plain semver", () => {
  assertEquals(parseSemver("1.17.13"), { major: 1, minor: 17, patch: 13 });
});

test("parseSemver - parses version embedded in text", () => {
  assertEquals(parseSemver("opencode v1.17.13"), { major: 1, minor: 17, patch: 13 });
});

test("parseSemver - returns null for unparseable strings", () => {
  assertEquals(parseSemver("not-a-version"), null);
  assertEquals(parseSemver(""), null);
});

test("isAtLeastVersion - compares semver correctly", () => {
  assertEquals(isAtLeastVersion("1.17.13", "1.17.13"), true);
  assertEquals(isAtLeastVersion("1.17.14", "1.17.13"), true);
  assertEquals(isAtLeastVersion("1.18.0", "1.17.13"), true);
  assertEquals(isAtLeastVersion("2.0.0", "1.17.13"), true);
  assertEquals(isAtLeastVersion("1.17.12", "1.17.13"), false);
  assertEquals(isAtLeastVersion("1.16.99", "1.17.13"), false);
  assertEquals(isAtLeastVersion("garbage", "1.17.13"), false);
  assertEquals(isAtLeastVersion("1.17.13", "garbage"), false);
});

test("verifyOpenCodeVersion - INFO with OK marker when version at minimum", async () => {
  const { entries, logger } = createCapturingLogger();
  const result = await verifyOpenCodeVersion({
    minVersion: "1.17.13",
    detect: () => Promise.resolve("1.17.13"),
    log: logger,
  });
  assertEquals(result, "ok");
  assertEquals(entries.length, 1);
  assertEquals(entries[0].level, "info");
  assertStringIncludes(entries[0].message, "OpenCode version check: OK");
  assertEquals(entries[0].context?.version, "1.17.13");
});

test("verifyOpenCodeVersion - INFO when version above minimum", async () => {
  const { entries, logger } = createCapturingLogger();
  const result = await verifyOpenCodeVersion({
    minVersion: "1.17.13",
    detect: () => Promise.resolve("1.18.0"),
    log: logger,
  });
  assertEquals(result, "ok");
  assertEquals(entries.length, 1);
  assertEquals(entries[0].level, "info");
});

test("verifyOpenCodeVersion - WARN with BELOW_MINIMUM marker when below minimum", async () => {
  const { entries, logger } = createCapturingLogger();
  const result = await verifyOpenCodeVersion({
    minVersion: "1.17.13",
    detect: () => Promise.resolve("1.17.12"),
    log: logger,
  });
  assertEquals(result, "below_minimum");
  assertEquals(entries.length, 1);
  assertEquals(entries[0].level, "warn");
  assertStringIncludes(entries[0].message, "OpenCode version check: BELOW_MINIMUM");
  assertEquals(entries[0].context?.version, "1.17.12");
  assertEquals(entries[0].context?.minVersion, "1.17.13");
});

test("verifyOpenCodeVersion - WARN with UNKNOWN marker when detection fails", async () => {
  const { entries, logger } = createCapturingLogger();
  const result = await verifyOpenCodeVersion({
    minVersion: "1.17.13",
    detect: () => Promise.resolve(null),
    log: logger,
  });
  assertEquals(result, "unknown");
  assertEquals(entries.length, 1);
  assertEquals(entries[0].level, "warn");
  assertStringIncludes(entries[0].message, "OpenCode version check: UNKNOWN");
});

test("verifyOpenCodeVersion - UNKNOWN when detector throws (never blocks startup)", async () => {
  const { entries, logger } = createCapturingLogger();
  const result = await verifyOpenCodeVersion({
    minVersion: "1.17.13",
    detect: () => Promise.reject(new Error("spawn failed")),
    log: logger,
  });
  assertEquals(result, "unknown");
  assertEquals(entries.length, 1);
  assertStringIncludes(entries[0].message, "UNKNOWN");
});

test("getMinimumOpenCodeVersion - defaults to known-good minimum", () => {
  const original = process.env["AGENT_OPENCODE_MIN_VERSION"];
  try {
    delete process.env["AGENT_OPENCODE_MIN_VERSION"];
    assertEquals(getMinimumOpenCodeVersion(), "1.17.13");
  } finally {
    if (original !== undefined) process.env["AGENT_OPENCODE_MIN_VERSION"] = original;
  }
});

test("getMinimumOpenCodeVersion - honors env override", () => {
  const original = process.env["AGENT_OPENCODE_MIN_VERSION"];
  try {
    process.env["AGENT_OPENCODE_MIN_VERSION"] = "1.18.0";
    assertEquals(getMinimumOpenCodeVersion(), "1.18.0");
    process.env["AGENT_OPENCODE_MIN_VERSION"] = "   ";
    assertEquals(getMinimumOpenCodeVersion(), "1.17.13", "blank override ignored");
  } finally {
    if (original !== undefined) {
      process.env["AGENT_OPENCODE_MIN_VERSION"] = original;
    } else {
      delete process.env["AGENT_OPENCODE_MIN_VERSION"];
    }
  }
});

test("detectOpenCodeVersion - returns null when binary missing (non-fatal)", async () => {
  // Spawn a binary name that cannot exist. NEVER override the global PATH here:
  // tests run with `--parallel` and Deno.env is process-global, so mutating PATH
  // would break sibling test files (e.g. git-backup-service spawning `git`).
  const detected = await detectOpenCodeVersion(1000, "definitely-not-a-real-binary-xyz");
  assertEquals(detected, null);
});
