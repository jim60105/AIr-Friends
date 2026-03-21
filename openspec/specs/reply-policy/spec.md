# Reply Policy & Access Control

## Purpose

Defines the reply policy evaluation system that controls which messages the bot responds to, the channel/account configuration model, and the rate limiting mechanism that prevents excessive API usage per user.

## Requirements

### Requirement: Reply Policy Modes

The system SHALL support three reply policy modes configured via the `replyPolicy` field in `config.yaml` or the `REPLY_POLICY` environment variable (with `REPLY_TO` accepted as an alias).

#### Scenario: Policy mode "all"
- **GIVEN** `replyPolicy` is set to `"all"`
- **WHEN** any message is received (public or DM)
- **THEN** `shouldReply()` SHALL return `true`

#### Scenario: Policy mode "public"
- **GIVEN** `replyPolicy` is set to `"public"`
- **WHEN** a message is received in a public channel
- **THEN** `shouldReply()` SHALL return `true`

#### Scenario: Policy mode "public" with DM
- **GIVEN** `replyPolicy` is set to `"public"`
- **WHEN** a DM is received from a user
- **THEN** `shouldReply()` SHALL return `true` only if the user's account or channel is in the `channels` list with `enabled` not set to `false`

#### Scenario: Policy mode "channels" (default)
- **GIVEN** `replyPolicy` is set to `"channels"` (the default)
- **WHEN** a message is received
- **THEN** `shouldReply()` SHALL return `true` only if the user's account or channel matches an entry in the `channels` list with `enabled` not set to `false`

#### Scenario: Default with empty channels
- **GIVEN** `replyPolicy` is `"channels"` and `channels` is empty
- **WHEN** any message is received
- **THEN** `shouldReply()` SHALL return `false` for all messages

---

### Requirement: Channel ID Format

Channel configuration entries SHALL use the format `{platform}/account/{id}` for user-scoped rules or `{platform}/channel/{id}` for channel-scoped rules.

#### Scenario: Account-level matching
- **GIVEN** a channel entry `"discord/account/123456"`
- **WHEN** a message is received from Discord user ID `123456`
- **THEN** the entry SHALL match regardless of which channel the message was sent in

#### Scenario: Channel-level matching
- **GIVEN** a channel entry `"discord/channel/789012"`
- **WHEN** a message is received in Discord channel ID `789012`
- **THEN** the entry SHALL match regardless of which user sent the message

#### Scenario: Invalid channel ID format
- **GIVEN** a channel entry with an invalid format (not matching `{platform}/{type}/{value}`)
- **WHEN** `parseChannelId()` processes the entry
- **THEN** it SHALL return `null` and the entry SHALL be skipped with a warning

#### Scenario: Discord Snowflake ID validation
- **GIVEN** a channel entry with platform `"discord"`
- **WHEN** the ID portion is validated against `DISCORD_WHITELIST_PATTERN`
- **THEN** the ID MUST be a 17-to-20-digit numeric string (Discord Snowflake format, matching `/^discord\/(account|channel)\/\d{17,20}$/`)
- **AND** entries with IDs shorter than 17 digits or containing non-numeric characters SHALL be rejected with a warning log and excluded from the loaded channels list

#### Scenario: Misskey timeline special format
- **GIVEN** a channel entry `"misskey/timeline/self"`
- **WHEN** parsed by `parseChannelId()`
- **THEN** it SHALL be recognized as a valid entry with platform `"misskey"`, type `"timeline"`, value `"self"`

---

### Requirement: Channel Configuration Fields

Each channel configuration entry SHALL support the following optional fields with their defaults.

#### Scenario: Channel config defaults
- **GIVEN** a channel entry with only `id` specified
- **WHEN** the entry is evaluated
- **THEN** it SHALL default to `enabled: true`, `spontaneousPost: false`, `channelLurk: false`, `rateLimitBypass: false`, `yolo: false`

#### Scenario: Disabled channel
- **GIVEN** a channel entry with `enabled: false`
- **WHEN** reply policy evaluates the entry
- **THEN** it SHALL NOT match the entry for any evaluation

---

### Requirement: YOLO Mode Resolution

The system SHALL resolve YOLO mode decisions from channel configuration, providing the source of the decision.

#### Scenario: Account-level YOLO
- **GIVEN** a channel entry `"{platform}/account/{userId}"` with `yolo: true`
- **WHEN** `resolveYoloDecision()` is called for that user
- **THEN** it SHALL return `{ enabled: true, source: "account_config", matchedConfigId: "{entry_id}" }`

#### Scenario: Channel-level YOLO
- **GIVEN** a channel entry `"{platform}/channel/{channelId}"` with `yolo: true`
- **WHEN** `resolveYoloDecision()` is called for that channel
- **THEN** it SHALL return `{ enabled: true, source: "channel_config", matchedConfigId: "{entry_id}" }`

#### Scenario: No YOLO configured
- **GIVEN** no channel entries with `yolo: true` match the current context
- **WHEN** `resolveYoloDecision()` is called
- **THEN** it SHALL return `{ enabled: false, source: "none" }`

#### Scenario: First match wins
- **GIVEN** multiple channel entries matching the same context with different YOLO settings
- **WHEN** `resolveYoloDecision()` is called
- **THEN** the first matching entry SHALL determine the result

---

### Requirement: Processing Order

The system SHALL process incoming messages in a specific order: platform-level filters first, then reply policy evaluation, then message handling.

#### Scenario: Platform filter before policy
- **GIVEN** a message from a bot account on Discord
- **WHEN** the message is received
- **THEN** the platform adapter's `shouldRespondToMessage()` SHALL reject it before reply policy is evaluated

#### Scenario: Reply policy before message handling
- **GIVEN** a message that passes platform filters
- **WHEN** `shouldReply()` returns `false`
- **THEN** the message handler SHALL NOT be invoked

---

### Requirement: Cross-Platform Isolation

Channel configuration entries SHALL only match events from the same platform.

#### Scenario: Discord entry with Misskey event
- **GIVEN** a channel entry `"discord/account/123"`
- **WHEN** a Misskey event is evaluated
- **THEN** the entry SHALL NOT match

#### Scenario: Platform prefix filtering
- **GIVEN** channels list with entries for both `"discord/"` and `"misskey/"` prefixes
- **WHEN** `getEnabledChannels()` filters by platform
- **THEN** it SHALL only return entries whose ID starts with the requested platform prefix

---

### Requirement: Environment Variable Overrides

Reply policy configuration SHALL be overridable via environment variables.

#### Scenario: REPLY_POLICY override
- **GIVEN** `REPLY_POLICY` environment variable is set to `"public"`
- **WHEN** configuration is loaded
- **THEN** the `replyPolicy` SHALL be `"public"` regardless of the config file value

#### Scenario: REPLY_TO alias
- **GIVEN** `REPLY_TO` environment variable is set (legacy alias)
- **WHEN** configuration is loaded and `REPLY_POLICY` is not set
- **THEN** it SHALL accept `REPLY_TO` as an alias for `REPLY_POLICY`

#### Scenario: CHANNELS override
- **GIVEN** `CHANNELS` environment variable is set to a JSON array string
- **WHEN** configuration is loaded
- **THEN** the `channels` list SHALL be fully replaced with the parsed JSON value

---

### Requirement: Rate Limiting — Sliding Window with Cooldown

The system SHALL implement per-user rate limiting using a sliding window mechanism with a cooldown period after the limit is exceeded.

#### Scenario: Rate limiting disabled
- **GIVEN** `rateLimit.enabled` is `false`
- **WHEN** `isAllowed()` is called
- **THEN** it SHALL always return `true`

#### Scenario: Within rate limit
- **GIVEN** a user with fewer than `maxRequestsPerWindow` requests in the current window
- **WHEN** `isAllowed()` is called with the user's key
- **THEN** it SHALL return `true` and record the timestamp

#### Scenario: Exceeding rate limit
- **GIVEN** a user reaching `maxRequestsPerWindow` requests within `windowMs`
- **WHEN** the next `isAllowed()` check occurs
- **THEN** it SHALL enter cooldown state, return `false`, and increment the `rateLimitRejectionsTotal` metric

#### Scenario: During cooldown
- **GIVEN** a user in cooldown state
- **WHEN** `isAllowed()` is called before `cooldownMs` expires
- **THEN** it SHALL return `false` (silent rejection — no reply, no session started)

#### Scenario: Cooldown expiry
- **GIVEN** a user whose cooldown period has expired
- **WHEN** `isAllowed()` is called
- **THEN** it SHALL clear the cooldown state, reset timestamps, and return `true`

### Requirement: Rate Limiting — Per-User Tracking

The system SHALL track rate limits independently per user using a `{platform}:{userId}` key.

#### Scenario: Independent user tracking
- **GIVEN** two different users on the same platform
- **WHEN** one user exceeds the rate limit
- **THEN** the other user SHALL NOT be affected

#### Scenario: Remaining requests query
- **GIVEN** a user with some requests consumed
- **WHEN** `getRemainingRequests()` is called
- **THEN** it SHALL return `maxRequestsPerWindow` minus the count of timestamps within the current window, or `0` if in cooldown

### Requirement: Rate Limit Bypass — Channel Configuration Whitelist

Channel entries (account-level or channel-level) with `rateLimitBypass: true` SHALL bypass rate limiting entirely.

#### Scenario: Account-level bypass
- **GIVEN** a channel entry `"{platform}/account/{userId}"` with `rateLimitBypass: true`
- **WHEN** `isRateLimitBypassed()` is called for that platform and userId
- **THEN** it SHALL return `true`

#### Scenario: Channel-level bypass
- **GIVEN** a channel entry `"{platform}/channel/{channelId}"` with `rateLimitBypass: true`
- **WHEN** `isRateLimitBypassed()` is called for that platform and channelId
- **THEN** it SHALL return `true` for all users in that channel

### Requirement: Rate Limit Timing

Rate limit checks SHALL run after duplicate event detection and before any resource allocation (session creation, agent spawning).

#### Scenario: Check ordering
- **GIVEN** a duplicate event followed by a unique event from a rate-limited user
- **WHEN** messages are processed
- **THEN** the duplicate SHALL be rejected by dedup first, and the unique event SHALL be rejected by rate limiting before any session resources are allocated

### Requirement: Rate Limit Memory Cleanup

The system SHALL clean up stale rate limit entries to prevent memory leaks.

#### Scenario: Stale entry cleanup
- **GIVEN** a user with expired cooldown and no recent activity
- **WHEN** `cleanup()` is called
- **THEN** it SHALL remove the user's tracking entry from memory

### Requirement: Rate Limit Configuration

Rate limit settings SHALL be configurable via `config.yaml` and environment variable overrides.

#### Scenario: Default configuration
- **GIVEN** no explicit rate limit configuration
- **WHEN** defaults are applied
- **THEN** `windowMs` SHALL default to `600000` (10 minutes) and `cooldownMs` SHALL default to `600000` (10 minutes)

#### Scenario: Environment variable overrides
- **GIVEN** `RATE_LIMIT_ENABLED`, `RATE_LIMIT_MAX_REQUESTS_PER_WINDOW`, `RATE_LIMIT_WINDOW_MS`, or `RATE_LIMIT_COOLDOWN_MS` env vars
- **WHEN** configuration is loaded
- **THEN** they SHALL override the corresponding `rateLimit.*` config values
