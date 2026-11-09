# Spec Delta

## Purpose

Defines what the real OpenCode and OMP executables must show over ACP with a Bun parent, against a scripted loopback provider, before the Bun migration may proceed.

## ADDED Requirements

### Requirement: Agent Handshake And Prompt

For each agent, the driver SHALL complete ACP initialization, session creation and a prompt, ending with stop reason `end_turn` and the provider's scripted text.

#### Scenario: Scripted prompt
- **GIVEN** a running agent and a provider scripted with a known text
- **WHEN** a prompt is sent
- **THEN** the collected message text SHALL equal the scripted text and the stop reason SHALL be `end_turn`

### Requirement: Large Traffic Integrity

For each agent, large ACP traffic SHALL arrive unchanged in both directions.

#### Scenario: Large agent output
- **GIVEN** a provider scripted with 16 MiB of text in 256 KiB deltas
- **WHEN** the prompt finishes
- **THEN** the SHA-256 of the collected message text SHALL equal the SHA-256 of the scripted text

#### Scenario: Large prompt
- **GIVEN** a 1 MiB prompt holding a known marker string
- **WHEN** the prompt is sent
- **THEN** the request body seen by the provider SHALL contain the whole 1 MiB string

### Requirement: Real Agent Environment

For each agent, the running agent's real environment SHALL hold the required variables and no parent sentinel, in every process of its tree.

#### Scenario: Sentinel secrets in the parent
- **GIVEN** sentinel values for `AIR_POC_SECRET_TOKEN`, `DISCORD_TOKEN`, `OPENROUTER_API_KEY` and `SKILL_API_SECRET` in the parent environment
- **WHEN** the environment of every descendant of the wrapper is read after handshake
- **THEN** no sentinel name or value SHALL appear and `PATH` and `HOME` SHALL be present with the passed values

### Requirement: Real Agent Teardown

For each agent, SIGTERM teardown SHALL leave no process of the agent's tree alive.

#### Scenario: Teardown after a prompt
- **GIVEN** a running agent with its descendants recorded
- **WHEN** teardown finishes
- **THEN** no recorded process SHALL remain alive
