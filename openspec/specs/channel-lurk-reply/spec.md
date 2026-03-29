# Channel Lurk Reply

## Purpose

Periodically checks whitelisted Discord channels and auto-replies when the last message meets all trigger conditions. This is a Discord-only feature that enables the bot to naturally participate in conversations without being explicitly mentioned or triggered.

## Requirements

### Requirement: Discord-Only Scope

The channel lurk feature SHALL only operate on Discord platform channels. Misskey and other platforms are not supported.

#### Scenario: Only Discord channels are checked
- **GIVEN** the channels list contains both Discord and Misskey entries with `channelLurk: true`
- **WHEN** the channel lurk scheduler runs
- **THEN** only Discord channel entries are checked

### Requirement: ChannelLurkScheduler extends BaseScheduler

The `ChannelLurkScheduler` SHALL extend `BaseScheduler`, inheriting common lifecycle management while preserving its unique constructor signature (adapter, channels, callback) and channel-checking logic.

#### Scenario: Scheduler extends BaseScheduler
- **WHEN** `ChannelLurkScheduler` is instantiated with adapter, channels, and callback
- **THEN** it SHALL be an instance of `BaseScheduler` and call `setCallback()` from the constructor

#### Scenario: Channel check logic preserved
- **WHEN** the scheduler executes
- **THEN** it SHALL iterate configured channels, check conditions (not self, not mentioned, not reacted, not processed), and invoke the callback for matching channels

### Requirement: Fixed-Interval Scheduling

The `ChannelLurkScheduler` SHALL check all configured channels at a fixed interval (default 30 minutes, configurable via `platforms.discord.channelLurk.intervalMs`).

#### Scenario: Default interval
- **GIVEN** no custom `intervalMs` is configured
- **WHEN** the scheduler starts
- **THEN** the check interval defaults to 1,800,000 ms (30 minutes)

#### Scenario: Custom interval via config
- **GIVEN** `platforms.discord.channelLurk.intervalMs` is set to `900000`
- **WHEN** the scheduler starts
- **THEN** the check interval is 900,000 ms (15 minutes)

#### Scenario: Reschedule after execution
- **GIVEN** the scheduler has completed checking all channels
- **WHEN** execution finishes (success or failure)
- **THEN** the next execution SHALL be scheduled at the same fixed interval

### Requirement: Trigger Conditions (All Must Be True)

The scheduler SHALL trigger a reply only when ALL of the following conditions are true for the last message in a channel. If any condition fails, the channel is silently skipped.

1. The last message sender is NOT the bot itself (`adapter.isSelf()`)
2. The last message does NOT mention the bot (`adapter.hasBotMention()`)
3. The bot has NOT reacted to the last message (`adapter.hasBotReaction()`)
4. The message has NOT been previously processed (`lastProcessedMessageId` tracking)

#### Scenario: All conditions met — triggers reply
- **GIVEN** a configured channel's last message is from a non-bot user
- **AND** the message does not mention the bot
- **AND** the bot has not reacted to the message
- **AND** the message has not been previously processed
- **WHEN** the channel lurk interval elapses
- **THEN** the callback is invoked with the channel target and last message

#### Scenario: Skip — last message from bot
- **GIVEN** the last message in a channel is from the bot itself
- **WHEN** the channel lurk check runs
- **THEN** no reply is triggered for that channel

#### Scenario: Skip — bot is mentioned
- **GIVEN** the last message mentions the bot
- **WHEN** the channel lurk check runs
- **THEN** no reply is triggered (the mention would have already triggered a normal reply)

#### Scenario: Skip — bot already reacted
- **GIVEN** the bot has already reacted to the last message
- **WHEN** the channel lurk check runs
- **THEN** no reply is triggered

#### Scenario: Skip — message already processed
- **GIVEN** the `lastProcessedMessageId` for a channel matches the current last message ID
- **WHEN** the channel lurk check runs
- **THEN** no reply is triggered for that channel

#### Scenario: Skip — no messages in channel
- **GIVEN** `fetchRecentMessages(channelId, 1)` returns an empty array
- **WHEN** the channel lurk check runs
- **THEN** the channel is silently skipped without error

### Requirement: lastProcessedMessageId Tracking

The scheduler SHALL maintain an in-memory `Map<string, string>` mapping channel IDs to the last processed message ID. When all conditions pass, the message ID is recorded before invoking the callback.

#### Scenario: Message ID recorded on successful trigger
- **GIVEN** all trigger conditions pass for channel "ch-123" with message "msg-456"
- **WHEN** the callback is about to be invoked
- **THEN** `lastProcessedMessageId.get("ch-123")` equals `"msg-456"`

### Requirement: Session Type

Channel lurk triggers SHALL use session type `"channelLurk"`. The session reuses the `system_reply.md` prompt template (same as normal message replies).

#### Scenario: Session type is channelLurk
- **GIVEN** a channel lurk trigger fires
- **WHEN** `SessionOrchestrator.processChannelLurkMessage()` is called
- **THEN** the session type is `"channelLurk"`
- **AND** the prompt template used is `system_reply.md`

### Requirement: Per-Channel Configuration

Channel lurk targets SHALL be determined by the `channels` list entries that have `channelLurk: true`. Only Discord channel entries (`discord/channel/{id}`) are eligible.

#### Scenario: Channel with channelLurk enabled
- **GIVEN** `channels` contains `{ id: "discord/channel/123", enabled: true, channelLurk: true }`
- **WHEN** the scheduler initializes
- **THEN** channel "123" is included in the lurk check list

#### Scenario: Channel without channelLurk flag
- **GIVEN** `channels` contains `{ id: "discord/channel/456", enabled: true }` (no `channelLurk`)
- **WHEN** the scheduler initializes
- **THEN** channel "456" is NOT included in the lurk check list

### Requirement: Error Isolation

Errors during individual channel checks SHALL be caught and logged. Other channels SHALL continue to be checked normally.

#### Scenario: One channel fails, others continue
- **GIVEN** three channels are configured for lurk
- **AND** the API call for channel B throws an error
- **WHEN** the scheduler executes
- **THEN** channels A and C are still checked
- **AND** the error for channel B is logged

### Requirement: Concurrent Execution Guard

The scheduler SHALL skip execution if a previous execution is still running, and schedule the next check.

#### Scenario: Overlapping execution
- **GIVEN** a channel lurk execution is in progress (`running === true`)
- **WHEN** the timer fires again
- **THEN** the execution is skipped with an info log
- **AND** the next timer is scheduled

### Requirement: Lifecycle Management

The scheduler SHALL support `start()` and `stop()` methods. When disabled in configuration, `start()` SHALL return immediately without scheduling.

#### Scenario: Disabled in configuration
- **GIVEN** `platforms.discord.channelLurk.enabled` is `false`
- **WHEN** `start()` is called
- **THEN** no timer is created and no channels are checked

#### Scenario: No channels configured
- **GIVEN** channel lurk is enabled but no Discord channels have `channelLurk: true`
- **WHEN** the application starts
- **THEN** an info message is logged and no scheduler starts

#### Scenario: Graceful stop
- **GIVEN** the scheduler is running
- **WHEN** `stop()` is called
- **THEN** the timer is cleared and no further executions occur

### Requirement: Environment Variable Overrides

The following environment variables SHALL override the corresponding config values:

| Environment Variable               | Config Path                                |
| ---------------------------------- | ------------------------------------------ |
| `DISCORD_CHANNEL_LURK_ENABLED`     | `platforms.discord.channelLurk.enabled`     |
| `DISCORD_CHANNEL_LURK_INTERVAL_MS` | `platforms.discord.channelLurk.intervalMs`  |

#### Scenario: Override via environment
- **GIVEN** `DISCORD_CHANNEL_LURK_ENABLED=true` and `DISCORD_CHANNEL_LURK_INTERVAL_MS=60000`
- **WHEN** the configuration is loaded
- **THEN** channel lurk is enabled with a 60-second interval

### Requirement: Differences from Spontaneous Posting

The channel lurk feature SHALL differ from spontaneous posting in the following ways:

| Aspect           | Spontaneous Post        | Channel Lurk Reply               |
| ---------------- | ----------------------- | -------------------------------- |
| Interval         | Random (min–max range)  | Fixed interval                   |
| Trigger          | Unconditional           | All 4 conditions must pass       |
| Target selection | Random from whitelist   | All whitelisted channels checked |
| Trigger message  | None (self-initiated)   | Last message in channel          |
| Session type     | `spontaneous`           | `channelLurk`                    |
| Prompt template  | `system_spontaneous.md` | `system_reply.md`                |
| Platform support | Discord + Misskey       | Discord only                     |

#### Scenario: Channel lurk uses fixed interval and reuses reply prompt
- **GIVEN** both spontaneous posting and channel lurk are enabled
- **WHEN** each feature triggers a session
- **THEN** spontaneous posting SHALL use a random interval and `system_spontaneous.md`
- **AND** channel lurk SHALL use a fixed interval and `system_reply.md`

### Requirement: State Persistence

The scheduler SHALL persist its next scheduled time via `SchedulerStateStore`. On restart, a restored schedule time is honored via `resolveScheduleTime()`, executing immediately if the time has already passed.

#### Scenario: Restored schedule time in the past
- **GIVEN** the persisted `channelLurk` schedule time has already elapsed
- **WHEN** the scheduler starts with restored state
- **THEN** execution runs immediately
