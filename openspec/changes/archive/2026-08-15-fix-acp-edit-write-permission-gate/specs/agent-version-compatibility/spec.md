## ADDED Requirements

### Requirement: Pinned OpenCode Version in Container Build

The container image SHALL install a fixed, known-good OpenCode CLI version rather than tracking `releases/latest`, so that ACP contract changes in OpenCode releases cannot silently degrade the harness at deploy time. The pinned version SHALL be an explicit build argument (`ARG OPENCODE_VERSION`) with a documented default, the download URL SHALL reference that exact version tag, and the downloaded artifact SHALL be verified against per-architecture SHA-256 checksums so the pinned version is actually the version installed.

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
