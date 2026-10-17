// tests/platforms/email/mailbox-poller.test.ts
//
// Regression tests for the poll-cycle orchestrator owned by `email-poll-recovery`.
// Exercises the real EmailImapClient against the deterministic local IMAP fixture, plus the
// real MailboxStore and EmailMessageStore on temporary state, to verify:
// - first-activation boundary excludes preexisting mail; restart discovers downtime mail once
// - admit -> durable source -> accept -> checkpoint; ignore/reject recorded, no event emitted
// - per-message failure isolation (malformed terminal, later entries unaffected)
// - connection failure preserves the checkpoint and the next round resumes
// - crash recovery resumes accepted-unstarted work; started work becomes review-required
// - UIDVALIDITY replacement reconciles against durable evidence without replay

import { assert, assertEquals } from "@std/assert";
import {
  buildMailboxFingerprint,
  MailboxKey,
  MailboxStore,
} from "../../../src/platforms/email/mailbox-store.ts";
import { EmailMessageStore } from "../../../src/platforms/email/message-store.ts";
import { EmailImapClient } from "../../../src/platforms/email/imap-client.ts";
import {
  EmailMailboxPoller,
  IncomingWork,
  ReviewItem,
} from "../../../src/platforms/email/mailbox-poller.ts";
import { normalizeEmailMailbox } from "../../../src/platforms/email/email-identity.ts";
import { EmailImapTestService } from "../../helpers/email-imap-service.ts";
import type { ChannelConfig, EmailConfig } from "../../../src/types/config.ts";

const BOT_ADDRESS = "bot@example.com";
const AUTHSERV = "mx.example.com";
const ALLOWED_ADDRESS = "alice@allowed-domain.org";
const ALLOWED_USER_ID = normalizeEmailMailbox(ALLOWED_ADDRESS).userId;
const PASSWORD = "secretpassword";

const CHANNELS: ChannelConfig[] = [
  { id: `email/account/${ALLOWED_USER_ID}`, enabled: true },
];

function fingerprint(): string {
  return buildMailboxFingerprint("127.0.0.1", BOT_ADDRESS, "INBOX");
}

function keyFor(uidValidity: number, uid: number): MailboxKey {
  return { fingerprint: fingerprint(), uidValidity, uid };
}

function rawMessage(options: {
  messageId: string;
  authResult?: string;
  from?: string;
  subject?: string;
  body?: string;
}): string {
  const from = options.from ?? ALLOWED_ADDRESS;
  const domain = from.split("@")[1];
  const auth = options.authResult ??
    `Authentication-Results: ${AUTHSERV}; dmarc=pass header.from=${domain}`;
  return [
    `From: ${from}`,
    `To: ${BOT_ADDRESS}`,
    `Subject: ${options.subject ?? "Hello"}`,
    `Message-ID: ${options.messageId}`,
    auth,
    "",
    options.body ?? "Authored body text.",
  ].join("\r\n");
}

interface Env {
  config: EmailConfig;
  store: MailboxStore;
  messageStore: EmailMessageStore;
  transport: EmailImapClient;
}

function buildEnv(
  service: EmailImapTestService,
  mailboxRoot: string,
  workspacesRoot: string,
  overrides: Partial<Pick<EmailConfig, "maxMessageBytes" | "pollIntervalMs">> = {},
): Env {
  const config: EmailConfig = {
    enabled: false,
    address: BOT_ADDRESS,
    imap: {
      host: "127.0.0.1",
      port: service.port,
      tlsMode: "tls",
      username: BOT_ADDRESS,
      password: PASSWORD,
    },
    smtp: {
      host: "127.0.0.1",
      port: 2525,
      tlsMode: "tls",
      username: BOT_ADDRESS,
      password: PASSWORD,
    },
    incomingFolder: "INBOX",
    sentFolder: "Sent",
    pollIntervalMs: overrides.pollIntervalMs ?? 300_000,
    receivingAuth: { authservId: AUTHSERV, attestedStripping: true },
    maxMessageBytes: overrides.maxMessageBytes ?? 25 * 1024 * 1024,
    maxIncomingAttachments: 10,
    signature: "",
  };
  return {
    config,
    store: new MailboxStore({ emailRoot: mailboxRoot, fingerprint: fingerprint() }),
    messageStore: new EmailMessageStore({ workspacesRoot }),
    transport: new EmailImapClient({ config: config.imap, tlsCa: service.caCert }),
  };
}

function buildPoller(
  env: Env,
  emit: (work: IncomingWork) => void,
  onReviewRequired?: (item: ReviewItem) => void,
  onCycleError?: (code: string) => void,
): EmailMailboxPoller {
  return new EmailMailboxPoller({
    config: env.config,
    transport: env.transport,
    mailboxStore: env.store,
    messageStore: env.messageStore,
    channels: CHANNELS,
    emit,
    onReviewRequired,
    onCycleError,
    workIdFactory: (() => {
      let counter = 0;
      return () => `work-${++counter}`;
    })(),
  });
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "mailbox-poller-test-" });
  try {
    await fn(dir);
  } finally {
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

Deno.test("EmailMailboxPoller - first activation boundary and restart discovery of Seen mail", async () => {
  await withTempDir(async (base) => {
    const mailboxRoot = `${base}/email`;
    const workspacesRoot = `${base}/workspaces`;
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT_ADDRESS,
      password: PASSWORD,
      uidValidity: 500,
      initialMessages: [
        { uid: 101, flags: ["\\Seen"], rawMime: rawMessage({ messageId: "<preexisting-101@x>" }) },
        { uid: 102, flags: ["\\Seen"], rawMime: rawMessage({ messageId: "<preexisting-102@x>" }) },
      ],
    });
    await service.start();
    try {
      const env1 = buildEnv(service, mailboxRoot, workspacesRoot);
      const emits1: IncomingWork[] = [];
      const poller1 = buildPoller(env1, (w) => emits1.push(w));

      const first = await poller1.poll();
      assert(first.halted);
      assertEquals(first.accepted, 0);
      assertEquals(emits1.length, 0);
      assertEquals(env1.store.getSnapshot()?.initializedBoundary, 102);
      assertEquals(env1.store.getSnapshot()?.cursor, 102);

      // Mail arrives while the bot is stopped, marked Seen by another client.
      service.addMessage({
        uid: 103,
        flags: ["\\Seen"],
        rawMime: rawMessage({ messageId: "<downtime-103@x>" }),
      });

      const env2 = buildEnv(service, mailboxRoot, workspacesRoot);
      const emits2: IncomingWork[] = [];
      const poller2 = buildPoller(env2, (w) => emits2.push(w));

      const second = await poller2.poll();
      assertEquals(second.accepted, 1);
      assertEquals(emits2.length, 1);
      assertEquals(emits2[0].mailboxKey.uid, 103);
      assertEquals(emits2[0].owner, ALLOWED_USER_ID);
      assertEquals(env2.store.getEntry(keyFor(500, 103))?.state, "accepted");
      assertEquals(env2.store.getSnapshot()?.cursor, 103);

      // Exactly once: a further round finds nothing new.
      const third = await poller2.poll();
      assertEquals(third.accepted, 0);
      assertEquals(emits2.length, 1);
    } finally {
      await service.stop();
    }
  });
});

Deno.test("EmailMailboxPoller - admits source then checkpoint, records ignore/reject without emitting", async () => {
  await withTempDir(async (base) => {
    const mailboxRoot = `${base}/email`;
    const workspacesRoot = `${base}/workspaces`;
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT_ADDRESS,
      password: PASSWORD,
      uidValidity: 500,
      uidNext: 101,
    });
    await service.start();
    try {
      const env = buildEnv(service, mailboxRoot, workspacesRoot);
      const emits: IncomingWork[] = [];
      const poller = buildPoller(env, (w) => emits.push(w));

      await poller.poll(); // first activation: boundary 100

      const domain = ALLOWED_ADDRESS.split("@")[1];
      service.addMessage({
        uid: 101,
        rawMime: rawMessage({ messageId: "<admit-101@x>" }),
      });
      service.addMessage({
        uid: 102,
        rawMime: rawMessage({
          messageId: "<auto-102@x>",
          authResult:
            `Authentication-Results: ${AUTHSERV}; dmarc=pass header.from=${domain}\r\nAuto-Submitted: auto-generated`,
        }),
      });
      service.addMessage({
        uid: 103,
        rawMime: rawMessage({
          messageId: "<spoof-103@x>",
          authResult:
            `Authentication-Results: ${AUTHSERV}; dmarc=fail (p=reject) header.from=${domain}`,
        }),
      });

      const round = await poller.poll();
      assertEquals(round.accepted, 1);
      assertEquals(round.ignored, 1);
      assertEquals(round.failed, 1);
      assertEquals(emits.length, 1);
      assertEquals(emits[0].mailboxKey.uid, 101);

      const accepted = env.store.getEntry(keyFor(500, 101));
      assertEquals(accepted?.state, "accepted");
      assert(accepted?.sourceRecordId);
      assertEquals(env.store.getEntry(keyFor(500, 102))?.state, "ignored");
      assertEquals(env.store.getEntry(keyFor(500, 103))?.state, "failed");
      assertEquals(env.store.getSnapshot()?.cursor, 103);

      // Durable message record exists with thread association for the accepted work.
      const record = await env.messageStore.getByOwnerRecord(
        ALLOWED_USER_ID,
        accepted!.sourceRecordId!,
      );
      assertEquals(record?.direction, "inbound");
      assertEquals(record?.threadId, emits[0].threadId);
    } finally {
      await service.stop();
    }
  });
});

Deno.test("EmailMailboxPoller - malformed message is terminal and does not block later entries", async () => {
  await withTempDir(async (base) => {
    const mailboxRoot = `${base}/email`;
    const workspacesRoot = `${base}/workspaces`;
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT_ADDRESS,
      password: PASSWORD,
      uidValidity: 500,
      uidNext: 101,
    });
    await service.start();
    try {
      const env = buildEnv(service, mailboxRoot, workspacesRoot);
      const emits: IncomingWork[] = [];
      const poller = buildPoller(env, (w) => emits.push(w));
      await poller.poll();

      // Missing From header: deterministic parser failure.
      service.addMessage({ uid: 101, rawMime: "Subject: no from\r\n\r\nbody" });
      service.addMessage({ uid: 102, rawMime: rawMessage({ messageId: "<valid-102@x>" }) });

      const round = await poller.poll();
      assertEquals(round.failed, 1);
      assertEquals(round.accepted, 1);
      assertEquals(emits.length, 1);
      assertEquals(emits[0].mailboxKey.uid, 102);
      assertEquals(env.store.getEntry(keyFor(500, 101))?.state, "failed");
      assertEquals(env.store.getEntry(keyFor(500, 102))?.state, "accepted");
      assertEquals(env.store.getSnapshot()?.cursor, 102);
    } finally {
      await service.stop();
    }
  });
});

Deno.test("EmailMailboxPoller - connection failure preserves the checkpoint", async () => {
  await withTempDir(async (base) => {
    const mailboxRoot = `${base}/email`;
    const workspacesRoot = `${base}/workspaces`;
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT_ADDRESS,
      password: PASSWORD,
      uidValidity: 500,
      uidNext: 101,
    });
    await service.start();
    const env = buildEnv(service, mailboxRoot, workspacesRoot);
    const emits: IncomingWork[] = [];
    const errors: string[] = [];
    const poller = buildPoller(env, (w) => emits.push(w), undefined, (code) => errors.push(code));
    try {
      await poller.poll(); // first activation
      service.addMessage({ uid: 101, rawMime: rawMessage({ messageId: "<ok-101@x>" }) });
      const ok = await poller.poll();
      assertEquals(ok.accepted, 1);
      assertEquals(env.store.getSnapshot()?.cursor, 101);
    } finally {
      await service.stop(); // connection now refused
    }

    const failed = await poller.poll();
    assert(failed.halted);
    assert(failed.error);
    assertEquals(errors.length, 1);
    // Progress preserved: the checkpoint is unchanged and no duplicate work was emitted.
    assertEquals(env.store.getSnapshot()?.cursor, 101);
    assertEquals(emits.length, 1);
  });
});

Deno.test("EmailMailboxPoller - crash recovery resumes unstarted and quarantines started work", async () => {
  await withTempDir(async (base) => {
    const mailboxRoot = `${base}/email`;
    const workspacesRoot = `${base}/workspaces`;
    const raw101 = rawMessage({ messageId: "<resume-101@x>" });
    const raw102 = rawMessage({ messageId: "<started-102@x>" });
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT_ADDRESS,
      password: PASSWORD,
      uidValidity: 500,
      uidNext: 103,
      initialMessages: [
        { uid: 101, rawMime: raw101 },
        { uid: 102, rawMime: raw102 },
      ],
    });
    await service.start();
    try {
      // Seed prior-run durable state: 101 accepted-unstarted, 102 started without terminal outcome.
      const seedStore = new MailboxStore({ emailRoot: mailboxRoot, fingerprint: fingerprint() });
      const seedMessages = new EmailMessageStore({ workspacesRoot });
      await seedStore.recover();
      await seedStore.initialize(100, 500);

      const seedParsed = (messageId: string) => ({
        from: ALLOWED_ADDRESS,
        subject: "Seed",
        wireIds: { messageId },
        plainBody: "Seed body",
      });
      const record101 = await seedMessages.putSource(
        ALLOWED_USER_ID,
        new TextEncoder().encode(raw101),
        seedParsed("<resume-101@x>"),
      );
      const record102 = await seedMessages.putSource(
        ALLOWED_USER_ID,
        new TextEncoder().encode(raw102),
        seedParsed("<started-102@x>"),
      );

      await seedStore.discover(keyFor(500, 101));
      await seedStore.accept(keyFor(500, 101), record101);
      await seedStore.discover(keyFor(500, 102));
      await seedStore.accept(keyFor(500, 102), record102);
      await seedStore.start(keyFor(500, 102), "work-crashed");

      // Restart with fresh store/view instances over the same durable state.
      const env = buildEnv(service, mailboxRoot, workspacesRoot);
      const emits: IncomingWork[] = [];
      const reviews: ReviewItem[] = [];
      const poller = buildPoller(env, (w) => emits.push(w), (i) => reviews.push(i));

      const recovery = await poller.recover();
      assertEquals(recovery.unstarted.length, 1);
      assertEquals(recovery.reviewRequired.length, 1);

      // Unstarted work resumes with the original durable record id (no loss, at-least-once).
      assertEquals(emits.length, 1);
      assertEquals(emits[0].mailboxKey.uid, 101);
      assertEquals(emits[0].recordId, record101);
      assertEquals(
        emits[0].threadId,
        (await env.messageStore.getByOwnerRecord(ALLOWED_USER_ID, record101))!.threadId,
      );

      // Started work is quarantined, never auto-replayed.
      assertEquals(env.store.getEntry(keyFor(500, 102))?.state, "review-required");
      assert(reviews.some((r) => r.mailboxKey.uid === 102));
    } finally {
      await service.stop();
    }
  });
});

Deno.test("EmailMailboxPoller - duplicate wire Message-ID becomes review-required, not replayed", async () => {
  await withTempDir(async (base) => {
    const mailboxRoot = `${base}/email`;
    const workspacesRoot = `${base}/workspaces`;
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT_ADDRESS,
      password: PASSWORD,
      uidValidity: 500,
      uidNext: 101,
    });
    await service.start();
    try {
      const env = buildEnv(service, mailboxRoot, workspacesRoot);
      const emits: IncomingWork[] = [];
      const reviews: ReviewItem[] = [];
      const poller = buildPoller(env, (w) => emits.push(w), (i) => reviews.push(i));
      await poller.poll();

      service.addMessage({ uid: 101, rawMime: rawMessage({ messageId: "<dup@x>" }) });
      service.addMessage({
        uid: 102,
        rawMime: rawMessage({ messageId: "<dup@x>", body: "Different duplicate body." }),
      });

      const round = await poller.poll();
      assertEquals(round.accepted, 1);
      assertEquals(round.reviewRequired, 1);
      assertEquals(emits.length, 1);
      assertEquals(emits[0].mailboxKey.uid, 101);
      assertEquals(env.store.getEntry(keyFor(500, 102))?.state, "review-required");
      assert(reviews.some((r) => r.mailboxKey.uid === 102));
    } finally {
      await service.stop();
    }
  });
});

Deno.test("EmailMailboxPoller - UIDVALIDITY replacement reconciles without replay", async () => {
  await withTempDir(async (base) => {
    const mailboxRoot = `${base}/email`;
    const workspacesRoot = `${base}/workspaces`;
    const oldRaw = rawMessage({ messageId: "<old-1@x>", body: "Original body." });
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT_ADDRESS,
      password: PASSWORD,
      uidValidity: 777,
      uidNext: 204,
      initialMessages: [
        // Identical old content reappearing under a new UID.
        { uid: 201, rawMime: oldRaw },
        // Same wire identifier but conflicting content.
        { uid: 202, rawMime: rawMessage({ messageId: "<old-1@x>", body: "Conflicting body." }) },
        // Unknown identifier: unmatched replacement content.
        { uid: 203, rawMime: rawMessage({ messageId: "<unknown-203@x>" }) },
      ],
    });
    await service.start();
    try {
      // Seed prior mailbox A (uidValidity 500) with completed processing evidence.
      const seedStore = new MailboxStore({ emailRoot: mailboxRoot, fingerprint: fingerprint() });
      const seedMessages = new EmailMessageStore({ workspacesRoot });
      await seedStore.recover();
      await seedStore.initialize(100, 500);
      const recordOld = await seedMessages.putSource(
        ALLOWED_USER_ID,
        new TextEncoder().encode(oldRaw),
        {
          from: ALLOWED_ADDRESS,
          subject: "Old",
          wireIds: { messageId: "<old-1@x>" },
          plainBody: "Original body.",
        },
      );
      await seedStore.discover(keyFor(500, 101));
      await seedStore.accept(keyFor(500, 101), recordOld);
      await seedStore.start(keyFor(500, 101), "work-old");
      await seedStore.finish(keyFor(500, 101), "completed", { workId: "work-old" });

      const env = buildEnv(service, mailboxRoot, workspacesRoot);
      const emits: IncomingWork[] = [];
      const reviews: ReviewItem[] = [];
      const poller = buildPoller(env, (w) => emits.push(w), (i) => reviews.push(i));

      const round = await poller.poll();
      assert(round.replacementDetected);
      assert(round.halted);
      assertEquals(round.accepted, 0);
      assertEquals(emits.length, 0);
      // The identical old source (uid 201) is provably not new work; conflicting and unmatched
      // entries require review.
      assertEquals(
        reviews.map((r) => `${r.mailboxKey.uid}:${r.reason}`).sort(),
        ["202:replacement-conflicting-identifiers", "203:replacement-unmatched"],
      );
      // The mailbox is never replayed and the progress checkpoint is unchanged.
      assertEquals(env.store.getSnapshot()?.uidValidity, 500);
      assertEquals(env.store.getSnapshot()?.cursor, 100);
    } finally {
      await service.stop();
    }
  });
});

Deno.test("EmailMailboxPoller - start performs a round and stop settles cleanly", async () => {
  await withTempDir(async (base) => {
    const mailboxRoot = `${base}/email`;
    const workspacesRoot = `${base}/workspaces`;
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT_ADDRESS,
      password: PASSWORD,
      uidValidity: 500,
      uidNext: 101,
    });
    await service.start();
    try {
      const env = buildEnv(service, mailboxRoot, workspacesRoot, { pollIntervalMs: 3_600_000 });
      const emits: IncomingWork[] = [];
      const poller = buildPoller(env, (w) => emits.push(w));

      await poller.start();
      // First activation persisted the boundary; no preexisting work admitted.
      assertEquals(env.store.getSnapshot()?.initializedBoundary, 100);

      service.addMessage({ uid: 101, rawMime: rawMessage({ messageId: "<start-101@x>" }) });
      const round = await poller.poll();
      assertEquals(round.accepted, 1);
      assertEquals(emits.length, 1);

      await poller.stop();
    } finally {
      await service.stop();
    }
  });
});
