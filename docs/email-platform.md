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

| `platforms.email` field | Environment override | Default / Validation |
| ----------------------- | -------------------- | -------------------- |
| `enabled` | `EMAIL_ENABLED` | `false` |
| `address` | `EMAIL_ADDRESS` | required when enabled |
| `imap.host` | `EMAIL_IMAP_HOST` | required when enabled |
| `imap.port` | `EMAIL_IMAP_PORT` | 993 (tls), 143 (starttls) |
| `imap.tlsMode` | `EMAIL_IMAP_TLS_MODE` | tls; tls or starttls only (plaintext rejected) |
| `imap.username` | `EMAIL_IMAP_USERNAME` | required when enabled |
| `imap.password` | `EMAIL_IMAP_PASSWORD` | required credential reference |
| `smtp.host` | `EMAIL_SMTP_HOST` | required when enabled |
| `smtp.port` | `EMAIL_SMTP_PORT` | 465 (tls), 587 (starttls) |
| `smtp.tlsMode` | `EMAIL_SMTP_TLS_MODE` | tls; tls or starttls only (plaintext rejected) |
| `smtp.username` | `EMAIL_SMTP_USERNAME` | required when enabled |
| `smtp.password` | `EMAIL_SMTP_PASSWORD` | required distinct credential reference |
| `incomingFolder` | `EMAIL_INCOMING_FOLDER` | `INBOX` |
| `sentFolder` | `EMAIL_SENT_FOLDER` | `Sent` |
| `pollIntervalMs` | `EMAIL_POLL_INTERVAL_MS` | `300000` (5 minutes) |
| `receivingAuth.authservId` | `EMAIL_AUTHSERV_ID` | required trusted receiver identity |
| `receivingAuth.attestedStripping` | `EMAIL_AUTH_HEADER_STRIPPING_ATTESTED` | `false`; required `true` when enabled |
| `maxMessageBytes` | `EMAIL_MAX_MESSAGE_BYTES` | `26214400` (25 MiB) |
| `maxIncomingAttachments` | `EMAIL_MAX_INCOMING_ATTACHMENTS` | `10` |
| `signature` | `EMAIL_SIGNATURE` | empty; literal multiline text (not expanded) |
| `spontaneousPost.enabled` | `EMAIL_SPONTANEOUS_ENABLED` | `false` |
| `spontaneousPost.minIntervalMs` | `EMAIL_SPONTANEOUS_MIN_INTERVAL_MS` | `10800000` (3 hours) |
| `spontaneousPost.maxIntervalMs` | `EMAIL_SPONTANEOUS_MAX_INTERVAL_MS` | `43200000` (12 hours) |
| `spontaneousPost.contextFetchProbability` | `EMAIL_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY` | `0.5` |

### Security & Activation Guard
Production email activation is guarded until the `email-activation` change is completed. Setting `platforms.email.enabled: true` runs transport and trust validation and then halts startup with a `ConfigError` indicating production activation is unavailable in this release.
