# Configuration and Deployment

## Purpose

Defines the Deno 2.x runtime environment, YAML configuration system with environment variable overrides, container deployment strategy, project structure conventions, and external skill auto-installation.

## Requirements

### Requirement: Deno Runtime with Explicit Permissions

The system SHALL use Deno 2.x as the runtime environment with explicit permission flags. The system SHALL NOT use `--allow-all`.

#### Scenario: Required Permission Flags

- **GIVEN** the application is started via `deno run` or `deno task start`
- **WHEN** the process launches
- **THEN** the following permission flags SHALL be declared: `--allow-net`, `--allow-read`, `--allow-write`, `--allow-env`, `--allow-run`

#### Scenario: Development Mode with Hot Reload

- **GIVEN** a developer runs `deno task dev`
- **WHEN** the task executes
- **THEN** the process SHALL start with `--watch` flag and all required permissions

### Requirement: YAML Configuration Loading

The system SHALL load configuration from YAML files with a defined merge order: defaults → base config → environment-specific config → environment variables.

#### Scenario: Default Config Path

- **GIVEN** no custom config path is specified
- **WHEN** the application starts
- **THEN** the system SHALL attempt to load `./config.yaml`

#### Scenario: Environment-Specific Config Override

- **GIVEN** `DENO_ENV` or `ENV` is set to `"production"`
- **WHEN** configuration is loaded
- **THEN** the system SHALL load `config.yaml` first, then deep-merge `config.production.yaml` on top if it exists
- **AND** the environment SHALL default to `"development"` when neither `DENO_ENV` nor `ENV` is set

#### Scenario: Environment Variable Syntax in Config Values

- **GIVEN** a config value contains `${DISCORD_TOKEN}`
- **WHEN** the config is loaded
- **THEN** the `expandEnvVars` function SHALL replace `${VAR_NAME}` with the corresponding environment variable value
- **AND** unresolved references (env var not set) SHALL be replaced with empty string

### Requirement: Environment Variable Overrides via ENV_MAPPINGS

The system SHALL support environment variable overrides for configuration fields as defined in the `ENV_MAPPINGS` constant in `src/utils/env.ts`.

#### Scenario: String Override

- **GIVEN** `DISCORD_TOKEN` environment variable is set to `"my-token"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `platforms.discord.token` SHALL be set to `"my-token"`

#### Scenario: Boolean Conversion

- **GIVEN** `DISCORD_ENABLED` is set to `"true"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be converted to boolean `true`

#### Scenario: Integer Conversion

- **GIVEN** `HEALTH_PORT` is set to `"9090"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be converted to integer `9090`

#### Scenario: Comma-Separated Array

- **GIVEN** `AGENT_SANDBOX_ALLOWED_ENV_VARS` is set to `"FOO,BAR,BAZ"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be parsed into `["FOO", "BAR", "BAZ"]`

#### Scenario: JSON String Override

- **GIVEN** `CHANNELS` is set to a valid JSON array string
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be parsed as JSON and set as the config value
- **AND** invalid JSON SHALL be silently skipped

#### Scenario: Reply Policy Backward Compatibility

- **GIVEN** `REPLY_POLICY` or `REPLY_TO` is set to `"whitelist"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be mapped to `"channels"`

### Requirement: Configuration Validation

The system SHALL validate the final merged configuration and reject invalid configs.

#### Scenario: Required Fields

- **GIVEN** the merged configuration is assembled
- **WHEN** `validateConfig` runs
- **THEN** it SHALL verify the presence of `platforms.discord.token`, `agent.model`, `agent.systemPromptPath`, `workspace.repoPath`, and `workspace.workspacesDir`
- **AND** missing required fields SHALL throw `ConfigError` with `ErrorCode.CONFIG_MISSING_FIELD`

#### Scenario: At Least One Platform Enabled

- **GIVEN** no platform has `enabled: true`
- **WHEN** validation runs
- **THEN** a `ConfigError` with `ErrorCode.CONFIG_INVALID` SHALL be thrown with message "At least one platform must be enabled"

#### Scenario: Reply Policy Validation

- **GIVEN** `replyPolicy` is set to an invalid value
- **WHEN** validation runs
- **THEN** a `ConfigError` SHALL be thrown listing valid values: `"all"`, `"public"`, `"channels"`

#### Scenario: Channel ID Format Validation

- **GIVEN** a channel entry has an invalid ID format
- **WHEN** `loadChannels` processes it
- **THEN** the invalid entry SHALL be logged as a warning and skipped
- **AND** valid formats SHALL match `{platform}/account/{id}`, `{platform}/channel/{id}`, or `misskey/timeline/self`

#### Scenario: Spontaneous Post Interval Validation

- **GIVEN** `spontaneousPost.minIntervalMs` exceeds `maxIntervalMs`
- **WHEN** validation runs
- **THEN** the values SHALL be swapped
- **AND** `minIntervalMs` below 60000 SHALL be clamped to 60000

#### Scenario: Default Values Applied

- **GIVEN** optional config sections are missing
- **WHEN** validation runs
- **THEN** defaults SHALL be applied for: `memory` (searchLimit=10, maxChars=2000, recentMessageLimit=20), `logging` (level="INFO"), `health` (enabled=false, port=8080), `skillApi` (enabled=true, port=3001, host="127.0.0.1"), `replyPolicy` ("channels"), `rateLimit`, `gitBackup`, `sandbox`, `idleTimeout`, and others

### Requirement: MCP Server Config Validation

The system SHALL validate external MCP server configurations during config loading.

#### Scenario: Stdio Transport Validation

- **GIVEN** an MCP server with stdio transport (default)
- **WHEN** validation runs
- **THEN** a `command` field SHALL be required; entries without it SHALL be skipped with a warning

#### Scenario: HTTP/SSE Transport Validation

- **GIVEN** an MCP server with `transport: "http"` or `"sse"`
- **WHEN** validation runs
- **THEN** a `url` field SHALL be required

#### Scenario: Duplicate Name Detection

- **GIVEN** two MCP servers share the same `name`
- **WHEN** validation runs
- **THEN** the duplicate SHALL be skipped with a warning

#### Scenario: Environment Variable Expansion in MCP Config

- **GIVEN** an MCP server's `env`, `headers`, or `url` contains `${ENV_VAR}` syntax
- **WHEN** validation runs
- **THEN** those values SHALL be expanded using `expandEnvVars`

### Requirement: Multi-Stage Container Build

The container image SHALL use multi-stage builds with the Deno official Debian image as base.

#### Scenario: Build Stages

- **GIVEN** the Containerfile is built
- **WHEN** the build executes
- **THEN** it SHALL use separate stages: `base` (system packages), `copilot-unpacker` (Copilot CLI binary), `opencode-unpacker` (OpenCode CLI binary), `cache` (Deno dependency cache), and `final` (runtime image)

#### Scenario: Dependency Caching

- **GIVEN** the `cache` stage runs
- **WHEN** `deno cache --lock=deno.lock src/main.ts` executes
- **THEN** all Deno dependencies SHALL be pre-cached for layer reuse

### Requirement: Non-Root Container Execution

The container SHALL run as a non-root user for security.

#### Scenario: User Setup

- **GIVEN** the container is built with default `UID=1000`
- **WHEN** the final stage runs
- **THEN** the `USER $UID` directive SHALL switch to the non-privileged user
- **AND** directories `/app`, `/app/data`, `/deno-dir/`, `/home/deno/` SHALL be owned by that UID with group 0 (OpenShift compatibility)

### Requirement: Persistent Volumes

The container SHALL declare volumes for persistent data and customizable prompts.

#### Scenario: Volume Declarations

- **GIVEN** the container runs
- **WHEN** volumes are mounted
- **THEN** `/app/data` SHALL be the persistent data volume
- **AND** `/app/prompts` SHALL be the optional prompt override volume
- **AND** container restarts SHALL preserve data in `/app/data`

#### Scenario: Custom Prompt Override

- **GIVEN** a user mounts a custom file to `/app/prompts/character_name.md`
- **WHEN** the system loads prompts
- **THEN** only the mounted file SHALL be overridden; other prompt files SHALL retain bundled defaults

### Requirement: Graceful Shutdown via dumb-init

The container SHALL use `dumb-init` as PID 1 for proper signal handling.

#### Scenario: Signal Forwarding

- **GIVEN** the container is running
- **WHEN** a `SIGTERM` signal is sent
- **THEN** `dumb-init` SHALL forward the signal to the Deno process
- **AND** the `STOPSIGNAL` SHALL be `SIGTERM`
- **AND** the entrypoint SHALL be `["dumb-init", "--"]`

### Requirement: Health Check Endpoint in Container

The container SHALL provide HTTP health check capability via the `HealthCheckServer`.

#### Scenario: Health Check Server

- **GIVEN** `health.enabled` is `true` and `health.port` is `8080`
- **WHEN** the server starts
- **THEN** `GET /health` and `GET /healthz` SHALL return health status with HTTP 200 (healthy/degraded) or 503 (unhealthy)
- **AND** `GET /ready` and `GET /readyz` SHALL check platform connections and skill readiness

### Requirement: Pre-Installed Binaries

The container SHALL include pre-installed agent binaries and tools.

#### Scenario: Binary Availability

- **GIVEN** the container is built
- **WHEN** the final image is produced
- **THEN** it SHALL contain: `copilot` (GitHub Copilot CLI), `opencode` (OpenCode CLI), `gemini` (Gemini CLI via npm), `rg` (ripgrep), and `dumb-init`
- **AND** skills SHALL be copied to `/home/deno/.agents/skills/`
- **AND** OpenCode config SHALL be at `/home/deno/.config/opencode/opencode.json`
- **AND** Gemini settings SHALL be at `/home/deno/.gemini/settings.json`

### Requirement: OCI Labels

The container image SHALL include OCI-compliant labels for metadata.

#### Scenario: Label Content

- **GIVEN** the Containerfile is built with `VERSION` and `RELEASE` args
- **WHEN** the image is produced
- **THEN** it SHALL include labels: `name`, `vendor`, `maintainer`, `url`, `version`, `release`, `io.k8s.display-name`, `summary`, and `description`

### Requirement: Deno Project Structure

The project SHALL use `deno.json` as the central configuration file with import aliases and task definitions.

#### Scenario: Import Aliases

- **GIVEN** `deno.json` defines import aliases
- **WHEN** source code imports modules
- **THEN** the following aliases SHALL be available: `@core/` → `./src/core/`, `@platforms/` → `./src/platforms/`, `@skills/` → `./src/skills/`, `@types/` → `./src/types/`, `@utils/` → `./src/utils/`, `@acp/` → `./src/acp/`

#### Scenario: Task Definitions

- **GIVEN** `deno.json` defines tasks
- **WHEN** a developer runs `deno task <name>`
- **THEN** the following tasks SHALL be available: `dev` (watch mode), `start` (production), `test` (parallel tests), `fmt` (format), `lint` (lint), `check` (type check), `ci` (fmt check + lint + type check + test)

#### Scenario: Formatting Rules

- **GIVEN** `deno.json` defines `fmt` settings
- **WHEN** `deno fmt` runs
- **THEN** it SHALL enforce: `lineWidth: 100`, `indentWidth: 2`, `useTabs: false`, `singleQuote: false`, `proseWrap: "preserve"`

#### Scenario: Compiler Options

- **GIVEN** `deno.json` defines `compilerOptions`
- **WHEN** `deno check` runs
- **THEN** it SHALL enforce: `strict: true`, `noImplicitAny: true`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`

#### Scenario: Lock File

- **GIVEN** `deno.lock` exists in the repository
- **WHEN** dependencies are resolved
- **THEN** the lock file SHALL be committed to version control
- **AND** CI/container builds SHALL use `--lock=deno.lock` for reproducibility

### Requirement: External Skill Auto-Installation

The system SHALL support automatic installation of external agent skills at startup.

#### Scenario: Skills Configured

- **GIVEN** `agent.externalSkills` contains `[{repo: "jim60105/copilot-prompt", skill: "create-blog-post"}]`
- **WHEN** bootstrap runs
- **THEN** `installExternalSkills` SHALL run before `AgentCore` initialization
- **AND** each skill SHALL be installed via `deno x -y skills add <repo> -a universal -s <skill> -g -y`

#### Scenario: Sequential Installation

- **GIVEN** multiple external skills are configured
- **WHEN** installation runs
- **THEN** skills SHALL be installed sequentially to avoid filesystem conflicts in `~/.agents/skills/`

#### Scenario: Individual Failure Isolation

- **GIVEN** one external skill fails to install
- **WHEN** installation continues
- **THEN** the failure SHALL be logged but SHALL NOT block application startup
- **AND** remaining skills SHALL still be attempted

#### Scenario: Environment Variable Override

- **GIVEN** `AGENT_EXTERNAL_SKILLS` is set to a JSON string
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be parsed as JSON and override `agent.externalSkills`

#### Scenario: Validation

- **GIVEN** an external skill entry is missing `repo` or `skill`
- **WHEN** config validation runs
- **THEN** the invalid entry SHALL be logged as a warning and filtered out
- **AND** `agent.externalSkills` SHALL default to an empty array when not configured
