Feature: Dynamic Model Routing — Per-User / Per-Context Model Selection
  As an operator
  I want to configure model routing rules based on whitelist entries and session types
  So that I can control API costs and response quality per user or context

  Background:
    Given the bot is running with a default model "gpt-4"

  # --- Routing disabled (backward compatible) ---

  Scenario: No model routing configured
    Given modelRouting is not configured
    When a session is created for any user
    Then the session uses the default model "gpt-4"

  Scenario: Model routing explicitly disabled
    Given modelRouting.enabled is false
    And modelRouting has rules defined
    When a session is created for any user
    Then the routing rules are ignored
    And the session uses the default model "gpt-4"

  # --- Whitelist matching ---

  Scenario: Whitelist account match
    Given modelRouting.enabled is true
    And a rule matches whitelist "discord/account/123" with model "premium-model"
    When a message session is created for discord user "123"
    Then the session uses model "premium-model"

  Scenario: Whitelist channel match
    Given modelRouting.enabled is true
    And a rule matches whitelist "discord/channel/456" with model "channel-model"
    When a message session is created in discord channel "456"
    Then the session uses model "channel-model"

  Scenario: Whitelist does not match different platform
    Given modelRouting.enabled is true
    And a rule matches whitelist "discord/account/123" with model "premium-model"
    When a message session is created for misskey user "123"
    Then the session uses the default model "gpt-4"

  # --- Session type matching ---

  Scenario: Session type match for spontaneous post
    Given modelRouting.enabled is true
    And a rule matches sessionType "spontaneous" with model "cheap-model"
    When a spontaneous post session is created
    Then the session uses model "cheap-model"

  Scenario: Session type match for self-research
    Given modelRouting.enabled is true
    And a rule matches sessionType "self-research" with model "research-model"
    When a self-research session is created
    Then the session uses model "research-model"

  Scenario: Session type match for memory maintenance
    Given modelRouting.enabled is true
    And a rule matches sessionType "memory-maintenance" with model "maintenance-model"
    When a memory maintenance session is created
    Then the session uses model "maintenance-model"

  # --- First-match wins ---

  Scenario: First matching rule wins when multiple rules match
    Given modelRouting.enabled is true
    And the following rules in order:
      | match                              | model        |
      | whitelist: discord/account/123     | first-model  |
      | sessionType: message               | second-model |
    When a message session is created for discord user "123"
    Then the session uses model "first-model"

  # --- Fallback chain for section-specific models ---

  Scenario: Self-research falls back to selfResearch.model when no routing rule matches
    Given modelRouting.enabled is true
    And no routing rule matches sessionType "self-research"
    And selfResearch.model is set to "sr-fallback-model"
    When a self-research session is created
    Then the session uses model "sr-fallback-model"

  Scenario: Self-research routing rule overrides selfResearch.model
    Given modelRouting.enabled is true
    And a rule matches sessionType "self-research" with model "routed-model"
    And selfResearch.model is set to "sr-fallback-model"
    When a self-research session is created
    Then the session uses model "routed-model"

  Scenario: Memory maintenance falls back to memoryMaintenance.model when no routing rule matches
    Given modelRouting.enabled is true
    And no routing rule matches sessionType "memory-maintenance"
    And memoryMaintenance.model is set to "mm-fallback-model"
    When a memory maintenance session is created
    Then the session uses model "mm-fallback-model"

  # --- Configuration validation ---

  Scenario: Invalid rules are skipped during validation
    Given modelRouting.enabled is true
    And a rule with missing match field
    And a rule with empty model string
    And a valid rule matching sessionType "message" with model "valid-model"
    When the configuration is loaded
    Then only the valid rule is preserved
    And invalid rules are logged as warnings

  Scenario: Rules with invalid whitelist format are skipped
    Given modelRouting.enabled is true
    And a rule with whitelist "invalid-format" and model "some-model"
    When the configuration is loaded
    Then the rule is skipped

  Scenario: Rules with multiple match fields are skipped
    Given modelRouting.enabled is true
    And a rule with both whitelist and sessionType set
    When the configuration is loaded
    Then the rule is skipped due to mutual exclusivity violation

  # --- Environment variable overrides ---

  Scenario: MODEL_ROUTING_ENABLED env var enables routing
    Given MODEL_ROUTING_ENABLED is set to "true"
    When the configuration is loaded
    Then modelRouting.enabled is true

  Scenario: MODEL_ROUTING_RULES env var sets rules as JSON
    Given MODEL_ROUTING_RULES is set to a valid JSON string
    When the configuration is loaded
    Then the rules from the JSON string are applied

  Scenario: Invalid MODEL_ROUTING_RULES JSON is silently skipped
    Given MODEL_ROUTING_RULES is set to an invalid JSON string
    When the configuration is loaded
    Then the rules from the config file are preserved
