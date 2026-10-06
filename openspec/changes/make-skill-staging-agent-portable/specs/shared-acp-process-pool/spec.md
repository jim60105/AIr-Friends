# Delta: shared-acp-process-pool

## MODIFIED Requirements

### Requirement: Shared Process Environment Scoping

The environment of a shared process SHALL be fixed at spawn time. Its `XDG_DATA_HOME` and `TMPDIR` SHALL point to channel-scoped directories under the bot data root (`{dataRoot}/opencode-data/{poolKey}` and `{dataRoot}/channel-tmp/{poolKey}`), deliberately OUTSIDE any user's workspace, so one user's agent cannot read another user's OpenCode database, tool outputs, or session history. The process environment SHALL carry the skill-JWT directory (`SKILL_JWT_DIR`, under which the per-session JWT files live); the deployment `SKILL_API_SECRET` SHALL NOT be placed in the agent process environment (the bot process alone holds it, as both issuer and verifier). Every path exported into the spawned process environment (`TMPDIR`, `XDG_DATA_HOME`, `SKILL_JWT_DIR`, and the process working directory) SHALL be an absolute path, lexically resolved against the bot process working directory at environment-construction time, so skill scripts resolve them identically from ANY tool working directory. The shared process environment SHALL carry the shared-process marker (`SKILL_SHARED_PROCESS=1`) and SHALL NOT export a per-session `SESSION_ID`: no skill consumer — script, prompt text, or library — SHALL depend on a frozen process-level session identity. Per-session ACP parameters (session `cwd`, MCP servers, model, mode, reasoning effort) SHALL continue to be applied per session on the shared connection; payload staging for a session uses that session's own workspace tmp dir, carried to the agent as an ABSOLUTE literal staging directory plus the literal active Skill API session id in the per-session prompt variables (`tmpDir`/`sessionId`), and skill invocations SHALL receive the literal `--session-id` value from that prompt rather than from any process environment variable. In shared-process mode the permission gate SHALL confine agent file access to the session's own workspace, the session-scoped payload staging dir (the rendered `tmpDir`), the pool-key-scoped data root (OpenCode tool-output), and the agent workspace; agent reads of the shared OpenCode DB or another session's tool-output files SHALL be rejected in restricted mode, so cross-USER visibility is impossible while cross-session visibility within the pool key is the accepted trade-off.

#### Scenario: Second user's session reuses the channel process
- **GIVEN** a channel's shared process was spawned for user A's session (workspace `/app/data/workspaces/discord/A`)
- **WHEN** user B's session for the same channel runs on that process
- **THEN** the session's ACP `newSession` SHALL carry user B's workspace as the session `cwd`, and the permission gate SHALL use the session-scoped working directory for that session rather than the process-scoped environment

#### Scenario: Channel data root stays outside user workspaces
- **GIVEN** a shared process for pool key `discord/123`
- **WHEN** the process is spawned
- **THEN** its `XDG_DATA_HOME` SHALL be the absolute path `{dataRoot}/opencode-data/discord/123` and its `TMPDIR` SHALL be the absolute path `{dataRoot}/channel-tmp/discord/123`, both outside any user's per-user workspace
- **AND** the permission gate's tool-output boundary SHALL use the channel-scoped data root, so cross-USER visibility of OpenCode data is impossible while cross-session visibility within the channel is the accepted trade-off

#### Scenario: Relative config values are exported as absolute paths
- **GIVEN** `workspace.repoPath` and `agent.sharedProcess.jwtDir` are configured as relative paths (e.g. `./data`, `data/skill-jwt`)
- **WHEN** the pool spawns the agent process
- **THEN** `TMPDIR`, `XDG_DATA_HOME`, `SKILL_JWT_DIR`, and the process cwd in the agent environment SHALL be absolute paths resolved against the bot process working directory at environment-construction time, and a skill script invoked with its tool cwd set to the session workspace SHALL locate the JWT file, the current-session pointer file, and `$TMPDIR` without changing directory

#### Scenario: No frozen session identity in the pooled environment
- **GIVEN** a shared process serving sessions `sess_A` then `sess_B` sequentially
- **WHEN** each session's prompt is rendered and its skills are invoked
- **THEN** the process environment SHALL contain NO `SESSION_ID` variable and SHALL carry `SKILL_SHARED_PROCESS=1`
- **AND** each session's prompt SHALL name that session's own literal Skill API session id and absolute staging directory, and the skill invocation SHALL carry that literal `--session-id`
- **AND** the second session's payload staging SHALL resolve to `sess_B`'s own staging directory regardless of which session id the CLI argument or environment carries
