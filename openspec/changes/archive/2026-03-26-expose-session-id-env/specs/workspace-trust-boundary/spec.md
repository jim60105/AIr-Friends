## MODIFIED Requirements

### Requirement: Session Lifecycle

The system SHALL create a new session for each trigger event. The session's current working directory (cwd) SHALL be set to the user's workspace path. The `SESSION_ID` SHALL be exposed to the agent subprocess via environment variable, NOT via a file in the workspace. Multiple concurrent sessions MAY share the same workspace by design.

#### Scenario: Session start sets SESSION_ID env var
- **GIVEN** a user triggers the bot
- **WHEN** the session orchestrator begins processing and creates an ACP session
- **THEN** the system SHALL set `SESSION_ID` in the process environment for the agent subprocess to inherit (not write a file)

#### Scenario: Session end cleans up SESSION_ID
- **GIVEN** a session is active
- **WHEN** the session completes (success or failure)
- **THEN** the system SHALL remove `SESSION_ID` from the process environment

#### Scenario: Each trigger creates a fresh session
- **GIVEN** a user has previously interacted with the bot
- **WHEN** the same user sends a new message
- **THEN** the system SHALL create a new session with a new session ID, not reuse any prior session state

## REMOVED Requirements

### Requirement: SESSION_ID file in workspace
**Reason**: The SESSION_ID file was never read by any code. Skills receive the session ID via `--session-id "$SESSION_ID"` CLI argument from the shell environment. The file also created race conditions when concurrent sessions shared a workspace.
**Migration**: SESSION_ID is now provided as an environment variable. No code changes needed for skill scripts.
