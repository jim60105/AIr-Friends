# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/jim60105/ai-friend/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jim60105/ai-friend/releases/tag/v0.1.0
