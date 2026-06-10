# Model Routing

## Purpose

Dynamic per-user and per-context model selection via configurable routing rules, enabling operators to control API costs and response quality by matching sessions to specific models.

## Requirements

### Requirement: First-Match-Wins Rule Evaluation

The system SHALL evaluate routing rules in declaration order and use the first matching rule's model. The system SHALL return the fallback model when no rule matches or when routing is disabled.

#### Scenario: First matching rule wins among multiple matches

- **GIVEN** `modelRouting.enabled` is `true` and two rules are defined: rule 1 matches `channel: discord/account/123` with model `"first-model"`, rule 2 matches `sessionType: message` with model `"second-model"`
- **WHEN** a message session is created for Discord user `123`
- **THEN** the resolved model SHALL be `"first-model"`

#### Scenario: No rule matches falls back to fallback model

- **GIVEN** `modelRouting.enabled` is `true` and rules are defined but none match the current context
- **WHEN** `resolveModel()` is called
- **THEN** the returned model SHALL be the `fallbackModel` parameter

#### Scenario: Routing disabled returns fallback model

- **GIVEN** `modelRouting.enabled` is `false` or `modelRouting` is undefined
- **WHEN** `resolveModel()` is called
- **THEN** the returned model SHALL be the `fallbackModel` parameter regardless of any defined rules

#### Scenario: Empty or missing rules returns fallback model

- **GIVEN** `modelRouting.enabled` is `true` but `rules` is an empty array or undefined
- **WHEN** `resolveModel()` is called
- **THEN** the returned model SHALL be the `fallbackModel` parameter

### Requirement: AND-Logic Rule Conditions

Each routing rule's `match` object MAY contain multiple conditions (`channel`, `sessionType`, `contentKeywords`). All specified conditions SHALL be evaluated with AND logic — every condition must pass for the rule to match. A match object with no conditions SHALL NOT match any context.

#### Scenario: Channel condition matches account

- **GIVEN** a rule with `match.channel` set to `"discord/account/123"`
- **WHEN** the context has `platform: "discord"` and `userId: "123"`
- **THEN** the channel condition SHALL match

#### Scenario: Channel condition matches channel ID

- **GIVEN** a rule with `match.channel` set to `"discord/channel/456"`
- **WHEN** the context has `platform: "discord"` and `channelId: "456"`
- **THEN** the channel condition SHALL match

#### Scenario: Channel condition does not match different platform

- **GIVEN** a rule with `match.channel` set to `"discord/account/123"`
- **WHEN** the context has `platform: "misskey"` and `userId: "123"`
- **THEN** the channel condition SHALL NOT match

#### Scenario: SessionType condition matches

- **GIVEN** a rule with `match.sessionType` set to `"spontaneous"`
- **WHEN** the context has `sessionType: "spontaneous"`
- **THEN** the sessionType condition SHALL match

#### Scenario: AND combination requires all conditions to pass

- **GIVEN** a rule with `match.channel: "discord/account/123"` AND `match.contentKeywords: ["研究"]`
- **WHEN** the context has `platform: "discord"`, `userId: "123"`, `sessionType: "message"`, and `messageContent` contains `"研究"`
- **THEN** the rule SHALL match

#### Scenario: AND combination fails when one condition is not met

- **GIVEN** a rule with `match.channel: "discord/account/123"` AND `match.contentKeywords: ["研究"]`
- **WHEN** the context has `platform: "discord"`, `userId: "123"`, but `messageContent` does NOT contain `"研究"`
- **THEN** the rule SHALL NOT match

#### Scenario: Empty match object does not match

- **GIVEN** a rule with an empty `match` object (no `channel`, `sessionType`, or `contentKeywords`)
- **WHEN** `matchesRule()` is called
- **THEN** the rule SHALL NOT match

### Requirement: Content Keywords Matching

When `match.contentKeywords` is specified with a non-empty array, the system SHALL require that at least one keyword appears in the message content (OR within keywords). Content keyword matching SHALL be case-insensitive. Content keywords SHALL only apply to `"message"` session types; for non-message sessions or when `messageContent` is absent, the condition SHALL NOT match.

#### Scenario: Keyword found in message content

- **GIVEN** a rule with `contentKeywords: ["研究", "research"]`
- **WHEN** the context has `sessionType: "message"` and `messageContent: "我想做研究"`
- **THEN** the contentKeywords condition SHALL match

#### Scenario: Keywords ignored for non-message session types

- **GIVEN** a rule with `contentKeywords: ["研究"]`
- **WHEN** the context has `sessionType: "spontaneous"`
- **THEN** the contentKeywords condition SHALL NOT match

#### Scenario: Case-insensitive keyword matching

- **GIVEN** a rule with `contentKeywords: ["Research"]`
- **WHEN** the context has `sessionType: "message"` and `messageContent: "I want to do research"`
- **THEN** the contentKeywords condition SHALL match

### Requirement: Section-Specific Fallback Chain

The `fallbackModel` parameter passed to `resolveModel()` SHALL follow a fallback chain determined by the caller: section-specific model config (e.g., `selfResearch.model`, `memoryMaintenance.model`) → `agent.model`. The `AGENT_MODEL` environment variable MAY override `agent.model`.

#### Scenario: Self-research routing rule overrides section model

- **GIVEN** a routing rule matches `sessionType: "self-research"` with model `"routed-model"` and `selfResearch.model` is `"sr-fallback-model"`
- **WHEN** `resolveModel()` is called with `fallbackModel: "sr-fallback-model"`
- **THEN** the resolved model SHALL be `"routed-model"`

#### Scenario: Self-research falls back to section model when no rule matches

- **GIVEN** no routing rule matches `sessionType: "self-research"` and `selfResearch.model` is `"sr-fallback-model"`
- **WHEN** `resolveModel()` is called with `fallbackModel: "sr-fallback-model"`
- **THEN** the resolved model SHALL be `"sr-fallback-model"`

### Requirement: Configuration and Environment Overrides

Routing rules SHALL be loaded from `agent.modelRouting.rules` in `config.yaml`. The `MODEL_ROUTING_ENABLED` environment variable MAY override `modelRouting.enabled`. The `MODEL_ROUTING_RULES` environment variable MAY override rules as a JSON string. Invalid `MODEL_ROUTING_RULES` JSON SHOULD be silently skipped, preserving config file rules.

#### Scenario: Environment variable enables routing

- **GIVEN** `MODEL_ROUTING_ENABLED` is set to `"true"`
- **WHEN** configuration is loaded
- **THEN** `modelRouting.enabled` SHALL be `true`

#### Scenario: Environment variable sets rules as JSON

- **GIVEN** `MODEL_ROUTING_RULES` is set to a valid JSON array string
- **WHEN** configuration is loaded
- **THEN** the rules from the JSON string SHALL replace config file rules

#### Scenario: Invalid JSON in environment variable is skipped

- **GIVEN** `MODEL_ROUTING_RULES` is set to an invalid JSON string
- **WHEN** configuration is loaded
- **THEN** the rules from the config file SHALL be preserved

### Requirement: Configuration Validation

Invalid rules (missing `match` field, empty `model` string, invalid channel format) SHALL be filtered out during configuration loading. Invalid rules SHOULD be logged as warnings. Valid rules SHALL be preserved.

#### Scenario: Invalid rules filtered during validation

- **GIVEN** rules include entries with missing `match` field, empty `model`, and one valid rule
- **WHEN** configuration is loaded
- **THEN** only the valid rule SHALL be preserved

### Requirement: Per-Rule Reasoning Effort

Each model routing rule MAY include an optional `reasoningEffort` field (string). When a rule matches and its `reasoningEffort` is set, that value SHALL be the resolved reasoning effort for the session. When a matching rule omits `reasoningEffort`, the rule SHALL NOT force a reasoning-effort value — resolution SHALL fall through to the caller-provided fallback (section value, then global). A rule's model override and its `reasoningEffort` SHALL be independent: a rule MAY set one without the other.

#### Scenario: Rule with reasoning effort provides the value

- **GIVEN** a routing rule with `match.channel: "discord/account/123"`, `model: "routed-model"`, and `reasoningEffort: "high"`
- **WHEN** the rule matches the session context
- **THEN** the resolved reasoning effort SHALL be `"high"`

#### Scenario: Rule without reasoning effort does not force a value

- **GIVEN** a routing rule that matches and sets `model` but omits `reasoningEffort`, with a fallback effort of `"low"`
- **WHEN** reasoning effort is resolved
- **THEN** the resolved reasoning effort SHALL be `"low"` (the fallback), not the rule

#### Scenario: Per-rule reasoning effort is normalized

- **GIVEN** a routing rule with `reasoningEffort: "  Medium  "`
- **WHEN** configuration is loaded
- **THEN** the rule's `reasoningEffort` SHALL be normalized to `"medium"`

#### Scenario: Non-standard per-rule reasoning effort does not drop the rule

- **GIVEN** a routing rule with valid `match` and `model` and a non-standard `reasoningEffort: "ultra"`
- **WHEN** configuration is loaded (from the config file or `MODEL_ROUTING_RULES` JSON)
- **THEN** the rule SHALL remain valid, its `reasoningEffort` SHALL be preserved as `"ultra"` (passthrough), and a warning SHALL be logged — the rule SHALL NOT be filtered out solely because of a non-standard `reasoningEffort`

### Requirement: Reasoning Effort Resolver

The system SHALL provide a `resolveReasoningEffort(routingConfig, context, fallbackEffort)` function that mirrors `resolveModel()`: it SHALL evaluate routing rules in declaration order using the same rule-matching logic and stop at the **first matching rule**. If that first matching rule has `reasoningEffort` set, it SHALL return that value; if the first matching rule omits `reasoningEffort`, it SHALL return `fallbackEffort` and SHALL NOT continue scanning later rules. When routing is disabled or no rule matches, it SHALL return `fallbackEffort`.

#### Scenario: First matching rule with reasoning effort wins

- **GIVEN** `modelRouting.enabled` is `true` and rule 1 matches with `reasoningEffort: "high"`, rule 2 matches with `reasoningEffort: "low"`
- **WHEN** `resolveReasoningEffort()` is called
- **THEN** the resolved reasoning effort SHALL be `"high"`

#### Scenario: Routing disabled returns fallback

- **GIVEN** `modelRouting.enabled` is `false`
- **WHEN** `resolveReasoningEffort()` is called with `fallbackEffort: "medium"`
- **THEN** the resolved reasoning effort SHALL be `"medium"` regardless of any defined rules

#### Scenario: No rule matches returns fallback

- **GIVEN** `modelRouting.enabled` is `true` but no rule matches the context
- **WHEN** `resolveReasoningEffort()` is called with `fallbackEffort: "low"`
- **THEN** the resolved reasoning effort SHALL be `"low"`

#### Scenario: Matched rule omitting reasoning effort returns fallback

- **GIVEN** `modelRouting.enabled` is `true` and the first matching rule omits `reasoningEffort`
- **WHEN** `resolveReasoningEffort()` is called with `fallbackEffort: "high"`
- **THEN** the resolved reasoning effort SHALL be `"high"`

#### Scenario: First matching rule wins even if a later matching rule has effort

- **GIVEN** `modelRouting.enabled` is `true`, rule 1 matches and omits `reasoningEffort`, and rule 2 also matches and sets `reasoningEffort: "high"`
- **WHEN** `resolveReasoningEffort()` is called with `fallbackEffort: "low"`
- **THEN** the resolved reasoning effort SHALL be `"low"` (rule 1's fallback) and the resolver SHALL NOT continue to rule 2

#### Scenario: Model and effort resolved consistently from the same matched rule

- **GIVEN** `modelRouting.enabled` is `true` and a single rule matches with both `model: "routed-model"` and `reasoningEffort: "high"`
- **WHEN** both `resolveModel()` and `resolveReasoningEffort()` are called with the same context
- **THEN** `resolveModel()` SHALL return `"routed-model"` and `resolveReasoningEffort()` SHALL return `"high"`
