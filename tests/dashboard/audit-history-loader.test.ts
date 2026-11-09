// tests/dashboard/audit-history-loader.test.ts

import { assertEquals } from "@std/assert";
import { loadSessionsFromAuditLogs } from "../../src/dashboard/audit-history-loader.ts";
import { join } from "node:path";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

const TEST_DIR = await makeTempDir({ prefix: "audit_loader_test_" });

async function _writeAuditFile(
  platform: string,
  userId: string,
  sessionId: string,
  lines: string[],
): Promise<void> {
  const dir = join(TEST_DIR, platform, userId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(join(dir, `${sessionId}.jsonl`), lines.join("\n") + "\n");
}

test("loadSessionsFromAuditLogs - empty directory returns empty array", async function () {
  const emptyDir = await makeTempDir({ prefix: "audit_empty_" });
  const result = await loadSessionsFromAuditLogs(emptyDir);
  assertEquals(result, []);
  await fsp.rm(emptyDir, { recursive: true });
});

test("loadSessionsFromAuditLogs - non-existent directory returns empty array", async function () {
  const result = await loadSessionsFromAuditLogs("/tmp/nonexistent_audit_path_test");
  assertEquals(result, []);
});

test("loadSessionsFromAuditLogs - parses complete audit log", async function () {
  const dir = await makeTempDir({ prefix: "audit_complete_" });
  const auditDir = join(dir, "discord", "user123");
  await fsp.mkdir(auditDir, { recursive: true });
  await fsp.writeFile(
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
  await fsp.rm(dir, { recursive: true });
});

test("loadSessionsFromAuditLogs - missing session_end marks as failure", async function () {
  const dir = await makeTempDir({ prefix: "audit_nossend_" });
  const auditDir = join(dir, "misskey", "user456");
  await fsp.mkdir(auditDir, { recursive: true });
  await fsp.writeFile(
    join(auditDir, "sess_def456.jsonl"),
    JSON.stringify({ ts: "2024-06-01T10:00:00Z", phase: "context_assembly", data: {} }) + "\n",
  );

  const result = await loadSessionsFromAuditLogs(dir);
  assertEquals(result.length, 1);
  assertEquals(result[0].status, "failure");
  await fsp.rm(dir, { recursive: true });
});

test("loadSessionsFromAuditLogs - corrupted file is skipped", async function () {
  const dir = await makeTempDir({ prefix: "audit_corrupt_" });
  const auditDir = join(dir, "discord", "user789");
  await fsp.mkdir(auditDir, { recursive: true });
  await fsp.writeFile(join(auditDir, "sess_bad.jsonl"), "not json\n");
  await fsp.writeFile(
    join(auditDir, "sess_good.jsonl"),
    JSON.stringify({ ts: "2024-06-01T10:00:00Z", phase: "context_assembly", data: {} }) + "\n",
  );

  const result = await loadSessionsFromAuditLogs(dir);
  assertEquals(result.length, 1);
  assertEquals(result[0].auditSessionId, "sess_good");
  await fsp.rm(dir, { recursive: true });
});

test("loadSessionsFromAuditLogs - limits to 100 most recent sessions", async function () {
  const dir = await makeTempDir({ prefix: "audit_limit_" });
  const auditDir = join(dir, "discord", "user1");
  await fsp.mkdir(auditDir, { recursive: true });

  for (let i = 0; i < 110; i++) {
    const ts = new Date(Date.now() - (110 - i) * 60000).toISOString();
    await fsp.writeFile(
      join(auditDir, `sess_s${String(i).padStart(3, "0")}.jsonl`),
      JSON.stringify({ ts, phase: "context_assembly", data: {} }) + "\n",
    );
  }

  const result = await loadSessionsFromAuditLogs(dir);
  assertEquals(result.length, 100);
  await fsp.rm(dir, { recursive: true });
});
