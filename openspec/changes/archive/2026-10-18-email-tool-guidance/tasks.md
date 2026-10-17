# Tasks

Total estimate: **6.25 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-forward-skill`, `email-response-accounting`, `email-reminder-threads`, `email-spontaneous-targets`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [x] 1.1 (1.5h) Add platform-aware prompt fragments and trusted inventory gating; verify snapshot/contract tests across backend/spawn shapes.
- [x] 1.2 (1.5h) Update bundled skill and retry/result guidance for signature, payloads and SMTP uncertainty; verify no extra-response wording in email paths.
- [x] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Use existing prompt/skill-root fixtures, compare non-email renderings and verify backend denial persists when unsupported scripts are called manually, including an email no-response corrective turn with no reaction guidance.
- [x] 1.4 (0.5h) Update skills usage examples and mounted-prompt restart/deployment instructions, with no model-proof authorization claim. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [x] 1.5 (0.75h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [x] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-tool-guidance/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
