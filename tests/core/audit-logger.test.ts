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
    await writer.write("agent_connect", { agentType: "opencode" });
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
    await writer.write("agent_connect", { agentType: "opencode" });
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
    await writer.write("agent_connect", { agentType: "opencode" });

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

// 8.7: Session summary counters
Deno.test("SessionAuditWriter - getSummaryCounters tracks all counters", () => {
  const writer = new SessionAuditWriter("/tmp", "discord", "user1", "sess_counters", baseConfig);

  // Initially all zero
  assertEquals(writer.getSummaryCounters(), {
    repliesCount: 0,
    skillCallsCount: 0,
    memoryOpsCount: 0,
    permissionDecisionsCount: 0,
  });

  writer.incrementReplies();
  writer.incrementReplies();
  writer.incrementSkillCalls();
  writer.incrementSkillCalls();
  writer.incrementSkillCalls();
  writer.incrementMemoryOps();
  writer.incrementPermissionDecisions();
  writer.incrementPermissionDecisions();

  assertEquals(writer.getSummaryCounters(), {
    repliesCount: 2,
    skillCallsCount: 3,
    memoryOpsCount: 1,
    permissionDecisionsCount: 2,
  });
});

// 8.7: session_end includes summary counters
Deno.test("SessionAuditWriter - session_end with summary counters", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_end_ctr", baseConfig);
    writer.incrementReplies();
    writer.incrementSkillCalls();
    writer.incrementSkillCalls();
    writer.incrementMemoryOps();

    const counters = writer.getSummaryCounters();
    await writer.write("session_end", {
      success: true,
      durationMs: 5000,
      ...counters,
    });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_end_ctr.jsonl`);
    const entry: SessionAuditEntry = JSON.parse(content.trim());
    assertEquals(entry.phase, "session_end");
    assertEquals(entry.data.repliesCount, 1);
    assertEquals(entry.data.skillCallsCount, 2);
    assertEquals(entry.data.memoryOpsCount, 1);
    assertEquals(entry.data.permissionDecisionsCount, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// 8.1 + 8.2: trigger_received and session_start are writable
Deno.test("SessionAuditWriter - writes trigger_received entry", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_trigger", baseConfig);
    await writer.write("trigger_received", {
      platform: "discord",
      channelId: "ch1",
      userId: "user1",
      messageId: "msg1",
      isDm: false,
      contentLength: 42,
      attachmentCount: 0,
    });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_trigger.jsonl`);
    const entry: SessionAuditEntry = JSON.parse(content.trim());
    assertEquals(entry.phase, "trigger_received");
    assertEquals(entry.data.channelId, "ch1");
    assertEquals(entry.data.contentLength, 42);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SessionAuditWriter - writes session_start entry", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_start", baseConfig);
    await writer.write("session_start", {
      sessionId: "sess_start",
      sessionType: "normal",
      workspaceKey: "discord/user1",
      agentType: "opencode",
      model: "gpt-4",
      yolo: false,
    });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_start.jsonl`);
    const entry: SessionAuditEntry = JSON.parse(content.trim());
    assertEquals(entry.phase, "session_start");
    assertEquals(entry.data.sessionType, "normal");
    assertEquals(entry.data.workspaceKey, "discord/user1");
    assertEquals(entry.data.yolo, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// 8.3: rate_limit_checked
Deno.test("SessionAuditWriter - writes rate_limit_checked entry", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_rl", baseConfig);
    await writer.write("rate_limit_checked", {
      decision: "allowed",
      userId: "user1",
      platform: "discord",
    });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_rl.jsonl`);
    const entry: SessionAuditEntry = JSON.parse(content.trim());
    assertEquals(entry.phase, "rate_limit_checked");
    assertEquals(entry.data.decision, "allowed");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// 8.4: reply_edited
Deno.test("SessionAuditWriter - writes reply_edited entry", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_edit", baseConfig);
    await writer.write("reply_edited", {
      originalMessageId: "msg_old",
      newMessageId: "msg_new",
      replyLength: 50,
      platform: "discord",
    });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_edit.jsonl`);
    const entry: SessionAuditEntry = JSON.parse(content.trim());
    assertEquals(entry.phase, "reply_edited");
    assertEquals(entry.data.originalMessageId, "msg_old");
    assertEquals(entry.data.newMessageId, "msg_new");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// 8.5: memory_operation
Deno.test("SessionAuditWriter - writes memory_operation entry", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_memop", baseConfig);
    await writer.write("memory_operation", {
      operation: "save",
      memoryId: "mem_123",
      visibility: "public",
      tier: "working",
      category: "fact",
    });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_memop.jsonl`);
    const entry: SessionAuditEntry = JSON.parse(content.trim());
    assertEquals(entry.phase, "memory_operation");
    assertEquals(entry.data.operation, "save");
    assertEquals(entry.data.memoryId, "mem_123");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// 8.6: retry_triggered
Deno.test("SessionAuditWriter - writes retry_triggered entry", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_retry", baseConfig);
    await writer.write("retry_triggered", {
      retryCount: 1,
      maxRetries: 1,
      reason: "no_reply_sent",
    });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_retry.jsonl`);
    const entry: SessionAuditEntry = JSON.parse(content.trim());
    assertEquals(entry.phase, "retry_triggered");
    assertEquals(entry.data.retryCount, 1);
    assertEquals(entry.data.maxRetries, 1);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// 8.8: agent_message
Deno.test("SessionAuditWriter - writes agent_message entry", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_amsg", baseConfig);
    await writer.write("agent_message", {
      promptContentHash: "1234",
      promptLength: 1234,
      model: "gpt-4",
    });

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_amsg.jsonl`);
    const entry: SessionAuditEntry = JSON.parse(content.trim());
    assertEquals(entry.phase, "agent_message");
    assertEquals(entry.data.promptLength, 1234);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// 8.10: Integration test for chronological order
Deno.test("SessionAuditWriter - entries written in chronological order", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(tmpDir, "discord", "user1", "sess_chrono", baseConfig);

    const phases: Array<[string, Record<string, unknown>]> = [
      ["trigger_received", { channelId: "ch1", userId: "user1" }],
      ["session_start", { sessionId: "sess_chrono", sessionType: "normal" }],
      ["rate_limit_checked", { decision: "allowed" }],
      ["context_assembly", { memoriesCount: 5 }],
      ["agent_connect", { agentType: "opencode" }],
      ["prompt_sent", { promptLength: 500 }],
      ["agent_message", { promptLength: 500 }],
      ["skill_call", { skillName: "memory-save" }],
      ["memory_operation", { operation: "save" }],
      ["agent_response", { stopReason: "end_turn" }],
      ["reply_sent", { replyLength: 100 }],
      ["session_end", { success: true, durationMs: 1000 }],
    ];

    for (const [phase, data] of phases) {
      await writer.write(phase as import("../../src/types/audit.ts").AuditPhase, data);
    }

    const content = await Deno.readTextFile(`${tmpDir}/discord/user1/sess_chrono.jsonl`);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, phases.length);

    // Verify phases appear in expected order
    const writtenPhases = lines.map((l) => JSON.parse(l).phase);
    assertEquals(writtenPhases, phases.map(([p]) => p));

    // Verify timestamps are non-decreasing
    const timestamps = lines.map((l) => new Date(JSON.parse(l).ts).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      assertEquals(timestamps[i] >= timestamps[i - 1], true);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
