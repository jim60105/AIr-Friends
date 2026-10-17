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

### Production Activation & Lifecycle (Owned by `email-activation`)

Setting `platforms.email.enabled: true` composes the complete production stack through
`composeEmailPlatform` (`src/platforms/email/activation.ts`) from `bootstrap()`: the durable
submission journal, the owner-scoped message store, the durable mailbox journal, the serialized
IMAP poller, the durable mail service, the platform adapter and the destination-grant preflight.
There is no placeholder adapter and no second composition path.

**Fail-closed startup.** Config loading and the composer both revalidate the typed configuration
before any client is constructed. Only certificate-validated `tls` or mandatory `starttls` is
accepted (plaintext and opportunistic TLS are prohibited), both mail credentials are required,
and `receivingAuth.authservId` must name the trusted receiver while
`receivingAuth.attestedStripping` must be `true`. A missing or unattested setting fails startup
explicitly with a `ConfigError`; email is never activated on an insecure or unauthenticated
transport.

**Startup order.** The awaited workspace reclamation completes first. Both durable journals are
then recovered BEFORE any transport exists: a corrupted or unreadable journal leaves email
blocked (no adapter, no skill, no spontaneous lane) while the other platforms continue. The
adapter is installed on the connection-status registry and `AgentCore` (work receipts,
submission evidence, grant preflight and `send-email`) before `startPlatforms()` connects it. On
`connect()` the adapter consumes the recovered mailbox state and resumes accepted-unstarted work;
only then does it schedule rounds, so its first-activation boundary still excludes preexisting
mail.

**Shutdown order.** The schedulers stop first, then the email platform: submission admission is
permanently closed, registry reconnect cannot reopen the adapter, poll admission stops and
the in-flight round and its session hand-off settle, in-flight submissions and their durable
journal writes drain, and only then do the IMAP clients close. SMTP is never retried. An
interrupted submission keeps its durable uncertainty for the next startup recovery.

**Latency caveat.** `pollIntervalMs` (default `300000`, i.e. 5 minutes) measures wall-clock
between completed rounds and deliberately EXCLUDES server and agent processing time. A reply can
therefore take up to one poll interval plus the session's own duration before it starts.

**Backup & privacy.** The data-directory backup stages the whole tree, including
`data/email/**` (mailbox, processing and submission journals, outbound `.eml` evidence) and
`data/workspaces/email/**` (thread journals, source bytes, parsed snapshots, attachments). That
repository contains private correspondence in cleartext: keep it private and access-controlled;
disabling the backup loses the only durable copy. See also
[Deployment & MTA Stripping Verification Procedure](#deployment--mta-stripping-verification-procedure)
and [Private correspondence backup](#private-correspondence-backup).

### Activation acceptance manifest

| Acceptance boundary | Owned executable evidence |
| --- | --- |
| Complete registration, status, cleanup ordering, email-only config and fail-closed authority/TLS | `tests/core/email-bootstrap.test.ts`, `tests/core/config-loader.test.ts` |
| Preexisting exclusion, authenticated admission, threaded signed reply and granted forward with duplicate suppression | `tests/integration/email-platform.integration.test.ts` |
| Unknown outcome survives production recomposition without another DATA transaction | `tests/integration/email-platform.integration.test.ts` |
| Persisted reminder origin and real scheduler delivery through local SMTP | `tests/core/email-reminder-threads.test.ts` |
| Submission crash recovery and uncertain poll receipts | `tests/platforms/email/submission-service-smoke.test.ts`, `tests/platforms/email/mailbox-poller.test.ts` |
| Discord/Misskey regressions | `tests/platforms/discord/`, `tests/platforms/misskey/` |

The activation smoke uses real certificate-validated local TLS IMAP/SMTP clients and real
file-backed stores. It constructs the intent runtime but does not invoke a model; the forward
grant is host-provided test data. Reminder scheduler execution is covered by its predecessor
suite, separately from the composed adapter's reminder-slot smoke. No production mailbox,
credential, delivery guarantee or model-interpretation evidence is claimed.

Run the composed smoke with `deno test --allow-net --allow-read --allow-write --allow-env
--allow-run --allow-ffi --allow-sys tests/core/email-bootstrap.test.ts
tests/integration/email-platform.integration.test.ts` (join the wrapped command onto one line).

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
- **Pre-Read Containment & Owner Validation**: `materializeEmailAttachment` checks that `ref.owner === sessionOwner`, valid UUIDs, staging-root authorization, destination containment, and refusal of symlink escapes before any directory creation or bytes are read from `EmailMessageStore`.
- **Staging-Root Authorization**: `assertStagingRootBoundary(trustedRoot, stagingDir)` requires the authenticated workspace root to be an existing, real directory and inspects every existing component down to the session directory with `lstat` before canonicalization. A symlinked workspace or `tmp/` ancestor (even with an existing session child) is refused before any outside directory creation, file write or archive-byte read.
- **Session Staging Boundary**: Local attachment files are placed under the current session's private directory (`0700` dirs, `0600` files). Display filenames are sanitized to a single path component without traversal. Incoming `sessionPath` values are ignored, so a path recorded by another session is never reused.
- **Capability & Size Enforcement**: Only trigger email images within the 20 MiB limit become `ContentBlock::Image` when the agent negotiates image support. Non-images (e.g. PDF/DOCX), included history images and alternate-retrieval attachments receive text descriptions with their current-session path, never an image block.
- **Preservation of Archive on Cleanup**: Session cleanup reclaims ephemeral copies in `tmp/` while permanent email source and attachment files in `EmailMessageStore` remain untouched.

### Production session staging (Owned by `materialize-email-session-attachments`)

`src/platforms/email/attachment-preparation.ts` composes the existing owner-safe
materializer into the ONE preparation capability the host seams install:

- **Host-derived scope only**: `emailAttachmentScope({ workspace, sessionOwner, skillSessionId })`
  derives the owner and staging directory from the authenticated workspace and the
  host-assigned Skill API session id, falling back to the workspace `tmp` root when the
  Skill API is disabled. Owner or staging values are never taken from tool parameters,
  email bodies, attachment metadata or the environment; a workspace owned by another user
  is refused.
- **Every consumer prepares first**: email activation wires the capability through
  `AgentCore` into `SessionOrchestrator` and the Skill API. The initial prompt prepares the
  trigger and fetched history before formatting, token accounting and image-block
  construction, on both the per-spawn and pooled prompt paths. `fetch-context`
  (`recent_messages`, `search_messages`) and `get-message` prepare returned messages before
  serialization.
- **Per-session isolation**: preparation produces message/attachment copies and assigns
  `sessionPath` only after successful staging; shared events and archive metadata are never
  mutated. Identical owner/record/attachment references are staged once per preparation
  batch, with no global cache. GIF conversion scratch names are random and both the input
  and derived WebP stay inside the calling session's validated staging directory.
- **Publish checks are repeated at the sink**: the staging boundary and destination are
  re-authorized immediately after the archive read, the session copy is written to an
  exclusively created random sibling and renamed into place (`rename(2)` replaces a symlink
  entry rather than following it), and both GIF scratch files are reserved with exclusive
  creation and re-validated immediately before the converter opens them. Concurrent hostile
  mutation of the workspace volume is outside the deployment's single-owner assumption.
- **Explicit, content-free failure**: an attachment that cannot be safely staged fails that
  prompt preparation or retrieval with `email_attachment_unavailable`. No unstaged/opaque
  reference is presented as a usable file, and diagnostics omit filenames, bodies, archive
  paths, converter stderr and source bytes. Reclaiming session tmp removes only the
  disposable copies; archive bytes and backend forwarding retrieval are unchanged.

### Acceptance Scenarios

Acceptance requirements and test scenarios defined in `specs/multimedia-messages/spec.md` and `specs/platform-abstraction/spec.md`:

- **Cross-user or symlink reference**: When a forged local reference names another owner or a staging symlink escapes, no private bytes are read or staged.
- **Network protections remain intact**: Adding local attachments preserves existing HTTP SSRF checks and does not admit file URLs as network fetch targets.
- **Cleanup preserves sources**: Session cleanup removes temporary attachment copies without removing permanent source history.

Production-path staging scenarios (trigger/history, alternate retrieval, unsafe or
unavailable sources, cleanup, escaping staging ancestors, trigger-only inline images and
isolated GIF conversion) are defined in
`openspec/changes/materialize-email-session-attachments/specs/email-incoming-content/spec.md`
and exercised by `tests/platforms/email/attachment-preparation.test.ts`,
`tests/platforms/email/attachment-materializer.test.ts`,
`tests/core/session-orchestrator.test.ts`, `tests/skills/context-handler.test.ts` and
`tests/skills/reply-handler.test.ts`.

### Exported API

- `LocalEmailAttachment`: `{ kind: "email-local", id: string, owner: string, recordId: string, attachmentId: string, filename: string, mimeType: string, size?: number, isImage: boolean, sessionPath?: string }`
- `NetworkAttachment`: `{ kind?: "network", id: string, url: string, filename: string, mimeType: string, size?: number, isImage: boolean }`
- `isLocalEmailAttachment(att: Attachment): att is LocalEmailAttachment`
- `isNetworkAttachment(att: Attachment): att is NetworkAttachment`
- `materializeEmailAttachment(options: MaterializeAttachmentOptions): Promise<string>`
- `assertStagingRootBoundary(trustedRoot: string, stagingDir: string): Promise<void>`
- `createEmailAttachmentPreparation(store: EmailMessageStore): EmailAttachmentPreparation`
- `emailAttachmentScope({ workspace, sessionOwner, skillSessionId }): EmailAttachmentPreparationScope`
- `EmailAttachmentPreparationError` (fixed, content-free `email_attachment_unavailable`)

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
(`EmailMailboxPoller`). Production activation composes it through `composeEmailPlatform`; its
startup recovery completes before the first round admits work.

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
deliveries, reminders, and spontaneous messages. Production activation composes it as the
single outbound path; no SMTP transport or submission orchestration lives here.

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

`src/platforms/email/smtp-client.ts` owns every outbound SMTP submission. Production activation
constructs it inside the mail service, it writes no state, and it holds no retry policy: it
submits one constructed message and reports exactly one classified outcome. Durable submission
bookkeeping belongs to `submission-store.ts` (row 04), and the submission service (row 13) owns
preparing an operation before invoking this transport.

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
`EmailMailService.send()`; nothing else submits mail. Production activation composes it before
the adapter is registered, and shutdown drains its in-flight submissions before closing clients.

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

| Phase       | Meaning                                                                             | Caller action                                                         |
| ----------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `submitted` | Positive final DATA acknowledgement; `sentCopy` reports the remote copy separately. | None.                                                                 |
| `failed`    | Definite rejection before acceptance (transport safe code).                         | No automatic retry; a new, explicitly authorized logical action only. |
| `unknown`   | Crash, lost acknowledgement, or an acceptance that could not be persisted.          | Manual operator review; automatic resend is suppressed.               |

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

Production activation installs the sink on `AgentCore` before the adapter is registered, so
email ingress (row 15) always records its work lifecycle.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/core/email-session-receipts.test.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/platforms/email/mailbox-store.test.ts
```

## Durable Spontaneous Schedule Occurrences (Owned by `email-spontaneous-occurrences`)

`src/platforms/email/spontaneous-store.ts` owns the authoritative schedule state of the email
spontaneous lane. Discord and Misskey keep their existing best-effort schedule times in
`data/scheduler-state.json` (`SchedulerStateStore`); the email lane does not use that file at
all, so a stale `spontaneous:email` key there has no effect.

### File & Layout

- **`data/email/spontaneous.json`**: single fsynced JSON snapshot, written ONLY through
  `replaceSnapshot` (sibling-temp + fsync + rename + directory fsync, mode `0600`):

```json
{
  "v": 1,
  "occurrence": {
    "occurrenceId": "<uuid>",
    "dueAt": "<ISO>",
    "status": "started",
    "target": { "owner": "e_...", "threadId": "..." }
  },
  "previous": { "occurrenceId": "<uuid>", "dueAt": "<ISO>", "status": "completed" }
}
```

- `occurrence` is the only dispatchable record. Its status is `scheduled` (identity and due
  time exist, no target yet), `selected` (owner/thread durably bound), or `started` (dispatch
  durably claimed). `selected`/`started` always carry their bound target; a snapshot that loses
  it is corrupt.
- `previous` retains the immediately preceding occurrence with its terminal status
  (`completed` or `review-required`) while its successor is planned. It is dropped in the same
  write that terminalizes the successor. `submissions.jsonl` (row 04) remains the
  authoritative ledger of outbound operation evidence; this snapshot keeps only the preceding
  occurrence.
- `data/email/` is the email state area; the whole platform is file-backed and single-owner.

### Schedule Invariants

- **Persist before any timer**: a scheduled occurrence is written and fsynced before the
  scheduler arms a `setTimeout`, so no dispatch can ever run for an occurrence that is not
  durable. A failed initial persistence arms no timer and fences the lane; because a rejection
  can arrive after the rename, the snapshot may already have been replaced, so the file must be
  inspected rather than assumed absent.
- **Overdue identity**: on restore the original `occurrenceId` and `dueAt` are retained even
  when overdue; the delay simply becomes zero. The persisted due time is authoritative and is
  never rewritten to `now` (unlike `resolveScheduleTime`, which is used only for the non-email
  best-effort lanes).
- **Durable target binding**: `select()` persists owner/thread before any session or SMTP work
  and refuses a different target for an occurrence that already bound one; `begin()` requires a
  bound target, so no dispatch can run unbound.
- **Atomic terminal + successor**: `finishAndScheduleNext()` computes the terminal status,
  then replaces the snapshot in ONE write containing both the terminal result of the current
  occurrence and a distinct new `scheduled` successor. The successor identity is always new, so
  a restarted lane can never retry an occurrence under a replacement identity.
- **Evidence forbids re-fire**: the terminal status of a `started` occurrence is derived from
  the operation evidence of `spontaneousOperationKey(occurrenceId)`
  (`{ workId: occurrenceId, actionSlot: "spontaneous:<occurrenceId>" }`, owner from the bound
  target): `submitted` gives `completed`, `failed` gives `completed`, `submitting`/`unknown`
  give `review-required`, and otherwise the dispatch outcome decides (`unavailable` gives
  `review-required`). Downstream session and submission callers MUST derive the operation key
  from `spontaneousOperationKey`, otherwise evidence can not be attributed to the occurrence.
- **Fail closed without evidence**: an occurrence with a bound target is classified `uncertain`
  when no evidence provider is attached. The attached provider is row 04's `SubmissionStore`,
  which MUST have completed its own startup `recover()` first — a `lookup()` before recovery
  cannot distinguish "no operation" from "evidence not loaded", and an unrecovered provider
  would make an accepted send look unsent.
- **Reader-visible atomicity**: `replaceSnapshot` performs the rename before the parent
  directory fsync, so a rejected write is an uncertain commit. Readers always observe a
  complete old or complete new document; a rejected write is therefore never rolled back, never
  patched, and never followed by allocating another identity.

### Restart Review Semantics

- **Scheduled/selected restored**: the occurrence is dispatched with its original identity,
  due time and bound target; the delay is `max(0, dueAt - now)`. A crash before any submission
  attempt therefore resumes the same occurrence rather than skipping or replacing it.
- **`started` restored**: the lane inspects the occurrence's operation evidence. When the
  delivery is already resolved (`submitted` or `submitting`/`unknown`) the occurrence is
  terminalized (`completed` / `review-required`) and its distinct successor is installed in one
  write, with zero callback invocations — no replacement selection and no additional DATA
  transaction for it. When the delivery is unresolved (`prepared`/`failed`/absent) the same
  occurrence is resumed with its identity and target intact.
- **Fenced lane**: a rejected snapshot write (`WRITE_FAILED`) or an unreadable/invalid snapshot
  (`STORE_CORRUPT`) fences the state root for the remaining process lifetime (`STORE_BLOCKED`),
  so selection, dispatch and successor scheduling all stop instead of allocating a replacement
  identity. Refusals that only reject an illegal transition leave the state trustworthy and do
  not fence. Automatic work resumes only after a restart re-reads the durable state.
- **Serialized lane steps**: every durable lane step (startup restore/persist/arming and each
  dispatch with its finalizing write) runs in one serialized queue, so a scheduler
  `stop()`/`start()` cycle cannot dispatch the same occurrence twice, cannot race two startups
  for the first persisted occurrence, and cannot leave a durable successor unarmed.
- **Corruption blocks the lane**: malformed, semantically invalid, or unsupported snapshots
  fail closed (`STORE_CORRUPT`); the file is never repaired, rewritten, or trimmed, and the
  lane arms no timer. Inspect the file directly and restart to resume.
- **Production wiring**: bootstrap attaches the durable lane only while
  `platforms.email.enabled` and `spontaneousPost.enabled` are both set, and email dispatch
  itself (target resolution, session, delivery) is implemented in `email-spontaneous-targets` and
  enabled for production by `email-activation`. The lane exists only when the email platform was
  composed successfully, so an unauthorized dispatch can never be recorded as a successful
  occurrence.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-spontaneous-occurrences/specs/email-spontaneous-occurrences/spec.md`:

- **Crash before next schedule**: after SMTP accepted (or became uncertain) and the process
  died before the successor was persisted, restart recovers the same occurrence and performs no
  replacement selection and no additional DATA transaction.
- **Snapshot failure**: when selection or successor persistence fails, automatic work stops for
  review instead of allocating a replacement identity.

### Exported API

- `SPONTANEOUS_SNAPSHOT_FILENAME`, `SPONTANEOUS_SNAPSHOT_VERSION`
- `SpontaneousOccurrenceStatus`, `SpontaneousTerminalStatus`, `SpontaneousTarget`,
  `SpontaneousOccurrence`, `SpontaneousScheduleState`, `SpontaneousEvidenceClass`,
  `SpontaneousDispatchOutcome`, `SpontaneousSubmissionEvidence`
- `spontaneousOperationKey(occurrenceId): EmailOperationKey`
- `SpontaneousDiagnosticCode`, `EmailSpontaneousStoreError`
- `EmailSpontaneousStore`:
  - `restore(): Promise<SpontaneousScheduleState>`
  - `activeOccurrence(state): SpontaneousOccurrence | null`
  - `schedule(dueAt: Date): Promise<SpontaneousOccurrence>`
  - `select(occurrenceId: string, target: SpontaneousTarget): Promise<SpontaneousOccurrence>`
  - `begin(occurrenceId: string): Promise<SpontaneousOccurrence>`
  - `inspectEvidence(occurrence): SpontaneousEvidenceClass`
  - `deliveryResolved(occurrence): boolean`
  - `finishAndScheduleNext(occurrenceId, outcome, nextDueAt: Date): Promise<SpontaneousOccurrence>`
- `SpontaneousScheduler` additions: `setOccurrenceStore(store)` (email lane only),
  `whenReady(): Promise<void>`, and
  `SpontaneousPostCallback = (platform, occurrence?) => Promise<void>` where `occurrence` is
  supplied only for the durable lane. Bootstrap awaits `whenReady()` after `start()` so startup
  never reports ready while schedule state is unpersisted.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/core/email-spontaneous-occurrences.test.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/core/spontaneous-scheduler.test.ts tests/core/scheduler-state-store.test.ts
```

Evidence: the suite uses the real `SpontaneousScheduler`, the real `EmailSpontaneousStore` on
temporary state roots, counting callbacks, and the real `SubmissionStore` journal with genuine
startup recovery (no SMTP transport or native executable is involved in this slice, and no
network access is used), so the recorded evidence here is deterministic local durability and
scheduler behavior rather than native dispatch.

## Platform-Aware Surfaces (Owned by `email-platform-surfaces`)

Email joins every existing platform-union consumer through the union itself
(`Platform`, `VALID_PLATFORMS`, `isValidPlatform`) and through data shapes that are
already platform-generic. No consumer keeps a second platform allow-list, and no
email-only surface or abstraction is added.

### Recognized surfaces

| Surface | Where | Email behavior |
| ------- | ----- | -------------- |
| Workspace recognition and reclamation | `src/core/workspace-manager.ts` | `{workspacesDir}/email/{e_<sha256>}` is recognized by the existing shape rules; the startup pass recognizes it, never treats it as foreign |
| Memory maintenance enumeration | `src/bootstrap.ts` callback, `src/core/memory-maintenance-scheduler.ts` | The email workspace key passes the `isValidPlatform` gate, so its enabled memories are counted and maintained like any other platform's |
| Model routing | `src/core/model-router.ts` | `email/account/{userId}` rules resolve for email sessions; routing is keyed on the platform identifier plus the canonical user id |
| Metrics | `src/utils/metrics.ts` | Platform-labelled counters/histograms carry `platform="email"`; no user id, address or channel becomes a label |
| Administration (session monitor, history, audit, workspace/channel selectors) | `src/dashboard/` | Existing authenticated endpoints accept email sessions, audit directories (`{auditBasePath}/email/{e_<sha256>}/{sessionId}.jsonl`) and platform/channel keys; authorization is unchanged |
| Data-directory backup | `src/core/git-backup-service.ts` | The whole data tree is staged, so email state, signed sent history and source/attachment bytes are included |
| Startup/shutdown, registry connection status, platform validation | `src/bootstrap.ts`, `src/platforms/platform-registry.ts`, `src/core/config-loader.ts` | Email is a member of the union those consumers iterate; `email-activation` registers it, reports its connection status and orders its shutdown |

### Workspace shape and reclamation

- A sender's workspace lives at `{workspacesDir}/email/{e_<sha256>}`, named with the
  canonical hashed id — never the raw address.
- The durable archive lives below `<workspace>/email/` (`threads.jsonl`, `source/`,
  `parsed/`, `attachments/`). It is **persistent**: reclamation only ever removes
  entries inside `<workspace>/tmp/`, so archive, source and attachment bytes survive
  every cleanup pass.
- Inside `tmp/`, the existing policy is unchanged: session staging payloads, browser
  profiles and session-local attachment copies are disposable, while the reserved
  engine-state entries (`omp-agent`, `opencode-data`) are preserved verbatim.
- The startup reclamation pass recognizes `email/{user}` from the directory shape, so
  no email workspace is skipped, and nothing outside the workspace layout is visited.

### Model routing for the canonical email user

- Channel entries are normalized at load time to `email/account/<userId>`, so a routing
  rule must be written as `email/account/e_<sha256>` — the same key form the session
  context carries.
- A rule naming a raw address (`email/account/owner@example.com`) never matches a
  canonical session, and an email rule never matches another email user or another
  platform. Discord and Misskey rule behavior is unchanged.
- Email sessions pass `platform` and the canonical `userId` to the resolver; the
  memory-maintenance and channel-memory-maintenance sessions keep their existing
  section-model fallback chain.

### Metric label cardinality

- Platform-labelled metrics (`messages_received_total`, `replies_sent_total`,
  `sessions_total`, `session_duration_seconds`, …) use the platform identifier only.
  Email therefore adds exactly the series of one platform.
- A canonical email user id, address or mail channel id must never be added as a label;
  the declared label sets are asserted in `tests/utils/metrics.test.ts`.

### Private correspondence backup

- The data backup stages the whole data directory, so `data/email/**` (mailbox,
  processing, submission journals, outbound `.eml` evidence and its metadata) and
  `data/workspaces/email/**` (thread journal, inbound and signed outbound source bytes,
  parsed snapshots, attachments) are included, with no `.eml` or attachment exclusion.
- The only staged exclusions are the reserved OMP native-cache shapes
  (`omp-pools/**/omp-agent/<mode>/xdg-data/omp/natives/**` and `**/tmp/...`), which a
  deployment must keep out because they are large runtime bytes.
- The authenticated backup remote URL and the configured `authPassword` are never
  logged: a failing git invocation records `[REDACTED_URL]` for the credential-bearing
  argument and masks `//user:password@` inside git output.
- The backup stores the bytes it was given: every git invocation the service runs
  carries `-c core.autocrlf=false`, so git's implicit line-ending conversion no longer
  rewrites the `.eml` wire bytes or attachment payloads in the index, whatever the
  host's `core.autocrlf` setting is. Restored evidence therefore still matches its
  recorded SHA-256 digest. The operator's own line-ending configuration is left
  untouched; initialization still writes the service's own author, remote and
  safe-directory settings, as before.
- **Operator requirement — no transforming attributes on durable email paths**: this
  guarantee covers git's implicit conversion only. Explicit conversion attributes have
  higher precedence than `-c core.autocrlf=false`: an operator `.gitattributes` in the
  data repository (`* text=auto`, `*.eml text`), a `$GIT_DIR/info/attributes` entry, a
  `core.attributesFile` rule, or a clean/smudge filter would still rewrite evidence
  bytes and make restored evidence fail its digest verification. Keep the durable email
  paths (`email/**`, `workspaces/email/**`) free of transforming attributes and
  filters.
- **WARNING — private backup**: the backup repository contains private correspondence
  in cleartext, including message bodies and attachment bytes. Keep that repository
  private (private remote, access-controlled credential, no public fork or mirror), and
  treat disabling the backup as losing the only durable copy of that archive.

### Administration boundaries

- Email is **not** a public posting surface: the dashboard keeps its existing
  authenticated session monitor, history, audit, workspace and channel-memory surfaces
  and gains **no** mail workflow, inbox view or send endpoint.
- Admin endpoints keep their authorization boundaries: every one of them still returns
  `401` without a valid dashboard session, and unknown `/api/mail/...` or
  `/api/email/...` paths resolve to the ordinary static fallback (`404`).

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-platform-surfaces/specs/email-platform-integration/spec.md`:

- **Workspace lifecycle**: an email workspace containing memory, archive files and
  orphan tmp copies is recognized, cleanup removes eligible tmp only and maintenance
  sees its memory — `tests/core/workspace-tmp-lifecycle.test.ts`,
  `tests/core/memory-maintenance-scheduler.test.ts`.
- **Backup scope**: backup enumeration includes every durable email file without
  exposing credentials through backup logs — `tests/core/git-backup-service.test.ts`.
- **Selector regression**: authenticated administration surfaces recognize email where
  platform selection exists and the other platforms remain functional —
  `tests/dashboard/server.test.ts`, `tests/core/model-router.test.ts`,
  `tests/utils/metrics.test.ts`.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/core/workspace-tmp-lifecycle.test.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/core/memory-maintenance-scheduler.test.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/core/model-router.test.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/core/git-backup-service.test.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/dashboard/server.test.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/utils/metrics.test.ts
```

Exercised evidence layers: these cases drive the real `WorkspaceManager`,
`MemoryStore`, `GitBackupService` (real `git` against a local bare remote; one case
forces an unreachable remote) and `DashboardServer` (real HTTP over a per-test
temporary tree). No IMAP/SMTP transport, model call, ACP agent or production mailbox
participates in this change: transport, provider and production evidence is owned by
those slices and is not claimed here.

## Native OpenCode Intent Profile (Owned by `email-opencode-intent-profile`)

`src/acp/agent-factory.ts#createEmailIntentAgentConfig` owns the INTERNAL native deny-all
OpenCode profile an approved email interpretation launch runs under. It exists because denying
ACP callbacks alone cannot stop the engine's own tools: `agent-config/opencode.json` explicitly
ALLOWS reads, skill discovery and network tools in the ordinary build profile, and those calls
never reach ACP.

### It is not a mode anyone can select

The profile is a SEPARATE factory entry point. `createAgentConfig` never reaches it, and no
configuration field, dashboard request, environment variable or ACP request can name it. Callers
are internal: the profile is requested in code, and the returned `AgentConfig` carries
`executionProfile: "email-intent"` so the consumer can verify the launch it is driving and fail
closed on any mismatch. Ordinary OpenCode launches are byte-compatible: they carry no profile
identity, no `OPENCODE_CONFIG_CONTENT`, and keep their existing build/yolo session-mode override.

### Authored deny-all document

`agent-config/email-intent-opencode.json` is the authored policy, installed by the Containerfile
at `/opt/air/opencode/config/email-intent-opencode.json` — deliberately NOT in the deployment's
global configuration directory, which the engine merges for EVERY launch. The factory reads the
installed copy when present and the development-tree spelling otherwise, then validates it before
injecting it as the engine's final override (`OPENCODE_CONFIG_CONTENT`):

- exactly one provisioned primary agent (`email-intent`) whose permission map denies the wildcard
  AND every shipped native surface explicitly (read, edit, glob, grep, list, bash, task,
  external_directory, webfetch, websearch, lsp, skill, question, todoread, todowrite, doom_loop);
- the engine's built-in agent roster (`build`, `plan`, `general`, `explore`, `scout`, `compaction`,
  `title`, `summary`) disabled, because a built-in agent's own ruleset would override the
  top-level denial; and
- no permissive (`allow`/`ask`) rule, no unprovisioned agent, no unprovisioned top-level key
  (plugin, MCP, skills, instructions, commands, compaction) and no `{file:...}` reference.

A document that fails any of these never launches. The real executable then advertises exactly
one selectable session mode (`email-intent`) and rejects mode switches to `build`/`plan`/`yolo`,
which the native acceptance leg asserts.

### Provider-only provisioning

The composed document adds the selected provider's declaration, the selected model and a
provider allow-list — nothing else. The provider options/catalog come from the deployment's own
authored catalog: the DEPLOYED ordinary OpenCode document
(`{daemon HOME}/.config/opencode/opencode.json`) when it exists, otherwise
`agent-config/opencode.json`. It is read, never modified, and only the selected provider's entry
is copied, so ordinary agents, plugin, MCP servers, skills, instruction discovery, compaction
policy and previous auth/session state stay out of this launch entirely.

The selected model provider's authentication is the ONE credential this profile may carry. It is
resolved from `{env:NAME}` references INSIDE the selected catalog entry, so the catalog itself
declares which variable holds its key. A reference to reserved variables (HOME, TMPDIR, PATH,
XDG_*/OPENCODE_* engine and config selectors), to mailbox/Skill API material (`EMAIL_*`,
`SKILL_*`), to bot platform tokens (`DISCORD_*`, `MISSKEY_*`) or to any password/secret name is
refused, as is a `{file:...}` reference. A required credential that the environment does not
provide refuses the launch rather than starting an unauthenticated interpretation.

### Private runtime roots

Every launch allocates a FRESH private `HOME` (mode 0700) with its XDG config/data/cache/state and
`TMPDIR` beneath it, plus an EMPTY working directory. Both must be absolute, must not be symlinks
or redirect through one, must not already contain entries, must not lie inside any repository
ancestry (`.git` in the ancestor chain), and must not overlap the daemon's own home. This layout,
not a permission list, is what removes discovery: with no ordinary home and no project directory
there is nothing for the engine to discover.

The returned `runtimeMounts` is METADATA describing those private roots for a confinement builder;
this factory applies no sandbox of its own (its API carries no `Config`). The profile also carries
NO `skillsRoot`: it provisions no skill tree, so a consumer that requires one — the ordinary
`AgentConnector.connect()` does — must handle the profile explicitly.

### Exported API

- `createEmailIntentAgentConfig(backend, providerSelection, temporaryRoots, options?) -> AgentConfig`
  - `backend`: `"opencode"` (the OMP intent profile is owned by `email-omp-intent-profile`)
  - `providerSelection`: `{ providerID, modelID }`
  - `temporaryRoots`: `{ home, cwd }` (allocated by the factory)
  - `options`: injectable `{ exists?, readFile?, env?, catalogPath?, authoredConfigPath? }`
- Constants: `EMAIL_INTENT_PROFILE`, `EMAIL_INTENT_AGENT_NAME`,
  `EMAIL_INTENT_DENIED_NATIVE_SURFACES`, `EMAIL_INTENT_DISABLED_BUILTIN_AGENTS`,
  `EMAIL_INTENT_OPENCODE_CONFIG_PATH`, `EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH`,
  `EMAIL_INTENT_ORDINARY_CONFIG_PATH`
- Types: `EmailIntentProviderSelection`, `EmailIntentTemporaryRoots`, `EmailIntentProfileOptions`

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-opencode-intent-profile/specs/email-opencode-intent-profile/spec.md`:

- **Native read and network attempts**: the scripted loopback model requests read, bash,
  webfetch, websearch, skill and an unknown tool; each is denied with zero filesystem, network or
  skill side effects.
- **Fresh HOME launch**: the selected model is advertised, the active mode is `email-intent`, and
  no normal build/yolo policy is loaded.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/acp/email-opencode-profile.test.ts
EMAIL_INTENT_OPENCODE_ACCEPTANCE=1 deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/integration/email-intent/opencode-native.test.ts
```

The native leg is UNEXERCISED (ignored) without `EMAIL_INTENT_OPENCODE_ACCEPTANCE=1`; with it,
every unavailable prerequisite fails the test naming the reason instead of claiming native
success. It uses the real installed executable plus a test-owned loopback provider and never a
paid or public model. Production activation selects the profile backend through the deployment's
default agent type and its model-routing rules.

## Email Platform Adapter (Owned by `email-adapter`)

`src/platforms/email/email-adapter.ts` is the single platform-facing face of the email platform.
`EmailAdapter` composes the serialized IMAP poller (receiving), the owner message store (thread
history) and the durable mail service (every outbound path); it never talks to IMAP or SMTP itself
and never invents durable state. Production activation registers it with the platform registry and
`AgentCore` before connecting it.

### Receiving

- Accepted mailbox work is emitted through the same normalized-event entry point as Discord and
  Misskey: `platform: "email"`, `channelId` = `mail:<owner>:<thread>` (both components validated),
  `userId` = the verified sender's canonical owner id (`e_<sha256>`), `username` = the verified
  sender address, `messageId` = the stored record id, `isDm: true`, empty `guildId`, the stored
  body as `content`, owner-scoped `LocalEmailAttachment` references as `attachments`, and the
  typed durable work receipt (`kind: "email-work"`, `workId`, `mailboxKey`, `recordId`).
- A work item whose stored record is unreadable emits NOTHING: the hand-off fails, the poller logs
  it and the durable acceptance survives, so the next round re-emits the same work instead of a
  fabricated or empty message.
- `connect()` runs the poller's startup recovery and then its serialized rounds; `disconnect()`
  stops accepting work, lets the in-flight round and its hand-off settle, clears the round timer
  and disconnects. `connect()` is idempotent, so a repeated call never arms a second timer.
- `poll()` exposes exactly one round for controlled smoke checks and deterministic tests; rounds
  still never overlap and still honour `disconnect()`.

### What email supports, and what it refuses to pretend

| Capability | Email | Behavior |
| ---------- | ----- | -------- |
| Owner-thread history | yes | `fetchRecentMessages`/`fetchMessage` are owner+thread gated by the channel id |
| Ordinary replies | yes | threaded reply to the verified original sender, via the mail service |
| File delivery | yes | one email carrying the whole batch; the existing count/aggregate limits apply |
| Private messages | yes | every email event is `isDm: true`; channels are `mail:<owner>:<thread>` |
| Editing a sent message | **no** | explicit unsupported result; NEVER emulated by another send |
| Reactions | **no** | explicit unsupported result; no message is sent |
| Typing indicator | **no** | `supportsTypingIndicator()` is `false`; `sendTyping` performs no network action |
| Guilds / message search | **no** | no `searchRelatedMessages`; `canSearchMessages` is `false` |
| Custom emoji catalog | **no** | `fetchEmojis()` returns an empty list; Unicode emoji need no listing |

Discord and Misskey declare `supportsEditing: true`; email declares `false`, so `edit-reply` on an
email session fails explicitly (`SKILL_EDIT_UNSUPPORTED`) before any adapter call, and a failed or
uncertain submission is never recorded as a delivered reply.

### Outbound operation context (host-assigned only)

Every email send requires `EmailSendContext` (`{ workId, owner, actionSlot? }`) from the host
session/scheduler — carried on `ReplyOptions.emailSend` / `SendFileOptions.emailSend`, which the
skill handlers copy from `SkillContext.emailSend`. It is never read from tool parameters or a
request's `platformSpecific` data, so a model cannot choose the logical operation its mail is
bound to. A send without it is refused before any construction or SMTP work.

**Producer wiring is a named dependency, not part of this change.** `EmailAdapter`,
`ReplyHandler`, `FileHandler` and `SkillContext` consume the context; the session/scheduler that
owns a work item must populate it (`email-response-accounting` for sessions and the Skill API,
`email-reminder-threads`/`email-spontaneous-targets` for their lanes, and `email-activation` for
the final wiring). The value is fully derivable from data the host already holds: for inbound
mail, `workId` is the durable `emailWork` receipt's `workId` and `owner` is the owner encoded in
the event's `mail:<owner>:<thread>` channel id. Until a host supplies it, every email send is
refused (fail closed) rather than guessed — nothing is ever sent to an inferred recipient.

The operation slot is bound as follows:

| Send | Slot |
| ---- | ---- |
| Ordinary reply (`send-reply`) | `reply` |
| Ordinary file delivery (`send-file`) | `files` |
| Host-assigned partitioned operation | `third-party:<grantId>` / `reminder:<id>` / `spontaneous:<tickId>`, used verbatim |

A reply and a file delivery in one session therefore never share an operation key (which would
silently reuse the first result instead of sending the second message). A caller performing several
sends for one `workId` must give each send a distinct slot.

### Recipient, thread and outcome rules

- The recipient is the verified original sender, re-derived from the owner thread: the newest
  inbound record's stored address is re-normalized and accepted only when its owner id matches the
  thread owner. `Reply-To`/`Cc`/`Bcc` are never consulted, the stored address is never trusted
  unchecked, and the mail service re-checks the allowlist immediately before submission.
- The reply stays in the thread: `In-Reply-To`/`References` come from the thread anchor the session
  resolved. A source that carries no wire identifiers at all is refused rather than answered
  unthreaded.
- Outcome reporting never over-claims: only `submitted` is reported as a delivered reply/file; a
  `failed` or `unknown` submission is reported as such with its `emailSubmission` metadata
  (`operationId`, `phase`, `safeCode`), is never marked as a delivered reply and is never retried
  blindly. A repeated request for the same logical operation returns the recorded result with zero
  additional SMTP transactions.
- `emailSubmission.reused` is `true` exactly when a repeated request was answered from the
  recorded operation instead of submitting again. One logical operation is one message, so a host
  that performs several distinct sends for one work item must give each send its own slot; a
  distinct send that reuses an existing slot is answered from the journal and never reaches the
  wire.
- File delivery reports at most one delivered message id (one email carries the whole batch), and a
  batch that exceeds the message size bound fails entirely before construction or SMTP.

### Threads for scheduled and spontaneous use

`getDmChannelId(owner)` allocates a NEW internal owner thread and returns `mail:<owner>:<thread>`,
but only for a canonical owner id that currently has an enabled `email/account/<owner>` channel;
anything else returns `null`. `determineSpontaneousTarget` selects among enabled accounts opted
into spontaneous posting and resolves each through the same path (the durable occurrence identity
that binds such a thread is owned by `email-spontaneous-targets`).

A brand-new thread contains no source message yet, so an ordinary reply into it is refused (there
is no verified recipient and no thread anchor). Delivering a message into a new thread for
scheduled or spontaneous use — including the drafting rules and the allowlist rechecks — is owned
by `email-spontaneous-targets`.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-adapter/specs/platform-abstraction/spec.md`:

- **Threaded reply smoke**: valid source is loaded and the adapter replies through the local
  services; `In-Reply-To`/`References` preserve the thread and the SMTP recipient is the verified
  sender only.
- **Edit delivered email**: editing targets email; an explicit unsupported result is returned and
  zero SMTP transactions occur.
- **Batch too large**: the file count or the total size exceeds the configured send-file limits;
  the entire request fails before construction or SMTP and no partial delivery is claimed.

### Exported API

- `EmailAdapter` with options
  `{ config, transport, mailboxStore, messageStore, mailService, channels, onReviewRequired?, onCycleError?, batchLimit?, historyLimit?, workIdFactory? }`
  - `connect()` / `disconnect()` — poller lifecycle (idempotent connect; draining stop)
  - `poll()` — one deterministic round through the owned poller
  - `sendReply(channelId, content, options?)`, `sendFile(channelId, files, options?)`
  - `fetchRecentMessages(channelId, limit)`, `fetchMessage(channelId, messageId)`
  - `getDmChannelId(owner)`, `determineSpontaneousTarget(config)`
  - unsupported results: `editMessage`, `addReaction`, `sendTyping`, `fetchEmojis`,
    `hasBotReaction`, `hasBotMention`; `supportsTypingIndicator()` is `false`
- Constants: `EMAIL_REPLY_ACTION_SLOT` (`"reply"`), `EMAIL_FILES_ACTION_SLOT` (`"files"`)
- Types: `EmailAdapterOptions`; `EmailSendContext` and the optional
  `PlatformCapabilities.supportsEditing` live in `src/types/platform.ts`, and
  `SkillContext.emailSend` in `src/skills/types.ts`

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/platforms/email/email-adapter.test.ts
```

The tests use the real stores, the real poller, the real mail service, the in-process IMAP fixture
and a scripted SMTP double; no production credential or mailbox is used. Production activation is
covered by `tests/core/email-bootstrap.test.ts` and
`tests/integration/email-platform.integration.test.ts`.

## Native OMP Intent Profile (Owned by `email-omp-intent-profile`)

`src/acp/agent-factory.ts#createEmailIntentAgentConfig("omp", ...)` owns the INTERNAL native
deny-all OMP profile an approved email interpretation launch runs under. It exists because the
OpenCode document cannot constrain native OMP, and because the pinned native settings schema has
NO wildcard default-deny key: a single layer can never close names it cannot enumerate.

### It is not a mode anyone can select

The profile is the `omp` arm of the SAME separate factory entry point
`createEmailIntentAgentConfig`; `createAgentConfig` never reaches it, and no configuration field,
dashboard request, environment variable or ACP request can name it. OMP has no ACP session-mode
selector at all, so the profile is fixed at process launch. The returned `AgentConfig` carries
`executionProfile: "email-intent"` for the consumer's fail-closed check. Ordinary OMP launches are
byte-compatible: restricted and native-YOLO keep their existing `--config`/`--system-prompt`/
`--trusted-extension` argv, their inherited HOME and their mode-scoped native data roots, and
carry no profile identity and no intent marker.

### Two denial layers

- **Native layer** — `agent-config/omp/email-intent.yml`, installed by the Containerfile at
  `/opt/air/omp/config/email-intent.yml` (beside the ordinary mode documents, never in the native
  config home). It pins the non-YOLO `approvalMode: write`, denies every shipped native surface by
  EXACT name (`read`, `grep`, `glob`, `find`, `todo`, `web_search`, `bash`, `edit`, `write`,
  `delete`, `move`, `lsp`), disables skills with no skill directory, and authors no permissive
  (`allow`) or prompting (`ask`) record. The contracted surface list is derived from the
  deployment's own frozen `OMP_TOOL_CAPABILITY_MAP` plus `lsp`, and the factory validates it in
  BOTH directions: an authored denial outside the contract, a missing denial, a permissive entry,
  a drifted approval mode or an unprovisioned key refuses the launch.
- **Pre-dispatch layer** — the SAME generated trusted-extension bundle the ordinary restricted
  launch loads (`deno task bundle:omp-extension`; no second bundle, no generated YAML, no runtime
  fallback). The pinned synchronous `api.on("tool_call")` hook returns
  `{block: true, reason: "rejected_email_intent_profile"}` for EVERY name when the host-only child
  marker `OMP_INTENT_PROFILE=1` is observed, so shipped, unknown, deployment-extension and
  prototype-shaped names are all stopped before dispatch, independently of any ACP permission
  callback. Ordinary restricted launches keep their capability callback unchanged. The marker is
  read exactly once per process and the classification FAILS CLOSED: only a positively observed
  absent marker selects the restricted callback, so a launch whose environment cannot be read at
  all attaches the deny-all callback instead.

The marker is a factory-set child variable only: it is not a configuration field, not an
`ENV_MAPPINGS` entry, not reachable from a prompt or tool request, and every ordinary launch builds
its child environment from scratch. The consumer must therefore spawn this config with `clearEnv`
semantics and the returned `env` VERBATIM: the marker is the launch's own identity, so it must
never be routed through an environment allow-list or filter (the ordinary sandbox's `filterEnv`
pass keeps only a permitted subset and would drop it) — and a launch whose marker is absent
classifies as an ordinary one, which would silently select the restricted capability callback and
lose the pre-dispatch denial layer. `tests/acp/email-omp-profile.test.ts` pins the launch's exact
environment key set so an accidental addition is visible too.

### Provider-only provisioning

The selected provider is validated against the deployment-authored native model configuration and
then provisioned ALONE:

- the authored bytes (`agent-config/omp/models.yml`, or the deployed
  `~/.omp/agent/models.yml` when present) are copied BYTE-FOR-BYTE into the launch's private native
  config home and read back to prove the copy — the document is never parsed into a second
  document, reserialized or generated;
- the catalog must declare exactly the selected provider, and the selected model when that
  provider declares one; any other declared provider refuses the launch, because the authored file
  is the provider-scoping trust boundary;
- the selected provider's model credential is forwarded through a closed deployment mapping
  (`openrouter` → `OPENROUTER_API_KEY`, `gemini`/`google` → `GEMINI_API_KEY`); a provider outside
  that mapping launches only when its authored entry declares `auth: none`, and then receives no
  credential. A required credential the environment lacks refuses the launch.

No skill tree, no `SKILL_JWT_DIR`, no mailbox or platform secret, no engine config selector, no
prompt mount and no previous auth/session state exist on this path. Native extras are not
extracted per launch either: the private data root's reserved `natives` entry is linked to the ONE
prepared shared payload (`src/utils/omp-native-cache.ts`), whose location, completeness and
executable identity are validated before launch.

### Private runtime roots

Every launch allocates a FRESH private HOME (mode 0700) with its XDG data/cache/state and `TMPDIR`
beneath it, plus an EMPTY working directory. Both must be absolute, must not be symlinks or
redirect through one, must not already contain entries, must not lie inside any repository
ancestry, and must not overlap the daemon's own home — the same private-root contract the
OpenCode arm uses. `XDG_CONFIG_HOME` is deliberately NOT relocated: native OMP resolves its agent
directory from HOME (`~/.omp/agent/models.yml`), so a moved config home would put the authored
model file out of reach. The private HOME is writable in its entirety, so the copied model file is
the engine's own; the authored source document and the generated bundle stay read-only inputs and
the shared payload is a read-only bind.

### Exported API

- `createEmailIntentAgentConfig("omp", providerSelection, temporaryRoots, options?) -> AgentConfig`
  - `providerSelection`: `{ providerID, modelID }`
  - `temporaryRoots`: `{ home, cwd }` (allocated by the factory; must be fresh)
  - `options`: the shared profile seams (`exists?`, `readFile?`, `env?`, `catalogPath?` for the
    authored model file, `authoredConfigPath?` for the authored settings document) plus the OMP
    additions `ompNativeCache?` (`{ installRoot?, launchExecutableVersion? }`) and
    `ompNativeCacheForbiddenRoots?` (the backup/workspace roots a payload must not live inside)
- Constants: `EMAIL_INTENT_OMP_CONFIG_PATH`, `EMAIL_INTENT_OMP_IMAGE_CONFIG_PATH`,
  `EMAIL_INTENT_OMP_MODELS_PATH`, `EMAIL_INTENT_OMP_NATIVE_SURFACES`,
  `EMAIL_INTENT_OMP_APPROVAL_MODE`, `EMAIL_INTENT_OMP_PROVIDER_CREDENTIALS` (plus the shared
  `EMAIL_INTENT_PROFILE`)
- Helpers: `ompHomeModelsPath`, `ompIntentXdgDataHome`, `ompIntentNativeDataDir`,
  `ompIntentNativesLinkPath` (`src/utils/omp-paths.ts`), `observeOmpLaunchMarker`,
  `createOmpIntentToolCallHandler`, `createOmpToolCallHandler`, `OMP_INTENT_PROFILE_FLAG`,
  `OMP_INTENT_PROFILE_FLAG_VALUE`, `OMP_INTENT_BLOCKED_REASON`
  (`src/acp/omp/extension/native-registration.ts`)

Consumers: `email-intent-runtime` drives this launch shape and owns the ACP callback layer;
`email-spontaneous-targets` and the final activation apply to the occurrence/guard APIs, not here.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-omp-intent-profile/specs/email-omp-intent-profile/spec.md`:

- **Mapped and unknown tools**: real native OMP receives scripted read, bash, `web_search`, a
  deployment-extension tool and custom unknown tool calls; every call is blocked before execution
  with zero file/network/skill effects.
- **Development and image launch**: the intent launch starts from the authored native settings,
  the existing generated bundle and a private copy of the authored model configuration, without
  importing user sessions or mailbox credentials; normal restricted/native-YOLO launches keep
  their existing behavior.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/acp/email-omp-profile.test.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/acp/omp-native-registration.test.ts
EMAIL_INTENT_OMP_ACCEPTANCE=1 deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/integration/email-intent/omp-native.test.ts
```

The native leg is UNEXERCISED (ignored) without `EMAIL_INTENT_OMP_ACCEPTANCE=1`; with it, every
unavailable prerequisite fails the test naming the reason instead of claiming native success. It
requires the real pinned executable (`omp` 18.6.1), the generated extension bundle and a prepared
native payload, uses a test-owned loopback provider plus the tracked loopback model fixture, and
never contacts a paid or public model. Production activation selects this backend through the
deployment's default agent type.

## Isolated Intent Interpretation Runtime (Owned by `email-intent-runtime`)

`src/core/email-intent-runtime.ts` runs ONE interpretation of the current authored request on an
isolated private launch of either engine. It consumes the two completed native deny-all profiles
(`email-opencode-intent-profile`, `email-omp-intent-profile`) and adds the ACP callback layer, the
bounded capture and the teardown; it implements no native policy of its own.

### What an interpretation gets

- Only the current authored text. No history, no thread, no attachments, no quoted material.
- A FRESH private HOME and an empty working directory per interpretation, allocated beneath one
  exclusively-owned base directory (`email-intent-runtime-*`) that this runtime reclaims itself.
- Exactly the selected model provider's authentication, and nothing else: the profile factory
  refuses or omits the mailbox credentials, the Skill API material (token, pointer, JWT), bot
  platform tokens, external MCP servers and every ordinary engine/config selector. The runtime
  additionally never hands the session a skill registry, a trusted skill root or a Skill session id.
- An EMPTY script inventory and a DENY-ALL callback layer: a permission request, a filesystem
  read/write callback and a `tool_call`/`tool_call_update` notification are all observed and refused
  before any ordinary approval path (YOLO, registered-skill, read admission, edit/write) can run.
- A content-blind ACP client. Final agent text reaches the runtime's in-memory bounded capture; the
  engine's stream chunks, tool notifications, thoughts and stderr never reach a log, an audit entry
  or a file.
- A capture bound to ONE prompt turn: only text that arrives on the interpretation's own session
  while its authored prompt is in flight can become the answer. Setup chatter, another session's
  text and post-turn noise are dropped, while a tool attempt made at ANY point (including during
  setup) still fails the interpretation closed.

### Hard failure behavior (fail closed)

`EmailIntentRuntime.interpret({ authoredText, model, backend })` always resolves; it never throws
and it never returns partial output. Its result is either
`{ status: "complete", text }` or `{ status: "unavailable", reason }` with one of:

| reason               | when                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| `profile_unavailable` | the profile could not be built, or the launch/session did not prove its identity    |
| `tool_attempted`      | the model attempted a tool, filesystem, MCP or skill operation                      |
| `timeout`             | the 30-second deadline expired                                                      |
| `output_overflow`     | captured text exceeded 8 KiB (the whole capture is discarded, never truncated)      |
| `incomplete_output`   | no text, blank text, or a prompt that did not stop with `end_turn`                  |
| `session_failed`      | connect, session creation or dispatch failed                                        |

Identity is verified twice before the authored text moves: the launch read back off the factory's
own config (`executionProfile`, plus the host-only OMP marker REQUIRED to carry its exact value),
and the created session itself — the OpenCode session must advertise the authored intent agent as
the ONE active AND selectable session mode, and a session advertising a model selector that is not
already on the requested `${providerID}/${modelID}` is pinned to it, with the resulting active mode
and model re-verified against the engine's own response. Every refusal happens BEFORE any prompt is
dispatched.

Teardown is producer-safe: the private roots are removed only when quiescence is positively proven
(no wrapper was ever spawned, or the connector observed the wrapper exiting within its own grace
period). An unconfirmed exit — including a wrapper that had to be SIGKILLed — retains the roots
with a bounded warning `Retaining email intent private roots: the launched wrapper's exit is
unconfirmed` instead of reclaiming files a live engine could still be using, and the runtime never
logs, audits or persists authored text, captured text or engine stderr.

### Accepted limitation (model judgment)

Interpretation remains model judgment. An isolated, deny-all, bounded session raises the cost of a
prompt-injection or tool-abuse attempt; it does not make the model's reading of the authored text
correct, and it is not an authorization decision. The strict decision JSON, the destination grants
and the session/work binding are owned by later changes (`email-destination-grants` and its
consumers). `complete` therefore means "the interpreter produced a bounded text", never
"the request is authorized".

### Exported API

- `EmailIntentRuntime.interpret({ authoredText, model, backend }) -> Promise<EmailIntentResult>`
  - `model`: `{ providerID, modelID }` (row 16/17 profile selection)
  - `backend`: `"opencode" | "omp"`
  - `EmailIntentResult`: `{ status: "complete", text } | { status: "unavailable", reason }`
- Constructor options: `{ config, logger, deadlineMs?, maxOutputBytes?, rootsBase?, profileOptions?,
  connectorFactory? }`. `deadlineMs`/`maxOutputBytes` may only TIGHTEN the hard bounds
  (`EMAIL_INTENT_DEADLINE_MS` = 30 s, `EMAIL_INTENT_MAX_OUTPUT_BYTES` = 8 KiB).
- Internal seams: `EmailIntentConnector` / `EmailIntentConnectorFactory` (the `AgentConnector`
  connect/createSession/prompt/cancel/disconnect lifecycle), and the ACP-layer
  `ClientConfig.intentCapture` / `EmailIntentSessionCapture` deny-all + capture contract.
- ACP-layer identity error: `EmailIntentProfileMismatchError` (bounded `reason` enum).

The module is an internal host API: there is no skill endpoint, no dashboard surface and no
configuration field that reaches it. Production activation constructs it behind the destination
preflight and the model/backend selection described above.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-intent-runtime/specs/email-intent-runtime/spec.md`:

- **Isolated interpretation**: a model attempt at a shell, filesystem, MCP or skill operation
  produces no tool effect and an `unavailable` result — not merely a denied call.
- **Bounded private interpretation**: output beyond 8 KiB or execution beyond 30 seconds returns no
  partial output, and the interpretation's resources are safely reclaimed.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/acp/email-intent-runtime.test.ts
```

`tests/acp/email-intent-runtime.test.ts` drives the real runtime, the real `AgentConnector` and the
real `ChatbotClient` against a scripted fake ACP engine
(`tests/acp/fixtures/email-intent-acp-engine.ts`) for BOTH engines: success capture, timeout,
8 KiB + 1 overflow, exactly-8-KiB success, tool attempt through a permission request, a tool-call
notification and both filesystem callbacks (with a filesystem sentinel proving zero tool effect),
incomplete output, refused profiles, mode/model pinning, stderr and capture privacy, root
reclamation, and the unchanged ordinary connector path. The subprocess-backed cases self-skip when
`dumb-init` is unavailable. No provider, credential or network is contacted, and no real
`opencode`/`omp` executable or model judgment is claimed.

## Immutable Session Destination Grants (Owned by `email-destination-grants`)

`src/core/email-intent-preflight.ts` owns pre-send third-party destination authorization. A
third-party email (compose or forward) belongs to the authenticated user's CURRENT session and is
authorized by exactly one thing: an explicit instruction in the request that user wrote in this
message. The producer derives that authorization before the sending agent starts; the sending tool
may USE a grant and can never create or enlarge one.

### The producer is separate from the sending model

- The orchestrator consults the producer only for an authenticated email request session that
  carries its typed durable work receipt (`EmailWorkReceipt`) AND its current authored request
  (`NormalizedEvent.emailAuthoredRequest`, populated by the email adapter from the MIME provenance
  parser's authored segment plus its authorship verdict). Discord, Misskey, reminders, spontaneous
  posts and every triggerless session are never consulted and no registry state is written for them.
- The interpretation runs through the predecessor `EmailIntentRuntime` on a fixed host instruction
  envelope: the strict decision schema plus the current authored text, delimited and labeled as
  data. No history, thread, attachment or quoted material is included, and the runtime keeps its
  isolated deny-all, bounded (30 s / 8 KiB) contract.
- The producer owns the strict JSON validation, the recipient/source checks and the session/work
  binding. The sending model receives grants read-only; there is no API — no skill endpoint, no tool
  parameter, no dashboard field — that adds, replaces or widens one.

### Fail-closed decisions

`derive()` returns one of:

| Outcome   | When                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`    | the session is not an authenticated email request session, or the request did not ask for a third-party delivery                                                 |
| `clarify` | ambiguous authorship, blank/oversized authored text, an unavailable or invalid interpretation, an address absent from the authored text, or an unprovable forward source |
| `grant`   | every requested action was validated; the grants are frozen records the caller can only record or read                                                           |

Only a `"clean"` provenance verdict is even interpreted: an ambiguous authorship boundary asks the
user instead of guessing. A `clarify` outcome also prefixes ONE fixed host directive to the session
prompt, so the normal agent asks the user to confirm the destination, the action and — for a
forward — the source message, without sending anything. The authorization boundary is the absent
grant, never that sentence.

### Grant records and their lifetime

A `DestinationGrant` is `{ grantId, sessionId, workId, owner, action: "compose" | "forward",
canonicalRecipient, sourceRecordId?, requestDigest }`:

- `grantId` is host-assigned; multiple explicitly requested actions receive separately identified
  grants (identical action/recipient/source duplicates collapse into one).
- `canonicalRecipient` is the deployment's own `normalizeEmailMailbox` form of an address that
  occurs as a COMPLETE mailbox token in the current authored text. Domain case and IDNA form are
  equivalent; local-part case and plus tags stay distinct, exactly like the deployment's mailbox
  identity. A substring of a larger address never qualifies.
- `sourceRecordId` is present for `forward` only, and only after an injected resolver proves the
  record belongs to the owner's accessible history. Without that proof — or with a resolver that
  fails — no grant is produced.
- `requestDigest` is SHA-256 over the exact request binding, so a grant cannot be replayed for a
  different session, work item, owner, provenance verdict or authored text.

Grants live on `ActiveSession.emailDestinationGrants`, written exactly once by
`SessionRegistry.recordEmailDestinationGrants(sessionId, grants)` before the agent starts. An empty
array latches "this session may not send to any third party", so a later derivation, retry or tool
parameter can never widen it. The verdict dies with the registry entry (session end, removal or idle
expiry); nothing is persisted, and no later session, reminder or spontaneous post inherits it.
`SkillContext.emailDestinationGrants` exposes the recorded set to handlers READ-ONLY.

### Accepted limitation (model judgment)

Interpretation remains model judgment. The host enforces the authorship boundary, the destination
occurrence and the grant binding, so the sending model cannot choose a destination outside the
user's own written instruction — but an authorized destination can still receive inappropriate
generated content if the model misreads the request, and this is NOT model-proof authorization
against prompt injection. This residual risk was explicitly accepted by the platform design.

### Exported API (consumers: `email-compose-skill`, `email-forward-skill`, `email-response-accounting`)

- `EmailDestinationGrantPreflight` with options
  `{ interpreter, selection, select?, resolveForwardSource?, newGrantId?, digest? }`
  - `derive(request) -> Promise<EmailDestinationGrantOutcome>` where `request` is
    `{ sessionId, workId, owner, origin, authoredText, provenanceStatus, selectionContext }`
  - `EmailDestinationGrantOutcome`: `{ decision: "none" } | { decision: "clarify", reason } |
    { decision: "grant", grants }`
- `DestinationGrant`, `EmailIntentAction`, `EmailIntentDecision`, `EmailIntentActionRequest`
- `EmailDestinationClarificationReason` (bounded, content-free enum)
- `parseDecision(text)`, `extractAuthoredMailboxes(text)` (strict validation seams), and the bounds
  `EMAIL_DESTINATION_GRANT_MAX_AUTHORED_BYTES` (8 KiB) / `EMAIL_DESTINATION_GRANT_MAX_ACTIONS` (8)
- `SessionRegistry.recordEmailDestinationGrants(sessionId, grants): boolean` (host-only, one-shot)
  and `SessionRegistry.emailDestinationGrantsOf(sessionId): readonly DestinationGrant[]`
- `SessionOrchestrator.setEmailDestinationGrantPreflight(preflight | null)`

The module is an internal host API; production activation installs it on the orchestrator before
any adapter connects.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-destination-grants/specs/email-destination-authorization/spec.md`:

- **Quoted destination only**: an address that appears only in forwarded/quoted content or
  attachments produces no grant.
- **Preflight invalid**: a timeout, invalid JSON, a tool attempt or ambiguous authorship leaves no
  grant and instructs the normal agent to clarify without sending.
- **Stale or altered request**: a later session or tool supplying a different recipient, source or
  action cannot use the original grant to authorize that delivery.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys \
  tests/core/email-destination-preflight.test.ts tests/core/email-destination-grants-runtime.test.ts
```

`tests/core/email-destination-preflight.test.ts` drives the real preflight, the real `SessionRegistry`
and the real `SessionOrchestrator` lifecycle with a scripted interpreter and connector stub:
authored-only grants, quoted-only and substring addresses, canonicalization boundaries (domain case
and IDNA equivalence versus local case and plus tags), ambiguity and oversized-text refusal without
an interpretation, an unavailable/throwing interpreter, invalid decision JSON, forward source
proof and refusal, all-or-nothing multi-action validation, frozen and one-shot recording, session
death and idle expiry, the prompt directive for a clarification, and the untouched
Discord/Misskey/no-authored-request paths. `tests/core/email-destination-grants-runtime.test.ts`
runs the SAME preflight against the REAL `EmailIntentRuntime` for BOTH engines with an in-process
stub engine answering through the intent-capture seam, proving the envelope reaches the real
profile, a tool attempt fails the grant closed, and non-JSON output never grants. No provider,
credential, real engine executable or model judgment is claimed.

## User-Directed Email Composition (Owned by `email-compose-skill`)

`skills/send-email/*` and `src/skills/email-handler.ts` own third-party composition: the agent asks
to send a NEW message to a destination the user explicitly named in the current request, and the
host handler is the authorization producer that turns that request into exactly one
`EmailMailService.send` call.

### The request-file contract

Recipient, subject and body are never shell arguments. The script accepts only `--session-id`,
`--grant-id` and `--request-file`; the request file is a strict JSON object inside the session
staging directory (`{workspace}/tmp/{sessionId}`):

```json
{
  "to": "someone@example.org",
  "subject": "Subject of the new message",
  "body": "The message text.",
  "attachments": ["<absolute staging directory>/report.pdf"]
}
```

- `--to`, `--subject` and `--body` are refused with `SKILL_LEGACY_FLAG` (both `--flag value` and
  `--flag=value`), before any file is read, so a shell-expanded `$` value cannot corrupt the
  message, leak the subprocess environment, or bypass the containment boundary. The rejection is
  opt-in per script (`readPayloadArg({ extraFreeTextFlags })`), so every other skill's behavior is
  byte-for-byte unchanged.
- The script resolves the invocation's OWNING session (`resolveOwningSessionId`) FIRST and refuses a
  `--session-id` that names another session with `SKILL_SESSION_MISMATCH`: a sibling session's
  staged request can neither be read nor deleted, and nothing reaches the API in that case.
- A request file that is not one JSON object fails with `SKILL_COMPOSE_REQUEST_INVALID`; a payload
  outside the staging boundary fails with `SKILL_PAYLOAD_OUT_OF_BOUNDS` /`SKILL_PAYLOAD_NOT_FOUND`
  exactly like every other payload skill.

### Host authorization (fail closed, before any file read)

`EmailComposeHandler` re-validates every field and decides the destination BEFORE any attachment is
stat'ed or read:

1. Only an authenticated, user-triggered email session may compose: the platform must be `email`,
   the Skill API session id must be present, and the durable email work id must come from the host
   (`emailWorkId`, or a consistent `emailSend` context). A host context that disagrees with the
   session's own owner or work item is refused rather than overridden.
2. The request must carry EXACTLY `to`, `subject`, `body` and optional `attachments`. `Cc`, `Bcc`
   and arbitrary headers have no representation, so an unknown key is refused with
   `SKILL_EMAIL_COMPOSE_REQUEST`, as are a multiline/invalid `to` or `subject`, a non-string body,
   and a message with neither body text nor an attachment.
3. The destination is matched against the session's IMMUTABLE grants (`SkillContext
   .emailDestinationGrants`, row 19): with `--grant-id`, the grant must exist, be a `compose` grant
   of exactly this session, work item and owner, and its `canonicalRecipient` must equal the
   canonical form of the requested `to`. The operation slot becomes `third-party:<grantId>` and the
   draft uses `targetKind: "third-party"` (the grant is the authority; the mail service's allowlist
   recheck applies to user targets only).
4. Without a grant id, the ONLY allowed destination is the session's own verified sender (the
   ordinary reply target, whose canonical user id equals the session owner). It binds the ordinary
   `compose` slot and `targetKind: "user"`, so the mail service's current-allowlist recheck applies.
   Any other address is refused with `SKILL_EMAIL_COMPOSE_GRANT` and a message teaching the grant
   flow; no request parameter can create or widen a grant.
5. Attachments are opt-in and session-staging-contained: the boundary is the LEXICAL staging root
   `{workspace}/tmp/{sessionId}`, and both the requested path and its symlink-resolved real path must
   stay inside it, so a symlinked staging root or intermediate component fails closed instead of
   becoming the authorized base. Only regular files are accepted, the reused send-file limits
   (`maxFilesPerInvocation`, `maxFileSizeMb`, `maxTotalSizeMb`, `allowedExtensions`) are enforced in
   two passes so a refused batch reads nothing, and the read itself is bounded by the preflighted
   size — a file that changed (grown, shrunk or replaced by an escaping symlink) between preflight
   and read is refused instead of attached. Nothing in the workspace (memories, notes, history) is
   ever attached automatically, and `sendFile.enabled` is irrelevant to composing. Residual risk:
   like the shared payload contract, a concurrent process could still swap a validated file for a
   same-size one inside the window between the post-read realpath check and the read itself; the
   session's own agent already owns that directory, so this is not a destination-grant bypass.
6. The configured signature is applied centrally by the MIME builder, exactly once. The skill
   document states explicitly that the model must not add one.

### Durability, idempotency and audit

- The operation key is host-derived (`{workId, actionSlot}`): `third-party:<grantId>` for a granted
  destination, `compose` for the session's own sender. A repeated call for the same logical
  operation therefore returns the RECORDED journal result (`emailSubmission.reused: true`) with zero
  additional SMTP transactions; two different grants are two distinct operations. A second
  self-compose inside one work item reuses the first one by design.
- `send-email` is a side-effect skill for the Skill API: a recovery-fenced session is rejected (409)
  and crash recovery waits on the same in-flight lease as reply/file sends. Session expiry after
  admission does not cancel the durable result.
- The result carries `EmailSubmissionMetadata` (`operationId`, `phase`, `reused`, `safeCode`) to the
  skill output, and a non-`submitted` phase is reported as a failure with the recorded phase —
  `unknown` is explicitly "NOT confirmed delivered" and must not be retried blindly.
- Because the generic `skill_call` audit writes the error text and parameters verbatim,
  `emailComposeAuditParams` projects the invocation first: only the opaque `grantId`, SHA-256
  digests of the destination/subject/body, their lengths and the attachment count are recorded —
  never the address, the subject or the body, whatever the content-hashing setting is. `send-email`
  results are also excluded from the Skill API response cache so a replay is answered by the durable
  journal (including an `unknown` phase) instead of a stale `submitted`.
- Refusals obey the same rule: no message interpolates a model-supplied value verbatim. An
  unsupported request field is named only when it is identifier-shaped, an attachment extension is
  derived from the file NAME and echoed only when identifier-shaped, and a `grantId` that is not
  identifier-shaped is recorded as `grantIdHash` instead of plaintext.

### Exported API (consumers: `email-forward-skill`, `email-response-accounting`, `email-activation`)

- `EmailComposeHandler` with options `{ mailService?: EmailComposeMailService; forwardSourceStore?: EmailForwardSourceStore; limits?: SendFileSkillConfig }`
  - `handleSendEmail` (the `send-email` skill handler); `EmailComposeMailService` is the structural
    seam `{ send(draft: EmailDraft): Promise<EmailSendOutcome> }` the real `EmailMailService` satisfies
  - `EMAIL_COMPOSE_ACTION_SLOT = "compose"`, `EMAIL_COMPOSE_CODES`
  - `emailComposeAuditParams(parameters)` — the content-safe `skill_call` projection
- `SkillRegistry` constructor accepts an optional `emailCompose?: { mailService: EmailComposeMailService; forwardSourceStore?: EmailForwardSourceStore }`,
  and `SkillRegistry.setEmailCompose(...)` installs or removes it after construction.
  `send-email` is registered ONLY when a mail service is supplied; production activation supplies
  it through `AgentCore.setEmailPlatform(...)` once the durable service exists.
- `SkillContext.sessionId` (the Skill API session id that keys the staging directory) and
  `SendEmailParams` / `SendEmailRequest` in `src/skills/types.ts`
- Skill script `skills/send-email/scripts/send-email.ts` (`--session-id`, `--grant-id`, `--request-file`)
  and `readPayloadArg`'s `extraFreeTextFlags` option in `skills/lib/payload.ts`

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-compose-skill/specs/email-outbound-composition/spec.md`:

- **New destination**: a valid compose grant naming an address absent from channels gets one
  immediate submission, and incoming mail from that address stays denied.
- **Grant bypass attempt**: a request adding Cc/Bcc, changing the recipient or using a sibling
  payload file sends no bytes.
- **Private workspace data**: a compose request without attachments never attaches a memory file or
  unrelated history.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys \
  tests/skills/email-handler.test.ts tests/skills/email-compose-smoke.test.ts \
  tests/skills/scripts.test.ts tests/skills/payload.test.ts
```

`tests/skills/email-handler.test.ts` drives the REAL handler, the REAL `EmailMailService` /
`SubmissionStore` / `EmailMessageStore` / `OutgoingMimeBuilder` with scripted SMTP and IMAP doubles,
and the REAL `SkillAPIServer` over HTTP (real `SessionRegistry`, grant recording, JWT verification
including an expired token, recovery fence, in-flight lease, audit writer and metrics): a granted
send, the destination-mutation/forward/foreign-session/owner/work/unknown-grant refusals, the
reply-to-sender path, Cc/Bcc/header and malformed-field refusals, attachment containment (memory
file, symlink escape, sibling staging dir, missing file, extension/size/count limits), the
content-safe audit projection, operation reuse, distinct-grant slots, a failed submission, the
fenced 409, the retained lease across session removal and the uncached `unknown` replay.
`tests/skills/email-compose-smoke.test.ts` runs one compose through the REAL `EmailSmtpClient` over
a real TLS socket to the local SMTP fixture and asserts the exact envelope recipient, the centrally
applied signature (once), the attachment part and the rejected-peer outcome. `tests/skills/
scripts.test.ts` runs the REAL script against a mock Skill API (verbatim request JSON, the
`--to`/`--subject`/`--body` refusals, out-of-bounds payload, malformed JSON, the owning-session
binding in both process shapes, missing payload flag), and `tests/skills/payload.test.ts` pins the
shared helper's opt-in extra-flag rejection. No provider, credential, production mailbox or model
judgment is claimed.

## Source-Preserving Forwarding (Owned by `email-forward-skill`)

`skills/send-email/*` and `src/skills/email-handler.ts` also own FORWARDING: the agent forwards a
HISTORICAL message the user designated to a destination the same current request authorized. The
endpoint, the request file, the destination matching and the submission path are row 20's; this row
adds the designated source and its all-or-nothing preservation.

### The forward request extension

The same session-contained `compose.json` carries two additional keys:

```json
{
  "action": "forward",
  "sourceRecordId": "<opaque stored record id from this session's grant>",
  "to": "someone@example.org",
  "subject": "Fwd: Subject of the original",
  "body": "See the original below.",
  "attachments": ["<absolute staging directory>/notes.pdf"]
}
```

- `action` is a MODE, never an authorization: it selects the forward contract, and the destination
  still comes from the immutable grant alone. Any other action is refused with
  `SKILL_EMAIL_COMPOSE_REQUEST`, and an absent action keeps the row-20 compose contract.
- `sourceRecordId` is an opaque host identifier — the record id the host's `forward` grant already
  names. A filesystem path and a wire Message-ID are NOT authorization: neither equals the granted
  record id, so both are refused.
- The commentary `body` MAY be empty for a pure forward (the designated original is the material);
  `to` and a non-empty single-line `subject` are always required, and Cc/Bcc/arbitrary headers have
  no representation in either mode.
- An added attachment is referenced at most once: a duplicated staged path is refused with
  `SKILL_EMAIL_COMPOSE_ATTACHMENT` instead of serializing the same material twice.
- The script validates the mode BEFORE its API call: an unsupported action, or a forward without a
  non-empty string `sourceRecordId`, fails locally with `SKILL_FORWARD_REQUEST_INVALID` and the
  request object still travels verbatim — the request file stays the only carrier of free text, and
  `--source-record-id` does not exist as a flag.

### Host authorization and source access (fail closed, before any byte is read)

`EmailComposeHandler` decides the destination first, exactly as for a compose (request shape →
canonical `to` → immutable grant), and a forward then adds:

1. A forward ALWAYS needs a grant. The grant must exist, be a `forward` grant, belong to exactly
   this session, work item and owner, name the requested canonical destination AND name exactly the
   requested `sourceRecordId`. A `compose` grant, a grant for another source, a grant for another
   session/owner/work item and an absent grant id all fail closed with `SKILL_EMAIL_COMPOSE_GRANT`;
   there is no self-address shortcut for forwarding and no API that creates or widens a grant.
2. The source is resolved ONLY through the injected owner-scoped store
   (`EmailForwardSourceStore`, structurally `EmailMessageStore`): `getByOwnerRecord(owner, id)`
   cannot return another owner's record, so a foreign source is simply not found. `getSourceBytes`
   and `attachment` read the immutable archive, and EVERY source-side failure — absent/foreign
   record, missing bytes, unreadable bytes, a throwing store, or archived bytes whose LENGTH no
   longer matches the recorded `rawSize`/`size` — is one content-free `SKILL_EMAIL_FORWARD_SOURCE`
   refusal with zero SMTP activity (a deployment with no source store wired at all refuses with
   `SKILL_EMAIL_FORWARD_UNAVAILABLE`). Length identity is what the archive contract offers: an
   equal-length byte replacement inside the archive is not detected here. A forward is complete or
   it does not happen; nothing is truncated, dropped or partially sent.
3. Source content never authorizes anything. The original's addresses, body, attachments and
   instructions are only quoted material: the envelope recipient and the routing headers come from
   the matched grant alone, nothing the source names can become a recipient or a destination, and
   a request that asks for a source-named address is refused like any other ungranted destination.
   The only source values that reach the outgoing top-level headers are the source's own bracketed
   wire identifiers in `References` (a fresh header chain that threads the forward to the original).

### Byte preservation, signature order and combined limits

- The immutable `.eml` of the source is attached as `message/rfc822` (the composer emits
  `message/*` parts unencoded, so the original headers, its own signature and its encoded parts
  survive byte-for-byte; a source containing bare LF is refused by the builder instead of being
  rewritten). Every original attachment is attached as itself with the stored bytes and the stored
  media type, and its display filename is sanitized like any other attachment name. The composer's
  disposition for a `message/*` part is `inline`, so some clients present the original inline rather
  than offering it as a downloadable attachment; the body text and every decoded attachment are
  forwarded explicitly as well, so no client is required to unpack the raw part to read the
  message.
- The labelled `---------- Forwarded message ---------` section is built by the shared
  `buildForwardSection` from the stored body text, and the builder places the centrally applied
  signature AFTER the commentary and BEFORE that section — exactly once.
- Accounting is all-or-nothing and includes the source: the `.eml` reference counts as one
  outgoing part and its bytes count toward the aggregate, and every original attachment counts
  toward the same reused send-file limits (`maxFilesPerInvocation`, `maxFileSizeMb`,
  `maxTotalSizeMb`) as the added files. Source-side size failures (the 25 MiB raw-message bound and
  the per-file bound) are `SKILL_EMAIL_FORWARD_SOURCE`; a combined count/aggregate failure is
  `SKILL_EMAIL_COMPOSE_ATTACHMENT`. All of it is decided from recorded sizes and stats BEFORE any
  payload byte is read, and the actual loaded sizes are re-checked against the recorded ones, so an
  archived file whose size changed cannot smuggle an oversized or truncated part into a
  "successful" forward.
- Two references that resolve — including through a staging-internal symlink alias — to ONE staged
  file are one duplicate: a forward refuses them instead of serializing the same material twice.
  Original attachments are not subject to the added-file extension whitelist: they are preserved
  whatever their media type.
- Forwarding does not re-encode the original: the decoded originals are copies of the archive
  bytes, and the raw part is the archive's own `.eml`.

### Durability, idempotency and audit

- The operation slot stays `third-party:<grantId>` (the row-20 granted-operation vocabulary). A
  forward grant id is unique per action + recipient + source, so a forward and a compose can never
  share one operation key, and a repeated identical forward returns the RECORDED journal result
  (`emailSubmission.reused: true`) with zero additional SMTP transactions. Changed commentary
  submitted under the same grant does NOT replace the recorded operation: the recorded result is
  returned and the result's `nextAction` says so explicitly, so a successful replay is never a
  claim that newly written text was delivered.
- `send-email` keeps its row-20 side-effect posture: recovery-fenced sessions are rejected (409),
  the in-flight lease covers recovery, and results are excluded from the response cache so a replay
  is answered by the durable journal (including an `unknown` phase).
- `emailComposeAuditParams` additionally records the forward `action` and `sourceRecordId` under
  the same identifier-or-hash rule (verbatim only when identifier-shaped, otherwise a SHA-256
  `…Hash`); the destination, subject, body, attachment paths and every source byte stay out of the
  audit, whatever the content-hashing setting is.
- A FORWARD refusal echoes no model-supplied value at all — not even an identifier-shaped request
  key or file extension, which the row-20 compose wording names when the shape heuristic accepts
  it. A quoted source can legitimately contain identifier-shaped private text, so the shape
  heuristic is not applied in forward mode. (The compose wording is deliberately unchanged, for
  row-20 response compatibility.)

### Exported API (consumers: `email-response-accounting`, `email-tool-guidance`, `email-activation`)

- `EmailComposeHandler` options gain `forwardSourceStore?: EmailForwardSourceStore`
  (`{ getByOwnerRecord, getSourceBytes, attachment }`, owner-scoped by contract). Absent leaves
  composing available and forwarding failing closed with `SKILL_EMAIL_FORWARD_UNAVAILABLE`.
  `SkillRegistry`'s optional `emailCompose` argument gains the same field.
- `EMAIL_FORWARD_REQUEST_ACTION = "forward"` and `EMAIL_FORWARD_CODES` (`UNAVAILABLE`, `SOURCE`) in
  `src/skills/email-handler.ts`; a forward result additionally carries
  `data.forwardSourceRecordId` and counts every wire part in `data.attachmentsCount`.
- `SendEmailRequest` in `src/skills/types.ts` gains `action?: "forward"` and `sourceRecordId?: string`.
- The raw source part is named `original-message.eml` with media type `message/rfc822`.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-forward-skill/specs/email-forwarding/spec.md`:

- **Accessible designated source**: a valid recipient grant paired with another user's
  `sourceRecordId` is denied with no source content disclosed.
- **Complete forward or explicit failure**: a source with an unavailable archived attachment
  produces no SMTP send and an incomplete-source safe error, and an over-limit forward is rejected
  as a whole.
- **Source does not authorize delivery**: an original that names a second recipient and asks to
  redirect only ever reaches the current user's granted destination.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys \
  tests/skills/email-forward.test.ts tests/skills/email-forward-smoke.test.ts \
  tests/skills/email-handler.test.ts tests/skills/email-compose-smoke.test.ts \
  tests/skills/scripts.test.ts tests/skills/registry.test.ts
```

`tests/skills/email-forward.test.ts` drives the REAL handler with the REAL owner-scoped
`EmailMessageStore` (a real archived source written by `putSource`) through a recording mail-service
double — the grant action/session/owner/work/destination/source matrix, a foreign-owner and an
unknown source, missing and changed archive material, a throwing store, an unwired store, the
combined count/per-file/aggregate limits with and without added files, duplicate references, the
empty-commentary pure forward, and the content-safe audit projection — and then runs the whole path
through the REAL `EmailMailService`, `SubmissionStore`, `EmailMessageStore` and `OutgoingMimeBuilder`
behind scripted SMTP/IMAP doubles, walking the CAPTURED wire bytes part by part to prove the
`message/rfc822` part and every original attachment equal the archived originals byte-for-byte, the
signature precedes the labelled original section exactly once, the header chain is fresh with
References to the source, the granted operation is idempotent, injected source instructions reach
no other destination, an attachment-only source is forwarded completely, and a missing part sends
nothing. `tests/skills/email-forward-smoke.test.ts` runs the same boundary with a real
`EmailSmtpClient` over a real TLS socket to the local SMTP fixture and asserts the peer-received
original bytes and the rejected-peer outcome. No provider, credential, production mailbox or model
judgment is claimed.

## Email Response Accounting (Owned by `email-response-accounting`)

The session's outbound email result is tracked explicitly instead of being inferred from a skill's
boolean result. One session owns one `EmailResponseAccounting`:

| field | meaning |
| --- | --- |
| `submittedToUser` | Mail certainly submitted to the initiating user (ordinary `reply`/`files`/`compose` slots). |
| `submittedToThirdParty` | Mail certainly submitted to a third party (a granted `third-party:<grantId>` slot). |
| `unknown` | At least one logical operation's outcome is unresolved (recorded `unknown`, an unclosed `submitting`, an unsettled in-flight effect, or an unreadable journal). |
| `operations` | Every observed logical operation (`operationId`, recorded `phase`, `targetKind?`, `actionSlot?`, `reused?`), in first-seen order. |

Evidence sources are the skill result's `emailSubmission` metadata (recorded regardless of its
`success` flag) and the durable submission journal (`EmailMailService.lookup(owner, {workId, actionSlot})`)
for the work item's own slots. Both are consulted only for the session's own owner/work item, and
the journal is read only after the session's in-flight side effects settle.

Decisions:

- **Submitted counts as a response.** The orchestrator treats the agent as responded when
  `replySent || reactionSent || fileSent || emailSubmitted`. A third-party submission satisfies that
  requirement WITHOUT writing `lastSentMessageId`, `lastFileMessageId` or `lastReplyAnchorMessageId`,
  and a third-party-only turn skips conversation-summary generation (the summary gate stays on
  `replySent`).
- **Unknown suppresses and escalates.** A missing-response corrective turn is sent only when nothing
  responded AND no email submission or uncertainty exists. An unresolved outcome is never reported as
  success: the response carries `emailUnknown`, the fallback error notice is suppressed, and the
  durable work receipt is escalated to `review-required`.
- **Pre-submission corrections only.** A recorded non-delivery (`failed`) leaves the retry available
  on the SAME host-assigned slot; a completed or unresolved slot is absorbing in the accounting and
  is never replaced by a changed payload or another slot. Same-slot resends are answered from the
  journal, so no path can reach a second SMTP transaction for one logical operation.
- **Crash recovery.** A re-issued prompt after an idle-timeout reconnect is suppressed when the
  durable journal records a submission or leaves an outcome unresolved, exactly like a recorded
  response.

### Exported API (consumers: `email-reminder-threads`, `email-spontaneous-targets`, `email-private-observability`, `email-tool-guidance`, `email-activation`)

```ts
// src/core/email-response-accounting.ts
export interface EmailResponseOperation {
  operationId: string;
  phase: EmailSubmissionPhase;
  targetKind?: "user" | "third-party";
  actionSlot?: string;
  reused?: boolean;
}
export interface EmailResponseAccounting {
  submittedToUser: boolean;
  submittedToThirdParty: boolean;
  unknown: boolean;
  operations: readonly EmailResponseOperation[];
}
export const EMPTY_EMAIL_RESPONSE: EmailResponseAccounting;
export const EMAIL_ORDINARY_ACTION_SLOTS: readonly string[]; // reply, files, compose
export const EMAIL_HOST_SKILL_SLOTS: Readonly<Record<string, string>>; // send-reply → reply, send-file → files
export function emailSessionOwner(session: { platform: string; userId: string }): string | undefined;
export function emailResponseSlots(grants?: readonly { grantId: string }[]): string[];
export function isThirdPartySlot(slot: string | undefined): boolean;
export function recordEmailSubmission(
  accounting: EmailResponseAccounting | undefined,
  metadata: EmailSubmissionMetadata,
  actionSlot?: string,
): EmailResponseAccounting;
export function recordEmailUncertainty(accounting?: EmailResponseAccounting): EmailResponseAccounting;
export function hasEmailSubmitted(accounting?: EmailResponseAccounting): boolean;
export function hasEmailResponseOrUncertainty(accounting?: EmailResponseAccounting): boolean;
export function hasEmailUncertaintyEvidence(accounting?: EmailResponseAccounting): boolean;
export function emailResponseFromEvidence(params: {
  owner: string;
  workId: string;
  slots: readonly string[];
  accounting?: EmailResponseAccounting;
  lookup(owner: string, operationKey: EmailOperationKey): EmailSendOutcome | undefined;
}): EmailResponseAccounting;

// src/skill-api/session-registry.ts (on SessionRegistry)
recordEmailSubmission(sessionId, metadata, actionSlot?): boolean;
markEmailResponseUnknown(sessionId): boolean;
emailResponseOf(sessionId): EmailResponseAccounting;
hasEmailSubmitted(sessionId): boolean;
hasEmailResponseOrUncertainty(sessionId): boolean;

// src/core/session-orchestrator.ts
setEmailSubmissionEvidence(source: EmailSubmissionEvidenceSource | null): void; // { lookup(owner, key) }
// SessionResponse gains: emailSubmitted?: boolean; emailUnknown?: boolean; emailSend?: EmailSendContext

// src/core/agent-core.ts
setEmailSubmissionEvidence(source: EmailSubmissionEvidenceSource | null): void; // forwards to orchestrator + Skill API
// src/skill-api/server.ts
setEmailSubmissionEvidence(source: EmailSubmissionEvidenceSource | null): void;
```

### Acceptance Scenarios

- **Third-party only**: `send-email` succeeds, the agent completes without `send-reply`; no
  missing-response email is manufactured and every user anchor ID is unchanged.
- **Unknown failed result**: `send-email`/`send-file` returns `success: false` with an unresolved
  submission; no response or quota rollback authorizes a duplicate send, and the work is
  review-required.
- **API reply lost**: SMTP accepted but the skill HTTP response is lost and the pooled agent
  reconnects; the recorded operation suppresses another SMTP transaction.
- **Durable evidence after the drain**: an effect still in flight defers the evidence read; the
  recorded submission is only observed after the in-flight counter reaches zero.
- **Pre-submission failure**: a recorded non-delivery keeps the corrective turn, on the same logical
  slot, with no replacement slot.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys \
  tests/core/email-response-accounting.test.ts tests/core/reply-dispatcher.test.ts \
  tests/skill-api/server.test.ts tests/skill-api/session-registry.test.ts \
  tests/core/session-orchestrator.test.ts tests/core/email-session-receipts.test.ts
```

`tests/core/email-response-accounting.test.ts` drives the REAL orchestrator, session registry,
durable receipt journal and retry/summary prompt builders with a scripted connector, and replaces
only the mail service's `lookup` with an in-memory source that scopes and logs every consulted key:
the submitted/unresolved/non-delivery matrices, the third-party-anchor guarantee, the drain ordering,
the review-required escalation, the summary skip and the Discord regression are asserted there. The
SMTP transport itself is NOT exercised by this suite (row 13's own fixtures own wire-level DATA
counts); no model and no production credential is involved.

## Scheduled Email Reminders (Owned by `email-reminder-threads`)

`src/types/reminder.ts`, `src/core/reminder-store.ts` and `src/skills/reminder-handler.ts` own the
origin of a scheduled email reminder, and `src/core/session-orchestrator.ts` owns its restart-safe,
thread-preserving delivery. Discord and Misskey reminders are untouched: they never gain an origin,
their persisted records and delivery behavior are byte-for-byte unchanged, and no migration,
compatibility alias or backfill exists.

### The persisted origin (additive JSONL)

An EMAIL reminder entry gains ONE optional field:

```jsonc
{
  "type": "reminder",
  // …existing fields unchanged…
  "origin": { "channelId": "mail:<owner>:<threadId>", "replyAnchorRecordId": "<record uuid>" },
}
```

- **Required on creation, host-resolved.** `set-reminder` refuses an email reminder unless
  `SkillContext.emailReminderOrigin` is present and owner-valid: the channel must be a valid
  `mail:<owner>:<threadId>` id whose encoded owner IS the reminder's owner, and the anchor must be a
  non-empty record id. The value is derived by the host from the session it established (the
  session's own channel and reply anchor) — never from tool parameters or platform-specific request
  data, so a model cannot choose the thread a reminder will later be delivered into.
- **Optional on replay, never synthesized.** `ReminderStore` replays the origin only when the
  stored value is a structurally usable origin. A legacy line without the field, or a malformed one
  (`null`, a missing field, a wrong type), resolves as absent — the scheduler then refuses the send
  instead of guessing a thread. Existing records therefore parse unchanged.

### Restart-safe, thread-preserving delivery

Every delivery re-reads the persisted origin and re-checks the CURRENT configuration:

1. **Origin shape and ownership.** The channel must parse, its owner must equal the reminder's
   owner, and the anchor must be non-empty. Anything else is review-required.
2. **Current allowlist.** `isSenderAllowed(owner, channels)` must still find an ENABLED
   `email/account/<owner>` entry. Removing or disabling the account prevents every later delivery;
   the mail service re-checks the same allowlist immediately before submission.
3. **Durable operation, not a fresh one.** The reminder's logical operation is
   `{ workId: <reminder id>, actionSlot: "reminder:<id>" }` (`reminderOperationKey`), stable across
   restarts. Before generating anything, the scheduler consults the durable submission evidence for
   that exact operation: a `submitted` record disables the reminder WITHOUT sending again, and an
   unresolved record (`unknown`/`submitting`) is review-required WITHOUT sending. (With no evidence
   source wired, the mail service's own operation key still answers a repeated send from its
   journal, so a second SMTP transaction is impossible either way.)
4. **Origin anchor usable for delivery.** The persisted anchor must appear in the SAME bounded
   owner-thread history the adapter resolves an explicitly supplied anchor from
   (`PlatformAdapter.fetchRecentMessages`), so an anchor the adapter could never thread to is
   review-required instead of being retried on every tick. Another anchor is never chosen.
5. **Never a new thread.** Email delivery never calls `getDmChannelId` (which allocates a NEW
   internal thread). The session is bound to the origin channel, and the Skill API resolves its
   reply anchor from the persisted origin, so the reply threads to the message the user originally
   asked about.
6. **No inherited destination grant and no composition.** A reminder session stays triggerless and
   holds no destination grant; `send-email` is refused at the host boundary (only a reply into the
   reminder's own thread is authorized), and `send-file` keeps its existing triggerless refusal.
7. **Its own evidence decides completion.** An email reminder is disabled only when ITS OWN
   operation submitted mail. The shared reply-state map is keyed by workspace+channel, so another
   session replying into the same owner thread can never mark the reminder delivered.

A reminder that cannot be delivered automatically (missing/corrupt origin, unusable anchor) or
whose account was revoked is disabled and reported as review-required. Cancelling the reminder is
best-effort: a failed write is logged as its own persistence error and never rewrites the verdict,
because the durable operation evidence — not the reminder record — is what prevents a resend.

### Operator notes

- The reminder anchor must remain inside the adapter's bounded thread scan; an anchor that has
  aged out of that window fails closed (no SMTP, no guessed thread, review-required). The bound
  itself is owned by `email-adapter`.
- Review-required reminders are disabled, so a re-added account does not automatically resume an
  earlier reminder; this is the stated scope (no recovery policy is invented here).
- No mailbox credential or message body is involved: reminders use opaque owner/record/thread ids
  only.

### Exported API

```ts
// src/types/reminder.ts
export interface ReminderOrigin { channelId: string; replyAnchorRecordId: string; }
export interface EmailReminderSession { reminderId: string; origin: ReminderOrigin; }
// ReminderEntry.origin?: ReminderOrigin;  ResolvedReminder.origin?: ReminderOrigin

// src/core/reminder-store.ts
export function reminderOperationKey(reminderId: string): EmailOperationKey; // {reminderId, "reminder:<id>"}
export function sessionEmailOperation(session): { workId: string; slots: readonly string[] } | undefined;

// src/skills/reminder-handler.ts
export const EMAIL_REMINDER_ORIGIN_ERROR: string;
export function buildEmailReminderOrigin(channelId: string, replyAnchorRecordId?: string): ReminderOrigin | undefined;
export function validateEmailReminderOrigin(origin: ReminderOrigin | undefined, userId: string): ReminderOrigin | undefined;

// src/skills/types.ts
// SkillContext.emailReminderOrigin?: ReminderOrigin      (host-supplied only)

// src/skill-api/session-registry.ts
// ActiveSession.emailReminder?: EmailReminderSession
// SessionOrchestrator.setupSession({ …, emailReminder? })
```

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-reminder-threads/specs/scheduled-reminders/spec.md`:

- **Restart due reminder** — a stored email reminder that became due during downtime delivers one
  signed email into the initiating user's original thread after the origin is replayed from disk.
- **User removed** — a reminder due after its owner was removed from (or disabled in) channels
  performs no SMTP submission; the reminder is disabled for review.
- **Reminder patch fails** — SMTP acceptance is followed by a failed reminder disable; the next
  scheduler tick consults the stable `reminder:<id>` operation and does not send again.
- **Missing / corrupt origin** — no usable origin, an anchor from another thread, or an anchor no
  longer present in its owner thread is review-required; no thread is guessed and no mail is sent.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys \
  tests/core/reminder-store.test.ts tests/core/reminder-scheduler.test.ts \
  tests/skills/reminder-handler.test.ts tests/core/session-orchestrator.reminder.test.ts \
  tests/core/email-reminder-threads.test.ts \
  tests/platforms/email/email-adapter.test.ts tests/platforms/email/mail-service.test.ts
```

`tests/core/session-orchestrator.reminder.test.ts` drives the REAL orchestrator with a scripted
connector and asserts the email branch: origin binding, the refusal of `getDmChannelId` for email,
review-required on a missing/corrupt origin or a revoked account, the durable preflight for a
submitted/unresolved reminder operation, the "foreign reply never delivers" rule, and the unchanged
Discord path. `tests/core/email-reminder-threads.test.ts` wires the REAL handler, file-backed store,
adapter, mail service, submission journal and MIME builder over isolated temporary state, and its
smoke leg uses the local `EmailSmtpTestService` fixture to assert exactly ONE live DATA transaction,
the origin thread linkage, one signature and the owner recipient — with the restart replay
performing none. A model is involved nowhere, and no production credential or mailbox is used.

## Private Observability of Email Execution (Owned by `email-private-observability`)

Email content is private correspondence: bodies, recipients, subjects, attachment bytes and names,
the agent's authored text and its interpretation output NEVER reach an operational log, an audit
entry or a metrics label. What stays visible is metadata only — opaque identifiers, bounded enums,
counts, lengths and SHA-256 digests — whatever `audit.hashContent` is configured to do.

### Privacy invariants

- **Metadata-only audit, regardless of configuration.** `SessionAuditWriter` recognizes the `email`
  platform and projects EVERY entry through `projectEmailAuditData` before it is written. A content
  field is replaced by `<field>Hash: sha256:<digest>` (plus `<field>Length`), an array of staged
  paths/ids by one digest plus `<field>Count`, an already-canonical digest is preserved unchanged,
  and every key that is not a host-assigned identifier, a bounded enum, a number or a boolean is
  dropped. A raw `agent_message.promptContentHash` written with hashing off therefore becomes the
  digest its name claims to be. The projection is idempotent, so the pre-projected `skill_call`
  params and the writer's own pass can never change a digest's meaning.
- **`email_operation` phase.** One entry per executed email-capable skill records the submission
  outcome under the strict allowlist `{operationId, workId, phase, targetKind, sentCopy, safeCode}`.
  `phase: "submitted"` with `sentCopy: "failed"` is an accepted mail whose sent-folder APPEND
  failed; it is never reported as unsent, and `phase: "unknown"` marks the mail that must not be
  retried blindly.
- **Private loggers.** Every `Email*` module logger and every `email:<address>` session logger is
  private by construction: identifiers/enums/counts survive, everything else is dropped,
  placeholders holding a dropped value render as `[redacted]`, and mail addresses are redacted out
  of the emitted module name.
- **Execution-scoped propagation.** `runWithPrivateEmailScope()` wraps one whole email skill call,
  so the skill registry's, session registry's and audit writer's own loggers are private for exactly
  that execution — and never for a concurrent Discord/Misskey one. `Logger.withPrivateEmail()`
  covers the mixed modules that serve both platforms (the Skill API server, the ACP client).
- **Fail closed on errors.** A protocol, provider or agent error is recorded as its typed code
  (`skillResult.code`, `safeCode`) or a constant failure code. Exception messages, raw tool titles
  and command lines are hashed (ACP permission decisions) or dropped; a malformed request body is
  reported as `SKILL_API_INVALID_JSON_BODY` without the parser message, which embeds body text.
- **Diagnostics.** Attachment stat/read failures in an email session log a safe code, and a
  successful email attachment delivery logs counts only. Metrics keep their existing platform/skill
  labels; no address, subject, body or file name is ever a label value.
- **Private bytes stay private.** The only place real content lives is the private archive and the
  fsynced submission evidence (`data/email/outbound/…`, `data/workspaces/email/<owner>/email/…`,
  directory `0700` / file `0600`, included in the data backup), exactly as documented by
  `email-message-history` and `email-submission-service`. Those files are for manual review, not for
  the dashboard.

### Known limitation (not owned by this slice)

`MemoryStore` reports a malformed memory JSONL line with a 100-character excerpt of that line
(`src/core/memory-store.ts`). That path is platform-agnostic and runs during context assembly, i.e.
outside any email skill execution, so a malformed line in the email workspace's memory files can
still appear in the `MemoryStore` log. `src/core/memory-store.ts` is outside this slice's file
ownership (its excerpt logging predates the email platform), so it is recorded here instead of being
silently changed; the malformed-replay case this slice does own — the pre-session due-reminder
enumeration — is content-free in `src/core/reminder-store.ts` (`email-reminder-threads`).

### Operator inspection (no content required)

```sh
# Every outbound operation of one session, with its durable phase and copy state
jq -r 'select(.phase == "email_operation") | .data
  | [.operationId, .workId, .phase, (.targetKind // ""), (.sentCopy // "pending"), (.safeCode // "")] | @tsv' \
  data/audit/email/<owner>/<sessionId>.jsonl

# Which operations still need manual review (unknown outcome, or submitted with a failed sent copy)
jq -r 'select(.phase == "email_operation"
  and ((.data.phase == "unknown") or (.data.sentCopy == "failed")))
  | [.data.operationId, .data.phase, (.data.sentCopy // "pending")] | @tsv' \
  data/audit/email/<owner>/<sessionId>.jsonl

# The durable truth for one operation (row 13), correlated by the same operationId
jq -r 'select(.data.operationId == "op_<id>")
  | [.data.transition, .data.phase, (.data.sentCopy // "pending")] | @tsv' \
  data/email/submissions.jsonl
```

`<owner>` is the canonical `e_<sha256>` identity — never a raw address — and the audit path, the
log module name and every metrics label use that identity or the platform identifier only.

### Exported API (consumers: `email-tool-guidance`, `email-activation`)

```ts
// src/types/audit.ts
export const EMAIL_AUDIT_PLATFORM = "email";
export interface EmailOperationAuditData {
  operationId?: string;
  workId?: string;
  phase?: string;
  targetKind?: "user" | "third-party";
  sentCopy?: "pending" | "appended" | "failed";
  safeCode?: string;
}
export const EMAIL_OPERATION_AUDIT_FIELDS; // the six-field allowlist above
export function isSafeEmailAuditScalar(key: string, value: string): boolean;
export const EMAIL_HASH_VALUE_PATTERN; // ^sha256:[0-9a-f]{64}$
export const EMAIL_HASH_FIELD_PATTERN; // /hash$/i
export const EMAIL_CONTENT_FIELD_NAMES; // content/query/text/message/… → hashed
export const EMAIL_CONTENT_ARRAY_FIELD_NAMES; // filePaths/fileNames/messageIds/… → hashed + count
// `AuditPhase` gains "email_operation"; `SessionAuditEntry.data` gains
// operationId/workId/actionSlot/targetKind/sentCopy/safeCode and `skillResult.code`.

// src/core/audit-logger.ts
export function projectEmailAuditData(
  data: Record<string, unknown>,
  depth?: number,
): Promise<Record<string, unknown>>;
export function projectEmailOperationData(input: EmailOperationAuditData): EmailOperationAuditData;
// On SessionAuditWriter:
isPrivateEmail(): boolean;
writeEmailOperation(data: EmailOperationAuditData, timestamp?: string): Promise<void>;

// src/utils/logger.ts
export type LogPrivacy = "normal" | "private-email";
export function isPrivateEmailLogModule(module: string): boolean;
export function runWithPrivateEmailScope<T>(fn: () => T): T;
// On Logger:
withPrivateEmail(): Logger;
```

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-private-observability/specs/session-audit-log/spec.md`:

- **Adversarial errors**: a protocol or agent error carrying a private body or password records only
  a safe reason code and opaque operation/work identifiers, in both the audit entry and the log.
- **Malformed reminder before session creation**: `ReminderStore.parseLog()` decides replay
  sensitivity from the trusted `workspace.components.platform`, so an email workspace's due-reminder
  enumeration logs the safe `REMINDER_LINE_PARSE_FAILED` code with the line number and byte offset
  only — never the line, and never the parser message that quotes it. That enumeration runs before
  any session logger exists.
- **APPEND failure**: an accepted email whose sent-folder copy fails shows `submitted` plus
  `sentCopy: failed` and never `unsent`.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys \
  tests/core/email-privacy.test.ts tests/core/reminder-store.test.ts tests/core/audit-logger.test.ts \
  tests/utils/logger.test.ts \
  tests/types/audit.test.ts tests/acp/client.test.ts tests/skill-api/server.test.ts \
  tests/skills/email-handler.test.ts tests/skills/email-forward.test.ts tests/skills/file-handler.test.ts
```

`tests/core/email-privacy.test.ts` drives the REAL audit writer, logger, ACP client and Skill API
server over HTTP (with the real `SessionRegistry`, JWT issuance and `EmailComposeHandler` behind a
recording mail-service seam) using sentinel values for the address, subject, body, credentials and
attachment name. It asserts their absence from every phase entry, every log line and the metrics
output, the presence of digests and identifiers instead, the `email_operation` allowlist under an
adversarial extra field, a thrown handler exception that crosses the skill registry's logger, the
real `ReminderStore` due-reminder enumeration on a malformed email JSONL (a position only, never the
line or the parser message), and byte-compatible non-email entries. No model, provider or production
credential is involved.

## Email Spontaneous Targets & Session Context (Owned by `email-spontaneous-targets`)

`src/core/spontaneous-target.ts`, `src/platforms/email/email-adapter.ts`, `src/core/session-orchestrator.ts`,
and `src/core/context-assembler.ts` implement the target selection, durable binding, owner-scoped workspace
resolution, and single-operation delivery of spontaneous email correspondence (row 25).

### Architecture & Invariants

- **Dual Opt-In Required**: email spontaneous posting requires BOTH platform-level enablement
  (`platforms.email.enabled: true` and `platforms.email.spontaneousPost.enabled: true`) AND per-account
  opt-in (`channel.enabled !== false` and `channel.spontaneousPost === true` on an `email/account/<owner>` channel).
  If no account opts in, the scheduler tick completes without launching an agent session.
- **Durable Target Binding**: before any agent session or SMTP interaction begins, exactly one eligible
  account is chosen and allocated a brand-new internal owner thread (`mail:<owner>:<threadId>`).
  `EmailSpontaneousStore.select()` binds this target (`{ owner, threadId }`) to the restored occurrence, and
  `EmailSpontaneousStore.begin()` claims the occurrence. A restarted tick recovers the persisted target and
  never re-selects another recipient.
- **Target-Owned Session Workspace**: unlike Discord and Misskey which use bot-owned workspaces for spontaneous posts,
  email spontaneous sessions execute in the selected target user's workspace (`email/<userId>`). Memory loading
  and context assembly use the target user's workspace, guaranteeing that private memories stay owner-scoped and
  distinct from bot memories or other users' memories.
- **Prompt Template Variables**: `ContextAssembler.assembleSpontaneousContext` and `SessionOrchestrator.buildSpontaneousPromptFromTemplate`
  populate the Vento template variables for email spontaneous sessions:
  - `isDm`: `true`
  - `platform`: `"email"`
  - `userId`: the selected target account owner's canonical id (`e_<sha256>`)
  - `channelId`: the newly allocated owner thread channel (`mail:<owner>:<threadId>`)
  - `guildId`: `""`
- **Single Logical Outgoing Email**: the session's send is partitioned under the host-bound operation key
  `spontaneousOperationKey(tickId)` (`actionSlot: "spontaneous:<tickId>"`). Repeated tool calls in the same
  session or across retries return the recorded submission result from `SubmissionStore` without duplicate SMTP
  DATA transactions.
- **New-Thread Delivery Without Reply Headers**: `EmailAdapter.resolveSpontaneousThreadSend` resolves spontaneous
  deliveries to the recipient address verified by admitted inbound mail (`ownerVerifiedAddress`). The draft has
  no reply anchor or thread references, producing wire MIME messages without `In-Reply-To` or `References` headers.
- **No Grant Inheritance**: spontaneous sessions carry no third-party destination grants (`emailDestinationGrants`
  is empty); any attempt to send to a third party is refused.
- **Allowlist Recheck at Submission**: `EmailMailService.assertRecipientAuthorized` verifies that the target account
  remains enabled and opted into spontaneous posting immediately before SMTP submission (including after
  `markSubmitting` resolves). If an account is disabled or opted out before submission, the send is refused with
  `RECIPIENT_NOT_ALLOWED` and zero wire submissions occur.
- **Restart Outcomes**:
  - *Restart after acceptance*: `EmailSpontaneousStore.inspectEvidence()` observes `submitted` evidence from
    `SubmissionStore`, treats delivery as resolved, avoids replacement target selection or sending, and atomically
    installs the successor occurrence.
  - *Restart after uncertainty*: unclosed `submitting` or `unknown` operations are classified as `uncertain` /
    `review-required`. The occurrence is preserved for operator review and produces zero duplicate submissions.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-spontaneous-targets/specs/spontaneous-posting/spec.md`:

- **Allowlist changes**: an account disabled between selection and submission is rejected at submission time with zero SMTP transactions.
- **Consecutive ticks**: consecutive spontaneous ticks to the same permitted account allocate distinct internal and wire threads with no `In-Reply-To` header.
- **Tick deduplication**: repeated calls in one tick or process restarts after accepted/uncertain SMTP consult durable evidence and produce zero duplicate DATA transactions.
- **Email memory ownership**: distinct bot, target-user, and third-party user memory sentinels verify that only the target user's memories appear in context and prompt.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys \
  tests/core/email-spontaneous.test.ts tests/core/email-spontaneous-smoke.test.ts
```

Evidence: `tests/core/email-spontaneous.test.ts` exercises the full local stack with the real
`SpontaneousScheduler`, real `EmailSpontaneousStore`, real `EmailAdapter`, real `EmailMailService`,
`SubmissionStore`, and `EmailMessageStore` on isolated temporary directories, asserting exact DATA counts
and durable states. `tests/core/email-spontaneous-smoke.test.ts` drives the complete lane over real local
IMAP and SMTP test servers.

## Email Tool Guidance & Prompt Availability (Owned by `email-tool-guidance`)

`prompts/email_tool_guidance.md`, `prompts/system_reply.md`, `prompts/system_reminder.md`,
`prompts/system_spontaneous.md`, `src/core/email-tool-policy.ts`, `src/core/context-assembler.ts`,
`src/core/session-orchestrator.ts`, `src/acp/client.ts`, `src/acp/skill-inventory.ts` and
`src/acp/agent-factory.ts` implement the email-aware prompt and tool-availability contract (row 28).

### Architecture & Invariants

- **One shared fragment.** `prompts/email_tool_guidance.md` is included by the message, reminder and
  spontaneous entry templates only when `platform === "email"`. It states that email supports exactly
  one text reply and file deliveries, that editing, reactions and typing indicators do not exist, that
  the configured signature is applied centrally exactly once (never written by the model), that every
  payload path is the literal staging directory rendered in the same prompt, and that quoted/forwarded
  or fetched content is data and can never grant a recipient.
- **Template variables are host-derived.** `TemplateVariables.emailSessionKind`
  (`request`/`reminder`/`spontaneous`) and `emailSendGrants` are set by `ContextAssembler` for a
  message render and by `SessionOrchestrator` for reminder/spontaneous renders. `emailSendGrants` is
  the model-visible projection of the row-19 immutable destination grants: host-assigned `grantId`,
  bounded `action`, canonical `canonicalRecipient` and the optional opaque `sourceRecordId` — never a
  body, subject, credential or the configured signature. Non-email renders leave both fields absent.
- **Grant-aware exposure.** `hiddenEmailSkillsFor(session, grantCount)` in
  `src/core/email-tool-policy.ts` hides `send-email` for every email session that holds no grant and
  for every reminder/spontaneous session regardless of any stray record; an ordinary email request
  with at least one grant hides nothing. Non-email sessions hide nothing. The orchestrator derives the
  set from the durable `SessionRegistry` entry and passes it as `ClientConfig.hiddenSkills` and as the
  per-session `SessionGateContext.hiddenSkills` — per session, never from the pooled client's
  first-session default.
- **Two gate shapes, both backends.** The ACP permission gate (`src/acp/client.ts`) refuses a hidden
  skill at BOTH shapes: a registered skill call naming it and a direct/interpreted script invocation
  (including command-prefix skills) matched from the trusted root-exact inventory. The refusal is
  audited as `rejected_hidden_skill` and recorded for corrective guidance. OMP and OpenCode share the
  gate; `SkillScriptEntry.skillName` carries the observed skill identity, and the shared inventory is
  never filtered per client (one pooled process serves email and non-email sessions).
- **Handler denial is authoritative.** Prompt text and the permission gate are defense in depth.
  `EmailComposeHandler` still refuses `send-email` in a reminder/spontaneous session
  (`SKILL_EMAIL_COMPOSE_SESSION`/the explicit reminder refusal) and refuses any destination not
  matching an immutable grant (`SKILL_EMAIL_COMPOSE_GRANT`). Email requests without a grant cannot
  address a third party at all; the ordinary reply target needs no grant.
- **Email corrective turn.** `RetryPromptContext.email` (set from the real session platform, not from
  the mere presence of a registry entry) selects `buildEmailRetryMessage` in
  `src/acp/agent-factory.ts` for BOTH spawn strategies. That message never reads or renders
  react-message/edit-reply material, keeps the literal `send-reply` recipe and the `send-file`
  document, and explicitly forbids another send after a recorded submission or an unresolved outcome.
  Ordinary platforms keep the full three-skill corrective prompt byte-for-byte.
- **Mounted prompts.** An operator who mounts `prompts/` must update or re-mount
  `system_reply.md`, `system_reminder.md`, `system_spontaneous.md` and add
  `email_tool_guidance.md`, then restart the bot. The guidance changes only delivered text; it is not
  an authorization mechanism and makes no model-proof authorization claim.

### Acceptance Scenarios

Acceptance requirements and scenarios are defined in
`openspec/changes/email-tool-guidance/specs/email-tool-guidance/spec.md`:

- **Both backends**: OMP or OpenCode message/reminder/spontaneous renders use the correct literal
  session payload paths and tell the model not to generate the centrally added signature.
- **Autonomous tool call**: a reminder or spontaneous agent invoking `send-email` directly has no
  grant, so the backend refuses the send (and the restricted gate hides it).
- **Third-party-only turn**: one granted third-party mail submission satisfies response accounting,
  and the guidance never asks for a duplicate normal-user reply.

### Slice Verification

```sh
deno fmt --check src/ tests/
deno lint src/ tests/
deno check src/main.ts
deno test -A tests/core/email-tool-guidance.test.ts tests/core/prompt-permission-guidance.test.ts \
  tests/core/skill-root-wiring.test.ts tests/acp/client.test.ts tests/acp/agent-factory.test.ts \
  tests/core/email-response-accounting.test.ts
```

Evidence: `tests/core/email-tool-guidance.test.ts` renders the real templates through Vento for both
engines and both platform shapes, asserts the signature sentinel never appears, exercises the real
permission gate (registered-skill and direct-script shapes, per-session on one client, both backends)
and drives the real orchestrator with real prompt templates, real `SessionRegistry`, a stub
destination-grant preflight and a recording connector to prove the hidden set and the corrective turn
are wired. `tests/skills/email-compose-smoke.test.ts` and `tests/skills/email-forward-smoke.test.ts`
drive the real handler against the local SMTP fixture. No model, provider, production credential or
production mailbox is involved; the resulting message text was not evaluated by a model.
