# restart-persistence Specification

## Purpose
Guarantees that the daemon's persisted state (memories, reminders, workspace files, the Skill API secret and per-user workspace isolation) behaves the same after the process restarts on the same data directory.

## Requirements

### Requirement: Stored State Survives A Restart

Memories, reminders and workspace files written by one daemon process SHALL be returned unchanged by a new process that opens the same data directory.

#### Scenario: Memory and reminder
- **GIVEN** a process that saved one memory and one reminder for a user workspace, then dropped every store instance
- **WHEN** new store instances open the same data directory
- **THEN** the memory SHALL be returned with the same content and importance, and the reminder SHALL be counted as active with the same due time

#### Scenario: Workspace file
- **GIVEN** a workspace file written through the workspace manager before the restart
- **WHEN** a new workspace manager reads the same path
- **THEN** it SHALL return the same bytes

### Requirement: Skill API Secret Survives A Restart

A Skill API secret generated into the data directory SHALL be read back from the file after a restart, and a token signed before the restart SHALL verify after it.

#### Scenario: Token minted before restart
- **GIVEN** a secret generated into a fresh data directory and a session JWT signed with it
- **WHEN** a new process resolves the secret from the same directory and verifies the JWT
- **THEN** the secret source SHALL be `file`, the secret SHALL be equal, and the JWT SHALL verify

### Requirement: Workspace Isolation Survives A Restart

After a restart, a session of one user SHALL still be refused access to another user's workspace files.

#### Scenario: Cross-user path after restart
- **GIVEN** two user workspaces created before the restart
- **WHEN** after the restart a path inside the second user's workspace is checked against the first user's workspace boundary
- **THEN** the check SHALL reject it
