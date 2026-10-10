# Agent Version Compatibility

## Purpose

Verifies and pins the external ACP agent CLI version so that ACP contract changes surface at build and bootstrap time instead of silently degrading sessions. A known-good minimum is enforced via a non-fatal observability check, while the container build installs a fixed, checksum-verified version as the actual prevention.

## Requirements

### Requirement: Pinned OpenCode Version in Container Build

The container image SHALL install a fixed, known-good OpenCode CLI version rather than tracking `releases/latest`, so that ACP contract changes in OpenCode releases cannot silently degrade the harness at deploy time.

#### Scenario: Container build downloads the pinned version
- **GIVEN** the container build is invoked with `OPENCODE_VERSION` set (or the documented default)
- **WHEN** the `opencode-unpacker` stage downloads the OpenCode CLI
- **THEN** it SHALL download the artifact for exactly that version tag (e.g. `releases/download/v{OPENCODE_VERSION}/opencode-linux-{arch}.tar.gz`), never `releases/latest`

#### Scenario: Downloaded artifact is checksum-verified
- **GIVEN** the pinned OpenCode artifact has been downloaded
- **WHEN** the download stage completes
- **THEN** it SHALL verify the archive against the per-architecture SHA-256 checksum declared at build time and fail the build on mismatch

#### Scenario: Unsupported architecture still fails fast
- **GIVEN** a `TARGETARCH` outside `amd64`/`arm64`
- **WHEN** the download URL is constructed
- **THEN** the build SHALL exit with an error naming the unsupported architecture

#### Scenario: Pinned version is an explicit build argument with a documented default
- **GIVEN** the container build is invoked
- **WHEN** the OpenCode CLI version is selected
- **THEN** the fixed version SHALL be declared as an explicit build argument (`ARG OPENCODE_VERSION`) with a documented default, so the exact version being installed is visible at build time

---

### Requirement: Bootstrap OpenCode Version Compatibility Check

The system SHALL verify the installed OpenCode CLI version at bootstrap against a known-good minimum and surface a prominent, structured warning when the installed version is below it (or cannot be determined), so operators notice ACP contract drift before sessions fail. The check SHALL be non-fatal: startup proceeds regardless, because the permission gate already handles both the old and new request shapes and the check is an observability measure — the container pin is the actual prevention.

#### Scenario: Installed version at or above the known-good minimum
- **GIVEN** the installed OpenCode CLI reports a version at or above the known-good minimum (e.g. `1.17.13`)
- **WHEN** bootstrap runs the version check
- **THEN** the system SHALL log the detected version at INFO level and continue startup without a warning

#### Scenario: Installed version below the known-good minimum
- **GIVEN** the installed OpenCode CLI reports a version below the known-good minimum (e.g. `1.17.12`, whose permission requests used the legacy title shape)
- **WHEN** bootstrap runs the version check
- **THEN** the system SHALL log a prominent, structured WARN (greppable marker such as `BELOW_MINIMUM`) naming the detected version, the known-good minimum, and the risk of ACP request-shape incompatibility, and SHALL continue startup

#### Scenario: Version cannot be determined
- **GIVEN** the `opencode --version` subprocess fails, times out, or returns an unparseable string
- **WHEN** bootstrap runs the version check
- **THEN** the system SHALL log a structured WARN (marker such as `UNKNOWN`) that the version could not be verified and SHALL continue startup without failing

#### Scenario: Version check never executes the agent protocol
- **GIVEN** bootstrap is running the version check
- **WHEN** the check spawns the OpenCode CLI
- **THEN** it SHALL only invoke the version flag (e.g. `opencode --version`) and SHALL NOT start an ACP session, connect to a model provider, or perform any network I/O

### Requirement: Bootstrap OMP Version Compatibility Check

The system SHALL verify the installed OMP CLI version at bootstrap against a known-good minimum — defaulting to the pinned image-intended version `18.6.1` — only when the resolved deployment agent type is `omp`, and SHALL surface a prominent, structured warning when the installed version is below it or cannot be determined.

#### Scenario: Installed version at or above the known-good minimum
- **GIVEN** a mocked `omp --version` response reporting a version at or above the known-good minimum
- **WHEN** bootstrap runs the OMP version check on an `omp` deployment
- **THEN** the system SHALL log the detected version with the greppable marker `OMP version check: OK` and continue startup without a warning

#### Scenario: Installed version below the known-good minimum
- **GIVEN** a mocked `omp --version` response reporting a version below the known-good minimum
- **WHEN** bootstrap runs the OMP version check
- **THEN** the system SHALL log a structured WARN with the greppable marker `OMP version check: BELOW_MINIMUM` naming the detected version and the known-good minimum
- **AND** startup SHALL continue uninterrupted

#### Scenario: Version cannot be determined
- **GIVEN** a mocked `omp --version` subprocess that fails to spawn, times out, or prints an unparseable string
- **WHEN** bootstrap runs the OMP version check
- **THEN** the system SHALL log a structured WARN with the greppable marker `OMP version check: UNKNOWN`
- **AND** startup SHALL continue without failing and without any automatic download or upgrade

#### Scenario: Version check never executes the agent protocol
- **GIVEN** bootstrap is running the OMP version check
- **WHEN** the check spawns the OMP CLI
- **THEN** it SHALL invoke only the version flag with a bounded timeout and no network I/O
- **AND** it SHALL NOT start an ACP session or connect to any provider

#### Scenario: OpenCode-only deployment emits no OMP warning
- **GIVEN** a deployment whose resolved agent type is `opencode`
- **WHEN** bootstrap runs version health checks
- **THEN** the OMP version check SHALL NOT execute
- **AND** no `OMP version check:` marker SHALL appear in the startup log

#### Scenario: Check is non-fatal observability
- **GIVEN** the bootstrap OMP version check is running
- **WHEN** the installed version is below the minimum or cannot be determined
- **THEN** startup SHALL proceed regardless and the system SHALL NOT download, upgrade, or block on the outcome
- **AND** the container pin SHALL remain the actual prevention, with the check an observability measure mirroring the established OpenCode pattern

### Requirement: OMP Version Minimum Environment Override

The OMP known-good minimum SHALL be overridable at runtime via the `AGENT_OMP_MIN_VERSION` environment variable, honored when set and non-empty, ignored when blank, and defaulting otherwise to the pinned known-good version.

#### Scenario: Non-empty override replaces the default minimum
- **GIVEN** `AGENT_OMP_MIN_VERSION` is set to a version string
- **WHEN** the effective OMP minimum is computed
- **THEN** the override value SHALL be used for the check

#### Scenario: Blank override falls back to the default
- **GIVEN** `AGENT_OMP_MIN_VERSION` is unset or contains only whitespace
- **WHEN** the effective OMP minimum is computed
- **THEN** the pinned known-good default SHALL be used

#### Scenario: Documentation trio synchronized on introduction
- **WHEN** the three configuration documentation files are inspected
- **THEN** each SHALL document `AGENT_OMP_MIN_VERSION` as an observability-only override beside the OpenCode counterpart
- **AND** no other new configuration, environment, or Helm field SHALL appear as introduced by this change

### Requirement: OMP Version Health Acceptance Is Mock-Only

Automated acceptance of the OMP version-health logic SHALL run exclusively against mocked command outputs and unit-level assertions, certifying the `OK`, `BELOW_MINIMUM`, and `UNKNOWN` decision paths, the override semantics, and the never-blocks-startup property without executing a real `omp` binary, building a container, or contacting the network.

#### Scenario: Marker decisions proven on mock outputs
- **GIVEN** injected fake detectors returning a valid version, a below-minimum version, an unparseable string, a spawn failure, and a timeout
- **WHEN** the version-health logic runs against each
- **THEN** the returned results SHALL be `ok`, `below_minimum`, `unknown`, `unknown`, and `unknown` respectively
- **AND** no test SHALL have spawned a real `omp` process or opened a network connection

#### Scenario: Suite states its evidence limit
- **WHEN** the packaging documentation's verification section is read
- **THEN** it SHALL state that image build/execution/architecture smoke and installed-binary checks are user-owned manual verification with outcomes unverified by the automated suite
