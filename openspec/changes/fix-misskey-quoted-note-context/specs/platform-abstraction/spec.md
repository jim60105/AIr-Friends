## MODIFIED Requirements

### Requirement: NormalizedEvent Model

The system SHALL normalize all incoming platform events into a `NormalizedEvent` structure with fields: `platform` (Platform type), `channelId`, `userId`, `username` (optional), `messageId`, `isDm`, `guildId` (empty string if not applicable), `content`, `timestamp`, `attachments` (optional array of `Attachment`), `quotedNote` (optional typed third-party note reference), and `raw` (optional, original platform object). For Misskey notes, `isDm` SHALL be derived from the note visibility: notes with visibility `"specified"` SHALL be classified as direct messages (`isDm` set to `true`). `content`, author fields and `attachments` SHALL describe the outer message only; quoted source data SHALL remain separate.

#### Scenario: Discord message normalization
- **GIVEN** a Discord message is received
- **WHEN** the adapter processes the message
- **THEN** it SHALL produce a `NormalizedEvent` with `platform` set to `"discord"`, sticker content appended as `[Sticker: name (tags)]` (or `[Sticker: name]` when tags are absent) in the content field, and attachments extracted from `message.attachments`

#### Scenario: Misskey note normalization
- **GIVEN** a Misskey note is received via WebSocket streaming
- **WHEN** the adapter processes the note
- **THEN** it SHALL produce a `NormalizedEvent` with `platform` set to `"misskey"`, `channelId` set to `"note:{noteId}"`, and attachments extracted from `note.files`

#### Scenario: Misskey chat message normalization
- **GIVEN** a Misskey chat message is received
- **WHEN** the adapter processes the message
- **THEN** it SHALL produce a `NormalizedEvent` with `channelId` set to `"chat:{userId}"` and `isDm` set to `true`

#### Scenario: Misskey DM normalization
- **GIVEN** a Misskey note with visibility `"specified"` is received via the mention stream
- **WHEN** the adapter processes the note
- **THEN** it SHALL normalize the note with `channelId` set to `"dm:{userId}"` and `isDm` set to `true`, with filtering controlled by the `allowDm` configuration
- **AND** the reply policy SHALL gate the note as a DM (e.g. in `public` mode a non-whitelisted `specified` note SHALL NOT receive a reply)

#### Scenario: Quote preserves outer identity
- **GIVEN** a Misskey user quotes a source authored by a different account
- **WHEN** the event is normalized
- **THEN** outer content, user id, workspace ownership, channel, visibility and reply anchor SHALL remain those of the quoting note
- **AND** the quoted author and source SHALL occur only in the separate `quotedNote` reference

### Requirement: PlatformMessage Model

The system SHALL use `PlatformMessage` for conversation history entries with fields: `messageId`, `userId`, `username`, `content`, `timestamp`, `isBot`, optional `attachments`, and optional `quotedNote`. The quote reference SHALL use the same typed contract as normalized events, without concatenating source text into outer content or changing the outer bot status.

#### Scenario: Bot message marking
- **GIVEN** a message from a bot account
- **WHEN** converted to `PlatformMessage`
- **THEN** `isBot` SHALL be `true`

#### Scenario: History retains a quote
- **GIVEN** a retained Misskey history note has an embedded quoted source
- **WHEN** the history message is returned
- **THEN** its `quotedNote` SHALL preserve the immediately quoted source and original author
- **AND** its outer content and bot status SHALL retain their original meaning

## ADDED Requirements

### Requirement: Misskey One-Hop Quoted Note Reference

For a Misskey note with its own text or files and a quote relationship, the system SHALL preserve the immediately quoted source as a typed `quotedNote` reference. Available references SHALL contain source note id, original author identity and username with remote host when supplied, optional display name, source text and optional source attachments, plus a source HTTP(S) URL when available or derivable from the configured instance. Unavailable references SHALL contain the known source id and a finite status reason without invented source content. Missing quote data SHALL leave `quotedNote` absent for ordinary notes, Discord messages and Misskey chat. Source text SHALL remain unchanged by outer bot-mention removal.

#### Scenario: Embedded source needs no request
- **GIVEN** an eligible quote-renote with a valid complete embedded source, no reply parent and an article URL in source text
- **WHEN** the trigger or retained history entry is converted
- **THEN** source text, article URL, source identity and author SHALL be present in `quotedNote`
- **AND** zero additional source requests SHALL be issued

#### Scenario: Remote provenance remains distinct
- **GIVEN** the quoted source has a local instance id and a different remote source URI and author host
- **WHEN** the quote is represented
- **THEN** the local source id SHALL remain distinct from the remote URL and author handle
- **AND** non-HTTP(S) source URLs SHALL be omitted

#### Scenario: Nested quote is not expanded
- **GIVEN** the immediate source itself quotes another note
- **WHEN** quote context is created
- **THEN** only the immediate source's own body and files SHALL be represented
- **AND** no nested quote reference or recursive lookup SHALL be added

#### Scenario: Empty and attachment-only source
- **GIVEN** a source with valid id and author but null text
- **WHEN** it is converted with files or without files
- **THEN** the available reference SHALL have empty content and preserve any supplied files
- **AND** empty content alone SHALL NOT classify a valid source as unavailable

#### Scenario: Pure renote and ordinary behavior unchanged
- **GIVEN** a pure renote with no outer text or files, or an ordinary message without a quote
- **WHEN** it is evaluated and converted
- **THEN** existing trigger/filter behavior SHALL be unchanged
- **AND** no quote-driven source lookup, source-driven mention eligibility or additional quote reference SHALL be introduced

### Requirement: Bounded Nonfatal Misskey Quote Resolution

When an eligible retained note has an authoritative source id without usable embedded data, the system SHALL attempt source resolution through the configured Misskey instance only. Enrichment SHALL use a cumulative five-second deadline per event or history/search invocation, at most one request per distinct missing source id, invocation-local reuse of success/failure results and no retries. History enrichment SHALL apply only to retained outer messages after existing retrieval limits. The active request SHALL be aborted on timeout. Unavailable outcomes SHALL distinguish unattempted/not-loaded, lookup failure, timeout, exhausted enrichment budget and invalid source. Optional enrichment failure SHALL preserve the outer message and other successful context.

#### Scenario: Source-id-only note is hydrated
- **GIVEN** a quote contains a source id but no embedded source
- **WHEN** a source lookup succeeds with matching id and valid author
- **THEN** the trigger/history reference SHALL contain the retrieved source content
- **AND** the lookup SHALL target the configured instance with the source id, without fetching any supplied source or article URL

#### Scenario: Shared source is requested once
- **GIVEN** retained history contains multiple quotes of the same missing source and other notes excluded by the history limit
- **WHEN** enrichment occurs
- **THEN** at most one lookup SHALL occur for that retained source, including when it fails
- **AND** excluded notes SHALL cause no source lookups

#### Scenario: Lookup failure is nonfatal
- **WHEN** a source lookup returns missing, inaccessible, rate-limited, server-error or malformed data
- **THEN** the outer message and its own attachments SHALL still be returned
- **AND** the quote SHALL carry an unavailable reason without fabricated text, retries or alternate-endpoint requests

#### Scenario: Deadline bounds the whole operation
- **GIVEN** several retained quotes lack embedded sources and a lookup remains pending
- **WHEN** the five-second cumulative enrichment deadline expires
- **THEN** the pending HTTP operation SHALL be aborted and marked unavailable with reason `timeout`
- **AND** remaining unattempted sources SHALL have reason `budget_exhausted`
- **AND** embedded quotes and outer messages SHALL remain available

#### Scenario: Conflicting identity never becomes source content
- **GIVEN** embedded or fetched source id conflicts with the authoritative source id, or required author identity is absent
- **WHEN** source data is evaluated
- **THEN** the invalid data SHALL NOT become an available reference
- **AND** at most one authoritative-id lookup SHALL be attempted for unusable embedded data; invalid lookup output SHALL yield `invalid_source`
