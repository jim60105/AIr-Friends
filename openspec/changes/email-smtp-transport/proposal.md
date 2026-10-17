# Proposal

## Why

Certificate-validated SMTP submission supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Use npm:nodemailer@^7 SMTP transport with secure direct TLS or requireTLS mandatory STARTTLS, rejectUnauthorized=true, no library debug/logger and one explicit envelope recipient. Set connection/greeting/socket timeouts to 30s. Disable application retries and record conservative unknown when a connection fails once DATA submission may have begun. Explicit final 5xx/4xx rejection is failed; accepted requires positive final DATA response.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-smtp-transport`: Certificate-validated SMTP submission behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/platforms/email/smtp-client.ts`, `deno.json`, `deno.lock`, `tests/platforms/email/smtp-client.test.ts`, `tests/helpers/email-smtp-service.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.75 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-config-identity
- code-conflict: email-incoming-mime (deno.json, deno.lock)
- code-conflict: email-imap-transport (deno.json, deno.lock)
- code-conflict: email-mime-signature (deno.json, deno.lock)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
