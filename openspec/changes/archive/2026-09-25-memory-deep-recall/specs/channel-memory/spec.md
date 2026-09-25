## REMOVED Requirements

### Requirement: Channel Memory Search
**Reason**: Channel search no longer uses ripgrep, and its default scope was stale: the implementation already searches both scopes when `scope` is omitted.
**Migration**: Replaced by "Channel Memory Recall Search".

## ADDED Requirements

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
