# Self-Research via RSS/Atom Feeds

## Purpose

Enables the agent to periodically read RSS/Atom feeds, pick a topic aligned with its character personality, research it using web tools, and write study notes to the agent workspace — all without sending any reply to any platform.

## Requirements

### Requirement: SelfResearchScheduler extends BaseScheduler

The `SelfResearchScheduler` SHALL extend `BaseScheduler`, inheriting common lifecycle management while providing its own scheduling configuration.

#### Scenario: Scheduler extends BaseScheduler
- **WHEN** `SelfResearchScheduler` is instantiated
- **THEN** it SHALL be an instance of `BaseScheduler` and use `getNextDelayMs()` to compute random intervals from `minIntervalMs`/`maxIntervalMs` config

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
- **THEN** the session type is `"self-research"`

#### Scenario: canWriteAgentWorkspace template variable
- **GIVEN** a self-research session is being assembled
- **WHEN** template variables are set
- **THEN** `canWriteAgentWorkspace` is `true`
- **AND** the prompt template shows write instructions for the agent workspace

### Requirement: Research Session Completion Verification

After a self-research ACP session ends with `end_turn`, the system SHALL verify the agent produced research output before declaring success. Research output SHALL be a new file, or a content-hash-changed file with mtime at/after session start (≤1s clock slack), under `$AGENT_WORKSPACE/notes/` or `journal/`, compared with a recursive fingerprint snapshot (relative path → size, mtime, content hash). A session with no research output SHALL NOT be reported successful.

#### Scenario: Note written in normal flow
- **GIVEN** a self-research session with completion verification enabled
- **WHEN** the agent ends the turn after creating `/app/data/agent-workspace/notes/operatiology-and-noology.md` and updating `_index.md` (new files, or content-changed files with mtime at/after session start)
- **THEN** the session SHALL be reported successful

#### Scenario: No note produced triggers one corrective retry
- **GIVEN** a self-research session whose agent ended the turn without writing any file under `$AGENT_WORKSPACE/notes/` or `journal/` (e.g. after its tool calls were rejected)
- **WHEN** completion verification runs
- **THEN** the system SHALL record `retry_triggered` (reason `no_research_note`, retryCount 1, maxRetries 1) in the audit log
- **AND** SHALL send one corrective retry prompt on the same ACP session embedding the recent permission rejections and guidance for that session's selected engine and effective permission mode
- **AND** SHALL re-verify after the retry

#### Scenario: Retry succeeds
- **GIVEN** a self-research session whose first turn produced no note and the corrective retry was sent
- **WHEN** the retry turn writes a note under `$AGENT_WORKSPACE/notes/`
- **THEN** the session SHALL be reported successful with `success: true`

#### Scenario: Retry also produces nothing ends as failure
- **GIVEN** a self-research session whose first turn and corrective retry both produced no research output
- **WHEN** completion verification runs after the retry
- **THEN** the session SHALL end with `success: false` and error reason `no_research_note`
- **AND** the audit log SHALL contain exactly ONE `session_end` entry with `success: false` (written after the retry outcome), plus `prompt_sent`/`agent_response` entries for the retry turn with `isRetry: true`
- **AND** `airfriends_self_research_no_note_total` SHALL be incremented exactly once for the session

#### Scenario: Same-size same-millisecond overwrite still detected
- **GIVEN** a self-research session whose snapshot recorded an existing note file, and the agent overwrote it with different content of the same size within the same millisecond
- **WHEN** completion verification runs
- **THEN** the content hash comparison SHALL detect the change and the session SHALL be reported successful

#### Scenario: Pre-session file modification does not count
- **GIVEN** a file under `$AGENT_WORKSPACE/notes/` whose content changed before the session started
- **WHEN** completion verification runs after an `end_turn` with no other output
- **THEN** the session SHALL NOT be counted as having produced output because the modification time precedes the session start

#### Scenario: Verification uncertainty never retries
- **GIVEN** the agent workspace `notes/` directory cannot be read during verification (I/O error)
- **WHEN** a self-research session ends with `end_turn`
- **THEN** the system SHALL log a warning and treat the session as having produced output, with no retry prompt sent

#### Scenario: Non-end_turn stop reason keeps existing behavior
- **GIVEN** the session's agent turn ends with a non-`end_turn` stop reason (e.g. `cancelled`)
- **WHEN** the session completes
- **THEN** the session SHALL be reported failed without any completion retry

#### Scenario: Augment retry prompt with rejection context
- **GIVEN** the system sends the one corrective retry on the same ACP session
- **WHEN** the retry prompt is built
- **THEN** it SHALL state that a research note must be written and SHALL embed the session's recent permission-rejection reasons (bounded via the per-session permission-rejection ring buffer and `formatPermissionRejections()`)
- **AND** restricted OpenCode guidance SHALL name its pre-gate denied commands (`echo`, `curl`, `git`, `python`, `mkdir`, …) while OMP and YOLO guidance SHALL NOT inherit that OpenCode-only denial list

#### Scenario: Retry prompt restates sandbox and write rules
- **GIVEN** the corrective retry prompt is being assembled
- **WHEN** it instructs the agent's actions
- **THEN** restricted guidance SHALL restate the per-command chaining and applicable operator restrictions, including tolerated standard-stream fd redirects, without describing `||` itself as forbidden
- **AND** YOLO guidance SHALL omit restricted shell-denial claims while preserving applicable filesystem limits
- **AND** all modes SHALL retain the webfetch 403/429 fallback to `agent-browser`, require writing the note to `$AGENT_WORKSPACE/notes/{topic-slug}.md` and updating `$AGENT_WORKSPACE/notes/_index.md` (env-var paths, deployment-independent)
- **AND** edit/write note creation SHALL remain recommended without claiming native-YOLO rejects all shell redirects

#### Scenario: Audit entries record each turn and one session_end
- **GIVEN** a self-research session with completion verification enabled
- **WHEN** the first turn and the optional corrective retry are recorded
- **THEN** the first turn's response SHALL be an audit `agent_response` with `isRetry: false` without any preceding `session_end`
- **AND** the retry prompt SHALL be recorded as `prompt_sent` and its response as `agent_response` with `isRetry: true`, with exactly ONE `session_end` written only after the final verification outcome

#### Scenario: Failed final retry logs warning and metric
- **GIVEN** the corrective retry also produced no research output
- **WHEN** verification fails after the retry
- **THEN** the session SHALL emit a WARN log and increment `airfriends_self_research_no_note_total` exactly once (only when completion verification is enabled)

#### Scenario: Correction receives the running session context
- **GIVEN** a session whose effective permission mode differs from the global default
- **WHEN** its no-note correction is delivered for OpenCode or OMP
- **THEN** guidance SHALL follow the running session's selected engine and resolved effective mode
- **AND** it SHALL preserve the trusted script root and same-session retry target without changing retry count, completion criteria or platform-reply prohibition

### Requirement: Untrusted RSS Content Delimiting

The self-research prompt SHALL delimit each interpolated RSS/feed item with explicit untrusted-content markers and an instruction not to follow any directives contained within the delimited text, so that externally-sourced feed content is presented to the model as third-party data rather than as prompt instructions. Bare, undelimited interpolation of feed `title`/`source`/`url`/`description` into the prompt SHALL NOT be used.

#### Scenario: RSS items wrapped in untrusted-content markers
- **GIVEN** a self-research session with fetched RSS items
- **WHEN** `buildSelfResearchPrompt` assembles the Reference Materials block
- **THEN** each item's title/source/url/description SHALL be enclosed in explicit untrusted-content start/end markers
- **AND** the block SHALL include an instruction directing the model not to follow any instructions contained within the delimited feed content

#### Scenario: No bare interpolation
- **GIVEN** the assembled self-research prompt
- **WHEN** feed content is rendered into it
- **THEN** the feed content SHALL appear only inside the untrusted-content delimiters, not as an undelimited list

### Requirement: No Platform Reply

Self-research sessions SHALL NOT send any reply to any platform. The `send-reply` skill SHALL NOT be invoked.

#### Scenario: No reply sent
- **GIVEN** a self-research session is running
- **WHEN** the session completes
- **THEN** no message is posted to Discord, Misskey, or any other platform

### Requirement: Model Configuration

The self-research session SHALL resolve the model using the fallback chain: model routing rules → `selfResearch.model` → `agent.model`.

#### Scenario: Custom model (no routing rules)
- **GIVEN** `selfResearch.model` is `"gpt-5-mini"` and no model routing rules match
- **WHEN** a self-research ACP session is created
- **THEN** the session model is set to `"gpt-5-mini"`

#### Scenario: Routing rule override
- **GIVEN** a model routing rule matches session type `"self-research"`
- **WHEN** a self-research ACP session is created
- **THEN** the routed model takes precedence over `selfResearch.model`

#### Scenario: Fallback to agent.model
- **GIVEN** `selfResearch.model` is empty and no routing rules match
- **WHEN** a self-research ACP session is created
- **THEN** the session model falls back to `agent.model`

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

Environment variables SHALL override the corresponding config values when set. `SELF_RESEARCH_RSS_FEEDS` accepts a JSON string (e.g., `'[{"url":"...","name":"..."}]'`).

#### Scenario: Override via environment
- **GIVEN** `SELF_RESEARCH_ENABLED=true` and `SELF_RESEARCH_MODEL=gpt-5-mini`
- **WHEN** configuration is loaded
- **THEN** self-research is enabled with model `"gpt-5-mini"`

#### Scenario: Environment variable to config mapping
- **GIVEN** any of the overridable environment variables is set
- **WHEN** configuration is loaded
- **THEN** each SHALL override its config value: `SELF_RESEARCH_ENABLED`→`selfResearch.enabled`, `SELF_RESEARCH_MODEL`→`selfResearch.model`, `SELF_RESEARCH_RSS_FEEDS`→`selfResearch.rssFeeds`, `SELF_RESEARCH_MIN_INTERVAL_MS`→`selfResearch.minIntervalMs`, `SELF_RESEARCH_MAX_INTERVAL_MS`→`selfResearch.maxIntervalMs`

### Requirement: Completion Verification Configuration

`selfResearch.verifyCompletion`, a boolean config field defaulting to `true`, SHALL control completion verification. When `false`, self-research sessions SHALL use legacy behavior: any `end_turn` counts as success, no fingerprint snapshot is taken, no retry runs, and the `airfriends_self_research_no_note_total` counter SHALL NOT be incremented (the outcome cannot be measured without verification).

#### Scenario: Enabled by default
- **GIVEN** no `verifyCompletion` field in the `selfResearch` config
- **WHEN** configuration is loaded
- **THEN** `selfResearch.verifyCompletion` SHALL default to `true`

#### Scenario: Environment variable override
- **GIVEN** `SELF_RESEARCH_VERIFY_COMPLETION=false`
- **WHEN** configuration is loaded
- **THEN** `selfResearch.verifyCompletion` SHALL be `false` and the legacy end_turn-equals-success behavior SHALL apply, with no snapshot, no retry, and no no-note counter increment

#### Scenario: Document environment override in example configs
- **GIVEN** the `SELF_RESEARCH_VERIFY_COMPLETION` environment variable (accepting `"true"` or `"false"`)
- **WHEN** an administrator wants to configure verification via environment
- **THEN** the variable SHALL be documented in `config.example.yaml`, `.env.example`, and `helm/values.yaml`
- **AND** it SHALL override `selfResearch.verifyCompletion` when set

### Requirement: State Persistence

The scheduler SHALL persist its next scheduled time via `SchedulerStateStore`. On restart, a restored schedule time is honored via `resolveScheduleTime()`.

#### Scenario: Restored schedule time
- **GIVEN** the persisted `selfResearch` schedule time has already elapsed
- **WHEN** the scheduler starts with restored state
- **THEN** execution runs immediately
