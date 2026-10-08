# Delta: acp-integration

## ADDED Requirements

### Requirement: Per-Spawn OMP Mode Distinctness And Shared-Process Skill Identity Invariants

Per-spawn (non-pool) agent spawns SHALL pass the session's resolved effective permission mode into the agent configuration exactly as the pooled paths do, so that a restricted per-spawn OMP process and a native-YOLO per-spawn OMP process never share a process state root.

#### Scenario: Per-spawn OMP modes get distinct state roots
- **GIVEN** an OMP deployment in per-spawn mode where one session resolves restricted and another resolves native-YOLO
- **WHEN** each session's spawn configuration is built with its resolved mode
- **THEN** the two spawn configurations SHALL carry distinct mode-scoped process state roots and neither mode's state root SHALL be reused by the other

#### Scenario: Pooled OMP processes never freeze SESSION_ID
- **GIVEN** an OMP deployment running shared-process mode
- **WHEN** a restricted or native-YOLO pooled process is spawned
- **THEN** its environment SHALL contain the shared-process marker and SHALL NOT contain a process-wide `SESSION_ID` value, exactly as OpenCode pooled processes behave today

#### Scenario: Per-spawn mode threading matches pooled mode threading
- **GIVEN** the same session context (same resolved mode) executed once in shared-pool mode and once in per-spawn mode
- **WHEN** both runs build their agent configuration
- **THEN** both SHALL receive the same resolved permission mode, with no path defaulting, re-resolving differently, or reading a stale/global-only value where the entry point had a per-session decision available

#### Scenario: Shared-process marker invariants hold for every agent type
- **GIVEN** any shared (pooled) subprocess, regardless of agent type or permission mode
- **WHEN** its spawn environment is built
- **THEN** the environment SHALL keep exporting the shared-process marker (`SKILL_SHARED_PROCESS=1`) and SHALL NOT freeze a process-wide `SESSION_ID`, keeping the per-session pointer as the sole shared-mode skill identity source

#### Scenario: Invariants hold for both OMP modes and OpenCode
- **GIVEN** an OMP deployment in either permission mode or an OpenCode deployment exercising the spawn and skill-identity paths
- **WHEN** the per-spawn distinctness and shared-process identity invariants are checked
- **THEN** they SHALL hold identically, because later payload-portability work consumes them

### Requirement: Session Ownership Record Written At Acquisition

At the moment a session acquires or spawns its agent process — pooled or per-spawn — the system SHALL record the session's ORIGINAL resolved permission mode and the process/state namespace selected for that acquisition in the in-bot session-ownership bookkeeping.

#### Scenario: Ownership fields written at pooled acquisition
- **GIVEN** an OMP deployment pooled session whose resolved mode is native-YOLO
- **WHEN** the pool hands it the native-YOLO entry's connector under the lease
- **THEN** the session's ownership record SHALL carry the original mode `native-YOLO` and that entry's process/state namespace, recorded before the session's first ACP call

#### Scenario: Ownership fields written at per-spawn acquisition
- **GIVEN** an OMP deployment per-spawn session whose resolved mode is restricted
- **WHEN** its process is spawned for the session
- **THEN** the session's ownership record SHALL carry the original mode `restricted` and the per-spawn mode-scoped state namespace

#### Scenario: Recovery interface is read-only consumption
- **GIVEN** a session whose ownership record was written at acquisition
- **WHEN** crash recovery or session loading later consults the record (behavior owned by row 11)
- **THEN** the record's mode and namespace fields SHALL be exactly the acquisition-time values — no acquisition or normal session path SHALL overwrite them with a re-resolved or opposite mode

#### Scenario: OpenCode ownership record keeps existing identity
- **GIVEN** an OpenCode pooled session running with per-session YOLO switching
- **WHEN** its ownership record is written at acquisition
- **THEN** the record SHALL name the existing pool-key-scoped data-root identity and OpenCode reuse behavior SHALL be unchanged; no OpenCode session SHALL be split or rejected because of the new fields

#### Scenario: Bookkeeping spans registry record and audit event
- **GIVEN** a session acquiring or spawning its agent process, pooled or per-spawn
- **WHEN** the ownership values are recorded
- **THEN** the system SHALL write them to the registry's active-session record and emit a bounded audit event alongside the existing session-start/agent-connect events

#### Scenario: Record is durable and written from resolved values
- **GIVEN** an ownership record written from the same explicitly resolved values used to build the acquisition
- **WHEN** later per-session activity runs
- **THEN** the recorded values SHALL remain durable for the session's lifetime and SHALL NOT be mutated by that activity

#### Scenario: Restore owner consumes the record without redefining it
- **GIVEN** the write side of the ownership interface established here
- **WHEN** reconnect/`session/load` verification, gate-context restoration, or rejection of opposite-mode loads runs (owned by `restore-mode-owned-acp-sessions`, row 11)
- **THEN** that owner SHALL consume, never redefine, the recorded fields
