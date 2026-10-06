## ADDED Requirements

### Requirement: Bootstrap OMP Version Compatibility Check

The system SHALL verify the installed OMP CLI version at bootstrap — only when the resolved deployment agent type is `omp` — against a known-good minimum (defaulting to the pinned image-intended version `18.6.1`) and surface a prominent, structured warning when the installed version is below it or cannot be determined. The check SHALL be non-fatal: startup proceeds regardless, the system SHALL NOT download, upgrade, or block on the outcome, and the container pin remains the actual prevention; the check is an observability measure mirroring the established OpenCode pattern. On OpenCode-only deployments the check SHALL NOT run, so no spurious warning is emitted for an intentionally absent binary.

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

### Requirement: OMP Version Minimum Environment Override

The OMP known-good minimum SHALL be overridable at runtime via the `AGENT_OMP_MIN_VERSION` environment variable, honored when set and non-empty and ignored when blank, defaulting otherwise to the pinned known-good version. The variable's introduction SHALL be documented in this change across `config.example.yaml`, `.env.example`, and `helm/values.yaml` with exactly the same treatment the OpenCode counterpart variable receives today, and SHALL introduce no other new configuration, environment, or Helm field.

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

Automated acceptance of the OMP version-health logic SHALL run exclusively against mocked command outputs and unit-level assertions, certifying the `OK`, `BELOW_MINIMUM`, and `UNKNOWN` decision paths, the override semantics, and the never-blocks-startup property without executing a real `omp` binary, building a container, or contacting the network. Real installed-binary, image-build, and architecture behavior remains user-owned manual verification and SHALL be stated as unverified by the automated suite.

#### Scenario: Marker decisions proven on mock outputs
- **GIVEN** injected fake detectors returning a valid version, a below-minimum version, an unparseable string, a spawn failure, and a timeout
- **WHEN** the version-health logic runs against each
- **THEN** the returned results SHALL be `ok`, `below_minimum`, `unknown`, `unknown`, and `unknown` respectively
- **AND** no test SHALL have spawned a real `omp` process or opened a network connection

#### Scenario: Suite states its evidence limit
- **WHEN** the packaging documentation's verification section is read
- **THEN** it SHALL state that image build/execution/architecture smoke and installed-binary checks are user-owned manual verification with outcomes unverified by the automated suite
