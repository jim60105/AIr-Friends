# Context Assembly

## Purpose

Defines how the system assembles initial context for each agent session, combining memories, recent channel messages, and guild-related context. Includes the `/clear` command for context truncation and the no-compression policy.

## Requirements

### Requirement: Initial Context Composition

The system SHALL assemble initial context from three data sources in the following priority order:

1. **High-importance memories** — all enabled memories with `importance = "high"` from the user's workspace, fully loaded without truncation.
2. **Recent channel messages** — the most recent messages from the trigger channel, up to a configurable limit (`recentMessageLimit`, default 20).
3. **Related guild messages** — messages from the same guild matching the trigger content, fetched only in guild (non-DM) contexts, with a fixed limit of 10 messages.

#### Scenario: Context assembly for a guild message
- **GIVEN** a user sends a message in a guild channel
- **WHEN** `assembleContext()` is called
- **THEN** the system SHALL load all high-importance memories, fetch up to `recentMessageLimit` recent channel messages, and search for up to 10 related messages from the same guild

#### Scenario: Context assembly for a DM
- **GIVEN** a user sends a direct message (`isDm = true`)
- **WHEN** `assembleContext()` is called
- **THEN** the system SHALL load high-importance memories and recent channel messages
- **AND** the system SHALL NOT fetch related guild messages

#### Scenario: High-importance memories always fully included
- **GIVEN** a user has multiple high-importance memories
- **WHEN** context is assembled
- **THEN** all enabled high-importance memories SHALL be included in the mandatory token budget, sorted by `createdAt` (oldest first), and SHALL NOT be truncated or summarized

### Requirement: Token Budget Allocation

The system SHALL allocate token budget with the following priority: mandatory content (memories + trigger message) first, then conversation messages (recent and related), then available emojis (up to MAX_EMOJIS = 50) using any remaining budget. When conversation content exceeds budget, the system SHALL truncate oldest messages first, prioritizing recent messages over related messages via `formatConversationSectionWithBudget()`.

#### Scenario: Budget overflow truncates oldest messages
- **GIVEN** recent and related messages exceed the available token budget
- **WHEN** `formatConversationSectionWithBudget()` is called
- **THEN** the system SHALL drop the oldest messages first, keeping the most recent messages

### Requirement: /clear Command Behavior

The system SHALL support a `/clear` command that truncates recent message history. When a message starting with `/clear` (whitespace-trimmed) appears in recent message history, the system SHALL drop that message and all messages before it, including only messages after the last `/clear` in the context. The `/clear` command SHALL affect only recent channel messages; memories and guild-related context SHALL NOT be affected.

#### Scenario: /clear in message history truncates context
- **GIVEN** recent messages contain a message starting with `/clear` at position N
- **WHEN** `applyClearCommand()` is called
- **THEN** the system SHALL drop message N and all messages before it
- **AND** only messages after position N SHALL be included in context
- **AND** the `/clear` message itself SHALL NOT be included

#### Scenario: Multiple /clear messages use the last one
- **GIVEN** recent messages contain multiple messages starting with `/clear`
- **WHEN** `applyClearCommand()` is called
- **THEN** the system SHALL use the last `/clear` message as the truncation point

#### Scenario: /clear does not affect memories
- **GIVEN** a user has memories and recent messages with a `/clear` command
- **WHEN** context is assembled
- **THEN** all high-importance memories SHALL still be fully included regardless of `/clear`

#### Scenario: Trigger message is /clear — immediate exit
- **GIVEN** the trigger message content starts with `/clear`
- **WHEN** the system processes the trigger
- **THEN** the system SHALL immediately return without creating an agent session, sending any reply, or modifying the workspace

### Requirement: No Automatic Compression

The system SHALL NOT perform automatic summarization or compression of memories or messages during normal message handling. Overflow SHALL be prevented only via fixed quotas (token budget) and retrieval limits (message count limits, search limits).

#### Scenario: Large context handled by truncation, not summarization
- **GIVEN** the assembled context exceeds the token limit
- **WHEN** context formatting occurs
- **THEN** the system SHALL truncate overflow content via budget allocation rules
- **AND** SHALL NOT invoke any summarization or compression algorithm

### Requirement: Spontaneous Context Assembly

The system SHALL support context assembly without a trigger message for spontaneous posts via `assembleSpontaneousContext()`. Recent message fetching SHALL be optional, controlled by the `fetchRecentMessages` option. The assembled context SHALL track whether recent messages were actually fetched in the `recentMessagesFetched` flag. No guild-related messages SHALL be fetched for spontaneous contexts.

#### Scenario: Spontaneous post with recent messages
- **GIVEN** a spontaneous post is triggered with `fetchRecentMessages = true`
- **WHEN** `assembleSpontaneousContext()` is called
- **THEN** the system SHALL fetch recent messages for the target channel and set `recentMessagesFetched = true`

#### Scenario: Spontaneous post without recent messages
- **GIVEN** a spontaneous post is triggered with `fetchRecentMessages = false`
- **WHEN** `assembleSpontaneousContext()` is called
- **THEN** the system SHALL NOT fetch recent messages and SHALL set `recentMessagesFetched = false`
