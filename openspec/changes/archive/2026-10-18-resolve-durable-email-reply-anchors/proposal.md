# Proposal

## Why

Email reminders lose their original anchor after 200 newer same-thread records even though the archive retains it. This contradicts the original approved design's restart-safe originating-thread promise; later operator documentation explicitly introduced expiry and must be reconciled.

## What Changes

- Resolve explicit reply anchors with durable owner+thread+record lookup in both reminder preflight and adapter send resolution.
- Preserve the original verified sender and wire threading anchor without selecting a substitute or allocating a new thread.
- Keep bounded recent model context, current allowlist checks, stable reminder operation identity and completed/uncertain submission suppression.
- Replace the bounded-expiry contract in `docs/email-platform.md` with retained-anchor lookup and actual missing/corrupt-origin failure behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `email-history`: durable explicit reply lookup independent of recent history.
- `scheduled-reminders`: retained original anchors remain usable after history growth and restart.

## Impact

Expected changes are `src/core/session-orchestrator.ts`, email service/core composition, `src/platforms/email/email-adapter.ts`, `src/platforms/email/message-store.ts`, targeted adapter/reminder tests and `docs/email-platform.md`. Existing durable lookup provides owner-thread isolation; a shared eligibility resolver adds wire-ID/sender checks without new persistence, migration or compatibility layers. Scope is one engineer-day for both resolution checks and focused regression coverage. Previously disabled review-required reminders are not automatically re-enabled.

## Batch:

depends-on: none

Code-conflict notes: `materialize-email-session-attachments` shares `src/core/session-orchestrator.ts`, potentially activation wiring, and `docs/email-platform.md`. Apply attachments first, then this change serially to avoid overlapping edits. Neither change requires the other's behavior; do not parallelize shared-file implementation.
