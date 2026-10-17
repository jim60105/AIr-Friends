# Tasks

Total estimate: **6.5 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-mailbox-journal`, `email-poll-recovery`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [ ] 1.1 (2h) Propagate accepted workId/receipt through AgentCore queue and session setup; verify lease wait versus prompt-start ordering.
- [ ] 1.2 (1.5h) Record terminal lifecycle/side-effect outcomes on normal, error and dry-run paths; verify swallowed emission error cannot imply completion.
- [ ] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Extend session-orchestrator lifecycle fixtures with a real mailbox store and controlled connector seam; restart before/after lease acquisition and assert prompt call count.
- [ ] 1.4 (0.5h) Document receive uncertainty separately from SMTP uncertainty and show their shared workId/operator correlation. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [ ] 1.5 (0.5h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/session-lifecycle/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
