## ADDED Requirements

### Requirement: Misskey Request Parameter Conformance

All Misskey REST API requests issued by the Misskey adapter SHALL use only request parameter names defined by the Misskey endpoint specification. In particular, the `users/notes` request for the bot's own timeline SHALL use the spec parameter `withReplies` (not the nonexistent `includeReplies`) to exclude replies.

#### Scenario: Self timeline excludes replies via spec parameter

- **GIVEN** a fetch of recent messages for channel `timeline:self`
- **WHEN** the adapter calls `users/notes`
- **THEN** the request parameters SHALL include `withReplies: false`
- **AND** the request parameters SHALL NOT include `includeReplies`

#### Scenario: No other non-spec parameters

- **WHEN** the Misskey adapter builds request parameters for any Misskey REST endpoint
- **THEN** every parameter name sent SHALL be a parameter defined for that endpoint in the Misskey API specification

### Requirement: Misskey Limit Normalization at Adapter Boundary

The Misskey adapter SHALL normalize every `limit` value passed to Misskey REST endpoints that accept a `limit` parameter (`users/notes`, `notes/mentions`, `notes/children`, `notes/replies`, `notes/conversation`, `notes/search`, `chat/messages/user-timeline`) into the inclusive range `1..100` before issuing the request, so that no out-of-range limit reaches the server and no `INVALID_PARAM` error results from limit overflow.

#### Scenario: Oversized limit is clamped to 100

- **GIVEN** `fetchRecentMessages` is called with `limit = 250`
- **WHEN** the adapter issues any paginated Misskey request
- **THEN** the request's `limit` parameter SHALL be `100`
- **AND** the request SHALL NOT fail with `INVALID_PARAM`

#### Scenario: Non-positive limit is clamped to 1

- **GIVEN** `fetchRecentMessages` is called with `limit = 0` or a negative value
- **WHEN** the adapter issues any paginated Misskey request
- **THEN** the request's `limit` parameter SHALL be `1`

#### Scenario: In-range limit passes through unchanged

- **GIVEN** `fetchRecentMessages` is called with `limit = 20`
- **WHEN** the adapter issues any paginated Misskey request
- **THEN** the request's `limit` parameter SHALL be `20`
