# Delta: acp-integration

## ADDED Requirements

### Requirement: Per-Spawn OMP Mode Distinctness And Shared-Process Skill Identity Invariants

Per-spawn (non-pool) agent spawns SHALL follow the same permission-mode distinctness as pooled acquisition: every per-spawn session path SHALL pass the session's resolved effective permission mode into the agent configuration exactly as the pooled paths do, so a restricted per-spawn OMP process and a native-YOLO per-spawn OMP process never share a process state root. Shared (pooled) subprocesses SHALL keep exporting the shared-process marker (`SKILL_SHARED_PROCESS=1`) and SHALL continue NOT to freeze a process-wide `SESSION_ID` in the spawn environment, regardless of agent type or permission mode — the per-session pointer remains the sole shared-mode skill identity source. These invariants SHALL hold identically for both OMP modes and for OpenCode, because later payload-portability work consumes them.

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

### Requirement: Session Ownership Record Written At Acquisition

At the moment a session acquires (or spawns) its agent process — pooled or per-spawn — the system SHALL record in the in-bot session-ownership bookkeeping (the registry's active-session record, plus a bounded audit event alongside the existing session-start/agent-connect events) the session's ORIGINAL resolved permission mode and the process/state namespace selected for that acquisition (the mode-scoped OMP state namespace for OMP entries; the existing pool-key-scoped data-root identity for OpenCode). The recorded values SHALL be durable for the session's lifetime, SHALL be written from the same explicitly resolved values used to build the acquisition, and SHALL NOT be mutated by later per-session activity. This change establishes the WRITE side of the interface; reconnect/`session/load` verification against these fields, gate-context restoration, and rejection of opposite-mode loads are owned by `restore-mode-owned-acp-sessions` (row 11), which SHALL consume — never redefine — these fields.

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
