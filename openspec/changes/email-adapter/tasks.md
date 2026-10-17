# Tasks

Total estimate: **7 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-message-history`, `email-local-attachments`, `email-submission-service`, `email-session-receipts`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [x] 1.1 (2h) Implement adapter history/identity/capabilities and lifecycle delegation; verify cross-owner channel and unsupported operation cases.
- [x] 1.2 (2h) Implement reply/file mail-service calls and metadata propagation; verify real threaded submission and existing file preflight limits.
- [x] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Use predecessor local services for threaded reply/file smoke and signed sent history. Run existing Discord/Misskey reply/file fixtures to protect unchanged behavior.
- [x] 1.4 (0.5h) Document capability table and correct submitted/unknown/file response wording without changing non-email guidance. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [x] 1.5 (0.5h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features. (Unused: no bounded integration defect required a fix in the owned interfaces/tests.)

## 2. Controlled integration smoke

- [x] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/platform-abstraction/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence. (Exercised layers: real mailbox poller, real mailbox/message/submission stores, real mail service and the real IMAP and SMTP protocol services over local TLS with a generated CA; the model, ACP session and a production mailbox are NOT exercised here.)

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.

## Carried-forward interface dependency (named, not deferred work in this change)

- The host side of `EmailSendContext` is populated by later rows in the same batch: `email-response-accounting` (sessions and the Skill API), `email-reminder-threads` and `email-spontaneous-targets` (their own lanes), and `email-activation` (final wiring). This change owns the consuming contract only: the typed context on `ReplyOptions`/`SendFileOptions`/`SkillContext`, the pass-through in `ReplyHandler`/`FileHandler`, the ordinary `reply`/`files` slot binding, and the refusal when the context is absent (fail closed, never a guessed recipient). Derivation for an inbound session: `workId` from the event's `emailWork` receipt and `owner` from the event's `mail:<owner>:<thread>` channel id.
- New-thread delivery for scheduled/spontaneous use is owned by `email-spontaneous-targets`; this change allocates the thread (`getDmChannelId`) and refuses an ordinary reply into a thread that has no stored source yet.
- Adapter lifecycle races fixed in review: a `disconnect()` that arrives while the first round is still running now stops the poller instead of leaving a repeating timer behind, and concurrent `connect()` calls share one start.
