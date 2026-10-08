// tests/types/audit.test.ts

import { assertEquals } from "@std/assert";
import type { AuditPhase } from "../../src/types/audit.ts";

// 8.1: Verify all 21 AuditPhase literals are valid
Deno.test("AuditPhase - all 21 phase literals are assignable", () => {
  const phases: AuditPhase[] = [
    "trigger_received",
    "session_start",
    "rate_limit_checked",
    "context_assembly",
    "yolo_resolution",
    "agent_connect",
    "prompt_sent",
    "agent_message",
    "skill_call",
    "memory_operation",
    "agent_response",
    "agent_complete_message",
    "agent_complete_thought",
    "reply_sent",
    "reply_edited",
    "file_sent",
    "retry_triggered",
    "process_acquired",
    "session_end",
    "permission_approved",
    "permission_denied",
  ];
  assertEquals(phases.length, 21);
  // Each assignment above is a compile-time check that the literal is valid
  for (const phase of phases) {
    assertEquals(typeof phase, "string");
  }
});

Deno.test("AuditPhase - phase literals are distinct", () => {
  const phases: AuditPhase[] = [
    "trigger_received",
    "session_start",
    "rate_limit_checked",
    "context_assembly",
    "yolo_resolution",
    "agent_connect",
    "prompt_sent",
    "agent_message",
    "skill_call",
    "memory_operation",
    "agent_response",
    "agent_complete_message",
    "agent_complete_thought",
    "reply_sent",
    "reply_edited",
    "file_sent",
    "retry_triggered",
    "process_acquired",
    "session_end",
    "permission_approved",
    "permission_denied",
  ];
  const unique = new Set(phases);
  assertEquals(unique.size, 21);
});

// file_sent data accepts the delivered message IDs (verbatim, not user content)
Deno.test("Audit - file_sent entry data accepts messageId/messageIds", () => {
  const entry: {
    phase: AuditPhase;
    data: {
      filesCount?: number;
      messageId?: string;
      messageIds?: string[];
    };
  } = {
    phase: "file_sent",
    data: {
      filesCount: 2,
      messageId: "file-2",
      messageIds: ["file-1", "file-2"],
    },
  };
  assertEquals(entry.phase, "file_sent");
  assertEquals(entry.data.filesCount, 2);
  assertEquals(entry.data.messageId, "file-2");
  assertEquals(entry.data.messageIds, ["file-1", "file-2"]);
});

Deno.test("Audit - process_acquired entry data accepts ownership payload", () => {
  const entry: {
    phase: AuditPhase;
    data: {
      sessionId?: string;
      agentType?: string;
      permissionMode?: string;
      processNamespace?: string;
      pooled?: boolean;
    };
  } = {
    phase: "process_acquired",
    data: {
      sessionId: "sess-1",
      agentType: "omp",
      permissionMode: "native-yolo",
      processNamespace: "/tmp/data/omp/native-yolo",
      pooled: true,
    },
  };
  assertEquals(entry.phase, "process_acquired");
  assertEquals(entry.data.permissionMode, "native-yolo");
  assertEquals(entry.data.pooled, true);
});
