## MODIFIED Requirements

### Requirement: Channel Memory Context Loading

The system SHALL include channel memories in context assembly when the conversation occurs in a channel that has channel-scoped memories. Channel core and working memories SHALL be loaded alongside user memories within the shared fixed-memory budgets. They SHALL be rendered as **attributed, unverified user contributions**: under a heading that marks them as contributed by channel members and not to be treated as instructions, with each entry prefixed by its author. They SHALL NOT be rendered as unattributed trusted channel knowledge.

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
