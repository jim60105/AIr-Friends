## MODIFIED Requirements

### Requirement: Supported Agent Types

The system SHALL support a single agent type: `"opencode"`.

#### Scenario: OpenCode agent configuration
- **GIVEN** agent type `"opencode"`
- **WHEN** `createAgentConfig()` builds the config
- **THEN** it SHALL use command `opencode acp` with permissions defined in `opencode.json`, passing `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` env vars

#### Scenario: Unknown agent type
- **GIVEN** an agent type other than `"opencode"`
- **WHEN** `createAgentConfig()` builds the config
- **THEN** it SHALL throw an error indicating the agent type is unknown

#### Scenario: Default agent selection
- **GIVEN** no explicit agent type configured
- **WHEN** `getDefaultAgentType()` is called
- **THEN** it SHALL return `"opencode"` as the default

### Requirement: SandboxManager Environment Filtering

The `SandboxManager` SHALL filter subprocess environment variables to a base allowlist plus agent-type-specific variables when `filterEnv` is enabled.

#### Scenario: Filtered environment
- **GIVEN** `sandbox.filterEnv` is `true`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** it SHALL include only base allowed vars (`PATH`, `HOME`, `USER`, `SHELL`, `TERM`, `LANG`, `LC_ALL`, `DENO_DIR`, `DENO_NO_UPDATE_CHECK`, `SKILL_API_PORT`, `SESSION_ID`, `AGENT_WORKSPACE`, `TMPDIR`) plus agent-type-specific vars plus any configured `allowedEnvVars`

#### Scenario: Unfiltered environment
- **GIVEN** `sandbox.filterEnv` is `false`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** it SHALL pass the agent configuration environment variables without additional sandbox filtering

#### Scenario: Agent-specific environment variables
- **GIVEN** agent type `"opencode"`
- **WHEN** environment is filtered
- **THEN** it SHALL additionally allow `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY`
