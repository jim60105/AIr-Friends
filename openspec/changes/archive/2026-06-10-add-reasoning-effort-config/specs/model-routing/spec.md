## ADDED Requirements

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
