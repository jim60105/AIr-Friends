# Tasks

## 1. Replace both bounded eligibility checks

- [ ] 1.1 Replace orchestrator email reminder recent-window preflight with fail-closed durable fetchMessage lookup scoped to the persisted owner/thread/record; remove the obsolete anchor-window constant and expiry comments without changing other platforms.
- [ ] 1.2 Resolve explicit adapter reply anchors directly through EmailMessageStore.get before any recent-history dependency; retain exact wire anchor, implicit latest-anchor behavior and spontaneous-send separation.
- [ ] 1.3 Resolve original inbound-anchor recipients from that verified durable sender; preserve outbound explicit-anchor support through durable same-owner-thread inbound metadata lookup without a finite eligibility window. Retain owner normalization, current allowlist and refusal for unusable identifiers/senders.

## 2. Durable behavior regressions

- [ ] 2.1 Extend tests/core/email-reminder-threads.test.ts and tests/platforms/email/email-adapter.test.ts with a file-backed original plus 200 newer records, reopen stores, and exercise preflight through explicit adapter resolution and controlled submission to the original verified sender/thread.
- [ ] 2.2 Cover an all-outbound recent suffix, outbound explicit anchor, implicit latest behavior, and unchanged bounded prompt history; assert no substitute anchor or new thread.
- [ ] 2.3 Cover missing/corrupt/cross-owner/cross-thread anchors, missing wire IDs and revoked allowlist with no SMTP; retain review-required disabled state without automatic revival.
- [ ] 2.4 Assert stable reminder operation IDs and no resubmission for submitted/unknown/submitting evidence across ticks and restart, including reminder completion-patch failure.

## 3. Reconcile contract and verify

- [ ] 3.1 Replace docs/email-platform.md bounded-scan and aged-out-expiry paragraphs with retained durable-origin resolution and actual unavailable-origin refusal; align related API comments with the original design and delta specs.
- [ ] 3.2 During apply, run repository formatting, lint/type checks and focused reminder/adapter/submission regressions, record results and validate this change strictly. No implementation checks run during proposal creation.
