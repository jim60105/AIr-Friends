## MODIFIED Requirements

### Requirement: Agent Global Workspace

The system SHALL provide a global agent workspace at `{repoPath}/agent-workspace/` with `notes/` and `journal/` subdirectories. This workspace SHALL be shared across all conversations and users, and SHALL NOT contain per-user private data. The `getOrCreateAgentWorkspace()` method SHALL create the directory structure if it does not exist. Because the workspace is shared, WRITE access SHALL be restricted to sessions explicitly authorized via the `canWriteAgentWorkspace` flag (self-research sessions only); ordinary user, spontaneous, channel-lurk, and memory-maintenance sessions SHALL have read-only access. Memory-maintenance operates on per-user memory files via memory skills and SHALL NOT be granted shared-workspace write access.

#### Scenario: Agent workspace initialization
- **GIVEN** the agent workspace directory does not exist
- **WHEN** `getOrCreateAgentWorkspace()` is called
- **THEN** the system SHALL create `{repoPath}/agent-workspace/` with `notes/` and `journal/` subdirectories

#### Scenario: Ordinary session has read-only agent workspace access
- **GIVEN** a user-triggered session where `canWriteAgentWorkspace` is not set
- **WHEN** the agent attempts to write a file into the shared agent workspace
- **THEN** the write SHALL be rejected

#### Scenario: Memory-maintenance session has read-only agent workspace access
- **GIVEN** a memory-maintenance session where `canWriteAgentWorkspace` is not set
- **WHEN** the agent attempts to write a file into the shared agent workspace
- **THEN** the write SHALL be rejected

#### Scenario: Authorized session may write agent workspace
- **GIVEN** a self-research session where `canWriteAgentWorkspace` is `true`
- **WHEN** the agent writes a note into the shared agent workspace with an allowed extension
- **THEN** the write SHALL succeed
