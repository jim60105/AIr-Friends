// tests/core/email-response-accounting.test.ts
//
// Regression tests for `email-response-accounting` (row 22): explicit email
// response accounting, the durable-evidence retry gates and the
// review-required escalation.
//
// They exercise the REAL `SessionOrchestrator` session lifecycle, the real
// `SessionRegistry`, the real `MailboxStore`/`EmailSessionReceipts` durable
// receipt journal on disk, the real retry-prompt and summary-prompt builders
// (their trusted skill documents are read from the deployment tree) and the pure
// accounting module. The mail service's durable journal is replaced by an
// in-memory evidence source that scopes and records every lookup, so the
// consulted identity is observable; the SMTP transport itself is not exercised
// here (row 13's own suite owns wire-level DATA counts), and no model or
// production credential is involved.
//
// Asserted behavior:
//   * a submitted third-party (or user) email counts as a session response and
//     suppresses the missing-response retry WITHOUT writing reply anchors;
//   * an unresolved (`unknown`) submission suppresses the retry, forbids the
//     fallback notice and escalates the durable receipt to review-required;
//   * a recorded non-delivery (`failed`) keeps the retry available and never
//     replaces the logical slot;
//   * durable evidence is consulted for THIS work item only, and only after
//     in-flight effects settle; an unsettleable drain is itself unresolved;
//   * third-party-only completion skips the reply summary;
//   * Discord/Misskey sessions keep their existing response fields.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import type { PromptResponse } from "npm:@agentclientprotocol/sdk@^0.14.1";
import { AgentProcessPool } from "@core/agent-process-pool.ts";
import { ContextAssembler } from "@core/context-assembler.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { SessionOrchestrator, type SessionResponse } from "@core/session-orchestrator.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { type ActiveSession, SessionRegistry } from "../../src/skill-api/session-registry.ts";
import type { AgentConnector, AgentProcessEvidence } from "../../src/acp/agent-connector.ts";
import type { AgentConnectorOptions } from "../../src/acp/types.ts";
import { readJournal } from "../../src/platforms/email/durable-files.ts";
import {
  buildMailboxFingerprint,
  type MailboxEntryRecord,
  type MailboxKey,
  MailboxStore,
  PROCESSING_JOURNAL_FILENAME,
} from "../../src/platforms/email/mailbox-store.ts";
import type { EmailSendOutcome } from "../../src/platforms/email/mail-service.ts";
import type { EmailOperationKey } from "../../src/platforms/email/submission-store.ts";
import { EmailSessionReceipts } from "../../src/platforms/email/session-receipts.ts";
import {
  EMAIL_ORDINARY_ACTION_SLOTS,
  emailResponseFromEvidence,
  emailResponseSlots,
  emailSessionOwner,
  EMPTY_EMAIL_RESPONSE,
  hasEmailResponseOrUncertainty,
  hasEmailSubmitted,
  hasEmailUncertaintyEvidence,
  recordEmailSubmission,
  recordEmailUncertainty,
} from "../../src/core/email-response-accounting.ts";
import type { EmailSubmissionMetadata } from "../../src/types/platform.ts";
import type { SkillContext } from "../../src/skills/types.ts";
import type { Config } from "../../src/types/config.ts";
import {
  type EmailWorkReceipt,
  type NormalizedEvent,
  type PlatformMessage,
} from "../../src/types/events.ts";
import type { PlatformCapabilities, ReplyResult } from "../../src/types/platform.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

const RESOLVED_SKILLS_ROOT = Deno.realPathSync(resolve(import.meta.dirname ?? ".", "../../skills"));

const WORK_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_WORK_ID = "99999999-8888-7777-6666-555555555555";
/** A well-formed mailbox owner identity (`e_<64 hex>`). */
const OWNER = `e_${"0123456789abcdef".repeat(4)}`;
const FINGERPRINT = buildMailboxFingerprint("imap.example.com", "bot@example.com", "INBOX");
const RECORD_ID = "rec_0123456789abcdef";
const MAILBOX_KEY: MailboxKey = { fingerprint: FINGERPRINT, uidValidity: 987654321, uid: 42 };
const UNKNOWN_ERROR = "email_submission_outcome_unknown: review-required";

// --- Accounting module ------------------------------------------------------------

function submission(
  phase: EmailSubmissionMetadata["phase"],
  targetKind?: "user" | "third-party",
  operationId = `op_${phase}_${targetKind ?? "none"}`,
): EmailSubmissionMetadata {
  return { operationId, phase, ...(targetKind === undefined ? {} : { targetKind }) };
}

Deno.test("Accounting: a submitted third-party send responds without a user anchor", () => {
  const accounting = recordEmailSubmission(
    undefined,
    submission("submitted", "third-party"),
    "third-party:g1",
  );
  assertEquals(accounting.submittedToThirdParty, true);
  assertEquals(accounting.submittedToUser, false);
  assertEquals(accounting.unknown, false);
  assertEquals(hasEmailSubmitted(accounting), true);
  assertEquals(hasEmailResponseOrUncertainty(accounting), true);
  assertEquals(accounting.operations.length, 1);
  assertEquals(accounting.operations[0].actionSlot, "third-party:g1");
});

Deno.test("Accounting: the third-party slot classifies a send whose producer omitted targetKind", () => {
  const accounting = recordEmailSubmission(
    undefined,
    submission("submitted"),
    "third-party:grant-9",
  );
  assertEquals(accounting.submittedToThirdParty, true);
  assertEquals(accounting.submittedToUser, false);
});

Deno.test("Accounting: unknown and an unclosed submitting slot are unresolved evidence", () => {
  for (const phase of ["unknown", "submitting"] as const) {
    const accounting = recordEmailSubmission(undefined, submission(phase), "reply");
    assertEquals(accounting.unknown, true);
    assertEquals(hasEmailSubmitted(accounting), false);
    assertEquals(hasEmailResponseOrUncertainty(accounting), true);
    assertEquals(hasEmailUncertaintyEvidence(accounting), true);
  }
});

Deno.test("Accounting: a recorded non-delivery neither responds nor suppresses the retry", () => {
  for (const phase of ["failed", "prepared"] as const) {
    const accounting = recordEmailSubmission(undefined, submission(phase), "reply");
    assertEquals(hasEmailSubmitted(accounting), false);
    assertEquals(hasEmailResponseOrUncertainty(accounting), false);
    assertEquals(accounting.operations[0].phase, phase);
  }
});

Deno.test("Accounting: a completed or unresolved slot is never downgraded or duplicated", () => {
  const submitted = recordEmailSubmission(
    undefined,
    submission("submitted", "user", "op1"),
    "reply",
  );
  // A later observation of the SAME slot with a different operation id cannot
  // replace the recorded terminal result.
  const afterFailed = recordEmailSubmission(
    submitted,
    submission("failed", "user", "op2"),
    "reply",
  );
  assertEquals(afterFailed.submittedToUser, true);
  assertEquals(afterFailed.operations.length, 1);
  assertEquals(afterFailed.operations[0].operationId, "op1");

  // A repeated read of the same operation adds nothing either.
  const repeated = recordEmailSubmission(
    afterFailed,
    submission("submitted", "user", "op1"),
    "reply",
  );
  assertEquals(repeated.operations.length, 1);
  assertEquals(repeated.submittedToUser, true);

  // An unresolved slot is equally absorbing.
  const unknown = recordEmailSubmission(undefined, submission("unknown", "user", "op3"), "reply");
  const upgraded = recordEmailSubmission(unknown, submission("submitted", "user", "op5"), "reply");
  assertEquals(upgraded.operations.length, 1);
  assertEquals(upgraded.unknown, true);
  assertEquals(upgraded.submittedToUser, false);
});

Deno.test("Accounting: a later observation enriches a slot-less entry, never duplicates it", () => {
  const first = recordEmailSubmission(undefined, submission("submitted", "third-party", "opX"));
  assertEquals(first.operations[0].actionSlot, undefined);
  const enriched = recordEmailSubmission(
    first,
    submission("submitted", "third-party", "opX"),
    "third-party:g2",
  );
  assertEquals(enriched.operations.length, 1);
  assertEquals(enriched.operations[0].actionSlot, "third-party:g2");
});

Deno.test("Accounting: uncertainty latches without inventing an operation", () => {
  const latched = recordEmailUncertainty(undefined);
  assertEquals(latched.unknown, true);
  assertEquals(latched.operations.length, 0);
  assertEquals(hasEmailResponseOrUncertainty(latched), true);
  // Latched twice: the snapshot stays the same, non-absorbing state is kept.
  const failed = recordEmailSubmission(latched, submission("failed"), "reply");
  assertEquals(recordEmailUncertainty(failed), failed);
});

Deno.test("Accounting: the durable read merges every recorded logical slot", () => {
  const recorded = new Map<string, EmailSendOutcome>();
  recorded.set("reply", {
    operationId: "op-reply",
    phase: "submitted",
    targetKind: "user",
    reused: true,
  });
  recorded.set("third-party:g1", {
    operationId: "op-third",
    phase: "submitted",
    targetKind: "third-party",
    reused: true,
  });
  const accounting = emailResponseFromEvidence({
    owner: OWNER,
    workId: WORK_ID,
    slots: emailResponseSlots([{ grantId: "g1" }]),
    lookup: (_owner: string, key: EmailOperationKey) => recorded.get(key.actionSlot as string),
  });
  assertEquals(accounting.submittedToUser, true);
  assertEquals(accounting.submittedToThirdParty, true);
  assertEquals(accounting.operations.length, 2);
});

Deno.test("Accounting: slot enumeration and owner identity", () => {
  assertEquals([...EMAIL_ORDINARY_ACTION_SLOTS], ["reply", "files", "compose"]);
  assertEquals(emailResponseSlots(undefined), ["reply", "files", "compose"]);
  assertEquals(emailResponseSlots([{ grantId: "a" }, { grantId: "b" }]), [
    "reply",
    "files",
    "compose",
    "third-party:a",
    "third-party:b",
  ]);
  assertEquals(emailSessionOwner({ platform: "email", userId: OWNER.toUpperCase() }), OWNER);
  assertEquals(emailSessionOwner({ platform: "discord", userId: OWNER }), undefined);
  assertEquals(emailSessionOwner({ platform: "email", userId: "e_short" }), undefined);
});

Deno.test("Accounting: an empty accounting is frozen and empty", () => {
  assertEquals(EMPTY_EMAIL_RESPONSE.operations.length, 0);
  assertEquals(hasEmailSubmitted(EMPTY_EMAIL_RESPONSE), false);
  assertEquals(hasEmailResponseOrUncertainty(undefined), false);
});

// --- Session registry -------------------------------------------------------------

function registryWithEmailSession(): { registry: SessionRegistry; id: string } {
  const registry = new SessionRegistry();
  const id = registry.register({
    platform: "email",
    channelId: `mail:${OWNER}:${RECORD_ID}`,
    userId: OWNER,
    isDm: true,
    workspace: {
      key: "email/account",
      path: "/tmp/ws",
      tmpPath: "/tmp/ws/tmp",
      isDm: true,
      components: { platform: "email", userId: OWNER },
    } as never,
  });
  return { registry, id };
}

Deno.test("Registry: records accounting and exposes the retry-suppression verdict", () => {
  const { registry, id } = registryWithEmailSession();
  try {
    assertEquals(registry.hasEmailSubmitted(id), false);
    assertEquals(registry.emailResponseOf(id), EMPTY_EMAIL_RESPONSE);

    assertEquals(
      registry.recordEmailSubmission(id, submission("submitted", "third-party"), "compose"),
      true,
    );
    assertEquals(registry.hasEmailSubmitted(id), true);
    assertEquals(registry.hasEmailResponseOrUncertainty(id), true);
    assertEquals(registry.emailResponseOf(id).submittedToThirdParty, true);

    assertEquals(registry.markEmailResponseUnknown(id), true);
    assertEquals(registry.emailResponseOf(id).unknown, true);
    // A recorded submission survives the uncertainty latch (monotonic).
    assertEquals(registry.emailResponseOf(id).submittedToThirdParty, true);
  } finally {
    registry.stop();
  }
});

Deno.test("Registry: an unknown session records nothing and reads empty", () => {
  const { registry } = registryWithEmailSession();
  try {
    assertEquals(
      registry.recordEmailSubmission("sess_missing", submission("submitted"), "reply"),
      false,
    );
    assertEquals(registry.markEmailResponseUnknown("sess_missing"), false);
    assertEquals(registry.emailResponseOf("sess_missing"), EMPTY_EMAIL_RESPONSE);
    assertEquals(registry.hasEmailSubmitted("sess_missing"), false);
    assertEquals(registry.hasEmailResponseOrUncertainty("sess_missing"), false);
  } finally {
    registry.stop();
  }
});

// --- Orchestrator harness ---------------------------------------------------------

interface PromptCall {
  channelId: string;
  callIndex: number;
}
type PromptScript = (call: PromptCall) => Promise<PromptResponse>;

class ScriptedConnector {
  connected = false;
  promptCallCount = 0;
  readonly channelId: string;
  processEvidence: AgentProcessEvidence = { generations: 0, pid: undefined };
  constructor(
    options: AgentConnectorOptions,
    private readonly script: { current: PromptScript },
  ) {
    this.channelId = options.clientConfig?.channelId ?? "";
  }
  get isConnected(): boolean {
    return this.connected;
  }
  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }
  getProcessPid(): number | undefined {
    return undefined;
  }
  supportsImageContent(): boolean {
    return false;
  }
  createSession(): Promise<string> {
    return Promise.resolve(`scripted-${this.channelId}`);
  }
  setSessionModel(): Promise<void> {
    return Promise.resolve();
  }
  setSessionMode(): Promise<void> {
    return Promise.resolve();
  }
  setReasoningEffort(): Promise<string> {
    return Promise.resolve("applied");
  }
  setSessionGateContext(): void {}
  getClient(): null {
    return null;
  }
  prompt(): Promise<PromptResponse> {
    return this.script.current({ channelId: this.channelId, callIndex: this.promptCallCount++ });
  }
  cancel(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  getProcessEvidence(): AgentProcessEvidence {
    return this.processEvidence;
  }
}

class TestableSessionOrchestrator extends SessionOrchestrator {
  script: { current: PromptScript } = {
    current: () => Promise.resolve({ stopReason: "end_turn" } as PromptResponse),
  };
  connectorInstances: ScriptedConnector[] = [];
  protected override createConnector(options: AgentConnectorOptions): AgentConnector {
    const connector = new ScriptedConnector(options, this.script);
    this.connectorInstances.push(connector);
    return connector as unknown as AgentConnector;
  }
}

class MockPlatformAdapter {
  platform = "email" as const;
  sentReplies: { channelId: string; content: string }[] = [];
  capabilities: PlatformCapabilities = {
    canFetchHistory: false,
    canSearchMessages: false,
    supportsDm: true,
    supportsGuild: false,
    supportsReactions: false,
    maxMessageLength: 20000,
  };
  sendReply(channelId: string, content: string): Promise<ReplyResult> {
    this.sentReplies.push({ channelId, content });
    return Promise.resolve({ success: true, messageId: `mock_${this.sentReplies.length}` });
  }
  fetchRecentMessages(): Promise<PlatformMessage[]> {
    return Promise.resolve([]);
  }
  getUsername(userId: string): Promise<string> {
    return Promise.resolve(`user_${userId}`);
  }
  isSelf(): boolean {
    return false;
  }
  onEvent(): void {}
  offEvent(): void {}
  supportsTypingIndicator(): boolean {
    return false;
  }
  sendTyping(): Promise<void> {
    return Promise.resolve();
  }
  hasBotMention(): Promise<boolean> {
    return Promise.resolve(false);
  }
  hasBotReaction(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/**
 * In-memory stand-in for the mail service's durable `lookup`.
 *
 * It keys recorded operations by owner + work id + slot exactly like the row-13
 * journal, so a session can only ever see its OWN logical operation, and it logs
 * every consulted key together with the session's in-flight side-effect counter
 * at that moment.
 */
class FakeEmailEvidence {
  private readonly recorded = new Map<string, EmailSendOutcome>();
  readonly lookups: { owner: string; workId: string; actionSlot: string; inflight: number }[] = [];
  /** In-flight counter of the session whose evidence is being read. */
  observedInflight: () => number = () => -1;

  record(owner: string, workId: string, actionSlot: string, outcome: EmailSendOutcome): void {
    this.recorded.set(`${owner}\u0000${workId}\u0000${actionSlot}`, outcome);
  }

  lookup(owner: string, key: EmailOperationKey): EmailSendOutcome | undefined {
    const actionSlot = key.actionSlot as string;
    this.lookups.push({ owner, workId: key.workId, actionSlot, inflight: this.observedInflight() });
    return this.recorded.get(`${owner}\u0000${key.workId}\u0000${actionSlot}`);
  }
}

async function createPrompts(dir: string): Promise<void> {
  await Deno.mkdir(join(dir, "prompts"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "prompts", "system_reply.md"),
    "You are a helper.\nSkill root: {{ skillsDir }}\n" +
      "{{ if sessionId }}Session: {{ sessionId }}{{ /if }}",
  );
  await Deno.writeTextFile(
    join(dir, "prompts", "system_summary.md"),
    "Summarize the conversation.\nSkill root: {{ skillsDir }}",
  );
}

function createConfig(root: string): Config {
  return {
    platforms: {
      discord: { token: "test", enabled: true },
      misskey: { host: "test", token: "t", enabled: false },
      email: { enabled: false },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: join(root, "prompts", "system_reply.md"),
      tokenLimit: 20000,
      defaultAgentType: "opencode",
      opencodeApiKey: "test-opencode-key",
      dryRun: { enabled: false, outputPath: join(root, "dry-run"), mockReply: "MOCK REPLY" },
      sharedProcess: {
        enabled: false,
        jwtDir: join(root, "jwt"),
        queueDeadlineMs: 60_000,
        reclaimIdleMs: 60_000,
      },
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: root, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    replyPolicy: "channels",
    channels: [],
    conversationSummary: { enabled: true, model: "gpt-4" },
  } as unknown as Config;
}

interface Harness {
  root: string;
  orchestrator: TestableSessionOrchestrator;
  sessionRegistry: SessionRegistry;
  skillRegistry: SkillRegistry;
  workspaceManager: WorkspaceManager;
  adapter: MockPlatformAdapter;
  evidence: FakeEmailEvidence;
  connector(): ScriptedConnector;
  setScript(script: PromptScript): void;
  accept(): Promise<void>;
  states(): Promise<string[]>;
  dispose(): Promise<void>;
}

async function createHarness(
  options: { script?: PromptScript; evidence?: boolean } = {},
): Promise<Harness> {
  const root = await Deno.makeTempDir({ prefix: "email-response-accounting-test-" });
  await createPrompts(root);
  const config = createConfig(root);

  const store = new MailboxStore({ emailRoot: root, fingerprint: FINGERPRINT });
  await store.initialize(0, 987654321);
  const receipts = new EmailSessionReceipts(store);

  const workspaceManager = new WorkspaceManager(config.workspace);
  const memoryStore = new MemoryStore(workspaceManager, {});
  const skillRegistry = new SkillRegistry(memoryStore);
  const sessionRegistry = new SessionRegistry();
  const contextAssembler = new ContextAssembler(memoryStore, {
    systemPromptPath: config.agent.systemPromptPath,
    skillsDir: RESOLVED_SKILLS_ROOT,
    recentMessageLimit: 20,
    tokenLimit: 20000,
  });
  const script: { current: PromptScript } = {
    current: options.script ??
      (() => Promise.resolve({ stopReason: "end_turn" } as PromptResponse)),
  };
  const pool = null as AgentProcessPool | null;
  const orchestrator = new TestableSessionOrchestrator(
    workspaceManager,
    contextAssembler,
    skillRegistry,
    config,
    sessionRegistry,
    memoryStore,
    false,
    undefined,
    "",
    pool,
  );
  orchestrator.script = script;
  orchestrator.setEmailSessionReceipts(receipts);
  const evidence = new FakeEmailEvidence();
  if (options.evidence ?? true) orchestrator.setEmailSubmissionEvidence(evidence);

  return {
    root,
    orchestrator,
    sessionRegistry,
    skillRegistry,
    workspaceManager,
    adapter: new MockPlatformAdapter(),
    evidence,
    connector: () => orchestrator.connectorInstances[orchestrator.connectorInstances.length - 1],
    setScript: (next) => {
      script.current = next;
    },
    accept: async () => {
      await store.discover(MAILBOX_KEY);
      await store.accept(MAILBOX_KEY, RECORD_ID);
    },
    states: async () => {
      const result = await readJournal<MailboxEntryRecord>(root, PROCESSING_JOURNAL_FILENAME, {
        allowMissing: true,
      });
      assertEquals(result.status, "clean");
      return result.records.filter((r) => r.workId === WORK_ID).map((r) => r.state);
    },
    dispose: async () => {
      sessionRegistry.stop();
      await Deno.remove(root, { recursive: true }).catch(() => {});
    },
  };
}

function emailReceipt(workId = WORK_ID): EmailWorkReceipt {
  return {
    kind: "email-work",
    workId,
    mailboxKey: {
      fingerprint: MAILBOX_KEY.fingerprint,
      uidValidity: MAILBOX_KEY.uidValidity,
      uid: MAILBOX_KEY.uid,
    },
    recordId: RECORD_ID,
  };
}

function emailEvent(receipt = emailReceipt()): NormalizedEvent {
  return {
    platform: "email",
    channelId: `mail:${OWNER}:${RECORD_ID}`,
    userId: OWNER,
    messageId: "msg-1",
    isDm: true,
    guildId: "",
    content: "Hello bot!",
    timestamp: new Date(),
    emailWork: receipt,
  };
}

function discordEvent(): NormalizedEvent {
  return {
    platform: "discord",
    channelId: "discord-channel",
    userId: "discord-user",
    messageId: "msg-d",
    isDm: false,
    guildId: "guild",
    content: "Hello bot!",
    timestamp: new Date(),
  };
}

/** The registry session of the run in flight (retained object; undefined once gone). */
function sessionInFlight(harness: Harness, channelId: string): ActiveSession | undefined {
  return harness.sessionRegistry.getAll().find((s) => s.channelId === channelId);
}

const settleUntil = async (predicate: () => boolean, description: string): Promise<void> => {
  // Deterministic condition wait: exit as soon as the awaited state is visible,
  // so no fixed duration is assumed and no sleep is paid once the condition holds.
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};

/**
 * Run one email session whose FIRST prompt turn applies `turnEffects` to the
 * session (exactly what the Skill API server does when it records a result).
 */
async function runEmailTurn(
  harness: Harness,
  turnEffects: (session: ActiveSession, call: PromptCall) => void | Promise<void>,
  options: { event?: NormalizedEvent } = {},
): Promise<{ response: SessionResponse; prompts: number }> {
  const event = options.event ?? emailEvent();
  harness.setScript(async (call) => {
    if (call.callIndex === 0) {
      const session = sessionInFlight(harness, event.channelId);
      assert(session, "the session must be registered while its prompt runs");
      await turnEffects(session, call);
    }
    return { stopReason: "end_turn" } as PromptResponse;
  });
  await harness.accept();
  const response = await harness.orchestrator.processMessage(
    event,
    harness.adapter as unknown as PlatformAdapter,
  );
  return { response, prompts: harness.connector().promptCallCount };
}

// --- Orchestrator behavior --------------------------------------------------------

Deno.test("Submitted third-party mail responds without a retry, an anchor or a summary", async () => {
  const harness = await createHarness();
  let session: ActiveSession | undefined;
  try {
    const { response, prompts } = await runEmailTurn(harness, (s) => {
      session = s;
      harness.sessionRegistry.recordEmailSubmission(
        s.id,
        submission("submitted", "third-party", "op-third"),
        "third-party:grant-1",
      );
    });

    assertEquals(prompts, 1, "no corrective turn and no summary turn after a third-party send");
    assertEquals(response.success, true);
    assertEquals(response.emailSubmitted, true);
    assertEquals(response.emailUnknown, false);
    assertEquals(response.replySent, false, "a third-party send is not a user reply");
    assertEquals(response.fileSent, false);
    assertEquals(session?.lastSentMessageId, undefined);
    assertEquals(session?.lastFileMessageId, undefined);
    assertEquals(session?.lastReplyAnchorMessageId, undefined);
    assertEquals(session?.replySent, false);
    assertEquals(session?.emailResponse?.submittedToThirdParty, true);
    // Teardown removed the registry entry, yet the response still carries the
    // verdict (the dispatcher reads it after the entry is gone).
    assertEquals(harness.sessionRegistry.get(session!.id), undefined);
    assertEquals(await harness.states(), ["started", "completed"]);
  } finally {
    await harness.dispose();
  }
});

Deno.test("A user reply still produces its conversation summary turn", async () => {
  const harness = await createHarness();
  try {
    const event = emailEvent();
    const { response, prompts } = await runEmailTurn(harness, async (s) => {
      const result = await harness.skillRegistry.getReplyHandler().handleSendReply(
        { message: "delivered reply" },
        {
          workspace: {
            key: harness.workspaceManager.getWorkspaceKeyFromEvent(event),
            components: { platform: "email", userId: OWNER },
          },
          channelId: s.channelId,
          userId: OWNER,
          platformAdapter: harness.adapter,
        } as unknown as SkillContext,
      );
      assertEquals(result.success, true);
    }, { event });

    assertEquals(prompts, 2, "the main turn plus the summary turn");
    assertEquals(response.success, true);
    assertEquals(response.replySent, true);
    assertEquals(response.emailSubmitted, false);
  } finally {
    await harness.dispose();
  }
});

Deno.test("Unknown email outcome suppresses the retry and records review-required", async () => {
  const harness = await createHarness();
  let sessionId = "";
  try {
    const { response, prompts } = await runEmailTurn(harness, (s) => {
      sessionId = s.id;
      harness.sessionRegistry.recordEmailSubmission(
        s.id,
        submission("unknown", "third-party", "op-unknown"),
        "third-party:grant-1",
      );
    });

    assertEquals(prompts, 1, "an unresolved submission forbids the corrective turn");
    assertEquals(response.success, false, "unknown never claims success");
    assertEquals(response.emailUnknown, true);
    assertEquals(response.emailSubmitted, false);
    assertEquals(response.error, UNKNOWN_ERROR);
    assertEquals(harness.sessionRegistry.get(sessionId), undefined);
    assertEquals(await harness.states(), ["started", "review-required"]);
    assertEquals(harness.adapter.sentReplies.length, 0, "no fallback mail is manufactured");
  } finally {
    await harness.dispose();
  }
});

Deno.test("A submitted plus unresolved session is escalated, never reported successful", async () => {
  const harness = await createHarness();
  try {
    const { response, prompts } = await runEmailTurn(harness, (s) => {
      harness.sessionRegistry.recordEmailSubmission(
        s.id,
        submission("submitted", "user", "op-r"),
        "reply",
      );
      harness.sessionRegistry.recordEmailSubmission(
        s.id,
        submission("unknown", "third-party", "op-x"),
        "third-party:grant-1",
      );
    });

    assertEquals(prompts, 1);
    assertEquals(response.success, false);
    assertEquals(response.emailUnknown, true);
    assertEquals(response.emailSubmitted, true);
    assertEquals(response.error, UNKNOWN_ERROR);
    assertEquals(await harness.states(), ["started", "review-required"]);
  } finally {
    await harness.dispose();
  }
});

Deno.test("A recorded pre-submission failure keeps the retry, always on the same logical slot", async () => {
  const harness = await createHarness();
  let slots: (string | undefined)[] = [];
  try {
    const { response, prompts } = await runEmailTurn(harness, (s) => {
      harness.sessionRegistry.recordEmailSubmission(
        s.id,
        submission("failed", "user", "op-f"),
        "reply",
      );
      slots = harness.sessionRegistry.emailResponseOf(s.id).operations.map((op) => op.actionSlot);
    });

    assertEquals(prompts, 2, "a recorded non-delivery does not suppress the corrective turn");
    assertEquals(response.success, false);
    assertEquals(response.emailSubmitted, false);
    assertEquals(response.emailUnknown, false);
    assertEquals(slots, ["reply"], "the corrective turn reuses the same logical slot");
    assertEquals(
      harness.sessionRegistry.emailResponseOf("sess_gone").operations.length,
      0,
      "no replacement slot is ever recorded",
    );
    assertEquals(await harness.states(), ["started", "failed"]);
  } finally {
    await harness.dispose();
  }
});

Deno.test("Durable evidence is consulted only after in-flight effects settle", async () => {
  const harness = await createHarness();
  const event = emailEvent();
  let session: ActiveSession | undefined;
  try {
    harness.setScript((call) => {
      if (call.callIndex === 0) {
        session = sessionInFlight(harness, event.channelId);
        assert(session, "the session must be registered while its prompt runs");
        // Mail is still landing: the durable journal already holds the accepted
        // operation while the session's in-flight counter is not zero.
        harness.evidence.record(OWNER, WORK_ID, "reply", {
          operationId: "op-lost-response",
          phase: "submitted",
          targetKind: "user",
          reused: true,
        });
        harness.evidence.observedInflight = () => session?.inflightSideEffects ?? 0;
        session.inflightSideEffects = (session.inflightSideEffects ?? 0) + 1;
      }
      return Promise.resolve({ stopReason: "end_turn" } as PromptResponse);
    });
    await harness.accept();

    const run = harness.orchestrator.processMessage(
      event,
      harness.adapter as unknown as PlatformAdapter,
    );
    // The retry gate closes side-effect admission before it drains.
    await settleUntil(() => session?.recoveryFenced === true, "the email evidence fence");
    assertEquals(session?.inflightSideEffects, 1);
    assertEquals(
      harness.evidence.lookups.length,
      0,
      "no evidence is read while an effect is in flight",
    );
    session!.inflightSideEffects = 0;
    const response = await run;

    assertEquals(
      harness.connector().promptCallCount,
      1,
      "the recorded submission suppresses the retry",
    );
    assertEquals(response.emailSubmitted, true);
    assertEquals(response.success, true);
    assert(harness.evidence.lookups.length > 0, "the durable journal was consulted");
    for (const lookup of harness.evidence.lookups) {
      assertEquals(lookup.inflight, 0, "every lookup happened after the effects settled");
      assertEquals(lookup.owner, OWNER);
      assertEquals(lookup.workId, WORK_ID);
    }
    assert(
      harness.evidence.lookups.some((l) => l.actionSlot === "reply"),
      "the reply slot of this work item was looked up",
    );
  } finally {
    await harness.dispose();
  }
});

Deno.test("Another work item's durable evidence never authorizes a response", async () => {
  const harness = await createHarness();
  try {
    // Recorded for a DIFFERENT work item: this session's own slots are empty.
    harness.evidence.record(OWNER, OTHER_WORK_ID, "reply", {
      operationId: "op-other",
      phase: "submitted",
      targetKind: "user",
      reused: true,
    });
    const { response, prompts } = await runEmailTurn(harness, () => {});

    assertEquals(prompts, 2, "another work item's evidence does not suppress this retry");
    assertEquals(response.emailSubmitted, false);
    assertEquals(response.success, false);
    assert(harness.evidence.lookups.length > 0);
    for (const lookup of harness.evidence.lookups) {
      assertEquals(lookup.owner, OWNER);
      assertEquals(lookup.workId, WORK_ID, "only this session's own work id is consulted");
    }
  } finally {
    await harness.dispose();
  }
});

Deno.test("An unsettleable drain is itself unresolved: no retry, review-required", async () => {
  const harness = await createHarness();
  try {
    // The settle wait reports "not settled" (the bounded-wait seam), which must
    // read as uncertainty instead of as "no submission".
    const overridableSettleWait = harness.orchestrator as unknown as {
      waitForInflightSideEffects: () => Promise<boolean>;
    };
    overridableSettleWait.waitForInflightSideEffects = () => Promise.resolve(false);

    const { response, prompts } = await runEmailTurn(harness, (s) => {
      s.inflightSideEffects = (s.inflightSideEffects ?? 0) + 1;
    });

    assertEquals(prompts, 1, "an unsettleable effect forbids the corrective turn");
    assertEquals(response.success, false);
    assertEquals(response.emailUnknown, true);
    assertEquals(response.error, UNKNOWN_ERROR);
    assertEquals(await harness.states(), ["started", "review-required"]);
  } finally {
    await harness.dispose();
  }
});

Deno.test("A Discord session keeps its existing response fields and retry behavior", async () => {
  const harness = await createHarness();
  try {
    const { response, prompts } = await runEmailTurn(harness, () => {}, { event: discordEvent() });

    assertEquals(prompts, 2, "the missing-response retry still fires for Discord");
    assertEquals(response.success, false);
    assertEquals(response.emailSubmitted, undefined);
    assertEquals(response.emailUnknown, undefined);
    assertEquals(response.emailSend, undefined);
    assertStringIncludes(response.error ?? "", "did not");
    assertEquals(harness.adapter.sentReplies.length, 0);
  } finally {
    await harness.dispose();
  }
});

Deno.test("With no evidence source wired the accounting still suppresses on recorded metadata", async () => {
  const harness = await createHarness({ evidence: false });
  try {
    const { response, prompts } = await runEmailTurn(harness, (s) => {
      harness.sessionRegistry.recordEmailSubmission(
        s.id,
        submission("submitted", "user", "op-r"),
        "reply",
      );
    });
    assertEquals(prompts, 1);
    assertEquals(response.success, true);
    assertEquals(response.emailSubmitted, true);
    assertEquals(harness.evidence.lookups.length, 0);
  } finally {
    await harness.dispose();
  }
});
