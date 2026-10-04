## ADDED Requirements

### Requirement: Fetch-Context Limit Bounds

The `fetch-context` skill SHALL validate its `limit` parameter against the Misskey API specification bounds: when provided, `limit` MUST be an integer in the inclusive range `1..100`. An out-of-range or non-integer `limit` SHALL be rejected with an instructive failure message before any platform adapter call, and SHALL NOT be forwarded to the platform. When omitted, the default `limit` SHALL remain `20`.

#### Scenario: Limit above the upper bound rejected

- **GIVEN** a `fetch-context` request with `limit = 101`
- **WHEN** the context handler validates the parameters
- **THEN** the request SHALL fail with an error stating `limit` must be between 1 and 100
- **AND** no platform adapter call SHALL be made

#### Scenario: Fractional limit rejected

- **GIVEN** a `fetch-context` request with `limit = 10.5`
- **WHEN** the context handler validates the parameters
- **THEN** the request SHALL fail with an error stating `limit` must be an integer between 1 and 100

#### Scenario: In-range limit accepted

- **GIVEN** a `fetch-context` request with `limit = 100`
- **WHEN** the context handler validates the parameters
- **THEN** validation SHALL succeed and the adapter SHALL be called with `limit = 100`

#### Scenario: Omitted limit uses default

- **GIVEN** a `fetch-context` request with no `limit` parameter
- **WHEN** the context handler validates the parameters
- **THEN** validation SHALL succeed and the adapter SHALL be called with `limit = 20`
