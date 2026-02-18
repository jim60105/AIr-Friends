// tests/core/audit-logger.test.ts

import { assertEquals } from "@std/assert";
import { SessionAuditWriter } from "@core/audit-logger.ts";
import type { AuditConfig } from "../../src/types/config.ts";
import type { SessionAuditEntry } from "../../src/types/audit.ts";

const baseConfig: AuditConfig = {
  enabled: true,
  retentionDays: 7,
  hashContent: true,
  includedPhases: [],
};

Deno.test("SessionAuditWriter - writes JSONL entry", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_test1", baseConfig);
    await writer.write("session_end", { success: true, durationMs: 100 });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_test1.jsonl`);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 1);

    const entry: SessionAuditEntry = JSON.parse(lines[0]);
    assertEquals(entry.phase, "session_end");
    assertEquals(entry.data.success, true);
    assertEquals(entry.data.durationMs, 100);
    assertEquals(typeof entry.ts, "string");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SessionAuditWriter - appends multiple entries", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_test2", baseConfig);
    await writer.write("agent_connect", { agentType: "copilot" });
    await writer.write("prompt_sent", { promptLength: 500 });
    await writer.write("session_end", { success: true });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_test2.jsonl`);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 3);
    assertEquals(JSON.parse(lines[0]).phase, "agent_connect");
    assertEquals(JSON.parse(lines[1]).phase, "prompt_sent");
    assertEquals(JSON.parse(lines[2]).phase, "session_end");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SessionAuditWriter - filters by includedPhases", async () => {
  const tmpDir = await Deno.makeTempDir();
  const config: AuditConfig = {
    ...baseConfig,
    includedPhases: ["session_end"],
  };
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_test3", config);
    await writer.write("agent_connect", { agentType: "copilot" });
    await writer.write("session_end", { success: true });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_test3.jsonl`);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 1);
    assertEquals(JSON.parse(lines[0]).phase, "session_end");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SessionAuditWriter - empty includedPhases records all", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_test4", baseConfig);
    await writer.write("context_assembly", { memoriesCount: 5 });
    await writer.write("agent_connect", { agentType: "copilot" });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_test4.jsonl`);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 2);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SessionAuditWriter - I/O error does not throw", async () => {
  // Use an invalid path that should fail
  const writer = new SessionAuditWriter(
    "/nonexistent/path/that/cannot/exist",
    "discord",
    "user1",
    "sess_test5",
    baseConfig,
  );
  // Should not throw
  await writer.write("session_end", { success: false });
});

Deno.test("SessionAuditWriter - getConfig returns config", () => {
  const writer = new SessionAuditWriter("/tmp", "discord", "user1", "sess_test6", baseConfig);
  const config = writer.getConfig();
  assertEquals(config.hashContent, true);
  assertEquals(config.retentionDays, 7);
});
