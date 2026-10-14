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

### Requirement: Dashboard Configuration Section

The configuration system SHALL support a `dashboard` config section with `enabled`, `port`, `host`, `passphrase`, `behindHttpsProxy`, and `trustedProxies` fields. Each field SHALL have a corresponding environment variable override.

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

#### Scenario: Dashboard field defaults and passphrase strength

- **GIVEN** the `dashboard` section is absent or partially set in the config
- **WHEN** the configuration is loaded
- **THEN** defaults SHALL apply: `enabled` (boolean `false`), `port` (number `8090`), `host` (string `127.0.0.1`), `behindHttpsProxy` (boolean `false`), and `trustedProxies` (empty array)
- **AND** `trustedProxies` SHALL hold real connection addresses whose `X-Forwarded-For` header is trusted for rate-limit keying
- **AND** `passphrase` SHALL be a string of at least 16 characters and SHALL be required when `enabled` is `true`

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

The configuration system SHALL support reasoning-effort fields at three levels — the global `agent.reasoningEffort`, the per-rule `reasoningEffort` on each `agent.modelRouting.rules[]` entry, and the per-section `reasoningEffort` on `selfResearch`, `memoryMaintenance`, and `conversationSummary` — all sharing one `ReasoningEffort` string type and one normalization helper.

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

#### Scenario: Normalization of empty and unrecognized values

- **GIVEN** a reasoning-effort value at any level is present but empty, or is a token outside the recognized set
- **WHEN** configuration is loaded and normalized
- **THEN** a present-but-empty value SHALL be treated as `"default"`
- **AND** a token outside the recognized values (`"none"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`, `"default"`) SHALL be preserved as passthrough with a warning

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

The configuration system SHALL support a `memory.recall` section whose keys are each optional and fall back to their defaults. Values outside their allowed range SHALL be rejected at load time with a `ConfigError`, and `config.example.yaml` SHALL document every key with its default.

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

#### Scenario: Recall keys and defaults

- **GIVEN** the `memory.recall` section is loaded
- **WHEN** a documented key is missing
- **THEN** it SHALL fall back to its default as listed below

| Key | Type | Default |
|---|---|---|
| `fastRecallMaxResults` | integer ≥ 0 | `2` |
| `fastRecallMaxTokens` | integer ≥ 0 | `192` |
| `minRecallScore` | number ≥ 0 | set by threshold calibration |
| `secondRecallScore` | number ≥ 0 | set by threshold calibration |
| `secondResultRatio` | number in [0, 1] | `0.65` |
| `deepRecallMaxTokens` | integer > 0 | `1024` |
| `deepMinRecallScore` | number ≥ 0 | `0` |

### Requirement: Fixed Memory Budget Configuration

The `memory.recall` configuration section SHALL also support fixed-memory-budget keys, each optional and falling back to its default. Values outside their allowed range SHALL be rejected at load time with a `ConfigError`, and `config.example.yaml` SHALL document every key with its default.

#### Scenario: Budget defaults applied
- **GIVEN** `config.yaml` has no `memory.recall` section
- **WHEN** the configuration is loaded
- **THEN** `coreMaxTokens` SHALL be `512`, `workingMaxItems` `4` and `workingMaxTokens` `384`

#### Scenario: Negative budget rejected
- **GIVEN** `config.yaml` sets `memory.recall.coreMaxTokens: -1`
- **WHEN** the configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError`

#### Scenario: Fixed budget keys and defaults

- **GIVEN** the `memory.recall` section is loaded
- **WHEN** a documented key is missing
- **THEN** `memory.workingTierLimit` SHALL keep its storage meaning and SHALL NOT affect injection
- **AND** each documented key SHALL fall back to its default as listed below

| Key | Type | Default |
|---|---|---|
| `coreMaxTokens` | integer ≥ 0 | `512` |
| `workingMaxItems` | integer ≥ 0 | `4` |
| `workingMaxTokens` | integer ≥ 0 | `384` |

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

The `memory.recall` configuration section SHALL also support note-recall keys, each optional and falling back to its default. Values outside their allowed range SHALL be rejected at load time with a `ConfigError`, and `config.example.yaml` SHALL document every key with its default.

#### Scenario: Note defaults applied
- **GIVEN** `config.yaml` has no `memory.recall` section
- **WHEN** the configuration is loaded
- **THEN** `fastRecallNoteMaxResults` SHALL be `2` and `fastRecallNoteMaxTokens` SHALL be `256`

#### Scenario: Disabling notes in Fast Recall
- **GIVEN** `config.yaml` sets `memory.recall.fastRecallNoteMaxResults: 0`
- **WHEN** Fast Recall runs
- **THEN** no note SHALL be selected

#### Scenario: Note recall keys and defaults

- **GIVEN** the `memory.recall` section is loaded
- **WHEN** a documented key is missing
- **THEN** it SHALL fall back to its default as listed below

| Key | Type | Default |
|---|---|---|
| `fastRecallNoteMaxResults` | integer ≥ 0 | `2` |
| `fastRecallNoteMaxTokens` | integer ≥ 0 | `256` |
| `noteMinRecallScore` | number ≥ 0 | set by note threshold calibration |
| `secondNoteRecallScore` | number ≥ 0 | set by note threshold calibration |

### Requirement: Removed Memory Search Config Fields

`memory.searchLimit` and `memory.maxChars` SHALL NOT exist in the configuration model, the loader defaults, `MemoryStoreConfig`, `ContextAssemblyConfig`, or the startup log. Existing configuration files that still set them SHALL load without error: the keys SHALL be merged and ignored, with no validation, warning, or environment-variable mapping.

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

#### Scenario: Retrieval budget ownership

- **GIVEN** configuration is loaded and a search performs
- **WHEN** retrieval budgets are determined
- **THEN** injection budgets SHALL be owned solely by `memory.recall`
- **AND** search-result budgets SHALL be owned solely by the `memory-search` skill's per-call `limit` parameter

### Requirement: Deployment Agent Type Value Domain And Synchronization

The configuration system SHALL treat `agent.defaultAgentType` as a deployment-level selection with the accepted value domain `"opencode" | "omp"`; the `AGENT_DEFAULT_TYPE` environment override SHALL target the same field and domain. Validation SHALL run at configuration-load time against the final merged value, accepting an omitted value as `"opencode"` and rejecting any other value (including a non-string) with `ConfigError` (`ErrorCode.CONFIG_INVALID`).

#### Scenario: Omitted type keeps the OpenCode default
- **GIVEN** neither the config file nor the environment sets `agent.defaultAgentType`
- **WHEN** configuration is loaded
- **THEN** loading SHALL succeed and the effective default agent type SHALL be `"opencode"`

#### Scenario: OMP selected in the config file
- **GIVEN** `config.yaml` sets `agent.defaultAgentType: "omp"`
- **WHEN** configuration is loaded
- **THEN** loading SHALL succeed and `agent.defaultAgentType` SHALL be `"omp"`

#### Scenario: OMP selected via environment override
- **GIVEN** `AGENT_DEFAULT_TYPE=omp` in the environment and no config-file value
- **WHEN** configuration is loaded
- **THEN** loading SHALL succeed and `agent.defaultAgentType` SHALL be `"omp"`

#### Scenario: Unknown type fails the load through either source
- **GIVEN** `agent.defaultAgentType` resolves to `"pi"`, `"OpenCode"`, `" omp "`, or `""` from the config file, the environment override, or an unresolved `${AGENT_DEFAULT_TYPE}` expansion
- **WHEN** configuration is loaded
- **THEN** loading SHALL fail with `ConfigError` reporting `agent.defaultAgentType` and the valid values `opencode` and `omp`
- **AND** the application SHALL NOT start with an unrecognized agent type deferred to first spawn

#### Scenario: All three configuration documents stay synchronized
- **GIVEN** the repository documentation files after the agent-type domain changed
- **WHEN** `config.example.yaml`, `.env.example`, and `helm/values.yaml` are examined
- **THEN** each SHALL document `AGENT_DEFAULT_TYPE`/`defaultAgentType` with `opencode` as the default and `omp` as a valid value
- **AND** none SHALL claim the field accepts only `opencode`

#### Scenario: Domain change updates all three documents in the same change
- **GIVEN** the accepted domain of `agent.defaultAgentType` changes
- **WHEN** the change is implemented
- **THEN** `config.example.yaml`, `.env.example`, and `helm/values.yaml` SHALL ALL be updated within the same change
- **AND** no document SHALL describe a narrower or wider domain than the loader accepts

### Requirement: Batch Configuration-Documentation Consistency Audit

The repository SHALL carry a completed consistency audit proving that every configuration or environment field introduced or widened by any change in the OMP integration batch is documented consistently across `config.example.yaml`, `.env.example`, and `helm/values.yaml`, with the audit results recorded as a table in the project's agent-facing documentation.

#### Scenario: Every audited field is present in all three files
- **GIVEN** the audited field set from the documentation audit table
- **WHEN** the synchronization test inspects `config.example.yaml`, `.env.example`, and `helm/values.yaml`
- **THEN** each audited field name SHALL be present in every one of the three files
- **AND** the `defaultAgentType`/`AGENT_DEFAULT_TYPE` documentation SHALL describe both `opencode` and `omp` with `opencode` as the default

#### Scenario: Undocumented OMP-related name fails the audit
- **GIVEN** an OMP-related configuration or environment name newly added to one of the three documentation files without a matching audit-table row
- **WHEN** the synchronization test runs
- **THEN** the test SHALL fail, naming the undocumented field and the file

#### Scenario: Drift is repaired documentation-only
- **GIVEN** the audit finds an audited field missing from one of the three files
- **WHEN** the reconciliation is applied
- **THEN** only the affected documentation files SHALL change, mirroring the field's existing treatment in the other files
- **AND** no source, Helm template, or runtime behavior SHALL be modified by the reconciliation

#### Scenario: Minimum audited field set is covered
- **GIVEN** the audited field set of the consistency audit
- **WHEN** it is inspected
- **THEN** it SHALL include at minimum the `agent.defaultAgentType`/`AGENT_DEFAULT_TYPE` value domain with `omp` as a valid value and the `AGENT_OMP_MIN_VERSION` override

#### Scenario: No-new-field batch claims hold under the audit
- **GIVEN** a batch change claiming to introduce no new configuration or environment field
- **WHEN** the audit runs
- **THEN** the change SHALL in fact have added no field to `config.example.yaml`, `.env.example`, or `helm/values.yaml`

#### Scenario: The audit is non-destructive and recorded
- **GIVEN** the audit and any documentation-only drift repair of this final change
- **WHEN** their effects are inspected
- **THEN** the audit SHALL NOT introduce, rename, or remove any configuration or environment field
- **AND** any documentation-only repair SHALL be recorded in this final change

### Requirement: Single User-Runtime Verification Checklist Artifact

The repository SHALL provide exactly one consolidated user-owned runtime verification checklist artifact carrying every observation from the approved integration design's user-verification section, expanded with the per-area runtime items recorded across the batch's OMP documentation.

#### Scenario: Checklist carries the design list unverified
- **WHEN** the consolidated checklist artifact is inspected
- **THEN** every user-owned runtime observation named in the approved design's verification section SHALL appear as a checklist row
- **AND** each active row's runtime outcome SHALL read unverified with space for a user observation, while historically cancelled readiness observations SHALL be marked cancelled by user decision with the accepted residual risk retained
- **AND** no row SHALL cite unit or mock results as runtime verification

#### Scenario: OMP documents resolve to one checklist home
- **GIVEN** any OMP-area documentation file
- **WHEN** its verification pointers are inspected
- **THEN** it SHALL contain an append-only cross-link to the single consolidated checklist artifact
- **AND** the checklist SHALL link back to that file's area with its items enumerated

#### Scenario: Every checklist item separates its evidence into three kinds
- **WHEN** any checklist row is inspected
- **THEN** it SHALL separate source-audit evidence, unit/mock evidence, and user runtime evidence

#### Scenario: Predecessor documentation gains cross-links only
- **GIVEN** a predecessor document with existing verification content
- **WHEN** its cross-link to the consolidated checklist artifact is added
- **THEN** its existing content SHALL be extended with the cross-link only, except the explicitly authorized decision-register section 1a and batch-index synchronization; pinned ledger verdicts SHALL never be rewritten

### Requirement: Batch Documentation Final-Consistency Pass

The final documentation pass SHALL consolidate the batch's change-history entries so that every batch change that owed one has exactly one entry, including a test-lifecycle change whose entry was explicitly deferred to this final change, with no duplicated description of one shipped behavior.

#### Scenario: Deferred changelog entry lands once
- **WHEN** the change history is audited after the final pass
- **THEN** the test-lifecycle change whose changelog entry was deferred SHALL have exactly one entry added by this final change
- **AND** no previously shipped entry SHALL be duplicated or rewritten except a factually wrong entry reconciled with a recorded note

#### Scenario: README states honest status
- **WHEN** the README integration section is read
- **THEN** it SHALL name both supported agent types with the OpenCode default and unknown-value rejection
- **AND** it SHALL state that automated unit and mock evidence does not certify native runtime enforcement and that runtime verification remains user-owned

#### Scenario: README and agent-facing docs state the deployment behavior
- **GIVEN** the README integration section and the agent-facing documentation
- **WHEN** they are read
- **THEN** they SHALL state the available agent types with the OpenCode default and load-time rejection of unknown values
- **AND** they SHALL state the restricted-versus-native-YOLO deployment behavior

#### Scenario: Honest integration status is stated
- **GIVEN** the agent-facing documentation's integration status
- **WHEN** it is read
- **THEN** it SHALL state that the proposals are approved and the implementation lands through the applied changes
- **AND** all seven user dispositions SHALL be described as DECIDED while pinned incompatible/unresolved verdicts stay unchanged and runtime verification stays user-owned/unverified

#### Scenario: Payload-file and prompt contract is recorded in final form
- **WHEN** the documentation of the payload-file and prompt contract is inspected
- **THEN** it SHALL record literal session ids and absolute staging paths in prompts and skill recipes
- **AND** the legacy token-path expansion SHALL be retained for existing OpenCode callers only

### Requirement: Final OMP Decision Register And Batch Synchronization

The final synchronization SHALL preserve the decision register as authoritative, state all seven dispositions DECIDED without relabeling pinned incompatible/unresolved verdicts, record gate-omp-policy-readiness removed from the batch with client-observable readiness cancelled, and state LSP-all-off for OMP restricted+YOLO and OpenCode build+yolo through per-agent OpenCode denies. The CHANGELOG SHALL record those planning decisions and their evidence limits exactly once.

#### Scenario: Final documents reflect decided posture
- **WHEN** the batch-final documentation synchronization completes
- **THEN** decision register and index SHALL retain all seven DECIDED dispositions and unchanged pinned verdicts, show row 13 removed without renumbering, and name both agents and both modes for LSP denial
- **AND** the accepted absent-handler residual risk and cancelled readiness requirement SHALL be recorded without native enforcement claims

#### Scenario: Planning decisions receive one changelog entry
- **WHEN** CHANGELOG is consolidated
- **THEN** the readiness cancellation, row 13 removal and both-agent LSP posture SHALL be recorded once with their evidence limits
- **AND** no mock result SHALL be described as clearing a native compatibility verdict

### Requirement: Stock Image Declares the Shared Skill Install Root

The stock container deployment SHALL explicitly set the single skill-directory configuration to `/home/deno/.agents/skills`, matching both built-in COPY and external publication for every agent type. Helm and deployment examples SHALL document this same installation contract. Repository development SHALL retain relative `skills` resolved against the deployment working directory. Ambient HOME SHALL NOT supply this configuration.

#### Scenario: Stock image requires no missing cwd skill tree

- **GIVEN** the stock image runs from `/app` without an operator skill-directory override
- **WHEN** its existing configuration is loaded
- **THEN** both agent types SHALL select `/home/deno/.agents/skills` from that one configured value
- **AND** neither agent type SHALL select a separately packaged image tree

### Requirement: Current OMP Batch Documentation Distinguishes Archived Baseline and Proposed Corrections

Current OMP documentation SHALL distinguish the 35 archived baseline changes from the five seam-correction proposals and any applied correction. It SHALL preserve cancelled readiness, label historical rows/evidence, reflect superseded public-code-search removal and record issue owners, accepted decisions, dependencies and shared-file conflicts. Artifact validation SHALL NOT imply implementation or native acceptance.

#### Scenario: Archived baseline membership is reported
- **WHEN** the current OMP batch index is synchronized
- **THEN** it SHALL identify 27 original archived changes, seven archived C followups and the archived skill-root-resolution change
- **AND** unrelated non-OMP archive entries SHALL NOT inflate that baseline count

#### Scenario: Historical cancelled and superseded rows stay truthful
- **WHEN** the original readiness and public-code-search rows are shown
- **THEN** readiness SHALL stay cancelled with no handshake or acknowledgement
- **AND** the historical code-search adapter SHALL be labeled superseded by its archived removal, not an active supported capability

#### Scenario: New proposals are not claimed applied
- **WHEN** correction artifacts exist without their implementation having landed
- **THEN** the index SHALL report proposed status with its ownership and application matrix
- **AND** the user's accepted native local read/search and authorized ambient native mutation SHALL NOT be reported as daemon root confinement, a still-pending protected-IO prerequisite or an application-blocked mutation status

#### Scenario: Authorized native mutation is not a pending prerequisite
- **WHEN** the current docs describe ordinary native write/edit beside the accepted native read/search posture
- **THEN** they SHALL record the user's explicit authorization of the ambient native mutation risk and SHALL NOT retain an application-blocked mutation status or a pending mutation-route prerequisite
- **AND** they SHALL NOT claim ACP-sink protection for absolute native session-sandbox/plan targets or an unavailable client bridge, and SHALL NOT reopen the accepted local read/search decision

### Requirement: OMP Boundary Documentation Preserves Evidence Limits

Current OMP boundary documentation SHALL separate source/mock findings, user observations and unverified official-runtime behavior. It SHALL reflect DECIDED deployment dispositions beside unchanged unresolved native verdict strings, retain accepted extension-load residual risk and avoid hard handler-readiness guarantees. Substantive owners SHALL update their behavior docs before final consolidation.

#### Scenario: Extension load failure is not observable readiness
- **WHEN** discovery or launch docs discuss trusted-extension errors
- **THEN** they SHALL distinguish daemon preflight rejection from the pinned runner's accepted extension-error logging risk
- **AND** they SHALL NOT promise authenticated handler presence, guaranteed session/new/load rejection or never-extensionless execution

#### Scenario: Decided dispositions are not new pending approvals
- **WHEN** old unresolved native discovery/skill-selection verdicts are documented
- **THEN** their unchanged strings SHALL appear beside the existing DECIDED deployment dispositions
- **AND** they SHALL NOT be presented as awaiting a second user decision for those old dispositions

#### Scenario: Final docs pass removes current stale claims
- **WHEN** the correction owners' implemented behavior is consolidated
- **THEN** current docs SHALL reflect direct live roster observation, source-specific provenance, independent physical module evidence, delivered quoted root and all owning recovery callers
- **AND** no-runtime-consumer or pooled-only language SHALL NOT remain as a false current-state assertion

#### Scenario: Accepted native status and version audit stay distinct
- **WHEN** current docs describe local native read/search and the official v18.10.3 source investigation
- **THEN** they SHALL record approval plus ambient OS readability beyond daemon roots and the absence of a latest-version confined-IO fix
- **AND** deployment SHALL remain v18.6.1 without an automatic bump, custom broker or obsolete decision blocker

#### Scenario: Runtime checklist and scope invariants remain unchanged
- **WHEN** source/mock documentation is updated without official runtime acceptance
- **THEN** unexercised checklist entries SHALL remain UNVERIFIED and user observations SHALL NOT be rerun or recast as success
- **AND** pins, existing configuration trio, native-YOLO separation, LSP disable scope and sandbox/egress behavior SHALL remain unchanged

### Requirement: Container Health and Skill Readiness Endpoints

The container SHALL provide HTTP health check capability via the HealthCheckServer. Skill readiness SHALL check registered scripts under the single deployment-resolved root used by every selected agent type's prompts and script gate. Root-resolution errors SHALL produce an explicit failed readiness check without consulting an alternate root. Existing liveness behavior and readiness caching SHALL remain unchanged.

#### Scenario: Health Check Server

- **GIVEN** `health.enabled` is `true` and `health.port` is `8080`
- **WHEN** the server starts
- **THEN** `GET /health` and `GET /healthz` SHALL return health status with HTTP 200 (healthy/degraded) or 503 (unhealthy)
- **AND** `GET /ready` and `GET /readyz` SHALL check platform connections and skill readiness

#### Scenario: Readiness uses the single configured root for either agent type

- **GIVEN** built-in scripts exist under the configured `agent.skillsDir`/`AGENT_SKILLS_DIR` root
- **WHEN** skill readiness runs with `opencode` as the default agent and again with `omp` as the default agent
- **THEN** both runs SHALL check registered scripts under that same resolved absolute root
- **AND** removing a registered script from that root SHALL fail its readiness check even when a same-name copy exists outside it

#### Scenario: OpenCode readiness follows container or development installation

- **GIVEN** OpenCode is the default agent in a container or repository deployment
- **WHEN** skill readiness runs
- **THEN** its checks SHALL use the same absolute installed root as the script gate and prompt recipes

#### Scenario: Root failure becomes a readiness failure

- **GIVEN** the selected agent's root cannot be resolved
- **WHEN** either readiness endpoint is requested
- **THEN** it SHALL return HTTP 503 with an explicit failed skill-root check
- **AND** it SHALL NOT report success from another skill tree or propagate an unhandled configuration exception

#### Scenario: Optional external installation failure preserves built-in readiness

- **GIVEN** all registered built-in scripts are present and one optional external install failed
- **WHEN** skill readiness runs
- **THEN** registered-script readiness SHALL remain successful
- **AND** platform/binary/Skill API/workspace checks and the existing 30-second cache SHALL retain their previous behavior

### Requirement: External Skill Auto-Installation Into the Single Skill Root

The system SHALL support automatic installation of external agent skills at startup into the single deployment-resolved skill root supplied by `agent.skillsDir`. External publication SHALL be independent of ambient daemon HOME. Built-ins, external skills and both agent types SHALL share that install root and that one resolved value. External installations SHALL NOT overwrite bundled skills or shared skill libraries and SHALL NOT acquire authority outside the explicit root.

#### Scenario: Skills Configured

- **GIVEN** `agent.externalSkills` contains `[{repo: "jim60105/copilot-prompt", skill: "create-blog-post"}]`
- **WHEN** bootstrap runs
- **THEN** external installation and publication SHALL finish before AgentCore initialization and connector inventory construction
- **AND** the requested skill SHALL be installed through `npx --yes --package=skills skills add <repo> -a universal -s <skill> -g -y --copy` in a private installer HOME and published into the single resolved skill root
- **AND** private installer staging SHALL be removed after success or failure and SHALL never be scanned as an approval root

#### Scenario: Sequential Installation

- **GIVEN** multiple external skills are configured
- **WHEN** installation runs
- **THEN** installation/publication SHALL occur sequentially within the explicit destination

#### Scenario: Individual Failure Isolation

- **GIVEN** one external skill fails to install or publish
- **WHEN** installation continues
- **THEN** the failure SHALL be logged but SHALL NOT block application startup
- **AND** remaining skills SHALL still be attempted
- **AND** an absent skill SHALL contribute no inferred executable grant

#### Scenario: Environment Variable Override

- **GIVEN** `AGENT_EXTERNAL_SKILLS` is set to a JSON string
- **WHEN** environment overrides are applied
- **THEN** the value SHALL be parsed as JSON and override `agent.externalSkills`

#### Scenario: Validation

- **GIVEN** an external skill entry is missing `repo` or `skill`
- **WHEN** config validation runs
- **THEN** the invalid entry SHALL be logged as a warning and filtered out
- **AND** `agent.externalSkills` SHALL default to an empty array when not configured

#### Scenario: Container and development destinations agree with the gate

- **GIVEN** a container's root is `/home/deno/.agents/skills`, or a development deployment's configured root resolves to its repository `skills/`
- **WHEN** an external skill is successfully published
- **THEN** its final path SHALL be contained in that exact deployment's script-root inventory for either agent type
- **AND** changing daemon HOME SHALL change neither the publication destination nor the script grant

#### Scenario: External collision or link escape cannot replace built-ins

- **WHEN** an external skill names a bundled skill or `lib`, contains traversal, or publication encounters a linked/escaping source or destination
- **THEN** publication SHALL fail for that entry without changing the bundled content or any path outside the explicit root
- **AND** the failure SHALL NOT grant the external copy authority the validated publication did not establish

#### Scenario: External installs are shared by both agent types

- **GIVEN** external skills are configured while OMP is the default agent
- **WHEN** bootstrap publishes them into the resolved skill root
- **THEN** publication SHALL target that one root, which every agent type also resolves
- **AND** no second trusted skill root SHALL be selected, installed or auto-approved by this system

### Requirement: One Configured Skill Root For Every Agent Type

The deployment SHALL resolve exactly one absolute skill-script root from the existing `agent.skillsDir` configuration (environment `AGENT_SKILLS_DIR`) for BOTH agent types. No agent type SHALL select a separately packaged tree, an image constant, or a development fallback the other agent type does not also use. The resolved root SHALL be canonical with its physical identity recorded, and an unresolvable root SHALL fail explicitly instead of substituting another tree.

#### Scenario: Only the configured value selects the root

- **GIVEN** `agent.skillsDir`/`AGENT_SKILLS_DIR` names an installed tree and no other skill configuration is set
- **WHEN** an `opencode` session and an `omp` session resolve their skill-script roots
- **THEN** both resolutions SHALL return the byte-identical canonical absolute root
- **AND** neither resolution SHALL consult an image skill root, the repository `skills/` tree, or the agent child's HOME as an alternative selector

#### Scenario: Unset value keeps the documented default

- **GIVEN** `agent.skillsDir` is unset
- **WHEN** either agent type resolves its root
- **THEN** the documented default `skills` SHALL resolve against the deployment working directory
- **AND** an unresolvable value SHALL fail explicitly with no other tree substituted

### Requirement: Generated OpenCode Skill Discovery Declaration

Bootstrap SHALL declare the deployment-resolved skill root to OpenCode by writing that root into the deployed OpenCode global configuration as its skill discovery path and as an allowed external-directory location, preserving every other setting in that file. The declaration SHALL derive from the same resolved value every other consumer uses, SHALL add no configuration field, credential or environment override, and SHALL be written only when the file does not already declare that root.

#### Scenario: A non-default configured root reaches agent discovery

- **GIVEN** the configured skill root is an absolute path other than the container default and it exists
- **WHEN** bootstrap prepares the deployment
- **THEN** the deployed OpenCode global configuration SHALL name exactly that root as its skill discovery path
- **AND** it SHALL allow external-directory reads under that root, and for no parent of that root
- **AND** every other setting in the file, including the routing that sends script executions to the approval gate, SHALL remain byte-identical

#### Scenario: An already-correct declaration is left byte-identical

- **GIVEN** the deployed configuration already names the resolved root — literally or in a home-relative spelling that resolves to it — and already allows external-directory reads under it
- **WHEN** bootstrap prepares the deployment
- **THEN** the file SHALL remain byte-identical
- **AND** no write SHALL be attempted

#### Scenario: An absent configuration is created with the declaration

- **GIVEN** no deployed OpenCode global configuration exists
- **WHEN** bootstrap prepares the deployment
- **THEN** the file SHALL be created containing exactly the declaration entries
- **AND** the created content SHALL declare no other setting, so no pre-existing key is overridden for any other source

#### Scenario: Unwritable declaration fails startup explicitly

- **GIVEN** the configuration must be updated but the file or its directory is not writable
- **WHEN** bootstrap prepares the deployment
- **THEN** startup SHALL fail explicitly, naming the file and the resolved root
- **AND** no agent session SHALL start with a discovery declaration that contradicts the resolved root

#### Scenario: An over-broad allowance is refused

- **GIVEN** the resolved root is the daemon user's home directory or an ancestor of it
- **WHEN** bootstrap prepares the deployment
- **THEN** it SHALL fail explicitly, naming the root and the reason
- **AND** it SHALL NOT write an external-directory allowance for a home-scoped or ancestor path

#### Scenario: An authored rule inside the root is not out-ranked

- **GIVEN** the deployed configuration carries an authorization rule scoped inside the resolved root whose value is not `allow`
- **WHEN** bootstrap prepares the deployment
- **THEN** it SHALL fail explicitly, naming that rule and the resolved root
- **AND** it SHALL NOT write an allowance that overrides the operator's own rule

#### Scenario: Declaration is not an execution authority

- **WHEN** the declaration is written
- **THEN** it SHALL grant discovery and file-read visibility only
- **AND** it SHALL NOT add a second skill root, a script grant, or any authority that the root-exact inventory and the approval gate do not already establish from the same resolved root

### Requirement: Current Native OMP Artifact And Configuration Documentation

Current launch and packaging documentation SHALL identify canonical TypeScript as build input and the selected generated ESM bundle as the native load artifact. Native configuration paths and mutable mode data SHALL be distinguished without physical module ownership, deployment declarations or internal manifest prerequisites.

#### Scenario: Development and image entry
- **WHEN** docs describe the restricted extension argument
- **THEN** they SHALL name generated build/omp-extension/index.js or installed /opt/air/omp/extension/index.js, with no raw-source load fallback.

#### Scenario: Actual build closure
- **WHEN** docs describe the current extension build
- **THEN** they SHALL describe frozen native ESM output and actual required dependencies, without obsolete façade, ownership declaration or manifest-coverage requirements.

#### Scenario: Native configuration location
- **WHEN** docs describe the model file and mode settings
- **THEN** they SHALL name inherited native HOME model provisioning and explicit authored mode YAML; no model-config-path flag SHALL be invented.
