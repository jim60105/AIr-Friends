# Tasks

Total estimate: **7 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-message-history`, `email-incoming-mime`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [x] 1.1 (2h) Add local attachment union and update every attachment URL consumer without network compatibility shims; verify existing network fixtures unchanged.
- [x] 1.2 (2h) Implement owner-checked materialization, prompt paths and local trigger image loading; verify files are usable through ACP roots and tmp cleanup preserves archives.
- [x] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Extend multimedia/context and workspace-tmp tests; add positive non-image local file read through current-session filesystem policy and negative cross-session/symlink cases.
- [x] 1.4 (0.5h) Update attachment contract and prompt guidance with literal session file paths, with no SSRF exceptions. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [x] 1.5 (0.5h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [x] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/multimedia-messages/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
