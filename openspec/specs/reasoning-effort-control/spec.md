# Reasoning Effort Control

## Purpose

Per-context reasoning/thought level resolved through the model-selection chain (routing rule → section → global) and applied to ACP agent sessions via the ACP Session Config Options `thought_level` category, with best-effort graceful degradation when unsupported.

## Requirements

### Requirement: Per-Context Reasoning Effort Resolution

The system SHALL resolve the effective reasoning/thought level **per session** through a precedence chain that uses the **same match ordering and fallback structure** as model selection, with one explicit difference: a matching routing rule that omits `reasoningEffort` falls back immediately rather than continuing to later rules. The chain is: (1) the first matching `agent.modelRouting` rule's `reasoningEffort` if set, then (2) the session type's section value (`selfResearch.reasoningEffort`, `memoryMaintenance.reasoningEffort`, `conversationSummary.reasoningEffort`), then (3) the global `agent.reasoningEffort`. Resolution SHALL be performed by a `resolveReasoningEffort()` resolver that reuses the same first-match-wins rule matching as model resolution.

The final resolved value SHALL always be a concrete string (never `undefined`), because the global `agent.reasoningEffort` defaults to `"default"`. The value `"default"` means "do not configure reasoning effort".

Message, spontaneous, channel-lurk, and dashboard / manual sessions have no section-level reasoning-effort field and therefore use the global value as their fallback only.

All reasoning-effort values SHALL be strings sharing one normalized vocabulary: `"none"`, `"low"`, `"medium"`, `"high"`, plus the sentinel `"default"`. An **omitted** routing-rule or section field SHALL NOT contribute to resolution (the chain falls through to the next level); this is distinct from the value `"default"`, which terminates the chain with "do not configure".

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

### Requirement: Shared Reasoning Effort Normalization

The system SHALL normalize every reasoning-effort field (global, per-rule, per-section) and the `AGENT_REASONING_EFFORT` env value with one shared helper: trim whitespace, treat present-but-empty as `"default"`, lowercase, accept the known vocabulary, and otherwise preserve the token as passthrough with a warning. Omitted optional fields SHALL remain unset (not coerced to `"default"`).

#### Scenario: Normalized value accepted

- **GIVEN** a reasoning-effort field is set to `"  High  "`
- **WHEN** configuration is loaded and normalized
- **THEN** the value SHALL be `"high"`

#### Scenario: Unknown value passthrough with warning

- **GIVEN** a reasoning-effort field is set to an agent-specific value not in the normalized set (e.g., `"ultra"`)
- **WHEN** configuration is loaded
- **THEN** the value SHALL be preserved as-is (passthrough)
- **AND** a warning SHALL be logged indicating the value is non-standard

#### Scenario: Omitted field stays unset

- **GIVEN** a routing rule or section omits `reasoningEffort`
- **WHEN** configuration is loaded
- **THEN** that field SHALL remain unset (so the resolution chain can fall through), and SHALL NOT be coerced to `"default"`

### Requirement: Environment Variable Override for Global Reasoning Effort

The system SHALL support overriding the **global** `agent.reasoningEffort` via the `AGENT_REASONING_EFFORT` environment variable through the `ENV_MAPPINGS` mechanism. When set, `AGENT_REASONING_EFFORT` SHALL take precedence over the config file value. Per-rule and per-section values SHALL come from the config file or the `MODEL_ROUTING_RULES` JSON, not from dedicated env vars.

#### Scenario: Environment variable sets global reasoning effort

- **GIVEN** `AGENT_REASONING_EFFORT` is set to `"low"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `agent.reasoningEffort` SHALL be set to `"low"`

### Requirement: Resolved Reasoning Effort Applied After Every Model Setting

The system SHALL resolve the effective reasoning effort (per Per-Context Reasoning Effort Resolution) and attempt to apply it after **every** successful session model setting, for all model-setting paths: message, channel-lurk, spontaneous, self-research, memory-maintenance, the conversation-summary path (including its mid-session model swap and restore), and the dashboard / manual session path. The application step SHALL always receive the concrete resolved value returned by `resolveReasoningEffort()` (never `undefined`). The dashboard / manual session path SHALL use `agent.reasoningEffort` as its fallback (no section value). The reconciliation SHALL occur after the session model has been set so that it targets the resolved model's available options.

#### Scenario: Applied after model setting for a message session

- **GIVEN** the resolved reasoning effort for a message session is `"high"` and the session is created with a resolved model
- **WHEN** the session is configured
- **THEN** the system SHALL set the session model first, then attempt to apply reasoning effort `"high"`

#### Scenario: Routing-rule effort applied

- **GIVEN** the resolved model and `reasoningEffort: "medium"` both come from the same matched `modelRouting` rule
- **WHEN** the session is configured
- **THEN** the system SHALL apply reasoning effort `"medium"`

#### Scenario: Reconciled after each conversation-summary model swap

- **GIVEN** the conversation-summary path sets a summary model, then restores the original model, with a resolved effort of `"high"`
- **WHEN** each model is set
- **THEN** the system SHALL attempt to apply reasoning effort `"high"` after the summary-model set AND again after the original-model restore

#### Scenario: Applied on the dashboard / manual session path

- **GIVEN** the resolved reasoning effort for a dashboard / manual session is `"low"`
- **WHEN** the session is configured
- **THEN** the system SHALL set the model first, then attempt to apply reasoning effort `"low"`

#### Scenario: Skipped when resolved effort is default

- **GIVEN** the resolved reasoning effort is `"default"`
- **WHEN** any session is configured
- **THEN** the system SHALL NOT send any reasoning-effort configuration to the agent

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

#### Scenario: Passthrough token is sent as-is

- **GIVEN** the resolved reasoning effort is an agent-specific passthrough token (outside the normalized vocabulary) and a `thought_level` option is advertised
- **WHEN** the system attempts to apply reasoning effort
- **THEN** it SHALL send the token as-is and SHALL catch and log any agent error without failing the session

### Requirement: Reasoning Effort Discovered from Live Session Config State

The system SHALL discover the `thought_level` configuration option from the agent's live session configuration state rather than a stale creation-time snapshot. The cached configuration options SHALL be refreshed from the `config_option_update` session notification and from the response of any `set_config_option` call. Each reasoning-effort application SHALL re-discover the option from the latest cached state.

#### Scenario: Option becomes available after a model change

- **GIVEN** the agent advertised no `thought_level` option at session creation, then sends a `config_option_update` notification (after a model change) that includes a `thought_level` option
- **WHEN** reasoning effort is applied after the model change
- **THEN** the system SHALL use the updated option set and apply the value against the newly available option

#### Scenario: Available values differ after a model change

- **GIVEN** model A offered `thought_level` values `low|medium` and model B offers `none|high`, and the session switched from A to B with a `config_option_update` reflecting B's values
- **WHEN** reasoning effort is applied after switching to model B
- **THEN** the system SHALL validate the requested value against B's values, not A's

### Requirement: Reasoning Effort Application Outcome Observability

The system SHALL emit an observable outcome for each reasoning-effort application attempt, with a status of `applied`, `unsupported`, `skipped` (default/unset), `skipped_unavailable`, or `failed`. When an audit writer is configured, the resolved reasoning-effort intent SHALL be recorded in the session audit, and the application outcome SHALL be observable via logs.

#### Scenario: Applied outcome

- **GIVEN** a supported `thought_level` option and a value present among its values
- **WHEN** reasoning effort is applied
- **THEN** the outcome SHALL be `applied`

#### Scenario: Unsupported outcome

- **GIVEN** no `thought_level` option is advertised
- **WHEN** reasoning effort is applied
- **THEN** the outcome SHALL be `unsupported`

#### Scenario: Failed outcome does not crash

- **GIVEN** a passthrough token is sent and the agent rejects it
- **WHEN** reasoning effort is applied
- **THEN** the outcome SHALL be `failed`, the error SHALL be logged, and the session SHALL continue
