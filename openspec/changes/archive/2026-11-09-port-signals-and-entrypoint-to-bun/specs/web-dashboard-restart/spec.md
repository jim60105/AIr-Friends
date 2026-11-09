# Spec Delta

## ADDED Requirements

### Requirement: Restart Request Runs The Graceful Shutdown Flow

A confirmed restart request SHALL lead to the graceful shutdown flow running in the same process, not to an immediate termination by the default signal action.

#### Scenario: Confirmed restart in a running daemon process
- **GIVEN** a process running the dashboard server with the shutdown handler's signal handlers registered and a recording shutdown context
- **WHEN** an authenticated client posts a confirmed restart request
- **THEN** the recording context SHALL observe the dashboard server being stopped before the process exits with code 0
