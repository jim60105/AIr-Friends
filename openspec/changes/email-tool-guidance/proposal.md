# Proposal

## Why

Email-aware prompt and tool availability supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Render email context explicitly in message/reminder/spontaneous prompts without signature text or credentials. Expose send-email only for authenticated email user-triggered sessions with immutable grants; backend rejects calls when it is hidden. No edit/reaction guidance for email and no typing claims. Model is told signature is centrally managed, source/reference content cannot grant recipients and unknown SMTP means stop and report review. Keep payload recipes literal-path and subject/body inside request file.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-tool-guidance`: Email-aware prompt and tool availability behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `prompts`, `skills/send-email/SKILL.md`, `skills/send-reply/SKILL.md`, `skills/send-file/SKILL.md`, `src/core/session-orchestrator.ts`, `src/acp/skill-inventory.ts`, `tests/core/prompt-permission-guidance.test.ts`, `tests/core/skill-root-wiring.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.25 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-forward-skill
- depends-on: email-response-accounting
- depends-on: email-reminder-threads
- depends-on: email-spontaneous-targets
- code-conflict: email-local-attachments (src/core/session-orchestrator.ts)
- code-conflict: email-session-receipts (src/core/session-orchestrator.ts)
- code-conflict: email-destination-grants (src/core/session-orchestrator.ts)
- code-conflict: email-compose-skill (skills/send-email/SKILL.md)
- code-conflict: email-forward-skill (skills/send-email/SKILL.md)
- code-conflict: email-response-accounting (src/core/session-orchestrator.ts)
- code-conflict: email-reminder-threads (src/core/session-orchestrator.ts)
- code-conflict: email-spontaneous-targets (src/core/session-orchestrator.ts)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
