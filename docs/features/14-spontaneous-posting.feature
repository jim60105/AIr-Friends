Feature: Spontaneous Posting
  As a bot operator
  I want the bot to post messages on its own schedule without user triggers
  So that the bot can maintain presence and personality even when no one is messaging

  Background:
    Given the bot is connected to one or more platforms
    And the spontaneous posting configuration is loaded from config.yaml or environment variables

  # ── Configuration ──

  Scenario: Default configuration disables spontaneous posting
    Given no spontaneousPost section is configured for a platform
    Then spontaneous posting should be disabled for that platform
    And default minIntervalMs should be 10800000 (3 hours)
    And default maxIntervalMs should be 43200000 (12 hours)
    And default contextFetchProbability should be 0.5

  Scenario: Enable spontaneous posting via config.yaml
    Given the following spontaneousPost config for Discord:
      """yaml
      spontaneousPost:
        enabled: true
        minIntervalMs: 3600000
        maxIntervalMs: 7200000
        contextFetchProbability: 0.3
      """
    Then spontaneous posting should be enabled for Discord
    And the scheduler should use the configured intervals

  Scenario: Enable spontaneous posting via environment variables
    Given the environment variable DISCORD_SPONTANEOUS_ENABLED is set to "true"
    And the environment variable DISCORD_SPONTANEOUS_MIN_INTERVAL_MS is set to "3600000"
    Then spontaneous posting should be enabled for Discord

  Scenario: Validation clamps minIntervalMs to at least 60 seconds
    Given spontaneousPost.minIntervalMs is set to 1000 (1 second)
    Then the validated minIntervalMs should be clamped to 60000

  Scenario: Validation swaps min/max when reversed
    Given spontaneousPost.minIntervalMs is set to 50000000
    And spontaneousPost.maxIntervalMs is set to 10000000
    Then the validated minIntervalMs should be 10000000
    And the validated maxIntervalMs should be 50000000

  Scenario: Validation clamps contextFetchProbability to [0, 1]
    Given spontaneousPost.contextFetchProbability is set to 1.5
    Then the validated contextFetchProbability should be 1.0

  # ── Scheduler behavior ──

  Scenario: Scheduler only runs for enabled platforms
    Given Discord has spontaneousPost.enabled = true
    And Misskey has spontaneousPost.enabled = false
    When the scheduler starts
    Then only Discord should have an active timer

  Scenario: Scheduler uses random intervals between min and max
    Given minIntervalMs is 3600000 and maxIntervalMs is 7200000
    When the scheduler picks the next interval
    Then the interval should be between 3600000 and 7200000 (inclusive)

  Scenario: Scheduler reschedules after each execution
    Given the scheduler executes a spontaneous post
    Then a new timer should be set for the next execution
    And the next interval should be randomly chosen

  Scenario: Scheduler continues after callback failure
    Given the spontaneous post callback throws an error
    Then the error should be logged
    And the scheduler should still schedule the next execution
    And the bot should NOT crash

  Scenario: Scheduler prevents concurrent executions
    Given a spontaneous post is currently being processed
    When the next timer fires
    Then the execution should be skipped
    And a new timer should be set

  # ── Session flow ──

  Scenario: Spontaneous session has no trigger event
    Given the scheduler triggers a spontaneous post
    When a session is registered in SessionRegistry
    Then the session's triggerEvent should be undefined
    And the session should be valid and functional

  Scenario: Spontaneous session creates workspace for bot user
    Given the scheduler triggers a spontaneous post
    Then a workspace should be created using the bot's own user ID
    And the workspace key should be "{platform}/{bot_user_id}"

  Scenario: Spontaneous session respects single reply rule
    Given a spontaneous post session is active
    When the agent calls send-reply
    Then the reply should be sent to the target channel
    And subsequent send-reply calls should return 409 Conflict

  # ── Context assembly ──

  Scenario: Spontaneous context includes memories but no trigger message
    Given the scheduler triggers a spontaneous post
    When the context is assembled
    Then the context should include important memories
    And the context should NOT include a trigger message
    And the context should include spontaneous post instructions

  Scenario: Spontaneous context optionally includes recent messages
    Given contextFetchProbability is 0.5
    When the scheduler decides to fetch context
    Then there is approximately a 50% chance recent messages are included
    And if not fetched, the context should still be valid

  # ── Platform targets ──

  Scenario: Discord spontaneous target is selected from whitelist
    Given the whitelist contains Discord channel and account entries
    When the scheduler triggers a Discord spontaneous post
    Then a random whitelist entry for Discord should be selected
    And if it's a channel entry, the message is sent to that channel
    And if it's an account entry, a DM channel is created

  Scenario: Discord returns null when whitelist has no Discord entries
    Given the whitelist is empty or contains only Misskey entries
    When the scheduler triggers a Discord spontaneous post
    Then no target should be returned
    And the spontaneous post should be skipped

  Scenario: Misskey spontaneous target is the bot's own timeline
    When the scheduler triggers a Misskey spontaneous post
    Then the target channel should be "timeline:self"
    And the bot should create a new public note

  Scenario: Misskey supports timeline:self in sendReply
    Given the target channel is "timeline:self"
    When the agent calls send-reply
    Then a new note should be created via "notes/create" API
    And no replyId should be set

  Scenario: Misskey supports timeline:self in fetchRecentMessages
    Given the target channel is "timeline:self"
    When the context assembler fetches recent messages
    Then the bot's own recent notes should be returned via "users/notes" API

  # ── Lifecycle ──

  Scenario: Scheduler starts after platforms connect
    Given the bootstrap completes
    When platforms are connected
    Then the spontaneous scheduler should start

  Scenario: Scheduler stops on shutdown
    Given the spontaneous scheduler is running
    When the shutdown handler is invoked
    Then the scheduler should stop all timers
    And no new spontaneous posts should be triggered
