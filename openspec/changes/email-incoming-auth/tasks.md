# Tasks

Total estimate: **6.5 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-config-identity`, `email-incoming-mime`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [x] 1.1 (2h) Implement authoritative result/allowlist checks and reason codes; verify forged, duplicate, alignment and local-part case fixtures.
- [x] 1.2 (1.5h) Implement auto-mail/self/DSN filtering and reply destination binding; verify no reply side effects for rejected fixtures.
- [x] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Use independently constructed trusted/untrusted raw header sets and run all/public/channels policy matrix. Include deployment documentation fixture requiring explicit header-exclusion attestation.
- [x] 1.4 (0.5h) Document receiving-MTA stripping configuration and controlled spoof injection procedure; describe DMARC domain-only limitation and accepted residual risk. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [x] 1.5 (0.5h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [x] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-incoming-authentication/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
