# Self-Research via RSS/Atom Feeds

## Purpose

Enables the agent to periodically read RSS/Atom feeds, pick a topic aligned with its character personality, research it using web tools, and write study notes to the agent workspace — all without sending any reply to any platform.

## Requirements

### Requirement: SelfResearchScheduler with Random Interval

The `SelfResearchScheduler` SHALL schedule research sessions at random intervals between `minIntervalMs` (default 43,200,000 ms / 12 hours) and `maxIntervalMs` (default 86,400,000 ms / 24 hours).

#### Scenario: Random interval scheduling
- **GIVEN** `minIntervalMs` is 43,200,000 and `maxIntervalMs` is 86,400,000
- **WHEN** the scheduler calculates the next interval
- **THEN** the interval is randomly chosen within [43,200,000, 86,400,000) ms

#### Scenario: Reschedule after completion
- **GIVEN** a self-research session completes (success or failure)
- **WHEN** the scheduler determines the next execution
- **THEN** a new random interval is calculated and the next session is scheduled

### Requirement: Configuration and Auto-Disable

The self-research feature SHALL be disabled by default. It SHALL auto-disable when `rssFeeds` is empty or `model` is empty, logging a warning.

#### Scenario: Disabled by default
- **GIVEN** no `selfResearch` section in config
- **WHEN** configuration is loaded
- **THEN** `selfResearch.enabled` defaults to `false`

#### Scenario: Auto-disable on empty feeds
- **GIVEN** `selfResearch.enabled` is `true` and `rssFeeds` is `[]`
- **WHEN** configuration is validated
- **THEN** `selfResearch.enabled` is set to `false` with a warning

#### Scenario: Auto-disable on empty model
- **GIVEN** `selfResearch.enabled` is `true` and `model` is `""`
- **WHEN** configuration is validated
- **THEN** `selfResearch.enabled` is set to `false` with a warning

#### Scenario: Clamp minimum interval
- **GIVEN** `minIntervalMs` is set to `1000`
- **WHEN** configuration is validated
- **THEN** `minIntervalMs` is clamped to `3,600,000` (1 hour)

#### Scenario: Swap reversed intervals
- **GIVEN** `minIntervalMs` is `86,400,000` and `maxIntervalMs` is `43,200,000`
- **WHEN** configuration is validated
- **THEN** the values are swapped so `minIntervalMs < maxIntervalMs`

### Requirement: RSS/Atom Feed Fetching

The `fetchRssItems()` function SHALL fetch items from multiple configured feed sources. Failed feeds SHALL be silently skipped with a warning log.

#### Scenario: Fetch from multiple sources
- **GIVEN** two RSS feed sources are configured
- **WHEN** the RSS fetcher runs
- **THEN** items from both feeds are collected into a single array

#### Scenario: Skip failed feeds
- **GIVEN** one feed returns HTTP 404 and another returns valid XML
- **WHEN** the RSS fetcher runs
- **THEN** only items from the successful feed are returned
- **AND** a warning is logged for the failed feed

#### Scenario: Fetch timeout
- **GIVEN** a feed source does not respond
- **WHEN** 10 seconds elapse
- **THEN** the fetch is aborted via `AbortSignal.timeout(10000)`
- **AND** the error is caught and logged

### Requirement: RSS/Atom Parsing

The parser SHALL support both RSS 2.0 (`<item>`) and Atom (`<entry>`) formats using regex-based parsing. XML entities SHALL be decoded and HTML tags SHALL be stripped.

#### Scenario: Parse RSS 2.0
- **GIVEN** an RSS 2.0 feed with `<item>` elements
- **WHEN** the feed is parsed
- **THEN** `title`, `link`, and `description` (or `content:encoded`) are extracted

#### Scenario: Parse Atom
- **GIVEN** an Atom feed with `<entry>` elements (no RSS `<item>` found)
- **WHEN** the feed is parsed
- **THEN** `title`, link (from `<link href="..."/>`), and `summary` (or `content`) are extracted

#### Scenario: Strip XML tags from description
- **GIVEN** a description contains `<p>Hello <b>world</b></p>`
- **WHEN** the item is parsed
- **THEN** the description becomes `"Hello world"`

#### Scenario: Truncate long descriptions
- **GIVEN** a description is longer than 300 characters
- **WHEN** the item is parsed
- **THEN** the description is truncated to 297 characters plus `"..."`

#### Scenario: Decode XML entities
- **GIVEN** text contains `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, or numeric entities
- **WHEN** the text is decoded
- **THEN** entities are replaced with their character equivalents

### Requirement: Random Item Selection

The system SHALL randomly pick up to 20 items from all collected RSS items using Fisher-Yates shuffle (`pickRandom()`).

#### Scenario: Pick 20 from 50
- **GIVEN** 50 RSS items are collected from all feeds
- **WHEN** random selection runs
- **THEN** exactly 20 items are returned in shuffled order

#### Scenario: Fewer than 20 items available
- **GIVEN** only 5 RSS items are collected
- **WHEN** random selection runs
- **THEN** all 5 items are returned

### Requirement: Research Session Flow

The research session SHALL follow this flow:
1. Fetch RSS items from configured sources
2. Randomly pick up to 20 items
3. Build a research prompt with character personality and RSS materials
4. Agent reads existing notes and picks a new topic
5. Agent researches the topic (using web tools if available)
6. Agent writes notes to `$AGENT_WORKSPACE/notes/` and updates `_index.md`
7. Agent self-reviews for hallucinations and privacy

#### Scenario: Session type
- **GIVEN** a self-research session is triggered
- **WHEN** `SessionOrchestrator.processSelfResearch()` is called
- **THEN** the session type is `"selfResearch"`

#### Scenario: canWriteAgentWorkspace template variable
- **GIVEN** a self-research session is being assembled
- **WHEN** template variables are set
- **THEN** `canWriteAgentWorkspace` is `true`
- **AND** the prompt template shows write instructions for the agent workspace

### Requirement: No Platform Reply

Self-research sessions SHALL NOT send any reply to any platform. The `send-reply` skill SHALL NOT be invoked.

#### Scenario: No reply sent
- **GIVEN** a self-research session is running
- **WHEN** the session completes
- **THEN** no message is posted to Discord, Misskey, or any other platform

### Requirement: Model Configuration

The self-research session SHALL use the model specified in `selfResearch.model`.

#### Scenario: Custom model
- **GIVEN** `selfResearch.model` is `"gpt-5-mini"`
- **WHEN** a self-research ACP session is created
- **THEN** the session model is set to `"gpt-5-mini"`

### Requirement: Concurrent Execution Guard

The scheduler SHALL skip execution if a previous session is still running, and schedule the next session.

#### Scenario: Overlapping execution
- **GIVEN** a self-research session is already running (`isRunning === true`)
- **WHEN** the timer fires again
- **THEN** the new execution is skipped with a warning log
- **AND** the next timer is scheduled

### Requirement: Error Resilience

Self-research session failures SHALL be caught and logged. The scheduler SHALL always reschedule the next session. Errors SHALL NOT crash the bot.

#### Scenario: Session failure
- **GIVEN** a self-research session throws an error
- **WHEN** the error is caught
- **THEN** the error is logged
- **AND** the next session is scheduled normally

### Requirement: Lifecycle Management

The scheduler SHALL support `start()`, `stop()`, and `getStatus()` methods. Calling `start()` twice SHALL log a warning and return without creating a duplicate timer.

#### Scenario: Double start prevention
- **GIVEN** the scheduler is already started
- **WHEN** `start()` is called again
- **THEN** a warning is logged and no duplicate timer is created

#### Scenario: Graceful stop
- **GIVEN** the scheduler is running
- **WHEN** `stop()` is called
- **THEN** the timer is cleared, `started` is set to `false`, and `nextScheduledAt` is `null`

### Requirement: Environment Variable Overrides

The following environment variables SHALL override the corresponding config values:

| Environment Variable              | Config Path                      |
| --------------------------------- | -------------------------------- |
| `SELF_RESEARCH_ENABLED`           | `selfResearch.enabled`           |
| `SELF_RESEARCH_MODEL`             | `selfResearch.model`             |
| `SELF_RESEARCH_RSS_FEEDS`         | `selfResearch.rssFeeds`          |
| `SELF_RESEARCH_MIN_INTERVAL_MS`   | `selfResearch.minIntervalMs`     |
| `SELF_RESEARCH_MAX_INTERVAL_MS`   | `selfResearch.maxIntervalMs`     |

`SELF_RESEARCH_RSS_FEEDS` accepts a JSON string (e.g., `'[{"url":"...","name":"..."}]'`).

#### Scenario: Override via environment
- **GIVEN** `SELF_RESEARCH_ENABLED=true` and `SELF_RESEARCH_MODEL=gpt-5-mini`
- **WHEN** configuration is loaded
- **THEN** self-research is enabled with model `"gpt-5-mini"`

### Requirement: State Persistence

The scheduler SHALL persist its next scheduled time via `SchedulerStateStore`. On restart, a restored schedule time is honored via `resolveScheduleTime()`.

#### Scenario: Restored schedule time
- **GIVEN** the persisted `selfResearch` schedule time has already elapsed
- **WHEN** the scheduler starts with restored state
- **THEN** execution runs immediately
