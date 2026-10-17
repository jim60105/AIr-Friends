# Proposal

## Why

Shared MIME construction and literal signatures supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Use npm:nodemailer@^7 MailComposer for RFC 5322 construction, with explicit envelope one recipient and no caller-controlled Cc/Bcc headers. Take cleaned authored body once; central builder adds newline + "-- " + newline + literal signature unless whitespace-only. Normalize wire line endings without changing logical line structure. Forward commentary/signature precedes a labeled original section; original source bytes/attachments are untouched. Auto-Submitted is auto-generated.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-message-construction`: Shared MIME construction and literal signatures behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/platforms/email/outgoing-mime.ts`, `deno.json`, `deno.lock`, `tests/platforms/email/outgoing-mime.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.5 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-config-identity
- depends-on: email-message-history
- depends-on: email-submission-journal
- depends-on: email-incoming-mime
- code-conflict: email-incoming-mime (deno.json, deno.lock)
- code-conflict: email-imap-transport (deno.json, deno.lock)
- code-conflict: email-smtp-transport (deno.json, deno.lock)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
