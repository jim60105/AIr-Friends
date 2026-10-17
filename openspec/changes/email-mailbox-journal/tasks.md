# Tasks

Total estimate: **6.5 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-durable-files`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [ ] 1.1 (2h) Implement mailbox identity, initialization and checkpoint replay; verify boundary and changed-fingerprint fixtures.
- [ ] 1.2 (2h) Implement entry transition guards and recoverable unstarted queue; verify every crash boundary and non-blocking terminal failure.
- [ ] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Add restart/reopen state-machine tests on real temporary files, including discovery-before-checkpoint and accepted-before-start failures.
- [ ] 1.4 (0.5h) Document cursor meaning and operator review-required records without adding an automatic replay command. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.

## 2. Controlled integration smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-mailbox-state/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
