// tests/core/email-privacy.test.ts
//
// Deterministic coverage for `email-private-observability` (row 26).
//
// Exercised layers:
// - The REAL `SessionAuditWriter` on the `email` platform with EVERY audit phase
//   an email session emits, driven with sentinel content, plus its discord
//   counterpart to prove non-email entries stay byte-compatible.
// - The REAL `Logger` privacy rules: email module loggers, the `email:<address>`
//   session logger, the ambient private execution scope and `withPrivateEmail()`.
// - The REAL `ChatbotClient` on the email platform (agent chunks, tool updates,
//   complete-message flush) and a discord control client.
// - The REAL `SkillAPIServer`/`SkillRegistry`/`EmailComposeHandler` over HTTP for a
//   compose, a reply, a file send and a denied forward.
// - The REAL `ReminderStore` due-reminder enumeration on a malformed email JSONL,
//   which runs BEFORE any session logger exists.
// Honesty boundary: no provider, credential, mailbox or model judgment is involved;
// the reminder's own restart-safe delivery is owned by `email-reminder-threads` and
// is not re-tested here.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import * as acp from "@agentclientprotocol/sdk";
import {
  projectEmailAuditData,
  projectEmailOperationData,
  SessionAuditWriter,
} from "../../src/core/audit-logger.ts";
import type { AuditConfig } from "../../src/types/config.ts";
import type { AuditPhase, SessionAuditEntry } from "../../src/types/audit.ts";
import { Logger, LogLevel, runWithPrivateEmailScope } from "../../src/utils/logger.ts";
import { sha256Hash } from "../../src/utils/hash.ts";
import { ChatbotClient } from "../../src/acp/client.ts";
import { buildSkillAutoApproveList } from "../../src/acp/skill-inventory.ts";
import { observeTrustedSkillsRoot } from "../../src/core/skills-root.ts";
import type { ClientConfig } from "../../src/acp/types.ts";
import type { SkillRegistry } from "../../src/skills/registry.ts";
import { FileHandler } from "../../src/skills/file-handler.ts";
import type { SkillContext } from "../../src/skills/types.ts";
import type { PlatformAdapter } from "../../src/platforms/platform-adapter.ts";
import { emailComposeAuditParams } from "../../src/skills/email-handler.ts";
import type { EmailComposeMailService } from "../../src/skills/email-handler.ts";
import { normalizeEmailMailbox } from "../../src/platforms/email/email-identity.ts";
import { formatEmailChannelId } from "../../src/platforms/email/message-store.ts";
import type { EmailSubmissionEvidenceSource } from "../../src/core/email-response-accounting.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { SkillAPIServer } from "../../src/skill-api/server.ts";
import { SkillRegistry as RealSkillRegistry } from "../../src/skills/registry.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { ReminderStore } from "../../src/core/reminder-store.ts";
import { createSkillJwt } from "../../src/utils/skill-jwt.ts";
import { metricsRegistry } from "../../src/utils/metrics.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";

// Sentinel private material: an address, a subject, a body, credentials and a
// staged attachment name. NONE of them may appear in a log, an audit entry or a
// metrics output of an email execution.
const ADDRESS_SENTINEL = "sentinel.person@private.example";
const SUBJECT_SENTINEL = "SENTINEL-SUBJECT-3f9a";
const BODY_SENTINEL = "SENTINEL-BODY-3f9a quoted correspondence";
const PASSWORD_SENTINEL = "SENTINEL-PASSWORD-3f9a";
const FILENAME_SENTINEL = "SENTINEL-ATTACHMENT-3f9a.pdf";
const SESSION_ID = "sess_privacy_1";
const WORK_ID = "11111111-2222-3333-4444-555555555555";
const THREAD_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TEST_SKILL_SECRET = "0123456789abcdef0123456789abcdef01";
const SENTINELS = [
  ADDRESS_SENTINEL,
  SUBJECT_SENTINEL,
  BODY_SENTINEL,
  PASSWORD_SENTINEL,
  FILENAME_SENTINEL,
];

const OWNER = normalizeEmailMailbox(ADDRESS_SENTINEL).userId;

/** A stable placeholder digest, so fixture values already look canonical. */
const PLACEHOLDER_HASH = "0".repeat(64);

/** Every line the logger wrote while `fn` ran (stdout + stderr). */
async function capturingLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message: string) => logs.push(String(message));
  console.error = (message: string) => logs.push(String(message));
  try {
    return { result: await fn(), logs };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function assertNoSentinel(text: string, where: string): void {
  for (const sentinel of SENTINELS) {
    assert(
      !text.includes(sentinel),
      `${where} must not contain the private sentinel ${sentinel}`,
    );
  }
}

function auditConfig(hashContent: boolean): AuditConfig {
  return { enabled: true, retentionDays: 7, hashContent, includedPhases: [] };
}

async function readEntries(path: string): Promise<SessionAuditEntry[]> {
  const content = await Deno.readTextFile(path);
  return content.trim().split("\n").filter((line) => line.length > 0).map((line) =>
    JSON.parse(line) as SessionAuditEntry
  );
}

/**
 * Read the entries once the writer's fire-and-forget queue has settled. The
 * awaited read is the signal (the file appearing and growing), so no wall-clock
 * wait is involved.
 */
async function readEntriesWhenReady(
  path: string,
  isComplete: (entries: SessionAuditEntry[]) => boolean,
): Promise<SessionAuditEntry[]> {
  let entries: SessionAuditEntry[] = [];
  for (let attempt = 0; attempt < 500; attempt++) {
    try {
      entries = await readEntries(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (isComplete(entries)) return entries;
  }
  throw new Error(`${path} never reached the expected audit entries`);
}

// ---------------------------------------------------------------------------
// Audit projection
// ---------------------------------------------------------------------------

/**
 * One sentinel-bearing payload per audit phase an email session produces. Each
 * value is what a non-email session would record verbatim when `hashContent` is
 * false — exactly the leak this change closes.
 */
function phasePayloads(): Array<[AuditPhase, Record<string, unknown>]> {
  return [
    [
      "trigger_received",
      {
        platform: "email",
        channelId: `mail:${OWNER}:${THREAD_ID}`,
        userId: OWNER,
        messageId: `<wire-${SUBJECT_SENTINEL}@private.example>`,
        isDm: true,
        contentLength: BODY_SENTINEL.length,
        attachmentCount: 1,
      },
    ],
    [
      "session_start",
      {
        sessionId: SESSION_ID,
        sessionType: "message",
        workspaceKey: `email/${OWNER}`,
        agentType: "opencode",
        model: "claude-opus-4.8",
        reasoningEffort: "default",
        yolo: false,
      },
    ],
    [
      "agent_message",
      {
        promptContentHash: `Inbound request ${BODY_SENTINEL} ${PASSWORD_SENTINEL}`,
        promptLength: 120,
        model: "claude-opus-4.8",
      },
    ],
    [
      "skill_call",
      {
        skillName: "send-email",
        skillParams: {
          action: "forward",
          grantId: "grant-1",
          destinationHash: `sha256:${PLACEHOLDER_HASH}`,
          subjectHash: `sha256:${PLACEHOLDER_HASH}`,
          subjectLength: SUBJECT_SENTINEL.length,
          bodyHash: `sha256:${PLACEHOLDER_HASH}`,
          bodyLength: BODY_SENTINEL.length,
          attachmentsCount: 1,
          smuggledSubject: SUBJECT_SENTINEL,
        },
        skillResult: {
          success: false,
          error: `provider refused: ${PASSWORD_SENTINEL}`,
          code: "SKILL_EMAIL_COMPOSE_REQUEST",
        },
        skillDurationMs: 12,
      },
    ],
    [
      "file_sent",
      {
        filesCount: 1,
        messageId: `<wire-${ADDRESS_SENTINEL}>`,
        messageIds: [`<wire-${ADDRESS_SENTINEL}>`],
        fileNamesHash: `sha256:${PLACEHOLDER_HASH}`,
        platform: "email",
      },
    ],
    [
      "reply_sent",
      { replyContentHash: `Reported: ${BODY_SENTINEL}`, replyLength: 40, platform: "email" },
    ],
    [
      "session_end",
      {
        success: false,
        replySent: true,
        fileSent: false,
        durationMs: 900,
        error: `SMTP rejected for ${ADDRESS_SENTINEL}: ${PASSWORD_SENTINEL}`,
        repliesCount: 1,
        skillCallsCount: 2,
        memoryOpsCount: 0,
        permissionDecisionsCount: 1,
      },
    ],
  ];
}

Deno.test("email audit - no sentinel reaches any phase entry and digests replace content", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(dir, "email", OWNER, SESSION_ID, auditConfig(false));
    for (const [phase, data] of phasePayloads()) await writer.write(phase, data);
    // The APPEND-failure visibility scenario: accepted mail whose sent-folder
    // copy failed, plus a smuggled content field that the allowlist must drop.
    await writer.writeEmailOperation({
      operationId: `op_${"a".repeat(24)}`,
      workId: WORK_ID,
      phase: "submitted",
      targetKind: "third-party",
      sentCopy: "failed",
      safeCode: "APPEND_FAILED",
      // @ts-expect-error the allowlist has no such field; an adversarial caller
      // must not be able to widen the record.
      body: BODY_SENTINEL,
    });

    const file = join(dir, "email", OWNER, `${SESSION_ID}.jsonl`);
    const raw = await Deno.readTextFile(file);
    assertNoSentinel(raw, "the email audit file");

    const entries = await readEntries(file);
    assertEquals(entries.length, 8);

    const byPhase = new Map(entries.map((entry) => [entry.phase, entry.data]));
    // Content is replaced by its digest and length, not dropped silently.
    assertEquals(
      byPhase.get("agent_message")?.promptContentHash,
      `sha256:${await sha256Hash(`Inbound request ${BODY_SENTINEL} ${PASSWORD_SENTINEL}`)}`,
    );
    assertEquals(byPhase.get("agent_message")?.promptLength, 120);
    assertEquals(
      byPhase.get("reply_sent")?.replyContentHash,
      `sha256:${await sha256Hash(`Reported: ${BODY_SENTINEL}`)}`,
    );
    assertEquals(byPhase.get("reply_sent")?.replyLength, 40);
    // Addresses, wire ids, error strings and the workspace path are gone.
    const trigger = byPhase.get("trigger_received")!;
    assertEquals(trigger.userId, undefined);
    assertEquals(trigger.channelId, undefined);
    assertEquals(trigger.messageId, undefined);
    assertEquals(trigger.isDm, true);
    assertEquals(trigger.contentLength, BODY_SENTINEL.length);
    assertEquals(byPhase.get("session_end")?.error, undefined);
    assertEquals(byPhase.get("session_start")?.workspaceKey, undefined);
    // Only the typed code and a boolean survive a refused skill call.
    const skillResult = byPhase.get("skill_call")?.skillResult as Record<string, unknown>;
    assertEquals(skillResult.success, false);
    assertEquals(skillResult.code, "SKILL_EMAIL_COMPOSE_REQUEST");
    assertEquals(skillResult.error, undefined);

    const operation = byPhase.get("email_operation")!;
    assertEquals(Object.keys(operation).sort(), [
      "operationId",
      "phase",
      "safeCode",
      "sentCopy",
      "targetKind",
      "workId",
    ]);
    assertEquals(operation.phase, "submitted");
    assertEquals(operation.sentCopy, "failed");
    assertEquals(operation.targetKind, "third-party");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("email audit - non-email entries remain byte-compatible", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(dir, "discord", "123", "sess_plain", auditConfig(false));
    const payloads = phasePayloads();
    for (const [phase, data] of payloads) await writer.write(phase, data);

    const entries = await readEntries(join(dir, "discord", "123", "sess_plain.jsonl"));
    for (const [index, [phase, data]] of payloads.entries()) {
      assertEquals(entries[index].phase, phase);
      assertEquals(entries[index].data, data);
    }
    // The raw prompt content is still recorded verbatim when hashing is disabled.
    assertStringIncludes(
      JSON.stringify(entries[2].data),
      `Inbound request ${BODY_SENTINEL} ${PASSWORD_SENTINEL}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("email audit - projection is idempotent and a canonical digest always wins", async () => {
  const canonical = `sha256:${await sha256Hash("canonical")}`;
  const first = await projectEmailAuditData({
    message: "raw body",
    messageHash: canonical,
    messageLength: 8,
    toolName: FILENAME_SENTINEL,
    command: `cat /staging/${FILENAME_SENTINEL}`,
    filePaths: ["/staging/one.pdf", "/staging/two.pdf"],
    count: 2,
    sessionId: SESSION_ID,
    userId: ADDRESS_SENTINEL,
    // An unknown wrapper must be dropped whole, however many of its fields would
    // have survived on their own.
    nested: { error: PASSWORD_SENTINEL, operation: "save", count: 1 },
    // Property names are untrusted too: a private string must not survive as a
    // key holding a boolean, an object or a digest.
    [ADDRESS_SENTINEL]: true,
    [FILENAME_SENTINEL]: { count: 1 },
    [PASSWORD_SENTINEL]: `sha256:${PLACEHOLDER_HASH}`,
  });
  assertNoSentinel(JSON.stringify(first), "the projected email data");
  assertEquals(first.messageHash, canonical);
  assertEquals(first.messageLength, 8);
  assertEquals(first.count, 2);
  assertEquals(first.toolNameHash, `sha256:${await sha256Hash(FILENAME_SENTINEL)}`);
  assertEquals(
    first.commandHash,
    `sha256:${await sha256Hash(`cat /staging/${FILENAME_SENTINEL}`)}`,
  );
  assertEquals(first.filePathsCount, 2);
  assertStringIncludes(String(first.filePathsHash), "sha256:");
  assertEquals(first.sessionId, SESSION_ID);
  assertEquals(first.userId, undefined);
  assertEquals(first.message, undefined);
  assertEquals(first.nested, undefined);
  assertEquals(first[ADDRESS_SENTINEL], undefined);
  assertEquals(first[FILENAME_SENTINEL], undefined);
  assertEquals(first[PASSWORD_SENTINEL], undefined);

  // A second pass returns exactly the same object (no `…HashHash` growth).
  assertEquals(await projectEmailAuditData(first), first);

  // Key order must not change which digest wins.
  const reversed = await projectEmailAuditData({ messageHash: canonical, message: "raw body" });
  assertEquals(reversed.messageHash, canonical);
});

Deno.test("email audit - agent payloads cannot impersonate host metadata", async () => {
  // A model may name any key it likes; only the narrow param allowlist and the
  // observable counters survive, so a recognized-looking name is not enough.
  const projected = await projectEmailAuditData({
    skillName: "send-reply",
    skillParams: {
      message: BODY_SENTINEL,
      WorkId: PASSWORD_SENTINEL,
      model: FILENAME_SENTINEL,
      reason: "private-body",
      visibility: "public",
      success: true,
      [PASSWORD_SENTINEL]: PASSWORD_SENTINEL,
    },
    skillResult: { success: false, code: "SKILL_EMAIL_COMPOSE_REQUEST" },
  });
  assertNoSentinel(JSON.stringify(projected), "the projected agent payload");
  const params = projected.skillParams as Record<string, unknown>;
  assertEquals(params.WorkId, undefined);
  assertEquals(params.model, undefined);
  assertEquals(params.reason, undefined);
  assertEquals(params.visibility, undefined);
  assertEquals(params.success, true);
  assertEquals(params.messageHash, `sha256:${await sha256Hash(BODY_SENTINEL)}`);
  assertEquals(params.messageLength, BODY_SENTINEL.length);
  assertEquals(
    (projected.skillResult as Record<string, unknown>).code,
    "SKILL_EMAIL_COMPOSE_REQUEST",
  );

  // The operation allowlist validates each field's own enum, and a canonical
  // digest never substitutes for a classification.
  const operation = projectEmailOperationData({
    operationId: `op_${"f".repeat(24)}`,
    workId: WORK_ID,
    phase: "private-body",
    // A canonical digest is not a target class, and neither is a private word:
    // only the exact enum survives.
    targetKind: `sha256:${PLACEHOLDER_HASH}` as "user",
    sentCopy: "failed",
    safeCode: "APPEND_FAILED",
  });
  assertEquals(operation.operationId, `op_${"f".repeat(24)}`);
  assertEquals(operation.workId, WORK_ID);
  assertEquals(operation.sentCopy, "failed");
  assertEquals(operation.phase, undefined);
  assertEquals(operation.targetKind, undefined);
  assertEquals(operation.safeCode, "APPEND_FAILED");
});

Deno.test("email audit - a failing private write reports a code, never the exception text", async () => {
  const writer = new SessionAuditWriter(
    "/nonexistent/private-audit-root",
    "email",
    OWNER,
    SESSION_ID,
    auditConfig(false),
  );
  const { logs } = await capturingLogs(async () => {
    await writer.write("session_end", { error: PASSWORD_SENTINEL, success: false });
  });
  assert(logs.length > 0, "the write failure is logged");
  assertNoSentinel(logs.join("\n"), "the private audit failure log");
  assertStringIncludes(logs.join("\n"), "AUDIT_WRITE_FAILED");
});

Deno.test("email audit - the forward projection keeps only opaque ids and digests", async () => {
  const projected = await emailComposeAuditParams({
    grantId: "grant-1",
    request: {
      action: "forward",
      sourceRecordId: THREAD_ID,
      to: ADDRESS_SENTINEL,
      subject: SUBJECT_SENTINEL,
      body: BODY_SENTINEL,
      attachments: [`/staging/${FILENAME_SENTINEL}`],
    },
  });
  const entry = await projectEmailAuditData({ skillName: "send-email", skillParams: projected });
  assertNoSentinel(JSON.stringify(entry), "the projected forward skill params");
  const params = entry.skillParams as Record<string, unknown>;
  assertEquals(params.action, "forward");
  assertEquals(params.sourceRecordId, THREAD_ID);
  assertEquals(params.attachmentsCount, 1);
  assertStringIncludes(String(params.destinationHash), "sha256:");
  assertStringIncludes(String(params.subjectHash), "sha256:");
  assertStringIncludes(String(params.bodyHash), "sha256:");
});

// ---------------------------------------------------------------------------
// Logger privacy
// ---------------------------------------------------------------------------

Deno.test("logger - email module loggers and email session loggers are private", async () => {
  const { logs } = await capturingLogs(() => {
    const compose = new Logger("EmailComposeHandler", { level: LogLevel.DEBUG });
    compose.info("Email submitted ({TargetKind}, {Attachments} attachments)", {
      TargetKind: "third-party",
      Attachments: 1,
      OperationId: `op_${"b".repeat(24)}`,
      workspaceKey: `email/${OWNER}`,
      error: `provider said ${PASSWORD_SENTINEL}`,
    });
    compose.error("Email submission threw: {error}", { error: BODY_SENTINEL });

    // The session logger of an email conversation: `child("email:<address>")`
    // under the shared orchestrator module.
    const session = new Logger("SessionOrchestrator", { level: LogLevel.DEBUG })
      .child(`email:${ADDRESS_SENTINEL}`)
      .withContext({ userId: ADDRESS_SENTINEL, channelId: `mail:${OWNER}:${THREAD_ID}` });
    session.info("Processing message", {
      platform: "email",
      contentLength: BODY_SENTINEL.length,
      userId: ADDRESS_SENTINEL,
    });
    new Logger("SkillAPIServer", { level: LogLevel.DEBUG })
      .withPrivateEmail()
      .info("private context", { message: BODY_SENTINEL });
    // A workspace-keyed maintenance logger of the email workspace, and a log
    // context whose private strings arrive as property names.
    new Logger("SessionOrchestrator", { level: LogLevel.DEBUG })
      .child(`memory-maintenance:email/${OWNER}`)
      .error("Memory maintenance failed", {
        error: PASSWORD_SENTINEL,
        [ADDRESS_SENTINEL]: true,
        [FILENAME_SENTINEL]: `sha256:${PLACEHOLDER_HASH}`,
      });
    return Promise.resolve();
  });

  const joined = logs.join("\n");
  assertNoSentinel(joined, "the private log stream");
  const entries = logs.map((line) =>
    JSON.parse(line) as {
      module: string;
      message: string;
      context?: Record<string, unknown>;
    }
  );
  // Operational identifiers survive; the placeholder is redacted, not leaked.
  assertEquals(entries[0].context?.TargetKind, "third-party");
  assertEquals(entries[0].context?.OperationId, `op_${"b".repeat(24)}`);
  assertEquals(entries[0].context?.workspaceKey, undefined);
  assertEquals(entries[0].context?.error, undefined);
  assertEquals(entries[0].message, "Email submitted (third-party, 1 attachments)");
  assertEquals(entries[1].message, "Email submission threw: [redacted]");
  assertEquals(entries[2].module, "SessionOrchestrator:email:[redacted-address]");
  assertEquals(entries[2].context?.contentLength, BODY_SENTINEL.length);
  assertEquals(entries[2].context?.userId, undefined);
  // The opted-in mixed logger is private; the ordinary one is untouched.
  assertEquals(entries[3].message, "private context");
  assertEquals(entries[3].context, undefined);
  // The canonical owner id is already a digest, so the module name stays as-is;
  // the private context is what gets dropped.
  assertEquals(entries[4].module, `SessionOrchestrator:memory-maintenance:email/${OWNER}`);
  assertEquals(entries[4].context, undefined);
});

Deno.test("logger - GELF receives the projected entry, not the raw context", async () => {
  const sent: Record<string, unknown>[] = [];
  const logger = new Logger("EmailMailService", {
    level: LogLevel.DEBUG,
    gelfTransport: {
      send: (entry) => {
        sent.push(entry as unknown as Record<string, unknown>);
      },
    },
  });
  const { logs } = await capturingLogs(() => {
    logger.info("Email submission finished: {Phase}", {
      Phase: "submitted",
      OperationId: `op_${"a".repeat(24)}`,
      error: PASSWORD_SENTINEL,
    });
    return Promise.resolve();
  });
  assertNoSentinel(logs.join("\n"), "the private console stream");
  assertEquals(sent.length, 1);
  assertNoSentinel(JSON.stringify(sent[0]), "the GELF payload");
  assertEquals((sent[0].context as Record<string, unknown>).OperationId, `op_${"a".repeat(24)}`);
  assertEquals((sent[0].context as Record<string, unknown>).error, undefined);
});

Deno.test("logger - concurrent email and non-email executions cannot leak into each other", async () => {
  const { logs } = await capturingLogs(async () => {
    const emailLogger = new Logger("SkillRegistry", { level: LogLevel.DEBUG });
    const discordLogger = new Logger("SkillRegistry", { level: LogLevel.DEBUG });
    await Promise.all([
      runWithPrivateEmailScope(async () => {
        await Promise.resolve();
        emailLogger.error("Skill {skillName} execution error", {
          skillName: "send-email",
          error: PASSWORD_SENTINEL,
        });
      }),
      (async () => {
        await Promise.resolve();
        discordLogger.error("Skill {skillName} execution error", {
          skillName: "send-reply",
          error: PASSWORD_SENTINEL,
        });
      })(),
    ]);
  });
  const entries = logs.map((line) =>
    JSON.parse(line) as { message: string; context?: Record<string, unknown> }
  );
  assertEquals(entries.length, 2);
  const emailEntry = entries.find((entry) => (entry.context?.skillName as string) === "send-email");
  const discordEntry = entries.find((entry) =>
    (entry.context?.skillName as string) === "send-reply"
  );
  assertEquals(emailEntry?.context?.error, undefined);
  assertEquals(discordEntry?.context?.error, PASSWORD_SENTINEL);
});

Deno.test("logger - a non-email logger keeps its ordinary context", async () => {
  const { logs } = await capturingLogs(() => {
    new Logger("SkillAPIServer", { level: LogLevel.DEBUG })
      .info("ordinary context", { message: BODY_SENTINEL, sessionId: SESSION_ID });
    return Promise.resolve();
  });
  const entry = JSON.parse(logs[0]) as { message: string; context?: Record<string, unknown> };
  assertStringIncludes(entry.message, "ordinary context");
  assertEquals(entry.context?.message, BODY_SENTINEL);
});

Deno.test("logger - the ambient private scope covers an unrelated module logger", async () => {
  const { logs } = await capturingLogs(async () => {
    const registry = new Logger("SkillRegistry", { level: LogLevel.DEBUG });
    registry.error("Skill {skillName} execution error", {
      skillName: "send-email",
      error: `thrown: ${PASSWORD_SENTINEL}`,
      workspaceKey: `email/${OWNER}`,
    });
    await runWithPrivateEmailScope(() => {
      registry.error("Skill {skillName} execution error", {
        skillName: "send-email",
        error: `thrown: ${PASSWORD_SENTINEL}`,
        workspaceKey: `email/${OWNER}`,
      });
      return Promise.resolve();
    });
  });

  const entries = logs.map((line) =>
    JSON.parse(line) as {
      message: string;
      context?: Record<string, unknown>;
    }
  );
  assertEquals(entries.length, 2);
  assertStringIncludes(String(entries[0].context?.error), PASSWORD_SENTINEL);
  assertEquals(entries[1].context?.error, undefined);
  assertEquals(entries[1].context?.workspaceKey, undefined);
  assertEquals(entries[1].context?.skillName, "send-email");
  assertEquals(entries[1].message, "Skill send-email execution error");
});

// ---------------------------------------------------------------------------
// ACP client
// ---------------------------------------------------------------------------

function allowList() {
  const root = Deno.makeTempDirSync({ prefix: "air-privacy-skills-" });
  return buildSkillAutoApproveList({
    rootObservation: observeTrustedSkillsRoot("opencode", root),
  });
}

function acpClient(
  dir: string,
  platform: "email" | "discord",
  logger: Logger,
  auditWriter?: SessionAuditWriter,
): ChatbotClient {
  const config: ClientConfig = {
    workingDir: dir,
    platform,
    userId: platform === "email" ? OWNER : "123",
    channelId: platform === "email" ? formatEmailChannelId(OWNER, THREAD_ID) : "456",
    isDM: true,
    logAgentStreamChunks: true,
  };
  const client = new ChatbotClient(
    { hasSkill: () => false } as unknown as SkillRegistry,
    logger,
    config,
    allowList(),
  );
  if (auditWriter) client.setAuditWriter(auditWriter);
  return client;
}

Deno.test("acp client - an email session logs metadata only and hashes agent text", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(dir, "email", OWNER, SESSION_ID, auditConfig(false));
    const client = acpClient(
      dir,
      "email",
      new Logger("test", { level: LogLevel.DEBUG }),
      writer,
    );

    const { logs } = await capturingLogs(async () => {
      await client.sessionUpdate({
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `${BODY_SENTINEL} ` },
        },
      } as acp.SessionNotification);
      await client.sessionUpdate({
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: PASSWORD_SENTINEL },
        },
      } as acp.SessionNotification);
      await client.sessionUpdate({
        sessionId: "s",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-1",
          title: FILENAME_SENTINEL,
          kind: "edit",
          status: "pending",
          rawInput: { content: `${SUBJECT_SENTINEL} /staging/${FILENAME_SENTINEL}` },
        },
      } as acp.SessionNotification);
      await client.sessionUpdate({
        sessionId: "s",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          status: "failed",
          output: `${PASSWORD_SENTINEL}`,
          error: `provider: ${BODY_SENTINEL}`,
        },
      } as acp.SessionNotification);
      client.flushMessageBuffer();
      client.flushThoughtBuffer();
      // The writer is fire-and-forget: an extra awaited write drains the queue,
      // so the assertions below read a settled file.
      await writer.write("session_end", { success: true });
    });

    assertNoSentinel(logs.join("\n"), "the email ACP log stream");
    // The complete-message summary keeps its counts but never the text.
    assertStringIncludes(logs.join("\n"), "[redacted]");

    const entries = await readEntriesWhenReady(
      join(dir, "email", OWNER, `${SESSION_ID}.jsonl`),
      (candidates) => candidates.some((entry) => entry.phase === "agent_complete_message"),
    );
    const complete = entries.find((entry) => entry.phase === "agent_complete_message");
    assert(complete, "the flushed message was audited");
    assertEquals(
      complete.data.messageContentHash,
      `sha256:${await sha256Hash(`${BODY_SENTINEL} ${PASSWORD_SENTINEL}`)}`,
    );
    assertEquals(complete.data.chunkCount, 2);
    assertNoSentinel(JSON.stringify(entries), "the email ACP audit entries");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("acp client - a discord session keeps its raw content and command", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = new SessionAuditWriter(dir, "discord", "123", "sess_d", auditConfig(false));
    const client = acpClient(
      dir,
      "discord",
      new Logger("test", { level: LogLevel.DEBUG }),
      writer,
    );

    const { logs } = await capturingLogs(async () => {
      await client.sessionUpdate({
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: BODY_SENTINEL },
        },
      } as acp.SessionNotification);
      client.flushMessageBuffer();
      await writer.write("session_end", { success: true });
    });

    assertStringIncludes(logs.join("\n"), BODY_SENTINEL);
    const entries = await readEntriesWhenReady(
      join(dir, "discord", "123", "sess_d.jsonl"),
      (candidates) => candidates.some((entry) => entry.phase === "agent_complete_message"),
    );
    const complete = entries.find((entry) => entry.phase === "agent_complete_message");
    assertEquals(complete?.data.messageContentHash, BODY_SENTINEL);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// File handler
// ---------------------------------------------------------------------------

/** Minimal skill context for the file handler under test. */
function fileContext(platform: "email" | "discord", workspacePath: string): SkillContext {
  const workspace: WorkspaceInfo = {
    key: platform === "email" ? `email/${OWNER}` : "discord/123",
    components: { platform, userId: platform === "email" ? OWNER : "123" },
    path: workspacePath,
    tmpPath: join(workspacePath, "tmp"),
    isDm: true,
  };
  return {
    sessionId: SESSION_ID,
    workspace,
    channelId: platform === "email" ? formatEmailChannelId(OWNER, THREAD_ID) : "456",
    userId: platform === "email" ? OWNER : "123",
    platformAdapter: {
      sendFile: () => Promise.resolve({ success: true, messageId: `msg-${SUBJECT_SENTINEL}` }),
    } as unknown as PlatformAdapter,
    replyToMessageId: undefined,
  } as SkillContext;
}

Deno.test("file handler - an email attachment name never reaches a diagnostic", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(dir, FILENAME_SENTINEL), "bytes");
    const handler = new FileHandler({ enabled: true, allowedExtensions: [".pdf"] });
    const context = fileContext("email", dir);

    const { logs } = await capturingLogs(async () => {
      const sent = await handler.handleSendFile({ filePaths: [FILENAME_SENTINEL] }, context);
      assertEquals(sent.success, true);
      // A missing staged attachment: the error path must stay metadata-only too.
      const missing = await handler.handleSendFile({ filePaths: ["gone.md"] }, context);
      assertEquals(missing.success, false);
    });

    assertNoSentinel(logs.join("\n"), "the email file-handler log stream");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Skill API + audit over the real HTTP path
// ---------------------------------------------------------------------------

interface EmailHarness {
  registry: SessionRegistry;
  sessionId: string;
  auditPath: string;
  /** Staging-directory-relative path of the sentinel-named attachment. */
  attachmentPath: string;
}

/** Records every adapter send and every staged mail submission of the session. */
function mailServiceDouble(): EmailComposeMailService & { drafts: number } {
  const service = {
    drafts: 0,
    send: () => {
      service.drafts += 1;
      return Promise.resolve({
        operationId: `op_${"c".repeat(24)}`,
        phase: "submitted" as const,
        targetKind: "user" as const,
        sentCopy: "failed" as const,
        safeCode: "APPEND_FAILED",
        reused: false,
      });
    },
  };
  return service;
}

async function withEmailEndpoint(
  port: number,
  options: {
    mailService?: EmailComposeMailService;
    failFileSend?: boolean;
    platform?: "email" | "discord";
    evidence?: EmailSubmissionEvidenceSource;
  },
  body: (harness: EmailHarness) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  const platform = options.platform ?? "email";
  const isEmail = platform === "email";
  const userId = isEmail ? OWNER : "123";
  const registry = new SessionRegistry();
  const workspaceManager = new WorkspaceManager({ repoPath: dir, workspacesDir: "workspaces" });
  const memoryStore = new MemoryStore(workspaceManager, {});
  const skillRegistry = new RealSkillRegistry(
    memoryStore,
    undefined,
    undefined,
    { enabled: true, allowedExtensions: [".pdf"], maxFilesPerInvocation: 10 } as never,
    undefined,
    options.mailService === undefined ? undefined : { mailService: options.mailService },
  );
  const auditPath = join(dir, "audit");
  const channelId = isEmail ? formatEmailChannelId(OWNER, THREAD_ID) : "456";
  const adapter = {
    sendReply: () =>
      Promise.resolve({
        success: true,
        messageId: `reply-${SUBJECT_SENTINEL}`,
        emailSubmission: {
          operationId: `op_${"d".repeat(24)}`,
          phase: "submitted",
          targetKind: "user",
          sentCopy: "appended",
        },
      }),
    sendFile: () => {
      if (options.failFileSend) {
        return Promise.reject(new Error(`adapter exploded: ${PASSWORD_SENTINEL}`));
      }
      return Promise.resolve({
        success: true,
        messageId: `file-${SUBJECT_SENTINEL}`,
        messageIds: [`file-${SUBJECT_SENTINEL}`],
        emailSubmission: {
          operationId: `op_${"e".repeat(24)}`,
          phase: "submitted",
          targetKind: "user",
        },
      });
    },
  };
  const sessionId = registry.register({
    platform,
    channelId,
    userId,
    isDm: true,
    workspace: {
      key: isEmail ? `email/${OWNER}` : "discord/123",
      components: { platform, userId },
      path: dir,
      tmpPath: join(dir, "tmp"),
      isDm: true,
    },
    platformAdapter: adapter as unknown as PlatformAdapter,
    agentWorkspacePath: dir,
    ...(isEmail ? { emailWorkId: WORK_ID } : {}),
    auditWriter: new SessionAuditWriter(
      auditPath,
      platform,
      userId,
      SESSION_ID,
      auditConfig(false),
    ),
    triggerEvent: {
      platform,
      channelId,
      userId,
      messageId: "msg_trigger",
      isDm: true,
      guildId: "",
      content: "",
      timestamp: new Date(),
    },
  });

  await Deno.writeTextFile(join(dir, FILENAME_SENTINEL), "attachment bytes");
  const attachmentPath = join("tmp", sessionId, FILENAME_SENTINEL);
  await Deno.mkdir(join(dir, "tmp", sessionId), { recursive: true });
  await Deno.writeTextFile(join(dir, attachmentPath), "staged attachment bytes");

  const server = new SkillAPIServer(
    registry,
    skillRegistry,
    { port, host: "127.0.0.1" },
    TEST_SKILL_SECRET,
  );
  if (options.evidence) server.setEmailSubmissionEvidence(options.evidence);
  server.start();
  await assertServerReachable(port);

  try {
    await body({
      registry,
      sessionId,
      auditPath,
      attachmentPath,
    });
  } finally {
    await server.stop();
    registry.stop();
    await Deno.remove(dir, { recursive: true });
  }
}

/**
 * The server's listener is bound synchronously by `Deno.serve`, so a bounded
 * immediate retry is enough — no wall-clock wait.
 */
async function assertServerReachable(port: number): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/skill/none`, { method: "POST" });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`skill API server on port ${port} did not start: ${lastError}`);
}

async function postSkill(
  port: number,
  registry: SessionRegistry,
  sessionId: string,
  skill: string,
  parameters: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const session = registry.get(sessionId)!;
  const token = await createSkillJwt(TEST_SKILL_SECRET, {
    sub: sessionId,
    channel: session.channelId,
    jti: registry.getCallerToken(sessionId) ?? "",
  });
  const response = await fetch(`http://127.0.0.1:${port}/api/skill/${skill}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionId, parameters }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

Deno.test("skill API - every email phase stays content-free under hashContent=false", async () => {
  const port = 34771;
  await withEmailEndpoint(
    port,
    { mailService: mailServiceDouble(), failFileSend: true },
    async (h) => {
      const { logs } = await capturingLogs(async () => {
        // Compose with every private field, including a staged attachment.
        const compose = await postSkill(port, h.registry, h.sessionId, "send-email", {
          request: {
            to: ADDRESS_SENTINEL,
            subject: SUBJECT_SENTINEL,
            body: BODY_SENTINEL,
            attachments: [h.attachmentPath],
          },
        });
        assertEquals(compose.status, 200);

        // A denied forward (no grant) is a failure branch with the same material.
        const forward = await postSkill(port, h.registry, h.sessionId, "send-email", {
          request: {
            action: "forward",
            sourceRecordId: THREAD_ID,
            to: ADDRESS_SENTINEL,
            subject: SUBJECT_SENTINEL,
            body: BODY_SENTINEL,
          },
        });
        assertEquals(forward.status, 400);

        // A reply carrying the private body.
        const reply = await postSkill(port, h.registry, h.sessionId, "send-reply", {
          message: BODY_SENTINEL,
        });
        assertEquals(reply.status, 200);

        // A file send whose adapter throws a password-bearing exception: the throw
        // crosses the skill registry's own logger.
        const files = await postSkill(port, h.registry, h.sessionId, "send-file", {
          filePaths: [FILENAME_SENTINEL],
        });
        assertEquals(files.status, 400);
      });
      assertNoSentinel(logs.join("\n"), "the email skill-API log stream");

      const auditFile = join(h.auditPath, "email", OWNER, `${SESSION_ID}.jsonl`);
      const raw = await Deno.readTextFile(auditFile);
      assertNoSentinel(raw, "the email skill-API audit file");
      const entries = await readEntries(auditFile);

      // Compose: skill params are identifiers, counts and digests.
      const composeCall = entries.find((entry) =>
        entry.phase === "skill_call" && entry.data.skillName === "send-email" &&
        (entry.data.skillParams as Record<string, unknown>)?.destinationHash !== undefined
      );
      assert(composeCall, "the compose skill call was audited");
      const params = composeCall.data.skillParams as Record<string, unknown>;
      assertStringIncludes(String(params.destinationHash), "sha256:");
      assertStringIncludes(String(params.subjectHash), "sha256:");
      assertStringIncludes(String(params.bodyHash), "sha256:");
      assertEquals(params.bodyLength, BODY_SENTINEL.length);
      assertEquals(params.attachmentsCount, 1);
      assertEquals(params.to, undefined);
      assertEquals(params.subject, undefined);
      assertEquals(params.body, undefined);

      // Operator visibility: the accepted mail whose sent-copy failed.
      const operation = entries.find((entry) => entry.phase === "email_operation");
      assert(operation, "the email operation was audited");
      assertEquals(operation.data.operationId, `op_${"c".repeat(24)}`);
      assertEquals(operation.data.workId, WORK_ID);
      assertEquals(operation.data.phase, "submitted");
      assertEquals(operation.data.sentCopy, "failed");
      assertEquals(operation.data.safeCode, "APPEND_FAILED");
      assertEquals(operation.data.targetKind, "user");

      // The denied forward records its typed code, never the refusal text or body.
      const forwardCall = entries.find((entry) =>
        entry.phase === "skill_call" &&
        (entry.data.skillParams as Record<string, unknown>)?.action === "forward"
      );
      assert(forwardCall, "the refused forward was audited");
      assertEquals((forwardCall.data.skillResult as Record<string, unknown>).success, false);

      // The reply body is hashed even though hashContent is false.
      const replyEntry = entries.find((entry) => entry.phase === "reply_sent");
      assert(replyEntry, "the email reply was audited");
      assertEquals(
        replyEntry.data.replyContentHash,
        `sha256:${await sha256Hash(BODY_SENTINEL)}`,
      );

      // The file send recorded the count and never the attachment name.
      const fileEntry = entries.find((entry) => entry.phase === "file_sent");
      assertEquals(fileEntry, undefined, "a thrown email file send records no file_sent entry");

      // Metrics carry the platform/skill labels only.
      const metrics = await metricsRegistry.metrics();
      assertNoSentinel(metrics, "the metrics output");
    },
  );
});

Deno.test("skill API - a malformed email request body is reported without its content", async () => {
  const port = 34772;
  await withEmailEndpoint(port, { mailService: mailServiceDouble() }, async (h) => {
    const { logs } = await capturingLogs(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/skill/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer nope" },
        body:
          `{"sessionId": "${h.sessionId}", "parameters": {"request": {"body": "${BODY_SENTINEL}"`,
      });
      assertEquals(response.status, 400);
      await response.json();
    });
    assertNoSentinel(logs.join("\n"), "the malformed-body log stream");
    assertStringIncludes(logs.join("\n"), "SKILL_API_INVALID_JSON_BODY");
  });
});

Deno.test("skill API - a valid null body keeps the structured error response", async () => {
  const port = 34773;
  await withEmailEndpoint(port, { mailService: mailServiceDouble() }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/skill/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    assertEquals(response.status, 400);
    assertEquals(await response.json(), { success: false, error: "Missing sessionId" });
  });
});

Deno.test("skill API - durable evidence recovered for a lost response is audited", async () => {
  const port = 34774;
  await withEmailEndpoint(port, {
    mailService: mailServiceDouble(),
    failFileSend: true,
    evidence: {
      lookup: (_owner, key) =>
        key.actionSlot === "files"
          ? {
            operationId: `op_${"a".repeat(24)}`,
            phase: "submitted",
            targetKind: "user",
            sentCopy: "failed",
            safeCode: "APPEND_FAILED",
            reused: false,
          }
          : undefined,
    },
  }, async (h) => {
    // The adapter throws, so the skill result carries no metadata at all; only
    // the durable journal knows the mail was accepted.
    const files = await postSkill(port, h.registry, h.sessionId, "send-file", {
      filePaths: [FILENAME_SENTINEL],
    });
    assertEquals(files.status, 400);

    const entries = await readEntries(
      join(h.auditPath, "email", OWNER, `${SESSION_ID}.jsonl`),
    );
    const operation = entries.find((entry) => entry.phase === "email_operation");
    assert(operation, "the recovered durable evidence was audited");
    assertEquals(operation.data.operationId, `op_${"a".repeat(24)}`);
    assertEquals(operation.data.workId, WORK_ID);
    assertEquals(operation.data.phase, "submitted");
    assertEquals(operation.data.sentCopy, "failed");
    assertEquals(operation.data.safeCode, "APPEND_FAILED");
    assertNoSentinel(JSON.stringify(entries), "the recovered-evidence audit entries");
  });
});

Deno.test("skill API - a successful email file send audits counts, not names", async () => {
  const port = 34775;
  await withEmailEndpoint(port, { mailService: mailServiceDouble() }, async (h) => {
    const files = await postSkill(port, h.registry, h.sessionId, "send-file", {
      filePaths: [FILENAME_SENTINEL],
    });
    assertEquals(files.status, 200);
    const job = await postSkill(port, h.registry, h.sessionId, "send-email", {
      request: { to: ADDRESS_SENTINEL, subject: SUBJECT_SENTINEL, body: BODY_SENTINEL },
    });
    assertEquals(job.status, 200);

    const entries = await readEntries(
      join(h.auditPath, "email", OWNER, `${SESSION_ID}.jsonl`),
    );
    assertNoSentinel(JSON.stringify(entries), "the successful email audit entries");
    const fileEntry = entries.find((entry) => entry.phase === "file_sent");
    assert(fileEntry, "the email file send was audited");
    assertEquals(fileEntry.data.filesCount, 1);
    assertEquals(fileEntry.data.fileNames, undefined);
    assertStringIncludes(String(fileEntry.data.fileNamesHash), "sha256:");
    // A submitted operation without a reported copy state records no sentCopy.
    const operations = entries.filter((entry) => entry.phase === "email_operation");
    assertEquals(operations.length, 2);
  });
});

Deno.test("skill API - non-email skill results stay byte-compatible", async () => {
  const port = 34776;
  await withEmailEndpoint(port, { platform: "discord" }, async (h) => {
    // A workspace-prefixed path that exists only as the redundant spelling
    // yields the typed guidance code on top of the error text; the audit must
    // keep the pre-change `{success, error}` shape.
    await Deno.mkdir(join(h.auditPath, "..", "data", "workspaces", "discord", "123"), {
      recursive: true,
    });

    const response = await postSkill(port, h.registry, h.sessionId, "send-file", {
      filePaths: ["data/workspaces/discord/123/report.pdf"],
    });
    assertEquals(response.status, 400);
    assertEquals(response.body.code, "SKILL_FILE_PATH_WORKSPACE_PREFIXED");

    const entries = await readEntries(
      join(h.auditPath, "discord", "123", `${SESSION_ID}.jsonl`),
    );
    const call = entries.find((entry) => entry.phase === "skill_call");
    assert(call, "the discord skill call was audited");
    assertEquals(call.data.skillResult, {
      success: false,
      error: String(response.body.error),
    });
    assertEquals("code" in (call.data.skillResult as Record<string, unknown>), false);
    assertEquals(entries.some((entry) => entry.phase === "email_operation"), false);
  });
});

// ---------------------------------------------------------------------------
// Pre-session reminder replay (due-reminder enumeration)
// ---------------------------------------------------------------------------

Deno.test("reminder replay - a malformed email line logs a position, never content", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new ReminderStore("reminders.jsonl");
    // Line 1 parses (and holds the private body); line 2 is malformed AND carries
    // every other sentinel. The parser's own message would quote it verbatim.
    await Deno.writeTextFile(
      join(dir, "reminders.jsonl"),
      [
        `{"type":"reminder","id":"rem_1","message":"${BODY_SENTINEL}","enabled":false}`,
        `{"type":"reminder" ${ADDRESS_SENTINEL} ${PASSWORD_SENTINEL} ${FILENAME_SENTINEL}`,
      ].join("\n") + "\n",
    );
    const emailWorkspace = {
      key: `email/${OWNER}`,
      components: { platform: "email", userId: OWNER },
      path: dir,
      tmpPath: join(dir, "tmp"),
      isDm: true,
    } as WorkspaceInfo;

    const { result, logs } = await capturingLogs(() => store.getDueReminders(emailWorkspace));
    assertEquals(result, []);

    const logged = logs.join("\n");
    // The safe code and the line/byte position are the whole diagnostic.
    assertStringIncludes(logged, '"code":"REMINDER_LINE_PARSE_FAILED"');
    assertStringIncludes(logged, '"line":2');
    assert(/"offset":\d+/.test(logged), `the position must be reported: ${logged}`);
    assertNoSentinel(logged, "the pre-session reminder replay log");
    assertEquals(
      /SyntaxError|Unexpected token|is not valid JSON/.test(logged),
      false,
      "a content-bearing parser exception must not be logged",
    );

    // A non-email workspace keeps the historical diagnostic unchanged.
    const control = await capturingLogs(() =>
      store.getDueReminders({
        key: "discord/123",
        components: { platform: "discord", userId: "123" },
        path: dir,
        tmpPath: join(dir, "tmp"),
        isDm: true,
      } as WorkspaceInfo)
    );
    const controlLog = control.logs.join("\n");
    assertStringIncludes(controlLog, PASSWORD_SENTINEL);
    assertStringIncludes(controlLog, "SyntaxError");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
