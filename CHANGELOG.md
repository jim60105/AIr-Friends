# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.6.0] - 2026-02-11

### Added

- Added: Platform emoji support and react-message skill — the Agent can now use custom emojis in replies and add reactions to messages.
  - New `PlatformEmoji` and `ReactionResult` types, `fetchEmojis()` and `addReaction()` on `PlatformAdapter`.
  - Discord implementation fetches both guild and application-level custom emojis (5-minute cache).
  - Misskey implementation fetches custom emojis via public `/emojis` API (5-minute cache).
  - New `react-message` skill with `ReactionHandler`, shell script, and `SKILL.md`.
  - Emoji list included in context assembly with category grouping and token-aware truncation.
  - Retry logic updated: Agent can react without sending a text reply and still be considered a valid response.
- Added: Spontaneous posting feature — the bot can autonomously post messages/notes on a configurable random schedule without user triggers.
  - New `SpontaneousPostConfig` type with `enabled`, `minIntervalMs`, `maxIntervalMs`, and `contextFetchProbability` fields.
  - New `SpontaneousScheduler` class manages per-platform independent timers with random intervals.
  - New `assembleSpontaneousContext()` and `formatSpontaneousContext()` methods in `ContextAssembler` for triggerless context assembly.
  - New `determineSpontaneousTarget()` function: Discord selects from whitelist entries; Misskey posts to `timeline:self`.
  - Discord adapter: new `getDmChannelId()` method for creating DM channels with whitelisted accounts.
  - Misskey adapter: new `timeline:self` channel type for bot's own timeline.
  - `PlatformAdapter` base class: new abstract `getBotId()` method.
  - Environment variable overrides: `DISCORD_SPONTANEOUS_ENABLED`, `DISCORD_SPONTANEOUS_MIN_INTERVAL_MS`, `DISCORD_SPONTANEOUS_MAX_INTERVAL_MS`, `DISCORD_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY` (and Misskey equivalents).
  - Config validation: auto-swaps reversed min/max intervals, clamps minIntervalMs ≥ 60s, clamps contextFetchProbability to [0, 1].
- Added: Auto-retry when agent completes without sending reply — the system automatically sends a second prompt on the same ACP session to request the agent to send a reply.
  - New `RetryPromptStrategy` interface with per-agent-type configuration via `getRetryPromptStrategy()`.
  - All three agent types (copilot, opencode, gemini) support retry with `maxRetries` of 1.
- Added: GELF (Graylog Extended Log Format) log output support for centralized log management.
  - New `GelfConfig` type with `enabled`, `endpoint`, and `hostname` fields.
  - New `GelfTransport` module with fire-and-forget HTTP POST.
  - Environment variable overrides: `GELF_ENABLED`, `GELF_ENDPOINT`, `GELF_HOSTNAME`.
  - GELF transport integrated into Logger class and initialized in bootstrap flow.
- Added: Misskey bot account filtering to prevent multi-instance infinite loops.
  - `shouldRespondToNote()` and `shouldRespondToChatMessage()` check `user.isBot` / `fromUser?.isBot`.
  - Bot messages in recent history correctly marked as `[Bot]` in conversation context.
- Added: Misskey full reply chain fetching including ancestors in note conversations.
  - Ancestor traversal via replyId chain walking with `fetchAncestorsWithFallback()`.
  - Fault-tolerant replies fetch with fallback chain (`notes/children` → `notes/replies` → empty array).
- Added: Helm chart for Kubernetes deployment.
- Added: Modularized app core and unified prompts architecture.

### Changed

- Changed: Conversation budget is now allocated before emojis in token budget, ensuring adequate context for conversation history.
- Changed: Emoji section uses XML tags (`<e>`, `<t>`, `<r>`, `<a>`) for better prompt engineering clarity.
- Changed: Maximum custom emoji count tightened to reduce token usage; entire emoji section omitted when no emojis are available.
- Changed: Removed Misskey emoji alias support from cache.
- Changed: Compose file now declares a named `data` volume.
- Changed: `HEALTHCHECK` directive removed from Containerfile (not supported for OCI image format).
- Changed: Default workspace data uses volume mount; host prompts mounting disabled by default.

### Fixed

- Fixed: Conversation context receiving too few messages when emoji section consumed most of the token budget.
- Fixed: Container permission issues — pre-create `/home/deno/.local` directory and fix PVC write permissions in Helm chart.

## [0.5.0] - 2026-02-09

### Changed

- Changed: Rebranded the project from "ai-friend" to "AIr-Friends" across documentation, CI/CD pipelines, container labels, compose services, and package names (including `deno.json`). This updates runtime image names and repository references to the new branding.

### Added

- Added: Documentation preview images and updated the README preview image.
- Added: Consolidated registry links in release notes for GitHub Container Registry, Docker Hub, and Quay.

## [0.4.0] - 2026-02-09

### Added

- Added: Access Control & Reply Policy configuration support (`accessControl`) with `ReplyPolicy` type (`all` | `public` | `whitelist`), whitelist entries, and environment overrides `REPLY_TO` and `WHITELIST`.
- Added: `ReplyPolicyEvaluator` and centralized reply filtering integrated into `AgentCore` to enforce access-control before message handling and agent execution.
- Added: Configuration loading, validation, and comprehensive unit tests for access-control behavior and whitelist parsing.

### Changed

- Changed: Default `accessControl.replyTo` is `whitelist` with an empty `whitelist` (secure default requiring explicit configuration to enable replies).
- Changed: `WHITELIST` environment variable is parsed as a comma-separated list and fully replaces the YAML whitelist when provided.

### Security

- Security: Improved whitelist entry validation pattern to more strictly validate platform and entry types.

## [0.3.0] - 2026-02-09

### Added

- Added: Integrate HealthCheckServer and Skill API server startup in bootstrap. The system now initializes and stops the HealthCheckServer when `config.health.enabled` is true, and exposes the Skill API server instance via `AgentCore.getSkillAPIServer()` for orchestration and tests.
- Added: Default to OpenCode agent and streamline agent configuration. Switched default ACP agent type to `opencode` in examples, clarified environment flags, improved Copilot/Gemini/OpenCode execution flags, and updated README and tests to reflect the simplified agent-factory configuration.

## [0.2.0] - 2026-02-08

### Added

- Discord slash commands cleanup on connection for clean command state
- `/clear` command for context reset within channels (useful for DMs where channel switching is impractical)
- OpenCode CLI as third supported ACP agent alongside Copilot and Gemini
  - Supports multiple providers (GitHub, Gemini, OpenRouter) via configuration
  - OPENCODE_YOLO environment variable for permission auto-approval
  - Optional OPENCODE_API_KEY for authentication
- OpenRouter provider support with deepseek-v3.2 model integration
- Environment variable overrides for platform configuration
  - DISCORD_ENABLED and MISSKEY_ENABLED for toggling platforms
  - AGENT_DEFAULT_TYPE for selecting agent type
- Prompt template system with `{{placeholder}}` replacement
  - Fragment files in prompts/ directory (character_name.md, character_info.md, etc.)
  - Automatic template processing on bot startup
  - Container volume mount support at /app/prompts for custom prompts without rebuild
- Ripgrep binary included in container for enhanced memory search performance
- compose.yml for simplified container orchestration with Podman/Docker
- `--yolo` flag for auto-approving all agent permission requests
  - Enabled by default in container deployments
  - Useful for trusted/isolated environments
- Misskey chat message support via chat:{userId} channel type
  - Integration with chat/messages/user-timeline for fetching
  - Integration with chat/messages/create-to-user for sending
- Misskey reply threading with replyId for proper conversation context
- Misskey username format as @DisplayName (userId) for better identification
- .env.example file with comprehensive environment variable documentation
- data/.gitkeep to preserve data directory in version control

### Changed

- **Workspace structure from per-channel to per-user** (breaking change for existing workspaces)
  - Workspace key changed from `{platform}/{userId}/{channelId}` to `{platform}/{userId}`
  - Enables memory sharing across channels for the same user
- Memory visibility is now context-aware (auto-determined)
  - DM conversations: saves to private, searches both public and private
  - Public/guild conversations: saves to public, searches public only
  - Agent no longer has direct control over visibility parameter
- Both memory.public.jsonl and memory.private.jsonl now exist in every workspace
- Default workspace path from absolute `/data` to relative `./data`
- Container workspace volume from `/data` to `/app/data`
- Skills directory from `~/.copilot/skills` to `~/.agents/skills`
- Skill entrypoints moved into per-skill scripts/ subdirectories
- Configuration system relaxed to allow template placeholders without validation errors
- Expanded config.example.yaml with comprehensive examples and environment variable mappings
- Copilot CLI flags: added `--disable-builtin-mcps`, `--no-ask-user`, `--no-color`
- Yolo mode implementation for Copilot: uses `--allow-all-tools` and `--allow-all-urls` instead of `--yolo`
- Gemini agent execution: uses Deno task with experimental ACP flag for better dependency caching
- Default agent configuration: added defaultAgentType option (copilot/gemini/opencode)
- Default platform in example config from Discord to Misskey
- Upgraded ACP SDK from 0.13.1 to 0.14.1 for better protocol support

### Fixed

- Duplicate skill execution in API server (implemented request deduplication with 1-second TTL cache)
- Message truncation mid-content in context assembly
  - Implemented intelligent message removal instead of string truncation
  - Prioritizes recent messages and removes oldest complete messages when token budget exceeded
- Duplicate replies due to race condition (implemented atomic lock pattern)
- Invalid input error with OpenCode agent (added usage_update session notification handling)
- OpenCode command format (corrected from `--acp` flag to `acp` subcommand)
- Agent-factory tests after Copilot CLI flag changes

## [0.1.0] - 2026-02-05

### Added

- Shell-based Skills system with HTTP API server for external agent communication
  - Skills are now Deno TypeScript scripts executed by external agents
  - HTTP API server (localhost:3001) for skills to communicate with main bot
  - Session-based authentication and single-reply enforcement
  - Five available skills: memory-save, memory-search, memory-patch, fetch-context, send-reply
- Integration testing infrastructure with comprehensive test coverage
  - Test fixtures, mocks, and helpers for consistent testing
  - 174 total tests passing with organized test structure
  - 88.2% code coverage across core components
- CI/CD workflows with multi-registry Docker publishing
  - Parallel CI jobs (check, test, coverage, build) with dependency caching
  - Multi-platform Docker builds (linux/amd64, linux/arm64)
  - Publishing to Docker Hub, GitHub Container Registry, and Quay.io
  - Build attestations and SBOM generation
  - CodeQL security scanning
- Container deployment support with Containerfile
  - Multi-stage build with Deno Alpine base image
  - Non-root user (UID 1000) with OpenShift-compatible permissions
  - Health check endpoint with curl binary
  - Volume mount for persistent data (/data)
  - Proper signal handling with dumb-init
- Main application entry point with bootstrap and orchestration
  - Bootstrap module for component initialization
  - Graceful shutdown handler for SIGTERM/SIGINT
  - Health check server with /health, /healthz, /ready, /readyz endpoints
  - CLI argument support (--config, --help)
  - Configuration loading from YAML with environment variable overrides
- Agent Core coordination layer
  - SessionOrchestrator for message processing pipeline
  - MessageHandler for event routing and duplicate prevention
  - ReplyDispatcher for error message fallback
  - AgentCore as main integration entry point
- ACP Client SDK integration
  - ChatbotClient implementing ACP Client interface
  - AgentConnector for subprocess lifecycle management
  - Support for GitHub Copilot CLI and Gemini CLI as external reasoning agents
  - Workspace-isolated file operations with security validation
- Agent Skills definitions following Agent Skills Standard
  - memory-save: Append-only persistence with visibility and importance
  - memory-search: Keyword-based memory retrieval
  - memory-patch: Metadata updates (content immutable)
  - send-reply: Platform reply with single-reply enforcement
  - fetch-context: Platform context retrieval (recent messages, search, user info)
  - Comprehensive SKILL.md files for agent discovery
- Misskey platform adapter
  - WebSocket streaming for real-time mention and DM events
  - Exponential backoff reconnection
  - Visibility-aware replies (preserves public/home/followers/specified)
  - Federation support (@user@instance.com mentions)
  - 3000 character message truncation
- Discord platform adapter
  - discord.js v14 integration with Gateway connection
  - Message filtering by guild whitelist, bot mentions, command prefix, DM permissions
  - Automatic content truncation at Discord's 2000-char limit
  - Message history and keyword-based search support
- Platform abstraction layer
  - PlatformAdapter base class with unified interface
  - ConnectionManager with automatic reconnection and exponential backoff
  - PlatformRegistry for managing multiple platform adapters
  - EventRouter for condition-based event routing
- Context assembly module
  - Assembles memories, channel history, and system prompts into LLM-ready format
  - CJK-aware token estimation
  - Token-aware truncation to fit model limits
  - Structured context with important memories + recent 20 messages
- Memory Store with append-only JSONL persistence
  - Public and private memory files per workspace
  - Patch-based updates for enabled/visibility/importance fields
  - Ripgrep-first search with built-in fallback
  - DM privacy enforcement (private memories only in DM workspaces)
- Workspace Manager with trust boundary enforcement
  - Workspace isolation based on {platform}/{user_id}/{channel_id} keys
  - Path traversal protection with boundary validation
  - Automatic workspace directory creation
  - Memory file initialization (public always, private DM-only)
- Type definitions and configuration system
  - Complete TypeScript type hierarchy for events, config, memory, platform
  - YAML configuration loader with environment variable overrides
  - Multi-environment config support (config.yaml, config.{env}.yaml)
  - Configuration validation with required field checks
- Structured logging and error handling
  - JSON Lines format with ISO 8601 timestamps
  - Automatic sensitive data redaction (token/password/secret patterns)
  - Hierarchical error classes with retryability metadata
  - Global error handlers with graceful shutdown
- Deno project foundation
  - Project structure with src/, tests/, config/, prompts/ directories
  - Path aliases (@core/, @platforms/, @skills/, @types/, @utils/)
  - Deno tasks for dev, start, test, fmt, lint, check
  - Strict TypeScript configuration

### Fixed

- Session validation errors in send-reply skill
  - Switch Containerfile base image from Alpine to Debian for bash support
  - Inherit critical environment variables (PATH, HOME, DENO_DIR) in agent subprocess
  - Add detailed error logging for debugging tool call failures
- ACP implementation to match GitHub's official best practices
  - Correct stream variable semantics (input/output naming)
  - Add disconnect timeout with graceful degradation
- Diagnostics with richer stderr and failure logging
  - Capture agent subprocess stderr and stream to logger
  - Improve tool call update logging with failure details
  - Include session ID in prompt for direct agent access
  - Auto-approve skill shell execution
- Various lint and type errors throughout codebase
  - Fix no-case-declarations errors by wrapping case blocks
  - Fix no-explicit-any errors by using proper types
  - Fix TypeScript 5.9+ import issues with @types/ alias

### Changed

- Switch default agent model from gpt-4 to gpt-5-mini
- Refactor Skills from ACP callback mode to shell execution mode
  - External agents now execute Deno scripts instead of using ACP callbacks
  - Skills communicate via HTTP API instead of direct function calls
  - Improved security with localhost-only API binding

---

[Unreleased]: https://github.com/jim60105/AIr-Friends/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/jim60105/AIr-Friends/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/jim60105/AIr-Friends/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/jim60105/AIr-Friends/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jim60105/AIr-Friends/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jim60105/AIr-Friends/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jim60105/AIr-Friends/releases/tag/v0.1.0
