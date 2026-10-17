// tests/core/email-spontaneous.test.ts
//
// Deterministic regression coverage for `email-spontaneous-targets` (row 25).
//
// Exercised layers: the real `SpontaneousScheduler`, the real `EmailSpontaneousStore`
// (fsynced temp state), the real `EmailAdapter`, the real `EmailMailService`,
// `SubmissionStore` and `EmailMessageStore`, and the lane's real target binder and
// dispatcher. SMTP/IMAP are scripted doubles, so every scenario asserts exact external
// side-effect counts (DATA transactions) instead of a live exchange. The live-protocol
// half lives in `email-spontaneous-smoke.test.ts`.
//
// Scenarios mirror `openspec/changes/email-spontaneous-targets/specs/spontaneous-posting/spec.md`:
// opt-in targeting, a new owner thread per tick without reply headers, tick deduplication
// across repeated calls and restarts, and target-owned session context.

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import type { ChannelConfig, Config, EmailConfig } from "../../src/types/config.ts";
import { normalizeEmailMailbox } from "../../src/platforms/email/email-identity.ts";
import { buildMailboxFingerprint, MailboxStore } from "../../src/platforms/email/mailbox-store.ts";
import {
  EmailMessageStore,
  formatEmailChannelId,
} from "../../src/platforms/email/message-store.ts";
import {
  _resetSharedRegistryForTesting,
  computeOperationId,
  SubmissionStore,
} from "../../src/platforms/email/submission-store.ts";
import {
  EmailMailService,
  outboundEvidenceMetaRef,
} from "../../src/platforms/email/mail-service.ts";
import { OutgoingMimeBuilder } from "../../src/platforms/email/outgoing-mime.ts";
import { EmailAdapter } from "../../src/platforms/email/email-adapter.ts";
import {
  EmailSpontaneousStore,
  SPONTANEOUS_SNAPSHOT_FILENAME,
  spontaneousOperationKey,
} from "../../src/platforms/email/spontaneous-store.ts";
import type { SpontaneousOccurrence } from "../../src/platforms/email/spontaneous-store.ts";
import type {
  ImapAppendOptions,
  ImapFetchHeadersOptions,
  ImapFetchSourceOptions,
  ImapListOptions,
  ImapMailboxPosition,
  ImapMessage,
  ImapTransport,
} from "../../src/platforms/email/imap-client.ts";
import {
  SmtpDiagnosticCode,
  type SmtpSubmission,
  type SmtpSubmitResult,
  type SmtpTransport,
} from "../../src/platforms/email/smtp-client.ts";
import { SpontaneousScheduler } from "@core/spontaneous-scheduler.ts";
import type { SpontaneousPostCallback } from "@core/spontaneous-scheduler.ts";
import {
  bindEmailSpontaneousOccurrence,
  dispatchEmailSpontaneousOccurrence,
  isSpontaneousTargetAllowed,
} from "@core/spontaneous-target.ts";
import type { EmailSpontaneousTarget } from "@core/spontaneous-target.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { ContextAssembler } from "@core/context-assembler.ts";

const BOT = "bot@example.com";
const SENDER = "alice@allowed-domain.org";
const OWNER = normalizeEmailMailbox(SENDER).userId;
const CLOCK = new Date("2026-10-17T00:00:00Z");
/** Deterministic quiescent interval: min === max removes the interval RNG. */
const TICK_INTERVAL_MS = 150;

/** Scripted SMTP double: records the exact envelope/bytes and reports the scripted outcome. */
class ScriptedSmtp implements SmtpTransport {
  readonly submissions: SmtpSubmission[] = [];
  mode: "submitted" | "failed" | "unknown" = "submitted";

  submit(input: SmtpSubmission): Promise<SmtpSubmitResult> {
    this.submissions.push(input);
    const accepted = this.mode === "submitted" ? [...input.envelope.to] : [];
    const rejected = this.mode === "failed" ? [...input.envelope.to] : [];
    return Promise.resolve({
      phase: this.mode,
      safeCode: this.mode === "submitted"
        ? SmtpDiagnosticCode.ACCEPTED
        : this.mode === "failed"
        ? SmtpDiagnosticCode.REJECTED
        : SmtpDiagnosticCode.CONNECTION_LOST,
      accepted,
      rejected,
      sizeBytes: input.emlBytes.byteLength,
      durationMs: 1,
    });
  }

  /** Wire bytes of the DATA transaction with the given index. */
  wire(index = 0): string {
    return new TextDecoder().decode(this.submissions[index].emlBytes);
  }
}

/** Scripted IMAP double for the mail service's sent-folder lane (never a real socket). */
class SentCopyImap implements ImapTransport {
  readonly appended: Uint8Array[] = [];

  connect(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  status(): Promise<ImapMailboxPosition> {
    return Promise.resolve({ uidValidity: 1, uidNext: 1 });
  }
  position(): Promise<ImapMailboxPosition> {
    return Promise.resolve({ uidValidity: 1, uidNext: 1 });
  }
  listAfter(_uid: number, _options?: ImapListOptions): Promise<number[]> {
    return Promise.resolve([]);
  }
  fetchHeaders(_uid: number, _options?: ImapFetchHeadersOptions): Promise<string> {
    return Promise.resolve("");
  }
  fetchSource(_uid: number, _options?: ImapFetchSourceOptions): Promise<ImapMessage> {
    throw new Error("fetchSource is not used by this double");
  }
  appendSent(rawMime: Uint8Array | string, _options?: ImapAppendOptions): Promise<void> {
    this.appended.push(typeof rawMime === "string" ? new TextEncoder().encode(rawMime) : rawMime);
    return Promise.resolve();
  }
}

/** Receiving transport of a lane that never polls in these scenarios. */
class UnpolledImap implements ImapTransport {
  connect(): Promise<void> {
    throw new Error("the receiving lane is not exercised by this suite");
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  status(): Promise<ImapMailboxPosition> {
    throw new Error("the receiving lane is not exercised by this suite");
  }
  position(): Promise<ImapMailboxPosition> {
    throw new Error("the receiving lane is not exercised by this suite");
  }
  listAfter(_uid: number, _options?: ImapListOptions): Promise<number[]> {
    throw new Error("the receiving lane is not exercised by this suite");
  }
  fetchHeaders(_uid: number, _options?: ImapFetchHeadersOptions): Promise<string> {
    throw new Error("the receiving lane is not exercised by this suite");
  }
  fetchSource(_uid: number, _options?: ImapFetchSourceOptions): Promise<ImapMessage> {
    throw new Error("the receiving lane is not exercised by this suite");
  }
  appendSent(_rawMime: Uint8Array | string, _options?: ImapAppendOptions): Promise<void> {
    throw new Error("the receiving lane is not exercised by this suite");
  }
}

interface SnapshotRecord {
  occurrenceId: string;
  dueAt: string;
  status: string;
  target?: { owner: string; threadId: string };
}

interface Snapshot {
  v: number;
  occurrence: SnapshotRecord | null;
  previous: SnapshotRecord | null;
}

interface Stack {
  config: Config;
  channels: ChannelConfig[];
  emailRoot: string;
  messageStore: EmailMessageStore;
  submissionStore: SubmissionStore;
  mailService: EmailMailService;
  smtp: ScriptedSmtp;
  sentCopy: SentCopyImap;
  adapter: EmailAdapter;
  store: EmailSpontaneousStore;
}

interface Dispatch {
  channelId: string;
  target: EmailSpontaneousTarget;
  fetchRecentMessages: boolean;
}

/** The session's ONE send, exactly as the Skill API host derives it from the session. */
function makeOrchestrator(stack: Stack, dispatches: Dispatch[], text = "Spontaneous hello.") {
  return {
    processSpontaneousPost: async (
      platform: string,
      channelId: string,
      adapter: unknown,
      options: {
        botId: string;
        fetchRecentMessages: boolean;
        email?: EmailSpontaneousTarget;
      },
    ) => {
      assertEquals(platform, "email");
      assertEquals(adapter, stack.adapter);
      const target = options.email;
      assert(target, "an email spontaneous session must carry its bound target");
      dispatches.push({
        channelId,
        target,
        fetchRecentMessages: options.fetchRecentMessages,
      });
      const reply = await stack.adapter.sendReply(channelId, text, {
        emailSend: { ...spontaneousOperationKey(target.tickId), owner: target.userId },
      });
      return { success: reply.success, error: reply.error };
    },
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "email-spontaneous-targets-" });
  try {
    await fn(dir);
  } finally {
    _resetSharedRegistryForTesting();
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

function makeConfig(base: string, channels: ChannelConfig[]): Config {
  return {
    platforms: {
      discord: { token: "test-token", enabled: false },
      misskey: { host: "test.invalid", token: "test-token", enabled: false },
      email: {
        enabled: true,
        address: BOT,
        imap: { host: "127.0.0.1", username: BOT, password: "imap-secret" },
        smtp: { host: "127.0.0.1", username: BOT, password: "smtp-secret" },
        incomingFolder: "INBOX",
        sentFolder: "Sent",
        pollIntervalMs: 300000,
        receivingAuth: { authservId: "mx.example.com", attestedStripping: true },
        maxMessageBytes: 26214400,
        maxIncomingAttachments: 10,
        signature: "AIr-Friends Bot",
        spontaneousPost: {
          enabled: true,
          minIntervalMs: TICK_INTERVAL_MS,
          maxIntervalMs: TICK_INTERVAL_MS,
          contextFetchProbability: 0,
        },
      },
    },
    agent: {
      model: "test-model",
      systemPromptPath: "./prompts/system_reply.md",
      tokenLimit: 20000,
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: base, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    replyPolicy: "channels",
    channels,
  } as unknown as Config;
}

async function buildStack(base: string, channels?: ChannelConfig[]): Promise<Stack> {
  const emailRoot = join(base, "email");
  const resolvedChannels: ChannelConfig[] = channels ??
    [{ id: `email/account/${OWNER}`, enabled: true, spontaneousPost: true }];
  const config = makeConfig(base, resolvedChannels);
  const emailConfig = config.platforms.email as EmailConfig;

  const submissionStore = new SubmissionStore(emailRoot);
  const recoveryResult = await submissionStore.recover();
  const messageStore = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
  const smtp = new ScriptedSmtp();
  const sentCopy = new SentCopyImap();
  const mailService = new EmailMailService({
    config: emailConfig,
    emailRoot,
    submissionStore,
    recoveryResult,
    messageStore,
    smtp,
    imap: sentCopy,
    channels: resolvedChannels,
    builder: new OutgoingMimeBuilder({ fromAddress: BOT, now: () => CLOCK }),
  });
  const adapter = new EmailAdapter({
    config: emailConfig,
    transport: new UnpolledImap(),
    mailboxStore: new MailboxStore({
      emailRoot,
      fingerprint: buildMailboxFingerprint("127.0.0.1", BOT, "INBOX"),
    }),
    messageStore,
    mailService,
    channels: resolvedChannels,
  });
  const store = new EmailSpontaneousStore({ emailRoot, evidence: submissionStore });
  return {
    config,
    channels: resolvedChannels,
    emailRoot,
    messageStore,
    submissionStore,
    mailService,
    smtp,
    sentCopy,
    adapter,
    store,
  };
}

/** One admitted inbound message from the owner: the only verified address of that owner. */
async function seedInbound(messageStore: EmailMessageStore): Promise<void> {
  await messageStore.putSource(OWNER, "From: alice\r\n\r\nAuthored body text.", {
    from: SENDER,
    subject: "Hello",
    plainBody: "Authored body text.",
    wireIds: { messageId: "<seed@x>" },
  });
}

async function readSnapshot(emailRoot: string): Promise<Snapshot> {
  return JSON.parse(
    await Deno.readTextFile(join(emailRoot, SPONTANEOUS_SNAPSHOT_FILENAME)),
  ) as Snapshot;
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  // Bounded real-clock observation window: the production scheduler genuinely arms
  // `setTimeout` timers and the stores perform fsync-backed I/O that fake timers cannot
  // advance. The assertions themselves stay condition-based; this loop only waits for the
  // observed condition and gives up loudly instead of guessing a single sleep duration.
  const deadline = Date.now() + timeoutMs;
  while (!(await condition()) && Date.now() < deadline) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 5);
    await promise;
  }
}

/**
 * A restarted process: the submission journal is replayed from disk by a NEW store
 * instance (the shared per-root registry is dropped first), so every classification
 * below is proven from durable evidence rather than from process memory.
 */
async function restartSubmissionStore(emailRoot: string): Promise<SubmissionStore> {
  _resetSharedRegistryForTesting();
  const restarted = new SubmissionStore(emailRoot);
  await restarted.recover();
  return restarted;
}

Deno.test("email spontaneous - only enabled accounts that explicitly opt in are targets", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base, [{ id: `email/account/${OWNER}`, enabled: true }]);

    // Enabled, but not opted in.
    assertEquals(await stack.adapter.determineSpontaneousTarget(stack.config), null);
    assertEquals(isSpontaneousTargetAllowed(OWNER, stack.channels), false);

    // Opted in, but the account itself is disabled.
    stack.channels[0] = { id: `email/account/${OWNER}`, enabled: false, spontaneousPost: true };
    assertEquals(await stack.adapter.determineSpontaneousTarget(stack.config), null);

    // A non-account email entry is never a spontaneous target, whatever its opt-in flag.
    stack.channels.length = 0;
    stack.channels.push({ id: "email/channel/inbox", spontaneousPost: true });
    assertEquals(await stack.adapter.determineSpontaneousTarget(stack.config), null);

    stack.channels.length = 0;
    stack.channels.push({ id: `email/account/${OWNER}`, enabled: true, spontaneousPost: true });
    const selection = await stack.adapter.determineSpontaneousTarget(stack.config);
    assert(selection);
    assertEquals(selection.userId, OWNER);
    assertEquals(selection.channelId, formatEmailChannelId(OWNER, selection.newThreadId));
    assertEquals(isSpontaneousTargetAllowed(OWNER, stack.channels), true);
  });
});

Deno.test("email spontaneous - opting out while markSubmitting is pending refuses SMTP and records failed", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);
    await seedInbound(stack.messageStore);

    const occurrence = await stack.store.schedule(new Date(Date.now() - 1000));
    const bound = await bindEmailSpontaneousOccurrence({
      store: stack.store,
      adapter: stack.adapter,
      config: stack.config,
      occurrence,
    });
    assert(bound?.target);
    const channelId = formatEmailChannelId(bound.target.owner, bound.target.threadId);
    const emailSend = { ...spontaneousOperationKey(occurrence.occurrenceId), owner: OWNER };

    // Intercept markSubmitting to revoke spontaneous opt-in during the durable write
    const originalMarkSubmitting = stack.submissionStore.markSubmitting.bind(stack.submissionStore);
    stack.submissionStore.markSubmitting = async (owner, key, options) => {
      const res = await originalMarkSubmitting(owner, key, options);
      // Revoked concurrently during journal write before SMTP starts:
      stack.channels[0] = { id: `email/account/${OWNER}`, enabled: true, spontaneousPost: false };
      return res;
    };

    const outcome = await stack.adapter.sendReply(channelId, "A spontaneous note.", { emailSend });
    assertEquals(outcome.success, false);
    assertEquals(stack.smtp.submissions.length, 0);

    const recorded = stack.submissionStore.lookup(
      OWNER,
      spontaneousOperationKey(occurrence.occurrenceId),
    );
    assertEquals(recorded?.phase, "failed");
    assertEquals(recorded?.safeCode, "RECIPIENT_NOT_ALLOWED");
  });
});

Deno.test("email spontaneous - memory ownership: only the permitted target user's memories appear, not bot or other users", async () => {
  await withTempDir(async (base) => {
    await buildStack(base);
    const workspaceManager = new WorkspaceManager({
      repoPath: base,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {});
    await Deno.mkdir(join(base, "prompts"), { recursive: true });
    await Deno.writeTextFile(join(base, "prompts", "system_spontaneous.md"), "Spontaneous prompt.");
    const contextAssembler = new ContextAssembler(memoryStore, {
      recentMessageLimit: 20,
      tokenLimit: 4000,
      systemPromptPath: join(base, "prompts", "system_spontaneous.md"),
      skillsDir: join(base, "skills"),
    });

    const otherUser = "e_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const targetThreadId = crypto.randomUUID();
    const targetChannelId = formatEmailChannelId(OWNER, targetThreadId);
    const targetWorkspace = await workspaceManager.getOrCreateWorkspace({
      platform: "email",
      channelId: targetChannelId,
      userId: OWNER,
      messageId: "m1",
      isDm: true,
      guildId: "",
      content: "",
      timestamp: new Date(),
    });
    const botWorkspace = await workspaceManager.getOrCreateWorkspace({
      platform: "email",
      channelId: "system",
      userId: BOT,
      messageId: "m2",
      isDm: false,
      guildId: "",
      content: "",
      timestamp: new Date(),
    });
    const otherWorkspace = await workspaceManager.getOrCreateWorkspace({
      platform: "email",
      channelId: formatEmailChannelId(otherUser, crypto.randomUUID()),
      userId: otherUser,
      messageId: "m3",
      isDm: true,
      guildId: "",
      content: "",
      timestamp: new Date(),
    });

    await memoryStore.addMemory(targetWorkspace, "TARGET_OWNER_PRIVATE_SENTINEL", {
      importance: "high",
    });
    await memoryStore.addMemory(botWorkspace, "BOT_PRIVATE_SENTINEL", { importance: "high" });
    await memoryStore.addMemory(otherWorkspace, "OTHER_USER_SENTINEL", { importance: "high" });

    const fetcher = {
      fetchRecentMessages: () => Promise.resolve([]),
      searchRelatedMessages: () => Promise.resolve([]),
    };

    const context = await contextAssembler.assembleSpontaneousContext(
      "email",
      targetChannelId,
      targetWorkspace,
      fetcher,
      {
        fetchRecentMessages: false,
        emailSpontaneous: {
          userId: OWNER,
          channelId: targetChannelId,
        },
      },
    );

    assert(context.importantMemories.some((m) => m.content === "TARGET_OWNER_PRIVATE_SENTINEL"));
    assertEquals(
      context.importantMemories.some((m) => m.content === "BOT_PRIVATE_SENTINEL"),
      false,
    );
    assertEquals(context.importantMemories.some((m) => m.content === "OTHER_USER_SENTINEL"), false);
  });
});

Deno.test("email spontaneous - one tick binds the owner's new thread and sends one message", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);
    await seedInbound(stack.messageStore);

    const dispatches: Dispatch[] = [];
    const ticks: SpontaneousOccurrence[] = [];
    const scheduler = new SpontaneousScheduler(stack.config);
    scheduler.setOccurrenceStore(stack.store);
    const callback: SpontaneousPostCallback = async (platform, occurrence) => {
      assertEquals(platform, "email");
      assert(occurrence);
      ticks.push(occurrence);
      await dispatchEmailSpontaneousOccurrence({
        store: stack.store,
        adapter: stack.adapter,
        config: stack.config,
        occurrence,
        orchestrator: makeOrchestrator(stack, dispatches),
      });
    };
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(() => stack.smtp.submissions.length === 1);
    await waitFor(async () => (await readSnapshot(stack.emailRoot)).previous !== null);
    scheduler.stop();

    // ONE tick, ONE DATA transaction, ONE sent-folder copy.
    assertEquals(stack.smtp.submissions.length, 1);
    assertEquals(stack.sentCopy.appended.length, 1);
    assertEquals(dispatches.length, 1);
    assertEquals(ticks.length, 1);

    const dispatch = dispatches[0];
    const tick = ticks[0];
    assertEquals(dispatch.target.tickId, tick.occurrenceId);
    assertEquals(dispatch.target.userId, OWNER);
    assertEquals(dispatch.channelId, dispatch.target.channelId);
    assertEquals(dispatch.fetchRecentMessages, false);
    assertEquals(dispatch.channelId, formatEmailChannelId(OWNER, dispatch.target.newThreadId));

    // The wire message opens a NEW thread: no In-Reply-To/References, one recipient.
    const wire = stack.smtp.wire();
    assertEquals(wire.includes("In-Reply-To:"), false);
    assertEquals(wire.includes("References:"), false);
    assertEquals(stack.smtp.submissions[0].envelope.to, [SENDER]);

    // The outbound record belongs to the SAME internal thread the tick was bound to:
    // nothing was allocated from the new wire Message-ID.
    const boundHistory = await stack.messageStore.history(
      OWNER,
      dispatch.target.newThreadId,
      10,
    );
    assertEquals(boundHistory.length, 1);
    assertEquals(boundHistory[0].direction, "outbound");
    assertEquals(boundHistory[0].to, SENDER);

    // Durable schedule state: the tick is terminal and a distinct successor is planned.
    const snapshot = await readSnapshot(stack.emailRoot);
    assertEquals(snapshot.previous?.occurrenceId, tick.occurrenceId);
    assertEquals(snapshot.previous?.status, "completed");
    assertEquals(snapshot.previous?.target, {
      owner: OWNER,
      threadId: dispatch.target.newThreadId,
    });
    assert(snapshot.occurrence);
    assertNotEquals(snapshot.occurrence.occurrenceId, tick.occurrenceId);
    assertEquals(snapshot.occurrence.status, "scheduled");
    assertEquals(snapshot.occurrence.target, undefined);
  });
});

Deno.test("email spontaneous - consecutive ticks use distinct new threads with no reply headers", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);
    await seedInbound(stack.messageStore);

    const dispatches: Dispatch[] = [];
    const scheduler = new SpontaneousScheduler(stack.config);
    scheduler.setOccurrenceStore(stack.store);
    scheduler.setCallback(async (_platform, occurrence) => {
      assert(occurrence);
      await dispatchEmailSpontaneousOccurrence({
        store: stack.store,
        adapter: stack.adapter,
        config: stack.config,
        occurrence,
        orchestrator: makeOrchestrator(stack, dispatches),
      });
    });

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(() => stack.smtp.submissions.length === 2);
    scheduler.stop();

    assertEquals(dispatches.length, 2);
    assertEquals(stack.smtp.submissions.length, 2);
    assertNotEquals(dispatches[0].target.newThreadId, dispatches[1].target.newThreadId);
    assertNotEquals(dispatches[0].channelId, dispatches[1].channelId);
    assertEquals(dispatches[0].target.userId, OWNER);
    assertEquals(dispatches[1].target.userId, OWNER);
    for (const index of [0, 1]) {
      const wire = stack.smtp.wire(index);
      assertEquals(wire.includes("In-Reply-To:"), false);
      assertEquals(wire.includes("References:"), false);
    }
  });
});

Deno.test("email spontaneous - a repeated send in one tick is answered by the recorded operation", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);
    await seedInbound(stack.messageStore);

    const occurrence = await stack.store.schedule(new Date(Date.now() - 1000));
    const bound = await bindEmailSpontaneousOccurrence({
      store: stack.store,
      adapter: stack.adapter,
      config: stack.config,
      occurrence,
    });
    assert(bound?.target);
    const channelId = formatEmailChannelId(bound.target.owner, bound.target.threadId);
    const emailSend = { ...spontaneousOperationKey(occurrence.occurrenceId), owner: OWNER };

    // A `send-file` may legitimately run first in the same tick; the text reply that follows
    // must consult the tick's ONE slot instead of submitting a second message.
    const file = await stack.adapter.sendFile(channelId, [{
      fileName: "note.txt",
      content: new TextEncoder().encode("attachment"),
    }], { emailSend });
    assertEquals(file.success, true);
    assertEquals(stack.smtp.submissions.length, 1);

    const reply = await stack.adapter.sendReply(channelId, "Second call.", { emailSend });
    assertEquals(reply.success, true);
    assertEquals(reply.emailSubmission?.reused, true);
    assertEquals(reply.emailSubmission?.operationId, file.emailSubmission?.operationId);
    assertEquals(stack.smtp.submissions.length, 1, "a repeated call performs no SMTP transaction");
  });
});

Deno.test("email spontaneous - a restart after acceptance selects nothing and sends nothing more", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);
    await seedInbound(stack.messageStore);

    // The tick ran and SMTP accepted it, then the process died BEFORE the successor was
    // persisted: the occurrence is still `started` with its bound target and evidence.
    const occurrence = await stack.store.schedule(new Date(Date.now() - 1000));
    const dispatches: Dispatch[] = [];
    await dispatchEmailSpontaneousOccurrence({
      store: stack.store,
      adapter: stack.adapter,
      config: stack.config,
      occurrence,
      orchestrator: makeOrchestrator(stack, dispatches),
    });
    assertEquals(stack.smtp.submissions.length, 1);
    assertEquals(dispatches.length, 1);
    const crashed = await readSnapshot(stack.emailRoot);
    assertEquals(crashed.occurrence?.status, "started");
    assertEquals(crashed.occurrence?.target?.owner, OWNER);

    // Restart: a NEW occurrence store over fresh evidence reads and a NEW scheduler.
    const restartedStore = new EmailSpontaneousStore({
      emailRoot: stack.emailRoot,
      evidence: await restartSubmissionStore(stack.emailRoot),
    });
    const restartedTicks: SpontaneousOccurrence[] = [];
    const restartScheduler = new SpontaneousScheduler(stack.config);
    restartScheduler.setOccurrenceStore(restartedStore);
    restartScheduler.setCallback(async (_platform, restored) => {
      assert(restored);
      restartedTicks.push(restored);
      await dispatchEmailSpontaneousOccurrence({
        store: restartedStore,
        adapter: stack.adapter,
        config: stack.config,
        occurrence: restored,
        orchestrator: makeOrchestrator(stack, dispatches),
      });
    });

    restartScheduler.start();
    await restartScheduler.whenReady();
    await waitFor(async () =>
      (await readSnapshot(stack.emailRoot)).previous?.status === "completed"
    );
    restartScheduler.stop();

    // No session, no additional DATA transaction and no replacement target selection
    // (the terminal occurrence keeps the target it was crashed with, asserted below).
    assertEquals(restartedTicks, []);
    assertEquals(stack.smtp.submissions.length, 1);
    assertEquals(dispatches.length, 1);

    const snapshot = await readSnapshot(stack.emailRoot);
    assertEquals(snapshot.previous?.occurrenceId, occurrence.occurrenceId);
    assertEquals(snapshot.previous?.status, "completed");
    assertEquals(snapshot.previous?.target, crashed.occurrence?.target);
    assert(snapshot.occurrence);
    assertNotEquals(snapshot.occurrence.occurrenceId, occurrence.occurrenceId);
  });
});

Deno.test("email spontaneous - a restart after an unknown outcome requires review and sends nothing", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);
    await seedInbound(stack.messageStore);
    stack.smtp.mode = "unknown";

    const occurrence = await stack.store.schedule(new Date(Date.now() - 1000));
    const dispatches: Dispatch[] = [];
    await dispatchEmailSpontaneousOccurrence({
      store: stack.store,
      adapter: stack.adapter,
      config: stack.config,
      occurrence,
      orchestrator: makeOrchestrator(stack, dispatches),
    });
    assertEquals(stack.smtp.submissions.length, 1);

    const restartedStore = new EmailSpontaneousStore({
      emailRoot: stack.emailRoot,
      evidence: await restartSubmissionStore(stack.emailRoot),
    });
    const restartedTicks: SpontaneousOccurrence[] = [];
    const restartScheduler = new SpontaneousScheduler(stack.config);
    restartScheduler.setOccurrenceStore(restartedStore);
    restartScheduler.setCallback(async (_platform, restored) => {
      assert(restored);
      await Promise.resolve();
      restartedTicks.push(restored);
    });

    restartScheduler.start();
    await restartScheduler.whenReady();
    await waitFor(
      async () => (await readSnapshot(stack.emailRoot)).previous?.status === "review-required",
    );
    restartScheduler.stop();

    assertEquals(restartedTicks, [], "an unresolved tick is never re-dispatched");
    assertEquals(stack.smtp.submissions.length, 1, "no replacement submission");
    const snapshot = await readSnapshot(stack.emailRoot);
    assertEquals(snapshot.previous?.occurrenceId, occurrence.occurrenceId);
    assertEquals(snapshot.previous?.status, "review-required");
    assert(snapshot.occurrence, "the lane keeps a distinct successor for the next schedule");
  });
});

Deno.test("email spontaneous - a revoked account is never selected and never mailed", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);
    await seedInbound(stack.messageStore);

    // The account is opted out BEFORE its timer fires: the tick is consumed without a
    // session, without mail and without a replacement target.
    const dispatches: Dispatch[] = [];
    const scheduler = new SpontaneousScheduler(stack.config);
    scheduler.setOccurrenceStore(stack.store);
    scheduler.setCallback(async (_platform, occurrence) => {
      assert(occurrence);
      stack.channels[0] = { id: `email/account/${OWNER}`, enabled: true, spontaneousPost: false };
      await dispatchEmailSpontaneousOccurrence({
        store: stack.store,
        adapter: stack.adapter,
        config: stack.config,
        occurrence,
        orchestrator: makeOrchestrator(stack, dispatches),
      });
    });

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(async () => (await readSnapshot(stack.emailRoot)).previous !== null);
    scheduler.stop();

    assertEquals(dispatches, []);
    assertEquals(stack.smtp.submissions.length, 0);
    const snapshot = await readSnapshot(stack.emailRoot);
    assertEquals(snapshot.previous?.status, "completed");
    assertEquals(snapshot.previous?.target, undefined);
    assert(snapshot.occurrence);
  });
});

Deno.test("email spontaneous - an already bound account that is removed is not claimed again", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);
    await seedInbound(stack.messageStore);

    const occurrence = await stack.store.schedule(new Date(Date.now() - 1000));
    const selection = await stack.adapter.determineSpontaneousTarget(stack.config);
    assert(selection);
    await stack.store.select(occurrence.occurrenceId, {
      owner: selection.userId,
      threadId: selection.newThreadId,
    });

    // The allowlist entry disappears between selection and the timer firing.
    stack.channels.length = 0;
    const bound = await bindEmailSpontaneousOccurrence({
      store: stack.store,
      adapter: stack.adapter,
      config: stack.config,
      occurrence,
    });

    assertEquals(bound, null);
    const state = await stack.store.restore();
    // The tick is neither re-targeted nor claimed: it stays bound to its original owner.
    assertEquals(state.occurrence?.status, "selected");
    assertEquals(state.occurrence?.target, {
      owner: OWNER,
      threadId: selection.newThreadId,
    });
    assertEquals(stack.smtp.submissions.length, 0);
  });
});

Deno.test("email spontaneous - opting out between binding and submission stops the send", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);
    await seedInbound(stack.messageStore);

    const occurrence = await stack.store.schedule(new Date(Date.now() - 1000));
    const bound = await bindEmailSpontaneousOccurrence({
      store: stack.store,
      adapter: stack.adapter,
      config: stack.config,
      occurrence,
    });
    assert(bound?.target);
    const channelId = formatEmailChannelId(bound.target.owner, bound.target.threadId);
    const emailSend = { ...spontaneousOperationKey(occurrence.occurrenceId), owner: OWNER };

    // Opted out while the session was being generated: the submission-time recheck refuses,
    // and it refuses BEFORE any evidence or SMTP work exists.
    stack.channels[0] = { id: `email/account/${OWNER}`, enabled: true, spontaneousPost: false };
    const refused = await stack.adapter.sendReply(channelId, "Too late.", { emailSend });
    assertEquals(refused.success, false);
    assertEquals(stack.smtp.submissions.length, 0);
    assertEquals(
      stack.submissionStore.lookup(OWNER, spontaneousOperationKey(occurrence.occurrenceId)),
      undefined,
    );

    // The same tick still delivers once the account is opted in again.
    stack.channels[0] = { id: `email/account/${OWNER}`, enabled: true, spontaneousPost: true };
    const sent = await stack.adapter.sendReply(channelId, "Now.", { emailSend });
    assertEquals(sent.success, true);
    assertEquals(stack.smtp.submissions.length, 1);
  });
});

Deno.test("email spontaneous - an owner without a verified address is never mailed", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);

    const occurrence = await stack.store.schedule(new Date(Date.now() - 1000));
    const dispatches: Dispatch[] = [];
    await dispatchEmailSpontaneousOccurrence({
      store: stack.store,
      adapter: stack.adapter,
      config: stack.config,
      occurrence,
      orchestrator: makeOrchestrator(stack, dispatches),
    });

    assertEquals(dispatches.length, 1);
    assertEquals(stack.smtp.submissions.length, 0);
    assertEquals(stack.sentCopy.appended.length, 0);
  });
});

Deno.test("email spontaneous - the outbound evidence keeps the bound internal thread", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);
    await seedInbound(stack.messageStore);

    const occurrence = await stack.store.schedule(new Date(Date.now() - 1000));
    const bound = await bindEmailSpontaneousOccurrence({
      store: stack.store,
      adapter: stack.adapter,
      config: stack.config,
      occurrence,
    });
    assert(bound?.target);
    const key = spontaneousOperationKey(occurrence.occurrenceId);
    const sent = await stack.adapter.sendReply(
      formatEmailChannelId(bound.target.owner, bound.target.threadId),
      "Hello.",
      { emailSend: { ...key, owner: OWNER } },
    );
    assertEquals(sent.success, true);

    // Crash repair reads this metadata alone, so the thread it records must be the bound one.
    const operationId = computeOperationId(OWNER, key);
    const metaPath = join(stack.emailRoot, outboundEvidenceMetaRef(operationId));
    const meta = JSON.parse(await Deno.readTextFile(metaPath)) as {
      internalThreadId?: string;
      to?: string;
    };
    assertEquals(meta.internalThreadId, bound.target.threadId);
    assertEquals(meta.to, SENDER);
  });
});

Deno.test("email spontaneous - the durable occurrence lane stays email-only", async () => {
  await withTempDir(async (base) => {
    const stack = await buildStack(base);
    // Discord keeps its existing best-effort channel selection while the durable occurrence
    // lane serves email only: Discord callbacks receive no occurrence at all.
    const discord = stack.config.platforms.discord;
    discord.enabled = true;
    discord.spontaneousPost = {
      enabled: true,
      minIntervalMs: TICK_INTERVAL_MS,
      maxIntervalMs: TICK_INTERVAL_MS,
      contextFetchProbability: 0,
    };

    const calls: Array<{ platform: string; occurrence?: SpontaneousOccurrence }> = [];
    const scheduler = new SpontaneousScheduler(stack.config);
    scheduler.setOccurrenceStore(stack.store);
    scheduler.setCallback(async (platform, occurrence) => {
      calls.push({ platform, occurrence });
      await Promise.resolve();
    });

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(() =>
      calls.some((call) => call.platform === "discord") &&
      calls.some((call) => call.platform === "email")
    );
    scheduler.stop();

    const discordCalls = calls.filter((call) => call.platform === "discord");
    const emailCalls = calls.filter((call) => call.platform === "email");
    assert(discordCalls.length >= 1);
    assert(emailCalls.length >= 1);
    assertEquals(discordCalls.every((call) => call.occurrence === undefined), true);
    assertEquals(emailCalls.every((call) => call.occurrence !== undefined), true);
    assertEquals(stack.smtp.submissions.length, 0);
  });
});
