# Proposal

## Why

Bounded MIME parsing and provenance supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Use npm:mailparser@^3 behind a bounded source reader and npm:html-to-text@^9 with no network renderer; use parser streaming attachment events to count/abort before accumulating attachment bytes. Raw size is checked from IMAP metadata and enforced during stream consumption. Prefer text/plain; HTML-only becomes inert text. Preserve complete original body separately. Conservatively identify authored text with quote/forward markers; uncertain separations set authored status ambiguous.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-incoming-content`: Bounded MIME parsing and provenance behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/platforms/email/incoming-mime.ts`, `deno.json`, `deno.lock`, `tests/platforms/email/incoming-mime.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **7 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-message-history
- code-conflict: email-imap-transport (deno.json, deno.lock)
- code-conflict: email-mime-signature (deno.json, deno.lock)
- code-conflict: email-smtp-transport (deno.json, deno.lock)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
