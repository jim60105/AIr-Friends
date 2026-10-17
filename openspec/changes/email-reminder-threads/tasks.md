# Tasks

Total estimate: **7 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-adapter`, `email-response-accounting`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [x] 1.1 (2h) Add origin record capture/replay and owner-bound delivery resolution; verify restart thread anchor and legacy Discord/Misskey records.
- [x] 1.2 (2h) Add allowlist recheck and durable reminder-slot recovery; verify unknown, patch failure and signature-once with local SMTP.
- [x] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Extend existing reminder fixtures and actual temporary ReminderStore replay; use controlled local service to inspect In-Reply-To/References after restart and prove no old grant inheritance.
- [x] 1.4 (0.5h) Document email origin fields, missing-origin review and removed-account behavior without a data migration. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [x] 1.5 (0.5h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [x] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/scheduled-reminders/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
