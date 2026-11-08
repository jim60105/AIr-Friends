## MODIFIED Requirements

### Requirement: Client Timeout

For each agent, a client-side timeout on a prompt with a stalled provider SHALL reject the client's call, and teardown SHALL complete afterward. The abandoned ACP request SHALL settle and SHALL NOT be left hanging. Whether it rejects or resolves is the agent's shutdown choice.

#### Scenario: Stalled provider
- **GIVEN** a provider that accepts the request and sends nothing
- **WHEN** a 3 second client timeout, raced against the prompt, expires
- **THEN** the call SHALL reject with the client timeout, teardown SHALL resolve with the wrapper exited, and the abandoned request SHALL settle within 5 seconds
