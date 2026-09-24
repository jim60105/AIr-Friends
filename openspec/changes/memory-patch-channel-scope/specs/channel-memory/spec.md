## ADDED Requirements

### Requirement: Channel Memory Patching

The `memory-patch` skill SHALL support patching channel-scoped memories when called with `scope: "channel"`. A value of `scope` other than `"user"` or `"channel"` SHALL be rejected with the same error used by `memory-save`/`memory-search` (`Invalid 'scope' parameter. Must be 'user' or 'channel'`). A channel-scope patch SHALL require the session to hold the `canWriteChannelMemory` capability (the same authorization required for a channel-scope save) and SHALL append a patch event to the channel memory file, preserving append-only semantics. Patchable fields for channel scope are `enabled`, `importance`, `tier`, `category`, `decay`, `relatedTo`, and `supersedes`; `visibility` SHALL be rejected for channel scope because channel memories have no visibility field. When `scope` is omitted the skill SHALL continue to patch only the user's personal memory store (existing behavior). A user-scope patch whose target ID is not found SHALL return an error naming the `--scope channel` retry.

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
