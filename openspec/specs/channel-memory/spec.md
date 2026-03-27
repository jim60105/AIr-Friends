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

The agent SHALL specify `scope: "user"` or `scope: "channel"` when saving a memory via the `memory-save` skill. When `scope: "channel"`, the agent MUST also provide a `channelId` parameter. When `scope: "user"` or omitted, the memory is saved to the user's personal workspace (existing behavior).

#### Scenario: Save with scope channel
- **WHEN** the agent calls `memory-save` with `scope: "channel"` and `channelId: "ch-456"`
- **THEN** the memory SHALL be written to `data/workspaces/{platform}/channels/ch-456/memory.channel.jsonl`
- **AND** the memory event SHALL have `scope: "channel"`

#### Scenario: Save with scope user (default)
- **WHEN** the agent calls `memory-save` without a `scope` parameter
- **THEN** the memory SHALL be written to the user's personal workspace
- **AND** the memory event SHALL have `scope: "user"`

#### Scenario: Channel scope without channelId rejected
- **WHEN** the agent calls `memory-save` with `scope: "channel"` but no `channelId`
- **THEN** the system SHALL return an error indicating `channelId` is required

### Requirement: Channel Memory Context Loading

The system SHALL include channel memories in context assembly when the conversation occurs in a channel that has channel-scoped memories. Channel memories SHALL be loaded alongside user memories during context assembly.

#### Scenario: Channel memories loaded for matching channel
- **GIVEN** channel `ch-456` has 3 enabled channel memories
- **WHEN** a conversation occurs in channel `ch-456`
- **THEN** all 3 enabled channel memories SHALL be included in the assembled context

#### Scenario: Channel memories not loaded for DM
- **GIVEN** a user has channel memories in channel `ch-456`
- **WHEN** the user sends a DM (no channel context)
- **THEN** no channel memories SHALL be loaded

#### Scenario: Channel memories not loaded for different channel
- **GIVEN** channel `ch-456` has channel memories
- **WHEN** a conversation occurs in channel `ch-789`
- **THEN** channel `ch-456` memories SHALL NOT be loaded

### Requirement: Channel Memory Uses Standard MemoryEntry Format

Channel memories SHALL use the same `MemoryEntry` format as user memories, with `scope` set to `"channel"`. All standard fields (`id`, `ts`, `type`, `enabled`, `content`, `tier`, `category`, `decay`) SHALL be present.

#### Scenario: Channel memory event structure
- **WHEN** a channel memory is saved
- **THEN** the event SHALL contain all standard MemoryEntry fields
- **AND** `scope` SHALL be `"channel"`
- **AND** `visibility` SHALL be `"public"`

### Requirement: Channel Memory Search

The `memory-search` skill SHALL support searching channel memories when `scope: "channel"` and `channelId` are provided. Search SHALL use the same ripgrep-based full-text search as user memories.

#### Scenario: Search channel memories
- **GIVEN** channel `ch-456` has memories containing the word "deployment"
- **WHEN** `memory-search` is called with `scope: "channel"`, `channelId: "ch-456"`, and query "deployment"
- **THEN** matching channel memories SHALL be returned

#### Scenario: Search defaults to user scope
- **WHEN** `memory-search` is called without a `scope` parameter
- **THEN** only user-scoped memories SHALL be searched
