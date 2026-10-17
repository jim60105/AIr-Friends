# Tasks

Total estimate: **7 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-incoming-auth`, `email-session-receipts`, `email-intent-runtime`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [ ] 1.1 (1.5h) Implement strict interpreter prompt/schema through EmailIntentRuntime and recipient/source validation; verify output cannot grant an address absent from current authored text.
- [ ] 1.2 (2h) Implement strict decision validation, immutable grant binding and clarification path; verify quote-only, ambiguous and session-reuse cases.
- [ ] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Use deterministic connector fixtures for both OMP/OpenCode spawn shapes; exercise actual host JSON/grant validation and prove send parameters cannot invoke or update the producer. Model-proof authorization is explicitly excluded.
- [ ] 1.4 (0.5h) Document accepted model-judgment/prompt-injection residual risk and the preflight versus send-tool trust boundary. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [ ] 1.5 (1h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-destination-authorization/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
