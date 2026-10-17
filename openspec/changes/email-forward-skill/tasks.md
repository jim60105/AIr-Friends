# Tasks

Total estimate: **6.75 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-compose-skill`, `email-message-history`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [x] 1.1 (2h) Implement owner-bound source resolution and all-or-nothing combined attachment preflight; verify forged source IDs and unavailable files.
- [x] 1.2 (1.5h) Add forward MIME source inclusion and shared signature ordering; verify original bytes/attachments and complete local SMTP forwarding.
- [x] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Use actual parsed MIME fixtures with original signatures, attachment-only source and hostile filenames; compare SMTP-captured original source and decoded attachments byte-for-byte.
- [x] 1.4 (0.5h) Document designated-source behavior, attachment accounting and clarification for ambiguous source selection. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [x] 1.5 (0.75h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

Contingency used, not unused: the pre-implementation review found three bounded defects inside this
responsibility's own interfaces, all fixed in the owned handler/tests. (1) The forwarded set now
proves the ACTUAL archived lengths (`sourceBytes.byteLength === record.rawSize` and every
attachment's length against its recorded size) before submission, so an archive file that grew,
shrank or was replaced cannot pass a metadata-only preflight. (2) Every source read is inside one
content-free `SKILL_EMAIL_FORWARD_SOURCE` boundary, so a throwing or missing store and an unreadable
archive produce the incomplete-source result instead of an escaped exception. (3) The documented
idempotency contract is the durable one: changed commentary under the same grant returns the
RECORDED result (`reused: true`, zero new SMTP transactions) and the result text says that the new
commentary was not sent — no second slot is invented. No new feature was added.

## 2. Controlled integration smoke

- [x] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-forwarding/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Exercised layers: `tests/skills/email-forward.test.ts` (real handler + real owner-scoped
`EmailMessageStore` + real `EmailMailService`/`SubmissionStore`/`OutgoingMimeBuilder`, scripted
SMTP/IMAP doubles at the transport boundary) and `tests/skills/email-forward-smoke.test.ts` (the
same boundary with a real `EmailSmtpClient` over a real TLS socket to the local in-process SMTP
fixture). No provider, credential, production mailbox, ACP session or model judgment is claimed:
the model-side designation of a source and the host grant producer belong to their own rows.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.
