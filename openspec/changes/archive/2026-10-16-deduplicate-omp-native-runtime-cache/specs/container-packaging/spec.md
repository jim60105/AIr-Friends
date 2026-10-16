# Spec Delta

## ADDED Requirements

### Requirement: Prepared Shared OMP Native Runtime Cache Artifact

The container image SHALL package exactly one prepared OMP native runtime payload per target platform, produced by running the checksum-verified pinned executable's real ACP initialization rather than a version probe, and publishing only the extracted native subtree. It SHALL NOT package per-channel native copies and SHALL NOT install a JavaScript/Bun runtime to prepare them.

#### Scenario: Preparation uses the real pinned consumer
- **GIVEN** a container build with the default or supplied `OMP_VERSION`
- **WHEN** the OMP unpacker stage prepares the native payload
- **THEN** it SHALL run the already checksum-verified executable through an ACP `initialize` handshake in a temporary HOME and cwd with an existing temporary XDG `omp` directory and without provider credentials
- **AND** it SHALL require a successful initialize response and validate the extracted regular native addon files for the target platform before publishing anything, expecting `pi_natives.linux-x64-baseline.node` and `pi_natives.linux-x64-modern.node` on `linux-x64` and at least `pi_natives.linux-arm64.node` on `linux-arm64`
- **AND** an absent, failed or invalid handshake SHALL abort the build without publishing a payload

#### Scenario: One payload per target platform
- **WHEN** the finished image is inspected
- **THEN** exactly one prepared native payload SHALL exist for the image's target platform under the contracted cache layout
- **AND** the pinned executable, license and third-party notices SHALL remain installed unchanged
- **AND** no per-channel, per-mode or per-pool native copies SHALL be packaged

#### Scenario: Only native bytes are published
- **WHEN** preparation completes
- **THEN** probe databases, probe HOME and probe session state SHALL be discarded
- **AND** only the version/platform native subtree SHALL be published
- **AND** a sidecar manifest of the published file names and sizes SHALL be published outside that subtree and SHALL define payload completeness

#### Scenario: Builder can execute the preparation child
- **GIVEN** a packaging stage that prepares the payload by running the pinned executable
- **WHEN** the builder cannot execute a child process
- **THEN** the build SHALL fail explicitly instead of shipping an image without a prepared payload
- **AND** probe state SHALL NOT enter any committed image layer

#### Scenario: No new runtime dependency
- **WHEN** the native-cache packaging steps are inspected
- **THEN** no step SHALL install a JavaScript/Bun runtime or speculative helper packages to prepare the payload

### Requirement: OMP Native Runtime Cache Identity And Deployment Selection

Prepared cache identity SHALL be the pinned executable version `18.6.1` combined with the target OS and architecture. An installed image cache root SHALL select image-deployment bytes, an incomplete installed root SHALL fail rather than fall back to development bytes, and selection SHALL come from the agent path module rather than an invented OMP cache environment variable.

#### Scenario: Identity mismatch fails closed
- **GIVEN** a resolved launch executable whose version or platform differs from the prepared cache identity
- **WHEN** the native cache is selected
- **THEN** selection SHALL fail naming the supported pin
- **AND** mismatched payload bytes SHALL not be consumed
- **AND** no alternative cache convention SHALL be selected
- **AND** the failure SHALL come from native-cache selection and preflight, leaving the existing bootstrap version check's WARN-only non-blocking contract unchanged
- **AND** cache identity SHALL derive from the pin, never from the operator-tunable `AGENT_OMP_MIN_VERSION` override

#### Scenario: Image cache root wins
- **GIVEN** a complete installed image cache root and a development cache root both exist
- **WHEN** the native cache is resolved
- **THEN** the image payload SHALL be selected

#### Scenario: Incomplete installed root fails
- **GIVEN** an installed image cache root exists but is missing expected payload files
- **WHEN** the native cache is resolved
- **THEN** resolution SHALL fail with a preparation remedy
- **AND** it SHALL NOT fall back to development payload bytes

#### Scenario: Development cache root
- **GIVEN** no installed image cache root
- **WHEN** the native cache is resolved
- **THEN** the daemon-side development cache root `${XDG_CACHE_HOME:-$HOME/.cache}/air-friends/omp/{platform}/natives/18.6.1/` SHALL be selected

#### Scenario: Canonical location guard
- **GIVEN** a configured canonical cache location inside the backup data root or inside a configured user or shared workspace root
- **WHEN** the native cache location is accepted
- **THEN** it SHALL be refused

#### Scenario: No fabricated environment override
- **WHEN** an agent launch environment is assembled
- **THEN** no invented OMP native-cache environment variable SHALL be introduced
