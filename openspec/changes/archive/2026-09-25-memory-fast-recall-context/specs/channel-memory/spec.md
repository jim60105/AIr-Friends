## ADDED Requirements

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
