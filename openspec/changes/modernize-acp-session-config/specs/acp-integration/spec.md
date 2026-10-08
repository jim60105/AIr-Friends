## ADDED Requirements

### Requirement: Stable-First Canonical Model Selection

When the session's latest cached configuration options advertise an option with `category: "model"`, setting the session model SHALL select that stable option and send the agent's canonical advertised value through the stable config-option mechanism. When no such option is advertised, the existing unstable model-setting mechanism SHALL be used unchanged.

#### Scenario: Flat advertised catalog selects the canonical value
- **GIVEN** the session's cached config options include a `category: "model"` option advertising values `["gpt-4o", "claude-sonnet-x"]`
- **WHEN** the session model is set to `"GPT-4O"`
- **THEN** the system SHALL set the model via the stable config-option mechanism with the advertised value `"gpt-4o"`
- **AND** it SHALL NOT call the unstable model-setting method
- **AND** the cached config options SHALL be refreshed from the response

#### Scenario: Grouped model catalog is flattened for matching
- **GIVEN** the `category: "model"` option advertises grouped entries whose nested options include `{ value: "provider/model-A" }`
- **WHEN** the session model is set to `"provider/MODEL-a"`
- **THEN** the match SHALL be found through the flattened group values and the canonical advertised value `"provider/model-A"` SHALL be sent

#### Scenario: Advertised catalog without the requested model is an explicit error
- **GIVEN** the session's cached config options advertise a `category: "model"` option whose flattened values do not contain the requested model ID under any casing
- **WHEN** the session model is set
- **THEN** the call SHALL fail with a descriptive error identifying the requested model and that it is absent from the advertised catalog
- **AND** the system SHALL NOT fall back to the unstable model-setting method
- **AND** the failure SHALL remain isolated to the affected session's error handling

#### Scenario: Stable option absence permits the unstable fallback
- **GIVEN** the session's cached config options contain no option with `category: "model"`
- **WHEN** the session model is set
- **THEN** the system SHALL configure the model via the existing unstable model-setting mechanism exactly as before this change
- **AND** the recorded current model ID SHALL be the requested value

#### Scenario: Selection uses latest cached options, not a creation-time snapshot
- **GIVEN** the config options were refreshed after session creation by a `config_option_update` notification or a config-option response
- **WHEN** the session model is set
- **THEN** model-option discovery and value matching SHALL use the latest cached options

#### Scenario: Canonical value is recorded as the current model
- **GIVEN** the session model was set through the stable config-option mechanism
- **WHEN** the session records the model selection
- **THEN** the recorded current model ID SHALL be the canonical advertised value actually sent

#### Scenario: No model IDs are invented outside the advertised catalog
- **GIVEN** the agent's catalog does not contain the requested model ID under any casing
- **WHEN** the session model is set
- **THEN** the system SHALL NOT rewrite or invent a model ID that the agent's catalog does not contain

### Requirement: Reasoning Value Canonicalization With None/Off Alias

Applying a reasoning effort value SHALL prefer the canonical case-insensitive exact match among the advertised `thought_level` values; when the requested value is `none` and no exact `none` exists, the advertised `off` value SHALL be sent when one is offered, otherwise the existing not-offered skip behavior SHALL apply unchanged. The alias SHALL NOT apply to any other requested value.

#### Scenario: None maps to advertised off
- **GIVEN** the advertised `thought_level` values are `["low", "Off"]` (no exact `none`)
- **WHEN** reasoning effort `"none"` is applied
- **THEN** the system SHALL send the canonical advertised value `"Off"` and report outcome `applied`

#### Scenario: Exact none wins when advertised
- **GIVEN** the advertised `thought_level` values include both `none` and `off` in any casing
- **WHEN** reasoning effort `"none"` is applied
- **THEN** the system SHALL send the exact canonical `none` match and SHALL NOT substitute `off`

#### Scenario: Neither none nor off advertised keeps the skip behavior
- **GIVEN** the advertised `thought_level` values are a non-empty list containing neither an exact `none` nor an `off`
- **WHEN** reasoning effort `"none"` is applied
- **THEN** the system SHALL report `skipped_unavailable` with the existing structured warning and SHALL NOT send any value

#### Scenario: Other tokens are never aliased
- **GIVEN** the advertised `thought_level` values include `off` but not `low`
- **WHEN** reasoning effort `"low"` is applied
- **THEN** the system SHALL NOT send `off` and SHALL follow the existing not-offered/passthrough rules unchanged

#### Scenario: Default or empty value is a no-op
- **GIVEN** the reasoning effort value is `default` or empty
- **WHEN** reasoning effort is applied
- **THEN** the value SHALL be a no-op evaluated before any catalog inspection

### Requirement: Load-Response Config Options Cache Restoration

The system SHALL consume the `session/load` response and refresh the session's cached configuration options from its `configOptions` field with the same complete-list replacement semantics as other refresh sources (a nullish list clears the cache). After a successful reconnect-and-resume, the previously set model SHALL be re-established through the same stable-first selection above.

#### Scenario: Load response restores the canonical cache
- **GIVEN** a reconnected agent's `session/load` response includes `configOptions` with a `category: "model"` option
- **WHEN** the session is resumed via session/load
- **THEN** the session's cached config options SHALL equal the load response's options
- **AND** subsequent config-option discovery SHALL use them

#### Scenario: Resumed session re-establishes its model stably
- **GIVEN** the session's previously set model is present in the load-restored `model` catalog
- **WHEN** reconnect-and-resume completes
- **THEN** the system SHALL re-send the canonical advertised model value via the stable config-option mechanism
- **AND** the cache SHALL be refreshed from that response

#### Scenario: Load without config options keeps the unstable path available
- **GIVEN** the `session/load` response carries no `configOptions`
- **WHEN** reconnect-and-resume re-establishes the previously set model
- **THEN** the selection SHALL follow the unstable fallback path, as a session with no advertised stable option

#### Scenario: Model gone from the post-load catalog fails the session in isolation
- **GIVEN** the previously set model is absent from the load-restored `model` catalog
- **WHEN** reconnect-and-resume re-applies the model
- **THEN** the resumption SHALL fail with the explicit catalog-miss error for that session only
- **AND** it SHALL NOT send the model through the unstable method as a second chance

#### Scenario: Reasoning reapplied best-effort after model on resume
- **GIVEN** the caller supplies an active resolved reasoning effort for the resumed session
- **WHEN** reconnect-and-resume completes the model re-establishment
- **THEN** the system SHALL attempt reasoning application through the existing best-effort path and SHALL log its outcome without failing the session

#### Scenario: Model-then-reasoning ordering is preserved on resume
- **GIVEN** reconnect-and-resume re-establishes the previously set model and the caller supplies an active resolved reasoning effort
- **WHEN** the resumed session proceeds to reasoning application
- **THEN** reasoning effort SHALL be applied after the model, because advertised reasoning values depend on the model

#### Scenario: Restoration failure stays isolated to the affected session
- **GIVEN** any step of the model or reasoning restoration fails during reconnect-and-resume
- **WHEN** the failure occurs
- **THEN** the restoration failure SHALL remain isolated to the affected session

### Requirement: Session Config Resolution Shared Surface

The catalog flattening, canonical value resolution, model selection verdict (stable / unstable-fallback / catalog-miss) and reasoning value resolution (including the `none`→`off` alias rule) SHALL exist as one pure module free of connection or IO state, consumed by the connector and available to later session-recovery and pool consumers, so no caller reimplements the matching rules.

#### Scenario: Recovery consumers reuse the same verdicts
- **GIVEN** a later session-recovery or pool path needs the model-selection verdict for a cached option list
- **WHEN** it evaluates the list through the shared resolution surface
- **THEN** it SHALL receive the same `stable` / `unstable-fallback` / `catalog-miss` verdict the connector would
- **AND** no private duplicate of the flattening or matching rules SHALL be introduced

#### Scenario: Resolution is connection-independent
- **WHEN** the resolution functions are called with an option list and a requested value
- **THEN** they SHALL return purely from the inputs without contacting any agent
