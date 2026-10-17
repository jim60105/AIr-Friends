# Tasks

Total estimate: **6.5 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-config-identity`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [ ] 1.1 (2h) Implement durable append and atomic snapshots with per-root serialization; verify injected short-write, flush and rename failures.
- [ ] 1.2 (2h) Implement bounded JSONL replay/integrity checks and private file creation; verify torn-tail, interior corruption and symlink cases.
- [ ] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Use temporary directories and injected I/O boundaries; smoke reopen files after a writer subprocess exits at controlled crash points. No production mailbox is used.
- [ ] 1.4 (0.5h) Document filesystem durability assumptions, single-owner requirement and integrity diagnostics in the email operator documentation. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.

## 2. Controlled integration smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-durable-files/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
