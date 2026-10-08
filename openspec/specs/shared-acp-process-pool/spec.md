# shared-acp-process-pool Specification

## Purpose
Runs a single long-lived `opencode acp` subprocess per active channel and routes all sessions of that channel over it, eliminating the per-conversation agent cold start and enabling session resumption across process restarts.
## Requirements
### Requirement: Per-Channel Shared ACP Process Pool

The system SHALL maintain a pool of long-lived `opencode acp` subprocesses keyed by a canonical pool key. When a session for a key starts and no live process exists, the system SHALL lazily spawn one `opencode acp` subprocess and keep it alive across that key's sessions, reusing it for subsequent sessions of the same key.

#### Scenario: Reclaim and respawn never double-open the channel data root
- **GIVEN** a pool key's process is being reclaimed (marked `reclaiming`; the old process is still exiting)
- **WHEN** a new session for that key requests an agent process
- **THEN** the pool SHALL defer the spawn until the old process has fully exited (same-generation check), so exactly one `opencode` process holds the channel-scoped data root at any time

#### Scenario: First session for a channel spawns the channel process
- **GIVEN** the shared process pool is enabled and the channel has no live process
- **WHEN** a session for that channel begins
- **THEN** the system SHALL spawn one `opencode acp` subprocess (wrapped with `dumb-init`, cleared parent environment) and route the session's ACP calls over it

#### Scenario: Subsequent sessions for the same channel reuse the live process
- **GIVEN** a channel has a live `opencode acp` process
- **WHEN** another session for that channel begins
- **THEN** the system SHALL create a new ACP session on the existing stdio connection instead of spawning a new subprocess

#### Scenario: Channel process reclaimed when idle
- **GIVEN** a pool key's process has no leased sessions (queued, in-flight, and recovering sessions all count as leased)
- **WHEN** the configured reclaim idle time elapses
- **THEN** the system SHALL terminate that process and remove it from the pool, re-checking idleness under the pool lock so a concurrent acquire cancels the pending reclaim

#### Scenario: Scheduler session types get their own pool key
- **GIVEN** a self-research session for user `u_42` or a memory-maintenance session for workspace `discord/77`
- **WHEN** the session requests an agent process
- **THEN** the system SHALL use the canonical keys `self-research:u_42` and `memory-maintenance:discord/77` respectively, spawning a dedicated process for that session type rather than reusing a message channel's process

#### Scenario: Message and spontaneous-post pool keys
- **GIVEN** a message or channel-lurk session for a channel, or a spontaneous-post session
- **WHEN** the session requests an agent process
- **THEN** the system SHALL key the pool on `{platform}:{channelId}` for message/channel-lurk sessions and on the scheduler's target channel (e.g. `dm:{userId}`, `misskey/timeline/self`) for spontaneous-post sessions, each non-message session type getting its own process
 
### Requirement: Global Session Serialization

The system SHALL serialize agent sessions globally: at most one agent session SHALL hold the execution lease at any time, and a session that cannot run immediately SHALL wait in a FIFO queue and SHALL run once the in-flight session releases the lease.

#### Scenario: Concurrent sessions are serialized
- **GIVEN** a normal message session and a channel-lurk session become ready at the same time
- **WHEN** both request the single agent slot
- **THEN** the one that requested first SHALL run, and the other SHALL wait its turn in the queue

#### Scenario: Scheduler session waits behind a message session
- **GIVEN** a spontaneous-post session is triggered while a normal message session is in flight
- **WHEN** the spontaneous session requests the agent slot
- **THEN** it SHALL wait in the queue until the in-flight session completes

#### Scenario: Stale scheduler trigger re-validated on lease acquisition
- **GIVEN** a channel-lurk session has been queued for a long time behind a long in-flight session
- **WHEN** the lurk session acquires the lease
- **THEN** the system SHALL re-validate the lurk trigger conditions (last message, bot mention, bot reaction, already-processed) at lease acquisition, and SHALL skip the cycle if the trigger is no longer valid

#### Scenario: Interactive sessions take queue priority
- **GIVEN** a normal message session and a memory-maintenance session are both queued
- **WHEN** the queue orders waiting sessions
- **THEN** user-triggered (message/lurk) sessions SHALL be served before maintenance jobs

#### Scenario: Queued session is not reaped while waiting
- **GIVEN** a queued session whose idle time exceeds the registry's 30-minute reaper timeout
- **WHEN** the queue holds the session and the reaper runs
- **THEN** the queued session SHALL be excluded from reaping while it holds a pool lease (the queue refreshes its activity timestamp), so it cannot be reaped and later acquire a lease for a session the registry no longer knows

#### Scenario: Queue deadline cancels an overdue queued session
- **GIVEN** a queued session that has waited longer than the configured queue deadline
- **WHEN** the scheduler notices the deadline
- **THEN** the queue SHALL cancel that session through the single release path (remove the queue item, release the pool refcount, clear the session's JWT file), so no refcount or auth-file leak remains

#### Scenario: Maintenance jobs are not starved
- **GIVEN** a steady stream of user-triggered sessions keeps arriving
- **WHEN** maintenance jobs (self-research, memory-maintenance) are queued
- **THEN** after every 4 served interactive sessions, the queue SHALL allow one maintenance job to run, preventing indefinite starvation

#### Scenario: Lease covers the full agent lifecycle
- **GIVEN** a session holds the execution lease and a later session is queued behind it
- **WHEN** the in-flight session issues its setup calls on the shared connection
- **THEN** the lease SHALL cover the in-flight session's ENTIRE lifecycle (ACP `newSession`, model/mode/config-option calls, prompt/retry, cancel, recovery, and cleanup), and the connector's mutable state (config-options cache, current model ID, idle monitor) SHALL be indexed by ACP session ID, so the queued session's setup calls cannot clobber the in-flight session's connection state

#### Scenario: All releases flow through the single release path
- **GIVEN** a queued or in-flight session is cancelled externally, fails trigger re-validation, or throws an exception
- **WHEN** the session is released
- **THEN** the release SHALL flow through a single `finally` release path that removes the queue item, releases the pool refcount, and clears the session's auth files (pointer and JWT)
 
### Requirement: Session Resumption After Process Death

When a shared process dies while a session's prompt is in flight, the system SHALL restart that pool key's process, resume the existing session via the ACP `session/load` method, and re-issue the prompt ONLY if no response (reply, reaction, or file send) has been recorded; if a response was already sent, the session SHALL complete without re-prompting.

#### Scenario: In-flight session resumed after process restart
- **GIVEN** a shared process dies while a session's prompt is in flight and no response has been sent yet
- **WHEN** the system restarts that pool key's process
- **THEN** it SHALL load the existing session via ACP `session/load` (history is replayed to the client) and re-issue the prompt on the resumed session

#### Scenario: Response already sent — no re-prompt
- **GIVEN** a shared process dies while a session's prompt is in flight and the session has already sent a reply or delivered a file
- **WHEN** the system restarts the process and loads the session
- **THEN** the session SHALL complete WITHOUT re-issuing the prompt, so no duplicate reply or memory event is produced

#### Scenario: Side-effect state survives process restart
- **GIVEN** a shared process dies while a session's prompt is in flight after the agent ran side-effectful skill operations
- **WHEN** the agent process is restarted and the session is resumed
- **THEN** the in-bot session registry state (`replySent`, `fileSent`, attempt counts) SHALL guard side-effectful operations (`send-reply`, `memory-save`), so no duplicate reply or memory event is produced
- **AND** the recovery/retry prompt SHALL enumerate the session's already-executed skill operations (memory-save calls, reply attempts, file sends) so the resumed agent avoids re-doing side effects
 
### Requirement: Shared Process Environment Scoping

The environment of a shared process SHALL be fixed at spawn time, with its `XDG_DATA_HOME` and `TMPDIR` pointing to channel-scoped directories under the bot data root (`{dataRoot}/opencode-data/{poolKey}` and `{dataRoot}/channel-tmp/{poolKey}`), deliberately OUTSIDE any user's workspace, so one user's agent cannot read another user's OpenCode database, tool outputs, or session history.

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
- **THEN** `TMPDIR`, `XDG_DATA_HOME`, `SKILL_JWT_DIR`, and the process cwd in the agent environment SHALL be absolute paths resolved against the bot process working directory
- **AND** a skill script invoked with its tool cwd set to the session workspace SHALL locate the JWT file, the current-session pointer file, and `$TMPDIR` without changing directory

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

