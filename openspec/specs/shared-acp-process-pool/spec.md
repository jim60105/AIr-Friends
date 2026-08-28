# shared-acp-process-pool Specification

## Purpose
Runs a single long-lived `opencode acp` subprocess per active channel and routes all sessions of that channel over it, eliminating the per-conversation agent cold start and enabling session resumption across process restarts.
## Requirements
### Requirement: Per-Channel Shared ACP Process Pool

The system SHALL maintain a pool of long-lived `opencode acp` subprocesses keyed by a canonical pool key. Message and channel-lurk sessions SHALL use the key `{platform}:{channelId}`; spontaneous-post sessions SHALL use the scheduler's target channel (e.g. `dm:{userId}`, `misskey/timeline/self`); self-research sessions SHALL use `self-research:{userId}` and memory-maintenance sessions SHALL use `memory-maintenance:{workspaceKey}` (each non-message session type gets its own process, effectively per-run). When no live process exists for the pool key and a session for that key starts, the system SHALL lazily spawn one `opencode acp` subprocess and keep it alive across that key's sessions. The pool SHALL track a per-process reference count (queued, acquiring, in-flight, and recovering sessions all hold a lease); when no leased sessions remain for the key and the configured reclaim idle time has elapsed, the system SHALL terminate that process and remove it from the pool, re-checking idleness under the pool lock so a concurrent acquire never races the reclaim. Each pool entry SHALL carry a generation counter and a `reclaiming` state: a reclaim marks the entry non-acquirable under the pool lock, waits for the old process to fully exit before a new spawn for the same key is allowed, and the reclaim timer callback SHALL re-validate that it still belongs to the same generation — so two `opencode` processes never open the same channel-scoped data root at once.

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

### Requirement: Global Session Serialization

The system SHALL serialize agent sessions globally: at most one agent session SHALL hold the execution lease at any time (single-bot-persona semantics). A session that cannot run immediately SHALL wait in a FIFO queue and SHALL run once the in-flight session releases the lease. The lease SHALL cover the session's ENTIRE agent lifecycle — ACP `newSession`, model/mode/config-option calls, prompt/retry, cancel, recovery, and cleanup — so a later queued session's setup calls cannot clobber the in-flight session's connection state; the connector's mutable state (config-options cache, current model ID, idle monitor) SHALL be indexed by ACP session ID. A session that is queued SHALL be excluded from the registry's idle reaper while it waits (the queue refreshes its activity timestamp), and SHALL be cancelled by a queue deadline so an overdue queued session cannot be reaped while still holding a pool refcount. Release, external cancellation, revalidation failure, and exceptions SHALL all flow through a single `finally` release path that removes the queue item, releases the pool refcount, and clears the session's auth files (pointer + JWT). Queued sessions SHALL be served from two FIFO lanes — user-triggered (message/lurk) lanes ahead of maintenance lanes, with a starvation guard: after every 4 served interactive sessions, one maintenance job is allowed to run.

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

### Requirement: Session Resumption After Process Death

When a shared process dies while a session's prompt is in flight, the system SHALL restart that pool key's process, resume the existing session via the ACP `session/load` method (OpenCode persists session state in its channel-scoped data directory), and apply controlled recovery: re-issue the prompt ONLY if no response (reply, reaction, or file send) has been recorded for the session; if a response was already sent, the session SHALL complete without re-prompting. Side-effectful skill operations (`send-reply`, `memory-save`) are guarded by the in-bot session registry state (`replySent`, `fileSent`, attempt counts), which survives the agent process restart because it lives in the bot process. When the prompt IS re-issued, the recovery/retry prompt SHALL enumerate the session's already-executed skill operations (memory-save calls, reply attempts, file sends), so the resumed agent knows what has already happened and avoids re-doing side effects.

#### Scenario: In-flight session resumed after process restart
- **GIVEN** a shared process dies while a session's prompt is in flight and no response has been sent yet
- **WHEN** the system restarts that pool key's process
- **THEN** it SHALL load the existing session via ACP `session/load` (history is replayed to the client) and re-issue the prompt on the resumed session

#### Scenario: Response already sent — no re-prompt
- **GIVEN** a shared process dies while a session's prompt is in flight and the session has already sent a reply or delivered a file
- **WHEN** the system restarts the process and loads the session
- **THEN** the session SHALL complete WITHOUT re-issuing the prompt, so no duplicate reply or memory event is produced

### Requirement: Shared Process Environment Scoping

The environment of a shared process SHALL be fixed at spawn time. Its `XDG_DATA_HOME` and `TMPDIR` SHALL point to channel-scoped directories under the bot data root (`{dataRoot}/opencode-data/{poolKey}` and `{dataRoot}/channel-tmp/{poolKey}`), deliberately OUTSIDE any user's workspace, so one user's agent cannot read another user's OpenCode database, tool outputs, or session history. The process environment SHALL carry the skill-JWT directory (`SKILL_JWT_DIR`, under which the per-session JWT files live); the deployment `SKILL_API_SECRET` SHALL NOT be placed in the agent process environment (the bot process alone holds it, as both issuer and verifier). Every path exported into the spawned process environment (`TMPDIR`, `XDG_DATA_HOME`, `SKILL_JWT_DIR`, and the process working directory) SHALL be an absolute path, lexically resolved against the bot process working directory at environment-construction time, so skill scripts resolve them identically from ANY tool working directory. Per-session ACP parameters (session `cwd`, MCP servers, model, mode, reasoning effort) SHALL continue to be applied per session on the shared connection; payload staging for a session uses that session's own workspace tmp dir, carried to the agent via a per-session `tmpDir` prompt variable. In shared-process mode the permission gate SHALL confine agent file access to the session's own workspace, the session-scoped payload staging dir (the rendered `tmpDir`), the pool-key-scoped data root (OpenCode tool-output), and the agent workspace; agent reads of the shared OpenCode DB or another session's tool-output files SHALL be rejected in restricted mode, so cross-USER visibility is impossible while cross-session visibility within the pool key is the accepted trade-off.

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

