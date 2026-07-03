## MODIFIED Requirements

### Requirement: NormalizedEvent Model

The system SHALL normalize all incoming platform events into a `NormalizedEvent` structure with fields: `platform` (Platform type), `channelId`, `userId`, `username` (optional), `messageId`, `isDm`, `guildId` (empty string if not applicable), `content`, `timestamp`, `attachments` (optional array of `Attachment`), and `raw` (optional, original platform object). For Misskey notes, `isDm` SHALL be derived from the note visibility: notes with visibility `"specified"` SHALL be classified as direct messages (`isDm` set to `true`).

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
