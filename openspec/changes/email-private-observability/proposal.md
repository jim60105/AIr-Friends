# Proposal

## Why

Private email audit and operational outcomes supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Sanitize malformed email reminder replay before session creation using trusted workspace identity; never log record excerpts or parser exception contents.
- For email context enforce metadata-only operational/audit serialization regardless of general hashContent setting. Add contextual sensitivity propagation to ACP client and session logger; suppress raw headers, prompt/body chunks, tool parameters/output, credentials, file names and exception strings from email execution, including preflight. Map protocol/provider errors to safe enum codes. Preserve actual full private sent/source content only in archive/backup with private permissions.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-audit-log`: add scoped email behavior.

## Impact

Target files and existing consumers: `src/types/audit.ts`, `src/core/audit-logger.ts`, `src/utils/logger.ts`, `src/acp/client.ts`, `src/skill-api/server.ts`, `src/skills/file-handler.ts`, `tests/types/audit.test.ts`, `tests/core/email-privacy.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.75 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- code-conflict: email-reminder-threads (src/core/reminder-store.ts)
- depends-on: email-response-accounting
- code-conflict: email-adapter (src/skills/file-handler.ts)
- code-conflict: email-intent-runtime (src/acp/client.ts)
- code-conflict: email-compose-skill (src/skill-api/server.ts)
- code-conflict: email-response-accounting (src/skill-api/server.ts, src/skills/file-handler.ts)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
