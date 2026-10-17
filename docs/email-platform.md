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

## Serialized IMAP Polling & Crash Recovery (Owned by `email-poll-recovery`)

The poll-cycle orchestrator wires the IMAP transport to MIME parsing, inbound authentication, the
durable mailbox journal, and the owner message store in `src/platforms/email/mailbox-poller.ts`
(`EmailMailboxPoller`). It is intentionally NOT registered in production bootstrap; email ingress
stays unavailable until the `email-activation` change removes the configuration guard.

### Invariants & Semantics

- **Transport reports, store decides**: the poller never invents durable state. Each round connects,
  observes `position()` (`uidValidity`/`uidNext`), and drives the mailbox journal's own transitions
  rather than a parallel record.
- **First activation excludes preexisting mail**: an uninitialized mailbox is initialized at
  `uidNext - 1`, so only messages arriving afterwards are discovered.
- **Read-independent discovery**: `listAfter(cursor)` uses UIDs and ignores `\Seen`; mail arriving
  during downtime is admitted on restart exactly once into the durable queue.
- **Durable discovery before effect**: each UID is `discover()`ed (durably) before it is fetched,
  parsed, or authenticated.
- **Checkpoint after durable store**: on admit the poller stores the source in `EmailMessageStore`,
  appends the immutable `accept(sourceRecordId)` receipt, hands off the accepted work, and only then
  advances the checkpoint. Delivery is at-least-once: a crash may re-deliver a UID, so downstream
  consumers must be idempotent.
- **Per-message failure isolation**: a malformed or size-limited message becomes terminal
  (`failed`) or `review-required` without blocking later UIDs. Deterministic per-message transport
  failures (oversized, or a UID positively confirmed absent from the folder) are terminal too; a
  durable discovery found expunged after a crash is terminalized so later checkpoints are never
  blocked.
- **Serialization & fail-safe connection handling**: rounds never overlap (a concurrent `poll()`
  shares the in-flight round). A connection-level failure aborts the round with the checkpoint
  unchanged and retries on the next interval.
- **Interval excludes latency**: `start()` schedules the next round only after the current round
  settles, so the default 300-second interval (`pollIntervalMs`) measures wall-clock between rounds
  and excludes server/agent processing time. Timer reconnects are IMAP-only, never SMTP retry.
- **Startup recovery**: `recover()` is startup-only. Accepted-but-unstarted work resumes
  (re-emitted with its original durable `recordId`) and is retried on later rounds after a
  transient failure; work that was `started` without a terminal receipt is quarantined as
  `review-required` by the mailbox journal and is never auto-replayed.

### UIDVALIDITY Replacement & Manual Review

When the server reports a changed `uidValidity`, the poller does not replay the mailbox. It
reconciles every message of the replacement mailbox against durable message evidence (wire
`Message-ID` plus raw-source SHA-256 digest):

- an identical known source is provably not new work and is skipped silently;
- this requires both the archived source to be identical AND its record to be bound to a durable
  acceptance/terminal receipt; an archived source that was never accepted is not treated as
  processing evidence;
- conflicting content under the same identifier, ambiguous/multiple matches, an unaccepted
  archived source, or unmatched replacement content stops automatic work and is reported for
  manual review;
- the checkpoint is left unchanged, so no message is admitted under an unverified mailbox identity.

Because a changed `UIDVALIDITY` is a security-relevant mailbox replacement, an operator must review
the reported entries and re-establish the mailbox identity before automatic processing resumes.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-poll-recovery/specs/email-mailbox-polling/spec.md`:

- **Restart smoke**: Seen mail added while the bot is stopped is admitted once on restart.
- **Mailbox replacement**: matching evidence prevents replay and ambiguous entries require review.
- **Mixed failures**: malformed mail becomes terminal while later entries stay eligible, and a
  connection drop resumes from durable evidence.

### Exported API

- `IncomingWork`: `{ workId, mailboxKey, owner, threadId, recordId, verifiedSender, provenance }`
- `PollCycleResult`: per-round counters plus `replacementDetected`, `halted`, and a safe `error` code.
- `ReviewItem`: `{ mailboxKey, reason, recordId? }`
- `EmailMailboxPoller`:
  - `recover(): Promise<MailboxRecoveryResult>`
  - `poll(): Promise<PollCycleResult>`
  - `start(): Promise<void>`
  - `stop(): Promise<void>`

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env tests/platforms/email/mailbox-poller.test.ts
```

## Outgoing MIME Construction & Fixed Signature (Owned by `email-mime-signature`)

`src/platforms/email/outgoing-mime.ts` owns the single construction point for every
outgoing email path: ordinary replies, third-party compositions, forwards, file
deliveries, reminders, and spontaneous messages. It is intentionally NOT registered
in production bootstrap; no SMTP transport or submission orchestration lives here.

### Construction Contract

`new OutgoingMimeBuilder({ fromAddress, now? })` keeps the configured bot address and
an injectable clock. `construct(draft, signature)` returns
`{ messageId, emlBytes, digest, historyBody, envelope, sizeBytes, wireIds, to, subject }`:

- `EmailDraft = { owner, operationKey, targetKind, to, subject, authoredBody, thread?, forwardSource?, attachments? }`.
  There is no Cc/Bcc or arbitrary header surface; `to` is the single authorized
  envelope recipient.
- `emlBytes` are complete RFC 5322 wire bytes with CRLF line endings; `digest` is the
  SHA-256 hex digest of exactly those bytes (submission evidence, row 04), and
  `sizeBytes` is their byte length.
- `envelope = { from, to: [recipient] }` is returned explicitly for SMTP submission
  (row 12); the transport never derives recipients from caller-supplied headers.
- The same draft, signature, clock, and attachment bytes always produce identical
  bytes, digest, and Message-ID, so recovery and sent-copy append reuse the stored
  `.eml` rather than reconstructing or re-signing it.

### Central Fixed Signature

The signature from `platforms.email.signature` is passed on every `construct` call and
applied **once**, after body cleanup and before MIME construction:

- separated from the authored body by a newline and the standard separator line
  (`--` followed by one ASCII space);
- an absent, empty, or whitespace-only signature adds nothing at all (no separator);
- the configured text is inserted literally — `${...}` template syntax and multiline
  line structure are preserved; changing it requires a bot restart;
- no heuristic de-duplication runs, so the signature is applied once by construction and
  model-written signature-like tails are kept verbatim (authored text that already
  contains the literal signature keeps it, and the central application adds one more).

Prompts and skills MUST tell the model not to generate the configured signature. Sent
history stores the actual signed outgoing content (`historyBody`), including the
signature and, for forwards, the quoted original section.

### Headers, Attachments & Forwarding

- Header-bound values are rejected before any bytes are produced: CR/LF/NUL injection
  in `subject`, mailboxes, thread identifiers, or attachment metadata fails
  construction, so a rejected draft cannot create a submission intent.
- `to` and `fromAddress` are canonicalized and restricted to a strict dot-atom
  addr-spec; group/route syntax that a MIME serializer would reinterpret is refused.
- `thread.wireMessageId` becomes `In-Reply-To`; `thread.references` are preserved in
  order with the parent appended once, and `Message-ID` is generated per construction.
- Every message carries `Auto-Submitted: auto-generated` to limit automatic-response
  loops; `Subject` uses RFC 2047 encoded words when needed.
- Bodies are plain text (always with a `text/plain` part, even when the authored body is
  empty) and attachments produce `multipart/mixed`; binary attachments use base64
  transfer encoding. Attachment filenames are display-only, strip paths and control
  characters, and never address the filesystem.
- Attached messages (`message/*`, e.g. a raw source `.eml`) are sent unencoded, so they
  must already be CRLF-terminated: content containing bare line feeds cannot be
  preserved byte-for-byte and is rejected instead of being silently rewritten.
- A forward places the signature after its authored commentary and before a labeled
  `---------- Forwarded message ---------` section that carries the original metadata
  and body verbatim; original signature text and byte-preservable attachment bytes are
  kept exactly (attached messages follow the CRLF rule above). The incoming provenance
  parser classifies that section as forwarded text.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-mime-signature/specs/email-message-construction/spec.md`:

- **Multiline and literal content**: literal line structure remains and sent-copy
  construction never adds a second signature.
- **Signed source forward**: the new signature precedes source content while source
  bytes stay identical.
- **Injected subject**: CRLF plus header text fails construction before a submission
  intent exists.

### Exported API

- `EmailDraft`, `EmailForwardSource`, `EmailOutgoingAttachment`, `EmailThreadReference`
- `ConstructedOutgoingEmail`
- `OutgoingMimeBuilder` with `construct(draft, signature)` and `sender`
- `applyOutgoingSignature(body, signature)`, `buildForwardSection(source)`
- `SIGNATURE_SEPARATOR`, `FORWARD_SECTION_MARKER`,
  `OutgoingMimeError` / `OutgoingMimeDiagnosticCode`

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env tests/platforms/email/outgoing-mime.test.ts
deno test --allow-net --allow-read --allow-write --allow-env tests/platforms/email/outgoing-mime-smoke.test.ts
```

## Certificate-Validated SMTP Submission (Owned by `email-smtp-transport`)

`src/platforms/email/smtp-client.ts` owns every outbound SMTP submission. It is
intentionally NOT registered in production bootstrap, it writes no state, and it holds no
retry policy: it submits one constructed message and reports exactly one classified
outcome. Durable submission bookkeeping belongs to `submission-store.ts` (row 04), and the
submission service (row 13) owns preparing an operation before invoking this transport.

### Submission Outcome Taxonomy

Every `submit` call reports `phase: "submitted" | "failed" | "unknown"` plus a safe
`safeCode`, an optional numeric `responseCode`, the envelope recipients the server
`accepted`/`rejected`, the exact `sizeBytes`, and `durationMs`. Recipient metadata is always
the transport-owned envelope: a rejected recipient is reported from our own binding, never
echoed from server text.

- **`submitted`** requires a syntactically valid positive final DATA acknowledgement (2xx)
  from the server. This means the provider **accepted** the message for delivery; it never
  means the recipient received it, and it is not an exactly-once guarantee. A success reply
  that cannot be validated as a 2xx acknowledgement (for example `2500`, or non-numeric
  text) yields `unknown`, never an unconfirmed `submitted`.
- **`failed`** is definite rejection and carries no delivery uncertainty: an explicit
  4xx/5xx server reply (authentication, `MAIL FROM`, `RCPT TO`, the DATA command, or the
  final response), a local envelope or payload refusal, an advertised provider size
  refusal, or a failure before message submission began (DNS, connection, TLS handshake,
  certificate validation, greeting, EHLO, mandatory STARTTLS, authentication).
- **`unknown`** means the acknowledgement was lost or unusable once the DATA transaction
  may have begun: socket loss or timeout during submission, or a truncated/malformed final
  reply that cannot be confirmed as acceptance. An unknown outcome requires manual review
  and MUST NOT be automatically resubmitted.

The transport NEVER retries, reconnects, or resubmits. DNS, connection, greeting, and socket
phases are bounded by 30-second deadlines, and once the connection is established the whole
submission is additionally bounded by a 30-second overall deadline; when a deadline elapses
after the DATA transaction began the result is `unknown`, never a second attempt. The
connection and its socket are torn down before `submit` returns.

### Pre-Submit Size Bounds

Two independent bounds exist, both applied before message bytes reach the wire:

- `platforms.email.maxMessageBytes` (default 25 MiB / `26,214,400` bytes) is checked against
  the constructed byte length before any socket is opened; exceeding it returns
  `MESSAGE_TOO_LARGE` (`failed`) with zero bytes and zero commands submitted. The supplied
  bytes are authoritative, so stale or optimistic size metadata cannot bypass the bound.
- A provider advertising `SIZE <n>` in its EHLO response rejects a larger message as
  `PROVIDER_SIZE_REJECTED` (`failed`) before the payload is transmitted.

### TLS & Credential Invariants

- **Fail-Closed TLS Only**: certificate-validated direct TLS (default port 465) or mandatory
  STARTTLS (default port 587) selected by `platforms.email.smtp.tlsMode`. Plaintext,
  opportunistic downgrade, `ignoreTLS`, and disabled certificate verification
  (`rejectUnauthorized`) are strictly refused; the TLS floor is `TLSv1.2`.
- **Zero Credentials Before Encryption**: authentication runs only after the TLS session is
  established and validated. With STARTTLS required, a server that cannot upgrade (missing
  capability or refused command) receives **no** authentication, `MAIL FROM`, `RCPT TO`, or
  DATA bytes; the outcome is a definite `failed`.
- **Explicit Envelope**: submission uses the envelope produced by construction
  (`envelope.from` plus exactly one recipient). Zero or multiple recipients, empty
  addresses, or CR/LF/`<>` injection are refused before connecting
  (`INVALID_ENVELOPE`); recipients are never derived from message headers.
- **No Re-Serialization**: the constructed RFC 5322 bytes are written verbatim into the DATA
  transaction with an explicit envelope, so the wire copy, the stored `.eml`, and the
  recorded digest describe the same message.
- **Credential Redaction**: credentials, message bodies/headers, and raw library error text
  never appear in logs, thrown errors, or returned results. Diagnostics contain only the
  host, port, TLS mode, phase, safe code, numeric response code, sizes, and timings.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-smtp-transport/specs/email-smtp-transport/spec.md`:

- **Unsafe server**: missing STARTTLS or failed certificate validation submits no
  credentials and no message bytes.
- **Lost final reply**: a server that consumes DATA and closes before acceptance yields
  `unknown` with no retry and exactly one DATA transaction.
- **Accepted and rejected envelopes**: real client submissions through a local TLS SMTP
  service show one envelope recipient, one DATA transaction per call, and distinct
  accepted/rejected results.

### Test Fixture

`tests/helpers/email-smtp-service.ts` provides the deterministic in-process ESMTP service
(greeting, EHLO with `AUTH`/`STARTTLS`/`SIZE`, STARTTLS upgrade, AUTH PLAIN/LOGIN, MAIL,
RCPT, DATA with dot-unstuffing, QUIT) plus scripted fault modes: refused STARTTLS, rejected
authentication, rejected sender/recipient/DATA command, explicit final response codes,
socket close or stall after the payload, truncated or unparseable final replies, an
advertised `SIZE` limit, raw final response text (including deliberately malformed codes),
and an immediate greeting refusal. It records received commands,
authentication attempts, and each decoded DATA transaction so tests can assert the exact
wire behaviour.

### Exported API

- `SmtpOutcome`: `"submitted" | "failed" | "unknown"`
- `SmtpTransport.submit(input: SmtpSubmission): Promise<SmtpSubmitResult>`; a
  `ConstructedOutgoingEmail` is directly assignable to `SmtpSubmission`
- `SmtpSubmission`: `{ emlBytes, envelope: { from, to }, sizeBytes? }`
- `SmtpSubmitResult`: `{ phase, safeCode, responseCode?, accepted, rejected, sizeBytes, durationMs }`
- `EmailSmtpClient` with options `{ config, maxMessageBytes?, timeoutMs?, tlsCa? }` and
  `messageSizeLimit`
- `SmtpDiagnosticCode`, `SmtpTransportError`, `DEFAULT_SMTP_TIMEOUT_MS`,
  `DEFAULT_MAX_MESSAGE_BYTES`, `SMTP_TLS_MIN_VERSION`

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/platforms/email/smtp-client.test.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/platforms/email/smtp-transport-smoke.test.ts
```

## Common Durable Send Service (Owned by `email-submission-service`)

`src/platforms/email/mail-service.ts` owns every outbound email path. Model- and skill-facing
callers (rows 15/20/21) hand one `EmailDraft` plus its logical operation key to
`EmailMailService.send()`; nothing else submits mail. The module is intentionally NOT
registered in production bootstrap, and the activation guard is untouched.

### Effect Order (the contract)

1. Construct the message once (`OutgoingMimeBuilder`) with the literal startup signature.
2. Publish fsynced evidence: `outbound/<operationId>.eml` (exact wire bytes) and
   `outbound/<operationId>.meta.json` (construction metadata).
3. Reserve the logical operation durably (`SubmissionStore.prepare`).
4. Durably mark `submitting`, gated on the evidence digest (missing or tampered evidence is
   refused, and automatic submission is blocked). Every consumer of stored evidence — prepared
   resume, history repair, sent-copy repair — re-hashes the actual `.eml` bytes and requires
   them to match the digest recorded in the journal, so a damaged or replaced file is reported
   rather than submitted, appended or rebuilt into history.
5. Submit over SMTP (`SmtpTransport.submit`); only a positive final DATA acknowledgement is
   `submitted`.
6. Persist the terminal outcome before reporting anything.
7. For `submitted`: record local sent history (`EmailMessageStore.putSent`), then APPEND the
   identical bytes to `platforms.email.sentFolder`.

The single recipient allowlist for `targetKind: "user"` is rechecked immediately before SMTP
(`email/account/<userId>` must be present and enabled). Third-party destinations are
authorized by the owning compose/forward handler; this service never interprets or creates
grants. A constructed message exceeding `platforms.email.maxMessageBytes` is refused before
any socket is opened rather than truncated.

One process-wide operation lock (keyed by the resolved state root, owner and logical key)
serializes the whole lookup/publication/submission sequence across every `EmailMailService`
instance in the process, so two instances sharing a state root can never replace the evidence
of an operation that is already submitting or submitted. Cross-process ownership is still the
single-process assumption of the platform; no lock service is introduced.

Sent-folder copies are serialized across instances by the injected IMAP transport's identity,
because one transport owns one mutable connection. That transport must not be driven outside
this service's copy lane; SMTP deduplication and accepted state never depend on the copy lane.

### Durable Evidence & Safe Inspection

Evidence lives under the email state root (`data/email/outbound/`) with directory mode `0700`
and file mode `0600`. It contains private message bytes, so it is inspected only by the
operator who owns the mailbox volume; diagnostics and logs never include bodies, recipients or
credentials, only operation ids and safe codes.

```sh
# Recorded operation state and phase history (append-only journal, one envelope per line)
jq -r '.data | [.operationId, .transition, .phase, (.sentCopy // "pending")] | @tsv' \
  data/email/submissions.jsonl

# Evidence for one operation (bytes are private)
ls -l data/email/outbound/op_<operationId>.eml data/email/outbound/op_<operationId>.meta.json
sha256sum data/email/outbound/op_<operationId>.eml   # compare with meta.json "digest"

# Local history and remote sent copy for the same operation
ls -l data/workspaces/email/<ownerId>/email/source/
```

`meta.json` carries the generated wire `messageId`, the signed `historyBody`, the SMTP
`envelope`, the evidence `digest`, and — once recorded — the local history reference
(`history.recordId`).

### Outcomes, Uncertainty and Operator Duties

| Phase       | Meaning                                                                             | Caller action                                                        |
| ----------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `submitted` | Positive final DATA acknowledgement; `sentCopy` reports the remote copy separately.  | None.                                                                |
| `failed`    | Definite rejection before acceptance (transport safe code).                          | No automatic retry; a new, explicitly authorized logical action only. |
| `unknown`   | Crash, lost acknowledgement, or an acceptance that could not be persisted.           | Manual operator review; automatic resend is suppressed.               |

- **Manual review of `unknown`**: the call returns `unknown` with the operation id and the
  persisted evidence, and a repeated request for the same key returns the recorded result with
  **zero** SMTP transactions. Nothing ever moves from `failed`/`unknown` back to a resubmit.
- **Sent-copy errors are separate**: after acceptance, a failing APPEND (or a failing history
  write) is recorded — `sentCopy: "failed"` / `historyError` — while the operation stays
  `submitted` and local history is preserved. It never triggers another SMTP submission.
- **Create the sent-folder copy later**: `appendPendingCopies()` APPENDs stored evidence bytes
  for every accepted operation whose copy is not yet recorded; it never contacts SMTP and is
  idempotent for operations already recorded as `appended`.
- **Recover after restart**: `recover()` is a startup step. Unclosed `submitting` operations
  become absorbing `unknown` (never resubmitted), `prepared` operations are reported for
  explicit caller action only, and missing local history is reconstructed from the stored
  evidence and already-signed body without applying the signature twice.
- A remote sent copy may be duplicated if the APPEND succeeds but its status write does not
  (at-least-once outside SMTP); this never causes a second SMTP submission.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-submission-service/specs/email-submission/spec.md`:

- **Repeated accepted request**: the recorded result is returned after a restart with zero
  additional SMTP transactions.
- **APPEND fails**: the result reports `submitted` with a sent-copy failure while signed local
  history exists.
- **Accept then persist fails**: the caller sees `unknown` with the operation id and automatic
  replay is suppressed.

### Exported API

- `EmailMailService` with options
  `{ config, emailRoot, submissionStore, messageStore, smtp, imap, channels, builder?, durableOptions? }`
  - `send(draft: EmailDraft): Promise<EmailSendOutcome>`
  - `lookup(owner: string, operationKey: EmailOperationKey): EmailSendOutcome | undefined`
  - `recover(): Promise<EmailSubmissionRecovery>`
  - `appendPendingCopies(): Promise<EmailCopyRepairResult>`
- `EmailSendOutcome` (`EmailSubmissionMetadata` plus `messageId?`, `recordId?`, `reused`,
  `historyError?`) is directly usable as the `emailSubmission` field of reply/file/skill
  results.
- `EmailSubmissionDiagnosticCode`, `EmailMailServiceError`, `OutboundEvidenceMeta`,
  `outboundEvidenceRef(operationId)`, `outboundEvidenceMetaRef(operationId)`,
  `OUTBOUND_EVIDENCE_SUBDIR`, `OUTBOUND_EVIDENCE_VERSION`
- Note: `lookup` takes the owner as well as the key because durable operation state is
  owner-scoped.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/platforms/email/mail-service.test.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/platforms/email/submission-service-smoke.test.ts
```

## Durable Email Work Receipts (Owned by `email-session-receipts`)

`src/platforms/email/session-receipts.ts` owns the durable receive-side receipts of one accepted
mailbox work item. It writes them into the existing mailbox journal (`MailboxStore`,
`processing.jsonl`); it adds no storage of its own and never precedes the journal as an
authority. The typed binding lives on the normalized event: an email event that the poller
accepted carries an `emailWork` receipt (`kind: "email-work"`, `workId`, `mailboxKey`,
`recordId`), which is the ONLY thing that makes a session receipt-bearing.

### Ordering Contract (the fence)

1. **Admission** — accepted work is already durable (`accepted` in `processing.jsonl`). Work
   that will never execute is recorded terminally instead of being left pending: a rejected
   access policy, a platform with no registered adapter, and an email `/clear` control command
   all record `ignored` with a safe reason code.
2. **Queue** — work that is accepted but still waiting for the global execution lease is
   **unstarted**. Nothing is written, so a restart resumes it; merely having emitted the event
   is never treated as progress.
3. **Start fence** — `beginEmailWork()` appends (and fsyncs) the `started` record carrying the
   hand-off `workId` immediately before the first agent action. For a pooled session the fence
   is taken INSIDE the lease runner, so it can only happen after the lease is held; for a
   per-spawn session it is taken before the first ACP session is created; in dry-run mode it is
   taken before the mock reply, which is a delivery side effect taken without a lease. A fence
   that cannot be written fails closed: the agent is never prompted on unfenced work.
4. **Outcome** — exactly one terminal receipt is written on every exit path, after the session
   lifecycle is final.

The generic error notice the bot sends when a session fails is also a delivery of the work item.
When the session failed BEFORE the agent could act (context assembly or agent connect), the
entry is still unstarted, so `AgentCore` takes the fence first and records the notice's own
outcome (`error-notice-delivered` → `completed`, `error-notice-undelivered` → `review-required`)
— an unrecorded notice would otherwise be delivered again by the next poll. Once the
orchestrator has fenced and decided the outcome, the recorded receipt is never rewritten by a
notification.

### Outcome Mapping

| Explicit lifecycle evidence                                | Receipt           | Detail                        |
| ---------------------------------------------------------- | ----------------- | ----------------------------- |
| The turn delivered a response and every side effect settled | `completed`       | `session-completed`           |
| The turn ended normally with no delivery and no uncertainty | `failed`          | `session-no-delivery`         |
| Dry run: no agent turn ran, and the mock reply (when configured) succeeded | `completed` | `session-completed` |
| Error notice delivered for a session that failed before acting | `completed`   | `error-notice-delivered`      |
| Error notice skipped, or undeliverable, for such a session  | `review-required` | `error-notice-undelivered`    |
| Interrupted run: exception, lost agent session, recovery abort, retry that did not end cleanly, pooled runner failure, a cancelled/truncated/refused stop reason at ANY point (even when a reply was already delivered), or a dry-run mock delivery that failed after being invoked | `review-required` | `session-outcome-uncertain`   |
| A claimed outcome whose side effects could not be settled    | `review-required` | `unsettled-side-effects`      |
| A path that claimed no explicit outcome                     | `review-required` | `session-outcome-unverified`  |
| Rejected admission / control command                        | `ignored`         | safe reason code              |

Neither `completed` nor the definitive `failed` is derived from `SessionResponse.success`, and
both require the completion's side-effect settler to confirm settlement. The settler closes
admission to further side-effect skill calls (the recovery fence) before reading the session's
in-flight counter, waits for it to reach zero, and reports `false` when that cannot be
confirmed — in which case the recorded outcome is `review-required` with
`unsettled-side-effects` instead. A failed terminal write leaves the entry `started`, so
startup recovery quarantines it as `review-required` rather than replays it.

Duplicate hand-offs are marked honestly by the journal's guarded transitions: a second fence
for the same entry is rejected, a repeated identical terminal receipt is an idempotent no-op
with a single durable record, and a terminal receipt carrying a different `workId` is refused
as an immutable-identity mismatch.

### Receive Uncertainty vs SMTP Uncertainty

The two uncertainties are separate and must not be read into one another; they share the same
`workId`, which is what lets an operator correlate them.

- **Receive uncertainty** (this module): recorded in `processing.jsonl` as
  `started` → `review-required`. It says the inbox entry was accepted and may have been acted
  on, without a proven outcome. Automatic polling never replays a review-required entry.
- **Send uncertainty** (`email-submission-service`): recorded in `submissions.jsonl` as the
  operation phase `unknown`. It says an outgoing message may or may not have been accepted by
  the provider. It is never resubmitted automatically.

An `unknown` send that occurred inside a session whose receive outcome is uncertain describes
one incident from two sides; the shared `workId` (persisted on the `started` receipt and used
as the outbound operation key's `workId`) links them.

### Operator Inspection

```sh
# Receive receipts for one work item, in durable order (no message content is stored)
jq -r '.data | select(.workId == "<workId>") | [.state, (.detail // ""), .timestamp] | @tsv' \
  data/email/processing.jsonl

# Everything that needs review, with the workId that links it to its sends
jq -r '.data | select(.state == "review-required") | [.workId, .detail, .key.uid] | @tsv' \
  data/email/processing.jsonl
```

The journal stores only opaque identifiers, states and safe codes — never bodies, addresses or
credentials.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-session-receipts/specs/session-lifecycle/spec.md` and covered by
`tests/core/email-session-receipts.test.ts`:

- **Durable agent-start fence / queue crash**: a process death while accepted work waits for
  the execution lease resumes that unstarted work on restart, and mere emission is never
  treated as completion.
- **Explicit receive completion / handler throws**: downstream event handling that fails after
  the work started records `review-required`, and later polls do not replay it.

### Exported API

- `EmailSessionReceipts` (constructed with a `MailboxStore`)
  - `beginEmailWork(receipt)` — the durable start fence; must be awaited before the agent acts.
  - `finishEmailWork(receipt, { outcome, detail?, settle })` — terminal receipt; awaits
    `settle` first and downgrades an unconfirmed `completed` or `failed` to `review-required`.
  - `requireReview(receipt, detail)` — escalates an uncertain outcome to `review-required`.
  - `denyAdmission(receipt, reason)` — records work that will never execute as `ignored`.
  - `isUnstarted(receipt)` — whether the entry still awaits execution (a caller about to
    deliver on the work item's behalf uses it to decide whether it must take the fence).
- `EmailWorkOutcome`, `EmailSideEffectSettler`, `EmailWorkCompletion`, `mailboxKeyOf(receipt)`
- Event-side binding: `EmailWorkReceipt`, `isEmailWorkReceipt(value)`,
  `emailWorkReceiptOf(event)` — the resolver used by every receipt sink, enforcing both the
  email platform and the typed `kind: "email-work"` discriminator.
- Session wiring: `AgentCore.setEmailSessionReceipts(receipts | null)` and
  `SessionOrchestrator.setEmailSessionReceipts(receipts | null)`. The work id is also exposed
  as `ActiveSession.emailWorkId` / `SkillContext.emailWorkId` for successor rows (15, 19, 22).

The module is intentionally NOT registered in production bootstrap; the activation guard stays
untouched and email ingress (row 15) installs the sink.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/core/email-session-receipts.test.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/platforms/email/mailbox-store.test.ts
```
