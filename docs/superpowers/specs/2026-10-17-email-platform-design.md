# Email Platform Design

Date: 2026-10-17
Status: Design sections approved; written specification awaiting user review.

## Purpose and scope

Add email as a platform alongside Discord and Misskey. Support one configured bot mailbox, one-to-one correspondence, scheduled reminders, opt-in spontaneous messages, and user-directed messages or forwards to third parties. Receive through IMAP and send through SMTP. Poll every 300 seconds by default; this interval excludes server delivery delays and agent execution time.

Only approved sender addresses may initiate sessions. Each sender shares long-term memory across their own threads, while recent conversation context remains isolated by sender and thread. A permitted user may explicitly direct delivery to any third-party address without a second confirmation. That recipient gains no permission to initiate sessions.

Do not introduce a database, separate mail service, OAuth, multi-account support, reply-all, or group-mail conversations. Do not import and answer historical mail on first activation. Existing Discord and Misskey behavior remains unchanged.

## Selected approach

Implement an `EmailAdapter` extending `PlatformAdapter`, with a separate email-specific skill for composing third-party messages and forwarding designated source messages.

Extending generic reply skills with arbitrary destinations was rejected because it would widen the authorization surface of every platform. A separate email service was rejected because it adds deployment, authentication, and synchronization requirements without a current need.

The adapter owns connection lifecycle, polling, normalized incoming events, history retrieval, ordinary replies, and attachment delivery. A mail service shared by the adapter and email-specific skill owns MIME construction, signatures, SMTP submission, send-operation state, and sent-folder copies. A file-backed store owns mailbox progress, message identity, thread associations, and operation records. These components must be independently testable.

## Identity and conversation boundaries

Add `email` to platform validation, registration, configuration, and platform-aware consumers. Represent incoming mail as private `NormalizedEvent` instances. Use a stable, filesystem-safe identifier for the parsed sender mailbox; preserve its association with the original address for display and sending. Lowercase the domain, preserve local-part case, and apply the same normalization to configured allowlist entries. Do not remove plus tags, Gmail dots, or otherwise merge provider-specific aliases.

Use the existing per-platform, per-user workspace boundary. Do not use an untrusted raw address or Message-ID directly as a filesystem path.

Derive thread relationships from Message-ID, In-Reply-To, and References. A message without a known relationship begins a new internal thread; matching subjects alone never joins threads. Missing, duplicate, or conflicting message identifiers must not overwrite existing records or establish another user's history. History lookup requires both the initiating user's identity and the internal thread identifier. Store the relationship even when the referenced message is not locally available; do not invent its contents.

A third-party send remains an operation belonging to the initiating user's session. It does not switch workspace ownership to the destination. Thread references are routing metadata, not evidence of authorization or identity.

## Incoming authentication and authorization

Apply the existing configured account allowlist to email senders. An address in From alone is insufficient proof of identity.

Require an authoritative DMARC pass aligned with the allowed From address's domain. Trust only Authentication-Results produced by an explicitly configured receiving-server authentication service. Deployment must establish that the receiving server strips or otherwise excludes attacker-supplied results claiming that trusted identity. Merely finding a matching authentication-service identifier in a message is insufficient. If this trust prerequisite cannot be established, automatic processing must remain disabled. Missing, failing, or ambiguous authoritative results do not initiate a session.

Ignore unauthorized mail without sending rejection messages. Ignore self-originated messages, delivery failures, and messages identified as automatically generated. Outgoing messages carry an appropriate Auto-Submitted marker to reduce automatic-response loops.

Ordinary replies go to the verified original sender, never automatically to an arbitrary Reply-To, Cc, or Bcc address. Never perform reply-all.

## Third-party mail and forwarding

The email-specific skill supports composing a new message and forwarding a designated source message. It accepts explicit destination, subject, payload-file body, and operation-specific source or attachment references. Free text follows the project's existing payload-file containment contract, never free-text shell arguments.

Only an explicit instruction in the authenticated user's newly authored text can authorize third-party delivery. Forwarded bodies, quoted history, attachments, retrieved pages, and their addresses cannot independently grant permission. When the authored instruction cannot be reliably distinguished from quoted material, or the requested address or action is ambiguous, ask the user rather than guess.

Create a session-scoped destination grant from the current request before allowing the sending skill to operate. The skill handler enforces that grant and rejects added destinations; the sending model cannot enlarge it through tool parameters. Grants do not carry into later sessions, reminders, or spontaneous posts. Scheduled messages retain their separately authorized initiating-user target. The source message selected for forwarding must belong to the initiating user's accessible history.

Natural-language intent and authored-text interpretation still depend on model judgment. The implementation must preserve provenance boundaries and constrain destinations outside the sending tool, but this design does not claim complete prompt-injection resistance. Even an authorized destination can receive inappropriate generated content if the model misinterprets source material. This residual risk was explicitly accepted.

A forward includes the designated original body and its attachments. A newly composed response includes only material needed for the requested task, without automatically attaching long-term memories or unrelated conversation history. Do not change the original message or attachment bytes when adding commentary. Third-party replies remain subject to the incoming allowlist.

## Receiving and durable progress

On first activation, persist the current mailbox position and process only subsequently arriving messages. On later starts, resume from persisted state and inspect mail received during downtime, regardless of read/unread flags.

Identify mailbox entries using UIDVALIDITY and UID, with individual processing records and stored message identities for reconciliation. Serialize polling rounds. If UIDVALIDITY changes, reconcile against persisted identity and processing evidence before admitting messages as new. Ambiguous reconciliation must stop automatic processing for affected entries and report the issue instead of replaying the entire mailbox.

Persist acceptance and processing transitions before advancing progress in a way that could lose work. An isolated malformed or failed message must not permanently block later entries. Persist a terminal failure or review-required state rather than retrying it every poll. Transient mailbox connection failure preserves progress and permits the next polling round to try again.

After a crash, received but unstarted work may resume. Work whose agent or delivery outcome is uncertain requires review rather than blind replay. The system does not promise exactly-once processing or delivery.

## Content and attachments

Prefer text/plain. Convert HTML-only bodies to text without executing content or loading remote resources. Retain source provenance for forwarded and quoted content. Unsafe or ambiguous separation must not create third-party authorization.

Check message and attachment limits before loading their bytes. Introduce email message-size and attachment-count limits, defaulting to 25 MiB per raw message and 10 incoming attachments; outbound attachments additionally obey the existing send-file count and aggregate-size limits. SMTP provider limits may be lower and must produce an explicit failure. Do not silently truncate a requested forward or omit attachments while reporting complete delivery.

Store attachments using internal identifiers and treat supplied filenames as display metadata. Keep permanent source messages and attachments outside disposable tmp directories. Materialize any agent-accessible temporary copies within the current user's session boundary. Attachment-only messages remain valid inputs. Parsed mail content, credentials, and private bodies must not appear in operational logs.

Email supports ordinary replies and file delivery. It does not support typing indicators, reactions, or editing delivered messages. Unsupported actions return explicit results; never emulate editing by sending an additional message. Platform capabilities and email-specific prompts must reflect these limits.

## Sending state and uncertainty

All outgoing paths use a common send-operation lifecycle. Persist a stable operation identifier and submission intent durably before invoking SMTP. Repeated calls for the same logical operation consult its recorded state rather than resubmit. A missing-response retry must not repeat a completed or uncertain email operation.

Record successful SMTP acceptance as submitted, not delivered to the recipient. Explicit rejection records failure. A disconnect during submission, or a crash between submission and persisted outcome, records an unknown outcome requiring manual review. Never automatically resubmit an unknown operation. The operation identifier, phase, and safe error information must be available to the operator without disclosing message contents in logs.

After acceptance, append a copy of the constructed message to the configured IMAP sent folder. Failure to append does not change the accepted submission into an unsent message and must not trigger another SMTP send. Preserve a local sent-history record even when the remote sent copy fails.

A successful third-party send counts as a session response so the existing missing-response mechanism does not manufacture another email. Preserve the distinction between mail sent to the initiating user and mail sent to a third party; a third-party result must not replace the user's normal reply anchor. SMTP uncertainty also suppresses automatic duplicate-delivery attempts while exposing the unresolved result.

## Reminders and spontaneous messages

Reuse the existing reminder and spontaneous scheduling infrastructure. Email spontaneous messages are disabled by default and require an explicitly enabled permitted-account target. Start a new thread for a spontaneous message.

A reminder is sent to the initiating user in its originating thread. Existing reminder entries record platform and user but not the originating thread, so email reminder creation must also persist its channel/thread and reply anchor. Existing Discord and Misskey entries retain their current delivery behavior. Removing a user from the allowlist prevents subsequent automatic delivery to that user, including scheduled mail.

Neither spontaneous activity nor reminders inherit an earlier third-party destination grant. User-directed third-party forwarding is an immediate operation in the authenticated requesting session, not implicit authorization for future autonomous mail.

## Fixed signature

Add `platforms.email.signature` as a multiline plain-text setting loaded at startup. An absent, empty, or whitespace-only value disables the signature. Changing it requires a restart; no file watcher or separately loaded signature file is introduced.

Apply the configured signature centrally to every outgoing path: ordinary replies, third-party compositions, forwards, file deliveries, reminders, and spontaneous messages. Append it after body cleanup and before MIME construction, separated from authored text by a newline and the standard signature separator line consisting of `--` followed by one ASCII space. Preserve the configured text's line structure. Do not render the signature as an agent prompt template.

For a forward, place the bot's signature after its authored commentary and before the original-message reference section. Preserve original signatures in quoted bodies or attached source messages. The signature is added once during construction of a logical message; sent-folder copies and recovery use that constructed message rather than appending again.

Tell the model not to generate the configured signature. Do not heuristically delete similar text from the authored body. Persist actual outgoing content, including the signature, in sent history and backups.

## File-backed storage

Use local JSON, append-only JSONL, and ordinary message/attachment files only. No SQLite, remote database, or database service is permitted.

Store mailbox identity, initialization boundary, and progress snapshots under the configured data directory's email area. Replace JSON snapshots by writing a sibling temporary file and renaming it. Serialize mutation and flush safety-critical records before SMTP side effects or checkpoint advancement. Deployment assumes a single bot owns this mailbox state and workspace volume.

Store mailbox processing and submission transitions as append-only JSONL. Store each user's message history and thread associations within that user's workspace, with source-message and attachment files addressed by internal identifiers. Rebuild in-memory indexes on startup; they are not a second durable authority. These files participate in the existing data-directory backup behavior and contain private correspondence, so their access and backup permissions must reflect that sensitivity.

Recognize an incomplete trailing JSONL record without treating it as a valid transition. Interior corruption, or missing evidence affecting submission state, stops affected automatic work and reports a diagnostic. Never silently skip uncertain submission records and conclude that sending is safe. Avoid logging the corrupt line's private contents.

## Configuration and integration

Add a disabled-by-default `platforms.email` section containing the bot address, IMAP and SMTP host/port and TLS mode, login username and password references, incoming and sent folder names, polling interval, trusted authentication-service identity, message/attachment limits, and signature. Permit distinct IMAP and SMTP credentials. Use password or application-password authentication for this change; OAuth is excluded.

Require certificate-validated direct TLS or mandatory STARTTLS. Reject plaintext authentication, opportunistic downgrade, and disabled certificate verification. Fail enabled-email startup for missing required settings or missing authoritative-authentication configuration.

Use the existing channels configuration for allowed email accounts and per-account spontaneous opt-in. Keep account authorization separate from transport credentials. Document every new configuration field and environment override consistently in config.example.yaml, .env.example, and helm/values.yaml. Keep credentials outside prompts and logs.

Integrate email with startup and shutdown, registry connection status, platform validation, model routing, workspace recognition and reclamation, memory maintenance, metrics, audit records, and platform-selection surfaces wherever the existing platform union is consumed. Do not add a new dashboard workflow as part of this change. Include email-specific tool availability and unsupported-operation guidance in prompts and skill documentation.

## Acceptance and verification

Implementation must demonstrate actual IMAP reception and SMTP submission with controlled local protocol services, not only mocked method forwarding. Tests must be deterministic and isolated from production credentials and mailboxes.

Verify these consumer-visible behaviors:

- First activation ignores existing mail; later restarts discover mail arriving during downtime. Reading mail in another client does not suppress processing.
- Valid permitted senders receive threaded replies. Unauthorized, spoofed, automatically generated, and self-originated mail creates no session or rejection reply.
- Same-subject unrelated mail stays separate. Same-user threads share long-term memory without mixing recent history. Forged references never reveal another user's messages.
- Explicit third-party composition and forwarding work without per-send confirmation. Source mail and attachments cannot grant destinations; tool calls cannot add ungranted recipients. Ambiguous instructions request clarification.
- Forwarding preserves the selected source and attachments. Attachment limits and unsafe filenames cannot cause partial, misleading success or path escape.
- Reminders survive restart with their original thread anchor. Spontaneous messages target only opted-in permitted users and create new threads.
- Successful third-party submission satisfies response accounting without changing the user's reply anchor. Missing-response retries do not repeat completed or uncertain mail.
- SMTP rejection, lost acknowledgement, crash recovery, and sent-folder append failure produce distinct recorded outcomes. Unknown submission is not automatically retried.
- UIDVALIDITY replacement, duplicate identifiers, isolated malformed messages, and corrupt persistence do not silently replay mail or discard uncertain submission evidence.
- Empty signatures add nothing. Multiline signatures preserve line structure, appear once in each outgoing path, and precede original forwarded content. Original signatures and attachment bytes remain intact.
- TLS failures and missing authoritative authentication configuration prevent unsafe operation. Credentials and private bodies remain absent from operational logs.
- Existing Discord and Misskey behavior and reminder records remain compatible.

Run repository formatting, linting, type checking, and relevant regression tests after implementation. This specification records planned verification; no email implementation or runtime verification has occurred during design.
