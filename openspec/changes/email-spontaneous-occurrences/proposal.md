# Proposal

## Why

Durable spontaneous schedule occurrence identity makes the approved email behavior implementable without hiding security or restart work in integration. The final whole-batch critique identified this as a separately owned prerequisite.

## What Changes

- Email uses a dedicated fsynced data/email/spontaneous.json snapshot through durable-files as its authoritative schedule state, without changing Discord/Misskey best-effort scheduling. Persist {occurrenceId,dueAt,status:scheduled|selected|started|completed|review-required,target?:{owner,threadId}} before setting a timer. On restore retain original dueAt/occurrenceId even when overdue; delay becomes zero without changing identity. Recover pending selected target/thread before target selection; persist selection before session/SMTP. Keep current occurrence until its terminal result and its successor occurrence are atomically replaced in the same snapshot. A crash before replacement resumes/inspects the old occurrence; submitted/unknown operation evidence forbids any new target or SMTP DATA for that occurrence. Corruption blocks email spontaneous lane.
- Implement and verify this complete bounded responsibility before its consumers; production email remains unavailable until email-activation.

## Capabilities

### New Capabilities

- `email-spontaneous-occurrences`: Durable spontaneous schedule occurrence identity with its own observable isolation and recovery contract.

### Modified Capabilities

None. Normal backend launches and non-email scheduling retain their current behavior.

## Impact

`src/platforms/email/spontaneous-store.ts`, `src/core/spontaneous-scheduler.ts`, `src/core/scheduler-state-store.ts`, `src/bootstrap.ts`, `tests/core/email-spontaneous-occurrences.test.ts`. No implementation is authorized during proposal creation.

## Estimate

Total **6.75 engineering hours**, including implementation, tests, smoke, documentation and contingency itemized in tasks.md. Strictly below 8 hours; estimates are not guarantees.

## Batch:

- depends-on: email-durable-files
- depends-on: email-submission-journal
- code-conflict: email-config-identity (src/core/spontaneous-scheduler.ts)
- code-conflict: email-reminder-threads (src/bootstrap.ts)
- code-conflict: email-spontaneous-targets (src/core/spontaneous-scheduler.ts)
- code-conflict: email-activation (src/bootstrap.ts)

Apply according to `../email-config-identity/batch-index.md`, serializing shared-file conflicts.
