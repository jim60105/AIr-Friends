# Proposal

## Why

Incoming email attachments are archived but reach agent context without a session copy. The existing materializer has no production caller, so descriptions expose opaque local identifiers and eligible trigger images are skipped.

## What Changes

- Connect the existing owner-safe materializer to session-owned context preparation before rendering or image-block construction.
- Stage trigger and included history attachments, and attachments returned by `fetch-context` and `get-message`, under the current canonical session staging directory.
- Keep ACP image blocks restricted to eligible trigger images; historical images remain file references.
- Document session copies and their disposable lifecycle in `docs/email-platform.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `email-incoming-content`: require session-contained attachment availability across initial and alternate retrieval paths.

## Impact

Expected changes are email activation/core dependency wiring, `src/core/session-orchestrator.ts`, context preparation/formatting, Skill API context wiring, `src/skills/context-handler.ts`, `src/skills/reply-handler.ts`, targeted tests and `docs/email-platform.md`. Reuse `src/platforms/email/attachment-materializer.ts` and `src/core/session-staging.ts`. No archive schema change, compatibility layer or migration. Backend forwarding already retrieves archive bytes directly and remains unchanged. Scope is one engineer-day for this handoff repair and targeted regression coverage.

## Batch:

depends-on: none

Code-conflict notes: `resolve-durable-email-reply-anchors` shares `src/core/session-orchestrator.ts`, potentially email activation wiring, and `docs/email-platform.md`; the runtime behaviors are independent. Apply this change first and the durable-anchor change second, serially. No semantic prerequisite exists between them.
