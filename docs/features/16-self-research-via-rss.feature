Feature: Self-Research via RSS/Atom Feeds
  As the bot operator
  I want the agent to periodically read RSS feeds and research topics autonomously
  So that the agent builds deeper knowledge and more nuanced perspectives over time

  Background:
    Given the application configuration is loaded
    And the agent workspace exists at "{repoPath}/agent-workspace/"

  # --- Configuration ---

  Scenario: Self-research is disabled by default
    Given no selfResearch section in config.yaml
    Then selfResearch.enabled defaults to false
    And no self-research scheduler is started

  Scenario: Enable self-research via config.yaml
    Given config.yaml contains:
      """
      selfResearch:
        enabled: true
        model: "gpt-5-mini"
        rssFeeds:
          - url: "https://example.com/feed.xml"
            name: "Tech News"
        minIntervalMs: 43200000
        maxIntervalMs: 86400000
      """
    Then selfResearch.enabled is true
    And the self-research scheduler is initialized

  Scenario: Enable self-research via environment variables
    Given SELF_RESEARCH_ENABLED=true
    And SELF_RESEARCH_MODEL="gpt-5-mini"
    And SELF_RESEARCH_RSS_FEEDS='[{"url":"https://example.com/feed.xml","name":"Tech News"}]'
    Then selfResearch.enabled is true

  Scenario: Auto-disable when rssFeeds is empty
    Given selfResearch.enabled is true
    And selfResearch.rssFeeds is empty
    Then selfResearch.enabled is automatically set to false
    And a warning is logged

  Scenario: Auto-disable when model is empty
    Given selfResearch.enabled is true
    And selfResearch.model is ""
    Then selfResearch.enabled is automatically set to false
    And a warning is logged

  Scenario: Clamp minIntervalMs to 1 hour minimum
    Given selfResearch.minIntervalMs is 1000
    Then selfResearch.minIntervalMs is clamped to 3600000

  Scenario: Swap min and max interval when reversed
    Given selfResearch.minIntervalMs is 86400000
    And selfResearch.maxIntervalMs is 43200000
    Then the values are swapped so minIntervalMs < maxIntervalMs

  # --- RSS Fetching ---

  Scenario: Fetch items from multiple RSS sources
    Given two RSS feed sources are configured
    When the RSS fetcher runs
    Then items from both feeds are collected

  Scenario: Silently skip failed RSS feeds
    Given one RSS feed returns 404
    And another RSS feed returns valid XML
    When the RSS fetcher runs
    Then only items from the successful feed are returned
    And a warning is logged for the failed feed

  Scenario: Parse RSS 2.0 format
    Given an RSS 2.0 feed with <item> elements
    When the feed is parsed
    Then title, link, and description are extracted from each item

  Scenario: Parse Atom format
    Given an Atom feed with <entry> elements
    When the feed is parsed
    Then title, link, and summary are extracted from each entry

  Scenario: Strip XML tags from description
    Given an RSS item with HTML tags in description
    When the item is parsed
    Then all XML/HTML tags are removed from the description

  Scenario: Truncate long descriptions
    Given an RSS item with a description longer than 300 characters
    When the item is parsed
    Then the description is truncated to 300 characters with "..." suffix

  Scenario: Randomly select 20 items
    Given 50 RSS items are collected from all feeds
    When random selection runs
    Then exactly 20 items are selected

  # --- Research Session Flow ---

  Scenario: Agent selects topic as character
    Given the self-research session starts
    And 20 RSS items are provided as reference materials
    Then the agent reads the items as the character
    And selects ONE topic that interests the character

  Scenario: Agent avoids duplicate topics
    Given the agent has existing notes in agent-workspace/notes/
    When selecting a topic
    Then the agent checks _index.md to avoid already-covered topics

  Scenario: Agent writes notes to agent workspace
    Given the agent has completed research
    Then the agent writes a note to $AGENT_WORKSPACE/notes/{topic-slug}.md
    And updates $AGENT_WORKSPACE/notes/_index.md

  Scenario: Agent performs self-review
    Given the agent has written a research note
    Then the agent reviews for hallucinations
    And verifies no personal user information is included

  Scenario: No reply is sent during self-research
    Given a self-research session is running
    Then the send-reply skill is NOT invoked
    And no message is posted to any platform

  # --- Scheduler Behavior ---

  Scenario: Random interval between min and max
    Given selfResearch.minIntervalMs is 43200000
    And selfResearch.maxIntervalMs is 86400000
    Then each scheduled interval is randomly chosen between 43200000 and 86400000 ms

  Scenario: Reschedule after completion
    Given a self-research session completes
    Then the next session is scheduled with a new random interval

  Scenario: Reschedule after failure
    Given a self-research session fails with an error
    Then the error is logged
    And the next session is still scheduled
    And the bot does not crash

  Scenario: Concurrent execution guard
    Given a self-research session is already running
    When the timer triggers again
    Then the new execution is skipped
    And the next timer is scheduled
