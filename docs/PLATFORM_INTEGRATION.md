# Platform Integration Guide

This guide explains how to add a new platform to AIr-Friends. It covers everything from creating the adapter to configuration, testing, and registration.

## 1. Overview

AIr-Friends uses a platform adapter architecture where each supported platform (Discord, Misskey, etc.) implements the abstract `PlatformAdapter` class (`src/platforms/platform-adapter.ts`). The adapter is responsible for:

- Connecting to and disconnecting from the platform API
- Converting platform-specific messages into `NormalizedEvent` / `PlatformMessage` formats
- Sending replies, reactions, and typing indicators
- Fetching message history and custom emojis
- Determining targets for spontaneous posts

For the overall architecture, see the diagram in [`AGENTS.md`](../AGENTS.md).

## 2. Prerequisites

- **Deno 2.x** development environment
- Basic understanding of the target platform's API/SDK
- Familiarity with TypeScript and `async`/`await`

## 3. Step-by-Step Guide

Throughout this guide, replace `{platform}` with the lowercase platform name (e.g., `slack`) and `{Platform}` with the PascalCase name (e.g., `Slack`).

### 3.1 Create the Platform Directory Structure

Create the following files under `src/platforms/{platform}/`:

| File | Purpose |
|---|---|
| `{platform}-adapter.ts` | Main adapter extending `PlatformAdapter` |
| `{platform}-config.ts` | Configuration types, defaults, and channel config pattern |
| `{platform}-utils.ts` | Message conversion helpers |
| `{platform}-client.ts` | Platform API client wrapper (if needed) |
| `index.ts` | Barrel export |

Reference implementations: [`src/platforms/discord/`](../src/platforms/discord/), [`src/platforms/misskey/`](../src/platforms/misskey/).

### 3.2 Implement PlatformAdapter Abstract Methods

Your adapter must extend `PlatformAdapter` (which also implements `MessageFetcher`).

#### Abstract Properties

| Property | Type | Description |
|---|---|---|
| `platform` | `Platform` | Platform identifier string (e.g., `"slack"`) |
| `capabilities` | `PlatformCapabilities` | Feature flags for the platform |

`PlatformCapabilities` fields (from `src/types/platform.ts`):

```typescript
interface PlatformCapabilities {
  canFetchHistory: boolean;   // Can fetch message history
  canSearchMessages: boolean; // Can search messages
  supportsDm: boolean;        // Supports direct messages
  supportsGuild: boolean;     // Supports guild/server concept
  supportsReactions: boolean; // Supports message reactions
  maxMessageLength: number;   // Maximum message length
}
```

#### Abstract Methods

| Method | Signature | Purpose | Notes |
|---|---|---|---|
| `connect()` | `(): Promise<void>` | Connect to the platform API | Update connection state via `updateConnectionState()` |
| `disconnect()` | `(): Promise<void>` | Disconnect from the platform | Clean up resources |
| `sendTyping(channelId)` | `(channelId: string): Promise<void>` | Send typing indicator | Implement as no-op if unsupported |
| `sendReply(channelId, content, options?)` | See source | Send a reply to a channel | Returns `ReplyResult` with `messageId` |
| `editMessage(channelId, messageId, newContent, replyToMessageId?)` | See source | Edit a previously sent message | Misskey uses delete-and-recreate |
| `sendFile(channelId, fileContent, fileName, options?)` | See source | Send a file attachment | Returns `SendFileResult` |
| `fetchRecentMessages(channelId, limit)` | `(channelId: string, limit: number): Promise<PlatformMessage[]>` | Fetch recent channel messages | Part of `MessageFetcher` interface |
| `fetchEmojis()` | `(): Promise<PlatformEmoji[]>` | Fetch available custom emojis | Cache results to reduce API calls |
| `addReaction(channelId, messageId, emoji)` | See source | Add a reaction to a message | Returns `ReactionResult` |
| `getUsername(userId)` | `(userId: string): Promise<string>` | Get display name for a user ID | — |
| `isSelf(userId)` | `(userId: string): boolean` | Check if user ID is the bot | — |
| `getBotId()` | `(): string \| null` | Get the bot's user ID | `null` if not yet connected |
| `getDmChannelId(userId)` | `(userId: string): Promise<string \| null>` | Get or create a DM channel | Discord: `User.createDM()`, Misskey: `chat:{userId}` |
| `hasBotReaction(channelId, messageId)` | See source | Check if bot already reacted | Used by channel lurk scheduler |
| `hasBotMention(channelId, messageId)` | See source | Check if message mentions bot | Used by channel lurk scheduler |
| `determineSpontaneousTarget(config)` | `(config: Config): Promise<SpontaneousTarget \| null>` | Select target for spontaneous post | Discord: random channel/account from `channels` list; Misskey: `timeline:self` |

#### Overridable Methods (with defaults)

| Method | Default | Override When |
|---|---|---|
| `getSearchGuildId(channelId, isDm)` | Returns `""` | Platform has guild/server concept (e.g., Discord returns guild ID) |
| `supportsTypingIndicator()` | Returns `false` | Platform supports and has enabled typing indicators |
| `searchRelatedMessages(guildId, channelId, query, limit)` | Not defined (optional) | Platform supports message search |

### 3.3 Define Platform Configuration Types

**Modify `src/types/config.ts`:**

1. Add a `{Platform}AdapterConfig` interface (reference `DiscordAdapterConfig` or `MisskeyAdapterConfig`).
2. Add the corresponding field in `PlatformsConfig`:

```typescript
export interface PlatformsConfig {
  discord: DiscordAdapterConfig;
  misskey: MisskeyAdapterConfig;
  {platform}: {Platform}AdapterConfig; // Add this
}
```

**Create `src/platforms/{platform}/{platform}-config.ts`:**

- Define default config values (`DEFAULT_{PLATFORM}_CONFIG`)
- Define the channel config validation pattern:

```typescript
// Format: {platform}/(account|channel)/{id}
export const {PLATFORM}_CHANNEL_PATTERN = /^{platform}\/(account|channel)\/[a-zA-Z0-9_\-]+$/;
```

### 3.4 Add Environment Variable Mappings

**Modify `src/utils/env.ts`:**

Add entries to the environment-to-config mapping (the file uses a plain object, not a named export — look for the existing Discord/Misskey entries near the top):

```typescript
{PLATFORM}_TOKEN: "platforms.{platform}.token",
{PLATFORM}_ENABLED: "platforms.{platform}.enabled",
// If supporting spontaneous posts:
{PLATFORM}_SPONTANEOUS_ENABLED: "platforms.{platform}.spontaneousPost.enabled",
{PLATFORM}_SPONTANEOUS_MIN_INTERVAL_MS: "platforms.{platform}.spontaneousPost.minIntervalMs",
{PLATFORM}_SPONTANEOUS_MAX_INTERVAL_MS: "platforms.{platform}.spontaneousPost.maxIntervalMs",
{PLATFORM}_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY: "platforms.{platform}.spontaneousPost.contextFetchProbability",
```

**Update `.env.example`:** Add example environment variables.

**Update `helm/values.yaml`:** Add entries in the `env:` section.

### 3.5 Update Platform Validation

These changes must be kept in sync:

#### `src/types/events.ts`

Add the platform name to the `Platform` type union and the `VALID_PLATFORMS` array:

```typescript
export type Platform = "discord" | "misskey" | "{platform}";

export const VALID_PLATFORMS: readonly Platform[] = ["discord", "misskey", "{platform}"] as const;
```

> `isValidPlatform()` uses `VALID_PLATFORMS` internally and does **not** need modification.

#### `src/core/config-loader.ts`

1. Import the new whitelist pattern:

```typescript
import { {PLATFORM}_WHITELIST_PATTERN } from "../platforms/{platform}/{platform}-config.ts";
```

2. Add it to the `isValidWhitelistEntry()` function:

```typescript
function isValidChannelEntry(entry: string): boolean {
  return DISCORD_WHITELIST_PATTERN.test(entry)
    || MISSKEY_WHITELIST_PATTERN.test(entry)
    || {PLATFORM}_WHITELIST_PATTERN.test(entry);
}
```

> The `for (const platformName of VALID_PLATFORMS)` loop in config validation will automatically pick up the new platform for spontaneous post config validation.

### 3.6 Register the Adapter

**Modify `src/bootstrap.ts`:**

```typescript
import { {Platform}Adapter } from "@platforms/{platform}/index.ts";

// After existing adapter registrations:
if (config.platforms.{platform}.enabled) {
  logger.info("Registering {Platform} adapter");
  const {platform}Adapter = new {Platform}Adapter(config.platforms.{platform});
  platformRegistry.register({platform}Adapter);
  agentCore.registerPlatform({platform}Adapter);
}
```

### 3.7 Message Format Conversion

Convert platform-specific messages into `NormalizedEvent` (for incoming triggers) and `PlatformMessage` (for history). Key field mappings:

| Field | Type | Notes |
|---|---|---|
| `platform` | `Platform` | Your platform name constant |
| `channelId` | `string` | Use prefix conventions if needed (e.g., Misskey: `note:{id}`, `dm:{id}`, `chat:{id}`) |
| `userId` | `string` | Sender's platform user ID |
| `messageId` | `string` | Platform message ID |
| `isDm` | `boolean` | Whether this is a direct/private message |
| `guildId` | `string` | Server/guild ID; empty string if not applicable |
| `content` | `string` | Message text content |
| `timestamp` | `Date` | Must be a `Date` object |
| `attachments` | `Attachment[]` | Optional; set `isImage` flag based on MIME type |

Emit converted events via `this.emitEvent(normalizedEvent)` from within your adapter.

### 3.8 Spontaneous Post Support (Optional)

If the platform should support spontaneous posting:

1. Add `spontaneousPost` fields to the platform config interface.
2. Implement `determineSpontaneousTarget()` to select a channel/user to post to.
3. For channel lurk reply support (Discord-only feature), see `src/core/channel-lurk-scheduler.ts`.

## 4. Testing

- Place unit tests in `tests/platforms/{platform}/`.
- Utility functions (`{platform}-utils.ts`) can be tested directly without mocks.
- Adapter methods require mocking the underlying API client. Reference patterns:
  - `tests/platforms/discord/discord-adapter.test.ts` — `createMockDiscordAdapter()` and `mockClientRequest()`
  - `tests/platforms/misskey/misskey-adapter.test.ts`
- Global mock adapter: `tests/mocks/mock-platform-adapter.ts` — update if new abstract methods are added.
- Run tests with `deno task test`.

## 5. Checklist

- [ ] `src/platforms/{name}/` directory created with adapter, config, utils, and index files
- [ ] All `PlatformAdapter` abstract methods and properties implemented
- [ ] `PlatformCapabilities` correctly configured
- [ ] `src/types/config.ts` — `{Platform}Config` interface and `PlatformsConfig` field added
- [ ] `src/types/events.ts` — `Platform` type and `VALID_PLATFORMS` updated
- [ ] `src/platforms/{name}/{name}-config.ts` — `{PLATFORM}_WHITELIST_PATTERN` defined
- [ ] `src/core/config-loader.ts` — `isValidWhitelistEntry()` updated
- [ ] `src/utils/env.ts` — environment variable mappings added
- [ ] `src/bootstrap.ts` — conditional adapter registration added
- [ ] `config.example.yaml` — example configuration added
- [ ] `.env.example` — updated
- [ ] `helm/values.yaml` — updated
- [ ] `tests/platforms/{name}/` — unit tests created
- [ ] `tests/mocks/mock-platform-adapter.ts` — updated if new abstract methods exist
- [ ] `deno fmt --check src/ tests/` passes
- [ ] `deno lint src/ tests/` passes
- [ ] `deno check src/main.ts` passes
- [ ] `deno task test` passes

## 6. Reference

- [`src/platforms/platform-adapter.ts`](../src/platforms/platform-adapter.ts) — `PlatformAdapter` base class
- [`src/platforms/discord/`](../src/platforms/discord/) — Discord reference implementation
- [`src/platforms/misskey/`](../src/platforms/misskey/) — Misskey reference implementation
- [`src/types/events.ts`](../src/types/events.ts) — `Platform` type, `VALID_PLATFORMS`, `isValidPlatform()`
- [`src/types/platform.ts`](../src/types/platform.ts) — `PlatformCapabilities`, `ReplyResult`, etc.
- [`src/types/config.ts`](../src/types/config.ts) — Configuration type definitions
- [`src/core/config-loader.ts`](../src/core/config-loader.ts) — `isValidWhitelistEntry()`, config validation
- [`src/utils/env.ts`](../src/utils/env.ts) — Environment variable to config mappings
- [`src/bootstrap.ts`](../src/bootstrap.ts) — Adapter registration
- [`AGENTS.md`](../AGENTS.md) — Project architecture overview
