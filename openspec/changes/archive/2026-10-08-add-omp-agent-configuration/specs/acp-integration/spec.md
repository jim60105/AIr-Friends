## MODIFIED Requirements

### Requirement: Supported Agent Types

The system SHALL support exactly two deployment-level agent types: `"opencode"` and `"omp"`, recognized through one shared supported-type set used by configuration validation, default selection, dashboard validation, and factory dispatch. Omitted type remains `"opencode"`. Accepting a type at the configuration/selection layer is distinct from launching it: launch mechanics are owned by later changes, and no component may claim an unimplemented launch path is available.

#### Scenario: OpenCode agent configuration
- **GIVEN** agent type `"opencode"`
- **WHEN** `createAgentConfig()` builds the config
- **THEN** it SHALL use command `opencode acp` with permissions defined in `opencode.json`, passing `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` env vars

#### Scenario: OMP type is accepted at every configuration surface
- **GIVEN** `agent.defaultAgentType` or `AGENT_DEFAULT_TYPE` is `"omp"`
- **WHEN** the configuration is loaded and `getDefaultAgentType()` is called
- **THEN** the load SHALL succeed without a validation error and `getDefaultAgentType()` SHALL return `"omp"`
- **AND** the dashboard chat agent-type validation SHALL accept `"omp"` rather than reject it

#### Scenario: Unknown agent type rejected at load
- **GIVEN** `agent.defaultAgentType` is set to a value outside `"opencode"` and `"omp"` (including a value differing only by case or surrounding whitespace)
- **WHEN** the configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError` naming the field and the valid values, instead of deferring the failure to a later factory call

#### Scenario: Unknown agent type
- **GIVEN** an agent type outside the supported set reaches `createAgentConfig()` through a non-configuration caller
- **WHEN** `createAgentConfig()` builds the config
- **THEN** it SHALL throw an error indicating the agent type is unknown

#### Scenario: Default agent selection
- **GIVEN** no explicit agent type configured
- **WHEN** `getDefaultAgentType()` is called
- **THEN** it SHALL return `"opencode"` as the default

### Requirement: SandboxManager Environment Filtering

The `SandboxManager` SHALL filter subprocess environment variables to a base allowlist plus agent-type-specific variables when `filterEnv` is enabled. The base allowlist SHALL contain only `PATH`, `HOME`, `USER`, `SHELL`, `TERM`, `LANG`, `LC_ALL`, `DENO_DIR`, `DENO_NO_UPDATE_CHECK`, `SKILL_API_PORT`, `SESSION_ID`, `SKILL_JWT_DIR`, `SKILL_SHARED_PROCESS`, `AGENT_WORKSPACE`, `TMPDIR`, `XDG_DATA_HOME`, `AGENT_BROWSER_EXECUTABLE_PATH`, and the egress-proxy variables `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `http_proxy`, `https_proxy`, `no_proxy`. The agent-type set SHALL select ONLY the provider credentials supported for that agent: for `"opencode"`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`; for `"omp"`, `GEMINI_API_KEY` and `OPENROUTER_API_KEY` only (the supported Gemini and OpenRouter credentials). Filtering SHALL additionally enforce never-pass categories that neither the implicit base set nor an operator-configured `agent.sandbox.allowedEnvVars` entry may admit: platform tokens (`DISCORD_TOKEN`, `MISSKEY_TOKEN`), dashboard credentials (`DASHBOARD_PASSPHRASE`), the raw Skill API server secret (`AGENT_SKILL_API_SECRET`), provider credentials outside the agent's supported set (including `OPENCODE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GITHUB_TOKEN`, `COPILOT_GITHUB_TOKEN`, and git-backup credentials), and profile/XDG state selectors that could redirect an agent's scoped state (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OMP_PROFILE`, `PI_PROFILE`, `PI_CODING_AGENT_DIR`). An `allowedEnvVars` entry naming a never-pass variable SHALL be excluded from the effective allowlist with one bounded warning naming the offending name.

#### Scenario: Filtered environment
- **GIVEN** `sandbox.filterEnv` is `true`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** it SHALL include only base allowed vars plus agent-type-specific vars plus any configured `allowedEnvVars` entries that are not never-pass variables

#### Scenario: Unfiltered environment
- **GIVEN** `sandbox.filterEnv` is `false`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** it SHALL pass the agent configuration environment variables without additional sandbox filtering

#### Scenario: Agent-specific environment variables
- **GIVEN** agent type `"opencode"`
- **WHEN** environment is filtered
- **THEN** it SHALL additionally allow `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY`

#### Scenario: OMP agent-specific environment variables
- **GIVEN** agent type `"omp"` and a base environment containing every credential the deployment holds
- **WHEN** environment is filtered
- **THEN** it SHALL additionally allow only `GEMINI_API_KEY` and `OPENROUTER_API_KEY`
- **AND** it SHALL NOT pass `OPENCODE_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`

#### Scenario: Platform and dashboard secrets never reach any agent subprocess
- **GIVEN** `sandbox.filterEnv` is `true`, agent type `omp` or `opencode`, and the base environment contains `DISCORD_TOKEN`, `MISSKEY_TOKEN`, `DASHBOARD_PASSPHRASE`, and `AGENT_SKILL_API_SECRET`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** none of those four variables SHALL be present in the result

#### Scenario: Allowed env vars cannot widen credentials or selectors
- **GIVEN** `sandbox.allowedEnvVars` is configured with `OPENCODE_API_KEY`, `XDG_CONFIG_HOME`, and a benign name `MY_TOOL_FLAG`
- **WHEN** environment is filtered for agent type `omp`
- **THEN** the filtered environment SHALL contain `MY_TOOL_FLAG` but SHALL NOT contain `OPENCODE_API_KEY` or `XDG_CONFIG_HOME`
- **AND** one bounded warning SHALL record each excluded name

#### Scenario: Profile and XDG selectors are not inherited
- **GIVEN** the deployment environment sets `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OMP_PROFILE`, `PI_PROFILE`, or `PI_CODING_AGENT_DIR`
- **WHEN** any agent subprocess environment is filtered
- **THEN** none of those variables SHALL appear in the result

## ADDED Requirements

### Requirement: Scoped Agent State Selectors Are Not Granted By Configuration Acceptance

Passing `XDG_DATA_HOME` in the base allowlist SHALL be understood as the existing OpenCode tool-output scoping mechanism (the factory always sets the value it passes), not as an approval for an OMP process to inherit deployment state selectors. Scoped OMP process state (`PI_CODING_AGENT_DIR` under the selected process's `TMPDIR/omp-agent`, mode-distinct state roots) SHALL be established by the owned-settings and spawn changes, and no requirement in this delta SHALL be read as deciding it.

#### Scenario: Inherited selector is not an OMP state grant
- **GIVEN** agent type `omp` and a filtered environment that carries `XDG_DATA_HOME` from the factory-set value
- **WHEN** a reviewer or downstream change evaluates whether OMP scoped state is established
- **THEN** the presence of the variable SHALL NOT be treated as scoped OMP state
- **AND** the scoped-state requirement SHALL remain owned by the owned-settings and spawn changes
