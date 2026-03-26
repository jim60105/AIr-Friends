## MODIFIED Requirements

### Requirement: Spontaneous Post Session Cleanup

The spontaneous post session cleanup SHALL disconnect the agent, remove the session from the registry, and clean up temporary files (tmp directory). SESSION_ID file cleanup is no longer needed.

#### Scenario: Session cleanup after spontaneous post
- **GIVEN** a spontaneous post session has completed
- **WHEN** the `finally` block executes
- **THEN** it SHALL disconnect the agent, remove the session from the registry, and clean up the tmp directory
- **AND** it SHALL NOT attempt to remove a `SESSION_ID` file (no longer exists)
