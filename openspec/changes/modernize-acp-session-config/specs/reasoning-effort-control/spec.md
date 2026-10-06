## MODIFIED Requirements

### Requirement: Best-Effort Reasoning Effort Application

Applying reasoning effort SHALL be best-effort and SHALL NOT cause a session to fail. When the connected agent/model does not advertise a `thought_level` configuration option, or when applying the value fails, the system SHALL log the outcome and continue the session. Among the advertised values, the system SHALL prefer the canonical case-insensitive exact match of the requested value; a requested `"none"` with no exact `none` match SHALL be sent as the advertised `off` value (in advertised casing) when one exists, and SHALL follow the existing not-offered skip behavior when neither exists; no other requested token SHALL ever be aliased, and an exact match SHALL win even when `off` is also advertised.

#### Scenario: Agent does not advertise thought_level

- **GIVEN** the agent's session does not include a configuration option with `category: "thought_level"`
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL log that reasoning effort is unsupported and continue without error

#### Scenario: Apply failure does not crash the session

- **GIVEN** the agent advertises a `thought_level` option but rejects the requested value
- **WHEN** the system attempts to apply reasoning effort
- **THEN** the error SHALL be caught and logged, and the session SHALL continue

#### Scenario: Known value not offered by the model is skipped

- **GIVEN** the resolved reasoning effort is a normalized value other than `"none"` (e.g., `"high"`) that is not present among the advertised `thought_level` option's available values under any casing
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL log a structured warning (including the requested value, the option's available values, the model, and the agent type) and SHALL NOT send an invalid value

#### Scenario: None with no exact none uses the advertised off alias

- **GIVEN** the resolved reasoning effort is `"none"` and the advertised `thought_level` available values contain no exact `none` (any casing) but do contain `off` (any casing)
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL send the advertised `off` value in the agent's casing and report outcome `applied`

#### Scenario: None skips when neither none nor off is advertised

- **GIVEN** the resolved reasoning effort is `"none"` and the advertised `thought_level` available values contain neither an exact `none` nor an `off`
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL log the structured not-offered warning and report outcome `skipped_unavailable`, SHALL NOT send any value

#### Scenario: Exact match wins over the off alias

- **GIVEN** the resolved reasoning effort is `"none"` and the advertised values include both an exact `none` and an `off`
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL send the exact canonical `none` match

#### Scenario: Extended level offered by the model is applied

- **GIVEN** the resolved reasoning effort is `"xhigh"` or `"max"` and the model advertises a `thought_level` option whose available values include it (with any casing)
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL send the value using the agent's canonical casing and report outcome `applied`

#### Scenario: Extended level not offered by the model is skipped

- **GIVEN** the resolved reasoning effort is `"xhigh"` or `"max"` and the model's advertised `thought_level` option enumerates a non-empty available-value list that does not include it
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL log a structured warning (including the requested value, the option's available values, the model, and the agent type) and report outcome `skipped_unavailable`, SHALL NOT send the value

#### Scenario: Passthrough token is sent as-is

- **GIVEN** the resolved reasoning effort is an agent-specific passthrough token (outside the normalized vocabulary) and a `thought_level` option is advertised
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL send the token as-is and SHALL catch and log any agent error without failing the session

#### Scenario: Default remains a no-op before catalog inspection

- **GIVEN** the resolved reasoning effort is `"default"` or empty
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL report `skipped` without inspecting advertised values or contacting the agent
