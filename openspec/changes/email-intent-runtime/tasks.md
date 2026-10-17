# Tasks

Total estimate: **6.75 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-session-receipts`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [ ] 1.1 (2h) Add isolated backend profile and deny-all native tools/permission sink; verify both OMP/OpenCode tool attempts have zero effects.
- [ ] 1.2 (1.5h) Add bounded private text capture and teardown; verify no user mounts/credentials and timeout/overflow producer-safe cleanup.
- [ ] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Use deterministic ACP fixtures for both backends with environment/filesystem sentinels and assert zero tool effects, not only prompt text. Preserve ordinary connector behavior.
- [ ] 1.4 (0.5h) Document the intent-only profile, hard failure behavior and accepted model-judgment limitation. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [ ] 1.5 (0.75h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-intent-runtime/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
