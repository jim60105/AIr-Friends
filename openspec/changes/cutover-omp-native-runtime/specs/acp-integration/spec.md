# Spec Delta

## ADDED Requirements

### Requirement: Shared ACP Canonical Observation And Evidence Scope

Shared context/root/target helpers SHALL return one complete observation or one specific failure, never a partial grant, empty root or lexical fallback. Observations SHALL remain operation- and shared-context-generation-scoped and SHALL not imply native OMP enforcement on paths that do not consume ACP callbacks.

#### Scenario: Canonicalization failure
- **WHEN** metadata observation fails other than confirmed absence permitted by existing new-file semantics
- **THEN** the helper SHALL return a distinguished failure, no lexical grant and no protected content IO or mutation.

#### Scenario: Detectable replacement
- **WHEN** deterministic metadata observations detect a changed root, ancestor or final target
- **THEN** the existing path-changed failure or newly observed containment decision SHALL apply, and the actual secure access consumer SHALL preserve containment through IO.

#### Scenario: Broad YOLO observation
- **WHEN** a YOLO consumer observes a target physically inside its broad user/shared Agent workspace
- **THEN** it SHALL retain the broad role without restricted staging, command, extension or tool clamps; external escapes SHALL remain ineligible.

#### Scenario: Distinguished shared failure categories
- **WHEN** an observation fails
- **THEN** invalid context/path/token, invalid/unavailable/overlapping root, outside-root/link escape, dangling/looping link, missing object, wrong type, canonicalization failure, changed path and shared trusted-root identity mismatch SHALL remain distinguished.

#### Scenario: Observation lifetime
- **WHEN** successful helper metadata is consumed
- **THEN** it SHALL remain scoped to the exact shared session/context generation and SHALL not become a reusable permission or race-proof guarantee.

#### Scenario: Consumer evidence limits
- **WHEN** real helper logic with temporary filesystems or deterministic metadata mocks passes
- **THEN** that evidence SHALL certify only the exercised helper/access behavior, not native parser/tool/proxy enforcement; real native claims SHALL require separately exercised native consumers.

### Requirement: Native OMP Assets And Data Reachability Under Shared Confinement

Configured filesystem confinement SHALL retain the existing shared mount mechanism and expose the selected authored OMP files read-only and selected native mode data child read-write. It SHALL not grant the parent deployment/pool/HOME tree or sibling data roots; the shared read-only skill mount and overlap refusal SHALL remain.

#### Scenario: Confined native model and data
- **WHEN** OMP starts with filesystemConfinement enabled
- **THEN** native OMP SHALL consume the selected authored model/config assets and persist/load its own selected XDG data inside the confined view.

#### Scenario: Selected roots only
- **WHEN** the confined process attempts to read a sibling mode/pool marker or mutate the skill root
- **THEN** filesystem access SHALL fail and the shared mount policy SHALL not be widened by the additional OMP runtime inputs.

#### Scenario: OpenCode mounts unchanged
- **WHEN** OpenCode is spawned with the same sandbox configuration
- **THEN** its existing runtime mounts and observable access outcomes SHALL remain unchanged.

### Requirement: Shared Agent Environment Filtering With Native OMP Discovery

When environment filtering is enabled, agent processes SHALL retain the existing base allowlist, supported credential sets and operator allowed variables, with platform/dashboard/raw Skill API secrets denied. OpenCode SHALL preserve its existing selector denials. OMP SHALL use shared filtering without a separate settings-discovery sanitization or selector-identity gate.

#### Scenario: Supported credentials and shared secrets
- **WHEN** either agent is launched with filtered environment and deployment credentials
- **THEN** its existing supported credential set SHALL be retained and platform, dashboard and raw Skill API secrets SHALL remain excluded.

#### Scenario: OpenCode selectors unchanged
- **WHEN** OpenCode launch filtering receives an operator allowance for a selector previously denied
- **THEN** its existing exclusion and warning outcome SHALL remain unchanged.

#### Scenario: Ordinary OMP operator environment
- **WHEN** OMP uses shared filtering or unfiltered configuration
- **THEN** the existing operator allowance/filter choice SHALL apply without an additional OMP discovery-source consistency prerequisite.

### Requirement: Parser-Bounded Shared Destructive Operation Normalization

The shared permission gate SHALL decode destructive operation inputs into complete ordered targets and bind them to the input represented for execution before restricted authorization. Titles and location lists SHALL not supply missing operations. Supported single delete/move shapes SHALL use the existing shared decoder; unsupported native edit/patch syntax SHALL retain its current denial.

#### Scenario: Complete targets and execution binding
- **WHEN** a supported destructive request is decoded with complete matching locations
- **THEN** every deletion target and both move endpoints SHALL receive the existing shared all-target decision, using the same bound input.

#### Scenario: Partial or inconsistent locations
- **WHEN** a destructive request omits an endpoint or its location list differs from decoded targets
- **THEN** it SHALL retain the bounded incomplete/binding denial and authorize no partial target subset.

#### Scenario: Unsupported or malformed syntax
- **WHEN** a native edit/patch uses unsupported syntax or its input cannot be decoded or bound
- **THEN** the existing named destructive denial SHALL apply with no mutation and no fallback into generic unknown-tool approval.

#### Scenario: Pure normalization
- **WHEN** destructive normalization runs
- **THEN** it SHALL perform no content IO or mutation and SHALL not infer operation targets from titles or a first displayed operation.

### Requirement: Shared Native-Shaped OMP Mock Session Composition

Lifecycle and skill-handoff suites SHALL share the existing mock ACP session builder for permission mode, native-shaped configuration catalogs, scripted connection/subprocess behavior and destructive request fixtures. Mock evidence SHALL be identified as mock evidence without mandatory governance-origin, epoch or synthetic-approval records.

#### Scenario: Shared consumers
- **WHEN** lifecycle and handoff scenarios create mock ACP sessions
- **THEN** they SHALL exercise the same shipped factory/connector/pool consumers while selecting their own session context and scripted catalog behavior.

#### Scenario: Catalog and permission outcomes
- **WHEN** flat, grouped, absent or missing-model catalogs and destructive permission inputs are supplied
- **THEN** actual consumer selection, restore and authorization outcomes SHALL be tested without fabricated governance readiness claims.

### Requirement: Authored Native OMP Provider Configuration And Identity

Authored native model configuration SHALL retain Gemini provider `google` with `GEMINI_API_KEY` and OpenRouter with `OPENROUTER_API_KEY`, using supported native provider headers for `X-Title: AIr-Friends`. Native non-overridable identity headers SHALL be documented from pinned source. Model selection SHALL remain catalog-based without a project-generated provider blacklist.

#### Scenario: Native provider configuration is consumed
- **WHEN** a configured OMP session loads its authored native model file
- **THEN** supported credentials and native provider header configuration SHALL reach the selected native provider mechanism.

#### Scenario: Catalog miss
- **WHEN** a requested model is missing from an advertised native catalog
- **THEN** the existing explicit session-scoped selection error SHALL remain without an invented model ID.

#### Scenario: Native identity limitations
- **WHEN** documentation describes a built-in identity header that native configuration cannot override
- **THEN** it SHALL name the pinned source mechanism and SHALL not claim preservation from configuration inspection or mocks.

### Requirement: Authored Native OMP Compaction Update And Prompt Behavior

Authored mode settings SHALL preserve enabled native conversation compaction and the current supported update-posture settings. The system SHALL retain the explicit native custom-prompt route and existing operator prompt mounts. Native compaction differences and unexercised prompt effects SHALL be documented without invented schema keys or runtime-equivalence claims.

#### Scenario: Native compaction and updates
- **WHEN** either mode consumes its authored settings
- **THEN** current native compaction, disabled automatic update checks/marketplace updates and stable update channel SHALL remain configured without a schema mirror.

#### Scenario: Prompt override
- **WHEN** OMP starts with the existing explicit system-prompt asset or operator-mounted prompt
- **THEN** the native custom-prompt route SHALL consume that selected path and existing per-file payload prompt mounts SHALL remain untranslated.

#### Scenario: Evidence limits
- **WHEN** compaction or prompt behavior is documented
- **THEN** actual native strategy differences and unexercised runtime behavior SHALL be distinguished from source/configuration observations.

### Requirement: Native OMP Approval Mode Selection At Process Launch

OMP SHALL select restricted or native-YOLO policy at process launch from the existing effective permission mode. OMP SHALL retain separate processes and no ACP session-mode override; OpenCode SHALL retain its per-session mode switching.

#### Scenario: Native mode selection
- **WHEN** restricted and YOLO OMP sessions are acquired
- **THEN** each SHALL launch with its authored native mode settings and the existing mode-separated pool key.

#### Scenario: Protocol distinction
- **WHEN** OMP and OpenCode session overrides are requested
- **THEN** OMP SHALL return no approval-mode session override and OpenCode’s existing YOLO override SHALL remain.

### Requirement: Restricted Native OMP ACP Launch

Restricted OMP SHALL launch ACP with its authored mode configuration, the required native-loadable capability extension and the existing system-prompt asset. The launch SHALL delegate configuration parsing to native OMP.

#### Scenario: Restricted launch
- **WHEN** a restricted OMP session starts
- **THEN** native OMP SHALL consume the authored restricted YAML and attach the capability handler; missing required bundle SHALL report the existing build remedy.

#### Scenario: Native settings error
- **WHEN** an authored configuration is invalid
- **THEN** the native parser/startup error SHALL flow through the existing session error reporting.

### Requirement: Permissive Native OMP ACP Launch With Explicit LSP Denial

Native-YOLO OMP SHALL launch a separate ACP process with authored native YOLO approval and explicit LSP tool denial, without the restricted capability extension.

#### Scenario: Native permissive session
- **WHEN** OMP YOLO starts
- **THEN** known and unmatched non-LSP tools SHALL retain native permissive policy while the explicit LSP tool policy remains deny.

### Requirement: Native OMP Mode Data And Session Staging Separation

OMP SHALL retain distinct native session/database data directories for its separate approval-mode processes. Process cwd SHALL follow the existing caller/session working directory, and config HOME SHALL remain the normal inherited deployment HOME.

#### Scenario: Native data separation
- **WHEN** OMP restricted and YOLO start under one conversation/pool key
- **THEN** their native persisted data SHALL use distinct selected mode data roots without isolated HOME or neutral-cwd proof.

#### Scenario: Staging identity
- **WHEN** a skill payload is created for a session
- **THEN** its location SHALL remain session cwd/tmp/Skill API ID, independent of native process data directories.

### Requirement: Native OMP Generated Extension Asset Selection

Restricted OMP SHALL load the selected generated development or installed native-loadable extension asset. Missing required development output SHALL report the existing bundle build remedy. File ownership or replacement evidence SHALL not be an integration authorization prerequisite.

#### Scenario: Generated artifact usable
- **WHEN** the shipped bundle exists in the selected deployment location
- **THEN** native loading SHALL use that generated ESM asset without a runtime import map.

#### Scenario: Missing required output
- **WHEN** restricted launch cannot find its generated asset
- **THEN** startup SHALL fail with the asset path and build remedy rather than use raw source as a load fallback.

### Requirement: Native OMP Shared Environment And Egress Behavior

Both OMP modes SHALL retain the existing shared sandbox/environment filtering, provider credentials, proxy decisions and session/pool markers. Mode selection SHALL not introduce new egress rules or OMP settings-source identity requirements. OpenCode behavior SHALL remain unchanged.

#### Scenario: Shared egress settings
- **WHEN** OMP starts in either mode under the same sandbox configuration
- **THEN** the existing proxy/sandbox decision SHALL remain identical and credentials SHALL follow shared filtering.

#### Scenario: Pooled skill identity
- **WHEN** a shared OMP process starts
- **THEN** it SHALL retain the shared marker and JWT directory without a frozen session ID; the current-session pointer SHALL remain session-scoped.

### Requirement: Native OMP Local Read And Search Behavior

OMP native read and local search SHALL remain usable under native approval policy. Native activation, ignore/hidden controls, cwd and output settings SHALL retain their upstream behavior and SHALL not be described as callback filesystem authorization.

#### Scenario: Native local capabilities
- **WHEN** restricted read/grep/glob calls are dispatched
- **THEN** they SHALL use native tools and native allow policy; find SHALL retain model-dependent auto activation without adding a judge.

#### Scenario: Actual external read route
- **WHEN** native read/search reaches a path outside daemon session roots
- **THEN** acceptance SHALL record the native operation and any actual ACP request/result; protected callback guarantees SHALL apply only to callbacks that execute.

### Requirement: Native OMP Capability Admission Before Tool Dispatch

Restricted OMP’s capability handler SHALL be attached through the official pre-dispatch extension tool-call API and SHALL block unmatched calls before dispatch. Native YOLO SHALL retain its separately selected native policy.

#### Scenario: Known capability dispatch
- **WHEN** restricted native tool_call names a mapped ability
- **THEN** the handler SHALL continue to native dispatch without repeating native or ACP authorization.

#### Scenario: Unmatched capability
- **WHEN** restricted native tool_call names an unmatched tool
- **THEN** the call SHALL be blocked before execution with a bounded unknown-tool reason.

#### Scenario: Ordinary file write
- **WHEN** a native ordinary write reaches the advertised ACP write callback
- **THEN** the existing shared callback policy SHALL decide it and a rejected write SHALL cause no unauthorized file change.

### Requirement: Consumer ACP Lifecycle And Mode Recovery Regression Suite

The combined lifecycle suite SHALL drive real connector, pool and orchestrator consumers with mock ACP transport, covering normal lifecycle, shared recovery, mode coexistence/lease serialization, callback denial and unchanged OpenCode flows. Evidence SHALL remain distinguished from real-native and image acceptance.

#### Scenario: Lifecycle and restore
- **WHEN** the fixture drives initialize/new/prompt/cancel/load
- **THEN** the shipped consumers SHALL restore model/reasoning/context in existing order and rejected callback writes SHALL have no side effects.

#### Scenario: Mode coexistence
- **WHEN** restricted and YOLO OMP sessions use the same conversation key
- **THEN** separate native-mode processes SHALL serialize under one lease and preserve their own contexts.

#### Scenario: OpenCode flows
- **WHEN** OpenCode exercises selection/start/reuse/recovery
- **THEN** existing observable launch, permission and optional-context outcomes SHALL remain unchanged.

### Requirement: Handwritten Native OMP Configuration Consumption

OMP SHALL directly consume hand-written native YAML. Application startup and code/image builds SHALL not generate, serialize, template or rewrite OMP configuration. Deployment SHALL manually configure native skill discovery and the shared skill root; native configuration errors SHALL use native reporting.

#### Scenario: No production configuration writes
- **WHEN** OMP startup or extension/image build is observed after deployment provisioning
- **THEN** no write/replacement operation SHALL target authored OMP mode/model YAML; build installation SHALL only copy tracked authored bytes.

#### Scenario: Native model file
- **WHEN** the deployment installs its authored models file at the native agent config path
- **THEN** native OMP SHALL consume that file directly with its supported provider schema, independently of OpenCode JSON.

#### Scenario: Custom skill deployment
- **WHEN** a deployment selects a custom shared skill-script root
- **THEN** the deployer SHALL author that same discovery root in native OMP YAML; no interpolation or equality-rejection service SHALL be required.

### Requirement: OMP Native Capability Policy Parity

Restricted OMP SHALL permit native abilities corresponding to OpenCode read/search/todo/skill/network/modify/execute policies and deny unmatched tools. Both modes SHALL explicitly deny the LSP tool using native approval settings. Native URL/search result differences SHALL remain upstream-owned.

#### Scenario: Restricted mapped abilities
- **WHEN** a native read, grep, glob, find when active, todo, web_search, edit/write, delete/move or bash call occurs
- **THEN** it SHALL continue through its native approval/ACP path without origin/epoch or a second command/filesystem policy.

#### Scenario: Explicit LSP denial
- **WHEN** either native OMP mode invokes the LSP tool
- **THEN** native exact-name approval SHALL deny the tool; acceptance SHALL make no implicit-server startup claim.

#### Scenario: Native network and skills
- **WHEN** a native URL read, web search or skill URI read occurs
- **THEN** it SHALL use the original native implementation without project-owned transport/backend/schema or skill-URI metadata replacement.

## REMOVED Requirements

### Requirement: Fail-Closed ACP Root Observation and Evidence Limits

**Reason**: Its mixed shared observation and predecessor P0-governance obligations contradict the native parity cutover.

**Migration**: Preserve shared failures and evidence limits under Shared ACP Canonical Observation And Evidence Scope; remove only obsolete predecessor-governance blocking and historical future-change obligations.

### Requirement: Scoped Agent State Selectors Are Not Granted By Configuration Acceptance

**Reason**: The owned-settings and PI_CODING_AGENT_DIR mechanism is removed.

**Migration**: Native OMP Mode Data And Session Staging Separation owns inherited config HOME and selected XDG data; OpenCode selectors and data behavior remain unchanged.

### Requirement: SandboxManager Environment Filtering

**Reason**: The old mixed-agent contract includes cancelled OMP discovery-selector denials.

**Migration**: Use Shared Agent Environment Filtering With Native OMP Discovery; shared secrets and all existing OpenCode filtering outcomes remain.

### Requirement: Complete Destructive Operation Normalization

**Reason**: The old requirement depends on the removed P0 governance contract.

**Migration**: Use Parser-Bounded Shared Destructive Operation Normalization and the ingress predecessor; retain complete target/binding checks and unsupported native patch outcomes.

### Requirement: Shared OMP Mock Session Builder Contract

**Reason**: Mandatory synthetic governance positives, ownership and epoch dimensions are retired.

**Migration**: Use Shared Native-Shaped OMP Mock Session Composition for the working shared consumer fixtures.

### Requirement: OMP Provider and Application Identity Translation

**Reason**: The old asset-scanning and translation contract is superseded by direct native model consumption.

**Migration**: Use Authored Native OMP Provider Configuration And Identity, with authored native HOME model provisioning and existing provider credentials.

### Requirement: Compaction, Update Posture, and Prompt Mapping Decisions

**Reason**: The old requirement binds independent native settings to the owned governance composition.

**Migration**: Use Authored Native OMP Compaction Update And Prompt Behavior; preserve current compaction/update/prompt behavior and native evidence limits.

### Requirement: Mode-Scoped OMP Spawn Resolution

**Reason**: Owned settings composition is retired.

**Migration**: Use Native OMP Approval Mode Selection At Process Launch; retain separate native-mode processes and OpenCode session switching.

### Requirement: Restricted OMP Launch Argument Assembly

**Reason**: The old arguments require cancelled ambient-exclusion and generated overlays.

**Migration**: Use Restricted Native OMP ACP Launch with authored mode YAML and the required thin extension.

### Requirement: Native-YOLO OMP Launch Assembly Without Restricted Clamps

**Reason**: Disjoint owned overlay sets and global suppression are retired.

**Migration**: Use Permissive Native OMP ACP Launch With Explicit LSP Denial.

### Requirement: Mode-Distinct OMP Process State Ownership

**Reason**: Isolated HOME, neutral cwd proofs and complete namespace ownership are cancelled.

**Migration**: Use Native OMP Mode Data And Session Staging Separation with native mode data and unchanged session staging.

### Requirement: Immutable Trusted-Extension Path Wiring With Fail-Closed Launch

**Reason**: Physical file trust is retired.

**Migration**: Use Native OMP Generated Extension Asset Selection; preserve generated load paths and missing-required-bundle error.

### Requirement: OMP Environment and Egress Pass-Through Without New Rules

**Reason**: The old requirement also mandates cancelled OMP settings-source sanitization.

**Migration**: Use Native OMP Shared Environment And Egress Behavior; preserve existing shared proxy decisions and session identity.

### Requirement: Native Local Read and Search Remain Usable Under Supported Approval

**Reason**: The old authenticity posture and historical source-investigation scenario are superseded.

**Migration**: Use Native OMP Local Read And Search Behavior and preserve historical evidence as history.

### Requirement: Restricted Enforcement Registers Through the Native Extension Contract

**Reason**: Its enforcing governance boundary is replaced by capability admission only.

**Migration**: Use Native OMP Capability Admission Before Tool Dispatch and shared ACP policy.

### Requirement: Combined Mock-ACP Lifecycle Integration Suite

**Reason**: OMP ownership, registry re-admission and global LSP suppression scenarios are cancelled.

**Migration**: Use Consumer ACP Lifecycle And Mode Recovery Regression Suite; preserve genuine lifecycle, mode/lease, shared callback and OpenCode outcomes.

### Requirement: Non-Duplication and Justified Deletion Rule for the Lifecycle Suite

**Reason**: Its predecessor-governance preservation rule conflicts with the approved removal of cancelled contracts and their assertions.

**Migration**: Retain meaningful shared consumer behavior tests and remove superseded governance tests with the owning cutover. No compatibility or data migration is required.

### Requirement: Pinned OMP Compatibility Evidence

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: OMP Pre-Import Discovery Compatibility Contract

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: OMP Policy Readiness Compatibility Contract

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: OMP Authoritative Record Compatibility Contract

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: OMP Complete Destructive Intent Compatibility Contract

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Restricted-Only LSP Compatibility Contract

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: OMP Native Transport Compatibility Contract

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: OMP Critical Skill Ownership Compatibility Contract

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Mode-Separated Owned OMP Settings Content

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Source-Backed Security Schema Key Validation

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Authoritative Record Reset Remains an Unresolved Application Gate

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Restricted and YOLO Overlay Non-Contamination

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Trusted-Module Pre-Import Discovery Exclusion Bootstrap

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Fail-Closed Session Setup When Exclusion Cannot Be Established

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Exact Owned-Module Trust Scope

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Canonical Critical-Skill Ownership Across New, Load, and Refresh

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Discovery And Critical-Selection Compatibility Gates Remain Blocking

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Shared Client And Extension Destructive Decision Surface

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Restricted Tool-Inventory Default-Deny Decision

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Live-Provenance Admission Decision

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Alternate-Execution-Entrypoint Blocking Decision

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Exact-Key Approval-Record Interpretation With No Inherited Grants

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Destructive-Intent Decision Consumed From The Shared Conformance Table

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: MCP Admission Decision With Honest Mechanism Tiers

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Restricted Tool Decision Verdicts Retain Decided Dispositions

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Trusted-Extension Tool-Call Enforcement Wiring

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Per-Call Consultation With Live Origin Observation

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Bounded Fail-Closed Enforcement Errors

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Post-Start MCP Registry Refresh Re-Admission

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Restricted-Only Enforcement Registration

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Fail-Closed Behavior At Unresolved Inherited Seams

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Enforcement Wiring Evidence Limited To Wiring Decisions

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: OMP Both Modes Carry The LSP Disable

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: LSP Implicit Startup Coverage Retains Pinned Evidence Limits

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Both-Agent LSP Evidence And Documentation Boundary

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Controlled URL-Fetch Transport Adapter Decision Core

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Manual Per-Hop Redirect and Secondary-URL Re-Validation

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Egress-Policy-Selected Proxy Routing with Operator Posture Preserved

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Text and Binary Fetch Paths with Credential-Free Decision Records

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Source-Cited Supported-Route Enumeration with Honest Blocked Residuals

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Pending-Adapter Seam Completion Is Additive and Route-Scoped

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Trusted Loopback and Provider Routing Remain Distinct from Model Fetch Targets

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: URL-Fetch Adapter Acceptance Is Deterministic Mock-Only

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Controlled Web-Search Transport Routing Through the URL-Fetch Decision Core

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Web-Search Backend Tiering Restricted to the Supported Credential Set

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Web-Search Native Interface, Citation, and Error Honesty

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Credential-Absent Web Search Fails Closed With a Documented Capability Gap

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Web-Search Seam Completion Is Additive, Route-Scoped, and Backend-Gated

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Native YOLO Web Search Keeps Native Behavior

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Web-Search Adapter Acceptance Is Deterministic Mock-Only

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Fail-Closed Honest Posture Assertions in the Lifecycle Suite

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Deployment-Owned OMP Skill Root Settings

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Dedicated Public Code Search Is Outside OpenCode Parity

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Controlled Replacements Have Native Parameter Contracts

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Controlled Read Results Use Native Content Representations

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Controlled Transport DNS Runs in the Native Runtime

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Native Events Use Trusted Session and Origin Context

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Owned Skill URIs Remain Readable Through Native Read

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Native Local Admission Does Not Admit Remote or Device Search Routes

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Authorized Ambient Native Mutation

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Native Registry Observation Uses the Supported Runtime Surface

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

### Requirement: Owned Replacement Admission Preserves Separate Completion

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use authored native OMP settings and the existing shared ACP policy. This pre-release cutover requires no data migration or compatibility shim.

