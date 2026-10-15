# Spec Delta

## ADDED Requirements

### Requirement: Shared OMP Native Runtime Payload With Private Mutable State

Every pooled and per-spawn OMP data root SHALL consume one shared prepared native payload through the loader-supported `omp/natives` link, while its databases, sessions and remaining data stay private to the existing mode, pool or per-spawn root. Launch preflight SHALL refuse to spawn when that payload is absent, incomplete or mismatched, instead of letting the runtime create or download a channel-local native copy.

#### Scenario: One payload serves every root
- **GIVEN** two pooled roots of different modes and one per-spawn root connected to the prepared payload
- **WHEN** each root launches
- **THEN** every root SHALL load native code from the single prepared payload with unchanged payload bytes and file identities
- **AND** each root SHALL retain its own distinct databases and sessions

#### Scenario: Preflight agreement before spawn
- **GIVEN** a prepared payload whose version or platform does not match the resolved launch executable, or whose expected addon files are missing
- **WHEN** launch preflight runs for a mode root
- **THEN** launch SHALL fail with a prepared-cache remedy naming the expected identity
- **AND** the system SHALL not extract, copy or download native bytes during the session

#### Scenario: Idempotent link installation
- **GIVEN** a mode root that already holds the exact managed `omp/natives` link
- **WHEN** root preparation runs again, or a concurrent creator installs the identical link
- **THEN** preparation SHALL report success without changing the payload or the root's private state

#### Scenario: Occupied or unsafe entry is refused
- **GIVEN** a real directory, a mismatched or dangling link, a regular file at the reserved `omp/natives` entry, or a symlinked or escaping managed parent component
- **WHEN** launch preflight runs
- **THEN** it SHALL fail before agent spawn with an occupied or invalid-cache diagnostic
- **AND** it SHALL not follow the unexpected link, delete the existing copy or modify private data to make launch succeed
- **AND** a failed preflight SHALL leave the native payload and existing state untouched apart from empty managed directories created for a fresh root

#### Scenario: Occupied legacy directory names its own remedy
- **GIVEN** a mode root whose `omp/natives` entry is the real directory a previous OMP release extracted into, as on already-affected deployments
- **WHEN** launch preflight runs
- **THEN** the diagnostic SHALL name the exact occupied path and the operator removal action
- **AND** it SHALL NOT remove, migrate or truncate that directory automatically, so the root stays launch-blocked until an operator clears it

#### Scenario: No shared mutable state
- **WHEN** roots of any mode, pool or per-spawn shape are connected to the shared payload
- **THEN** `XDG_DATA_HOME`, the whole `omp` child, model and auth databases, session directories and HOME SHALL remain per-root and writable
- **AND** session staging SHALL remain session cwd/tmp/{Skill API session ID}

## MODIFIED Requirements

### Requirement: Native OMP Assets And Data Reachability Under Shared Confinement

Configured filesystem confinement SHALL retain the existing shared mount mechanism and expose the selected authored OMP files and the selected shared OMP native payload subtree read-only and selected native mode data child read-write. It SHALL not grant the parent deployment/pool/HOME tree or sibling data roots; the shared read-only skill mount and overlap refusal SHALL remain.

#### Scenario: Confined native model and data
- **WHEN** OMP starts with filesystemConfinement enabled
- **THEN** native OMP SHALL consume the selected authored model/config assets and persist/load its own selected XDG data inside the confined view.

#### Scenario: Selected roots only
- **WHEN** the confined process attempts to read a sibling mode/pool marker or mutate the skill root
- **THEN** filesystem access SHALL fail and the shared mount policy SHALL not be widened by the additional OMP runtime inputs.

#### Scenario: OpenCode mounts unchanged
- **WHEN** OpenCode is spawned with the same sandbox configuration
- **THEN** its existing runtime mounts and observable access outcomes SHALL remain unchanged.

#### Scenario: Shared native payload reachable read-only
- **GIVEN** a confined OMP launch whose mode root links to the shared prepared native payload
- **WHEN** the process starts
- **THEN** only the selected shared native subtree SHALL be additionally reachable, bound at its literal link target after every writable bind
- **AND** a write attempt from the confined view SHALL fail and the shared payload bytes SHALL remain unchanged
- **AND** no writable alias or nested writable runtime path SHALL expose that payload read-write
- **AND** the cache's parent HOME or deployment tree SHALL not be exposed to make the link resolve
- **AND** a missing payload source or failed mount SHALL fail the launch instead of falling back to an unconfined start

#### Scenario: Unconfined native posture unchanged
- **GIVEN** a session with filesystem confinement disabled
- **WHEN** OMP launches through the shared payload
- **THEN** its existing operator-trusted posture SHALL remain
- **AND** no additional tool or cache permission restriction SHALL be introduced by this cache reuse

### Requirement: Native OMP Mode Data And Session Staging Separation

OMP SHALL retain distinct native session/database data directories for its separate approval-mode processes, while native runtime code comes from the one shared prepared payload. Process cwd SHALL follow the existing caller/session working directory, and config HOME SHALL remain the normal inherited deployment HOME.

#### Scenario: Native data separation
- **WHEN** OMP restricted and YOLO start under one conversation/pool key
- **THEN** their native persisted data SHALL use distinct selected mode data roots without isolated HOME or neutral-cwd proof.

#### Scenario: Staging identity
- **WHEN** a skill payload is created for a session
- **THEN** its location SHALL remain session cwd/tmp/Skill API ID, independent of native process data directories.

#### Scenario: Shared code with private data
- **WHEN** restricted and YOLO roots under one conversation both start
- **THEN** their native runtime code SHALL come from the single shared prepared payload
- **AND** their persisted databases and sessions SHALL remain mode-distinct and writable
