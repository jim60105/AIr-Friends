# Design

## Context

SchedulerStateStore is best-effort and resolveScheduleTime replaces overdue dates with now. Spontaneous callback carries only platform; after callback it saves the next schedule. Neither is durable email occurrence identity.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** implement only the concrete complete prerequisite below and its acceptance scenarios.

**Non-Goals:** no ordinary backend policy redesign, public mode/config workflow, new mail sending path or model-proof interpretation claim.

## Decisions

Email uses a dedicated fsynced data/email/spontaneous.json snapshot through durable-files as its authoritative schedule state, without changing Discord/Misskey best-effort scheduling. Persist {occurrenceId,dueAt,status:scheduled|selected|started|completed|review-required,target?:{owner,threadId}} before setting a timer. On restore retain original dueAt/occurrenceId even when overdue; delay becomes zero without changing identity. Recover pending selected target/thread before target selection; persist selection before session/SMTP. Keep current occurrence until its terminal result and its successor occurrence are atomically replaced in the same snapshot. A crash before replacement resumes/inspects the old occurrence; submitted/unknown operation evidence forbids any new target or SMTP DATA for that occurrence. Corruption blocks email spontaneous lane.

### Owned interfaces and consumers

Own EmailSpontaneousStore.schedule/select/begin/finishAndScheduleNext and SpontaneousOccurrence={occurrenceId,dueAt,target?,phase}; scheduler callback receives {platform,occurrence?}. Bootstrap forwards the restored occurrence to email target resolution and then userId/threadId/tickId to processSpontaneousPost; non-email callbacks keep existing meaning. No UID mailbox-store overload. New target selection is invoked only for unselected scheduled occurrence and must durably bind owner/thread before execution. finishAndScheduleNext verifies submitted/unknown evidence, terminalizes current as appropriate, then atomically installs a distinct next scheduled occurrence; unavailable outcome remains review-required and is not replaced by a retry.

Targets: `src/platforms/email/spontaneous-store.ts`, `src/core/spontaneous-scheduler.ts`, `src/core/scheduler-state-store.ts`, `src/bootstrap.ts`, `tests/core/email-spontaneous-occurrences.test.ts`. The factory/profile API is consumed by email-intent-runtime; occurrence API is consumed by email-spontaneous-targets and final activation. Only the relevant consumer applies to this change.

### Predecessors

`email-durable-files` supplies: Own appendDurable(record), replaceSnapshot(value), readJournal()->{records,integrity}. Integrity is clean|torn-tail|corrupt; readers get byte offset and safe code, never raw line in diagnostic. Torn tails remain on disk until explicit safe repair; subsequent append is prohibited on a damaged journal. No automatic trim that could erase a send intent.

`email-submission-journal` supplies: Own EmailOperationKey={workId,actionSlot}; actionSlot=reply|files|third-party:<grantId>|reminder:<id>|spontaneous:<tickId>. Lifecycle=prepared|submitting|submitted|failed|unknown; sentCopy=pending|appended|failed. prepare(key,digest,emlRef), markSubmitting(), recordOutcome(), lookup(). Add optional emailSubmission={operationId,phase,targetKind,sentCopy,safeCode} to reply/file/skill results. SMTP-accepted means submitted only. New model-supplied keys cannot evade deduplication.

### Alternatives

Prompt-only tool restrictions and ACP-only denial miss native pre-dispatch calls. Best-effort timestamps or freshly generated tick IDs cannot authorize deduplicated restarted mail. Use the existing native enforcement and durable-file mechanisms with these narrowly defined extensions instead of introducing another runtime service or database.

## Risks / Trade-offs

- Native evidence requires the selected installed executable; unavailable prerequisites are an explicit unverified/failed required gate, never a mock success claim. Model interpretation remains fallible.
- Preserve ordinary backend/scheduling behavior and isolate email-only changes. Shared factory, Containerfile and scheduler edits are serialized by the batch conflict matrix.
- The bounded estimate includes implementation plus test/smoke/docs; invalidated assumptions require rescoping before apply without hidden activation work.

## Verification design

Use actual SpontaneousScheduler, temporary durable store and counting callback; restart after submitted/unknown evidence but before next-save, assert same owner/thread and zero reselection. Email target slice adds real SMTP DATA-count integration.

No runtime evidence is claimed by these planning artifacts.

## Documentation

Document authoritative email occurrence file versus unchanged generic schedule file, integrity failure and restart review semantics. Add its owned section in docs/email-platform.md and a scoped CHANGELOG Unreleased entry during implementation.

## Migration Plan

No migrations. Apply dependencies and this complete implementation before its consumers. No predecessor enables production email; only email-activation removes the enabled-email guard. Rollback keeps email unavailable and retains private durable state for review.
