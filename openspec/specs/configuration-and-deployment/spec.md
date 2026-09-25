# Configuration and Deployment

## Purpose

Defines the Deno 2.x runtime environment, YAML configuration system with environment variable overrides, container deployment strategy, project structure conventions, and external skill auto-installation.

## Requirements

### Requirement: Deno Runtime with Explicit Permissions

The system SHALL use Deno 2.x as the runtime environment with explicit permission flags. The system SHALL NOT use `--allow-all`.

#### Scenario: Required Permission Flags

- **GIVEN** the application is started via `deno run` or `deno task start`
- **WHEN** the process launches
- **THEN** the following permission flags SHALL be declared: `--allow-net`, `--allow-read`, `--allow-write`, `--allow-env`, `--allow-run`, `--allow-ffi`

#### Scenario: Development Mode with Hot Reload

- **GIVEN** a developer runs `deno task dev`
- **WHEN** the task executes
- **THEN** the process SHALL start with `--watch` flag and all required permissions

#### Scenario: Tests run with native module permission

- **GIVEN** a developer or CI runs any `deno task` that executes tests
- **WHEN** the task executes
- **THEN** the process SHALL include `--allow-ffi` so native modules used by the application can load

#### Scenario: Container image can load the segmenter

- **GIVEN** the container image is built from `Containerfile`
- **WHEN** the container starts with its default command
- **THEN** the command SHALL include `--allow-ffi`
- **AND** the vendored `assets/` directory SHALL be present in the image

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

#### Scenario: Dashboard Enabled Override

- **GIVEN** `DASHBOARD_ENABLED` is set to `"true"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `dashboard.enabled` SHALL be set to boolean `true`

#### Scenario: Dashboard Port Override

- **GIVEN** `DASHBOARD_PORT` is set to `"9000"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `dashboard.port` SHALL be set to integer `9000`

#### Scenario: Dashboard Passphrase Override

- **GIVEN** `DASHBOARD_PASSPHRASE` is set to `"my-secret"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `dashboard.passphrase` SHALL be set to `"my-secret"`

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
- **THEN** defaults SHALL be applied for: `memory` (recentMessageLimit=20, workingTierLimit=20), `logging` (level="INFO"), `health` (enabled=false, port=8080), `skillApi` (enabled=true, port=3001, host="127.0.0.1"), `replyPolicy` ("channels"), `rateLimit`, `gitBackup`, `sandbox`, `idleTimeout`, `dashboard` (enabled=false, port=8090, passphrase=""), and others

#### Scenario: Dashboard Config Defaults

- **GIVEN** the `dashboard` config section is not present in the config file
- **WHEN** validation runs
- **THEN** `dashboard.enabled` SHALL default to `false`
- **AND** `dashboard.port` SHALL default to `8090`
- **AND** `dashboard.passphrase` SHALL default to `""`

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
- **THEN** it SHALL use separate stages: `base` (system packages), `opencode-unpacker` (OpenCode CLI binary), `cache` (Deno dependency cache), and `final` (runtime image)

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
- **THEN** it SHALL contain: `opencode` (OpenCode CLI), `rg` (ripgrep), and `dumb-init`
- **AND** skills SHALL be copied to `/home/deno/.agents/skills/`
- **AND** OpenCode config SHALL be at `/home/deno/.config/opencode/opencode.json`

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
- **AND** the `ci` task's fmt-check and lint steps SHALL be scoped to `src/` and `tests/` — the same scopes as `fmt:check` and `lint`, matching the GitHub Actions workflow — so the task passes on a repository whose non-code assets (vendored data, docs, archives) are not format-managed and whose TypeScript outside `src/` and `tests/` (skill scripts, benchmark scripts) is not lint-managed

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
- **AND** each skill SHALL be installed via `npx --yes --package=skills skills add <repo> -a universal -s <skill> -g -y`

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

### Requirement: Dashboard Configuration Section

The configuration system SHALL support a `dashboard` config section with `enabled` (boolean, default `false`), `port` (number, default `8090`), `host` (string, default `127.0.0.1`), `passphrase` (string, required when enabled, minimum 16 characters), `behindHttpsProxy` (boolean, default `false`), and `trustedProxies` (string array of real connection addresses whose `X-Forwarded-For` header is trusted for rate-limit keying, default empty). Each new field SHALL have a corresponding environment variable override.

#### Scenario: Dashboard Config in YAML

- **GIVEN** `config.yaml` contains:
  ```yaml
  dashboard:
    enabled: true
    port: 8090
    host: "127.0.0.1"
    passphrase: "a-sufficiently-long-secret"
    behindHttpsProxy: false
    trustedProxies: []
  ```
- **WHEN** the configuration is loaded
- **THEN** `dashboard.enabled` SHALL be `true`
- **AND** `dashboard.port` SHALL be `8090`
- **AND** `dashboard.host` SHALL be `"127.0.0.1"`
- **AND** `dashboard.behindHttpsProxy` SHALL be `false`

#### Scenario: Host defaults to localhost

- **GIVEN** `config.yaml` sets `dashboard.enabled: true` without a `host` field
- **WHEN** the configuration is loaded
- **THEN** `dashboard.host` SHALL default to `"127.0.0.1"`

#### Scenario: Weak passphrase rejected when enabled

- **GIVEN** `config.yaml` sets `dashboard.enabled: true` and `dashboard.passphrase: "short"`
- **WHEN** the configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError` indicating the passphrase does not meet the minimum strength

#### Scenario: Environment variable overrides for new dashboard fields

- **GIVEN** environment variables `DASHBOARD_HOST`, `DASHBOARD_BEHIND_HTTPS_PROXY`, and `DASHBOARD_TRUSTED_PROXIES` are set
- **WHEN** the configuration is loaded
- **THEN** they SHALL override `dashboard.host`, `dashboard.behindHttpsProxy`, and `dashboard.trustedProxies` respectively

#### Scenario: Config Example and Env Example Updated

- **GIVEN** the project documentation files
- **WHEN** `config.example.yaml`, `.env.example`, and `helm/values.yaml` are examined
- **THEN** they SHALL include the `dashboard` section with `enabled`, `port`, `host`, `passphrase`, `behindHttpsProxy`, and `trustedProxies` fields

### Requirement: Dashboard Passphrase as Kubernetes Secret

The Helm chart SHALL store `DASHBOARD_PASSPHRASE` as a Kubernetes Secret and reference it in the deployment environment variables.

#### Scenario: Helm Chart Secret

- **GIVEN** the Helm chart templates
- **WHEN** the deployment is rendered with `dashboard.passphrase` set
- **THEN** `DASHBOARD_PASSPHRASE` SHALL be stored in a Kubernetes Secret resource
- **AND** the deployment SHALL reference the Secret via `secretKeyRef` in its environment variables

#### Scenario: Helm Values Updated

- **GIVEN** the `helm/values.yaml` file
- **WHEN** the values are examined
- **THEN** it SHALL include `DASHBOARD_ENABLED`, `DASHBOARD_PORT`, and `DASHBOARD_PASSPHRASE` entries under the `env:` section

### Requirement: Container Dashboard Port Exposure

The Containerfile SHALL expose the dashboard port.

#### Scenario: Dashboard Port Exposed

- **GIVEN** the Containerfile is built
- **WHEN** the final image is produced
- **THEN** the dashboard port (default `8090`) SHALL be exposed via an `EXPOSE` directive

### Requirement: Helm values include dashboard exposure configuration
The `values.yaml` SHALL include a `dashboard` section with `service` and `ingress` sub-keys for configuring dashboard Kubernetes resources, separate from the existing application-level `env.DASHBOARD_*` variables.

#### Scenario: Default values include dashboard section
- **WHEN** a user installs the chart with default values
- **THEN** `values.yaml` SHALL contain a `dashboard` section with `service.enabled: false` and `ingress.enabled: false`

#### Scenario: Dashboard service values
- **WHEN** a user sets `dashboard.service.enabled: true`
- **THEN** the dashboard Service resource SHALL be created with the type from `dashboard.service.type` (default: `ClusterIP`) and port from `dashboard.service.port` (default: `8090`)

#### Scenario: Dashboard ingress values
- **WHEN** a user sets `dashboard.ingress.enabled: true` with hosts configured
- **THEN** the dashboard Ingress resource SHALL be created with the specified hosts, paths, TLS, and annotations

### Requirement: Reasoning Effort Configuration Fields

The configuration system SHALL support reasoning-effort fields at three levels, all sharing one `ReasoningEffort` string type and one normalization helper:
- the **global** `agent.reasoningEffort` (defaults to `"default"` when missing);
- the **per-rule** `reasoningEffort` on each `agent.modelRouting.rules[]` entry (optional, unset when omitted);
- the **per-section** `reasoningEffort` on `selfResearch`, `memoryMaintenance`, and `conversationSummary` (optional, unset when omitted).

The shared normalization SHALL trim and lowercase values, treat present-but-empty as `"default"`, accept the recognized values (`"none"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`, `"default"`), and otherwise preserve the token as passthrough with a warning. Omitted optional per-rule and per-section fields SHALL remain unset (not coerced to `"default"`).

#### Scenario: Global default applied when missing

- **GIVEN** the `agent.reasoningEffort` field is not present in the config file
- **WHEN** configuration validation runs
- **THEN** `agent.reasoningEffort` SHALL default to `"default"`

#### Scenario: Value normalization applies to all levels

- **GIVEN** `agent.reasoningEffort`, a routing rule's `reasoningEffort`, and `selfResearch.reasoningEffort` are each `"  Medium  "`
- **WHEN** configuration is loaded
- **THEN** each SHALL be normalized to `"medium"`

#### Scenario: Extended levels accepted without warning

- **GIVEN** a reasoning-effort field at any level is set to `"xhigh"` or `"MAX"` (or any casing)
- **WHEN** configuration is loaded and normalized
- **THEN** the value SHALL be normalized to lowercase (`"xhigh"` / `"max"`) and SHALL NOT produce the non-standard passthrough warning

#### Scenario: Omitted per-rule/per-section field stays unset

- **GIVEN** a routing rule and a section omit `reasoningEffort`
- **WHEN** configuration is loaded
- **THEN** those fields SHALL remain unset, and SHALL NOT default to `"default"`

#### Scenario: Environment variable overrides the global value

- **GIVEN** `AGENT_REASONING_EFFORT` is set to `"high"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `agent.reasoningEffort` SHALL be set to `"high"`

#### Scenario: Per-rule reasoning effort survives MODEL_ROUTING_RULES JSON

- **GIVEN** `MODEL_ROUTING_RULES` is set to a JSON array containing a rule with a `reasoningEffort` field
- **WHEN** configuration is loaded and the rules are parsed and validated
- **THEN** the rule SHALL retain its `reasoningEffort` field (normalized), and the rule SHALL NOT be dropped because of it

#### Scenario: Config example and env example updated

- **GIVEN** the project documentation files
- **WHEN** `config.example.yaml` and `.env.example` are examined
- **THEN** `config.example.yaml` SHALL document the global `agent.reasoningEffort`, the per-rule `reasoningEffort`, and the per-section `reasoningEffort` fields, and `.env.example` SHALL include the `AGENT_REASONING_EFFORT` environment variable

#### Scenario: Helm values updated

- **GIVEN** the `helm/values.yaml` file
- **WHEN** the values are examined
- **THEN** it SHALL include an `AGENT_REASONING_EFFORT` entry under the `env:` section

### Requirement: Self-Research Completion Verification Configuration

The configuration system SHALL support `selfResearch.verifyCompletion`, a boolean field (default `true`) that controls whether self-research sessions verify research-note production and run the corrective retry. The field SHALL be overridable via the `SELF_RESEARCH_VERIFY_COMPLETION` environment variable (`"true"` / `"false"`, matching the `ENV_MAPPINGS` pattern), and SHALL be documented in `config.example.yaml`, `.env.example`, and `helm/values.yaml` per project convention.

#### Scenario: Default value applied

- **GIVEN** the `selfResearch.verifyCompletion` field is not present in the config file
- **WHEN** configuration validation runs
- **THEN** `selfResearch.verifyCompletion` SHALL default to `true`

#### Scenario: Boolean environment variable override

- **GIVEN** `SELF_RESEARCH_VERIFY_COMPLETION` is set to `"false"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `selfResearch.verifyCompletion` SHALL be set to `false`

#### Scenario: Invalid override falls back to default

- **GIVEN** `SELF_RESEARCH_VERIFY_COMPLETION` is set to a non-boolean value
- **WHEN** `applyEnvOverrides` runs
- **THEN** the override SHALL be ignored with a warning and `selfResearch.verifyCompletion` SHALL keep its default `true`

### Requirement: Memory Recall Configuration

The configuration system SHALL support a `memory.recall` section with the following keys. Every key SHALL be optional and fall back to its default.

| Key | Type | Default |
|---|---|---|
| `fastRecallMaxResults` | integer ≥ 0 | `2` |
| `fastRecallMaxTokens` | integer ≥ 0 | `192` |
| `minRecallScore` | number ≥ 0 | set by threshold calibration |
| `secondRecallScore` | number ≥ 0 | set by threshold calibration |
| `secondResultRatio` | number in [0, 1] | `0.65` |
| `deepRecallMaxTokens` | integer > 0 | `1024` |
| `deepMinRecallScore` | number ≥ 0 | `0` |

Values outside their allowed range SHALL be rejected at load time with a `ConfigError`. `config.example.yaml` SHALL document every key with its default.

#### Scenario: Defaults applied
- **GIVEN** `config.yaml` has no `memory.recall` section
- **WHEN** the configuration is loaded
- **THEN** `memory.recall.fastRecallMaxResults` SHALL be `2` and `memory.recall.secondResultRatio` SHALL be `0.65`

#### Scenario: Partial override
- **GIVEN** `config.yaml` sets only `memory.recall.fastRecallMaxTokens: 128`
- **WHEN** the configuration is loaded
- **THEN** `fastRecallMaxTokens` SHALL be `128` and every other key SHALL keep its default

#### Scenario: Invalid ratio rejected
- **GIVEN** `config.yaml` sets `memory.recall.secondResultRatio: 1.5`
- **WHEN** the configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError`

### Requirement: Fixed Memory Budget Configuration

The `memory.recall` configuration section SHALL also support the following keys. Every key SHALL be optional and fall back to its default.

| Key | Type | Default |
|---|---|---|
| `coreMaxTokens` | integer ≥ 0 | `512` |
| `workingMaxItems` | integer ≥ 0 | `4` |
| `workingMaxTokens` | integer ≥ 0 | `384` |

Values outside their allowed range SHALL be rejected at load time with a `ConfigError`. `memory.workingTierLimit` SHALL keep its storage meaning and SHALL NOT affect injection. `config.example.yaml` SHALL document every key with its default.

#### Scenario: Budget defaults applied
- **GIVEN** `config.yaml` has no `memory.recall` section
- **WHEN** the configuration is loaded
- **THEN** `coreMaxTokens` SHALL be `512`, `workingMaxItems` `4` and `workingMaxTokens` `384`

#### Scenario: Negative budget rejected
- **GIVEN** `config.yaml` sets `memory.recall.coreMaxTokens: -1`
- **WHEN** the configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError`

### Requirement: Fast Recall Toggle Configuration

The `memory.recall` configuration section SHALL support `fastRecallEnabled` (boolean, default `true`). When it is `false`, no Fast Recall search SHALL run and no Fast Recall section SHALL be rendered. `config.example.yaml` SHALL document the key.

#### Scenario: Enabled by default
- **GIVEN** `config.yaml` has no `memory.recall.fastRecallEnabled`
- **WHEN** the configuration is loaded
- **THEN** `memory.recall.fastRecallEnabled` SHALL be `true`

#### Scenario: Non-boolean rejected
- **GIVEN** `config.yaml` sets `memory.recall.fastRecallEnabled: "yes"`
- **WHEN** the configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError`

### Requirement: Note Recall Configuration

The `memory.recall` configuration section SHALL also support the following keys. Every key SHALL be optional and fall back to its default.

| Key | Type | Default |
|---|---|---|
| `fastRecallNoteMaxResults` | integer ≥ 0 | `2` |
| `fastRecallNoteMaxTokens` | integer ≥ 0 | `256` |
| `noteMinRecallScore` | number ≥ 0 | set by note threshold calibration |
| `secondNoteRecallScore` | number ≥ 0 | set by note threshold calibration |

Values outside their allowed range SHALL be rejected at load time with a `ConfigError`. `config.example.yaml` SHALL document every key with its default.

#### Scenario: Note defaults applied
- **GIVEN** `config.yaml` has no `memory.recall` section
- **WHEN** the configuration is loaded
- **THEN** `fastRecallNoteMaxResults` SHALL be `2` and `fastRecallNoteMaxTokens` SHALL be `256`

#### Scenario: Disabling notes in Fast Recall
- **GIVEN** `config.yaml` sets `memory.recall.fastRecallNoteMaxResults: 0`
- **WHEN** Fast Recall runs
- **THEN** no note SHALL be selected

### Requirement: Removed Memory Search Config Fields

`memory.searchLimit` and `memory.maxChars` SHALL NOT exist in the configuration model, the loader defaults, `MemoryStoreConfig`, `ContextAssemblyConfig`, or the startup log. Retrieval budgets are owned solely by `memory.recall` (injection) and the `memory-search` skill's per-call `limit` parameter (search results). Existing configuration files that still set `memory.searchLimit` or `memory.maxChars` SHALL load without error: the keys are merged and ignored, with no validation, warning, or environment-variable mapping.

#### Scenario: Fields absent from loaded config

- **GIVEN** a `config.yaml` that does not set `memory.searchLimit` or `memory.maxChars`
- **WHEN** the configuration is loaded
- **THEN** the `memory` section SHALL NOT contain `searchLimit` or `maxChars`: the fields are absent from the config model and the loader injects no defaults for them
- **AND** when a legacy file does set them, the merged values SHALL be inert and never read (see "Legacy keys ignored")

#### Scenario: Legacy keys ignored

- **GIVEN** a `config.yaml` that sets `memory.searchLimit: 5` and `memory.maxChars: 1000`
- **WHEN** the configuration is loaded
- **THEN** loading SHALL succeed with no error and no startup log field derived from those values
- **AND** retrieval budgets SHALL be unaffected by them

#### Scenario: Surviving knobs unchanged

- **GIVEN** `memory.workingTierLimit`, a `memory.recall` budget, and a `memory-search` call with an explicit `limit`
- **WHEN** the configuration is loaded and a search runs
- **THEN** each SHALL behave exactly as specified before this removal
