# Proposal

## Why

User-directed third-party composition skill supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Add send-email action compose behind enabled email service and authenticated email user-triggered session. Script accepts --grant-id and --request-file only; request JSON carries to, subject, body and optional session-scoped attachment references, so recipient display strings, subject and body never occur as shell free text. Extend payload legacy rejection for --subject/--body/--to on this script without changing other script behavior. Handler compares canonical to/action/source with immutable host grant before any file read or MIME construction.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-outbound-composition`: User-directed third-party composition skill behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `skills/send-email/SKILL.md`, `skills/send-email/scripts/send-email.ts`, `skills/lib/payload.ts`, `src/skills/email-handler.ts`, `src/skills/registry.ts`, `src/skill-api/server.ts`, `src/skills/types.ts`, `tests/skills/email-handler.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.75 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-destination-grants
- depends-on: email-submission-service
- depends-on: email-adapter
- code-conflict: email-submission-journal (src/skills/types.ts)
- code-conflict: email-forward-skill (skills/send-email/SKILL.md, skills/send-email/scripts/send-email.ts, src/skills/email-handler.ts)
- code-conflict: email-response-accounting (src/skill-api/server.ts)
- code-conflict: email-private-observability (src/skill-api/server.ts)
- code-conflict: email-tool-guidance (skills/send-email/SKILL.md)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
