# Delta: shared-acp-process-pool

## MODIFIED Requirements

### Requirement: Per-Channel Shared ACP Process Pool

The system SHALL maintain a pool of long-lived ACP agent subprocesses keyed by a canonical pool key. Message and channel-lurk sessions SHALL use the key `{platform}:{channelId}`; spontaneous-post sessions SHALL use the scheduler's target channel (e.g. `dm:{userId}`, `misskey/timeline/self`); self-research sessions SHALL use `self-research:{userId}` and memory-maintenance sessions SHALL use `memory-maintenance:{workspaceKey}` (each non-message session type gets its own process, effectively per-run). The pool's process identity SHALL additionally include, for agent type `omp` only, the deployment agent type and the session's resolved effective permission mode: the entry identity for `omp` SHALL be composed from the canonical pool key plus the resolved mode, so a same-mode request for the same pool key reuses the live process while a different-mode request acquires or lazily spawns a SEPARATE process carrying that mode's spawn-scoped state namespace. A pool key whose sessions carry different resolved modes SHALL therefore be able to hold two concurrent `omp` processes (restricted and native-YOLO). For agent type `opencode` the entry identity SHALL remain exactly the canonical pool key — the mode SHALL NOT participate in OpenCode pool identity. The acquisition options SHALL carry the agent type and resolved permission mode explicitly; the pool SHALL NOT infer either from a live connector, an existing entry, or its own state. When no live process exists for an entry identity and a session for it starts, the system SHALL lazily spawn one agent subprocess (restricted/YOLO `omp` or `opencode acp` per the entry) with the spawn configuration built from the explicitly supplied resolved mode, and keep it alive across that entry's sessions. The pool SHALL track a per-process reference count (queued, acquiring, in-flight, and recovering sessions all hold a lease); when no leased sessions remain for the entry and the configured reclaim idle time has elapsed, the system SHALL terminate that process and remove it from the pool, re-checking idleness under the pool lock so a concurrent acquire never races the reclaim. Each pool entry SHALL carry a generation counter and a `reclaiming` state: a reclaim marks the entry non-acquirable under the pool lock, waits for the old process to fully exit before a new spawn for the same entry identity is allowed, and the reclaim timer callback SHALL re-validate that it belongs to the same generation — so two agent processes never open the same mode-scoped process state root (or the OpenCode channel-scoped data root) at once, and a restricted-mode entry's reclaim never interacts with a concurrently live native-YOLO entry of the same pool key. Spawn-time creation of the entry's process working/temporary/state directories SHALL follow the entry identity so each mode's spawn gets its own directories and OpenCode's existing channel-scoped directory paths remain byte-identical.

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

## ADDED Requirements

### Requirement: Effective Permission Mode Resolution Before Acquisition

For every session entry point, the system SHALL resolve the session's effective permission mode using the existing effective-YOLO resolution (global `--yolo` flag taking precedence, then per-channel/account `yolo` configuration, otherwise disabled) BEFORE constructing the agent spawn configuration or requesting a process from the pool, and no acquisition path SHALL spawn or reuse a process before that resolution completes. The enumerated entry points are: (1) normal message sessions, (2) channel-lurk sessions, (3) spontaneous-post sessions, (4) self-research sessions, (5) memory-maintenance (workspace) sessions, (6) channel memory-maintenance sessions, and (7) scheduled-reminder sessions — each in both shared-pool and per-spawn operation — plus (8) the shared pool runner and the pool's own acquire step, which SHALL consume the mode from the acquisition options rather than resolve or infer it, and (9) the conversation-summary step, which runs on the session's already-acquired process under the same lease and SHALL NOT acquire a second process. The resolution semantics themselves SHALL remain the existing ones: internal scheduler sessions (self-research, memory maintenance, channel memory maintenance) resolve from the global flag as today; this requirement governs ordering, explicitness, and coverage, not the YOLO decision rules.

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
