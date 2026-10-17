# Tasks

Total estimate: **6.75 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-response-accounting`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [ ] 1.1 (2h) Add email-sensitive audit/log propagation and explicit safe operation events; verify all hashContent modes and protocol/agent failure fixtures.
- [ ] 1.2 (1.5h) Suppress existing ACP/API/file and pre-session ReminderStore replay content leaks for email contexts; derive replay sensitivity from trusted workspace identity. Verify malformed due-reminder enumeration plus start/preflight/send/recovery/dry-run logs contain no private sentinel or content-bearing parser exception.
- [ ] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Capture structured logger and audit output using sentinel address, subject, password, quoted body and filename. Assert absence in success and every failure branch and maintain non-email audit regressions.
- [ ] 1.4 (0.5h) Document private archive versus metadata-only audit, file access/backup sensitivity and manual review using operation IDs. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [ ] 1.5 (0.75h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/session-audit-log/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
