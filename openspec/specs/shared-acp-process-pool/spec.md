# shared-acp-process-pool Specification

## Purpose
Runs a single long-lived `opencode acp` subprocess per active channel and routes all sessions of that channel over it, eliminating the per-conversation agent cold start and enabling session resumption across process restarts.

## Requirements

### Requirement: Per-Channel Shared ACP Process Pool

The system SHALL maintain a pool of long-lived ACP agent subprocesses keyed by a canonical entry identity, lazily spawning one subprocess per entry and reusing it across that entry's sessions. For agent type `omp` the entry identity SHALL additionally carry the deployment agent type and the session's resolved effective permission mode; for agent type `opencode` it SHALL remain exactly the canonical pool key.

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

#### Scenario: Same-mode OMP sessions reuse the mode's live process
- **GIVEN** an OMP deployment pool with a live restricted-mode process for pool key `discord/123`
- **WHEN** another session for `discord/123` whose resolved effective mode is restricted requests a process
- **THEN** the system SHALL reuse that process's connection for a new ACP session instead of spawning a second restricted process

#### Scenario: Cross-mode OMP request spawns a separate process with its own state namespace
- **GIVEN** an OMP deployment pool with a live restricted-mode process for pool key `discord/123`
- **WHEN** a session for `discord/123` whose resolved effective mode is native-YOLO requests a process
- **THEN** the system SHALL NOT reuse the restricted process and SHALL acquire or spawn a separate native-YOLO process whose spawn configuration carries the mode-scoped state namespace for native-YOLO, while the restricted process remains live

#### Scenario: A mixed-decision channel holds two concurrent OMP processes
- **GIVEN** an OMP deployment channel whose account-level decisions resolve to restricted for user A and native-YOLO for user B
- **WHEN** both sessions have run
- **THEN** the pool SHALL hold one restricted and one native-YOLO `omp` process concurrently for that pool key, each serving only its own mode's sessions

#### Scenario: Per-mode reclaim independence
- **GIVEN** a pool key with both a live restricted and a live native-YOLO OMP entry, and the restricted entry's refcount has dropped to zero while the YOLO entry is leased
- **WHEN** the reclaim idle time elapses
- **THEN** the system SHALL reclaim only the restricted entry and SHALL NOT disconnect, signal, or reclaim the leased native-YOLO entry of the same pool key

#### Scenario: Acquisition options carry the mode explicitly
- **GIVEN** a pool acquisition request whose options state agent type `omp` and resolved mode restricted
- **WHEN** the pool lazily spawns the entry's process
- **THEN** the spawn configuration SHALL be built from those explicit option values, and the pool SHALL NOT read or infer the mode or agent type from the live entry, its connector, or its own state

#### Scenario: Message and spontaneous-post pool keys
- **GIVEN** a message or channel-lurk session for a channel, or a spontaneous-post session
- **WHEN** the session requests an agent process
- **THEN** the system SHALL key the pool on `{platform}:{channelId}` for message/channel-lurk sessions and on the scheduler's target channel (e.g. `dm:{userId}`, `misskey/timeline/self`) for spontaneous-post sessions, each non-message session type getting its own process

#### Scenario: Lazy spawn and reuse follow the entry identity
- **GIVEN** no live process exists for an entry identity and a session for it starts
- **WHEN** the pool serves that session
- **THEN** the system SHALL lazily spawn one agent subprocess — restricted/YOLO `omp` or `opencode acp` per the entry — with the spawn configuration built from the explicitly supplied resolved mode, and SHALL keep it alive across that entry's sessions

#### Scenario: Every lease state counts as a lease
- **GIVEN** an entry whose sessions are queued, acquiring, in-flight, or recovering
- **WHEN** that entry's reclaim decision is evaluated
- **THEN** each of those states SHALL count as holding a lease and SHALL prevent the entry's process from being reclaimed

#### Scenario: Reclaim is non-acquirable and generation-checked
- **GIVEN** a pool entry carrying a generation counter and a `reclaiming` state
- **WHEN** the entry's reclaim fires
- **THEN** the entry SHALL be non-acquirable while `reclaiming`, a new spawn for the same entry identity SHALL wait until the old process has fully exited, and the reclaim timer callback SHALL re-validate that it belongs to the same generation

#### Scenario: Spawn directories follow the entry identity
- **GIVEN** a lazily spawned entry
- **WHEN** its process working, temporary, and state directories are created
- **THEN** they SHALL follow the entry identity so each mode's spawn gets its own directories
- **AND** OpenCode's existing channel-scoped directory paths SHALL remain byte-identical

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

When a shared process dies while a session's prompt is in flight, the system SHALL restart that pool key's process, resume the existing session via the ACP `session/load` method (OpenCode persists session state in its channel-scoped data directory), and apply controlled recovery: re-issue the prompt ONLY if no response (reply, reaction, or file send) has been recorded for the session; if a response was already sent, the session SHALL complete without re-prompting. Side-effectful skill operations (`send-reply`, `memory-save`) are guarded by the in-bot session registry state (`replySent`, `fileSent`, attempt counts), which survives the agent process restart because it lives in the bot process. When the prompt IS re-issued, the recovery/retry prompt SHALL enumerate the session's already-executed skill operations (memory-save calls, reply attempts, file sends), so the resumed agent knows what has already happened and avoids re-doing side effects.

Both crash reconnect and `session/load` recovery SHALL target the session's recorded acquisition context — the ORIGINAL permission mode, process/state namespace, absolute cwd, and operator MCP definitions written at acquisition — and the respawn SHALL occur in the SAME permission mode's process and state namespace; recovery SHALL never spawn or reuse an opposite-mode process and SHALL NOT re-resolve the mode (the recorded values are the recovery target). Verifying the session against that record SHALL happen BEFORE any teardown or load: loading an opposite-mode session, or a session whose recorded mode/namespace does not match the recovery context (including a session with no provenance record where provenance is required), is an OWNERSHIP VIOLATION that fails closed — not a recovery fallback, not a silent cross-mode load, and not reported as the existing "agent does not support session resumption" session loss. After a successful same-mode load, the resumed session's configuration SHALL be restored through the shared model-configuration logic (canonical option-cache restoration, then model and — best-effort, from the session's resolved value — reasoning reapplication), and the recovered session id's OWN per-session filesystem/permission gate context SHALL be re-registered before prompting resumes; another session's fallback context SHALL never be substituted for an unknown or unrecoverable session id. The named post-restore hook SHALL exist after gate-context restoration and before resumption, with no readiness assertion, handshake or deferred verification requirement. Every recovery failure (ownership violation, load failure, post-load model catalog miss, gate-context restore failure) SHALL remain isolated to the affected session's existing per-session error handling: recovery SHALL NOT cross permission modes, SHALL NOT drop the failed session's gate context to force progress, and SHALL leave other sessions' gate contexts, processes, and the execution lease untouched.

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

### Requirement: Effective Permission Mode Resolution Before Acquisition

For every session entry point, the system SHALL resolve the session's effective permission mode — global `--yolo` flag first, then per-channel/account `yolo` configuration, otherwise disabled — BEFORE constructing the agent spawn configuration or requesting a process from the pool, and no acquisition path SHALL spawn or reuse a process before that resolution completes.

#### Scenario: Message session resolves mode before spawning
- **GIVEN** a normal message session for a channel with `yolo: true` account configuration
- **WHEN** the orchestrator prepares the session's agent access
- **THEN** the effective-YOLO decision SHALL be completed before `createAgentConfig` is called or the pool is asked for a process, and the resolved mode SHALL be the one carried into the acquisition options

#### Scenario: Every pooled session type threads its resolved mode
- **GIVEN** channel-lurk, spontaneous-post, self-research, memory-maintenance, and channel-memory-maintenance sessions each running in shared-process mode
- **WHEN** each requests a pooled process
- **THEN** the acquisition options SHALL carry that session's resolved effective mode and the deployment agent type, and the mode SHALL have been resolved before the acquisition request

#### Scenario: Reminder session resolves mode before its per-spawn spawn
- **GIVEN** a scheduled-reminder session running in per-spawn mode
- **WHEN** the orchestrator builds its agent configuration
- **THEN** the effective-YOLO decision for the reminder's user/channel context SHALL be resolved before the spawn configuration is constructed

#### Scenario: Conversation summary does not acquire a process
- **GIVEN** a completed pooled session that produced a reply, triggering conversation-summary generation
- **WHEN** the summary step runs
- **THEN** it SHALL issue its prompt on the session's existing ACP session under the same execution lease without any pool acquisition or spawn

#### Scenario: Pool never infers the mode
- **GIVEN** a pool that already holds a live entry for a pool key
- **WHEN** an acquisition arrives whose explicit mode differs from every live entry's mode
- **THEN** the pool SHALL treat the request by its explicit mode (acquiring a separate entry) rather than reusing or restamping the live entry's mode

#### Scenario: Each entry point resolves in both operation modes
- **GIVEN** any of the seven enumerated session entry points — normal message, channel-lurk, spontaneous-post, self-research, memory-maintenance (workspace), channel memory-maintenance, and scheduled-reminder — running in either shared-pool or per-spawn operation
- **WHEN** the entry point prepares to acquire an agent process
- **THEN** the effective permission mode SHALL be resolved before the spawn configuration is constructed or a process is requested

#### Scenario: Pool runner and acquire step consume the explicit mode
- **GIVEN** the shared pool runner or the pool's own acquire step processing an acquisition request
- **WHEN** the request carries the resolved mode in its acquisition options
- **THEN** the step SHALL consume that mode rather than resolve or infer it

#### Scenario: Scheduler session resolution semantics remain unchanged
- **GIVEN** internal scheduler sessions (self-research, memory maintenance, channel memory maintenance)
- **WHEN** their effective permission mode is resolved
- **THEN** resolution SHALL continue to come from the global `--yolo` flag as today; this requirement governs ordering, explicitness, and coverage, not the YOLO decision rules

### Requirement: Mode-Split Pools Preserve Global Lease Serialization

Splitting the process pool by permission mode SHALL NOT enable parallel persona execution: the single global execution lease SHALL continue to cover every session across every entry identity — both OMP modes of the same pool key, different pool keys, and both queue lanes — so at most one agent session is in flight at any time. The interactive-before-maintenance ordering, starvation guard, queue-deadline sweep, and single release path SHALL apply unchanged to the mode-split entry set.

#### Scenario: Cross-mode sessions still serialize
- **GIVEN** an OMP deployment where a restricted-mode message session holds the lease and a native-YOLO message session for the same channel pool key is queued
- **WHEN** the YOLO session waits for its agent slot
- **THEN** it SHALL wait until the in-flight restricted session releases the lease, and SHALL NOT run concurrently on its separate process

#### Scenario: Lease covers the mode-split entry's full lifecycle
- **GIVEN** a session running on a native-YOLO OMP entry
- **WHEN** its turn executes
- **THEN** the lease SHALL cover its `newSession`, model/mode/config-option calls, prompt/retry, cancel, recovery, and cleanup exactly as it does for restricted and OpenCode entries

### Requirement: OpenCode Pool Reuse Unchanged By Mode Splitting

The mode dimension of pool identity SHALL apply only to agent type `omp`. For OpenCode, pool identity, same-process reuse across sessions of a channel, per-session ACP mode switching (the YOLO override applied per session on the shared connection), the canonical pool key strings, the channel-scoped spawn environment paths, and the process working directory SHALL remain byte-for-byte unchanged, protected by consumer-visible regression tests.

#### Scenario: OpenCode mixed-mode channel keeps one process
- **GIVEN** an OpenCode deployment channel where one session resolves YOLO and the next resolves restricted
- **WHEN** both sessions run
- **THEN** both SHALL reuse the single channel process, with YOLO applied through the existing per-session mode switch and no second process spawned

#### Scenario: OpenCode pool entry identity unchanged
- **GIVEN** the same OpenCode workload replayed before and after this change
- **WHEN** pool entries and their spawned environments are compared
- **THEN** entry identity, `TMPDIR`, `XDG_DATA_HOME`, process cwd, and the skill-process marker environment SHALL be byte-identical
