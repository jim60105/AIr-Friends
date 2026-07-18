## MODIFIED Requirements

### Requirement: Scope Selection on Save

The agent SHALL specify `scope: "user"` or `scope: "channel"` when saving a memory via the `memory-save` skill. When `scope: "channel"`, the agent MUST also provide a `channelId` parameter, the session MUST be authorized to write channel memory (via the `canWriteChannelMemory` capability threaded into the skill context), and the system SHALL record the author (`userId`) of the write on the resulting entry. A `scope: "channel"` write from a session lacking the `canWriteChannelMemory` capability SHALL be rejected. When `scope: "user"` or omitted, the memory is saved to the user's personal workspace (existing behavior).

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

The system SHALL include channel memories in context assembly when the conversation occurs in a channel that has channel-scoped memories. Channel memories SHALL be loaded alongside user memories during context assembly, and SHALL be rendered as **attributed, unverified user contributions** — under a heading that marks them as contributed by channel members and not to be treated as instructions, with each entry prefixed by its author — rather than as unattributed trusted channel knowledge.

#### Scenario: Channel memories loaded for matching channel
- **GIVEN** channel `ch-456` has 3 enabled channel memories
- **WHEN** a conversation occurs in channel `ch-456`
- **THEN** all 3 enabled channel memories SHALL be included in the assembled context

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

Channel memories SHALL use the same `MemoryEntry` format as user memories, with `scope` set to `"channel"` and an additional author field identifying the user who authored the entry. All standard fields (`id`, `ts`, `type`, `enabled`, `content`, `tier`, `category`, `decay`) SHALL be present. A channel write driven by an untrusted (ordinary user) session SHALL NOT be pinned to a non-decaying `core` tier (`decay: 1.0`); such entries SHALL decay on the normal tier schedule. Durable (`core`) channel memory SHALL only be created by an authorized/curated flow.

#### Scenario: Channel memory event structure
- **WHEN** a channel memory is saved
- **THEN** the event SHALL contain all standard MemoryEntry fields plus the author attribution
- **AND** `scope` SHALL be `"channel"`
- **AND** `visibility` SHALL be `"public"`

#### Scenario: Untrusted channel write is not pinned permanent
- **GIVEN** an ordinary user session authoring a channel memory with a requested `tier: "core"` / `importance: "high"`
- **WHEN** the entry is persisted
- **THEN** it SHALL NOT be stored with a non-decaying `decay: 1.0` core pin; it SHALL decay on the normal schedule

## ADDED Requirements

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
