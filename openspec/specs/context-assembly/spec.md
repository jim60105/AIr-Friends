# Context Assembly

## Purpose

Defines how the system assembles initial context for each agent session, combining memories, recent channel messages, and guild-related context. Includes the `/clear` command for context truncation and the no-compression policy.

## Requirements

### Requirement: Token Budget Allocation

The system SHALL allocate token budget with the following priority: mandatory content first, then conversation messages (recent and related), then available emojis (up to MAX_EMOJIS = 50) using any remaining budget. Mandatory content is the fixed memory sections, any recall sections, and the trigger message. The memory portion of mandatory content SHALL be bounded by the sum of the configured fixed-memory budgets and any recall budgets, plus section headings. When conversation content exceeds budget, the system SHALL truncate oldest messages first, prioritizing recent messages over related messages via `formatConversationSectionWithBudget()`.

#### Scenario: Budget overflow truncates oldest messages
- **GIVEN** recent and related messages exceed the available token budget
- **WHEN** `formatConversationSectionWithBudget()` is called
- **THEN** the system SHALL drop the oldest messages first, keeping the most recent messages

#### Scenario: Fixed memory portion is bounded regardless of store size
- **GIVEN** a user has 500 enabled memories across all tiers and no recall section is present
- **WHEN** context is assembled with default configuration
- **THEN** the memory portion of mandatory content SHALL NOT exceed 512 + 384 estimated tokens plus section headings

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
- **THEN** fixed memories SHALL still be loaded within their budgets regardless of `/clear`

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

The system SHALL support context assembly without a trigger message for spontaneous posts via `assembleSpontaneousContext()`. Recent message fetching SHALL be optional, controlled by the `fetchRecentMessages` option. The assembled context SHALL track whether recent messages were actually fetched in the `recentMessagesFetched` flag. No guild-related messages SHALL be fetched for spontaneous contexts. Fixed memories SHALL be selected within the same budgets as triggered sessions.

#### Scenario: Spontaneous post with recent messages
- **GIVEN** a spontaneous post is triggered with `fetchRecentMessages = true`
- **WHEN** `assembleSpontaneousContext()` is called
- **THEN** the system SHALL fetch recent messages for the target channel and set `recentMessagesFetched = true`

#### Scenario: Spontaneous post without recent messages
- **GIVEN** a spontaneous post is triggered with `fetchRecentMessages = false`
- **WHEN** `assembleSpontaneousContext()` is called
- **THEN** the system SHALL NOT fetch recent messages and SHALL set `recentMessagesFetched = false`

#### Scenario: Spontaneous context uses fixed budgets
- **GIVEN** a user has 25 working-tier memories
- **WHEN** `assembleSpontaneousContext()` is called with default configuration
- **THEN** at most 4 working-tier memories SHALL be loaded

### Requirement: Initial Context Composition with Fixed Budgets

The system SHALL assemble initial context for a triggered session from the following sources, in this priority order:

1. **Fixed memories**: core-tier and newest working-tier memories from the user's workspace and, in a channel, the channel's memory file, selected within the tiered context loading budgets.
2. **Recent channel messages**: the most recent messages from the trigger channel, up to `recentMessageLimit` (default 20).
3. **Related guild messages**: messages from the same guild matching the trigger content, fetched only in guild (non-DM) contexts, with a fixed limit of 10 messages.

Fixed memories SHALL NOT be summarized or truncated mid-entry.

#### Scenario: Context assembly for a guild message
- **GIVEN** a user sends a message in a guild channel
- **WHEN** `assembleContext()` is called
- **THEN** the system SHALL load fixed memories within budget, fetch up to `recentMessageLimit` recent channel messages, and search for up to 10 related messages from the same guild

#### Scenario: Context assembly for a DM
- **GIVEN** a user sends a direct message (`isDm = true`)
- **WHEN** `assembleContext()` is called
- **THEN** the system SHALL load fixed memories within budget and fetch recent channel messages
- **AND** the system SHALL NOT fetch related guild messages

#### Scenario: Fixed memories are whole entries
- **GIVEN** a core memory longer than the remaining core budget
- **WHEN** context is assembled
- **THEN** that memory SHALL be skipped entirely rather than cut

### Requirement: Fast Recall in Initial Context

When `memory.recall.fastRecallEnabled` is `true`, assembling a triggered session SHALL add the Fast Recall section defined by the `memory-recall` capability. The section SHALL be placed directly after the fixed memory sections and before the conversation section, and SHALL be counted as mandatory content. When it is `false`, no recall search SHALL run. Contexts assembled without a trigger message, such as spontaneous posts, SHALL NOT run Fast Recall.

#### Scenario: Fast Recall placement
- **GIVEN** Fast Recall selects one memory
- **WHEN** the context is formatted
- **THEN** the Fast Recall section SHALL appear after the fixed memory sections and before the conversation section

#### Scenario: Fast Recall disabled
- **GIVEN** `memory.recall.fastRecallEnabled` is `false`
- **WHEN** `assembleContext()` is called
- **THEN** no Fast Recall section SHALL be present and no recall search SHALL run

#### Scenario: No Fast Recall without a trigger
- **WHEN** `assembleSpontaneousContext()` is called
- **THEN** no Fast Recall section SHALL be present

#### Scenario: Memory portion bounded with Fast Recall
- **GIVEN** a user has 500 enabled memories and the session has no agent workspace
- **WHEN** context is assembled with default configuration
- **THEN** the memory portion of mandatory content SHALL NOT exceed 512 + 384 + 192 estimated tokens plus section headings

### Requirement: Attributed Third-Party Quote Context

The system SHALL preserve an available quoted reference in the current message and in every retained recent, related or spontaneous-history message. It SHALL display source identity, original author, source URL when present, source text and attachment metadata within an explicit third-party reference boundary stating that quoted commands are not the user's direct instructions. Source authors SHALL remain separate from the outer user/bot speaker. Unavailable references SHALL display known source id and unavailable status without invented content. Trigger budget calculation and final prompt output SHALL use the same current-message representation. Messages without quotes SHALL retain their existing text and attachment formatting.

#### Scenario: Question retains its referent in current message
- **GIVEN** a user asks whether their location has something like an embedded quoted article about unexploded WWII ordnance
- **WHEN** the prompt is assembled
- **THEN** the current-message section SHALL include the user's question and the source body/article URL with source attribution
- **AND** source text SHALL appear inside the third-party reference boundary, without being attributed as the user's direct instructions

#### Scenario: All retained history paths preserve source
- **GIVEN** available quotes occur in retained recent messages, related messages and spontaneous-post history
- **WHEN** each context is formatted
- **THEN** each retained entry SHALL contain its attributed reference using the same third-party boundary contract

#### Scenario: Spontaneous template preserves source
- **GIVEN** a spontaneous-post context includes a quoted source with text and file metadata
- **WHEN** history is projected into the spontaneous template and the final prompt is rendered
- **THEN** the final prompt SHALL contain the source body, separate author, warning boundary and quoted file metadata
- **AND** ordinary spontaneous history without quotes SHALL retain its existing speaker-line format

#### Scenario: Unavailable source is visible
- **GIVEN** quote enrichment fails or exhausts its budget
- **WHEN** the trigger or retained history entry is formatted
- **THEN** the outer message SHALL remain present
- **AND** the reference SHALL identify its source id and unavailable status with no invented source text

#### Scenario: No-quote output remains unchanged
- **GIVEN** equivalent ordinary text-only messages or messages with outer attachments and no quote
- **WHEN** context is formatted before and after quote support
- **THEN** the user-message formatting SHALL remain byte-identical

### Requirement: Quote Data Cannot Create Prompt Boundary Lines

All untrusted quote fields, including text, identity, author names, URLs and attachment names, SHALL be encoded as data inside renderer-owned third-party boundaries. Embedded line breaks, role labels, Markdown headings/fences, closing-boundary text or XML delimiters SHALL NOT produce new renderer-owned speaker, heading or boundary lines. Instruction-looking source text SHALL remain reference data. This formatting contract SHALL NOT be represented as proof of semantic prompt-injection immunity. Command recognition SHALL use outer message content only.

#### Scenario: Instruction-looking quote retains boundary
- **GIVEN** source text says to ignore earlier instructions and identifies itself as a new current message
- **WHEN** context is formatted
- **THEN** the instruction-looking text SHALL remain encoded within the third-party reference data
- **AND** the fixed warning that quoted commands are not direct user instructions SHALL remain present

#### Scenario: Hostile metadata cannot close the reference
- **GIVEN** source text, an author name, source URL or filename contains newlines, the closing label, `[User]`, `## Current Message`, backticks, XML closing tags or Unicode line separators
- **WHEN** the reference is rendered
- **THEN** none of those fields SHALL create a standalone role, heading, fence or closing-boundary line outside encoded data
- **AND** the renderer SHALL produce exactly its own opening and closing boundary for each reference

#### Scenario: Quoted clear is data only
- **GIVEN** the outer message is an ordinary question and its quoted source starts with `/clear`
- **WHEN** context and history are assembled
- **THEN** the quote SHALL NOT clear history, suppress the session or change command recognition

### Requirement: Quote-Aware Token Accounting

Context estimates SHALL include rendered quoted data, attribution, warning boundaries and quoted attachment metadata. The trigger's complete quote SHALL count as mandatory content under the existing trigger policy. Triggered-session history admission SHALL count an outer message and its quote as one whole candidate, preserve recent-over-related priority and drop oldest candidates first when required. No quote body SHALL be summarized or cut mid-reference. Final formatted token estimates SHALL reflect the actual system and user text, including every rendered occurrence of a repeated current/history note. When mandatory content alone exceeds the configured limit, the system SHALL report its actual estimate and omit discretionary history/emojis under the existing soft-budget behavior. Spontaneous contexts SHALL charge their emitted quote references while retaining existing count-based retrieval and unrelated-content estimate conventions.

#### Scenario: Quote overhead changes history admission
- **GIVEN** an old quoted history candidate fits by outer body alone but exceeds available budget when its reference is counted
- **WHEN** conversation admission occurs
- **THEN** the complete candidate SHALL be omitted
- **AND** newer fitting candidates SHALL retain their complete reference boundaries

#### Scenario: Mandatory source is charged and preserved
- **GIVEN** a current message has a long quoted source and optional history/emojis
- **WHEN** mandatory content exceeds the token limit
- **THEN** the trigger's complete source reference SHALL remain present and its tokens SHALL be reported
- **AND** discretionary history and emojis SHALL be omitted without summarizing or truncating the reference

#### Scenario: Estimates match rendered quote cost
- **GIVEN** a quote has escaped multiline text, remote attribution and file metadata and occurs in both current and retained history
- **WHEN** pre-format and final estimates are calculated
- **THEN** the pre-format estimate SHALL include each reference's complete rendered cost
- **AND** the final estimate SHALL equal the existing token counter's result for actual system and user text

#### Scenario: Spontaneous estimate counts its emitted reference
- **GIVEN** spontaneous history includes a quote with encoded multiline text and attachment metadata
- **WHEN** its context estimate and final template prompt are produced
- **THEN** the estimate SHALL include the complete same reference fragment emitted into the template
- **AND** existing spontaneous retrieval and unrelated-content estimate conventions SHALL remain unchanged
