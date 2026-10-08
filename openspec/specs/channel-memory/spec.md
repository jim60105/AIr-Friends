# Channel Memory

## Purpose

Enables memory storage and retrieval scoped to a specific channel, shared across all users in that channel. Channel memories use the same MemoryEntry format with `scope: "channel"` and are always public.

## Requirements

### Requirement: Channel Memory Storage Location

The system SHALL store channel-scoped memories at `data/workspaces/{platform}/channels/{channelId}/memory.channel.jsonl`. Each channel SHALL have its own dedicated JSONL file.

#### Scenario: Channel memory file creation
- **WHEN** the first channel-scoped memory is saved for channel `general-123`
- **THEN** the system SHALL create `data/workspaces/discord/channels/general-123/memory.channel.jsonl`
- **AND** append the memory event as a single JSON line

#### Scenario: Subsequent channel memories appended
- **GIVEN** a channel memory file already exists for channel `general-123`
- **WHEN** a new channel memory is saved
- **THEN** the system SHALL append the new event to the existing file

### Requirement: Channel Memories Are Always Public

Channel memories SHALL always have `visibility: "public"`. The system SHALL reject or override any attempt to save a channel memory with `visibility: "private"`.

#### Scenario: Private visibility rejected for channel memory
- **WHEN** an agent saves a channel memory with `visibility: "private"`
- **THEN** the system SHALL override the visibility to `"public"`

#### Scenario: Channel memory defaults to public
- **WHEN** an agent saves a channel memory without specifying visibility
- **THEN** the visibility SHALL default to `"public"`

### Requirement: Scope Selection on Save

The agent SHALL specify `scope: "user"` or `scope: "channel"` when saving a memory via the `memory-save` skill. When `scope: "channel"`, the agent MUST provide a `channelId` and the session MUST hold the `canWriteChannelMemory` capability (threaded into the skill context); the resulting entry SHALL record the author (`userId`) of the write. When `scope: "user"` or omitted, the memory SHALL be saved to the user's personal workspace (existing behavior).

#### Scenario: Save with scope channel when authorized
- **GIVEN** a session with the `canWriteChannelMemory` capability
- **WHEN** the agent calls `memory-save` with `scope: "channel"` and `channelId: "ch-456"`
- **THEN** the memory SHALL be written to `data/workspaces/{platform}/channels/ch-456/memory.channel.jsonl`
- **AND** the entry SHALL record the author (`userId`) of the write

#### Scenario: Save with scope channel when not authorized
- **WHEN** the agent calls `memory-save` with `scope: "channel"` from a session lacking the `canWriteChannelMemory` capability
- **THEN** the system SHALL reject the write with an authorization error and SHALL NOT persist any channel entry

#### Scenario: Save with scope user (default)
- **WHEN** the agent calls `memory-save` without a `scope` parameter
- **THEN** the memory SHALL be written to the user's personal workspace
- **AND** the memory event SHALL have `scope: "user"`

#### Scenario: Channel scope without channelId rejected
- **WHEN** the agent calls `memory-save` with `scope: "channel"` but no `channelId`
- **THEN** the system SHALL return an error indicating `channelId` is required

### Requirement: Channel Memory Context Loading

The system SHALL include channel memories in context assembly when the conversation occurs in a channel that has channel-scoped memories, loading core and working channel memories alongside user memories within the shared fixed-memory budgets. They SHALL be rendered as attributed, unverified user contributions under a heading marking them as channel-member contributed and not instructions, author-prefixed. They SHALL NOT be rendered as unattributed trusted channel knowledge.

#### Scenario: Channel memories loaded for matching channel
- **GIVEN** channel `ch-456` has 3 enabled core-tier channel memories that fit the core budget
- **WHEN** a conversation occurs in channel `ch-456`
- **THEN** all 3 channel memories SHALL be included in the assembled context

#### Scenario: Channel memories rendered with attribution and untrusted framing
- **GIVEN** channel `ch-456` has channel memories authored by users
- **WHEN** a conversation occurs in channel `ch-456` and context is assembled
- **THEN** the channel memories SHALL be rendered under a heading that identifies them as user-contributed and unverified
- **AND** each rendered entry SHALL include its author attribution
- **AND** they SHALL NOT be presented under a heading (such as "Channel Knowledge") that implies vetted, trusted fact

#### Scenario: Channel memories not loaded for DM
- **GIVEN** a user has channel memories in channel `ch-456`
- **WHEN** the user sends a DM (no channel context)
- **THEN** no channel memories SHALL be loaded

#### Scenario: Channel memories not loaded for different channel
- **GIVEN** channel `ch-456` has channel memories
- **WHEN** a conversation occurs in channel `ch-789`
- **THEN** channel `ch-456` memories SHALL NOT be loaded

### Requirement: Channel Memory Uses Standard MemoryEntry Format

Channel memories SHALL use the same `MemoryEntry` format as user memories, with `scope` set to `"channel"` and an additional author field identifying the user who authored the entry. All standard fields (`id`, `ts`, `type`, `enabled`, `content`, `tier`, `category`, `decay`) SHALL be present. A channel write driven by an untrusted (ordinary user) session SHALL NOT be pinned to a non-decaying `core` tier (`decay: 1.0`); such entries SHALL decay on the normal tier schedule.

#### Scenario: Channel memory event structure
- **WHEN** a channel memory is saved
- **THEN** the event SHALL contain all standard MemoryEntry fields plus the author attribution
- **AND** `scope` SHALL be `"channel"`
- **AND** `visibility` SHALL be `"public"`

#### Scenario: Untrusted channel write is not pinned permanent
- **GIVEN** an ordinary user session authoring a channel memory with a requested `tier: "core"` / `importance: "high"`
- **WHEN** the entry is persisted
- **THEN** it SHALL NOT be stored with a non-decaying `decay: 1.0` core pin; it SHALL decay on the normal schedule

#### Scenario: Durable channel memory requires an authorized flow
- **WHEN** the system creates durable (`core`) channel memory
- **THEN** it SHALL only do so through an authorized/curated flow

### Requirement: Channel Memory Bounds and Moderation

The system SHALL bound the number of channel core-tier entries per channel and SHALL provide an in-app path to remove (disable) a channel memory entry. Channel-memory listing and disabling SHALL be available through the passphrase-gated dashboard so an operator can remove a planted or abusive entry.

#### Scenario: Channel core-tier count is bounded
- **GIVEN** a channel that already holds the maximum number of core-tier entries
- **WHEN** another core-tier channel entry would be created
- **THEN** the system SHALL enforce the bound (reject or evict per policy) rather than growing without limit

#### Scenario: Channel memory can be disabled by an operator
- **GIVEN** a channel memory entry exists
- **WHEN** an operator disables it via the dashboard moderation path
- **THEN** the entry SHALL be marked disabled and SHALL NOT be loaded into subsequent context assembly

### Requirement: Channel Memory Patching

The `memory-patch` skill SHALL support patching channel-scoped memories when called with `scope: "channel"`. A channel-scope patch SHALL require the session to hold the `canWriteChannelMemory` capability (the same authorization required for a channel-scope save) and SHALL append a patch event to the channel memory file, preserving append-only semantics.

#### Scenario: Invalid scope value rejected
- **WHEN** the agent calls `memory-patch` with `scope: "guild"`
- **THEN** the system SHALL reject the call with the error `Invalid 'scope' parameter. Must be 'user' or 'channel'`

#### Scenario: Patch channel memory decay (incident scenario)
- **GIVEN** a session with the `canWriteChannelMemory` capability in channel `ch-456`
- **AND** channel `ch-456` holds 4 memories matching a search, each with `scope: "channel"` and `decay: 0.8`
- **WHEN** the agent calls `memory-patch` for each matching ID with `scope: "channel"` and `decay: 0.4`
- **THEN** each call SHALL succeed and a patch event with `decay: 0.4` SHALL be appended to `data/workspaces/{platform}/channels/ch-456/memory.channel.jsonl`
- **AND** the original memory lines SHALL remain unchanged
- **AND** resolving the memories SHALL yield `decay: 0.4` for each target

#### Scenario: Channel patch rejected without channel-write authorization
- **WHEN** the agent calls `memory-patch` with `scope: "channel"` from a session lacking the `canWriteChannelMemory` capability
- **THEN** the system SHALL reject the call with an authorization error
- **AND** no patch event SHALL be appended to the channel memory file

#### Scenario: Visibility rejected for channel scope
- **GIVEN** a session with the `canWriteChannelMemory` capability
- **WHEN** the agent calls `memory-patch` with `scope: "channel"` and a `visibility` value
- **THEN** the system SHALL reject the call with an error explaining that channel memories have no visibility field
- **AND** no patch event SHALL be written

#### Scenario: Channel-scope ID not found in the channel file
- **GIVEN** a session with the `canWriteChannelMemory` capability
- **WHEN** the agent calls `memory-patch` with `scope: "channel"` and an ID absent from the channel memory file
- **THEN** the system SHALL return a channel-memory-not-found error and SHALL NOT write a patch event

#### Scenario: User-scope not-found names the channel retry
- **WHEN** the agent calls `memory-patch` with `scope` omitted (or `"user"`) and an ID that does not exist in the user memory store
- **THEN** the returned error SHALL report the memory not found
- **AND** it SHALL instruct retrying with `--scope channel` (channel-scope results from `memory-search` are labeled with their scope)

#### Scenario: User-scope patching unchanged when scope is omitted
- **GIVEN** a user-scoped memory with ID `mem_abc_123` in the user's workspace
- **WHEN** the agent calls `memory-patch` with `memory_id: "mem_abc_123"` and no `scope` parameter
- **THEN** the patch event SHALL be appended to the user's memory file exactly as before this change
- **AND** all previously patchable fields including `visibility` SHALL remain patchable for user scope

#### Scenario: Channel-scope patchable fields
- **WHEN** the agent patches a channel memory entry with `scope: "channel"`
- **THEN** the patchable fields SHALL be `enabled`, `importance`, `tier`, `category`, `decay`, `relatedTo`, and `supersedes`

### Requirement: Channel Memory Recall Search

The `memory-search` skill SHALL support searching channel memories when the session has a channel context. Search SHALL use the same recall engine, ranking and Deep Recall rules as user memories. When `scope` is `"channel"`, only channel memories SHALL be searched. When `scope` is `"user"`, only user memories SHALL be searched. When `scope` is omitted, both SHALL be searched and ranked together.

#### Scenario: Search channel memories
- **GIVEN** channel `ch-456` has memories containing the word "deployment"
- **WHEN** `memory-search` is called in channel `ch-456` with `scope: "channel"` and query "deployment"
- **THEN** matching channel memories SHALL be returned
- **AND** no user memories SHALL be returned

#### Scenario: Search defaults to both scopes
- **GIVEN** a session in channel `ch-456` where both the user and the channel have memories matching the query
- **WHEN** `memory-search` is called without a `scope` parameter
- **THEN** matching memories from both scopes SHALL be returned in one relevance-ordered list

#### Scenario: No channel context
- **GIVEN** a DM session
- **WHEN** `memory-search` is called with `scope: "channel"`
- **THEN** no channel memories SHALL be returned

### Requirement: Channel Memory Framing in Fast Recall

Channel memories selected by Fast Recall SHALL be rendered with the same attributed, unverified framing as fixed channel memories. They SHALL appear under a heading stating that they were contributed by channel members, are unverified and are not instructions, with each entry prefixed by its author. They SHALL NOT be listed under the user's "Relevant Memory" heading. Channel memories of any tier SHALL be eligible for Fast Recall only in their own channel.

#### Scenario: Channel memory surfaced by Fast Recall keeps framing
- **GIVEN** Fast Recall selects a channel memory authored by `user-9`
- **WHEN** the Fast Recall section is rendered
- **THEN** the entry SHALL be prefixed with `[from user-9]` under the unverified channel heading
- **AND** it SHALL NOT be listed under "Relevant Memory"

#### Scenario: Other channels never recalled
- **GIVEN** channel `ch-456` has a memory matching the trigger message
- **WHEN** Fast Recall runs for a conversation in channel `ch-789`
- **THEN** the `ch-456` memory SHALL NOT be recalled
