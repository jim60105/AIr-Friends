# Spec Delta

## MODIFIED Requirements

### Requirement: Session Resumption After Process Death

When a shared process dies while a session's prompt is in flight, the system SHALL restart that pool key's process, resume the existing session via the ACP `session/load` method (the agent persists session state in its channel-scoped data directory), and re-issue the prompt ONLY if no response (reply, reaction, or file send) has been recorded for the session; if a response was already sent, the session SHALL complete without re-prompting.

#### Scenario: In-flight session resumed after process restart
- **GIVEN** a shared process dies while a session's prompt is in flight and no response has been sent yet
- **WHEN** the system restarts that pool key's process
- **THEN** it SHALL load the existing session via ACP `session/load` (history is replayed to the client) and re-issue the prompt on the resumed session

#### Scenario: Response already sent — no re-prompt
- **GIVEN** a shared process dies while a session's prompt is in flight and the session has already sent a reply or delivered a file
- **WHEN** the system restarts the process and loads the session
- **THEN** the session SHALL complete WITHOUT re-issuing the prompt, so no duplicate reply or memory event is produced

#### Scenario: Recovery re-enters the recorded mode and state namespace
- **GIVEN** an OMP deployment session whose ownership record (written at acquisition) names permission mode `native-yolo` and that mode's process/state namespace
- **WHEN** its pooled process dies mid-prompt and recovery restarts and loads the session
- **THEN** the respawn SHALL occur in the `native-yolo` mode's process and state namespace with the session's recorded cwd and operator MCP definitions
- **AND** recovery SHALL NOT spawn or reuse a restricted-mode process and SHALL NOT re-resolve the permission mode from current configuration

#### Scenario: Restricted recovery context cannot load a native-YOLO-owned session
- **GIVEN** an OMP deployment where a session's ownership record names mode `native-yolo` but the recovery context is restricted (recorded mode/namespace does not match)
- **WHEN** recovery attempts to load that session
- **THEN** it SHALL fail closed with a distinct ownership-violation error identifying the session and the mismatched mode/namespace
- **AND** it SHALL NOT issue `session/load`, SHALL NOT spawn or disconnect any process, and SHALL NOT treat the mismatch as a fallback to either mode

#### Scenario: Native-YOLO recovery context cannot load a restricted-owned session
- **GIVEN** an OMP deployment where a session's ownership record names mode `restricted` but the recovery context is native-YOLO
- **WHEN** recovery attempts to load that session
- **THEN** it SHALL fail closed with the same ownership-violation behavior in this second direction — no load, no process side effects, no cross-mode resumption

#### Scenario: Ownership violation is distinct from unsupported resumption
- **GIVEN** a recovery attempt that fails because of an ownership violation and another that fails because the agent does not support `session/load`
- **WHEN** each failure surfaces to the affected session's error handling
- **THEN** the two failures SHALL carry distinct, bounded diagnostics so an ownership violation is never reported or logged as capability-absence session loss

#### Scenario: Gate context restored to the correct session before resuming
- **GIVEN** a shared-process pool where one client serves several ACP sessions and one session's process dies mid-prompt
- **WHEN** the session is recovered via `session/load`
- **THEN** the recovered session id's OWN gate context (its cwd, owning skill session id, and per-session permission flags) SHALL be re-registered before any re-issued prompt
- **AND** no other session's gate context SHALL be substituted for it, and other sessions' contexts SHALL remain registered and unmodified

#### Scenario: Recovery failure stays isolated to the affected session
- **GIVEN** two sessions on one pooled process, one of which enters recovery and fails (ownership violation, load failure, post-load catalog miss, or gate-context restore failure)
- **WHEN** that recovery fails
- **THEN** only the affected session SHALL end in error through its existing per-session error handling
- **AND** the other session's gate context, agent session, process, and the execution lease SHALL be unaffected, and the failed session's gate context SHALL NOT be dropped to force progress

#### Scenario: Recovery hook exists with no readiness assertion
- **GIVEN** a recovered restricted OMP session whose gate context has just been restored
- **WHEN** recovery completes and prompting resumes
- **THEN** resumption SHALL proceed without asserting a policy-readiness result
- **AND** the named onGateContextRestored post-restore hook SHALL exist without a readiness assertion or later readiness verification requirement

#### Scenario: Side-effect state survives process restart
- **GIVEN** a shared process dies while a session's prompt is in flight after the agent ran side-effectful skill operations
- **WHEN** the agent process is restarted and the session is resumed
- **THEN** the in-bot session registry state (`replySent`, `fileSent`, attempt counts) SHALL guard side-effectful operations (`send-reply`, `memory-save`), so no duplicate reply or memory event is produced
- **AND** the recovery/retry prompt SHALL enumerate the session's already-executed skill operations (memory-save calls, reply attempts, file sends) so the resumed agent avoids re-doing side effects

### Requirement: Shared Process Environment Scoping

The environment of a shared process SHALL be fixed at spawn time and scoped to its pool key rather than to any user's workspace: its channel-scoped `XDG_DATA_HOME` and `TMPDIR` SHALL live under the bot data root, deliberately OUTSIDE any user's workspace.

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

#### Scenario: Skill-JWT directory carried, API secret withheld
- **GIVEN** the pool spawns a shared agent process
- **WHEN** the process environment is constructed
- **THEN** it SHALL carry the skill-JWT directory (`SKILL_JWT_DIR`, under which the per-session JWT files live), and the deployment `SKILL_API_SECRET` SHALL NOT be placed in the agent process environment (the bot process alone holds it, as both issuer and verifier)

#### Scenario: Per-session parameters and payload staging
- **GIVEN** multiple sessions share one process connection
- **WHEN** each session runs on the shared process
- **THEN** per-session ACP parameters (session `cwd`, MCP servers, model, mode, reasoning effort) SHALL be applied per session on the shared connection, and a session's payload staging SHALL use that session's own workspace tmp dir, carried to the agent via a per-session `tmpDir` prompt variable

#### Scenario: Permission gate confines file access in shared mode
- **GIVEN** shared-process mode is active
- **WHEN** the agent performs file access
- **THEN** the permission gate SHALL confine access to the session's own workspace, the session-scoped payload staging dir (the rendered `tmpDir`), the pool-key-scoped data root (OpenCode tool-output), and the agent workspace
- **AND** agent reads of the shared OpenCode DB or another session's tool-output files SHALL be rejected in restricted mode, so cross-USER visibility is impossible while cross-session visibility within the pool key is the accepted trade-off

## ADDED Requirements

### Requirement: Recovery Targets The Recorded Acquisition Context

Crash reconnect and `session/load` recovery SHALL target the session's recorded acquisition context — the ORIGINAL permission mode, process/state namespace, absolute cwd, and operator MCP definitions — respawn in that SAME mode's process and state namespace, and never spawn or reuse an opposite-mode process or re-resolve the mode.

#### Scenario: Recovery targets the recorded context
- **GIVEN** an OMP deployment session whose ownership record (written at acquisition) names permission mode `native-yolo`, an absolute cwd, and operator MCP definitions
- **WHEN** its pooled process dies mid-prompt and recovery reconnects and issues `session/load`
- **THEN** the respawn SHALL occur in the `native-yolo` mode's process and state namespace with the recorded absolute cwd and operator MCP definitions
- **AND** recovery SHALL NOT spawn or reuse a restricted-mode process and SHALL NOT re-resolve the permission mode from current configuration

### Requirement: Ownership Mismatch Fails Closed Before Teardown And Load

Verifying a session against its recorded acquisition context SHALL happen BEFORE any teardown or load, and a mismatch — including a session with no provenance record where provenance is required — SHALL be an OWNERSHIP VIOLATION that fails closed: no `session/load`, no process side effects, no fallback to either mode, and never reported as the existing unsupported-resumption session loss.

#### Scenario: Verification precedes teardown and load
- **GIVEN** a session awaiting crash recovery whose recorded acquisition context is present
- **WHEN** recovery begins
- **THEN** the recorded mode and state namespace SHALL be verified against the recovery context BEFORE any process is disconnected or `session/load` is issued
- **AND** a failed verification SHALL leave the teardown and load steps unexecuted

#### Scenario: Mismatched mode fails closed
- **GIVEN** an OMP session whose ownership record names mode `native-yolo` but the recovery context is restricted, or the reverse
- **WHEN** recovery attempts to load that session
- **THEN** it SHALL fail closed with a distinct ownership-violation error identifying the session and the mismatched mode/namespace
- **AND** it SHALL NOT issue `session/load`, SHALL NOT spawn or disconnect any process, and SHALL NOT fall back to either mode

#### Scenario: Missing required provenance fails closed
- **GIVEN** a session with no provenance record where provenance is required
- **WHEN** recovery attempts to verify its acquisition context
- **THEN** it SHALL be treated as an OWNERSHIP VIOLATION and fail closed with the same no-load and no-process-side-effect behavior
- **AND** it SHALL NOT be reported as the existing "agent does not support session resumption" session loss

### Requirement: Resumed Session Configuration Restored After Load

After a successful same-mode load, the resumed session's configuration SHALL be restored through the shared model-configuration logic: canonical option-cache restoration, then model and, best-effort from the session's resolved value, reasoning reapplication.

#### Scenario: Configuration restored after load
- **GIVEN** a session recovered through `session/load` in its recorded permission mode
- **WHEN** the load succeeds
- **THEN** the shared model-configuration logic SHALL restore the canonical option cache, then the model, and SHALL reapply reasoning best-effort from the session's resolved value
- **AND** the restoration SHALL go through the same shared model-configuration logic as other session configuration rather than a recovery-specific path

### Requirement: Own Gate Context Restored Before Prompting

The recovered session id's OWN per-session filesystem/permission gate context SHALL be re-registered before prompting resumes, with no other session's fallback context substituted for an unknown or unrecoverable session id; the named post-restore hook SHALL exist after gate-context restoration and before resumption, with no readiness assertion, handshake, or deferred verification requirement.

#### Scenario: Own gate context re-registered before prompting
- **GIVEN** a shared-process pool where one client serves several ACP sessions and one session's process dies mid-prompt
- **WHEN** the session is recovered via `session/load`
- **THEN** the recovered session id's OWN gate context (its cwd, owning skill session id, and per-session permission flags) SHALL be re-registered before any re-issued prompt
- **AND** an unknown or unrecoverable session id SHALL NOT receive another session's fallback gate context

#### Scenario: Post-restore hook ordering without readiness assertion
- **GIVEN** a recovered restricted OMP session whose gate context has just been restored
- **WHEN** recovery completes and prompting resumes
- **THEN** the named onGateContextRestored post-restore hook SHALL exist after gate-context restoration and before resumption
- **AND** it SHALL carry no readiness assertion, handshake, or deferred verification requirement

### Requirement: Recovery Failure Isolation

Every recovery failure (ownership violation, load failure, post-load model catalog miss, gate-context restore failure) SHALL remain isolated to the affected session's existing per-session error handling: recovery SHALL NOT cross permission modes, SHALL NOT drop the failed session's gate context to force progress, and SHALL leave other sessions' gate contexts, processes, and the execution lease untouched.

#### Scenario: Recovery failure is contained to one session
- **GIVEN** two sessions on one pooled process, one of which enters recovery and fails (ownership violation, load failure, post-load model catalog miss, or gate-context restore failure)
- **WHEN** that recovery fails
- **THEN** only the affected session SHALL end in error through its existing per-session error handling
- **AND** recovery SHALL NOT cross permission modes, SHALL NOT drop the failed session's gate context to force progress, and other sessions' gate contexts, agent sessions, processes, and the execution lease SHALL remain untouched

### Requirement: Recovery Preserves Side-Effect Accounting

Side-effectful skill operations (`send-reply`, `memory-save`) SHALL be guarded by the in-bot session registry state (`replySent`, `fileSent`, attempt counts), which survives the agent process restart because it lives in the bot process; when the prompt is re-issued, the recovery/retry prompt SHALL enumerate the session's already-executed skill operations (memory-save calls, reply attempts, file sends) so the resumed agent avoids re-doing side effects.

#### Scenario: Side-effect accounting survives the restart
- **GIVEN** a shared process dies while a session's prompt is in flight after the agent ran side-effectful skill operations
- **WHEN** the agent process is restarted and the session is resumed
- **THEN** the in-bot session registry state (`replySent`, `fileSent`, attempt counts) SHALL guard `send-reply` and `memory-save`, so no duplicate reply or memory event is produced
- **AND** the recovery/retry prompt SHALL enumerate the session's already-executed skill operations (memory-save calls, reply attempts, file sends) so the resumed agent avoids re-doing side effects

### Requirement: Channel-Scoped Data And Temp Directories

`XDG_DATA_HOME` SHALL be `{dataRoot}/opencode-data/{poolKey}` and `TMPDIR` SHALL be `{dataRoot}/channel-tmp/{poolKey}`, deliberately outside any user's workspace so one user's agent cannot read another user's OpenCode database, tool outputs, or session history.

#### Scenario: Channel-scoped spawn environment
- **GIVEN** a shared process for pool key `discord/123`
- **WHEN** the process is spawned
- **THEN** its `XDG_DATA_HOME` SHALL be `{dataRoot}/opencode-data/discord/123` and its `TMPDIR` SHALL be `{dataRoot}/channel-tmp/discord/123`
- **AND** both paths SHALL lie outside any user's workspace, so one user's agent cannot read another user's OpenCode database, tool outputs, or session history

### Requirement: Spawn-Time Environment Paths Are Absolute

Every path exported into the spawned process environment (`TMPDIR`, `XDG_DATA_HOME`, `SKILL_JWT_DIR`, and the process working directory) SHALL be absolute, lexically resolved against the bot process working directory at environment-construction time, so skill scripts resolve them identically from ANY tool working directory.

#### Scenario: Exported paths are absolute from any tool working directory
- **GIVEN** `workspace.repoPath` and `agent.sharedProcess.jwtDir` are configured as relative paths
- **WHEN** the pool spawns the agent process
- **THEN** `TMPDIR`, `XDG_DATA_HOME`, `SKILL_JWT_DIR`, and the process working directory in the spawned environment SHALL be absolute, lexically resolved against the bot process working directory at environment-construction time
- **AND** a skill script invoked from any tool working directory SHALL resolve those paths identically

### Requirement: Skill JWT Directory Is Carried And The API Secret Is Withheld

The process environment SHALL carry the skill-JWT directory (`SKILL_JWT_DIR`, under which the per-session JWT files live), and the deployment `SKILL_API_SECRET` SHALL NOT be placed in the agent process environment: the bot process alone holds it, as both issuer and verifier.

#### Scenario: JWT directory present, secret absent
- **GIVEN** the pool spawns a shared agent process
- **WHEN** the process environment is constructed
- **THEN** it SHALL carry `SKILL_JWT_DIR`, the directory under which the per-session JWT files live
- **AND** the deployment `SKILL_API_SECRET` SHALL NOT be placed in the agent process environment, because the bot process alone holds it as both issuer and verifier

### Requirement: No Frozen Session Identity In The Pooled Environment

The shared process environment SHALL carry the shared-process marker (`SKILL_SHARED_PROCESS=1`) and SHALL NOT export a per-session `SESSION_ID`; no skill consumer — script, prompt text, or library — SHALL depend on a frozen process-level session identity, and skill invocations SHALL receive the literal `--session-id` value from the per-session prompt rather than from any process environment variable.

#### Scenario: No frozen session identity
- **GIVEN** a shared process serving sessions `sess_A` then `sess_B` sequentially
- **WHEN** each session's prompt is rendered and its skills are invoked
- **THEN** the process environment SHALL contain NO `SESSION_ID` variable and SHALL carry `SKILL_SHARED_PROCESS=1`
- **AND** each skill invocation SHALL receive the literal `--session-id` value from that session's prompt rather than from any process environment variable
- **AND** no skill consumer (script, prompt text, or library) SHALL depend on a frozen process-level session identity

### Requirement: Per-Session Parameters And Payload Staging On A Shared Connection

Per-session ACP parameters (session `cwd`, MCP servers, model, mode, reasoning effort) SHALL continue to be applied per session on the shared connection, and payload staging for a session SHALL use that session's own workspace tmp dir, carried to the agent as an ABSOLUTE literal staging directory plus the literal active Skill API session id in the per-session prompt variables (`tmpDir`/`sessionId`).

#### Scenario: Shared connection applies per-session parameters
- **GIVEN** multiple sessions share one process connection
- **WHEN** each session runs on the shared process
- **THEN** per-session ACP parameters (session `cwd`, MCP servers, model, mode, reasoning effort) SHALL be applied per session on the shared connection
- **AND** a session's payload staging SHALL use that session's own workspace tmp dir, passed to the agent as an ABSOLUTE literal staging directory and the literal active Skill API session id through the per-session `tmpDir` and `sessionId` prompt variables

### Requirement: Permission Gate Confinement In Shared Mode

In shared-process mode the permission gate SHALL confine agent file access to the session's own workspace, the session-scoped payload staging dir (the rendered `tmpDir`), the pool-key-scoped data root (OpenCode tool-output), and the agent workspace; agent reads of the shared OpenCode DB or another session's tool-output files SHALL be rejected in restricted mode, so cross-USER visibility is impossible while cross-session visibility within the pool key is the accepted trade-off.

#### Scenario: Shared-mode permission gate boundary
- **GIVEN** shared-process mode is active
- **WHEN** the agent performs file access
- **THEN** the permission gate SHALL confine access to the session's own workspace, the session-scoped payload staging dir (the rendered `tmpDir`), the pool-key-scoped data root (OpenCode tool-output), and the agent workspace
- **AND** agent reads of the shared OpenCode DB or another session's tool-output files SHALL be rejected in restricted mode, so cross-USER visibility is impossible while cross-session visibility within the pool key is the accepted trade-off
