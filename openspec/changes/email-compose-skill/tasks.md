# Tasks

Total estimate: **6.75 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-destination-grants`, `email-submission-service`, `email-adapter`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [ ] 1.1 (2h) Add script/request-file contract and payload rejection tests; verify subject/body/recipient shell content cannot bypass file containment.
- [ ] 1.2 (2h) Add JWT/fence-aware handler, registry wiring and immutable grant checks; verify real service composition with no per-send confirmation and correct signature.
- [ ] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Add script/API integration fixtures for pointer identity, expired JWT, missing grant, destination mutation, attachment preflight and one successful local SMTP compose; response-accounting activation remains gated.
- [ ] 1.4 (0.5h) Document send-email compose recipes with literal staging paths and submitted/unknown results; generic send-reply remains destination-free. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [ ] 1.5 (0.25h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-outbound-composition/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
