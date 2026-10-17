// tests/core/email-spontaneous-occurrences.test.ts
//
// Tests for the durable email spontaneous schedule occurrence identity owned by
// `email-spontaneous-occurrences`.
//
// The suite drives the real `SpontaneousScheduler` against the real
// `EmailSpontaneousStore` (temporary state roots) with counting callbacks, and uses the
// real `SubmissionStore` journal plus its startup recovery to prove that accepted or
// uncertain operation evidence forbids re-firing a restored occurrence.

import { assert, assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { SpontaneousScheduler } from "@core/spontaneous-scheduler.ts";
import type { SpontaneousPostCallback } from "@core/spontaneous-scheduler.ts";
import { SchedulerStateStore } from "@core/scheduler-state-store.ts";
import {
  EmailSpontaneousStore,
  EmailSpontaneousStoreError,
  SPONTANEOUS_SNAPSHOT_FILENAME,
  SpontaneousDiagnosticCode,
  spontaneousOperationKey,
} from "../../src/platforms/email/spontaneous-store.ts";
import type { SpontaneousOccurrence } from "../../src/platforms/email/spontaneous-store.ts";
import {
  _resetSharedRegistryForTesting,
  SubmissionStore,
} from "../../src/platforms/email/submission-store.ts";
import type { Config } from "../../src/types/config.ts";

const OWNER = "e_owner0123456789abcdef";
const THREAD_ONE = "mail:e_owner0123456789abcdef:11111111-1111-1111-1111-111111111111";
const THREAD_TWO = "mail:e_owner0123456789abcdef:22222222-2222-2222-2222-222222222222";

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

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "email-spontaneous-" });
  try {
    await fn(dir);
  } finally {
    // A test may have fenced the root read-only; restore permissions before cleanup.
    try {
      await Deno.chmod(dir, 0o700);
    } catch {
      // already writable or gone
    }
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

function makeConfig(options: {
  emailEnabled: boolean;
  emailSpontaneous: boolean;
  discordEnabled?: boolean;
  discordSpontaneous?: boolean;
  minIntervalMs?: number;
  maxIntervalMs?: number;
}): Config {
  const min = options.minIntervalMs ?? 40;
  const max = options.maxIntervalMs ?? 50;
  return {
    platforms: {
      discord: {
        token: "test-token",
        enabled: options.discordEnabled ?? false,
        spontaneousPost: {
          enabled: options.discordSpontaneous ?? false,
          minIntervalMs: min,
          maxIntervalMs: max,
          contextFetchProbability: 0.5,
        },
      },
      misskey: {
        host: "test.invalid",
        token: "test-token",
        enabled: false,
      },
      email: {
        enabled: options.emailEnabled,
        address: "bot@example.com",
        imap: { host: "imap.invalid", username: "bot@example.com", password: "imap-secret" },
        smtp: { host: "smtp.invalid", username: "bot@example.com", password: "smtp-secret" },
        incomingFolder: "INBOX",
        sentFolder: "Sent",
        pollIntervalMs: 300000,
        receivingAuth: { authservId: "mx.example.com", attestedStripping: true },
        maxMessageBytes: 26214400,
        maxIncomingAttachments: 10,
        signature: "",
        spontaneousPost: {
          enabled: options.emailSpontaneous,
          minIntervalMs: min,
          maxIntervalMs: max,
          contextFetchProbability: 0.5,
        },
      },
    },
    agent: {
      model: "test-model",
      systemPromptPath: "./prompts/system_reply.md",
      tokenLimit: 20000,
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: "./data", workspacesDir: "workspaces" },
    logging: { level: "INFO" },
    replyPolicy: "channels",
    channels: [],
  };
}

function createCallback(handler?: (occurrence?: SpontaneousOccurrence) => void): {
  callback: SpontaneousPostCallback;
  occurrences: Array<SpontaneousOccurrence | undefined>;
} {
  const occurrences: Array<SpontaneousOccurrence | undefined> = [];
  const callback: SpontaneousPostCallback = async (_platform, occurrence) => {
    occurrences.push(occurrence);
    // The dispatched work must be awaited: the scheduler finalizes the occurrence only after
    // the callback settles, exactly like the real dispatch path.
    await handler?.(occurrence);
  };
  return { callback, occurrences };
}

async function readSnapshot(root: string): Promise<Snapshot> {
  return JSON.parse(await Deno.readTextFile(join(root, SPONTANEOUS_SNAPSHOT_FILENAME))) as Snapshot;
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Bounded real-clock observation window.
 *
 * These cases assert the ABSENCE of a durable side effect (no timer armed, no callback
 * invoked) while the production scheduler genuinely arms `setTimeout` timers and the store
 * performs real `fsync`-backed I/O that fake timers cannot advance. Deterministic time
 * control therefore cannot observe the condition, so a short real window is used and the
 * durations stay in tens of milliseconds; the assertions themselves remain condition-based
 * wherever a positive signal exists.
 */
function observationWindow(ms = 120): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Store wrapper whose initial persistence is held open, to observe timer arming order. */
class GatedScheduleStore extends EmailSpontaneousStore {
  private readonly gate = Promise.withResolvers<void>();

  openGate(): void {
    this.gate.resolve();
  }

  override async schedule(dueAt: Date): Promise<SpontaneousOccurrence> {
    await this.gate.promise;
    return await super.schedule(dueAt);
  }
}

/** Store wrapper whose initial persistence always fails. */
class FailingScheduleStore extends EmailSpontaneousStore {
  override schedule(_dueAt: Date): Promise<SpontaneousOccurrence> {
    return Promise.reject(new Error("simulated schedule persistence failure"));
  }
}

/**
 * A Date that passes due-time validation but cannot be serialized into the snapshot.
 *
 * Directory permissions cannot inject a durable write failure here: the shared durable
 * writer re-establishes mode 0700 on its state root on every write. The durable-files suite
 * injects its own WRITE_FAILED case the same way, with a record the writer must refuse.
 */
class UnserializableDate extends Date {
  override toISOString(): string {
    throw new TypeError("simulated snapshot serialization failure");
  }
}

Deno.test("email spontaneous - occurrence is durably persisted before any timer is armed", async () => {
  await withTempDir(async (dir) => {
    const store = new GatedScheduleStore({ emailRoot: dir });
    const scheduler = new SpontaneousScheduler(
      makeConfig({ emailEnabled: true, emailSpontaneous: true }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(store);
    scheduler.setCallback(callback);

    scheduler.start();
    // Nothing may be armed while the occurrence is still unpersisted.
    await observationWindow(30);
    assertEquals(scheduler.getStatus().email?.nextScheduledAt ?? null, null);
    assertEquals(occurrences.length, 0);
    await assertRejects(
      () => Deno.lstat(join(dir, SPONTANEOUS_SNAPSHOT_FILENAME)),
      Deno.errors.NotFound,
    );

    store.openGate();
    await scheduler.whenReady();
    const status = scheduler.getStatus();
    assertNotEquals(status.email.nextScheduledAt, null);

    const snapshot = await readSnapshot(dir);
    assertEquals(snapshot.v, 1);
    assertEquals(snapshot.occurrence?.status, "scheduled");
    assertEquals(snapshot.previous, null);
    assertEquals(
      snapshot.occurrence?.dueAt,
      status.email.nextScheduledAt?.toISOString(),
    );
    scheduler.stop();
  });
});

Deno.test("email spontaneous - a failed persistence arms no timer and writes no snapshot", async () => {
  await withTempDir(async (dir) => {
    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 30,
        maxIntervalMs: 40,
      }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(new FailingScheduleStore({ emailRoot: dir }));
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await observationWindow();

    assertEquals(scheduler.getStatus().email?.nextScheduledAt ?? null, null);
    assertEquals(occurrences.length, 0);
    await assertRejects(
      () => Deno.lstat(join(dir, SPONTANEOUS_SNAPSHOT_FILENAME)),
      Deno.errors.NotFound,
    );
    scheduler.stop();
  });
});

Deno.test("email spontaneous - overdue restore keeps occurrence identity and due time", async () => {
  await withTempDir(async (dir) => {
    const seeding = new EmailSpontaneousStore({ emailRoot: dir });
    const dueAt = new Date(Date.now() - 60000);
    const seeded = await seeding.schedule(dueAt);

    // A new store instance proves the identity comes from durable state, not memory.
    const store = new EmailSpontaneousStore({ emailRoot: dir });
    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 1000,
        maxIntervalMs: 1000,
      }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(store);
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(() => occurrences.length > 0);

    assertEquals(occurrences[0]?.occurrenceId, seeded.occurrenceId);
    assertEquals(occurrences[0]?.dueAt.toISOString(), dueAt.toISOString());
    assertEquals(occurrences[0]?.status, "scheduled");

    const snapshot = await readSnapshot(dir);
    assertEquals(snapshot.previous?.occurrenceId, seeded.occurrenceId);
    assertEquals(snapshot.previous?.dueAt, dueAt.toISOString());
    assertNotEquals(snapshot.occurrence?.occurrenceId, seeded.occurrenceId);
    scheduler.stop();
  });
});

Deno.test("email spontaneous - restored selected occurrence keeps its bound target", async () => {
  await withTempDir(async (dir) => {
    const seeding = new EmailSpontaneousStore({ emailRoot: dir });
    const seeded = await seeding.schedule(new Date(Date.now() - 60000));
    await seeding.select(seeded.occurrenceId, { owner: OWNER, threadId: THREAD_ONE });

    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 1000,
        maxIntervalMs: 1000,
      }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(new EmailSpontaneousStore({ emailRoot: dir }));
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(() => occurrences.length > 0);

    const dispatched = occurrences[0];
    assertEquals(dispatched?.occurrenceId, seeded.occurrenceId);
    assertEquals(dispatched?.status, "selected");
    assertEquals(dispatched?.target?.owner, OWNER);
    assertEquals(dispatched?.target?.threadId, THREAD_ONE);

    // No replacement selection happened: the retained record keeps the original target.
    await waitFor(async () => (await readSnapshot(dir)).previous !== null);
    const snapshot = await readSnapshot(dir);
    assertEquals(snapshot.previous?.occurrenceId, seeded.occurrenceId);
    assertEquals(snapshot.previous?.target?.owner, OWNER);
    assertEquals(snapshot.previous?.target?.threadId, THREAD_ONE);
    scheduler.stop();
  });
});

Deno.test("email spontaneous - selection and dispatch claim are durable and cannot be replaced", async () => {
  await withTempDir(async (dir) => {
    const store = new EmailSpontaneousStore({ emailRoot: dir });
    const scheduled = await store.schedule(new Date(Date.now() + 3600000));
    await assertRejects(
      () => store.begin(scheduled.occurrenceId),
      EmailSpontaneousStoreError,
      undefined,
      "an unselected occurrence cannot start dispatch",
    );

    const selected = await store.select(scheduled.occurrenceId, {
      owner: OWNER,
      threadId: THREAD_ONE,
    });
    assertEquals(selected.status, "selected");

    // Durable before any consumer step: a fresh instance restores the whole binding.
    const restoredAfterSelect = await new EmailSpontaneousStore({ emailRoot: dir }).restore();
    assertEquals(restoredAfterSelect.occurrence?.occurrenceId, scheduled.occurrenceId);
    assertEquals(restoredAfterSelect.occurrence?.status, "selected");
    assertEquals(restoredAfterSelect.occurrence?.target?.owner, OWNER);
    assertEquals(restoredAfterSelect.occurrence?.target?.threadId, THREAD_ONE);

    await assertRejects(
      () => store.select(scheduled.occurrenceId, { owner: OWNER, threadId: THREAD_TWO }),
      EmailSpontaneousStoreError,
      "Occurrence target is already bound",
    );

    const started = await store.begin(scheduled.occurrenceId);
    assertEquals(started.status, "started");
    const restoredAfterBegin = await new EmailSpontaneousStore({ emailRoot: dir }).restore();
    assertEquals(restoredAfterBegin.occurrence?.status, "started");
    assertEquals(restoredAfterBegin.occurrence?.target?.threadId, THREAD_ONE);
  });
});

Deno.test("email spontaneous - finishing replaces the occurrence and installs a distinct successor atomically", async () => {
  await withTempDir(async (dir) => {
    // A bound occurrence with no recorded operation is resolved by its dispatch outcome.
    const store = new EmailSpontaneousStore({
      emailRoot: dir,
      evidence: { lookup: () => undefined },
    });
    const first = await store.schedule(new Date(Date.now() + 1000));
    await store.select(first.occurrenceId, { owner: OWNER, threadId: THREAD_ONE });
    await store.begin(first.occurrenceId);

    const second = await store.finishAndScheduleNext(
      first.occurrenceId,
      "completed",
      new Date(Date.now() + 2000),
    );
    assertNotEquals(second.occurrenceId, first.occurrenceId);
    assertEquals(second.status, "scheduled");

    const snapshot = await readSnapshot(dir);
    assertEquals(snapshot.occurrence?.occurrenceId, second.occurrenceId);
    assertEquals(snapshot.occurrence?.status, "scheduled");
    assertEquals(snapshot.previous?.occurrenceId, first.occurrenceId);
    assertEquals(snapshot.previous?.status, "completed");
    assertEquals(snapshot.previous?.target?.threadId, THREAD_ONE);

    // One document, one write: no temporary sibling survives the replacement.
    const entries: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
      entries.push(entry.name);
    }
    assertEquals(entries.sort(), [SPONTANEOUS_SNAPSHOT_FILENAME]);

    // Second cycle: the older retained record is dropped in the same single write.
    await store.select(second.occurrenceId, { owner: OWNER, threadId: THREAD_TWO });
    await store.begin(second.occurrenceId);
    const third = await store.finishAndScheduleNext(
      second.occurrenceId,
      "completed",
      new Date(Date.now() + 3000),
    );
    const nextSnapshot = await readSnapshot(dir);
    assertEquals(nextSnapshot.occurrence?.occurrenceId, third.occurrenceId);
    assertEquals(nextSnapshot.previous?.occurrenceId, second.occurrenceId);
    assertEquals(nextSnapshot.previous?.status, "completed");
    const entriesAfter: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
      entriesAfter.push(entry.name);
    }
    assertEquals(entriesAfter.sort(), [SPONTANEOUS_SNAPSHOT_FILENAME]);
  });
});

Deno.test("email spontaneous - unavailable outcome without accepted evidence stays review-required", async () => {
  await withTempDir(async (dir) => {
    const store = new EmailSpontaneousStore({ emailRoot: dir });
    const occurrence = await store.schedule(new Date(Date.now() + 1000));
    await store.select(occurrence.occurrenceId, { owner: OWNER, threadId: THREAD_ONE });
    await store.begin(occurrence.occurrenceId);

    const successor = await store.finishAndScheduleNext(
      occurrence.occurrenceId,
      "unavailable",
      new Date(Date.now() + 2000),
    );
    const snapshot = await readSnapshot(dir);
    assertEquals(snapshot.occurrence?.occurrenceId, successor.occurrenceId);
    assertEquals(snapshot.previous?.occurrenceId, occurrence.occurrenceId);
    assertEquals(snapshot.previous?.status, "review-required");
  });
});

Deno.test("email spontaneous - accepted SMTP evidence forbids re-firing a restored occurrence", async () => {
  await withTempDir(async (dir) => {
    const store = new EmailSpontaneousStore({ emailRoot: dir });
    const occurrence = await store.schedule(new Date(Date.now() - 60000));
    await store.select(occurrence.occurrenceId, { owner: OWNER, threadId: THREAD_ONE });
    await store.begin(occurrence.occurrenceId);

    const key = spontaneousOperationKey(occurrence.occurrenceId);
    _resetSharedRegistryForTesting();
    const writer = new SubmissionStore(dir);
    await writer.recover();
    await writer.prepare(OWNER, key, "digest-accepted", "outbound/op_test.eml");
    await writer.markSubmitting(OWNER, key, { verifyEvidence: false });
    await writer.recordOutcome(OWNER, key, "submitted");

    // Genuine durability: a fresh store must recover the journal before it is trusted.
    _resetSharedRegistryForTesting();
    const recovered = new SubmissionStore(dir);
    await recovered.recover();
    assertEquals(recovered.lookup(OWNER, key)?.phase, "submitted");

    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 1000,
        maxIntervalMs: 1000,
      }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(
      new EmailSpontaneousStore({ emailRoot: dir, evidence: recovered }),
    );
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await observationWindow();

    assertEquals(occurrences.length, 0);
    const snapshot = await readSnapshot(dir);
    assertEquals(snapshot.previous?.occurrenceId, occurrence.occurrenceId);
    assertEquals(snapshot.previous?.status, "completed");
    assertEquals(snapshot.previous?.target?.owner, OWNER);
    assertEquals(snapshot.previous?.target?.threadId, THREAD_ONE);
    assertNotEquals(snapshot.occurrence?.occurrenceId, occurrence.occurrenceId);
    assertEquals(snapshot.occurrence?.status, "scheduled");
    scheduler.stop();
  });
});

Deno.test("email spontaneous - recovered submitting evidence forbids re-firing a restored occurrence", async () => {
  await withTempDir(async (dir) => {
    const store = new EmailSpontaneousStore({ emailRoot: dir });
    const occurrence = await store.schedule(new Date(Date.now() - 60000));
    await store.select(occurrence.occurrenceId, { owner: OWNER, threadId: THREAD_ONE });
    await store.begin(occurrence.occurrenceId);

    const key = spontaneousOperationKey(occurrence.occurrenceId);
    _resetSharedRegistryForTesting();
    const writer = new SubmissionStore(dir);
    await writer.recover();
    await writer.prepare(OWNER, key, "digest-uncertain", "outbound/op_uncertain.eml");
    await writer.markSubmitting(OWNER, key, { verifyEvidence: false });

    // Recovery of an unclosed `submitting` operation converts it to absorbing `unknown`.
    _resetSharedRegistryForTesting();
    const recovered = new SubmissionStore(dir);
    const recovery = await recovered.recover();
    assertEquals(recovery.unknownRecovered.length, 1);
    assertEquals(recovered.lookup(OWNER, key)?.phase, "unknown");

    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 1000,
        maxIntervalMs: 1000,
      }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(
      new EmailSpontaneousStore({ emailRoot: dir, evidence: recovered }),
    );
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await observationWindow();

    assertEquals(occurrences.length, 0);
    const snapshot = await readSnapshot(dir);
    assertEquals(snapshot.previous?.occurrenceId, occurrence.occurrenceId);
    assertEquals(snapshot.previous?.status, "review-required");
    assertEquals(snapshot.previous?.target?.owner, OWNER);
    assertEquals(snapshot.previous?.target?.threadId, THREAD_ONE);
    assertNotEquals(snapshot.occurrence?.occurrenceId, occurrence.occurrenceId);
    assertEquals(snapshot.occurrence?.status, "scheduled");
    scheduler.stop();
  });
});

Deno.test("email spontaneous - successor persistence failure fences the lane and stops automatic work", async () => {
  await withTempDir(async (dir) => {
    const store = new EmailSpontaneousStore({ emailRoot: dir });
    const occurrence = await store.schedule(new Date(Date.now() + 3600000));

    const failure = await assertRejects(
      () =>
        store.finishAndScheduleNext(
          occurrence.occurrenceId,
          "completed",
          new UnserializableDate(),
        ),
      EmailSpontaneousStoreError,
      "Failed to durably replace",
    );
    assertEquals(
      (failure as EmailSpontaneousStoreError).diagnosticCode,
      SpontaneousDiagnosticCode.WRITE_FAILED,
    );

    // No replacement identity was allocated: a complete, valid old state remains on disk.
    const snapshot = await readSnapshot(dir);
    assertEquals(snapshot.occurrence?.occurrenceId, occurrence.occurrenceId);
    assertEquals(snapshot.occurrence?.status, "scheduled");
    assertEquals(snapshot.previous, null);

    // A fenced lane refuses the target binding too, so no dispatch can follow.
    await assertRejects(
      () => store.select(occurrence.occurrenceId, { owner: OWNER, threadId: THREAD_ONE }),
      EmailSpontaneousStoreError,
      "fenced",
    );

    // The scheduler observes the same fence: nothing is armed and nothing is dispatched.
    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 30,
        maxIntervalMs: 40,
      }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(new EmailSpontaneousStore({ emailRoot: dir }));
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await observationWindow();
    assertEquals(scheduler.getStatus().email?.nextScheduledAt ?? null, null);
    assertEquals(occurrences.length, 0);
    scheduler.stop();
  });
});

Deno.test("email spontaneous - corrupt snapshot blocks the lane without repair", async () => {
  await withTempDir(async (dir) => {
    const corrupt = '{"v":1,"occurrence":{"occurrenceId":"broken"';
    await Deno.writeTextFile(join(dir, SPONTANEOUS_SNAPSHOT_FILENAME), corrupt);

    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 30,
        maxIntervalMs: 40,
      }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(new EmailSpontaneousStore({ emailRoot: dir }));
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await observationWindow();

    assertEquals(scheduler.getStatus().email?.nextScheduledAt ?? null, null);
    assertEquals(occurrences.length, 0);
    assertEquals(await Deno.readTextFile(join(dir, SPONTANEOUS_SNAPSHOT_FILENAME)), corrupt);
    scheduler.stop();
  });
});

Deno.test("email spontaneous - an unavailable dispatch is recorded as review-required, never completed", async () => {
  await withTempDir(async (dir) => {
    const store = new EmailSpontaneousStore({ emailRoot: dir });
    const occurrence = await store.schedule(new Date(Date.now() - 1000));

    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 3600000,
        maxIntervalMs: 3600000,
      }),
    );
    const { callback, occurrences } = createCallback(() => {
      throw new Error("simulated unavailable email dispatch");
    });
    scheduler.setOccurrenceStore(store);
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(() => occurrences.length > 0);
    await observationWindow(50);

    assertEquals(occurrences.length, 1);
    const snapshot = await readSnapshot(dir);
    assertEquals(snapshot.previous?.occurrenceId, occurrence.occurrenceId);
    assertEquals(snapshot.previous?.status, "review-required");
    assertNotEquals(snapshot.occurrence?.occurrenceId, occurrence.occurrenceId);
    assertNotEquals(scheduler.getStatus().email?.nextScheduledAt ?? null, null);
    scheduler.stop();
  });
});

Deno.test("email spontaneous - non-email platforms keep best-effort scheduling", async () => {
  await withTempDir(async (dir) => {
    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: false,
        discordEnabled: true,
        discordSpontaneous: true,
        minIntervalMs: 1000,
        maxIntervalMs: 5000,
      }),
    );
    const stateStore = new SchedulerStateStore(join(dir, "scheduler-state.json"));
    await stateStore.load();
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(new EmailSpontaneousStore({ emailRoot: dir }));
    scheduler.setCallback(callback);
    scheduler.setStateStore(stateStore);

    const restoredNextAt = new Date(Date.now() + 2000);
    scheduler.start({ "spontaneous:discord": restoredNextAt.toISOString() });
    await scheduler.whenReady();

    const status = scheduler.getStatus();
    assertEquals("email" in status, false);
    assertEquals(status.discord.nextScheduledAt?.toISOString(), restoredNextAt.toISOString());
    await observationWindow(30);
    const persisted = JSON.parse(
      await Deno.readTextFile(join(dir, "scheduler-state.json")),
    ) as Record<string, string>;
    assertEquals(persisted["spontaneous:discord"], restoredNextAt.toISOString());
    await assertRejects(
      () => Deno.lstat(join(dir, SPONTANEOUS_SNAPSHOT_FILENAME)),
      Deno.errors.NotFound,
    );
    assertEquals(occurrences.length, 0);
    scheduler.stop();
  });
});

Deno.test("email spontaneous - occurrence lane stays inert while the email platform is disabled", async () => {
  await withTempDir(async (dir) => {
    const scheduler = new SpontaneousScheduler(
      makeConfig({ emailEnabled: false, emailSpontaneous: true }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(new EmailSpontaneousStore({ emailRoot: dir }));
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await observationWindow();

    assertEquals(Object.keys(scheduler.getStatus()).length, 0);
    assertEquals(occurrences.length, 0);
    await assertRejects(
      () => Deno.lstat(join(dir, SPONTANEOUS_SNAPSHOT_FILENAME)),
      Deno.errors.NotFound,
    );
    scheduler.stop();
  });
});

Deno.test("email spontaneous - diagnostic codes remain safe and typed", async () => {
  await withTempDir(async (dir) => {
    const store = new EmailSpontaneousStore({ emailRoot: dir });
    const error = await assertRejects(
      () => store.schedule(new Date(Number.NaN)),
      EmailSpontaneousStoreError,
    );
    assert(error instanceof EmailSpontaneousStoreError);
    assertEquals(error.diagnosticCode, SpontaneousDiagnosticCode.INVALID_DUE_AT);
    assert(error.message.includes("INVALID_DUE_AT"));
  });
});

Deno.test("email spontaneous - an incomplete snapshot envelope blocks the lane and is preserved", async () => {
  await withTempDir(async (dir) => {
    const incomplete = `{"v":1}`;
    await Deno.writeTextFile(join(dir, SPONTANEOUS_SNAPSHOT_FILENAME), incomplete);

    const store = new EmailSpontaneousStore({ emailRoot: dir });
    const failure = await assertRejects(
      () => store.restore(),
      EmailSpontaneousStoreError,
      "incomplete",
    );
    assertEquals(
      (failure as EmailSpontaneousStoreError).diagnosticCode,
      SpontaneousDiagnosticCode.STORE_CORRUPT,
    );

    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 30,
        maxIntervalMs: 40,
      }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(new EmailSpontaneousStore({ emailRoot: dir }));
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await observationWindow();

    assertEquals(scheduler.getStatus().email?.nextScheduledAt ?? null, null);
    assertEquals(occurrences.length, 0);
    assertEquals(await Deno.readTextFile(join(dir, SPONTANEOUS_SNAPSHOT_FILENAME)), incomplete);
    scheduler.stop();
  });
});

Deno.test("email spontaneous - an unreadable snapshot fences the lane instead of allocating a successor", async () => {
  await withTempDir(async (dir) => {
    // A snapshot path that cannot be read as a file is an integrity failure, not an empty lane.
    await Deno.mkdir(join(dir, SPONTANEOUS_SNAPSHOT_FILENAME));

    const store = new EmailSpontaneousStore({ emailRoot: dir });
    await assertRejects(() => store.restore(), EmailSpontaneousStoreError, "Failed to read");

    // The read failure fences the root, so no later caller can allocate a replacement identity.
    await assertRejects(
      () => store.schedule(new Date(Date.now() + 1000)),
      EmailSpontaneousStoreError,
      "fenced",
    );

    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 30,
        maxIntervalMs: 40,
      }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(new EmailSpontaneousStore({ emailRoot: dir }));
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await observationWindow();
    assertEquals(scheduler.getStatus().email?.nextScheduledAt ?? null, null);
    assertEquals(occurrences.length, 0);
    scheduler.stop();
  });
});

Deno.test("email spontaneous - an interrupted occurrence without recorded evidence resumes identically", async () => {
  await withTempDir(async (dir) => {
    const dueAt = new Date(Date.now() - 60000);
    const seeding = new EmailSpontaneousStore({ emailRoot: dir });
    const seeded = await seeding.schedule(dueAt);
    await seeding.select(seeded.occurrenceId, { owner: OWNER, threadId: THREAD_ONE });
    await seeding.begin(seeded.occurrenceId);

    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 3600000,
        maxIntervalMs: 3600000,
      }),
    );
    const { callback, occurrences } = createCallback();
    // The provider reports no recorded operation, so the interrupted attempt is unresolved.
    scheduler.setOccurrenceStore(
      new EmailSpontaneousStore({ emailRoot: dir, evidence: { lookup: () => undefined } }),
    );
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(() => occurrences.length > 0);

    const resumed = occurrences[0];
    assertEquals(resumed?.occurrenceId, seeded.occurrenceId);
    assertEquals(resumed?.dueAt.toISOString(), dueAt.toISOString());
    assertEquals(resumed?.status, "started");
    assertEquals(resumed?.target?.owner, OWNER);
    assertEquals(resumed?.target?.threadId, THREAD_ONE);
    scheduler.stop();
  });
});

Deno.test("email spontaneous - a prepared attempt is unresolved and resumes the same occurrence", async () => {
  await withTempDir(async (dir) => {
    const seeding = new EmailSpontaneousStore({ emailRoot: dir });
    const seeded = await seeding.schedule(new Date(Date.now() - 60000));
    await seeding.select(seeded.occurrenceId, { owner: OWNER, threadId: THREAD_ONE });
    await seeding.begin(seeded.occurrenceId);

    const key = spontaneousOperationKey(seeded.occurrenceId);
    _resetSharedRegistryForTesting();
    const writer = new SubmissionStore(dir);
    await writer.recover();
    await writer.prepare(OWNER, key, "digest-prepared", "outbound/op_prepared.eml");

    _resetSharedRegistryForTesting();
    const recovered = new SubmissionStore(dir);
    await recovered.recover();
    assertEquals(recovered.lookup(OWNER, key)?.phase, "prepared");

    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 3600000,
        maxIntervalMs: 3600000,
      }),
    );
    const { callback, occurrences } = createCallback();
    scheduler.setOccurrenceStore(
      new EmailSpontaneousStore({ emailRoot: dir, evidence: recovered }),
    );
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(() => occurrences.length > 0);
    assertEquals(occurrences[0]?.occurrenceId, seeded.occurrenceId);
    assertEquals(occurrences[0]?.target?.threadId, THREAD_ONE);
    scheduler.stop();
  });
});

Deno.test("email spontaneous - a real dispatch binds the target durably before it runs", async () => {
  await withTempDir(async (dir) => {
    const store = new EmailSpontaneousStore({ emailRoot: dir });
    const occurrence = await store.schedule(new Date(Date.now() - 1000));

    const observed: string[] = [];
    const { callback, occurrences } = createCallback(async (pending) => {
      assert(pending);
      // The consumer is responsible for binding the target before any session or send work.
      await store.select(pending.occurrenceId, { owner: OWNER, threadId: THREAD_ONE });
      await store.begin(pending.occurrenceId);
      // Only after the binding is durable does the consumer perform the dispatched work.
      const durable = await new EmailSpontaneousStore({ emailRoot: dir }).restore();
      observed.push(durable.occurrence?.status ?? "missing");
    });

    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 3600000,
        maxIntervalMs: 3600000,
      }),
    );
    scheduler.setOccurrenceStore(store);
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(() => occurrences.length > 0);

    assertEquals(occurrences[0]?.occurrenceId, occurrence.occurrenceId);
    assertEquals(observed, ["started"]);

    // A bound-but-unresolved dispatch is recorded for review with a distinct successor.
    await waitFor(async () => (await readSnapshot(dir)).previous !== null);
    const snapshot = await readSnapshot(dir);
    assertEquals(snapshot.previous?.occurrenceId, occurrence.occurrenceId);
    assertEquals(snapshot.previous?.target?.threadId, THREAD_ONE);
    assertNotEquals(snapshot.occurrence?.occurrenceId, occurrence.occurrenceId);
    scheduler.stop();
  });
});

Deno.test("email spontaneous - a scheduler restart never dispatches one occurrence twice", async () => {
  await withTempDir(async (dir) => {
    const store = new EmailSpontaneousStore({ emailRoot: dir });
    const occurrence = await store.schedule(new Date(Date.now() - 1000));

    const gate = Promise.withResolvers<void>();
    const dispatched: string[] = [];
    const { callback } = createCallback(async (pending) => {
      dispatched.push(pending?.occurrenceId ?? "unknown");
      await gate.promise;
    });
    const scheduler = new SpontaneousScheduler(
      makeConfig({
        emailEnabled: true,
        emailSpontaneous: true,
        minIntervalMs: 3600000,
        maxIntervalMs: 3600000,
      }),
    );
    scheduler.setOccurrenceStore(store);
    scheduler.setCallback(callback);

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(() => dispatched.length === 1);

    // Restart while the first dispatch is still in flight: the new lifecycle must wait for it
    // instead of dispatching the same durable occurrence a second time.
    scheduler.stop();
    scheduler.start();
    await observationWindow();
    assertEquals(dispatched, [occurrence.occurrenceId]);

    gate.resolve();
    await waitFor(async () => (await readSnapshot(dir)).previous !== null);
    // The current lifecycle finishes arming only after the interrupted dispatch finalizes.
    await scheduler.whenReady();
    assertEquals(dispatched, [occurrence.occurrenceId]);
    assertNotEquals(
      scheduler.getStatus().email?.nextScheduledAt ?? null,
      null,
      "the successor successor must still be armed by the current lifecycle",
    );
    scheduler.stop();
  });
});
