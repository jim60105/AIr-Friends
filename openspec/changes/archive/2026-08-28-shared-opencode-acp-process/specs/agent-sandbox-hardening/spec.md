## MODIFIED Requirements

### Requirement: Per-Session Tool-Output Isolation

The system SHALL scope the ACP agent subprocess's OpenCode data directory. In per-spawn mode the subprocess SHALL receive a session-scoped `XDG_DATA_HOME` whose value is a directory inside the session's TMPDIR: when the session has a session id (skill-backed sessions) the value SHALL be `{sessionWorkspace}/tmp/opencode-data/{sessionId}`; sessions without one (internal system sessions with dedicated workspaces) use `{sessionWorkspace}/tmp/opencode-data`. In shared-process mode the channel process SHALL receive a channel-scoped `XDG_DATA_HOME` of the form `{dataRoot}/opencode-data/{poolKey}` (a channel/pool-key-scoped data root under the bot data root, deliberately OUTSIDE any user's workspace), fixed at process spawn time. The sandbox environment filter SHALL include `XDG_DATA_HOME` in its allowed base environment variables. The permission gate's tool-output boundary SHALL use the session-scoped value in per-spawn mode and the channel-scoped data root in shared-process mode, and SHALL reject any path that resolves inside the data area but outside the allowed data home (sibling/previous sessions' data dirs are never readable, even though they lexically resolve inside the workspace). The workspace TMPDIR (including the data area) SHALL be removed when no active sessions remain for the workspace.

#### Scenario: Agent subprocess receives session-scoped XDG_DATA_HOME

- **GIVEN** a session with id `sess_own` whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent subprocess is spawned with sandbox env filtering enabled
- **THEN** the subprocess environment SHALL contain `XDG_DATA_HOME=/app/data/workspaces/discord/123/tmp/opencode-data/sess_own` (per-spawn mode); in shared-process mode the channel process receives the pool-key-scoped data root `/app/data/opencode-data/discord/123` (under the bot data root, outside any user's workspace)

#### Scenario: Channel process receives channel-scoped XDG_DATA_HOME (shared mode)

- **GIVEN** a shared process for pool key `discord/123` and bot data root `/app/data`
- **WHEN** the process is spawned in shared-process mode
- **THEN** the subprocess environment SHALL contain `XDG_DATA_HOME=/app/data/opencode-data/discord/123` (channel-scoped data root under the data root, outside any user's workspace)
- **AND** all sessions of that channel SHALL share this channel-scoped OpenCode data root

#### Scenario: Truncated tool outputs land inside the session workspace

- **GIVEN** an agent subprocess with session-scoped `XDG_DATA_HOME=/app/data/workspaces/discord/123/tmp/opencode-data/sess_own`
- **WHEN** OpenCode truncates a tool output
- **THEN** the saved file SHALL be written under `/app/data/workspaces/discord/123/tmp/opencode-data/sess_own/opencode/tool-output/`

#### Scenario: Shared data directory is not written by the agent

- **GIVEN** an agent subprocess with a session-scoped or channel-scoped `XDG_DATA_HOME`
- **WHEN** OpenCode initializes its data directory
- **THEN** it SHALL NOT write into `$HOME/.local/share/opencode/` (the shared data directory remains untouched by agent sessions)

#### Scenario: Sibling/previous sessions' data dirs are not readable

- **GIVEN** a restricted-mode session with id `sess_own` whose workspace is `/app/data/workspaces/discord/123` (data area root `/app/data/workspaces/discord/123/tmp/opencode-data`)
- **WHEN** the agent requests `cat /app/data/workspaces/discord/123/tmp/opencode-data/sess_other/opencode/tool-output/tool_x` or `ls /app/data/workspaces/discord/123/tmp/opencode-data`
- **THEN** the gate SHALL reject the command — the path resolves inside the data area but outside the session's own data home (sibling/previous sessions' truncated tool outputs and the enumerating root listing are never within bounds)
- **AND** `cat /app/data/workspaces/discord/123/tmp/opencode-data/sess_own/opencode/tool-output/tool_x` SHALL be approved

#### Scenario: Shared data directory is not bound under filesystem confinement

- **GIVEN** a session running under bwrap filesystem confinement (`agent.sandbox.filesystemConfinement`)
- **WHEN** the confinement argv is built
- **THEN** the shared home-rooted OpenCode data directory (`$HOME/.local/share/opencode`) SHALL NOT be bound into the mount namespace — in per-spawn mode the agent's data dir lives under the session-scoped `XDG_DATA_HOME` inside the session workspace, and in shared-process mode under the channel-scoped data root (`{dataRoot}/opencode-data/{poolKey}`); the home-rooted shared dir is never written or visible to the confined process

### Requirement: Agent Subprocess Environment Isolation

The system SHALL spawn the ACP agent subprocess with a cleared parent environment so that the child receives ONLY the explicitly-built allowlisted environment variables and inherits NO variables from the parent bot process. The `Deno.Command` used to spawn the agent SHALL set `clearEnv: true`. The allowlisted base environment variables SHALL include the skill-authentication variable `SKILL_JWT_DIR` (shared-process mode — the agent receives only the per-session JWT file, a minimal session capability), alongside `PATH`, `HOME`, `TMPDIR`, `DENO_DIR`, `SESSION_ID`, and `AGENT_WORKSPACE`. The deployment `SKILL_API_SECRET` SHALL NOT be placed in the agent environment; it is held only by the bot process (JWT issuer and Skill API verifier).

#### Scenario: Parent secret not inherited by agent

- **GIVEN** the parent bot process has an environment variable (e.g. `DISCORD_TOKEN`) that is NOT part of the agent's built environment
- **WHEN** the agent subprocess is spawned
- **THEN** that variable SHALL NOT be present in the agent subprocess's actual environment

#### Scenario: Allowlisted variables still provided

- **GIVEN** the agent configuration builds an environment containing `PATH`, `HOME`, `TMPDIR`, `DENO_DIR`, `SESSION_ID`, `AGENT_WORKSPACE`, and `SKILL_JWT_DIR` (no `SKILL_API_SECRET` — the HMAC key stays in the bot process)
- **WHEN** the agent subprocess is spawned with `clearEnv: true`
- **THEN** the agent subprocess environment SHALL contain exactly those built variables (plus agent-type-specific variables) and nothing inherited from the parent
