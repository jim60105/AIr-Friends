# Platform Abstraction & Extensibility

## Purpose

Defines the unified platform abstraction layer that normalizes events across Discord and Misskey into a common model, provides a base adapter class with required methods, manages multi-platform connections with automatic reconnection, and handles platform-specific behaviors transparently.
## Requirements
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

### Requirement: Platform Type Validation

The system SHALL restrict the `Platform` type to the literal union `"discord" | "misskey"` and provide a validator function for runtime checks.

#### Scenario: Valid platform string
- **GIVEN** a string value `"discord"` or `"misskey"`
- **WHEN** validated as a Platform
- **THEN** it SHALL pass validation

#### Scenario: Invalid platform string
- **GIVEN** a string value not in the valid set
- **WHEN** validated as a Platform
- **THEN** it SHALL fail validation

### Requirement: Attachment Model

The system SHALL represent message attachments with the `Attachment` interface containing: `id`, `url`, `mimeType`, `filename`, optional `size`, `width`, `height`, and a computed `isImage` flag (true when mimeType starts with `"image/"`).

#### Scenario: Image attachment detection
- **GIVEN** an attachment with mimeType `"image/png"`
- **WHEN** the attachment is processed
- **THEN** `isImage` SHALL be `true`

#### Scenario: Non-image attachment
- **GIVEN** an attachment with mimeType `"application/pdf"`
- **WHEN** the attachment is processed
- **THEN** `isImage` SHALL be `false`

### Requirement: PlatformMessage Model

The system SHALL use `PlatformMessage` for conversation history entries with fields: `messageId`, `userId`, `username`, `content`, `timestamp`, `isBot`, and optional `attachments`.

#### Scenario: Bot message marking
- **GIVEN** a message from a bot account
- **WHEN** converted to `PlatformMessage`
- **THEN** `isBot` SHALL be `true`

---

### Requirement: PlatformAdapter Abstract Class

The system SHALL define an abstract `PlatformAdapter` base class that all platform implementations MUST extend, providing a uniform interface for platform operations.

#### Scenario: Required abstract methods
- **GIVEN** a new platform adapter implementation
- **WHEN** the class extends `PlatformAdapter`
- **THEN** it SHALL implement all abstract methods: `connect()`, `disconnect()`, `sendTyping()`, `sendReply()`, `fetchRecentMessages()`, `fetchEmojis()`, `addReaction()`, `editMessage()`, `sendFile()`, `getUsername()`, `isSelf()`, `getBotId()`, `getDmChannelId()`, `hasBotReaction()`, `hasBotMention()`, `fetchMessage()`, and `determineSpontaneousTarget()`

#### Scenario: Optional search method
- **GIVEN** a platform adapter
- **WHEN** `searchRelatedMessages` is not overridden
- **THEN** it MAY return undefined (the method is optional)

#### Scenario: Event emission
- **GIVEN** registered event handlers on an adapter
- **WHEN** `emitEvent()` is called with a `NormalizedEvent`
- **THEN** it SHALL invoke all registered handlers, catching and logging errors from individual handlers without blocking others

#### Scenario: Connection state tracking
- **GIVEN** a platform adapter
- **WHEN** the connection state changes
- **THEN** it SHALL update `connectionStatus` via `updateConnectionState()` with the new `ConnectionState` and optional error message

#### Scenario: Typing indicator support
- **GIVEN** a platform adapter
- **WHEN** `supportsTypingIndicator()` is called
- **THEN** it SHALL return `false` by default; subclasses MAY override to return `true`

### Requirement: PlatformCapabilities Declaration

Each platform adapter SHALL declare its capabilities via the `PlatformCapabilities` interface: `canFetchHistory`, `canSearchMessages`, `supportsDm`, `supportsGuild`, `supportsReactions`, and `maxMessageLength`.

#### Scenario: Discord capabilities
- **GIVEN** the Discord adapter
- **WHEN** capabilities are queried
- **THEN** it SHALL report `supportsGuild: true` and `maxMessageLength: 2000`

#### Scenario: Misskey capabilities
- **GIVEN** the Misskey adapter
- **WHEN** capabilities are queried
- **THEN** it SHALL report `supportsGuild: false` and `maxMessageLength: 3000`

---

### Requirement: PlatformRegistry Multi-Platform Management

The system SHALL provide a `PlatformRegistry` singleton that manages multiple platform adapters, forwarding events from all platforms to globally registered handlers.

#### Scenario: Adapter registration
- **GIVEN** a platform adapter
- **WHEN** registered with `PlatformRegistry`
- **THEN** the registry SHALL create a `ConnectionManager` for it and forward its events to all global handlers

#### Scenario: Connect all platforms
- **GIVEN** multiple registered adapters
- **WHEN** `connectAll()` is called
- **THEN** it SHALL connect all registered adapters via their respective `ConnectionManager` instances

#### Scenario: Disconnect all platforms
- **GIVEN** connected adapters
- **WHEN** `disconnectAll()` is called
- **THEN** it SHALL disconnect all adapters gracefully

#### Scenario: Status aggregation
- **GIVEN** multiple registered adapters
- **WHEN** `isAllConnected()` is called
- **THEN** it SHALL return `true` only if all adapters are in `CONNECTED` state

### Requirement: ConnectionManager Reconnection

The system SHALL provide a `ConnectionManager` with exponential backoff reconnection for each platform adapter.

#### Scenario: Retry configuration defaults
- **GIVEN** a ConnectionManager with default config
- **WHEN** initialized
- **THEN** it SHALL use `baseDelay: 1000ms`, `maxDelay: 60000ms`, `maxAttempts: 0` (infinite), and `backoffMultiplier: 2`

#### Scenario: Exponential backoff with jitter
- **GIVEN** a failed connection attempt
- **WHEN** calculating the next retry delay
- **THEN** it SHALL apply exponential backoff (`baseDelay * multiplier^attempt`) capped at `maxDelay`, with ±10% random jitter

#### Scenario: Connection monitoring
- **GIVEN** an active connection
- **WHEN** the connection monitor runs (30-second interval)
- **THEN** it SHALL detect stale connections and trigger reconnection if needed

#### Scenario: Graceful shutdown
- **GIVEN** an active connection with reconnection in progress
- **WHEN** `disconnect()` is called
- **THEN** it SHALL stop reconnection attempts and disconnect gracefully

---

### Requirement: Discord Message Processing

The Discord adapter SHALL handle message events with filtering, normalization, and mention processing.

#### Scenario: Message filtering
- **GIVEN** a Discord message event
- **WHEN** `shouldRespondToMessage()` evaluates the message
- **THEN** it SHALL reject messages from bots, messages from self, and SHALL check DM allowance (`allowDm`), mention requirement (`respondToMention`), and command prefix matching

#### Scenario: Bot mention removal
- **GIVEN** a message that mentions the bot
- **WHEN** processed by the adapter
- **THEN** it SHALL remove the bot mention from the content before emitting the event

#### Scenario: Sticker handling
- **GIVEN** a Discord message with stickers
- **WHEN** normalized
- **THEN** sticker content SHALL be appended to the message content as `[Sticker: name (tags)]` when sticker tags are present, or `[Sticker: name]` when tags are absent

### Requirement: Discord Typing Indicator

The Discord adapter SHALL support typing indicators when configured.

#### Scenario: Typing indicator enabled
- **GIVEN** `typingIndicator.enabled` is `true` in Discord config
- **WHEN** `supportsTypingIndicator()` is called
- **THEN** it SHALL return `true`

### Requirement: Discord DM Channel Creation

The Discord adapter SHALL support creating DM channels for direct messaging.

#### Scenario: DM channel creation
- **GIVEN** a user ID
- **WHEN** `getDmChannelId()` is called
- **THEN** it SHALL create or fetch the DM channel via Discord API and return the channel ID

### Requirement: Discord Guild Emoji Formatting

The Discord adapter SHALL fetch and cache guild and application emojis.

#### Scenario: Emoji caching
- **GIVEN** configured guild IDs
- **WHEN** `fetchEmojis()` is called
- **THEN** it SHALL fetch guild and application emojis, filter out premium-only emojis, cache them with a 5-minute TTL, and return them as `PlatformEmoji` objects

### Requirement: Discord Slash Command Cleanup

The Discord adapter SHALL clean up any registered slash commands on startup.

#### Scenario: Command cleanup on ready
- **GIVEN** the Discord bot becomes ready
- **WHEN** the ready event fires
- **THEN** it SHALL delete all global and guild-scoped slash commands

### Requirement: Discord Spontaneous Target Selection

The Discord adapter SHALL select random targets from channels configured with `spontaneousPost: true`.

#### Scenario: Channel target selection
- **GIVEN** channels configured with `spontaneousPost: true`
- **WHEN** `determineSpontaneousTarget()` is called
- **THEN** it SHALL randomly select one channel, supporting both text channels and DM targets (via account entries)

### Requirement: Discord Search

The Discord adapter SHALL support simple keyword-based message search.

#### Scenario: Message search
- **GIVEN** a search query
- **WHEN** `searchRelatedMessages()` is called
- **THEN** it SHALL fetch up to 50 recent messages and filter them by keyword match

---

### Requirement: Misskey WebSocket Streaming

The Misskey adapter SHALL connect via WebSocket streaming to receive real-time events.

#### Scenario: Connection setup
- **GIVEN** valid Misskey host and token configuration
- **WHEN** `connect()` is called
- **THEN** it SHALL retrieve bot info, establish a WebSocket stream connection, and subscribe to the main channel for mentions, replies, and DMs

#### Scenario: Heartbeat keep-alive
- **GIVEN** an active WebSocket connection
- **WHEN** the heartbeat timer fires (60-second interval)
- **THEN** it SHALL send a ping to maintain the connection

### Requirement: Misskey Note Channel Types

The Misskey adapter SHALL support three distinct channel types identified by channel ID format.

#### Scenario: Note conversation thread
- **GIVEN** a channel ID in format `"note:{noteId}"`
- **WHEN** fetching recent messages
- **THEN** it SHALL assemble the thread with ancestors, the current note, and replies using fallback chains for fork compatibility

#### Scenario: DM channel
- **GIVEN** a channel ID in format `"dm:{userId}"`
- **WHEN** fetching recent messages
- **THEN** it SHALL fetch mentions filtered to the specified user

#### Scenario: Chat channel
- **GIVEN** a channel ID in format `"chat:{userId}"`
- **WHEN** fetching recent messages
- **THEN** it SHALL fetch messages via `chat/messages/user-timeline` API

#### Scenario: Self timeline
- **GIVEN** a channel ID `"timeline:self"`
- **WHEN** fetching recent messages
- **THEN** it SHALL fetch the bot's own notes excluding replies via `users/notes` API

### Requirement: Misskey Reply Threading

The Misskey adapter SHALL thread replies to the original note using `replyId`.

#### Scenario: Reply to existing note
- **GIVEN** a send-reply request with a source note
- **WHEN** `sendReply()` is called with a `note:{noteId}` channel
- **THEN** it SHALL create a note with `replyId` pointing to the original note

#### Scenario: Visibility inheritance
- **GIVEN** a reply to an existing note
- **WHEN** `buildReplyParams()` is called
- **THEN** it SHALL inherit the original note's visibility and, for `"specified"` visibility, set `visibleUserIds` to `[originalNote.userId]`

#### Scenario: Timeline post without reply
- **GIVEN** a send-reply request for `"timeline:self"` channel
- **WHEN** `sendReply()` is called
- **THEN** it SHALL create a new note without `replyId`

### Requirement: Misskey Username Format

The Misskey adapter SHALL format usernames as `@displayName` in conversation history.

#### Scenario: Username formatting in history
- **GIVEN** a Misskey note or chat message with user info
- **WHEN** converted to `PlatformMessage`
- **THEN** the `username` field SHALL be formatted as `@displayName` (using the user's display name or username)

### Requirement: Misskey Bot Message Filtering

The Misskey adapter SHALL filter out messages from bot accounts.

#### Scenario: Bot note filtering
- **GIVEN** a note from a user with `isBot: true`
- **WHEN** `shouldRespondToNote()` evaluates the note
- **THEN** it SHALL return `false` to prevent responding

#### Scenario: Bot chat message filtering
- **GIVEN** a chat message from a user with `isBot: true`
- **WHEN** `shouldRespondToChatMessage()` evaluates the message
- **THEN** it SHALL return `false` to prevent responding

### Requirement: Misskey Chat Message Support

The Misskey adapter SHALL support private chat messages via Misskey's chat API.

#### Scenario: Chat message sending
- **GIVEN** a channel ID in format `"chat:{userId}"`
- **WHEN** `sendReply()` is called
- **THEN** it SHALL send the message via `chat/messages/create-to-user` API endpoint

#### Scenario: Chat reaction
- **GIVEN** a chat message ID
- **WHEN** `addReaction()` is called with a `"chat:{userId}"` channel
- **THEN** it SHALL use `chat/messages/react` API instead of `notes/reactions/create`

### Requirement: Misskey Delete-and-Recreate Edit Strategy

The Misskey adapter SHALL implement message editing via a delete-and-recreate strategy since Misskey has no native edit API.

#### Scenario: Edit message
- **GIVEN** a previously sent note
- **WHEN** `editMessage()` is called
- **THEN** it SHALL delete the original note via `notes/delete`, create a new note with the updated content, set `replyId` to the original trigger note (not the deleted note), and return the new message ID

### Requirement: Misskey Fallback Chains for Fork Compatibility

The Misskey adapter SHALL implement API fallback chains for compatibility with Misskey forks.

#### Scenario: Reply fetching fallback
- **GIVEN** a note thread assembly
- **WHEN** fetching replies
- **THEN** it SHALL try `notes/children` first, fall back to `notes/replies`, and return empty on both failures

#### Scenario: Ancestor fetching fallback
- **GIVEN** a note thread assembly
- **WHEN** fetching ancestor notes
- **THEN** it SHALL try `notes/conversation` first, fall back to walking the `replyId` chain via `notes/show`

### Requirement: Misskey Spontaneous Target Selection

The Misskey adapter SHALL support `misskey/timeline/self` as a spontaneous posting target in addition to account-based targets.

#### Scenario: Timeline self target
- **GIVEN** `misskey/timeline/self` in configured spontaneous channels
- **WHEN** `determineSpontaneousTarget()` is called
- **THEN** it SHALL include `"timeline:self"` as a valid target option

---

### Requirement: Cross-Platform Workspace Isolation

The system SHALL use `workspace_key = "{platform}/{user_id}"` to ensure cross-platform memory isolation.

#### Scenario: Same user on different platforms
- **GIVEN** a user with the same user ID on Discord and Misskey
- **WHEN** workspace keys are generated
- **THEN** they SHALL produce different workspace keys (`"discord/{id}"` vs `"misskey/{id}"`)

### Requirement: Error Resilience

Platform adapters SHALL wrap errors in `PlatformError` with appropriate `ErrorCode` values and SHALL NOT allow individual operation failures to crash the bot.

#### Scenario: Event handler error isolation
- **GIVEN** multiple event handlers registered
- **WHEN** one handler throws an error
- **THEN** the adapter SHALL log the error and continue invoking remaining handlers

#### Scenario: Optional method failure
- **GIVEN** an optional method like search or emoji fetch
- **WHEN** the operation fails
- **THEN** it SHALL return an empty result (empty array or undefined) rather than throwing

---

### Requirement: Event Router

The `EventRouter` SHALL route `NormalizedEvent` instances to registered handlers based on condition predicates, evaluated in registration order, with an optional default fallback handler.

#### Scenario: Condition-based routing
- **GIVEN** one or more routes registered via `addRoute(name, condition, handler)`
- **WHEN** `route(event)` is called
- **THEN** the system SHALL evaluate each route's condition in registration order and invoke the handler of the first matching route

#### Scenario: Default fallback handler
- **GIVEN** no route condition matches the event
- **AND** a default handler has been set via `setDefaultHandler()`
- **WHEN** `route(event)` is called
- **THEN** the system SHALL invoke the default handler

#### Scenario: No matching route and no default handler
- **GIVEN** no route condition matches and no default handler is set
- **WHEN** `route(event)` is called
- **THEN** the system SHALL log a warning and take no further action

#### Scenario: Route handler error isolation
- **GIVEN** a route handler throws an error
- **WHEN** the handler is invoked during routing
- **THEN** the system SHALL catch and log the error without propagating it to the caller

#### Scenario: Predefined condition helpers
- The system SHALL provide the following reusable `RouteCondition` factories:
  - `isDmEvent` — matches events where `isDm` is `true`
  - `isGuildEvent` — matches events where `isDm` is `false` and `guildId` is truthy
  - `isPlatform(...platforms)` — matches events whose `platform` is in the given list
  - `containsKeyword(...keywords)` — matches events whose `content` contains any keyword (case-insensitive)
  - `allOf(...conditions)` — combines conditions with AND logic
  - `anyOf(...conditions)` — combines conditions with OR logic

#### Scenario: Registry connection
- **GIVEN** a `PlatformRegistry` instance
- **WHEN** `connectToRegistry(registry)` is called
- **THEN** the router SHALL subscribe to the registry's event stream via `registry.onEvent()` and route each incoming event

