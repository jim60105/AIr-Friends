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
