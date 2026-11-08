# bun-poc-acp-resilience Specification

## Purpose
Defines how the real OpenCode and OMP executables must behave over ACP with a Bun parent when the stream is slow, cancelled, stalled, killed or closed, before the Bun migration may proceed.

## Requirements

### Requirement: Slow Consumer Keeps Stream Intact

For each agent, a stalled reader of the agent's stdout SHALL lose or reorder nothing.

#### Scenario: Three second stall
- **GIVEN** a reader that stalls for 3 seconds after 1 MiB of a 4 MiB output
- **WHEN** the prompt finishes
- **THEN** the SHA-256 of the collected message text SHALL equal the SHA-256 of the scripted text

### Requirement: Cancellation

For each agent, `session/cancel` during streaming SHALL end the prompt with stop reason `cancelled` within 5 seconds.

#### Scenario: Cancel while streaming
- **GIVEN** a prompt receiving a paced endless stream
- **WHEN** the driver sends `session/cancel` after the first text arrives
- **THEN** the prompt SHALL resolve with stop reason `cancelled` within 5 seconds

### Requirement: Client Timeout

For each agent, a client-side timeout on a prompt with a stalled provider SHALL reject the client's call, and teardown SHALL complete afterward. The abandoned ACP request SHALL settle and SHALL NOT be left hanging. Whether it rejects or resolves is the agent's shutdown choice.

#### Scenario: Stalled provider
- **GIVEN** a provider that accepts the request and sends nothing
- **WHEN** a 3 second client timeout, raced against the prompt, expires
- **THEN** the call SHALL reject with the client timeout, teardown SHALL resolve with the wrapper exited, and the abandoned request SHALL settle within 5 seconds

### Requirement: Abrupt Exit

For each agent, abrupt death during streaming SHALL reject the pending prompt within 3 seconds and resolve `exited`.

#### Scenario: Agent killed mid-stream
- **GIVEN** a prompt receiving a paced endless stream
- **WHEN** the agent process receives SIGKILL
- **THEN** the pending prompt SHALL reject within 3 seconds and `exited` SHALL resolve

### Requirement: End Of Stream

For each agent, after teardown the agent's stdout SHALL end and the ACP connection SHALL report closed within 5 seconds.

#### Scenario: Normal teardown
- **GIVEN** a completed prompt
- **WHEN** teardown runs
- **THEN** the connection's closed signal SHALL resolve within 5 seconds
