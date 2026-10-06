## ADDED Requirements

### Requirement: Mode-Scoped OMP Spawn Resolution

The agent factory SHALL resolve an OMP spawn mode from the effective permission mode available at spawn (`yolo` false => restricted, true => native-yolo) and SHALL build the launch from the owned-settings composition for exactly that mode. OMP mode selection SHALL occur only at spawn: the ACP session-mode override for agent type `omp` SHALL remain `null` for both YOLO and non-YOLO states, native YOLO SHALL never be applied as a process-wide toggle on a process that also serves restricted sessions, and the OpenCode session-mode switching behavior SHALL be unchanged.

#### Scenario: Mode resolves once at spawn
- **GIVEN** agent type `omp` and the effective permission mode supplied to the factory
- **WHEN** the base agent configuration is built
- **THEN** exactly one owned-settings mode composition SHALL be consumed for the assembled launch
- **AND** the assembled arguments SHALL carry no mode-selection mutation that could later change the process posture

#### Scenario: Session-mode override stays null for OMP
- **WHEN** `getSessionModeOverride("omp", true)` and `getSessionModeOverride("omp", false)` are evaluated
- **THEN** both SHALL return `null`
- **AND** `getSessionModeOverride("opencode", true)` SHALL continue to return the existing OpenCode YOLO override value

### Requirement: Restricted OMP Launch Argument Assembly

For restricted mode the factory SHALL produce command `omp` with subcommand `acp`, the `--no-extensions` flag, the ordered owned `--config` overlay arguments taken unchanged from the restricted composition (shared content first, restricted mode document last among deployment overlays, owned provider-model overlay included), the exact `--trusted-extension` argument with the contracted owned module path, and the `--system-prompt` argument with the owned system-prompt path from the prompt mapping. The non-YOLO native approval mode SHALL be carried solely by the restricted composition's pin — the factory SHALL NOT pass any yolo or auto-approve flag and SHALL NOT rely on an implicit native default.

#### Scenario: Restricted arguments are complete and flag-clean
- **WHEN** the factory assembles a restricted `omp` launch
- **THEN** the arguments SHALL contain `acp`, `--no-extensions`, the restricted composition's ordered `--config` files with the restricted mode document last, one `--trusted-extension` argument with the contracted module path, and one `--system-prompt` argument with the owned prompt path
- **AND** no yolo/auto-approve flag SHALL appear in the arguments

#### Scenario: Approval mode is consumed, not re-derived
- **WHEN** the restricted composition pins the native non-YOLO approval mode
- **THEN** the factory SHALL pass the overlay file carrying that pin without re-deriving, overriding, or duplicating the approval mode anywhere else in the launch

### Requirement: Native-YOLO OMP Launch Assembly Without Restricted Clamps

For native-yolo mode the factory SHALL produce a separate `omp acp` launch whose configuration comes exclusively from the native-yolo composition — its own owned overlay files plus the shared provider-model and system-prompt assets — in native YOLO with no restricted tool clamps. The assembled native-yolo `--config` file set SHALL be disjoint from the restricted overlay file set, and the launch SHALL NOT load, reference, or inherit any restricted overlay content, restricted approval records, provider-disable content, or LSP disablement (design D6).

#### Scenario: YOLO launch carries only its own composition
- **WHEN** the factory assembles a native-yolo `omp` launch
- **THEN** every `--config` argument SHALL resolve to a file of the native-yolo composition or the shared owned assets
- **AND** no restricted mode document path SHALL appear

#### Scenario: Mode argument sets cannot intersect
- **WHEN** both mode launches are assembled from the same composition module
- **THEN** an assembly-time check SHALL reject any mode overlay file path appearing in both launches
- **AND** the check SHALL fail the spawn rather than silently merge the sets

### Requirement: Mode-Distinct OMP Process State Ownership

For OMP launches the factory SHALL set `PI_CODING_AGENT_DIR` under the selected process's `TMPDIR/omp-agent` with a mode-distinct final segment, SHALL give restricted and native-yolo processes distinct process temporary roots and distinct neutral launch working directories, and SHALL make mode distinctness independent of pool-key composition so no caller that reuses a process key across modes can produce a shared state root. A per-spawn OMP process SHALL never reuse a state root across modes. The launch working directory SHALL be a deployment-derived neutral directory (never a user workspace) so native project discovery from the working directory's `.omp/` layer is empty by construction, while per-session ACP working directories continue to carry user workspaces.

#### Scenario: State roots are mode-distinct under identical inputs
- **WHEN** restricted and native-yolo launches are assembled for the same pool key or the same per-spawn workspace
- **THEN** `PI_CODING_AGENT_DIR`, the process temporary root, and the launch working directory SHALL each differ by mode segment
- **AND** neither mode's `PI_CODING_AGENT_DIR` SHALL fall inside the other's

#### Scenario: No profile or XDG selector inheritance
- **GIVEN** the deployment environment defines `OMP_PROFILE`, `PI_PROFILE`, `PI_CONFIG_FILES`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, or `XDG_CACHE_HOME`
- **WHEN** an OMP launch environment is assembled and filtered
- **THEN** none of those variables SHALL be set by the factory or reach the subprocess through the base environment or the sandbox filter

#### Scenario: OMP XDG data home is process-scoped, OpenCode behavior preserved
- **WHEN** the factory sets `XDG_DATA_HOME` for an OMP launch
- **THEN** the value SHALL be under the mode-scoped OMP process state area, never the shared home-rooted default data directory
- **AND** OpenCode launches SHALL continue to receive the existing per-session or per-pool `XDG_DATA_HOME` values unchanged

### Requirement: Canonical Payload Staging Independent of OMP Process State

Partitioning OMP process temporary/state roots SHALL NOT move, alias, or condition the canonical Skill API payload staging location. The session staging directory derived from the session workspace SHALL remain the payload-containment authority for OMP spawns exactly as for OpenCode spawns, and no OMP mode-scoped temporary root SHALL participate in payload path resolution or Skill API containment decisions.

#### Scenario: Staging survives state partitioning
- **WHEN** restricted and native-yolo OMP launches are assembled for the same session workspace
- **THEN** the canonical staging location derived from the workspace SHALL be identical for both modes
- **AND** neither launch's `TMPDIR`/`PI_CODING_AGENT_DIR` SHALL alter the staging path the permission gate and Skill API resolve

### Requirement: Immutable Trusted-Extension Path Wiring With Fail-Closed Launch

The factory SHALL reference the owned trusted extension solely through one exported path selector pointing at a deployment-owned, agent-non-writable root, passing that exact path as the `--trusted-extension` argument with no workspace-derived, configuration-derived, or search-based component. The factory SHALL perform no trust decision on the module's content; the module's content, pre-import exclusion logic, readiness, and packaged checksum belong to other changes. If the contracted module path is absent at spawn, the factory SHALL fail the OMP launch with an explicit error and SHALL NOT fall back to an extensionless launch, an unguarded process, or a different agent type.

#### Scenario: Exactly the contracted path is passed
- **WHEN** either OMP mode launch is assembled
- **THEN** `--trusted-extension` SHALL carry the exported contracted path verbatim
- **AND** no argument or environment variable SHALL be able to redirect it

#### Scenario: Absent module fails closed
- **GIVEN** the contracted trusted-module path does not exist in the environment
- **WHEN** an OMP launch is assembled or spawned
- **THEN** the OMP spawn SHALL fail with an explicit error naming the missing trusted module
- **AND** no `omp` process configuration lacking the trusted-extension argument SHALL be returned

### Requirement: OMP Environment and Egress Pass-Through Without New Rules

The OMP launch environment SHALL be assembled from the approved credential and base categories (the OMP supported provider set plus the shared base/passthrough categories, with per-spawn-only `SESSION_ID` and pool-mode shared-process marker semantics preserved) and SHALL then pass through the existing sandbox pipeline unchanged: environment filtering, the egress posture resolution, validating-proxy variable composition, filesystem confinement, and network-isolation wrapping SHALL behave identically to existing agent launches. OMP mode SHALL NOT alter the egress posture: native-yolo and restricted OMP processes SHALL receive the same proxy/sandbox decisions, and no yolo-only network rule SHALL be introduced by this capability.

#### Scenario: Filtered OMP environment carries only approved categories
- **GIVEN** environment filtering is enabled and the deployment holds every credential
- **WHEN** an OMP launch environment is filtered
- **THEN** only the approved OMP provider credentials, the base allowlist the factory populated, and permitted shared-process/passthrough variables SHALL remain
- **AND** platform tokens, dashboard credentials, the Skill API server secret, and OpenCode-only provider keys SHALL be absent

#### Scenario: Egress posture is mode-independent
- **WHEN** restricted and native-yolo OMP launches pass through the sandbox manager with the same sandbox configuration
- **THEN** their egress treatment (proxy variables, namespace isolation, or explicit unrestricted opt-in) SHALL be identical
- **AND** neither mode SHALL gain an additional network denial or exemption rule

### Requirement: OpenCode Launch Non-Regression

Introducing the OMP launch branch SHALL NOT change the OpenCode launch: command, arguments, environment assembly (including per-session and per-pool `XDG_DATA_HOME`, `TMPDIR`, session/pool markers, credential set, and browser detection), the OpenCode YOLO session-mode switching route, and the sandbox pass-through outcome SHALL remain behaviorally identical, protected by consumer-visible tests.

#### Scenario: OpenCode configuration is byte-stable across the change
- **WHEN** OpenCode restricted and YOLO launches are assembled before and after this change
- **THEN** the assembled command, arguments, environment, and working-directory decisions SHALL be identical
- **AND** the OpenCode YOLO route SHALL continue to rely on the session-mode override rather than launch arguments
