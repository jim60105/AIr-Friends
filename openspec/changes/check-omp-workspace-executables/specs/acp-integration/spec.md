## MODIFIED Requirements

### Requirement: Trusted-Module Pre-Import Discovery Exclusion Bootstrap

The integration SHALL combine the existing frozen trusted-module bootstrap decision with fresh metadata-only deployment observations before OMP spawn and native session new/load/recovery or repository-triggered rediscovery. Those observations SHALL cover authoritative workspace and reachable custom-tool/plugin/configured-module/dependency roots before unowned code can import. The recorded native surface verdicts SHALL remain unchanged; decision 1 SHALL be consumed as a separate deployment-control disposition.

#### Scenario: Unowned candidate is excluded without import
- **GIVEN** an authoritative session workspace contains a loader-recognized custom-tool module or plugin entry point, including a linked package entry
- **WHEN** setup preflight inspects pinned discovery sources
- **THEN** it SHALL reject before invoking any native spawn/session/importer operation
- **AND** no candidate module SHALL be imported to inspect metadata, name or factory

#### Scenario: Importable module does not need executable permission bits
- **GIVEN** a custom-tool/plugin entry is importable at the pin but has no POSIX execute bit
- **WHEN** workspace preflight evaluates that entry
- **THEN** it SHALL still reject the executable discovery source

#### Scenario: Clean deployment admits without supported-mechanism relabeling
- **GIVEN** authoritative discovery roots contain no executable custom tools or plugin entries and owned identity/environment checks succeed
- **WHEN** decision-1 deployment admission is evaluated
- **THEN** the repository SHALL permit setup under the DECIDED disposition
- **AND** native custom-tool/plugin surfaces SHALL still report `no-supported-mechanism`, with no complete native exclusion support claim

#### Scenario: Ordinary workspace source does not imply custom-tool discovery
- **GIVEN** ordinary source/scripts or owned skill scripts are outside pinned executable discovery sources
- **WHEN** workspace preflight evaluates the deployment
- **THEN** those files SHALL NOT alone cause executable-source rejection

#### Scenario: Roots and observations cannot be omitted to permit setup
- **WHEN** an authoritative workspace/root observation is absent, unreadable, linked, replaced or has an unknown importable-entry shape
- **THEN** preflight SHALL reject without a lexical fallback or synthetic empty inventory

#### Scenario: Lifecycle changes receive fresh preflight
- **WHEN** a pooled/per-spawn session is created, loaded, recovered or explicitly refreshed in either mode with a new workspace or resource generation
- **THEN** a fresh deployment check SHALL precede the native protected request
- **AND** the frozen bootstrap's immutable identity/verdict data SHALL remain unchanged without reusing stale or foreign-session admission

#### Scenario: Production extension is image-owned only
- **WHEN** production OMP launch/setup resolves its trusted extension
- **THEN** it SHALL accept only the exact packaged image-owned module/closure path with ambient discovery disabled
- **AND** workspace/HOME/cache copies or development fallback SHALL NOT become trusted

#### Scenario: No import or host guard acts as an import boundary
- **WHEN** the pre-import disposition is documented or tested
- **THEN** extension flags SHALL NOT be generalized to independent custom tools/plugins
- **AND** host guards, preloaded paths, post-import tool-name filters and lifecycle callbacks SHALL NOT be described as supported native import barriers

#### Scenario: Extension flag is not claimed as complete exclusion
- **GIVEN** ambient extensions are disabled and the exact owned module is selected
- **WHEN** custom-tool/plugin routes are assessed at the pin
- **THEN** their native status SHALL remain `no-supported-mechanism`
- **AND** deployment-control admission SHALL NOT become a supported native complete-exclusion verdict

#### Scenario: Decision is frozen per process
- **WHEN** native registry or project-layer state changes after module load
- **THEN** immutable load-time identity and verdict data SHALL remain frozen and re-consulted
- **AND** fresh session/workspace deployment observations SHALL be checked before each native protected request

#### Scenario: Every pinned surface carries its mechanism and status
- **WHEN** the frozen bootstrap decision is produced
- **THEN** all audited discovery surfaces SHALL retain their pinned source route and `supported`, `candidate-to-verify` or `no-supported-mechanism` status
- **AND** applied deployment mechanisms SHALL be recorded separately without changing the status

#### Scenario: Extension-disability is not generalized to other discovery
- **WHEN** custom-tool/plugin surfaces are assessed with ambient extensions disabled
- **THEN** extension-disability SHALL NOT be generalized into a native guard for those independent routes

### Requirement: Fail-Closed Session Setup When Exclusion Cannot Be Established

Failed deployment preflight, executable workspace discoveries, invalid owned module/dependency identity, escaping links, inconsistent environment or stale session evidence SHALL reject the affected restricted setup/recovery before the native protected request. This SHALL retain the existing bounded fail-closed rejection as fallback. Native `no-supported-mechanism` alone SHALL NOT undo decision 1's explicitly adopted deployment disposition. Extension lifecycle failure SHALL NOT be claimed to provide authenticated client-observable readiness.

#### Scenario: Session creation fails visibly
- **GIVEN** preflight cannot establish the selected deployment controls
- **WHEN** session creation or load/recovery is attempted
- **THEN** the repository SHALL reject before sending the native request and registering guarded session state
- **AND** the bounded error SHALL name the failing surface/reason using existing verdict vocabulary without credentials or file content

#### Scenario: No silent downgrade path exists
- **WHEN** deployment observation or trusted identity validation fails
- **THEN** the integration SHALL NOT retry through an unguarded/extensionless launch or substitute another agent

#### Scenario: Recovery fails closed identically
- **WHEN** recovery cannot establish deployment controls or carries stale current-selection evidence
- **THEN** it SHALL reject with the same bounded named-surface error before native load/resumption
- **AND** a previously accepted guard claim SHALL NOT bypass the fresh check

#### Scenario: Failure message is bounded and credential-free
- **WHEN** session setup or recovery rejects a deployment preflight failure
- **THEN** its bounded error SHALL name the failing surface/status or deployment-control reason
- **AND** credentials and file contents SHALL be absent

#### Scenario: No degraded session shape is produced
- **WHEN** client/factory preflight cannot establish required deployment controls
- **THEN** setup SHALL NOT produce partially guarded registered state or an extensionless/unguarded/different-agent fallback

#### Scenario: Extension-load residual risk remains accepted and visible
- **GIVEN** client preflight succeeded but the synchronous restricted handler fails to install in the native runtime
- **WHEN** the fallback posture is documented or represented by mocks
- **THEN** native non-YOLO approval plus ACP client policy SHALL remain the accepted ACP-mediated boundary with client denials fail-closed
- **AND** missing restricted capabilities, runner.emit logging without startup failure, absence of readiness signal and incomplete default-deny/callback equivalence SHALL remain explicit

#### Scenario: Deployment controls do not add restricted YOLO tool policy
- **WHEN** the same preflight operates on native-yolo
- **THEN** it SHALL impose deployment source/ownership checks only
- **AND** no restricted capability set or readiness handshake SHALL be added

### Requirement: Discovery And Critical-Selection Compatibility Gates Remain Blocking

The two named discovery/critical-selection records SHALL preserve their native unresolved status and pinned verdicts verbatim. Their application dispositions SHALL separately record decisions 1 and 7 as `DECIDED (2026-10-09)` and select deployment-owned executable exclusion/startup checks and owned-settings canonical skill roots. Native incompatibility alone SHALL no longer block these decided controls. Failed actual deployment controls SHALL remain fail-closed, and no mock SHALL clear a native gate.

#### Scenario: Gate verdicts are recorded verbatim
- **WHEN** the two gate records are inspected
- **THEN** pre-import exclusion SHALL retain "extension flags alone incompatible and the supported full mechanism unresolved"
- **AND** critical-skill selection SHALL retain "name-only trust incompatible and canonical selection unresolved"

#### Scenario: Gate resolution requires a user decision
- **WHEN** gate dispositions are consumed after the recorded user decisions
- **THEN** they SHALL identify the decision number and DECIDED date with selected deployment controls and runtime-unverified limits
- **AND** they SHALL NOT require another user decision or a supported native mechanism as an unconditional application prerequisite

#### Scenario: Passing mocks cannot clear a gate
- **WHEN** repository exclusion/ownership tests pass
- **THEN** gate native status and verdicts SHALL remain unresolved/unchanged
- **AND** synthetic positive fixtures SHALL NOT be cited as native enforcement evidence

#### Scenario: Operative boundary while gated
- **WHEN** selected deployment controls fail or restricted execution is assessed
- **THEN** failed controls SHALL invoke the existing fail-closed boundary, while installed restricted runtime default-deny and filesystem authorization SHALL remain separate operative boundaries
- **AND** the accepted handler-installation fallback risk SHALL NOT be rewritten as authenticated readiness or equivalent full default-deny

#### Scenario: Automated evidence validates decision logic only
- **WHEN** automated unit/mock evidence is offered for these controls
- **THEN** it SHALL certify repository observation/admission/denial decisions only
- **AND** native pre-import enforcement and canonical resource selection SHALL remain user-owned and unverified
