# Workspace Trust Boundary

## Purpose

Defines per-user workspace isolation, session lifecycle, and cross-workspace access prevention. Each user gets a dedicated filesystem workspace keyed by platform and user ID, ensuring memory and file isolation across users.

## Requirements

### Requirement: Workspace Key Generation

The system SHALL compute workspace keys using the format `{platform}/{user_id}`, where `platform` is the normalized platform name (e.g., `"discord"`, `"misskey"`) and `user_id` is the platform-specific user identifier. The workspace key SHALL be per-user, not per-channel — the same user shares one workspace across all channels and threads.

#### Scenario: Workspace key for a Discord user
- **GIVEN** a `NormalizedEvent` with `platform = "discord"` and `userId = "123456"`
- **WHEN** the system computes the workspace key via `computeWorkspaceKey()`
- **THEN** the result SHALL be `"discord/123456"`

#### Scenario: Same user in different channels shares workspace
- **GIVEN** a user with `userId = "123456"` on platform `"discord"`
- **WHEN** the user sends messages in channel A and channel B
- **THEN** both interactions SHALL use the same workspace key `"discord/123456"` and the same workspace directory

### Requirement: Workspace Directory Structure

The system SHALL create workspace directories under `{repoPath}/workspaces/{workspace_key}/`. Each workspace SHALL contain a `tmp/` subdirectory. The `tmp/` directory SHALL be created or ensured on every workspace access, even if the workspace already exists.

#### Scenario: New workspace creation
- **GIVEN** a new user triggers the bot for the first time
- **WHEN** `getOrCreateWorkspace()` is called
- **THEN** the system SHALL create the directory `{repoPath}/workspaces/{platform}/{userId}/` and a `tmp/` subdirectory within it

#### Scenario: Existing workspace access
- **GIVEN** a workspace already exists for a user
- **WHEN** `getOrCreateWorkspace()` is called again
- **THEN** the system SHALL ensure the `tmp/` subdirectory exists (creating it if missing) without altering existing files

### Requirement: Session Lifecycle

The system SHALL create a new session for each trigger event. The session's current working directory (cwd) SHALL be set to the user's workspace path. A `SESSION_ID` file SHALL be written to the workspace directory at session start and removed at session end.

#### Scenario: Session start writes SESSION_ID file
- **GIVEN** a user triggers the bot
- **WHEN** the session orchestrator begins processing
- **THEN** the system SHALL write a `SESSION_ID` file containing the active session ID to `{workspace.path}/SESSION_ID`

#### Scenario: Session end removes SESSION_ID file
- **GIVEN** a session is active with a `SESSION_ID` file in the workspace
- **WHEN** the session completes (success or failure)
- **THEN** the system SHALL remove the `SESSION_ID` file from the workspace directory
- **AND** if removal fails, the system SHALL log a warning but NOT crash

#### Scenario: Each trigger creates a fresh session
- **GIVEN** a user has previously interacted with the bot
- **WHEN** the same user sends a new message
- **THEN** the system SHALL create a new session with a new session ID, not reuse any prior session state

### Requirement: Cross-Workspace Access Prevention

The system SHALL prevent any file operation that would access paths outside the workspace boundary. The `validatePathWithinBoundary()` function SHALL throw a `WorkspaceError` if a resolved path escapes the workspace root. The `sanitizePathComponent()` function SHALL remove path traversal sequences (`..`), path separators (`/`, `\`), and leading dots from path components.

#### Scenario: Path traversal attempt blocked
- **GIVEN** a workspace at `/data/workspaces/discord/123/`
- **WHEN** a file operation is attempted with path `../../other-user/memory.public.jsonl`
- **THEN** the system SHALL throw a `WorkspaceError` and the operation SHALL NOT proceed

#### Scenario: Absolute path escape blocked
- **GIVEN** a workspace boundary at `/data/workspaces/discord/123/`
- **WHEN** a file read is attempted with an absolute path outside the boundary
- **THEN** `validatePathWithinBoundary()` SHALL detect the escape via `relative()` check and throw a `WorkspaceError`

#### Scenario: Valid subpath access allowed
- **GIVEN** a workspace at `/data/workspaces/discord/123/`
- **WHEN** a file operation targets `memory.public.jsonl` within the workspace
- **THEN** `validateFileAccess()` SHALL succeed and the operation SHALL proceed

### Requirement: Agent Global Workspace

The system SHALL provide a global agent workspace at `{repoPath}/agent-workspace/` with `notes/` and `journal/` subdirectories. This workspace SHALL be shared across all conversations and users, and SHALL NOT contain per-user private data. The `getOrCreateAgentWorkspace()` method SHALL create the directory structure if it does not exist.

#### Scenario: Agent workspace initialization
- **GIVEN** the agent workspace directory does not exist
- **WHEN** `getOrCreateAgentWorkspace()` is called
- **THEN** the system SHALL create `{repoPath}/agent-workspace/` with `notes/` and `journal/` subdirectories

### Requirement: Workspace File Operations

The system SHALL validate file access boundaries before every read, write, and append operation via `validateFileAccess()`. Write and append operations SHALL auto-create parent directories if they do not exist. The `readWorkspaceFile()` method SHALL throw a `WORKSPACE_NOT_FOUND` error when the target file does not exist.

#### Scenario: Writing to a nested path auto-creates directories
- **GIVEN** a workspace exists but the target subdirectory does not
- **WHEN** `writeWorkspaceFile()` is called with a nested relative path
- **THEN** the system SHALL create the parent directories and write the file

#### Scenario: Reading a non-existent file throws error
- **GIVEN** a workspace exists
- **WHEN** `readWorkspaceFile()` is called for a file that does not exist
- **THEN** the system SHALL throw a `WorkspaceError` with code `WORKSPACE_NOT_FOUND`

---

### Requirement: Workspace tmp/ Cleanup on Session End

The `SessionOrchestrator` SHALL clean up the workspace `tmp/` directory after every session ends, across all session types (normal message, spontaneous post, self-research, memory maintenance, channel lurk, reminder, and dry-run).

#### Scenario: Cleanup after session completion
- **GIVEN** a session has completed (successfully or with failure)
- **WHEN** the session's `finally` block executes
- **THEN** the system SHALL call `cleanupWorkspaceTmp()` which removes the workspace's `tmp/` directory recursively via synchronous `Deno.removeSync()`

#### Scenario: Skip cleanup when other sessions share the workspace
- **GIVEN** one or more other active sessions exist for the same workspace key
- **WHEN** `cleanupWorkspaceTmp()` is called
- **THEN** the system SHALL skip the removal and log a debug message indicating other active sessions exist

#### Scenario: NotFound error is silently ignored
- **GIVEN** the workspace `tmp/` directory does not exist
- **WHEN** `Deno.removeSync()` throws a `Deno.errors.NotFound` error
- **THEN** the system SHALL silently ignore the error

#### Scenario: Other removal errors are warned
- **GIVEN** the `tmp/` directory removal fails with an error other than `NotFound`
- **WHEN** `cleanupWorkspaceTmp()` catches the error
- **THEN** the system SHALL log a warning with the error message and path but SHALL NOT propagate the error
