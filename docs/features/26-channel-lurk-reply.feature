Feature: Channel Lurk Reply
  As a bot operator
  I want the bot to periodically check whitelisted channels
  So that the bot can naturally participate in conversations without being explicitly triggered

  Background:
    Given the bot is configured with channel lurk enabled
    And the whitelist contains Discord channel entries

  Scenario: All conditions met - triggers agent reply
    Given the last message in a whitelisted channel is from a non-bot user
    And the last message does not mention the bot
    And the bot has not reacted to the last message
    When the channel lurk interval elapses
    Then the bot should process the message as a normal reply trigger
    And the session type should be "channelLurk"

  Scenario: Skip - last message from bot
    Given the last message in a whitelisted channel is from the bot itself
    When the channel lurk interval elapses
    Then the bot should not trigger a reply

  Scenario: Skip - bot is mentioned
    Given the last message mentions the bot
    When the channel lurk interval elapses
    Then the bot should not trigger a reply
    Because the mention would have already triggered a normal reply

  Scenario: Skip - bot already reacted
    Given the bot has already reacted to the last message
    When the channel lurk interval elapses
    Then the bot should not trigger a reply

  Scenario: Skip - same message already processed
    Given the last message has already been processed by channel lurk
    When the channel lurk interval elapses again
    Then the bot should not trigger a duplicate reply

  Scenario: Skip - no messages in channel
    Given a whitelisted channel has no messages
    When the channel lurk interval elapses
    Then the bot should skip the channel without error

  Scenario: Error isolation
    Given a channel API call fails
    When processing multiple channels
    Then other channels should still be checked normally

  Scenario: Configuration disabled
    Given channel lurk is disabled in configuration
    When the application starts
    Then no channel lurk scheduler should be created

  Scenario: No channels in whitelist
    Given channel lurk is enabled but no Discord channels are in the whitelist
    When the application starts
    Then an info message should be logged
    And no scheduler should start
