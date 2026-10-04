## MODIFIED Requirements

### Requirement: Misskey Note Channel Types

The Misskey adapter SHALL support three distinct channel types identified by channel ID format.

#### Scenario: Note conversation thread

- **GIVEN** a channel ID in format `"note:{noteId}"`
- **WHEN** fetching recent messages
- **THEN** it SHALL assemble the thread with ancestors, the current note, and replies using fallback chains for fork compatibility

#### Scenario: DM channel

- **GIVEN** a channel ID in format `"dm:{userId}"`
- **WHEN** fetching recent messages
- **THEN** it SHALL fetch incoming notes via `notes/mentions` and keep only notes with `userId` equal to the channel's user, applying no `replyId`-based inclusion
- **AND** it SHALL fetch the bot's own notes via `users/notes` with `withReplies: true`, keeping only notes with `visibility` `"specified"` whose `visibleUserIds` include the channel's user
- **AND** it SHALL merge both sources, deduplicate by note ID, sort ascending by `createdAt`, and return the most recent `limit` entries

#### Scenario: DM channel excludes unrelated replies

- **GIVEN** a `notes/mentions` result containing a note authored by a different user that replies to or mentions the bot
- **WHEN** fetching recent messages for `"dm:{userId}"`
- **THEN** that note SHALL NOT be included in the returned history

#### Scenario: Chat channel

- **GIVEN** a channel ID in format `"chat:{userId}"`
- **WHEN** fetching recent messages
- **THEN** it SHALL fetch messages via `chat/messages/user-timeline` API

#### Scenario: Self timeline

- **GIVEN** a channel ID `"timeline:self"`
- **WHEN** fetching recent messages
- **THEN** it SHALL fetch the bot's own notes excluding replies via `users/notes` API
