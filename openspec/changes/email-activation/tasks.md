# Tasks

Total estimate: **6.75 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-poll-recovery`, `email-submission-service`, `email-adapter`, `email-destination-grants`, `email-compose-skill`, `email-forward-skill`, `email-response-accounting`, `email-reminder-threads`, `email-spontaneous-targets`, `email-private-observability`, `email-platform-surfaces`, `email-tool-guidance`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [ ] 1.1 (1.5h) Wire real components and remove activation guard only after predecessor availability; verify startup ordering and enabled/disabled/email-only configuration.
- [ ] 1.2 (1.5h) Add bounded production-composition lifecycle test and consolidated acceptance manifest referencing predecessor tests; verify registration/status/shutdown with both local services.
- [ ] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Run one final implementation gate: deno fmt --check src/ tests/, deno lint src/ tests/, deno check src/main.ts and relevant email plus Discord/Misskey regressions. Integrated tests reuse predecessor fixtures and coverage; no new broad test framework or deferred safety implementation is hidden here.
- [ ] 1.4 (0.5h) Finalize deployment instructions, receiving trust checklist, 300s latency caveat, backup/privacy warning and CHANGELOG entry; document every acceptance row links to its already-owned test. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [ ] 1.5 (1.25h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-platform-activation/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
