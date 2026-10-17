# Tasks

Total estimate: **6.5 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-config-identity`, `email-message-history`, `email-submission-journal`, `email-incoming-mime`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [x] 1.1 (2h) Implement one MIME builder with explicit envelope, references and Auto-Submitted marker; verify parsed round-trip headers and bytes.
- [x] 1.2 (1.5h) Implement central literal signature and forward body ordering; verify disabled/multiline/recovery cases without heuristic body deletions.
- [x] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Use actual MailComposer output parsed with predecessor MIME parser; test plain reply, compose, forward and file draft kinds plus original-byte equality. Caller-path signature coverage is repeated by each integrating change.
- [x] 1.4 (0.5h) Document restart-only signature changes, tell prompts never to generate it, and retain actual signed outgoing history content. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [x] 1.5 (0.5h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features. Unused: no bounded integration defects were found after the initial slice checks.

## 2. Controlled integration smoke

- [x] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-message-construction/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence. Exercised: `OutgoingMimeBuilder` + real `SubmissionStore` + real `EmailMessageStore` + `parseIncomingMime` in a temp file-backed root; zero external SMTP calls. No transport layer is implemented by this slice.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
