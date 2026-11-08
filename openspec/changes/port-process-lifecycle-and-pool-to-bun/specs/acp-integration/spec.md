# Spec Delta

## ADDED Requirements

### Requirement: Escalated Disconnect Reaps The Agent Process Tree

When a disconnect escalates to `SIGKILL`, the connector SHALL send `SIGKILL` to every descendant of the agent wrapper and to the wrapper, so no process started under that wrapper survives.

#### Scenario: Child ignoring SIGTERM
- **GIVEN** an agent whose child process ignores `SIGTERM` and keeps running
- **WHEN** the connector disconnects and the 2-second grace period expires
- **THEN** within 1 second after escalation, no process whose ancestor was the wrapper SHALL remain

#### Scenario: Graceful exit is not escalated
- **GIVEN** an agent that exits on `SIGTERM`
- **WHEN** the connector disconnects
- **THEN** no `SIGKILL` SHALL be sent
