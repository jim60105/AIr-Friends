# Spec Delta

## MODIFIED Requirements

### Requirement: Workspace tmp/ Cleanup on Session End

The system SHALL attempt bounded cleanup of disposable workspace `tmp/` entries after every session ends, across normal message, spontaneous, self-research, memory maintenance, channel lurk, reminder and dry-run sessions. It SHALL preserve the `tmp/` root and reserved native engine state, and SHALL skip workspaces with registered sessions, live temporary-use owners or uncertain producer teardown.

#### Scenario: Cleanup after session completion
- **GIVEN** a session has completed (successfully or with failure) and its producer teardown has been confirmed
- **WHEN** the session's final temporary-use ownership is released and no other workspace owner or registered session remains
- **THEN** the system SHALL synchronously reclaim eligible disposable entries within its traversal budget
- **AND** it SHALL preserve the `tmp/` directory itself and the reserved `omp-agent` and `opencode-data` entries without traversing them

#### Scenario: Skip cleanup when other sessions share the workspace
- **GIVEN** one or more registered sessions or live temporary-use owners exist for the same workspace key, or producer teardown is uncertain
- **WHEN** workspace temporary cleanup is requested
- **THEN** the system SHALL skip removal and log the busy or uncertain-teardown reason
- **AND** Skill API registry expiry SHALL NOT remove live temporary-use protection

#### Scenario: NotFound error is silently ignored
- **GIVEN** the workspace `tmp/` directory or a disposable entry does not exist
- **WHEN** a cleanup filesystem operation reports `Deno.errors.NotFound`
- **THEN** the system SHALL silently ignore the error

#### Scenario: Other removal errors are warned
- **GIVEN** a disposable entry removal fails with an error other than `NotFound`
- **WHEN** workspace temporary cleanup catches the error
- **THEN** the system SHALL log a warning with the error message and path but SHALL NOT propagate the error
- **AND** eligible independent candidates SHALL remain reclaimable within the remaining traversal budget
