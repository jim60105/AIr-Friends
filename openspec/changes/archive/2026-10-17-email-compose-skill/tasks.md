# Tasks

Total estimate: **6.75 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-destination-grants`, `email-submission-service`, `email-adapter`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [x] 1.1 (2h) Add script/request-file contract and payload rejection tests; verify subject/body/recipient shell content cannot bypass file containment.
- [x] 1.2 (2h) Add JWT/fence-aware handler, registry wiring and immutable grant checks; verify real service composition with no per-send confirmation and correct signature.
- [x] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Add script/API integration fixtures for pointer identity, expired JWT, missing grant, destination mutation, attachment preflight and one successful local SMTP compose; response-accounting activation remains gated.
- [x] 1.4 (0.5h) Document send-email compose recipes with literal staging paths and submitted/unknown results; generic send-reply remains destination-free. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [x] 1.5 (0.25h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

Contingency used, not unused: review of the first draft found two bounded defects inside this
responsibility — the script read its payload under the CLI `--session-id` instead of the invocation's
owning session (a sibling session's staged request could be read and deleted), and the generic
`skill_call` audit would have recorded the recipient, subject and body verbatim. Both are fixed in
the owned interfaces/tests (`skills/send-email/scripts/send-email.ts`,
`emailComposeAuditParams`), with `SKILL_SESSION_MISMATCH`/owning-session binding tests and a
content-safe audit-projection test. No new feature was added.

## 2. Controlled integration smoke

- [x] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-outbound-composition/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

`tests/skills/email-compose-smoke.test.ts` exercises the real handler, real `EmailMailService`/
`SubmissionStore`/`EmailMessageStore`/`OutgoingMimeBuilder` and the real `EmailSmtpClient` over a
real TLS socket to the local SMTP fixture in isolated temporary state: one composed third-party
message reaches the peer with exactly one DATA transaction, the granted recipient as the only
envelope target, the centrally applied signature exactly once, and the explicitly selected
attachment; a peer that rejects the final response yields the `failed` phase with no second
transaction and no sent-folder copy. The configuration enables ONLY the session's own sender, so
the granted destination is absent from channels: its compose is submitted once while
`isSenderAllowed` keeps reporting that address as denied (`tests/skills/email-handler.test.ts`,
real `EmailMailService`), and a compose without attachments on that same real service attaches no
workspace memory or history (a memory sentinel is absent from the emitted MIME). The sent-folder
copy uses a scripted IMAP double (owned by `email-submission-service`). No provider, credential,
production mailbox or model judgment is exercised.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
