Feature: Access Control and Reply Policy
  As a bot operator
  I want to control which users and channels the bot responds to
  So that I can manage the bot's interaction scope

  Background:
    Given the bot is connected to one or more platforms
    And the access control configuration is loaded from config.yaml or environment variables

  # ── Configuration defaults ──

  Scenario: Default configuration uses whitelist mode with empty whitelist
    Given no accessControl section is configured in config.yaml
    And no REPLY_TO or WHITELIST environment variables are set
    Then the default replyTo mode should be "whitelist"
    And the default whitelist should be empty
    And the bot should not reply to anyone

  # ── Configuration loading ──

  Scenario: Load access control from config.yaml
    Given config.yaml contains:
      """yaml
      accessControl:
        replyTo: "public"
        whitelist:
          - "discord/account/123456789"
          - "misskey/account/abcdef123"
      """
    Then the reply policy should be "public"
    And the whitelist should contain 2 entries

  Scenario: REPLY_TO environment variable overrides config.yaml
    Given config.yaml sets accessControl.replyTo to "whitelist"
    And environment variable REPLY_TO is set to "all"
    Then the effective reply policy should be "all"

  Scenario: WHITELIST environment variable overrides config.yaml
    Given config.yaml sets accessControl.whitelist to ["discord/account/111"]
    And environment variable WHITELIST is set to "discord/account/222,misskey/account/333"
    Then the effective whitelist should be ["discord/account/222", "misskey/account/333"]
    And the original config.yaml whitelist entry "discord/account/111" should not be present

  Scenario: WHITELIST environment variable trims whitespace from entries
    Given environment variable WHITELIST is set to " discord/account/123 , misskey/account/abc "
    Then the effective whitelist should be ["discord/account/123", "misskey/account/abc"]

  Scenario: Empty WHITELIST environment variable does not override config
    Given config.yaml sets accessControl.whitelist to ["discord/account/111"]
    And environment variable WHITELIST is set to ""
    Then the effective whitelist should still be ["discord/account/111"]

  # ── Whitelist format validation ──

  Scenario: Valid whitelist entries are accepted
    Given the whitelist contains:
      | entry                              |
      | discord/account/123456789012345678 |
      | discord/channel/987654321098765432 |
      | misskey/account/abcdef1234567890   |
    Then all 3 entries should be parsed successfully

  Scenario: Invalid whitelist entries are skipped with warning
    Given the whitelist contains:
      | entry                  |
      | discord/account/valid  |
      | invalid_entry          |
      | telegram/account/123   |
      |                        |
    Then only 1 valid entry should be parsed
    And warnings should be logged for 3 invalid entries
    And the bot should not crash

  # ── replyTo: "all" mode ──

  Scenario: Reply to all public messages in "all" mode
    Given the access control is configured with replyTo "all"
    When a public message is received from any user
    Then the bot should process the message

  Scenario: Reply to all DMs in "all" mode
    Given the access control is configured with replyTo "all"
    When a DM is received from any user
    Then the bot should process the message

  Scenario: Reply in "all" mode even with empty whitelist
    Given the access control is configured with replyTo "all"
    And the whitelist is empty
    When any message is received
    Then the bot should process the message

  # ── replyTo: "public" mode ──

  Scenario: Reply to public messages in "public" mode regardless of whitelist
    Given the access control is configured with replyTo "public"
    And the whitelist does not contain the user
    When a public message is received from a non-whitelisted user
    Then the bot should process the message

  Scenario: Deny DM from non-whitelisted user in "public" mode
    Given the access control is configured with replyTo "public"
    And the whitelist does not contain the user
    When a DM is received from that user
    Then the bot should ignore the message

  Scenario: Allow DM from whitelisted account in "public" mode
    Given the access control is configured with replyTo "public"
    And the whitelist contains "discord/account/12345"
    When a DM is received from Discord user "12345"
    Then the bot should process the message

  Scenario: Allow DM from whitelisted channel in "public" mode
    Given the access control is configured with replyTo "public"
    And the whitelist contains "discord/channel/99999"
    When a DM is received in Discord channel "99999"
    Then the bot should process the message

  # ── replyTo: "whitelist" mode ──

  Scenario: Allow message from whitelisted account in "whitelist" mode (public)
    Given the access control is configured with replyTo "whitelist"
    And the whitelist contains "discord/account/12345"
    When a public message is received from Discord user "12345"
    Then the bot should process the message

  Scenario: Allow message from whitelisted account in "whitelist" mode (DM)
    Given the access control is configured with replyTo "whitelist"
    And the whitelist contains "discord/account/12345"
    When a DM is received from Discord user "12345"
    Then the bot should process the message

  Scenario: Allow message from whitelisted channel in "whitelist" mode
    Given the access control is configured with replyTo "whitelist"
    And the whitelist contains "discord/channel/67890"
    When a message is received in Discord channel "67890"
    Then the bot should process the message

  Scenario: Deny message from non-whitelisted user in "whitelist" mode
    Given the access control is configured with replyTo "whitelist"
    And the whitelist does not contain the user or channel
    When a message is received
    Then the bot should ignore the message

  Scenario: Empty whitelist denies all in "whitelist" mode
    Given the access control is configured with replyTo "whitelist"
    And the whitelist is empty
    When any message is received
    Then the bot should ignore all messages

  # ── Cross-platform isolation ──

  Scenario: Discord whitelist does not match Misskey events
    Given the access control is configured with replyTo "whitelist"
    And the whitelist contains "discord/account/12345"
    When a message is received from Misskey user "12345"
    Then the bot should ignore the message

  Scenario: Misskey whitelist does not match Discord events
    Given the access control is configured with replyTo "whitelist"
    And the whitelist contains "misskey/account/12345"
    When a message is received from Discord user "12345"
    Then the bot should ignore the message

  # ── Platform filter priority ──

  Scenario: Platform-level filters take precedence over access control
    Given the access control is configured with replyTo "all"
    And the Discord adapter has allowDm set to false
    When a DM is received on Discord
    Then the bot should not receive the event at all
    Because platform-level filtering happens before access control

  # ── Processing order ──

  Scenario: Access control is applied after platform filters but before message handling
    Given the access control is configured with replyTo "whitelist"
    And the whitelist does not contain the user
    When the platform adapter passes an event to AgentCore
    Then ReplyPolicyEvaluator.shouldReply() should be called
    And the event should not reach MessageHandler
    And no agent session should be created
