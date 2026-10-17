# Tasks

Total estimate: **7 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-forward-skill`, `email-submission-service`, `email-session-receipts`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [ ] 1.1 (2h) Add email response state/result propagation without modifying user anchor roles; verify submitted third-party and file metadata cases.
- [ ] 1.2 (2h) Integrate durable lookup into every missing-response/recovery/quota rollback path; verify per-spawn/pool and autonomous flow uncertainty matrices.
- [ ] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Reuse real local SMTP loss/accept modes with API calls; assert DATA transaction count remains one after HTTP-loss, corrective-turn and crash recovery. Run existing Discord/Misskey response/partial-file regressions unchanged.
- [ ] 1.4 (0.5h) Update retry, file and compose guidance to distinguish accepted, failed and unknown; operator-visible state remains safe metadata only. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [ ] 1.5 (0.5h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/skills-and-reply/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
