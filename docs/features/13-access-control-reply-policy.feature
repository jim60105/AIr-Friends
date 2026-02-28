Feature: Reply Policy
  As a bot operator
  I want to control which users and channels the bot responds to
  So that I can manage the bot's interaction scope

  Background:
    Given the bot is connected to one or more platforms
    And the reply policy configuration is loaded from config.yaml or environment variables

  # ── Configuration defaults ──

  Scenario: Default configuration uses channels mode with empty channels list
    Given no replyPolicy section is configured in config.yaml
    And no REPLY_POLICY or CHANNELS environment variables are set
    Then the default reply policy should be "channels"
    And the default channels list should be empty
    And the bot should not reply to anyone

  # ── Configuration loading ──

  Scenario: Load reply policy from config.yaml
    Given config.yaml contains:
      """yaml
      replyPolicy: "public"
      channels:
        - id: "discord/account/12345678901234567"
        - id: "misskey/account/abcdef123"
      """
    Then the reply policy should be "public"
    And the channels list should contain 2 entries

  Scenario: REPLY_POLICY environment variable overrides config.yaml
    Given config.yaml sets replyPolicy to "channels"
    And environment variable REPLY_POLICY is set to "all"
    Then the effective reply policy should be "all"

  Scenario: CHANNELS environment variable overrides config.yaml
    Given config.yaml sets channels to [{ id: "discord/account/11100000000000000" }]
    And environment variable CHANNELS is set to '[{"id":"discord/account/22200000000000000"},{"id":"misskey/account/333"}]'
    Then the effective channels list should be [{"id":"discord/account/22200000000000000"}, {"id":"misskey/account/333"}]
    And the original config.yaml channels entry "discord/account/11100000000000000" should not be present

  Scenario: CHANNELS environment variable trims whitespace from entries when parsing
    Given environment variable CHANNELS is set to '[{"id":" discord/account/12345678901234567 "},{"id":" misskey/account/abc "}]'
    Then the effective channels list should be [{"id":"discord/account/12345678901234567"}, {"id":"misskey/account/abc"}]

  Scenario: Empty CHANNELS environment variable does not override config
    Given config.yaml sets channels to [{ id: "discord/account/11100000000000000" }]
    And environment variable CHANNELS is set to ""
    Then the effective channels list should still be [{ id: "discord/account/11100000000000000" }]

  # ── Channel format validation ──

  Scenario: Valid channel entries are accepted
    Given the channels list contains:
      | entry                              |
      | discord/account/123456789012345678 |
      | discord/channel/987654321098765432 |
      | misskey/account/abcdef1234567890   |
    Then all 3 entries should be parsed successfully

  Scenario: Invalid channel entries are skipped with warning
    Given the channels list contains:
      | entry                  |
      | discord/account/valid  |
      | invalid_entry          |
      | telegram/account/123   |
      |                        |
    Then only 1 valid entry should be parsed
    And warnings should be logged for 3 invalid entries
    And the bot should not crash

  # ── replyPolicy: "all" mode ──

  Scenario: Reply to all public messages in "all" mode
    Given the reply policy is configured with replyPolicy "all"
    When a public message is received from any user
    Then the bot should process the message

  Scenario: Reply to all DMs in "all" mode
    Given the reply policy is configured with replyPolicy "all"
    When a DM is received from any user
    Then the bot should process the message

  Scenario: Reply in "all" mode even with empty channels list
    Given the reply policy is configured with replyPolicy "all"
    And the channels list is empty
    When any message is received
    Then the bot should process the message

  # ── replyPolicy: "public" mode ──

  Scenario: Reply to public messages in "public" mode regardless of channels list
    Given the reply policy is configured with replyPolicy "public"
    And the channels list does not contain the user
    When a public message is received from a non-listed user
    Then the bot should process the message

  Scenario: Deny DM from non-listed user in "public" mode
    Given the reply policy is configured with replyPolicy "public"
    And the channels list does not contain the user
    When a DM is received from that user
    Then the bot should ignore the message

  Scenario: Allow DM from channel-configured account in "public" mode
    Given the reply policy is configured with replyPolicy "public"
    And the channels list contains { id: "discord/account/12345000000000000", rateLimitBypass: true }
    When a DM is received from Discord user "12345"
    Then the bot should process the message

  Scenario: Allow DM from channel-configured channel in "public" mode
    Given the reply policy is configured with replyPolicy "public"
    And the channels list contains { id: "discord/channel/99999000000000000", enabled: true }
    When a DM is received in Discord channel "99999"
    Then the bot should process the message

  # ── replyPolicy: "channels" mode ──

  Scenario: Allow message from channel-configured account in "channels" mode (public)
    Given the reply policy is configured with replyPolicy "channels"
    And the channels list contains { id: "discord/account/12345000000000000", enabled: true }
    When a public message is received from Discord user "12345"
    Then the bot should process the message

  Scenario: Allow message from channel-configured account in "channels" mode (DM)
    Given the reply policy is configured with replyPolicy "channels"
    And the channels list contains { id: "discord/account/12345000000000000", enabled: true }
    When a DM is received from Discord user "12345"
    Then the bot should process the message

  Scenario: Allow message from channel-configured channel in "channels" mode
    Given the reply policy is configured with replyPolicy "channels"
    And the channels list contains { id: "discord/channel/67890000000000000", enabled: true }
    When a message is received in Discord channel "67890"
    Then the bot should process the message

  Scenario: Deny message from non-listed user in "channels" mode
    Given the reply policy is configured with replyPolicy "channels"
    And the channels list does not contain the user or channel
    When a message is received
    Then the bot should ignore the message

  Scenario: Empty channels list denies all in "channels" mode
    Given the reply policy is configured with replyPolicy "channels"
    And the channels list is empty
    When any message is received
    Then the bot should ignore all messages

  # ── Cross-platform isolation ──

  Scenario: Discord channels list does not match Misskey events
    Given the reply policy is configured with replyPolicy "channels"
    And the channels list contains { id: "discord/account/12345000000000000" }
    When a message is received from Misskey user "12345"
    Then the bot should ignore the message

  Scenario: Misskey channels list does not match Discord events
    Given the reply policy is configured with replyPolicy "channels"
    And the channels list contains { id: "misskey/account/12345" }
    When a message is received from Discord user "12345"
    Then the bot should ignore the message

  # ── Platform filter priority ──

  Scenario: Platform-level filters take precedence over reply policy
    Given the reply policy is configured with replyPolicy "all"
    And the Discord adapter has allowDm set to false
    When a DM is received on Discord
    Then the bot should not receive the event at all
    Because platform-level filtering happens before reply policy

  # ── Processing order ──

  Scenario: Reply policy is applied after platform filters but before message handling
    Given the reply policy is configured with replyPolicy "channels"
    And the channels list does not contain the user
    When the platform adapter passes an event to AgentCore
    Then ReplyPolicyEvaluator.shouldReply() should be called
    And the event should not reach MessageHandler
    And no agent session should be created
