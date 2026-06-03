# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.25.0] - 2026-06-03

### Added

- Pioneer AI provider for OpenCode — new OpenAI-compatible endpoint with Claude and DeepSeek model definitions, and upgraded the OpenRouter DeepSeek model to the v4 Pro variant
- Helm chart ServiceAccount security hardening — token automounting is now disabled by default to reduce attack surface, with an opt-in `serviceAccount` values block supporting IRSA/Workload Identity annotations and pod-level `automountServiceAccountToken` enforcement

### Fixed

- Scheduler timer fields now typed with `ReturnType<typeof setTimeout/setInterval>` instead of `number`, resolving TS2322 type errors when Node types leak in via npm dependencies

## [0.24.0] - 2025-07-15

### Added

- Collapsible sidebar with CSS transition, expanded file viewer modal, file tree sort order toggle (alphabetical/time), and unique element IDs in web dashboard
- GIF-to-WebP image conversion for ACP agent prompts — animated GIF attachments are now converted to static WebP (first frame) via ImageMagick before sending to the agent

### Changed

- Consolidated session history Started/Ended/Duration into Time/Duration two-column layout with fixed table widths and proper text wrapping
- Redesigned web dashboard UI with modern dark theme and neon accents
- Memory saving prompt relaxed to store only key user information instead of mandatory on every reply
- Post-session summary structure simplified by removing action items

### Fixed

- Animated GIF images no longer cause silent agent crashes — filtered before WebP conversion was added
- Dashboard table overflow and colspan mismatch in session history
- OpenSpec spec validation failures in 4 specs (conversation-summaries, helm-dashboard-ingress, helm-dashboard-service, vscode-dark-theme)

## [0.23.0] - 2026-03-29

### Added

- Web dashboard for monitoring and agent chat — passphrase-based authentication, session monitor, read-only workspace file browser, interactive chat with ACP agent via SSE streaming, and graceful restart endpoint
- Dashboard security hardening (OWASP Top 10 review) — CSP headers, login rate limiting, session token expiration, HMAC-based timing-safe validation, DOMPurify for XSS prevention, workspace traversal depth/entry limits
- Markdown rendering with raw/rendered toggle in workspace file viewer
- Helm chart dashboard Service and Ingress templates for Kubernetes exposure
- Tiered memory management with channel scope and automatic conversation summaries — core/working/archive tiers, decay-weighted scoring, channel-scoped memory, category-based retrieval
- Redesigned audit logs with 8 new phases (trigger_received, session_start, rate_limit_checked, reply_edited, memory_operation, retry_triggered, agent_message, agent_complete_message) and session summary counters
- Dashboard session history loaded from audit log JSONL files at startup
- Alphabetical sorting with directories-first in workspace file tree
- OpenSpec specifications generated from codebase (22 capability specs, 240 requirements, 536 scenarios)

### Changed

- Refactored all 7 schedulers to use abstract BaseScheduler class, eliminating ~500 lines of duplicated code
- Extracted setupSession() and recordSessionMetrics() helpers in SessionOrchestrator
- SESSION_ID now passed as subprocess environment variable at spawn time instead of file-based approach
- Prompt templates refined for improved agent response workflow and tool usage guidance
- Lazy memory file creation — memory files deferred to first write instead of eager creation at workspace init
- Removed memory index (premature optimization) in favor of sequential file scan
- Removed session time-based expiry from skill API — sessions now only removed via explicit remove() at session end
- Dashboard theme changed to VSCode Dark+ colors
- Documentation aligned with OpenSpec specs and codebase; legacy BDD feature files removed

### Fixed

- Workspace manager now passed to SkillContext for channel memory operations
- Agent subprocess SESSION_ID inheritance fixed by passing through createAgentConfig()
- Dashboard: fixed session ID truncation, Started/Ended field names, audit session ID validation (underscores), ERR_TOO_MANY_REDIRECTS on login, auth.js load order, SSE event name mismatch, workspace tree folding, file content scrollability, file path normalization, chat message field name, model dropdown population
- Workspace file tree clipped by max-height limit resolved
- Helm chart dashboard port condition uses toString for type-safe comparison

## [0.22.0] - 2026-03-21

### Added

- Chinese content writing guideline skill for Traditional Chinese — covers terminology standards, tone and structure guidelines, formatting rules, and rewrite quality checks
- `minMemoryCount` threshold now passed to memory maintenance prompt template as a variable

### Changed

- Prompt templates updated for improved clarity and quality:
  - Spontaneous posting workflow restructured with explicit step-by-step guidance
  - Reply prompt strengthened with mandatory memory search and cleanup requirements
  - Research flows now invoke Chinese writing guideline for Traditional Chinese text
  - Memory tool guidance refined to emphasize searching before answering and saving conversation summaries
  - Roleplay prompt enhanced to ensure fully in-character thinking and speaking
  - All exported content must remain in-character, not just replies
  - DM memory-save rule clarified for private chats
  - Spontaneous posting guidance relaxed to use journal entries more broadly
  - Post topic selection and journaling instructions refined
- Character prompt files updated to Traditional Chinese with detailed appearance, background, personality traits, speaking style, and reference terms

### Fixed

- Test assertion updated to match simplified spontaneous post template wording

## [0.21.0] - 2026-03-15

### Added

- Agent message chunk buffering — `ChatbotClient` now accumulates consecutive `agent_message_chunk` text content and logs the complete message at INFO level when the event transitions or prompt completes
- Automatic workspace `tmp/` directory cleanup when agent sessions end, preventing disk space waste from accumulated temporary files (browser screenshots, video recordings, Chrome profiles)
- 20 container document processing tools now allowed in restricted (non-YOLO) mode: `wget`, `file`, `tree`, `jq`, `bc`, `pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm`, `pandoc`, `exiftool`, `ffmpeg`, `ffprobe`, `magick`, `convert`, `identify`, `mogrify`, `unzip`, `zip`, `7zz`
- `canWriteAgentWorkspace` template variable for prompt templates, enabling self-research sessions to show write instructions even in restricted mode

### Fixed

- `rawInput` path extraction for edit/write permissions in restricted mode — when ACP agents send permission requests with empty `locations`, the system now falls back to extracting file paths from `rawInput` fields
- Added `"filepath"` (all lowercase) to rawInput path extraction field list — Copilot CLI uses this variant for edit tool permission requests
- OpenCode edit/write permission delegation to Layer 3 via `"ask"` — resolves path resolution mismatch caused by OpenCode converting absolute paths to relative before evaluating permission rules
- Race condition in workspace tmp cleanup prevented by using synchronous removal within the active-session check critical section

### Changed

- Refined skill prompt instructions and cleanup guidance — standardized skill name references, clarified workspace and memory guidance, added browser automation cleanup step
- CI Docker workflow actions updated for Node.js 24 compatibility

## [0.20.0] - 2026-03-13

### Added

- GELF transport now supports TCP protocol — sends log messages as raw JSON with a null-byte delimiter (`\0`), maintaining a persistent connection with lazy reconnect on failure
- GELF transport now supports UDP protocol with GZIP compression (default, per GELF spec) and automatic chunking for messages exceeding 8192 bytes, including magic-byte headers, sequence numbers, and message IDs per the GELF chunking specification
- New `protocol` config option (`"http"` / `"tcp"` / `"udp"`) and `GELF_PROTOCOL` env var for selecting the GELF transport protocol
- New `compress` config option and `GELF_COMPRESS` env var for controlling GZIP compression in UDP transport
- Prompt message formatting now includes account IDs — recent messages are formatted as `[User] name(userId)` and `[Bot] name(userId)` for better agent context

### Fixed

- GELF payload spec compliance: `_id` additional field is now filtered (per GELF spec), field names are validated against `^[\w.\-]*$`, and boolean values are converted to strings (Graylog drops booleans on ingest)
- Rate-limited users no longer receive a generic error message — the error dispatch is now silently skipped per the original design
- Rate limit events are now logged at `WARN` level (previously `INFO`) for improved monitoring visibility

### Changed

- GELF transport gracefully closes connections on shutdown via a new `close()` method
- Deno unstable net API (`"net"`) enabled for UDP datagram support
- Self-research skill instructions strengthened to prevent delegation to subagents

## [0.19.0] - 2026-03-08

### Added

- Copilot CLI now launches with `--deny-tool` flag in restricted (non-YOLO) mode, and Gemini CLI receives `gemini-settings.json` and Policy Engine `airfriends.toml` for Layer 1/2 permission enforcement — aligns all three agents with the defense-in-depth permission standard
- Permission approval/rejection decisions are now recorded in the per-session JSONL audit log as `permission_approval` and `permission_rejection` phases, including tool type, affected paths, and decision reason
- `requestPermission()` now auto-approves `edit`/`write` tool calls only when ALL requested paths are within the agent workspace or workspace TMPDIR; paths outside this boundary are rejected (`agent_workspace_write` approval reason recorded in audit)
- File extension restrictions for agent workspace writes in restricted (non-YOLO) mode — Agent is limited to `.md` and `.txt` files by default; configurable via `agent.sandbox.allowedWriteExtensions` or `AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS` env var; TMPDIR writes and YOLO mode are exempt; `writeTextFile` callback enforces the same restriction as defense-in-depth
- `yolo` boolean template variable added to all Vento prompt templates; new `prompts/agent_permissions.md` fragment is included in `system_reply.md` to provide YOLO-conditional capability instructions to the Agent
- Git backup now excludes workspace `tmp/` directories — `**/tmp/**` pattern added to the programmatic `.gitignore` so agent TMPDIR contents no longer trigger unnecessary backup commits
- Added `pandoc` to the container image's installed system packages

### Fixed

- Shell injection bypass prevented in skill whitelist matching — replaced substring `includes()` and loose `startsWith()` with exact path equality and anchored prefix matching, blocking path traversal attacks against whitelisted skill commands
- OpenCode `edit` permission scoped to agent-workspace directories only — the previous blanket `edit: deny` in `opencode.json` blocked self-research note writing; Agent can now write notes to `$AGENT_WORKSPACE/notes/` while all other paths remain denied

### Changed

- Agent config files (`opencode.json`, `gemini-settings.json`, `gemini-policies/`) relocated to `agent-config/` directory; Containerfile COPY source paths updated; container destinations unchanged

### Security

- Shell injection bypass prevented in skill whitelist command matching (see Fixed)

## [0.18.0] - 2026-03-07

### Added

- Dedicated `COPILOT_GITHUB_TOKEN` environment variable for Copilot CLI authentication — separates Copilot token from `GITHUB_TOKEN`, with automatic fallback for backward compatibility
- Configurable Git Backup HTTPS credentials (`GIT_BACKUP_AUTH_USER` / `GIT_BACKUP_AUTH_PASSWORD`) — replaces implicit `GITHUB_TOKEN` usage with explicit auth configuration; falls back to `GITHUB_TOKEN` when not set
- `agentType` and `model` template variables available in all Vento prompt templates — enables per-agent-type and per-model prompt customization (e.g., agent-specific instructions or model-tuned wording)
- Copilot agent now launches with `--experimental` flag to enable experimental features

### Fixed

- Misskey 502 Bad Gateway responses with non-JSON bodies are now correctly classified as retryable `PlatformError` instead of a generic API error

## [0.17.0] - 2026-03-03

### Added

- Config-driven skill auto-approve list (`agent.autoApproveSkills`) — replaces directory-scanning with a configurable list of skills to auto-approve in restricted (non-YOLO) mode; supports both built-in and external skills via config or `AGENT_AUTO_APPROVE_SKILLS` environment variable (comma-separated); falls back to directory scanning when not configured (backward compatible)
- Native YAML support for `agentAutoApproveSkills` in Helm chart — new top-level value rendered as comma-separated `AGENT_AUTO_APPROVE_SKILLS` in secret template, consistent with `modelRouting` and `agentExternalSkills` handling

### Changed

- Renamed internal `SkillAllowList` → `SkillAutoApproveList` and `buildSkillAllowList()` → `buildSkillAutoApproveList()`; log messages updated from `non-YOLO` to `restricted mode` for clarity
- Increased container memory limit to 2500Mi and raised resource requests to 1000m CPU / 1000Mi memory in Helm chart
- Updated YAML policy examples for `yolo` flag and channel routing configuration in documentation

## [0.16.0] - 2026-03-01

### Added

- Per-channel YOLO mode via `yolo` field in `channels` configuration — allows fine-grained control over which channels/accounts run Agent in YOLO mode
- Workspace `tmp/` directory — each workspace now includes a `tmp/` subdirectory, exposed to Agent via `TMPDIR` environment variable
- Agent permission control hardening — whitelist-based skill command matching (script paths + command prefixes) replaces loose `includes` check; explicit `edit` tool blocking in non-YOLO mode
- Structured INFO-level permission request logging — logs external directory access and bash command execution requests with `paths`, `commands`, `rawInput`, and `toolCallId` context before any approval/rejection decision
- `yolo_resolution` audit phase — YOLO decision-making is now explicitly auditable; structured `YoloDecision` type records the decision source (global flag, account-level, channel-level) in audit log

### Changed

- **BREAKING**: Removed default `--yolo` flag from Containerfile CMD — YOLO mode must now be explicitly enabled via `--yolo` CLI flag or per-channel `yolo: true` configuration
- `TMPDIR` added to sandbox `BASE_ALLOWED_ENV_VARS` for workspace-scoped temp directory
- YOLO resolution refactored to use structured `YoloDecision` type with logged decision source; `isYoloEnabled()` delegates to new `resolveYoloDecision()` for backward compatibility

### Fixed

- Fixed `yolo` field being silently dropped when parsing channel entries in `loadChannels()` — per-channel and per-account YOLO settings configured via `channels[].yolo: true` were always evaluated as `false`

### Security

- Non-YOLO mode now blocks `edit`/`write` tools with explicit logging
- Skill command approval uses whitelist built from scanning `skills/` directory at startup

## [0.15.0] - 2026-02-28

### Changed

- **BREAKING**: Replaced `accessControl.replyTo`/`whitelist` configuration with a new top-level `replyPolicy`/`channels` structure — existing `config.yaml` files must be migrated to the new format
- **BREAKING**: `ReplyPolicy` value `'whitelist'` renamed to `'channels'`; the environment variable alias `REPLY_TO=whitelist` is preserved for backward compatibility
- **BREAKING**: `SpontaneousPostConfig.allowDm` option removed — control spontaneous DM targeting via per-channel `spontaneousPost: true` flag on account entries instead
- **BREAKING**: `ModelRoutingMatch.whitelist` renamed to `ModelRoutingMatch.channel` in model routing rule match conditions
- Changed Channel Lurk configuration to use per-channel `channelLurk` boolean flag instead of deriving from whitelist entries
- Changed rate limiting bypass to use per-channel `rateLimitBypass` flag instead of account-based bypass detection
- Added `misskey/timeline/self` channel ID support in the `channels` list for Misskey spontaneous posting
- Updated `config.example.yaml`, `.env.example`, `helm/values.yaml`, and Helm secret template to reflect new configuration structure

## [0.14.0] - 2026-02-28

### Added

- Added `Logger.withContext()` method for centralized session context injection — creates a new Logger instance with default context fields automatically merged into every log call, eliminating manual `sessionId` passing at each call site; `SessionOrchestrator` now injects `shellSessionId` and ACP `sessionId` automatically for all 5 session types
- Added idle timeout detection and auto-recovery for ACP Agent connections — when no activity is received for a configurable period (default 5 min), the system performs liveness checks via `process.status` and `cancel()` probe; configurable via `agent.idleTimeout.*` settings and environment variables `AGENT_IDLE_TIMEOUT_ENABLED`, `AGENT_IDLE_TIMEOUT_MS`, `AGENT_IDLE_TIMEOUT_CHECK_INTERVAL_MS`; added `airfriends_idle_timeout_total` Prometheus metric
- Added current local date and time to system prompts for clearer temporal context in Agent conversations

### Changed

- Changed `spontaneousPost.allowDm` default value from `true` to `false` — existing deployments relying on the default will no longer send spontaneous DM posts; set `allowDm: true` explicitly to restore previous behavior
- Changed retry prompt strategy to load content from `skills/send-reply/SKILL.md` and `skills/react-message/SKILL.md` at runtime instead of hardcoded strings, keeping retry messages in sync with skill definitions automatically
- Changed send-reply rules in system prompts to use bullet points with inline code formatting; added dedicated self-research skill usage instructions and stronger emphasis against follow-up messages after `send-reply`

### Fixed

- Fixed false `ERROR` log from `monitorProcessExit()` when Agent process exits normally after completing a session — now logs at `DEBUG` level when `promptCompleted` flag is set, and resets the flag at the start of each new prompt
- Fixed Git staging area check to use `git diff --cached --quiet` instead of `git status --porcelain`, correctly handling submodule modified content that was causing spurious `git commit` failures; added `deregisterSubmodules()` to remove nested `.git` directory tracking before `git add`, and updated `.gitignore` to exclude `**/.git`
- Fixed `GitBackupService` error logs now include `stderr`/`stdout` context from `runGit()` for all failure paths, improving diagnosability of backup failures
- Fixed Misskey WebSocket silent disconnect causing Agent to stop responding — removed conflicting internal reconnect logic, added 60-second periodic heartbeat via `stream.heartbeat()`, cleaned up existing stream in `connect()` to prevent resource leaks, and increased `ConnectionManager` polling interval from 5s to 30s
- Fixed Deno user bin directory (`~/.deno/bin`) not included in `PATH`, ensuring user-installed executables (e.g. CLI tools) are discoverable at runtime
- Fixed `scheduler-state.json` being included in Git backup commits by adding it to the auto-generated `.gitignore` managed by `GitBackupService`

## [0.13.0] - 2026-02-24

### Added

- Added `spontaneousPost.allowDm` boolean setting (default: `true`) to control whether spontaneous posts can target DM channels
  - Discord: when `allowDm=false`, account whitelist entries are excluded from spontaneous target selection
  - Misskey: when `allowDm=true`, whitelist account entries are included as DM targets alongside `timeline:self`; when `false`, only `timeline:self` is used
  - New environment variable overrides: `DISCORD_SPONTANEOUS_ALLOW_DM`, `MISSKEY_SPONTANEOUS_ALLOW_DM`
  - Default behavior unchanged (`allowDm: true`), existing deployments unaffected
- Added `send-reply` skill per-session call limit of 3 — when the limit is exceeded the API returns HTTP 429 with guidance to use `edit-reply` instead
  - New `MAX_REPLIES_PER_SESSION = 3` constant in Skill API Server
  - `SessionRegistry` tracks `replyCount` per session; only successful `send-reply` calls are counted
  - `edit-reply` is not subject to the limit

### Changed

- Refined system prompt to enforce one-shot final replies: Agent must call `#send-reply` for the final output and exit the session immediately afterward, with no second retry attempt

## [0.12.0] - 2026-02-23

### Added

- Discord sticker messages now displayed in conversation context — stickers are formatted as `[Sticker: name (tags)]` and appended to message content (rather than treated as file attachments), preserving intent/emotion semantics without modifying the `Attachment` type
- Multiple `send-reply` calls now allowed per session — the Agent can send several messages in a single turn; the "at least one reply or reaction" requirement and retry mechanism remain unchanged
- Misskey chat message reaction support — `addReaction()` and `hasBotReaction()` now work for `chat:` channels via `chat/messages/react` and `chat/messages/show` API endpoints, with graceful error handling (returns `false` on API failure)

### Changed

- Modularized SCENARIO prompt into a reusable `prompts/scenario.md` fragment included by all system prompt files (`system_reply.md`, `system_spontaneous.md`, `system_self_research.md`, `system_reminder.md`, `system_memory_maintenance.md`)
- Refined memory maintenance and scheduled reminder prompt wording for clearer role framing and DM chat delivery
- Improved prompt template whitespace handling by trimming `{{ include }}` directive output to avoid stray newlines

### Fixed

- Fixed Misskey chat messages being returned newest-first from `fetchRecentMessages()`, causing `/clear` to drop recent messages instead of old ones — messages are now sorted oldest-first, consistent with Discord and Misskey note channel handling

## [0.11.0] - 2026-02-22

### Added

- Scheduler state persistence for restart recovery
  - New `SchedulerStateStore` module with in-memory cache strategy to avoid read-merge-write race conditions
  - All 6 schedulers (Spontaneous, SelfResearch, MemoryMaintenance, GitBackup, AuditRetention, ChannelLurk) now support state restoration via `setStateStore()` and `start(restoredState?)`
  - Added `resolveScheduleTime()` utility function for validating restored schedule times against configured min/max intervals
  - Integrated `SchedulerStateStore` in bootstrap flow with `AppContext` extension
  - Restored state validation: expired times trigger immediate execution, out-of-range times are recalculated, valid times are preserved
  - Backward compatible: schedulers without `stateStore` behave exactly as before
  - Comprehensive tests covering restoration logic for all schedulers
- External skill auto-installation at startup
  - Users can configure skills through `config.yaml` (`agent.externalSkills`), environment variable (`AGENT_EXTERNAL_SKILLS` as JSON), or Helm values (`agentExternalSkills`)
  - New `ExternalSkillConfig` type and `skill-installer.ts` module
  - Skills are installed sequentially via `deno x -y skills add <repo> -a universal -s <skill> -g -y` during bootstrap
  - Individual installation failures are logged but do not block application startup
  - Installed before `AgentCore` initialization to ensure skills are available when agent starts
  - Full Helm chart integration with native YAML section and secret template transformation

### Changed

- Prompt template formatting: added `{{-` and `-}}` to all `{{ include }}` statements to remove surrounding whitespace
- Language preference: assistant now responds primarily in Traditional Chinese (正體中文) unless user's language preference indicates otherwise

### Fixed

- Fixed lint errors in scheduler restoration tests by replacing async arrow functions without await with explicit `Promise.resolve()` returns
- Fixed CI coverage threshold check by replacing Perl regex with POSIX-compatible grep pattern
- Fixed missing LCOV report generation step before Codecov upload

## [0.10.0] - 2026-02-21

### Added

- Native YAML support for `selfResearchRssFeeds` in Helm chart
  - New `selfResearchRssFeeds` top-level section in `values.yaml` following the same pattern as `modelRouting`
  - When non-empty, the list is serialized to JSON and injected as `SELF_RESEARCH_RSS_FEEDS` environment variable via secret template
  - Eliminates need for manual JSON string formatting in values override
- Platform integration documentation guide (`docs/PLATFORM_INTEGRATION.md`)
  - Complete step-by-step instructions for adding new platform support
  - Covers adapter implementation, configuration, environment variables, validation, registration, and testing
  - Includes architecture overview, prerequisites, and 18-item checklist
  - Reference links to key source files and documentation
- Type guard `isValidPlatform()` and `VALID_PLATFORMS` constant in `src/types/events.ts`
  - Eliminates hardcoded platform validation across core modules
  - Used in `session-orchestrator.ts`, `bootstrap.ts`, `config-loader.ts`, and `spontaneous-scheduler.ts`
  - Centralized platform validation logic
- 75% test coverage requirement enforcement
  - Added `codecov.yml` with coverage threshold configuration
  - CI workflow now fails PRs below 75% coverage on `src/` directory
  - Updated documentation with coverage requirement and CI/CD checklist

### Changed

- **BREAKING**: Refactored platform-specific code from `core/` and `skills/` to `platforms/`
  - Added `PlatformAdapter.determineSpontaneousTarget()` abstract method (all custom adapters must implement)
  - Added `PlatformAdapter.getSearchGuildId()` method (default implementation returns empty string)
  - Discord adapter: `determineSpontaneousTarget()` randomly selects from whitelist (channel or account DM)
  - Discord adapter: `getSearchGuildId()` returns channelId for non-DM contexts
  - Misskey adapter: `determineSpontaneousTarget()` returns `timeline:self`
  - Moved `extractChannelLurkIds()` from `src/core/channel-lurk-scheduler.ts` to `src/platforms/discord/discord-utils.ts`
  - Extracted `selectDiscordSpontaneousTarget()` to `discord-utils.ts` for testability
  - Simplified `spontaneous-target.ts` to interface-only file
  - Removed platform checks from `context-handler.ts`
  - Updated import paths in `bootstrap.ts` and test files
- Updated Helm chart
  - Chart version bumped from 0.1.0 to 0.2.0
  - `appVersion` updated from 0.1.0 to 0.9.0
  - Breaking change: `securityContext` renamed to `containerSecurityContext`
  - Added `podSecurityContext` configuration
  - Added ServiceMonitor support
  - Added OpenCode authentication PVC
  - Support for individual prompt file mounting
  - Added `resource-policy: keep` annotations

### Fixed

- Fixed hardcoded `platform: "discord"` in `ChannelLurkScheduler.checkChannel()` (now uses `this.adapter.platform`)
- Fixed scattered platform validation logic across codebase (now centralized in `isValidPlatform()`)

## [0.9.0] - 2026-02-21

### Added

- Discord Snowflake ID validation for whitelist entries
  - Platform-specific validation: Discord IDs require 17-20 digit Snowflake format
  - Misskey IDs retain generic pattern due to varying ID formats across instances
  - Unified `isValidWhitelistEntry()` function for both `accessControl.whitelist` and `modelRouting.rules[].match.whitelist`
  - Updated tests and documentation with valid Snowflake IDs
- Model routing content keywords and multi-condition AND matching
  - New `contentKeywords` field in `ModelRoutingMatch` for routing based on message content
  - Keywords are case-insensitive with OR logic within the array
  - Match logic changed from mutually exclusive to AND combination (all specified conditions must be met)
  - Added `messageContent` to `ModelRoutingContext`, passed from `processMessage()`
  - Native YAML `modelRouting` section in Helm chart values
  - Environment variable support via `MODEL_ROUTING_RULES` JSON string
- Misskey hasBotReaction and hasBotMention implementations
  - `hasBotReaction()`: uses `notes/show` API to check `myReaction` field
  - `hasBotMention()`: uses `notes/show` + `isMentionToBot` utility
  - Both return false for `chat:` channels (no reaction/mention support)
  - Fail-safe error handling (returns false on API errors)
- Channel lurk reply: periodically check whitelisted Discord channels and auto-trigger reply when conditions are met (Feature 26)
  - `ChannelLurkScheduler` with fixed-interval scheduling and three-layer duplicate prevention
  - `hasBotReaction()` and `hasBotMention()` methods on `PlatformAdapter`
  - `processChannelLurkMessage()` reuses normal message flow with `channelLurk` session type
  - Configuration via `platforms.discord.channelLurk` with env var overrides
  - Discord-only feature (Misskey adapters return false for new methods)

### Changed

- Model routing match conditions now use AND logic instead of mutually exclusive
  - All conditions specified in a rule must be satisfied for a match
  - Config validation updated from "exactly one condition" to "at least one condition"
  - Backward compatible: existing single-condition rules behave identically

### Fixed

- Fixed literal `\n` sequences in Agent-generated replies not converting to actual newlines
  - Added `unescapeNewlines()` function in `reply-handler.ts` to convert string `\n` to real line breaks
  - Applied to both `handleSendReply` and `handleEditReply` flows after XML tag stripping
  - Affects both Discord and Misskey platforms
- Fixed Discord premium emoji being included in `fetchEmojis()` results
  - Added `isPremiumEmoji()` helper to identify subscription-restricted emoji
  - Filters emoji where all associated roles are either `premiumSubscriberRole` or managed with `integrationId`
  - Debug logging for filtered premium emoji count
  - Bot can now only see and use emoji it has permission to use
- Fixed readiness probe failure in container deployments due to skill path mismatch
  - Added `AGENT_SKILLS_DIR` environment variable for configurable skill directory path
  - Helm chart sets `AGENT_SKILLS_DIR=/home/deno/.agents/skills` by default
  - Resolves 503 status when probe looks for skills at default `skills/` but container uses `/home/deno/.agents/skills/`

## [0.8.0] - 2026-02-18

### Added

- Session audit log for replay and debugging (Feature 25)
  - Per-session JSONL audit trail tracking full lifecycle: context assembly, agent connection, prompt, skill calls, reply, and session end
  - SessionAuditWriter with fire-and-forget design (I/O errors never crash sessions)
  - Phase filtering via `audit.includedPhases` config (empty = record all phases)
  - SHA-256 content hashing with recursive sanitization when `audit.hashContent` is enabled
  - Retention cleanup at startup and every 24 hours via `audit.retentionDays`
  - Prometheus counter `airfriends_audit_entries_total` with phase label
  - Skill-level auditing in Skill API Server for `skill_call` and `reply_sent` phases
  - Environment variable overrides: `AUDIT_ENABLED`, `AUDIT_RETENTION_DAYS`, `AUDIT_HASH_CONTENT`, `AUDIT_INCLUDED_PHASES`
  - Audit files stored at `data/audit/{platform}/{userId}/{sessionId}.jsonl`
  - BDD feature spec: `docs/features/25-session-audit-log.feature`
- Memory relationship fields for semantic graph tracking
  - New `relatedTo` and `supersedes` optional fields on `MemoryEntry`, `MemoryPatch`, and `ResolvedMemory`
  - Union-merge strategy for patches (append and deduplicate IDs)
  - Skill handler validation and shell script support in `memory-save` and `memory-patch`
  - Updated `SKILL.md` documentation and memory maintenance prompt
  - Backward compatible: all fields are optional, existing memories default to empty arrays
- Skill dependency health check to readiness probe
  - Extended `/ready` and `/readyz` endpoints with skill readiness checks
  - Verifies skill script existence for all registered skills
  - Checks required binary availability (`rg`, `deno`, `git`)
  - Validates Skill API Server connectivity
  - Checks workspace directory write permissions
  - Prometheus gauge `airfriends_skill_readiness{skill=...}` (0 = not ready, 1 = ready)
  - Result caching with 30s TTL to avoid excessive subprocess spawning
- Per-user agent sandbox hardening for subprocess isolation
  - New `SandboxManager` module for centralized environment variable filtering and network isolation
  - Configurable environment variable whitelist via `agent.sandbox.filterEnv` (default: enabled)
  - Optional Linux network namespace isolation via `agent.sandbox.networkIsolation` using `unshare --net` (default: disabled)
  - Custom allowed environment variables via `agent.sandbox.allowedEnvVars`
  - Graceful degradation on non-Linux platforms or when `unshare` is unavailable
  - Environment variable overrides: `AGENT_SANDBOX_FILTER_ENV`, `AGENT_SANDBOX_NETWORK_ISOLATION`, `AGENT_SANDBOX_ALLOWED_ENV_VARS`
  - Installed `util-linux` package in container for `unshare` command
- Discord typing indicator during ACP sessions for better UX
  - New abstract `sendTyping()` method on `PlatformAdapter`
  - DiscordAdapter implementation sends typing indicator every 10 seconds during agent sessions
  - MisskeyAdapter no-op implementation (Misskey has no native typing API)
  - Configurable via `platforms.discord.typingIndicator.enabled` (default: disabled)
  - Environment variable override: `DISCORD_TYPING_INDICATOR_ENABLED`
  - Automatic cleanup on session completion via finally block
- send-file skill for workspace file sharing
  - Allows Agent to send files from workspace directories to platform channels (Discord/Misskey)
  - New `SendFileSkillConfig` type under `SkillsConfig` namespace
  - FileHandler with path validation, size limits, and extension whitelist
  - Security: disabled by default, requires explicit admin enablement
  - Path traversal prevention via `..` check and `resolve()` prefix matching
  - Supports workspace and agent-workspace directories
  - Configurable file size limit (default: 25MB) and extension whitelist
  - Prometheus counter `airfriends_files_sent_total`
  - Environment variable overrides: `SKILL_SEND_FILE_ENABLED`, `SKILL_SEND_FILE_MAX_FILE_SIZE_MB`, `SKILL_SEND_FILE_ALLOWED_EXTENSIONS`
- Dry run / debug mode for agent sessions
  - `--dry-run` CLI flag and `agent.dryRun` configuration option
  - Zero-cost context debugging: fully executes workspace creation, session registration, context assembly, and prompt rendering
  - Writes assembled prompt to file without calling ACP Agent
  - Optional mock reply via platform adapter when `dryRun.mockReply` is non-empty
  - Output files named `{sessionType}_{timestamp}_{sessionIdPrefix}.md`
  - Supports all 5 session types (message, spontaneous, self-research, memory-maintenance, reminder)
  - Environment variable overrides: `DRY_RUN_ENABLED`, `DRY_RUN_OUTPUT_PATH`, `DRY_RUN_MOCK_REPLY`
  - BDD feature spec: `docs/features/24-dry-run-debug-mode.feature`
- External MCP server registration via config
  - Register MCP servers through `config.yaml` or `AGENT_MCP_SERVERS` environment variable
  - Support for stdio, HTTP, and SSE transports (Agent capability-dependent)
  - Environment variable expansion (`${ENV_VAR}`) in `env`, `headers`, and `url` fields
  - Config validation with name uniqueness checks and transport-specific required fields
  - MCP servers passed to Agent during session creation for all 5 session types
  - Environment variable override: `AGENT_MCP_SERVERS` (JSON string)
  - Example configurations in `config.example.yaml`, `.env.example`, and `helm/values.yaml`
- Scheduled reminders feature (Feature 23)
  - Users can set one-time reminders via DM using `set-reminder` skill
  - Reminders delivered via DM at scheduled time using ACP agent session
  - Skills: `set-reminder`, `cancel-reminder`, `list-reminders`
  - Polling-based scheduler (configurable interval, default 30s)
  - Restart-safe: overdue reminders picked up automatically
  - Per-user limit (default: 20 active reminders)
  - DM-only: reminders can only be set and delivered in DM context
  - One per session: only one set-reminder call per conversation turn
  - Permanent failure handling: undeliverable reminders are auto-cancelled
  - Prometheus metrics: `remindersSetTotal`, `remindersDeliveredTotal`, `remindersCancelledTotal`
  - Environment variable overrides: `REMINDERS_ENABLED`, `REMINDERS_MAX_PER_USER`, `REMINDERS_CHECK_INTERVAL_MS`, etc.
- memory-export skill for user memory data portability
  - Allows users to export their memories as a file sent via DM
  - Supports markdown and JSON formats
  - Filters by importance (high/normal) and enabled status
  - Always sends export via private message for privacy protection
  - Does not consume `send-reply` quota (uses `sendFile` independently)
  - Platform adapter enhancements: new `sendFile()` and `getDmChannelId()` abstract methods
  - Discord implementation using `AttachmentBuilder`
  - Misskey implementation with Drive upload (`uploadFile()`) + chat message/note delivery
- Dynamic model routing for per-user/per-context LLM model selection (`agent.modelRouting`)
  - Rule-based system with first-match-wins evaluation strategy
  - Match by whitelist entry (account/channel) or session type
  - Fallback chain: routing rules → section-specific model → `agent.model`
  - Supports all 4 session types (message, spontaneous, self-research, memory-maintenance)
  - Environment variable overrides: `MODEL_ROUTING_ENABLED`, `MODEL_ROUTING_RULES`
  - Config validation with silent rule skipping on errors (warnings logged, service not interrupted)
  - BDD feature spec: `docs/features/22-model-routing.feature`

### Changed

- Migrated prompt template system from custom `{{placeholder}}` to Vento template engine (v2.2.0)
  - Enables conditionals, loops, `{{ include }}` directives, and JavaScript expressions in templates
  - New `src/core/template-renderer.ts` module wrapping Vento engine
  - New `src/types/template.ts` defining `TemplateVariables` interface
  - All system prompts updated to Vento syntax: `system_reply.md`, `system_spontaneous.md`, `system_self_research.md`, `system_memory_maintenance.md`
  - Character fragments loaded via `{{ set }}` + `{{ include }}`
  - Platform-specific instructions use `{{ if platform === "discord" }}` conditionals
  - BREAKING CHANGE: Custom prompt files using old `{{placeholder}}` syntax must be updated to Vento syntax
  - Documentation updated: `docs/DEVELOPMENT.md`, `AGENTS.md`, BDD feature specs
- Refactored prompt file naming to consistent `system_<purpose>.md` convention
  - Renamed `prompts/system.md` to `prompts/system_reply.md`
  - Merged `prompts/system_message.md` into `system_reply.md` using conditional blocks
  - Session info, context, and instructions sections now guarded by `{{ if userContextMessage }}`
- Refactored Git backup initialization with intelligent directory state handling
  - Case A (empty directory): clone remote repository
  - Case B (non-empty non-Git): git init, commit existing files, push
  - Case C (existing Git repo): commit uncommitted changes, push
  - New `pushWithFallback()` three-tier strategy: direct push → fetch+rebase+retry → fallback branch
  - Handles remote HEAD pointing to different default branch after clone
  - Detects remote's default branch dynamically (prefers `master`, falls back to `main`)
  - Ensures rebase abort cleans state before fallback branch creation
- Git backup scheduler now executes first backup immediately on start instead of waiting for full interval
  - Subsequent backups continue at `intervalMs` intervals
  - Fire-and-forget async execution maintains non-blocking behavior
- Migrated container image build to native multi-arch parallel build
  - Native builds on architecture-specific runners (ubuntu-latest for amd64, ubuntu-24.04-arm for arm64)
  - Removed QEMU emulation for significantly faster arm64 builds (~20-40 minutes faster)
  - Split CI workflows into `build` (matrix) + `merge` (manifest) jobs
  - Use push-by-digest with multi-registry outputs to prevent incomplete tags
  - Separate cache keys per architecture (`cache-linux-amd64`, `cache-linux-arm64`)
  - Containerfile refactored with `TARGETARCH` and `case` statements for dynamic binary selection

### Fixed

- Fixed sessionId being incorrectly nested inside userContextMessage conditional in `system_reply.md`
  - Session Information block is now rendered whenever sessionId exists, regardless of userContextMessage
  - Aligns with pattern used in `system_spontaneous.md`
- Fixed Git safe.directory config rejecting relative paths in containers
  - GitBackupService constructor now converts `dataDir` to absolute path using `resolve()`
  - Fixes "safe.directory './data' not absolute" error when `config.workspace.repoPath` is relative

## [0.7.2] - 2026-02-15

### Changed

- Updated container image metadata and messaging for clearer project branding and description.
- Expanded base container image toolset with commonly used runtime and debugging utilities.
- Removed separate ripgrep download stage by installing ripgrep directly via apt.
- Added documentation for preinstalled container tools and their primary commands.
- Set container timezone to `Asia/Taipei` in Docker Compose and Helm values through `TZ`.

## [0.7.1] - 2026-02-15

### Fixed

- Fixed Misskey note and chat message editing by implementing delete-and-recreate strategy
  - Misskey API lacks `notes/update` and `chat/messages/update` endpoints
  - `editNote()` now uses `notes/show` → `notes/delete` → `notes/create` flow
  - `editChatMessage()` now uses `chat/messages/delete` → `chat/messages/create-to-user` flow
  - Preserves visibility from original note (including specified visibility for DMs)
  - Sets `replyId` to original trigger note for proper conversation threading
  - Returns new `messageId` after recreation
  - Improved Misskey error serialization to avoid `[object Object]` in logs
- Fixed non-Error object serialization in Misskey client using `JSON.stringify()` instead of `String()`

### Changed

- Changed logging system to adopt Message Template syntax (messagetemplates.org specification)
  - Added `messageTemplate` field to `LogEntry` type for event categorization
  - Implemented `{PropertyName}` placeholder syntax in ~80 log messages across all modules
  - Added `_messageTemplate` custom field to GELF output
  - Backward compatible: messages without placeholders are unaffected
  - Enhanced structured logging capabilities for log management systems
- Changed `PlatformAdapter.editMessage()` interface to include optional `replyToMessageId` parameter
  - Enables proper reply threading in Misskey delete-and-recreate strategy
  - Discord adapter implementation updated with unused optional parameter

## [0.7.0] - 2026-02-14

### Added

- Added `edit-reply` skill for editing previously sent reply messages within the same session
  - New `editMessage()` abstract method on `PlatformAdapter`
  - Discord and Misskey adapter implementations (note and chat message editing)
  - Shell-based skill script in `skills/edit-reply/`
  - BDD feature spec: `docs/features/20-edit-reply.feature`
  - Not subject to single reply rule — can be called multiple times per session
- Added Prometheus metrics export endpoint (`/metrics`) on Health Check Server for observability
  - New `prom-client` dependency and metrics registry (`src/utils/metrics.ts`)
  - Eight metrics covering sessions, messages, replies, memory operations, skill API calls, and rate limit rejections
  - `MetricsConfig` type with environment variable overrides (`METRICS_ENABLED`, `METRICS_PATH`)
  - ServiceMonitor Helm template for Prometheus Operator integration
  - BDD feature spec: `docs/features/19-metrics-export.feature`
- Added multimedia message handling: support for image and file attachments in platform messages
  - New `Attachment` type in `NormalizedEvent` and `PlatformMessage`
  - Discord and Misskey adapters extract attachment metadata (URL, MIME type, filename, size)
  - Attachment text descriptions (with URLs) always included in context for all messages
  - Image `ContentBlock` sent to ACP Agent when `promptCapabilities.image` is supported
  - Capability negotiation via `AgentConnector.supportsImageContent()`
  - `prompt()` method now accepts `string | ContentBlock[]` (backward compatible)
  - 20MB size limit and 10s download timeout for image fetching
  - BDD feature spec: `docs/features/18-multimedia-message.feature`
- Added `PromptCapabilities` type to ACP types for image/audio/embeddedContext capability tracking
- Added rate limiting & cooldown mechanism to prevent excessive API usage per user
  - New `RateLimitConfig` with sliding window + cooldown strategy
  - Per-user tracking by `{platform}:{userId}` key
  - Periodic cleanup to prevent memory leaks
  - Environment variable overrides: `RATE_LIMIT_ENABLED`, `RATE_LIMIT_MAX_REQUESTS_PER_WINDOW`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_COOLDOWN_MS`
  - Disabled by default (`enabled: false`)
  - Whitelisted accounts automatically bypass rate limiting
- Added agent-driven memory maintenance scheduler for periodic memory summarization/compaction
  - New `MemoryMaintenanceConfig` with configurable model, threshold, and interval
  - Fixed-interval scheduler with per-workspace execution
  - Agent uses existing memory skills (`memory-search`, `memory-save`, `memory-patch`) for compaction
  - Original memories disabled via patch events (append-only preserved)
  - Environment variable overrides: `MEMORY_MAINTENANCE_ENABLED`, `MEMORY_MAINTENANCE_MODEL`, `MEMORY_MAINTENANCE_MIN_MEMORY_COUNT`, `MEMORY_MAINTENANCE_INTERVAL_MS`
  - Disabled by default
- Added `memory-stats` skill for workspace memory statistics
  - Total, enabled, disabled counts
  - High/normal importance breakdowns for public and private memories
  - Read-only operation with no state changes
- Added RSS/Atom self-research scheduling feature
  - Agent periodically reads RSS feeds, selects topics of interest, and writes research notes to agent workspace
  - New `SelfResearchConfig` with RSS feed sources, model, and interval settings
  - Regex-based RSS/Atom parser (`src/utils/rss-fetcher.ts`)
  - `SelfResearchScheduler` with random interval execution (12-24h default)
  - Environment variable overrides: `SELF_RESEARCH_ENABLED`, `SELF_RESEARCH_MODEL`, `SELF_RESEARCH_RSS_FEEDS`, `SELF_RESEARCH_MIN_INTERVAL_MS`, `SELF_RESEARCH_MAX_INTERVAL_MS`
  - BDD feature spec: `docs/features/16-self-research-via-rss.feature`
- Added agent global workspace for long-term knowledge storage (`{repoPath}/agent-workspace/`)
  - Not per-user — shared across all conversations
  - Directory structure: `notes/` for knowledge, `journal/` for reflections
  - `notes/_index.md` serves as quick-reference index
  - `memory-search` now searches both user memories and agent workspace notes
  - `AGENT_WORKSPACE` environment variable passed to external agents
  - ACP Client path validation extended to allow agent workspace access
  - BDD feature spec: `docs/features/15-agent-own-workspace.feature`
- Added browser agent support with Playwright integration
  - `agent-browser` global npm package installed in container
  - Node.js and npm in base image
  - Playwright chromium-headless-shell for automation
  - Comprehensive skill documentation and templates in `skills/agent-browser/`
- Added `dumb-init` wrapper for agent subprocesses for proper signal forwarding

### Changed

- Changed prompt files to mount individually instead of entire directory
  - Allows users to override specific files while keeping container defaults
  - Updated `compose.yml`, Helm templates, and documentation
- Changed OpenCode agent to no longer receive `GITHUB_TOKEN` environment variable
  - OpenCode configured via other provider keys only
  - Documentation updated to describe `GITHUB_TOKEN` as Copilot-only
- Changed default agent token limit from 4096 to 20000
- Changed Gemini CLI to be installed globally via npm in container instead of being pre-cached
  - Agent invokes `gemini` executable directly instead of via `deno task`
- Changed prompt instructions to simplify optional skills lists and add `#memory-search` command guidance
- Changed embedded enabled memories in maintenance prompt to avoid redundant skill calls

### Fixed

- Fixed Kubernetes ConfigMap symlink handling in prompt fragment discovery
  - `loadPromptFragments()` now checks `isSymlink` in addition to `isFile`
- Fixed CI stack overflow during `deno compile` by setting `RUST_MIN_STACK=16777216` (16MB)
- Fixed Helm PVC sync failures in ArgoCD by adding `helm.sh/resource-policy: keep` annotation

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

[Unreleased]: https://github.com/jim60105/AIr-Friends/compare/v0.25.0...HEAD
[0.25.0]: https://github.com/jim60105/AIr-Friends/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/jim60105/AIr-Friends/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/jim60105/AIr-Friends/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/jim60105/AIr-Friends/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/jim60105/AIr-Friends/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/jim60105/AIr-Friends/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/jim60105/AIr-Friends/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/jim60105/AIr-Friends/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/jim60105/AIr-Friends/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/jim60105/AIr-Friends/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/jim60105/AIr-Friends/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/jim60105/AIr-Friends/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/jim60105/AIr-Friends/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/jim60105/AIr-Friends/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/jim60105/AIr-Friends/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/jim60105/AIr-Friends/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/jim60105/AIr-Friends/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/jim60105/AIr-Friends/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/jim60105/AIr-Friends/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/jim60105/AIr-Friends/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/jim60105/AIr-Friends/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/jim60105/AIr-Friends/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/jim60105/AIr-Friends/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/jim60105/AIr-Friends/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jim60105/AIr-Friends/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jim60105/AIr-Friends/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jim60105/AIr-Friends/releases/tag/v0.1.0
