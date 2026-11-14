# Spec Delta

## ADDED Requirements

### Requirement: Browser Executable Resolution

When a session launches an agent that can drive `agent-browser`, the daemon SHALL pass an operator-supplied `AGENT_BROWSER_EXECUTABLE_PATH` through to the agent subprocess unchanged and SHALL otherwise leave browser resolution to `agent-browser`'s own discovery order. It SHALL NOT scan Playwright cache directories or inject an executable path derived from them.

#### Scenario: Operator override wins
- **GIVEN** `AGENT_BROWSER_EXECUTABLE_PATH` is set in the daemon environment
- **WHEN** a per-spawn or pooled agent session is assembled
- **THEN** the spawned agent environment SHALL carry that value unchanged
- **AND** no cache scan SHALL replace or second-guess it

#### Scenario: No override leaves resolution to the CLI
- **GIVEN** `AGENT_BROWSER_EXECUTABLE_PATH` is unset
- **WHEN** an agent session is assembled
- **THEN** no browser executable path SHALL be injected
- **AND** `agent-browser` SHALL resolve its browser through its documented order (its own install cache, then system `PATH`)

#### Scenario: No Playwright cache scan
- **GIVEN** a filesystem containing Playwright browser caches and no operator override
- **WHEN** an agent session is assembled
- **THEN** the daemon SHALL NOT read those cache directories or derive an executable path from them

#### Scenario: Missing browser is not silently substituted
- **GIVEN** no operator override and no browser discoverable by the CLI
- **WHEN** the agent invokes `agent-browser`
- **THEN** the invocation SHALL fail through the CLI's own error
- **AND** the daemon SHALL NOT substitute a different executable

### Requirement: Browser Executable Path Stays Sandbox-Allowlisted

When subprocess environment filtering is enabled, `AGENT_BROWSER_EXECUTABLE_PATH` SHALL remain in the base allowlist so an operator-provided browser path reaches the agent subprocess.

#### Scenario: Filter keeps the browser path
- **GIVEN** `sandbox.filterEnv` is `true` and `AGENT_BROWSER_EXECUTABLE_PATH` is set
- **WHEN** the agent subprocess environment is built
- **THEN** the variable SHALL be present with the operator's value
- **AND** unrelated daemon secrets SHALL still be filtered out
