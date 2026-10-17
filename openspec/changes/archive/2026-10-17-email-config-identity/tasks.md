# Tasks

Total estimate: **6.75 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: none. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [x] 1.1 (2h) Implement canonical mailbox parsing, safe identifiers and channel/account normalization; verify case, alias, invalid/multiple address and path-character fixtures. Include a literal multiline signature containing `${DISCORD_TOKEN}` with that environment variable set, proving expansion is excluded.
- [x] 1.2 (2h) Add typed defaults, conditional enabled-platform validation, startup guard and ENV_MAPPINGS; verify disabled legacy configurations and unsafe TLS rejection.
- [x] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Extend tests/core/config-loader.test.ts and tests/utils/env.test.ts; add table-driven email field parity tests using tests/utils/config-trio-sync.test.ts patterns. Include literal multiline signature containing ${...} that MUST NOT undergo generic environment expansion.
- [x] 1.4 (0.5h) Update the config trio with the exact table in the batch index, trust prerequisite and restart-only literal signature semantics. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [x] 1.5 (0.25h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [x] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-identity/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
