## MODIFIED Requirements

### Requirement: Authoritative Record Reset Remains an Unresolved Application Gate

Owned settings SHALL retain the pinned reset mechanism's unresolved/incompatible evidence and faithfully model CLI-overlay aggregation followed by deep merge over lower layers. Its application disposition SHALL separately record decision 3 as `DECIDED (2026-10-09)`, selecting owned-only settings-discovery-path control with restricted runtime default-deny as the second boundary. The native reset verdict SHALL NOT alone block application of that explicitly decided control, and no fixture SHALL certify the original reset recipe or relabel its verdict.

#### Scenario: Surviving lower records are the expected test result
- **GIVEN** a lower layer with an unknown-tool grant and read denial, a null reset and a mode overlay supplying a read mapping
- **WHEN** the faithful pinned merge model aggregates the overlays and merges over the lower layer
- **THEN** the lower-only grant SHALL survive and configured null SHALL retain the recorded unset semantics
- **AND** tests SHALL NOT reorder layers or present the reset as record clearance

#### Scenario: Gate blocks security consumption, not data generation
- **WHEN** actual session setup verifies the owned-only discovery-source plan
- **THEN** the decision-3 deployment disposition SHALL permit that setup without requiring a supported native reset verdict or another user decision
- **AND** native reset evidence SHALL remain unchanged and restricted execution-time default-deny SHALL remain the second boundary

#### Scenario: Survivability consequence and gate boundary are documented
- **WHEN** documentation and tests describe the merge consequence
- **THEN** lower-layer grant, prompt and deny survivability SHALL remain recorded, with restricted runtime default-deny as the second boundary
- **AND** application SHALL depend on verified decision-3 settings-source control without requiring a native supported-reset verdict

#### Scenario: No reset certification and no layer reordering
- **WHEN** fixtures, mocks or tests exercise the reset recipe
- **THEN** no content or evidence SHALL certify the recipe as a working settings-layer reset
- **AND** tests SHALL NOT reorder merge layers to produce record clearance

#### Scenario: Passing mocks do not clear the native gate
- **WHEN** source-control unit/mock tests pass
- **THEN** native reset incompatibility and unresolved evidence SHALL remain recorded
- **AND** actual native precedence/reload behavior SHALL remain user-owned and unverified

### Requirement: OMP Environment and Egress Pass-Through Without New Rules

OMP permission mode SHALL NOT alter egress posture. Both OMP modes SHALL receive the same existing proxy/sandbox decisions with no YOLO-only network rule. OMP child settings-discovery selectors SHALL be sanitized mandatorily even when general environment filtering is disabled, and only deployment-owned HOME and agent-directory assignments plus exact owned overlays SHALL establish its settings sources. OpenCode environment behavior and session/pool markers SHALL remain unchanged.

#### Scenario: Filtered OMP environment carries only approved categories
- **GIVEN** inherited HOME/XDG/profile/config/agent-directory selectors, setting-source overrides and operator passthrough attempts
- **WHEN** an OMP child environment is assembled with filterEnv enabled or disabled
- **THEN** inherited discovery selectors SHALL be absent or replaced with their exact deployment-owned values, with HOME explicitly assigned to avoid native homedir fallback
- **AND** allowedEnvVars SHALL NOT reintroduce excluded settings sources

#### Scenario: Approved category environment assembly passes through the existing pipeline
- **WHEN** an accepted OMP launch enters the sandbox pipeline
- **THEN** existing approved credential, mode-state namespace, shared-process marker and per-spawn session-ID semantics SHALL remain intact
- **AND** canonical payload staging SHALL remain independent of owned HOME and process state

#### Scenario: Egress posture is mode-independent
- **WHEN** restricted and native-yolo OMP launches use the same sandbox configuration
- **THEN** proxy variables, confinement and network isolation or explicit unrestricted egress decisions SHALL remain identical across modes
- **AND** no additional network denial or exemption SHALL be introduced

#### Scenario: OpenCode discovery environment is unchanged
- **WHEN** OpenCode launch/environment decisions are compared with the landed original batch baseline
- **THEN** its HOME, XDG_DATA_HOME, filtering and mode-switching behavior SHALL remain unchanged

## ADDED Requirements

### Requirement: Owned-Only OMP Settings Discovery Sources

Before OMP spawn and native session new/load/recovery or repository-triggered rediscovery, the system SHALL verify that only exact deployment-owned `--config` overlays can contribute persistent settings. Inherited HOME/XDG, native global/project, legacy and foreign-provider lower sources SHALL be excluded. Observation failure or unexpected sources SHALL reject before the native protected request without removing user files or relying on precedence to erase lower-only records.

#### Scenario: Hostile HOME or XDG settings cannot become a lower layer
- **GIVEN** hostile settings under daemon HOME or XDG roots and inherited selectors pointing there
- **WHEN** either OMP mode is prepared for spawn
- **THEN** the child SHALL receive the controlled discovery environment and owned paths only
- **AND** no inherited host source SHALL enter the repository's accepted settings-source plan

#### Scenario: Project settings cause pre-request rejection
- **GIVEN** the actual requested ACP workspace or relevant pinned foreign-provider project/ancestor root contains a settings source
- **WHEN** session new/load or recovery is attempted despite a neutral process launch cwd
- **THEN** setup SHALL reject before the native request with a bounded content/credential-free source reason
- **AND** the hostile file SHALL remain unchanged
- **AND** accepting that workspace SHALL require its deployment/workspace owner to remove the forbidden source; no native suppression of an existing project source SHALL be claimed

#### Scenario: Polluted reused state fails closed
- **GIVEN** the mode's global agent directory contains config.yml, config.yaml or legacy settings.json outside the owned overlays
- **WHEN** a new or recovered session is prepared
- **THEN** setup SHALL reject that lower source without migration, null-reset or silent merge

#### Scenario: Clean sources support both modes and lifecycle shapes
- **GIVEN** canonical controlled HOME/agent roots, absent lower settings sources and valid exact owned overlays
- **WHEN** restricted or native-yolo sessions use per-spawn, pooled new or same-mode load/recovery paths
- **THEN** their source checks SHALL accept the owned-only plan with mode overlay last
- **AND** restricted default-deny SHALL remain a separate second boundary without copying restricted tool policy into YOLO

#### Scenario: Observation failures cannot manufacture absence
- **WHEN** a forbidden-source check encounters unreadable metadata, missing authority, link escape or identity replacement
- **THEN** the operation SHALL reject rather than return an empty successful source inventory

#### Scenario: Runtime reload assurance remains bounded
- **WHEN** documentation or mock evidence describes source visibility
- **THEN** it SHALL distinguish repository preflight/rechecks from deployment responsibility to keep lower sources absent throughout process lifetime
- **AND** native autonomous reload and undetectable mutation timing SHALL remain user-owned/unverified rather than be certified by mocks
