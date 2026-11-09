## MODIFIED Requirements

### Requirement: Large Traffic Integrity

For each agent, large ACP traffic SHALL arrive unchanged in both directions. Scripted provider text SHALL be non-periodic, so that an agent's model-output loop detection cannot end the stream.

#### Scenario: Large agent output
- **GIVEN** a provider scripted with 16 MiB of non-periodic text in 256 KiB deltas
- **WHEN** the prompt finishes
- **THEN** the SHA-256 of the collected message text SHALL equal the SHA-256 of the scripted text

#### Scenario: Large prompt
- **GIVEN** a 1 MiB prompt holding a known marker string
- **WHEN** the prompt is sent
- **THEN** the request body seen by the provider SHALL contain the whole 1 MiB string
