Feature: Agent Subprocess Sandbox Hardening
  As a bot operator
  I want configurable sandbox isolation for Agent subprocesses
  So that sensitive credentials are not leaked and network access can be restricted

  Background:
    Given the bot is running with an ACP Agent configured
    And the SandboxManager is initialized with the agent sandbox configuration

  # --- Env var filtering enabled ---

  Scenario: filterEnv: true restricts subprocess to whitelisted env vars only
    Given the sandbox config has filterEnv: true
    And the parent process has env vars PATH, HOME, DISCORD_TOKEN, and SECRET_KEY
    When the Agent subprocess is spawned
    Then the subprocess receives PATH and HOME
    And the subprocess does NOT receive DISCORD_TOKEN
    And the subprocess does NOT receive SECRET_KEY

  Scenario: filterEnv: true preserves all base allowed env vars
    Given the sandbox config has filterEnv: true
    And the parent process has PATH, HOME, USER, SHELL, TERM, LANG, LC_ALL
    And the parent process has DENO_DIR, DENO_NO_UPDATE_CHECK
    And the parent process has SKILL_API_PORT, SESSION_ID, AGENT_WORKSPACE, TMPDIR
    When the Agent subprocess is spawned
    Then all of those env vars are passed to the subprocess

  Scenario: filterEnv: true excludes env vars not present in parent process
    Given the sandbox config has filterEnv: true
    And the parent process only has PATH set
    When the Agent subprocess is spawned for agent type "copilot"
    Then the subprocess receives PATH
    And the subprocess does NOT receive HOME
    And the subprocess does NOT receive GITHUB_TOKEN

  # --- Env var filtering disabled ---

  Scenario: filterEnv: false passes all parent env vars through
    Given the sandbox config has filterEnv: false
    And the parent process has PATH, SECRET_TOKEN, and RANDOM_VAR
    When the Agent subprocess is spawned
    Then the subprocess receives PATH, SECRET_TOKEN, and RANDOM_VAR

  # --- Agent-type-specific env vars ---

  Scenario: Copilot agent receives GITHUB_TOKEN and COPILOT_GITHUB_TOKEN
    Given the sandbox config has filterEnv: true
    And the parent process has GITHUB_TOKEN, COPILOT_GITHUB_TOKEN, and GEMINI_API_KEY
    When the Agent subprocess is spawned for agent type "copilot"
    Then the subprocess receives GITHUB_TOKEN and COPILOT_GITHUB_TOKEN
    And the subprocess does NOT receive GEMINI_API_KEY

  Scenario: Gemini agent receives GEMINI_API_KEY and GEMINI_SYSTEM_MD
    Given the sandbox config has filterEnv: true
    And the parent process has GEMINI_API_KEY, GEMINI_SYSTEM_MD, and GITHUB_TOKEN
    When the Agent subprocess is spawned for agent type "gemini"
    Then the subprocess receives GEMINI_API_KEY and GEMINI_SYSTEM_MD
    And the subprocess does NOT receive GITHUB_TOKEN

  Scenario: OpenCode agent receives multiple provider API keys
    Given the sandbox config has filterEnv: true
    And the parent process has GEMINI_API_KEY, OPENROUTER_API_KEY, OPENCODE_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, OPENCODE_YOLO, and GITHUB_TOKEN
    When the Agent subprocess is spawned for agent type "opencode"
    Then the subprocess receives GEMINI_API_KEY, OPENROUTER_API_KEY, OPENCODE_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, and OPENCODE_YOLO
    And the subprocess does NOT receive GITHUB_TOKEN

  Scenario: Unknown agent type only receives base allowed env vars
    Given the sandbox config has filterEnv: true
    And the parent process has PATH, GITHUB_TOKEN, and GEMINI_API_KEY
    When the Agent subprocess is spawned for agent type "unknown"
    Then the subprocess receives PATH
    And the subprocess does NOT receive GITHUB_TOKEN
    And the subprocess does NOT receive GEMINI_API_KEY

  # --- Custom allowedEnvVars ---

  Scenario: allowedEnvVars passes additional custom env vars through
    Given the sandbox config has filterEnv: true
    And the sandbox config has allowedEnvVars: ["MY_CUSTOM_VAR"]
    And the parent process has PATH, MY_CUSTOM_VAR, and OTHER_VAR
    When the Agent subprocess is spawned
    Then the subprocess receives PATH and MY_CUSTOM_VAR
    And the subprocess does NOT receive OTHER_VAR

  Scenario: allowedEnvVars works alongside agent-type-specific vars
    Given the sandbox config has filterEnv: true
    And the sandbox config has allowedEnvVars: ["EXTRA_KEY"]
    And the parent process has PATH, GITHUB_TOKEN, and EXTRA_KEY
    When the Agent subprocess is spawned for agent type "copilot"
    Then the subprocess receives PATH, GITHUB_TOKEN, and EXTRA_KEY

  # --- Network isolation on Linux ---

  Scenario: networkIsolation: true on Linux wraps command with unshare --net
    Given the sandbox config has networkIsolation: true
    And the system is running on Linux
    And the "unshare" binary is available on PATH
    When the Agent subprocess is spawned with command "copilot" and args ["--acp"]
    Then the spawn command is "unshare"
    And the spawn args are ["--net", "copilot", "--acp"]

  Scenario: networkIsolation: false does not modify the command
    Given the sandbox config has networkIsolation: false
    When the Agent subprocess is spawned with command "copilot" and args ["--acp"]
    Then the spawn command is "copilot"
    And the spawn args are ["--acp"]

  # --- Network isolation graceful degradation ---

  Scenario: networkIsolation: true on non-Linux falls back gracefully
    Given the sandbox config has networkIsolation: true
    And the system is NOT running on Linux
    When the Agent subprocess is spawned with command "copilot" and args ["--acp"]
    Then the spawn command is "copilot" (unchanged)
    And a warning is logged: "Network isolation requested but not on Linux, skipping"

  Scenario: networkIsolation: true without unshare binary falls back gracefully
    Given the sandbox config has networkIsolation: true
    And the system is running on Linux
    And the "unshare" binary is NOT available on PATH
    When the Agent subprocess is spawned with command "copilot" and args ["--acp"]
    Then the spawn command is "copilot" (unchanged)
    And a warning is logged: "Network isolation requested but unshare not available"

  Scenario: Sandbox config errors do not prevent Agent startup
    Given the sandbox config has networkIsolation: true
    And the network isolation check throws an unexpected error
    When the Agent subprocess is spawned
    Then the command is returned unchanged
    And a warning is logged: "Network isolation check failed, skipping"
    And the Agent starts successfully

  # --- Environment variable overrides ---

  Scenario: AGENT_SANDBOX_FILTER_ENV overrides config filterEnv
    Given the config file has agent.sandbox.filterEnv: false
    And the environment variable AGENT_SANDBOX_FILTER_ENV is set to "true"
    When the sandbox configuration is loaded
    Then filterEnv is true

  Scenario: AGENT_SANDBOX_NETWORK_ISOLATION overrides config networkIsolation
    Given the config file has agent.sandbox.networkIsolation: false
    And the environment variable AGENT_SANDBOX_NETWORK_ISOLATION is set to "true"
    When the sandbox configuration is loaded
    Then networkIsolation is true

  Scenario: AGENT_SANDBOX_ALLOWED_ENV_VARS overrides config allowedEnvVars
    Given the config file has agent.sandbox.allowedEnvVars: []
    And the environment variable AGENT_SANDBOX_ALLOWED_ENV_VARS is set to "VAR_A,VAR_B"
    When the sandbox configuration is loaded
    Then allowedEnvVars contains "VAR_A" and "VAR_B"

  # --- Workspace cwd passthrough ---

  Scenario: Workspace cwd is passed through to spawn options
    Given the sandbox config has filterEnv: false
    When the Agent subprocess is spawned with cwd "/app/data/workspaces/discord/123"
    Then the spawn options cwd is "/app/data/workspaces/discord/123"
