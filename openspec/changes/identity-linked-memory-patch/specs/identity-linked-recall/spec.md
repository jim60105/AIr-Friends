# Spec Delta

## ADDED Requirements

### Requirement: Linked Memory Patch Ownership

A user-scope `memory-patch` SHALL append its patch event to the workspace that owns the target memory, searching the current workspace first and then linked workspaces in configuration order; linked private memories SHALL be found only in a DM session.

#### Scenario: Current workspace wins
- **GIVEN** the target id exists in the current workspace
- **WHEN** `memory-patch` runs
- **THEN** the patch event SHALL be appended to the current workspace's file only

#### Scenario: Linked owner patched in place
- **GIVEN** the target id exists only in linked account A's public file
- **WHEN** B's session runs `memory-patch` with `enabled: false`
- **THEN** the patch event SHALL be appended to A's public file, B's files SHALL be unchanged, and a later recall for B SHALL NOT return the memory

#### Scenario: Linked private memory outside DM
- **GIVEN** the target id exists only in linked account A's private file
- **WHEN** B's guild-channel session runs `memory-patch`, and then B's DM session runs it
- **THEN** the guild-channel call SHALL fail with the not-found error and the DM call SHALL append to A's private file

#### Scenario: Ambiguous linked owners
- **GIVEN** the target id is absent from the current workspace and exists in two linked workspaces
- **WHEN** `memory-patch` runs
- **THEN** it SHALL fail with an error naming the id as ambiguous and SHALL append nothing to any file

#### Scenario: Not found anywhere
- **WHEN** the target id exists in no current or linked workspace
- **THEN** `memory-patch` SHALL fail with the existing not-found error, including the hint to retry with scope `channel`
