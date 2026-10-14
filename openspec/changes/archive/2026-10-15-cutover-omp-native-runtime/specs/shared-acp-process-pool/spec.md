# Spec Delta

## ADDED Requirements

### Requirement: Shared ACP Pool Entry Lease And Native Data Identity

The system SHALL maintain long-lived ACP subprocesses per canonical entry, lazily spawn and reuse them, and preserve global leases. OMP entries SHALL additionally carry configured agent type and resolved effective approval mode; OpenCode entries SHALL remain the canonical pool key. Only native OMP database/session data SHALL require mode-specific directories; OMP cwd and TMPDIR SHALL use the existing caller/shared channel conventions.

#### Scenario: Reclaim and respawn never double-open the channel data root
- **GIVEN** an entry is reclaiming and its old process is exiting
- **WHEN** a new session requests that entry
- **THEN** spawn SHALL wait until the old process exits with the same-generation check, preserving one OpenCode process per channel data root.

#### Scenario: First session for a channel spawns the channel process
- **WHEN** a first OpenCode session begins with pooling enabled
- **THEN** the pool SHALL spawn the existing dumb-init-wrapped, cleared-parent-environment opencode acp process and route ACP calls through it.

#### Scenario: Subsequent sessions for the same channel reuse the live process
- **WHEN** another session begins on a live OpenCode channel entry
- **THEN** it SHALL create a new ACP session on the existing stdio connection without spawning a new process.

#### Scenario: Channel process reclaimed when idle
- **WHEN** idle time elapses with no queued, in-flight or recovering leases
- **THEN** the pool SHALL recheck idleness under its lock and terminate/remove the entry, allowing a concurrent acquire to cancel reclaim.

#### Scenario: Scheduler session types get their own pool key
- **WHEN** self-research for u_42 or maintenance for discord/77 acquires an entry
- **THEN** canonical self-research:u_42 and memory-maintenance:discord/77 keys SHALL retain dedicated processes.

#### Scenario: Same-mode OMP sessions reuse the mode's live process
- **WHEN** another restricted session acquires a live restricted OMP entry for discord/123
- **THEN** it SHALL reuse that connection for a new ACP session.

#### Scenario: Cross-mode OMP request spawns a separate process with its own state namespace
- **WHEN** a YOLO session acquires discord/123 while its restricted OMP entry lives
- **THEN** it SHALL acquire/spawn a distinct YOLO process with distinct selected native XDG data, leaving the restricted process alive.

#### Scenario: A mixed-decision channel holds two concurrent OMP processes
- **WHEN** users resolving to restricted and YOLO run in one channel
- **THEN** the pool SHALL retain one process per mode, each serving its own mode's sessions.

#### Scenario: Per-mode reclaim independence
- **WHEN** one mode's unleased entry becomes reclaimable while its sibling mode remains leased
- **THEN** only the unleased mode SHALL be reclaimed or signaled.

#### Scenario: Acquisition options carry the mode explicitly
- **WHEN** OMP lazily spawns an entry
- **THEN** agent type and mode SHALL come from explicit acquisition options, not a live connector/entry observation.

#### Scenario: Message and spontaneous-post pool keys
- **WHEN** message, channel-lurk or spontaneous-post sessions acquire entries
- **THEN** existing platform:channelId and scheduler target-channel keys SHALL remain, with non-message types retaining their own processes.

#### Scenario: Lazy spawn and reuse follow the entry identity
- **WHEN** a first session requests an absent entry
- **THEN** exactly one subprocess SHALL be lazily spawned from explicit resolved mode and retained across that entry's sessions.

#### Scenario: Every lease state counts as a lease
- **WHEN** reclaim considers queued, acquiring, in-flight or recovering sessions
- **THEN** each SHALL prevent process reclaim.

#### Scenario: Reclaim is non-acquirable and generation-checked
- **WHEN** reclaim fires for an entry generation
- **THEN** it SHALL revalidate its generation, make the entry non-acquirable while reclaiming and wait for process exit before a replacement spawn.

#### Scenario: Native data follows the entry identity
- **WHEN** OMP mode entries spawn with caller cwd and the existing per-spawn or shared channel TMPDIR
- **THEN** their selected native database/session data SHALL remain mode-separated without requiring distinct cwd/TMPDIR namespaces.
- **AND** OpenCode's existing channel-scoped directories and observable reuse outcomes SHALL remain unchanged.

## REMOVED Requirements

### Requirement: Per-Channel Shared ACP Process Pool

**Reason**: This mixed contract includes obsolete mode-separated OMP cwd/TMPDIR obligations.

**Migration**: Shared ACP Pool Entry Lease And Native Data Identity preserves every shared lease/key/reclaim and OpenCode scenario while replacing only the obsolete OMP directory obligation. No data migration or compatibility layer is introduced.
