# Email Platform Architecture & Operation

## Configuration & Identity (Owned by `email-config-identity`)

The email platform integrates alongside Discord and Misskey with the following characteristics:

### Identity & Normalization

- Canonical email mailbox normalization is performed by `normalizeEmailMailbox(address)`.
- **Domain**: lowercased and converted to IDNA / Punycode format.
- **Local-part**: preserves case, dots, plus-tags (`+tag`), and provider aliases distinctly.
- **User ID**: generated as `e_` + SHA-256 hex digest of the canonical UTF-8 addr-spec string (`e_<sha256>`). Raw email addresses are never used directly as workspace or filesystem directory components.
- **Channel Account entries**: configured as `email/account/<canonical-address>` and normalized at load time to `email/account/<userId>`.

### Configuration Contract & Deployment Trio

All email settings default to disabled and are exposed across the configuration trio (`config.example.yaml`, `.env.example`, and `helm/values.yaml`):

| `platforms.email` field                   | Environment override                          | Default / Validation                           |
| ----------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| `enabled`                                 | `EMAIL_ENABLED`                               | `false`                                        |
| `address`                                 | `EMAIL_ADDRESS`                               | required when enabled                          |
| `imap.host`                               | `EMAIL_IMAP_HOST`                             | required when enabled                          |
| `imap.port`                               | `EMAIL_IMAP_PORT`                             | 993 (tls), 143 (starttls)                      |
| `imap.tlsMode`                            | `EMAIL_IMAP_TLS_MODE`                         | tls; tls or starttls only (plaintext rejected) |
| `imap.username`                           | `EMAIL_IMAP_USERNAME`                         | required when enabled                          |
| `imap.password`                           | `EMAIL_IMAP_PASSWORD`                         | required credential reference                  |
| `smtp.host`                               | `EMAIL_SMTP_HOST`                             | required when enabled                          |
| `smtp.port`                               | `EMAIL_SMTP_PORT`                             | 465 (tls), 587 (starttls)                      |
| `smtp.tlsMode`                            | `EMAIL_SMTP_TLS_MODE`                         | tls; tls or starttls only (plaintext rejected) |
| `smtp.username`                           | `EMAIL_SMTP_USERNAME`                         | required when enabled                          |
| `smtp.password`                           | `EMAIL_SMTP_PASSWORD`                         | required distinct credential reference         |
| `incomingFolder`                          | `EMAIL_INCOMING_FOLDER`                       | `INBOX`                                        |
| `sentFolder`                              | `EMAIL_SENT_FOLDER`                           | `Sent`                                         |
| `pollIntervalMs`                          | `EMAIL_POLL_INTERVAL_MS`                      | `300000` (5 minutes)                           |
| `receivingAuth.authservId`                | `EMAIL_AUTHSERV_ID`                           | required trusted receiver identity             |
| `receivingAuth.attestedStripping`         | `EMAIL_AUTH_HEADER_STRIPPING_ATTESTED`        | `false`; required `true` when enabled          |
| `maxMessageBytes`                         | `EMAIL_MAX_MESSAGE_BYTES`                     | `26214400` (25 MiB)                            |
| `maxIncomingAttachments`                  | `EMAIL_MAX_INCOMING_ATTACHMENTS`              | `10`                                           |
| `signature`                               | `EMAIL_SIGNATURE`                             | empty; literal multiline text (not expanded)   |
| `spontaneousPost.enabled`                 | `EMAIL_SPONTANEOUS_ENABLED`                   | `false`                                        |
| `spontaneousPost.minIntervalMs`           | `EMAIL_SPONTANEOUS_MIN_INTERVAL_MS`           | `10800000` (3 hours)                           |
| `spontaneousPost.maxIntervalMs`           | `EMAIL_SPONTANEOUS_MAX_INTERVAL_MS`           | `43200000` (12 hours)                          |
| `spontaneousPost.contextFetchProbability` | `EMAIL_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY` | `0.5`                                          |

### Security & Activation Guard

Production email activation is guarded until the `email-activation` change is completed. Setting `platforms.email.enabled: true` runs transport and trust validation and then halts startup with a `ConfigError` indicating production activation is unavailable in this release.

## Crash-Safe Durable Files (Owned by `email-durable-files`)

The email platform relies exclusively on file-backed persistence without external database services. Durable state primitives are implemented in `src/platforms/email/durable-files.ts`:

### Durability & Invariants

- **No Database**: File-backed persistence ONLY (JSON snapshots, append-only JSONL journals, and ordinary files). No SQLite, Postgres, or remote database services.
- **Filesystem & OS Durability**: Supported on POSIX environments (Linux, macOS) providing standard `fsync(2)` semantics on file handles and open directory handles. Directory durability is strictly required before reporting success; on platforms where directory `fsync` cannot be established (e.g. Windows), durability primitives fail safe (`UNSUPPORTED_DURABILITY`) rather than silently downgrading.
- **Single-Owner Volume**: Assumes a single bot process owns the state root volume; concurrent multi-process writes to the same mailbox directory are unsupported.
- **Serialized Per-State-Root**: In-process mutex keyed by canonical state root serializes concurrent `appendDurable`, `replaceSnapshot`, and `readJournal` operations.
- **Flush Before Effects**: Files and containing directories are synchronized (`fsync` / `sync()`) before returning success or proceeding with external side effects (e.g. SMTP transmission).
- **Atomic Snapshot Replacement**: JSON snapshots are written to an unpredictable sibling temporary file (`.${basename}.tmp-${uuid}`) with mode `0600`, fsynced, and renamed over the destination. Directory fsync follows rename. Existing symlink targets are explicitly refused.
- **Private Boundary Hygiene**: Directories are created with mode `0700` and files with mode `0600`. Paths are validated to remain strictly within the canonical root without following symlink escapes or parent traversals (`..`).

### Journal Integrity & Corruption Evidence

Each line in an append-only JSONL journal is encapsulated in an envelope:

```json
{"v":1,"seq":1,"data":{...},"crc32":"xxxxxxxx"}
```

- **Clean**: All records complete, sequential, checksum-verified, and ending with newline.
- **Torn-tail**: Incomplete or unclosed final record (e.g. missing newline, truncated JSON, or truncated checksum at end-of-file). Exposes `torn-tail` status and exact byte offset.
- **Corrupt**: Interior syntax error, checksum mismatch, unsupported version, or sequence discontinuity.
- **Damaged Append Prohibition**: When a journal exhibits `torn-tail` or `corrupt` status, subsequent calls to `appendDurable` are strictly rejected with `DAMAGED_JOURNAL_APPEND_REFUSED`. Automatic repair or truncation is forbidden; evidence is never silently erased.
- **Privacy in Diagnostics**: Diagnostics and error logs contain only safe diagnostic codes (e.g. `CORRUPT_INTERIOR_INVALID_JSON`, `TORN_TAIL_MISSING_NEWLINE`) and byte offsets; private line contents or email bodies are never logged.

### Acceptance Scenarios

Acceptance requirements and test scenarios defined in `specs/email-durable-files/spec.md`:

- **Durable before side effects**: Flushes file handles and parent directory entries before returning; write or sync failures abort operations and prevent side effects (such as SMTP dispatch).
- **Corruption is evidence**: Torn trailing records expose `torn-tail` status and halt subsequent appends (`DAMAGED_JOURNAL_APPEND_REFUSED`) without erasing evidence; interior corruption halts affected processing without leaking private data.
- **Private file boundary**: Rejects path traversal (`..`), denies symlink escapes across all path components, and enforces `0700` directory and `0600` file permissions.

### Exported Primitives

- `appendDurable<T>(rootPath: string, relativePath: string, record: T, options?: DurableFileOptions): Promise<{ seq: number }>`
- `replaceSnapshot<T>(rootPath: string, relativePath: string, data: T, options?: DurableFileOptions): Promise<void>`
- `readJournal<T>(rootPath: string, relativePath: string, options?: DurableFileOptions): Promise<JournalIntegrityResult<T>>`
- `assertSafePath(canonicalRoot: string, relativePath: string): Promise<string>`
- `ensureDurableDir(canonicalRoot: string, dirPath: string): Promise<void>`

## Durable Mailbox Processing Journal (Owned by `email-mailbox-journal`)

Mailbox progress, discovery boundaries, and per-entry processing lifecycle states are durably tracked under the email state directory (`data/email/`) via `MailboxStore` in `src/platforms/email/mailbox-store.ts`.

### Files & Layout

- **`mailbox.json`**: Atomic JSON snapshot containing mailbox identity, first-activation boundary, IMAP `uidValidity`, and the current scan cursor.
- **`processing.jsonl`**: Append-only transition journal containing state changes for individual email entries.

### Invariants & Semantics

- **Cursor Meaning**: The scan cursor represents durable discovery coverage—the UID up to which the remote mailbox has been inspected and durably recorded. It does NOT represent agent session completion.
- **Coverage Invariant**: The cursor cannot advance past any entry currently in the `discovered` state. All discovered messages up to the new cursor position must reach `accepted`, `ignored`, `failed`, or `review-required` before checkpointing.
- **Pre-acceptance Terminal Isolation**: Malformed messages, authentication rejections, or ambiguous records can transition directly from `discovered` to terminal states (`failed`, `ignored`, `review-required`). They do not block subsequent valid UIDs from being processed.
- **Startup-Only Recovery**: `MailboxStore.recover()` is strictly a startup-only lifecycle method. Calling `recover()` while the store is active or live work is running is rejected (`INVALID_TRANSITION`) to prevent accidental quarantine of executing sessions.
- **Uncertain Receive Recovery**: Entries left in the `started` state without terminal evidence upon crash or restart are automatically and durably transitioned to `review-required` during `recover()`. They are never blindly re-executed by a new agent.
- **Resumable Accepted Queue**: Entries in `accepted` state that have not yet started execution are returned in the `unstarted` recovery queue and resume processing.
- **Single-Owner Mutex & Damaged Fencing**: All mutations and recovery actions are serialized through an in-memory lock. A persistence or sync failure immediately marks the instance damaged (`STORE_DAMAGED_APPEND_REFUSED`), rejecting all queued and future mutations.
- **Identity Validation**: A mismatch between configured mailbox fingerprint (`host=...;account=...;folder=...` preserving account case) and the persisted snapshot fails closed immediately (`FINGERPRINT_MISMATCH`), preventing cross-mailbox data corruption.

### Acceptance Scenarios

Detailed acceptance requirements and scenarios are defined in `specs/email-mailbox-state/spec.md`:

- **First activation boundary**: The initial position is durably recorded; downtime and restarts exclude pre-activation inbox messages.
- **Discovery and processing durability**: Progress never drops accepted unstarted work; each entry retains its lifecycle state independently of the cursor.
- **Uncertain receive recovery**: Work left in started state without terminal evidence requires manual review rather than automatic replay.

### Exported API

- `MailboxKey`: `{ fingerprint: string, uidValidity: number, uid: number }`
- `ProcessingState`: `"discovered" | "accepted" | "started" | "completed" | "ignored" | "failed" | "review-required"`
- `MailboxSnapshot`: `{ version: number, fingerprint: string, initializedBoundary: number, uidValidity: number, cursor: number, updatedAt: string }`
- `MailboxStore`:
  - `initialize(boundary: number, uidValidity: number): Promise<void>`
  - `checkpoint(newCursor: number): Promise<void>`
  - `discover(key: MailboxKey): Promise<void>`
  - `accept(key: MailboxKey, sourceRecordId: string): Promise<void>`
  - `start(key: MailboxKey, workId: string): Promise<void>`
  - `finish(key: MailboxKey, outcome: "completed" | "ignored" | "failed" | "review-required", options?: { workId?: string; detail?: string }): Promise<void>`
  - `recover(): Promise<MailboxRecoveryResult>`
  - `getSnapshot(): MailboxSnapshot | null`
  - `getEntry(key: MailboxKey): MailboxEntrySnapshot | undefined`
  - `close(): void`

## Certificate-Validated IMAP Transport (Owned by `email-imap-transport`)

The email platform communicates with remote IMAP mailboxes exclusively over certificate-validated TLS connections via `EmailImapClient` in `src/platforms/email/imap-client.ts`.

### Invariants & Security

- **Fail-Closed TLS Only**: Requires direct TLS (port 993) or mandatory STARTTLS (port 143) with certificate verification always enabled. Plaintext connections, opportunistic downgrade, and disabled certificate verification are strictly rejected.
- **Zero Authentication Before TLS**: Password credentials and SASL authentication payloads are sent only after transport encryption and certificate validation succeed. In case of certificate failure or missing STARTTLS capability, zero authentication requests are transmitted.
- **Credential Safety**: User credentials and secret passwords are NEVER logged or included in diagnostics, error messages, or telemetry.
- **30-Second Operation Timeout**: All network operations, commands, and mailbox lock acquisitions are bounded by a 30-second watchdog timer (`DEFAULT_IMAP_TIMEOUT_MS = 30000`).
- **Preflight & Hard Streaming Bounds**: Sources are checked against `maxBytes` (default 25 MiB) using `RFC822.SIZE` preflight before streaming. Oversized messages are rejected before reading body bytes. If the server understates message size, the streaming pipeline enforces an independent byte counter and cancels the download on overflow (`MESSAGE_TOO_LARGE`).
- **Mailbox Lock Serialization**: Folder interactions (e.g. `INBOX`, `Sent`) serialize access using mailbox locks held across command operations and streaming download lifetimes.
- **Read Flags Irrelevant**: `listAfter` queries messages strictly by UID (`uidSince + 1:*`) and ignores `\Seen` flags, allowing complete recovery of mail marked as read by other clients.
- **Test-Only Trust Root Setup**: Custom CA certificates (`tlsCa`) can be injected exclusively into `EmailImapClientOptions` during tests against deterministic local in-process protocol fixtures (`tests/helpers/email-imap-service.ts`); no production configuration or CLI parameter exposes an option to disable verification.

### Acceptance Scenarios

Acceptance requirements and test scenarios defined in `specs/email-imap-transport/spec.md`:

- **Downgrade or invalid certificate**: When the server omits STARTTLS or presents an untrusted/corrupt certificate, connection fails before credentials are sent.
- **Read elsewhere**: When new mail has `\Seen` set by another client, the UID still appears in `listAfter` and its bounded source remains retrievable.
- **Protocol smoke**: Real IMAP library (`imapflow`) connects to a controlled loopback test service using an in-process fixture CA; login, select, status, fetch, append, and disconnect exchanges complete deterministically without production network access.

### Exported API

- `ImapTransport`:
  - `connect(): Promise<void>`
  - `disconnect(): Promise<void>`
  - `status(folder?: string): Promise<ImapMailboxPosition>`
  - `position(folder?: string): Promise<ImapMailboxPosition>`
  - `listAfter(uidSince: number, options?: ImapListOptions): Promise<number[]>`
  - `fetchHeaders(uid: number, options?: ImapFetchHeadersOptions): Promise<string>`
  - `fetchSource(uid: number, options?: ImapFetchSourceOptions): Promise<ImapMessage>`
  - `appendSent(rawMime: Uint8Array | string, options?: ImapAppendOptions): Promise<void>`
- `ImapMessage`:
  - `uid: number`
  - `size: number`
  - `source: ReadableStream<Uint8Array>`
  - `bytes(): Promise<Uint8Array>`

## Inbound Email Authentication & Allowlist Admission (Owned by `email-incoming-auth`)

Inbound email authentication and allowlist admission are implemented in `src/platforms/email/incoming-auth.ts`.

### Invariants & Semantics

- **Authoritative Receiving Prerequisite & Operator Attestation**:
  - Trusting `Authentication-Results` headers is predicated strictly on operator attestation that the receiving MTA strips or removes attacker-supplied `Authentication-Results` headers claiming the configured `authservId` (`platforms.email.receivingAuth.attestedStripping: true`).
  - If `attestedStripping` is not `true` or `authservId` is empty, automatic admission fails closed (`REJECTED_UNATTESTED_STRIPPING`).
  - Never trust textual `authserv-id` alone without attested MTA stripping.
- **Strict Authentication-Results Parsing (RFC 7601 / RFC 8601)**:
  - Filters `Authentication-Results` headers matching the configured `authservId` (case-insensitive).
  - Strips RFC 5322 / RFC 7601 comments and quoted strings before parsing so commentary cannot masquerade as authentication evidence.
  - Rejects multiple headers claiming the trusted `authservId` (`REJECTED_MULTIPLE_AUTHSERV_RESULTS`) to fail closed on injected or conflicting MTA evidence.
  - Requires exactly one authoritative `dmarc` outcome in the trusted header. Duplicate DMARC clauses fail closed (`REJECTED_MULTIPLE_DMARC_RESULTS`).
  - The DMARC outcome must be `pass` (`REJECTED_DMARC_FAILED`).
  - The evaluated `header.from` domain declared in the DMARC clause must match the sender's From domain exactly (`REJECTED_DMARC_ALIGNMENT_FAILED`).
- **DMARC Domain-Only Limitation & Accepted Residual Risk**:
  - DMARC proves domain-level authorization and control only, NOT exclusivity or authorization of a particular local-part (e.g. `another-user@allowed-domain.org` vs `allowed-user@allowed-domain.org`).
  - Both DMARC domain alignment and sender allowlist membership (`email/account/<userId>`) are required independently.
  - VerifiedSender acknowledges this domain control limitation (`domainControlLimitationAcknowledged: true`).
- **Sender Allowlist Validation**:
  - Evaluates independently of global `replyPolicy` (`all`, `public`, `channels`). Email admission strictly requires an enabled channel entry `email/account/<userId>`.
  - Senders not present or disabled in channels are rejected (`REJECTED_SENDER_NOT_ALLOWED`).
- **Loop & Destination Protection**:
  - **Self-Originated**: Mail from the bot's own address (`platforms.email.address`) is silently ignored (`IGNORED_SELF_ORIGINATED`).
  - **Auto-Submitted**: Mail carrying an `Auto-Submitted` header (RFC 3834) whose primary keyword is not `no` (e.g. `auto-generated`, `auto-replied`) is silently ignored (`IGNORED_AUTO_SUBMITTED`).
  - **Delivery Failures / DSN**: Bounces and delivery failure notifications (`Return-Path: <>`, `multipart/report` with `report-type=delivery-status`, `X-Failed-Recipients`, bounce subjects) are silently ignored (`IGNORED_DELIVERY_FAILURE`).
  - **Zero Session / Zero Reply**: Ignored and rejected messages never initiate agent sessions and NEVER trigger rejection or error emails, preventing amplification loops and backscatter.
  - **Strict Reply Destination**: `verifiedSender.replyDestination` is strictly bound to `canonicalAddress`. Unrelated `Reply-To`, `Cc`, or `Bcc` headers never override the reply destination.

### Deployment & MTA Stripping Verification Procedure

To verify that your receiving MTA safely strips untrusted `Authentication-Results` headers before setting `receivingAuth.attestedStripping: true`:

1. Send a controlled test message from an external host directly to your receiving MTA with a forged header:
   ```
   Authentication-Results: <configured-authservId>; dmarc=pass header.from=<your-allowed-domain>
   ```
2. Inspect the message received in the IMAP inbox.
3. Verify that the receiving MTA either removed the untrusted header or renamed it (e.g. `X-Injected-Authentication-Results`), ensuring that only the MTA's own locally generated `Authentication-Results` header contains your `<configured-authservId>`.
4. Only after this test passes should `receivingAuth.attestedStripping` be set to `true`.

### Exported API

- `AdmissionStatus`: `"admit" | "ignore" | "reject"`
- `AdmissionReason`: Safe reason enum (`ADMITTED`, `IGNORED_SELF_ORIGINATED`, `IGNORED_AUTO_SUBMITTED`, `IGNORED_DELIVERY_FAILURE`, `REJECTED_UNATTESTED_STRIPPING`, `REJECTED_MISSING_AUTH_RESULTS`, `REJECTED_MULTIPLE_AUTHSERV_RESULTS`, `REJECTED_MISSING_DMARC`, `REJECTED_MULTIPLE_DMARC_RESULTS`, `REJECTED_DMARC_FAILED`, `REJECTED_DMARC_ALIGNMENT_FAILED`, `REJECTED_MISSING_FROM_HEADER`, `REJECTED_INVALID_FROM`, `REJECTED_SENDER_NOT_ALLOWED`)
- `VerifiedSender`:
  - `canonicalAddress: string`
  - `userId: string`
  - `authservId: string`
  - `alignedDomain: string`
  - `provenance: EmailProvenance`
  - `replyDestination: string`
  - `domainControlLimitationAcknowledged: true`
- `authenticateInbound(parsed: ParsedEmail, rawHeaders: RawHeadersInput, receiverConfig: InboundAuthReceiverConfig, channels: ChannelConfig[]): AdmissionDecision`

## Bounded Incoming MIME Parsing & Content Provenance (Owned by `email-incoming-mime`)

Bounded MIME parsing and provenance extraction are implemented in `src/platforms/email/incoming-mime.ts`:

### Invariants & Semantics

- **Inert Content Conversion**: Incoming mail prefers `text/plain`. HTML-only bodies are converted to inert plain text using `html-to-text` with images, scripts, styles, iframes, and objects disabled. No network calls or code execution occur during conversion.
- **Pre-Byte Message Size Bound**: Raw message size is bounded (default `25 MiB` / `26,214,400 bytes`). Declared sizes exceeding the limit and actual streaming bytes exceeding the limit are rejected immediately (`MESSAGE_EXCEEDS_SIZE_LIMIT`) before buffering full contents into memory.
- **Pre-Byte Attachment Count Limit**: Incoming attachments are counted on stream discovery (default limit `10`). Discovery of an eleventh attachment terminates processing immediately (`ATTACHMENT_LIMIT_EXCEEDED`) without materializing excessive attachment bytes or leaving partial accepted messages.
- **Provenance Separation & Conservative Ambiguity**:
  - Distinguishes `authoredText`, `quotedText`, and `forwardedText`.
  - Line-anchored quote markers (`> ...`), standard quote attributions (`On ... wrote:`, `At ..., ... wrote:`), original message dividers (`-----Original Message-----`), and forward dividers (`---------- Forwarded message ---------`) are separated.
  - Status is set to `"clean"` when clear separation exists.
  - Status is marked `"ambiguous"` whenever HTML-only conversion, mixed quoting (e.g. text following quote blocks), or uncertain boundaries occur. Downstream authorization enforces that ambiguous provenance NEVER grants third-party destinations.
- **Attachment-Only Requests**: Valid MIME messages with empty body text and bounded attachments are accepted as valid requests with empty `authoredText` and `clean` provenance without inventing fake body text.
- **Header Strictness**: Rejects multiple `From` header lines or multiple mailbox addresses in `From` (`INVALID_FROM_HEADER`). Sender address is normalized via `normalizeEmailMailbox`. Validates bracketed RFC 5322 wire identifiers (`Message-ID`, `In-Reply-To`, `References`). Malformed or duplicate routing headers reject parsing (`INVALID_ROUTING_HEADER`).
- **Display-Only Attachment Metadata**: Attachment filenames are treated as display metadata only: path separators, parent traversals (`..`), control characters, and leading dots/spaces are stripped. Fallback filenames (`attachment-{index}.dat`) are used if missing or unsafe. Attachments receive random UUIDv4 identifiers.
- **Privacy in Diagnostics**: Diagnostic error codes (`MESSAGE_EXCEEDS_SIZE_LIMIT`, `ATTACHMENT_LIMIT_EXCEEDED`, `INVALID_FROM_HEADER`, `INVALID_ROUTING_HEADER`, `STREAM_ABORTED`, `PARSE_ERROR`) and error messages omit private message bodies, recipients, and credentials.

### Acceptance Scenarios

Acceptance requirements and test scenarios defined in `specs/email-incoming-content/spec.md`:

- **Oversized or excessive MIME**: When declared size exceeds limit or streaming parsing discovers an eleventh attachment, processing terminates explicitly without a partial accepted message.
- **Ambiguous quoted command**: When HTML-only conversion or mixed quoting makes new authorship uncertain, the body remains available as reference data with ambiguous authorization provenance.
- **Empty body with attachment**: When a valid MIME message has no body text and one bounded attachment, its normalized content includes attachment metadata without inventing authored text.

### Exported API

- `DEFAULT_MAX_MESSAGE_BYTES`: `26214400` (25 MiB)
- `DEFAULT_MAX_INCOMING_ATTACHMENTS`: `10`
- `IncomingMimeDiagnosticCode`: Safe enum diagnostic codes (`CLEAN`, `MESSAGE_EXCEEDS_SIZE_LIMIT`, `ATTACHMENT_LIMIT_EXCEEDED`, `INVALID_FROM_HEADER`, `INVALID_ROUTING_HEADER`, `PARSE_ERROR`, `STREAM_ABORTED`)
- `IncomingMimeError`: `BaseError` subclass with safe diagnostic code
- `ParsedEmailAttachment`:
  - `id: string`
  - `displayName?: string`
  - `mimeType: string`
  - `size: number`
  - `content: Uint8Array`
- `ParsedEmail`:
  - `from: string`
  - `subject?: string`
  - `wireIds: EmailMessageIdentifiers`
  - `plainBody: string`
  - `provenance: EmailProvenance`
  - `attachments: ParsedEmailAttachment[]`
  - `sourceRef?: string`
  - `date?: Date`
- `ParseIncomingMimeOptions`:
  - `maxMessageBytes?: number`
  - `maxIncomingAttachments?: number`
  - `declaredSize?: number`
  - `sourceRef?: string`
- `parseIncomingMime(source: Uint8Array | string | ReadableStream<Uint8Array>, options?: ParseIncomingMimeOptions): Promise<ParsedEmail>`
- `convertHtmlToInertText(html: string): string`
- `extractProvenance(body: string, options?: { isHtmlOnly?: boolean }): EmailProvenance`
- `sanitizeAttachmentDisplayName(rawFilename: string | undefined, index: number): string`
- `toMessageStoreParsedEmail(parsed: ParsedEmail): ParsedEmailData & { attachmentPayloads: StoreAttachmentPayload[] }`

## Sender-Scoped Message & Thread History Store (Owned by `email-message-history`)

Private correspondence archives, immutable source/attachment bytes, and RFC 5322 thread derivations are durably managed under each user's workspace directory (`<userWorkspace>/email/`) via `EmailMessageStore` in `src/platforms/email/message-store.ts`.

### Files & Layout

Inside the user's workspace under `email/`:

- **`threads.jsonl`**: Append-only transition journal containing thread associations, wire Message-ID references, review flags, and outbound operations.
- **`source/<recordId>.eml`**: Immutable raw RFC 5322 source email bytes preserved with exclusive create semantics (`0600`).
- **`parsed/<recordId>.json`**: Atomically replaced snapshot containing parsed message text, provenance, and attachment metadata.
- **`attachments/<recordId>/<attachmentId>`**: Immutable attachment binary payload bytes indexed by internal UUIDs.

### Invariants & Semantics

- **Sender & Thread Isolation**: Lookups require both initiating owner (`e_<sha256>`) and internal thread UUID (`mail:<userId>:<threadId>`). Both identifiers are strictly validated; cross-owner lookups or access attempts are rejected.
- **Thread Derivation**: Thread relationships are derived strictly from RFC 5322 `Message-ID`, `In-Reply-To`, and `References`. Subjects NEVER join threads: identical subjects without matching references form separate threads, while differing subjects with valid references join the existing thread.
- **Evidence Preservation on Conflict**: Duplicate wire `Message-ID` claims preserve both immutable source records under distinct internal UUIDs and mark the ambiguity as `review-required`. Conflicting references matching multiple existing threads do not merge threads destructively and flag `review-required`.
- **Unresolved References**: References to messages not locally present are retained as unresolved metadata; no placeholder or fabricated content is invented.
- **Third-Party Conversation Separation**: Outbound third-party sends (`targetKind: "third-party"`) are never inserted into the initiating user's reply thread, retaining separate thread context.
- **Durable Crash Recovery**: In-memory indexes (`Message-ID` -> threads/records, thread membership, operation keys) are replayed from disk on startup; if `threads.jsonl` exhibits torn-tail or interior corruption, mutations are fenced (`STORE_DAMAGED_APPEND_REFUSED`) without erasing evidence.
- **Privacy in Diagnostics**: Diagnostic codes and error logs contain safe enums (`INVALID_OWNER`, `INVALID_CHANNEL_ID`, `STORE_DAMAGED_APPEND_REFUSED`, `CROSS_OWNER_DENIED`) and opaque UUIDs; private message bodies, recipients, and attachments are never disclosed in logs.

### Acceptance Scenarios

Acceptance requirements and test scenarios defined in `specs/email-history/spec.md`:

- **Forged reference**: User B referencing User A's wire `Message-ID` returns no User A messages, and User B cannot join User A's thread.
- **Duplicate wire ID**: Distinct raw messages claiming the same `Message-ID` both survive as immutable records, and ambiguous threading flags review-required.
- **Forward later**: Even when the originating session's disposable `tmp/` area is reclaimed, original source bytes and attachments remain available by internal ID.

## Owner-Scoped Local Attachments (Owned by `email-local-attachments`)

Inbound email attachments are delivered to agents strictly as owner-validated local workspace files rather than remote URLs. Stored attachment binary payloads are materialized from `EmailMessageStore` into the session's staging directory (`<stagingDir>/attachments/<attachmentId>/<sanitizedFilename>`).

### Invariants & Security

- **Discriminated Union**: `Attachment` is a union of `NetworkAttachment` (Discord/Misskey with required `url`) and `LocalEmailAttachment` (`kind: "email-local"`, opaque `owner`, `recordId`, `attachmentId`, display metadata, and optional session `sessionPath`).
- **Pre-Read Containment & Owner Validation**: `materializeEmailAttachment` checks that `ref.owner === sessionOwner`, valid UUIDs, canonical staging containment, and refusal of symlink escapes before any bytes are read from `EmailMessageStore`.
- **Session Staging Boundary**: Local attachment files are placed under the current session's private directory (`0700` dirs, `0600` files). Display filenames are sanitized to a single path component without traversal.
- **Capability & Size Enforcement**: Only trigger email images within the 20 MiB limit become `ContentBlock::Image` when the agent negotiates image support. Non-images (e.g. PDF/DOCX) or history attachments receive text descriptions with their local session path.
- **Preservation of Archive on Cleanup**: Session cleanup reclaims ephemeral copies in `tmp/` while permanent email source and attachment files in `EmailMessageStore` remain untouched.

### Acceptance Scenarios

Acceptance requirements and test scenarios defined in `specs/multimedia-messages/spec.md` and `specs/platform-abstraction/spec.md`:

- **Cross-user or symlink reference**: When a forged local reference names another owner or a staging symlink escapes, no private bytes are read or staged.
- **Network protections remain intact**: Adding local attachments preserves existing HTTP SSRF checks and does not admit file URLs as network fetch targets.
- **Cleanup preserves sources**: Session cleanup removes temporary attachment copies without removing permanent source history.

### Exported API

- `LocalEmailAttachment`: `{ kind: "email-local", id: string, owner: string, recordId: string, attachmentId: string, filename: string, mimeType: string, size?: number, isImage: boolean, sessionPath?: string }`
- `NetworkAttachment`: `{ kind?: "network", id: string, url: string, filename: string, mimeType: string, size?: number, isImage: boolean }`
- `isLocalEmailAttachment(att: Attachment): att is LocalEmailAttachment`
- `isNetworkAttachment(att: Attachment): att is NetworkAttachment`
- `materializeEmailAttachment(options: MaterializeAttachmentOptions): Promise<string>`

### Exported API

- `parseEmailChannelId(channelId: string): { owner: string; threadId: string }`
- `formatEmailChannelId(owner: string, threadId: string): string`
- `validateOwnerId(owner: string): string`
- `validateUuid(id: string, code?: MessageStoreDiagnosticCode): string`
- `MessageStoreDiagnosticCode`: Safe enum diagnostic codes (`CLEAN`, `INVALID_OWNER`, `INVALID_THREAD_ID`, `INVALID_RECORD_ID`, `INVALID_CHANNEL_ID`, `INVALID_ATTACHMENT_ID`, `CROSS_OWNER_DENIED`, `MESSAGE_NOT_FOUND`, `ATTACHMENT_NOT_FOUND`, `SOURCE_NOT_FOUND`, `STORE_CORRUPT`, `STORE_CLOSED`, `STORE_DAMAGED_APPEND_REFUSED`, `CONFLICTING_OPERATION_PAYLOAD`, `PATH_ESCAPE_DETECTED`, `WRITE_FAILED`)
- `MessageStoreError`: BaseError subclass with safe diagnostic codes
- `EmailMessageStore`:
  - `getOwnerEmailRoot(owner: string): Promise<string>`
  - `resolveThread(owner: string, identifiers: EmailMessageIdentifiers): Promise<ThreadResolutionResult>`
  - `putSource(owner: string, boundedSource: Uint8Array | string, parsed: ParsedEmailData): Promise<string>`
  - `putSent(owner: string, constructedMessage: ConstructedEmailData, operation: EmailOperationKey): Promise<{ recordId: string; threadId: string }>`
  - `get(owner: string, threadId: string, recordId: string): Promise<StoredEmailRecord | undefined>`
  - `getByOwnerRecord(owner: string, recordId: string): Promise<StoredEmailRecord | undefined>`
  - `getSourceBytes(owner: string, recordId: string): Promise<Uint8Array | undefined>`
  - `history(owner: string, threadId: string, limit?: number): Promise<StoredEmailRecord[]>`
  - `attachment(owner: string, recordId: string, attachmentId: string): Promise<Uint8Array | undefined>`
  - `toPlatformMessages(records: StoredEmailRecord[]): PlatformMessage[]`
  - `recover(owner: string): Promise<void>`
  - `close(): void`

## Durable Submission Operations Journal (Owned by `email-submission-journal`)

Outbound email operations, deduplication reservation keys, and sending lifecycle states are durably tracked under the email state directory (`data/email/submissions.jsonl`) via `SubmissionStore` in `src/platforms/email/submission-store.ts`.

### Files & Layout

- **`submissions.jsonl`**: Append-only transition journal containing state changes for outbound operations (`prepare`, `submitting`, `outcome`, `sent-copy`).

### Invariants & Semantics

- **Stable Logical Operation**: All email submissions are bound to an owner-scoped `EmailOperationKey` (`{ workId: string, actionSlot: string }`) and content digest persisted durably before invoking SMTP.
- **Idempotent Reservation**: Repeated calls for the same logical operation with an identical content digest return the existing operation record. Repeated calls with changed payload return a conflict (`KEY_PAYLOAD_CONFLICT`).
- **Absorbing Unknown on Recovery**: Any operation left in the `submitting` phase without a terminal outcome upon crash or restart is durably converted to `unknown` during startup `recover()`. Operations in `unknown` state are absorbing for automatic sends and are NEVER automatically resubmitted.
- **Submitted Outcome Immutability**: Successful SMTP acceptance records `submitted`. Sent folder copy append failures do not downgrade or alter an accepted `submitted` outcome. Once reached, terminal outcomes (`submitted`, `failed`, `unknown`) cannot transition to different terminal outcomes.
- **Missing Evidence Blocks Submission**: Prepared operations require their referenced constructed `.eml` file and content digest to be verified prior to transmission. Missing or altered evidence blocks automatic sending without erasing or omitting the operation record.
- **Torn Tail & Corruption Fencing**: When `submissions.jsonl` exhibits `torn-tail` or `corrupt` integrity status, startup recovery fails closed with `STORE_CORRUPT`. The entire mailbox submission lane is fenced (`STORE_DAMAGED_APPEND_REFUSED`), rejecting subsequent appends without destroying evidence.
- **Privacy in Diagnostics**: Diagnostics and logs contain opaque identifiers (`op_<hash>`), safe diagnostic codes, and byte offsets. Private mail bodies, recipient addresses, and credentials are never stored in journal records or logged.

### Acceptance Scenarios

Acceptance requirements and test scenarios defined in `specs/email-submission-state/spec.md`:

- **Concurrent repeats**: Two callers requesting the same logical action share one durable reservation, and changed payloads return conflict.
- **Tail lacks outcome**: Submitting records without terminal outcomes become unknown on recovery and automatic sends remain blocked.
- **Unattributable corrupt intent**: Journal corruption blocks the whole mailbox submission lane for operator review.

### Exported API

- `EmailOperationKey`: `{ workId: string, actionSlot: EmailActionSlot | string }`
- `SubmissionPhase`: `"prepared" | "submitting" | "submitted" | "failed" | "unknown"`
- `SentCopyStatus`: `"pending" | "appended" | "failed"`
- `TargetKind`: `"user" | "third-party"`
- `SubmissionDiagnosticCode`: Safe enum diagnostic codes (`CLEAN`, `INVALID_KEY`, `KEY_PAYLOAD_CONFLICT`, `STORE_CORRUPT`, `STORE_DAMAGED_APPEND_REFUSED`, `MISSING_SUBMISSION_EVIDENCE`, `UNKNOWN_ABSORBING`, etc.)
- `SubmissionStore`:
  - `prepare(ownerId: string, key: EmailOperationKey, contentDigest: string, emlRef: string, options?: PrepareSubmissionOptions): Promise<SubmissionEntrySnapshot>`
  - `markSubmitting(key: EmailOperationKey): Promise<SubmissionEntrySnapshot>`
  - `recordOutcome(key: EmailOperationKey, outcome: "submitted" | "failed" | "unknown", options?: RecordOutcomeOptions): Promise<SubmissionEntrySnapshot>`
  - `updateSentCopy(key: EmailOperationKey, sentCopy: SentCopyStatus): Promise<SubmissionEntrySnapshot>`
  - `verifySubmissionEvidence(key: EmailOperationKey, computeDigestFn?: (bytes: Uint8Array) => Promise<string> | string): Promise<void>`
  - `lookup(key: EmailOperationKey): SubmissionEntrySnapshot | undefined`
  - `lookupById(operationId: string): SubmissionEntrySnapshot | undefined`
  - `recover(): Promise<SubmissionRecoveryResult>`
  - `close(): void`
