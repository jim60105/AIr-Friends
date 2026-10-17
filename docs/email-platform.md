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
