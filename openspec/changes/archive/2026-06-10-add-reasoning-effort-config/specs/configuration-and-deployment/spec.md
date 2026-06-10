## ADDED Requirements

### Requirement: Reasoning Effort Configuration Fields

The configuration system SHALL support reasoning-effort fields at three levels, all sharing one `ReasoningEffort` string type and one normalization helper:
- the **global** `agent.reasoningEffort` (defaults to `"default"` when missing);
- the **per-rule** `reasoningEffort` on each `agent.modelRouting.rules[]` entry (optional, unset when omitted);
- the **per-section** `reasoningEffort` on `selfResearch`, `memoryMaintenance`, and `conversationSummary` (optional, unset when omitted).

The shared normalization SHALL trim and lowercase values, treat present-but-empty as `"default"`, accept the recognized values (`"none"`, `"low"`, `"medium"`, `"high"`, `"default"`), and otherwise preserve the token as passthrough with a warning. Omitted optional per-rule and per-section fields SHALL remain unset (not coerced to `"default"`).

#### Scenario: Global default applied when missing

- **GIVEN** the `agent.reasoningEffort` field is not present in the config file
- **WHEN** configuration validation runs
- **THEN** `agent.reasoningEffort` SHALL default to `"default"`

#### Scenario: Value normalization applies to all levels

- **GIVEN** `agent.reasoningEffort`, a routing rule's `reasoningEffort`, and `selfResearch.reasoningEffort` are each `"  Medium  "`
- **WHEN** configuration is loaded
- **THEN** each SHALL be normalized to `"medium"`

#### Scenario: Omitted per-rule/per-section field stays unset

- **GIVEN** a routing rule and a section omit `reasoningEffort`
- **WHEN** configuration is loaded
- **THEN** those fields SHALL remain unset, and SHALL NOT default to `"default"`

#### Scenario: Environment variable overrides the global value

- **GIVEN** `AGENT_REASONING_EFFORT` is set to `"high"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `agent.reasoningEffort` SHALL be set to `"high"`

#### Scenario: Per-rule reasoning effort survives MODEL_ROUTING_RULES JSON

- **GIVEN** `MODEL_ROUTING_RULES` is set to a JSON array containing a rule with a `reasoningEffort` field
- **WHEN** configuration is loaded and the rules are parsed and validated
- **THEN** the rule SHALL retain its `reasoningEffort` field (normalized), and the rule SHALL NOT be dropped because of it

#### Scenario: Config example and env example updated

- **GIVEN** the project documentation files
- **WHEN** `config.example.yaml` and `.env.example` are examined
- **THEN** `config.example.yaml` SHALL document the global `agent.reasoningEffort`, the per-rule `reasoningEffort`, and the per-section `reasoningEffort` fields, and `.env.example` SHALL include the `AGENT_REASONING_EFFORT` environment variable

#### Scenario: Helm values updated

- **GIVEN** the `helm/values.yaml` file
- **WHEN** the values are examined
- **THEN** it SHALL include an `AGENT_REASONING_EFFORT` entry under the `env:` section
