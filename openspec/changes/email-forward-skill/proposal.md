# Proposal

## Why

User-directed source-preserving forwarding supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Add action forward and required sourceRecordId bound by grant. Fetch immutable source only through EmailMessageStore owner scope, include full designated original body plus all original attachments, and preserve raw source as message/rfc822 to retain original headers/signatures/encoding. Build commentary/signature then original reference section using shared builder. Preflight source raw size, all source attachments and added attachments together before loading/sending. Limit failure rejects the whole operation instead of truncating.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-forwarding`: User-directed source-preserving forwarding behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `skills/send-email/SKILL.md`, `skills/send-email/scripts/send-email.ts`, `src/skills/email-handler.ts`, `tests/skills/email-forward.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.75 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-compose-skill
- depends-on: email-message-history
- code-conflict: email-compose-skill (skills/send-email/SKILL.md, skills/send-email/scripts/send-email.ts, src/skills/email-handler.ts)
- code-conflict: email-tool-guidance (skills/send-email/SKILL.md)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
