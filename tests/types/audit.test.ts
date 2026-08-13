// tests/types/audit.test.ts

import { assertEquals } from "@std/assert";
import type { AuditPhase } from "../../src/types/audit.ts";

// 8.1: Verify all 20 AuditPhase literals are valid
Deno.test("AuditPhase - all 20 phase literals are assignable", () => {
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
    "session_end",
    "permission_approved",
    "permission_denied",
  ];
  assertEquals(phases.length, 20);
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
    "session_end",
    "permission_approved",
    "permission_denied",
  ];
  const unique = new Set(phases);
  assertEquals(unique.size, 20);
});
