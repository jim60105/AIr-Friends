// tests/dashboard/audit-history-loader.test.ts

import { assertEquals } from "@std/assert";
import { loadSessionsFromAuditLogs } from "../../src/dashboard/audit-history-loader.ts";
import { join } from "@std/path";

const TEST_DIR = await Deno.makeTempDir({ prefix: "audit_loader_test_" });

async function writeAuditFile(
  platform: string,
  userId: string,
  sessionId: string,
  lines: string[],
): Promise<void> {
  const dir = join(TEST_DIR, platform, userId);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, `${sessionId}.jsonl`), lines.join("\n") + "\n");
}

Deno.test({
  name: "loadSessionsFromAuditLogs - empty directory returns empty array",
  async fn() {
    const emptyDir = await Deno.makeTempDir({ prefix: "audit_empty_" });
    const result = await loadSessionsFromAuditLogs(emptyDir);
    assertEquals(result, []);
    await Deno.remove(emptyDir, { recursive: true });
  },
});

Deno.test({
  name: "loadSessionsFromAuditLogs - non-existent directory returns empty array",
  async fn() {
    const result = await loadSessionsFromAuditLogs("/tmp/nonexistent_audit_path_test");
    assertEquals(result, []);
  },
});

Deno.test({
  name: "loadSessionsFromAuditLogs - parses complete audit log",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "audit_complete_" });
    const auditDir = join(dir, "discord", "user123");
    await Deno.mkdir(auditDir, { recursive: true });
    await Deno.writeTextFile(
      join(auditDir, "sess_abc123.jsonl"),
      [
        JSON.stringify({ ts: "2024-06-01T10:00:00Z", phase: "context_assembly", data: {} }),
        JSON.stringify({
          ts: "2024-06-01T10:05:00Z",
          phase: "session_end",
          data: { success: true, durationMs: 300000 },
        }),
      ].join("\n") + "\n",
    );

    const result = await loadSessionsFromAuditLogs(dir);
    assertEquals(result.length, 1);
    assertEquals(result[0].auditSessionId, "sess_abc123");
    assertEquals(result[0].platform, "discord");
    assertEquals(result[0].userId, "user123");
    assertEquals(result[0].status, "success");
    assertEquals(result[0].startedAt, "2024-06-01T10:00:00Z");
    assertEquals(result[0].endedAt, "2024-06-01T10:05:00Z");
    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name: "loadSessionsFromAuditLogs - missing session_end marks as failure",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "audit_nossend_" });
    const auditDir = join(dir, "misskey", "user456");
    await Deno.mkdir(auditDir, { recursive: true });
    await Deno.writeTextFile(
      join(auditDir, "sess_def456.jsonl"),
      JSON.stringify({ ts: "2024-06-01T10:00:00Z", phase: "context_assembly", data: {} }) + "\n",
    );

    const result = await loadSessionsFromAuditLogs(dir);
    assertEquals(result.length, 1);
    assertEquals(result[0].status, "failure");
    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name: "loadSessionsFromAuditLogs - corrupted file is skipped",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "audit_corrupt_" });
    const auditDir = join(dir, "discord", "user789");
    await Deno.mkdir(auditDir, { recursive: true });
    await Deno.writeTextFile(join(auditDir, "sess_bad.jsonl"), "not json\n");
    await Deno.writeTextFile(
      join(auditDir, "sess_good.jsonl"),
      JSON.stringify({ ts: "2024-06-01T10:00:00Z", phase: "context_assembly", data: {} }) + "\n",
    );

    const result = await loadSessionsFromAuditLogs(dir);
    assertEquals(result.length, 1);
    assertEquals(result[0].auditSessionId, "sess_good");
    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name: "loadSessionsFromAuditLogs - limits to 100 most recent sessions",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "audit_limit_" });
    const auditDir = join(dir, "discord", "user1");
    await Deno.mkdir(auditDir, { recursive: true });

    for (let i = 0; i < 110; i++) {
      const ts = new Date(Date.now() - (110 - i) * 60000).toISOString();
      await Deno.writeTextFile(
        join(auditDir, `sess_s${String(i).padStart(3, "0")}.jsonl`),
        JSON.stringify({ ts, phase: "context_assembly", data: {} }) + "\n",
      );
    }

    const result = await loadSessionsFromAuditLogs(dir);
    assertEquals(result.length, 100);
    await Deno.remove(dir, { recursive: true });
  },
});
