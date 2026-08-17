## MODIFIED Requirements

### Requirement: Per-Context Reasoning Effort Resolution

The system SHALL resolve the effective reasoning/thought level **per session** through a precedence chain that uses the **same match ordering and fallback structure** as model selection, with one explicit difference: a matching routing rule that omits `reasoningEffort` falls back immediately rather than continuing to later rules. The chain is: (1) the first matching `agent.modelRouting` rule's `reasoningEffort` if set, then (2) the session type's section value (`selfResearch.reasoningEffort`, `memoryMaintenance.reasoningEffort`, `conversationSummary.reasoningEffort`), then (3) the global `agent.reasoningEffort`. Resolution SHALL be performed by a `resolveReasoningEffort()` resolver that reuses the same first-match-wins rule matching as model resolution.

The final resolved value SHALL always be a concrete string (never `undefined`), because the global `agent.reasoningEffort` defaults to `"default"`. The value `"default"` means "do not configure reasoning effort".

Message, spontaneous, channel-lurk, and dashboard / manual sessions have no section-level reasoning-effort field and therefore use the global value as their fallback only.

All reasoning-effort values SHALL be strings sharing one normalized vocabulary: `"none"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`, plus the sentinel `"default"`. An **omitted** routing-rule or section field SHALL NOT contribute to resolution (the chain falls through to the next level); this is distinct from the value `"default"`, which terminates the chain with "do not configure".

#### Scenario: Routing rule reasoning effort wins

- **GIVEN** a matching `modelRouting` rule has `reasoningEffort: "high"`, the section value is `"low"`, and `agent.reasoningEffort` is `"medium"`
- **WHEN** reasoning effort is resolved for the session
- **THEN** the effective value SHALL be `"high"`

#### Scenario: Matched rule without reasoning effort falls through to section

- **GIVEN** a matching `modelRouting` rule sets a model override but omits `reasoningEffort`, and `selfResearch.reasoningEffort` is `"low"` for a self-research session
- **WHEN** reasoning effort is resolved
- **THEN** the effective value SHALL be `"low"` (the section value)

#### Scenario: Section value falls through to global

- **GIVEN** no routing rule matches (or routing is disabled) and the section has no `reasoningEffort`, while `agent.reasoningEffort` is `"high"`
- **WHEN** reasoning effort is resolved
- **THEN** the effective value SHALL be `"high"`

#### Scenario: Nothing configured resolves to default

- **GIVEN** no routing-rule, section, or global reasoning effort is set
- **WHEN** reasoning effort is resolved
- **THEN** the effective value SHALL be `"default"` (treated as "do not configure reasoning effort")

#### Scenario: Different contexts resolve to different efforts

- **GIVEN** a rule matching `channel: "discord/account/123"` has `reasoningEffort: "high"` and `memoryMaintenance.reasoningEffort` is `"low"`
- **WHEN** a message session for that account is resolved AND a memory-maintenance session is resolved
- **THEN** the message session SHALL resolve to `"high"` and the memory-maintenance session SHALL resolve to `"low"`

#### Scenario: Extended rule value overrides section value

- **GIVEN** a matching `modelRouting` rule has `reasoningEffort: "max"` and the section value is `"xhigh"` for a self-research session
- **WHEN** reasoning effort is resolved for the session
- **THEN** the effective value SHALL be `"max"` (the rule value)

#### Scenario: Extended section value resolves when no rule contributes

- **GIVEN** no routing rule sets `reasoningEffort` (or no rule matches) and `selfResearch.reasoningEffort` is `"xhigh"` for a self-research session
- **WHEN** reasoning effort is resolved
- **THEN** the effective value SHALL be `"xhigh"`

#### Scenario: Extended global value resolves when nothing else contributes

- **GIVEN** no rule or section contributes a `reasoningEffort` and `agent.reasoningEffort` is `"max"`
- **WHEN** reasoning effort is resolved
- **THEN** the effective value SHALL be `"max"`

### Requirement: Best-Effort Reasoning Effort Application

Applying reasoning effort SHALL be best-effort and SHALL NOT cause a session to fail. When the connected agent/model does not advertise a `thought_level` configuration option, or when applying the value fails, the system SHALL log the outcome and continue the session.

#### Scenario: Agent does not advertise thought_level

- **GIVEN** the agent's session does not include a configuration option with `category: "thought_level"`
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL log that reasoning effort is unsupported and continue without error

#### Scenario: Apply failure does not crash the session

- **GIVEN** the agent advertises a `thought_level` option but rejects the requested value
- **WHEN** the system attempts to apply reasoning effort
- **THEN** the error SHALL be caught and logged, and the session SHALL continue

#### Scenario: Known value not offered by the model is skipped

- **GIVEN** the resolved reasoning effort is a normalized value (e.g., `"none"`) that is not present among the advertised `thought_level` option's available values
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL log a structured warning (including the requested value, the option's available values, the model, and the agent type) and SHALL NOT send an invalid value

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
