# Tasks

Total estimate: **7 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-submission-journal`, `email-mime-signature`, `email-smtp-transport`, `email-imap-transport`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [ ] 1.1 (2h) Implement construction/reservation/submission transaction with durable ordering; verify crash injection before and after every SMTP boundary.
- [ ] 1.2 (2h) Implement local sent-history and IMAP-copy recovery using stored MIME only; verify append/history failures preserve acceptance and signature-once.
- [ ] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Reuse both local protocol fixtures for one real IMAP+SMTP smoke plus file-backed restart tests; assert bytes captured by SMTP, local history and APPEND are identical.
- [ ] 1.4 (0.5h) Document safe operation inspection, separate sent-copy error and manual review of unknown state. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [ ] 1.5 (0.5h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-submission/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
