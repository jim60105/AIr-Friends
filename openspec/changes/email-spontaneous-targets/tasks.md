# Tasks

Total estimate: **6.25 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-adapter`, `email-response-accounting`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [ ] 1.1 (1.5h) Implement eligible-target/new-thread selection and target-owned session context; verify privacy and default-off fixtures.
- [ ] 1.2 (1.5h) Persist tick identity and bind single send slot with allowlist recheck; verify restart/duplicate tick behavior and actual signed SMTP mail.
- [ ] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Use deterministic scheduler clock/RNG and temporary journal plus predecessor SMTP service. Protect existing Discord/Misskey spontaneous workspace/interval behavior.
- [ ] 1.4 (0.5h) Document platform plus per-account opt-in, new-thread delivery, restart outcomes and no grant inheritance. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [ ] 1.5 (0.75h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/spontaneous-posting/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
