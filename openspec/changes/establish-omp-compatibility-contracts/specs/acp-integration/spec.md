## ADDED Requirements

### Requirement: Pinned OMP Compatibility Evidence

The integration compatibility report SHALL declare, for each required boundary and relevant subcase, a supported, incompatible or unresolved status backed by exact pinned release/source revision, source mechanism reachability and deterministic fixture evidence.

#### Scenario: Complete supported contract is consumable
- **WHEN** all seven boundaries and subcases have matching pinned source evidence for supported official-executable or trusted-extension entry points
- **THEN** the compatibility assessment SHALL report a permitted source-contract verdict with the exact mechanisms and evidence limits
- **AND** it SHALL leave real-runtime verification unverified pending user observations

#### Scenario: Missing evidence blocks application
- **WHEN** a boundary is absent, unresolved, incompatible, uses a different pin, or claims support solely through an SDK-internal method or mock-defined API
- **THEN** the assessment SHALL return a blocked verdict naming the boundary, reason and evidence still required
- **AND** dependent implementation SHALL NOT proceed through a fallback, fork, pin change or silent scope reduction

#### Scenario: Disproved design requires user decision
- **WHEN** pinned source disproves a selected approved mechanism
- **THEN** the report SHALL record the concrete incompatibility and its counterexample
- **AND** downstream application SHALL remain blocked until an explicit user-approved decision and corresponding source-backed contract revision resolve the conflict

#### Scenario: Hypothetical positive fixtures do not certify native support
- **WHEN** a positive structural/admission fixture uses explicitly hypothetical test-only mechanisms because the actual pinned ledger is blocked
- **THEN** the check SHALL exercise the real contract validator while labeling its input and result synthetic and keeping them separate from source evidence
- **AND** the actual compatibility verdict SHALL remain blocked; complete named blocked fixtures SHALL satisfy P0 acceptance without requiring a passing real pinned ledger or an unsupported native decoder

#### Scenario: All seven boundaries are covered
- **WHEN** the compatibility report is produced for pre-import discovery exclusion, authenticated policy readiness, authoritative approval-record reset, complete destructive intent, restricted-only LSP in both agents, native transport adaptation and critical-skill ownership
- **THEN** each required boundary and its relevant subcases SHALL receive their own declared status and evidence set

#### Scenario: Per-boundary evidence is complete
- **WHEN** a boundary declares a status
- **THEN** the report SHALL state the exact release/source revision, source mechanism reachability, limitations, downstream owner, deterministic fixture evidence and user-owned runtime verification for that boundary and its subcases

#### Scenario: Pinned versions remain fixed
- **WHEN** the report pins the official OMP release
- **THEN** OMP SHALL remain `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, OpenCode packaging SHALL remain `1.18.21`, and ACP SDK SHALL remain `0.14.1` with client terminal capability false

#### Scenario: Unresolved mechanism blocks application
- **WHEN** any mechanism stays unsupported or unresolved
- **THEN** the report SHALL block downstream application
- **AND** passing mocks SHALL NOT manufacture native support

### Requirement: OMP Pre-Import Discovery Compatibility Contract

The compatibility contract SHALL distinguish exact trusted-extension loading from independent executable custom-tool, plugin, factory, configured-root and dependency discovery. Supported exclusion SHALL occur before unowned module top-level code or factory execution, on initial creation and recovery, and SHALL account for canonical paths, symlinks and workspace-owned dependencies. A post-import lifecycle/tool-name filter SHALL NOT establish this boundary.

#### Scenario: Unowned executable path is excluded before import
- **WHEN** a discovery fixture supplies an unowned custom tool, plugin entry, configured module or dependency escape
- **THEN** the contract validator SHALL reject eligibility before the fixture importer or factory is invoked
- **AND** the ledger SHALL independently identify the native pre-import mechanism or report a blocker

#### Scenario: Extension discovery flag is incomplete
- **WHEN** evidence disables ambient extensions but independent custom-tool or plugin imports remain reachable
- **THEN** the assessment SHALL reject a supported complete-exclusion claim
- **AND** it SHALL preserve the source path showing the unguarded discovery route

### Requirement: OMP Policy Readiness Compatibility Contract

The readiness contract SHALL require an authenticated control result bound to the current process instance, ACP session identity, restricted mode, fresh challenge, policy revision and registry epoch.

#### Scenario: Current authenticated identity is accepted
- **WHEN** a source-backed control-channel fixture supplies a verified result matching all current readiness values after complete initialization
- **THEN** the contract validator SHALL accept readiness only for that matching process and session
- **AND** the fixture result SHALL be labeled adapter evidence rather than native runtime enforcement

#### Scenario: Stale or forged readiness is rejected
- **WHEN** readiness is asserted through chat, unverifiable authentication provenance, a stale challenge/process/session/registry epoch, or a failed or timed-out initialization
- **THEN** the contract validator SHALL reject readiness
- **AND** it SHALL require fresh establishment after new/load/recovery or registry transition without authorizing a prompt fixture

#### Scenario: No supported channel is established
- **WHEN** source inspection cannot establish authenticated channel reachability or exact ACP identity binding
- **THEN** the boundary SHALL remain blocked even if a mock handshake succeeds

#### Scenario: Channel and credential provenance is required
- **WHEN** the contract evaluates readiness support
- **THEN** it SHALL require a supported control channel, trusted credential origin and native-to-ACP identity mapping independent of chat or workspace assertions
- **AND** it SHALL NOT reuse raw platform or Skill API server secrets

#### Scenario: Initial or restarted state is unready
- **WHEN** the process is in an initial, new, load, restart or registry-transition state
- **THEN** readiness SHALL remain unready until all current prerequisites are satisfied
- **AND** a successful session creation or lifecycle completion alone SHALL NOT certify readiness

### Requirement: OMP Authoritative Record Compatibility Contract

The record contract SHALL evaluate effective full approval records using the pinned loader's actual lower-layer, CLI-overlay aggregation, runtime and environment precedence.

#### Scenario: Aggregated reset counterexample is retained
- **GIVEN** lower records contain an unknown-tool grant and reset plus mode CLI files supply null followed by a read mapping
- **WHEN** the source-faithful fixture aggregates CLI overlays before merging lower layers
- **THEN** it SHALL expose the surviving lower-only entry and classify that selected reset recipe as incompatible
- **AND** it SHALL NOT remodel the overlays as separate merge barriers merely to make the fixture pass

#### Scenario: Both modes require full authority
- **WHEN** a restricted fixture retains a lower grant or a YOLO fixture retains project prompt/deny entries
- **THEN** the contract validator SHALL reject authoritative-mode composition with the specific residual entries

#### Scenario: Restricted and YOLO modes keep no residue
- **WHEN** restricted or YOLO mode records are composed
- **THEN** they SHALL NOT retain unintended lower-layer grants, prompts or denials

#### Scenario: Default fallbacks are not authority
- **WHEN** evaluation encounters empty mappings, unknown setting keys or invalid values falling back to defaults
- **THEN** they SHALL NOT be treated as authority

#### Scenario: Null-reset requires preserved reset semantics
- **WHEN** a null-reset is followed by a mode mapping
- **THEN** certification SHALL occur only if source actually preserves reset semantics across the full merge sequence

### Requirement: OMP Complete Destructive Intent Compatibility Contract

The destructive contract SHALL carry trustworthy native operation input, parser/edit-syntax provenance, every operation and target, and a binding to the input that will execute. All deletion targets, move sources and destinations and patch mutation targets SHALL be represented. Native titles or an incomplete permission-location list SHALL NOT authorize a larger operation. Unknown syntax, missing endpoints, incomplete targets and input mismatch SHALL fail closed.

#### Scenario: Complete native-shaped operation is consumable
- **WHEN** a supported native-shaped delete, move or multi-operation patch fixture is completely decoded and bound to execution input
- **THEN** the contract output SHALL enumerate every target including every move endpoint for common policy consumers

#### Scenario: Later destructive target cannot be omitted
- **GIVEN** a native-shaped patch first targets an allowed location and later deletes or moves outside the boundary
- **WHEN** an established supported format/parser completely decodes the fixture for contract evaluation
- **THEN** it SHALL expose the later target and report denial with no mutation attempt
- **AND** first-operation-only native permission locations SHALL NOT be accepted as proof of completeness

#### Scenario: Missing supported decoder is a complete blocked outcome
- **WHEN** the bounded source audit cannot establish supported complete decoding for a native-shaped destructive fixture
- **THEN** the contract SHALL report the named incomplete/incompatible mechanism and authorize zero mutation attempts
- **AND** that blocked fixture SHALL satisfy P0 acceptance without implementing a speculative parser, while downstream normalization/application remains blocked

#### Scenario: Incomplete or mismatched operation is rejected
- **WHEN** a fixture contains a title-only request, missing move destination, unparseable patch or raw-input/execution mismatch
- **THEN** the contract validator SHALL return an incomplete/denied result without authorizing a side effect

### Requirement: Restricted-Only LSP Compatibility Contract

The LSP contract SHALL identify supported mode-scoped suppression of both explicit LSP tools and implicit server startup, including read/edit/write side effects, warmup and lazy cold-start, for OMP and OpenCode restricted execution. Native YOLO SHALL retain its native LSP/tool posture without additional restricted denials. A global OpenCode disable affecting YOLO SHALL NOT be an acceptable restricted-only mechanism.

#### Scenario: Separate native mode evidence is complete
- **WHEN** mode fixtures contain source-backed restricted explicit/implicit suppression and unchanged native YOLO behavior for each pinned agent
- **THEN** the contract validator SHALL accept the mode scope without introducing a YOLO LSP clamp

#### Scenario: Partial or global disable is incompatible
- **WHEN** the candidate hides only the LSP tool, leaves implicit startup reachable, or disables OpenCode YOLO through a global setting
- **THEN** the assessment SHALL reject compatibility and name the uncovered startup path or YOLO scope violation

### Requirement: OMP Native Transport Compatibility Contract

The transport contract SHALL identify supported adaptation reachability for native URL-read text/binary paths, web search and public code/documentation search, including redirects and secondary scraper/provider requests.

#### Scenario: Partial native transport override is rejected
- **WHEN** source-backed route fixtures cover enrichment fetches but binary, alternate-page, redirect or search routes bypass the controlled transport
- **THEN** the assessment SHALL report incomplete adaptation rather than a supported full-transport verdict

#### Scenario: Enforcing adapter decision preserves useful results
- **WHEN** established-route fixtures receive public text/binary/search results and enforcing-egress redirect or secondary requests to private targets
- **THEN** the adapter contract checks SHALL return the permitted public result with attribution while rejecting prohibited hops before their mocked dispatch
- **AND** proxy routing SHALL be explicit and provider failure SHALL remain a failure without fabricated results or unguarded retries

#### Scenario: Explicit unrestricted egress is not redefined
- **WHEN** the operator selects the existing unrestricted-egress posture
- **THEN** the fixture expectation SHALL follow that selected posture rather than impose a newly invented YOLO-only network denial

#### Scenario: Enforcing egress validates every hop
- **WHEN** enforcing egress is configured
- **THEN** every relevant hop SHALL be validated through existing egress rules and the explicitly controlled proxy or transport
- **AND** failures SHALL produce honest errors with no unguarded retry

#### Scenario: Selected egress postures stay distinct
- **WHEN** explicit unrestricted egress or approved provider routing is selected
- **THEN** it SHALL remain distinct from arbitrary tool targets

#### Scenario: Proxy presence is not coverage
- **WHEN** proxy environment variables are present or only a partial native fetch override exists
- **THEN** the contract SHALL NOT accept them as proof of complete native coverage

### Requirement: OMP Critical Skill Ownership Compatibility Contract

The critical-skill contract SHALL map critical identifiers to canonical deployment-owned instruction paths and read-only roots, with authoritative source/collision and current-session resource-generation evidence. Workspace/project same-name content and escaping symlinks SHALL NOT become authoritative. Owned skills SHALL remain discoverable and readable; globally disabling skills SHALL NOT satisfy ownership.

#### Scenario: Owned skill wins safely
- **WHEN** a fixture presents an owned critical skill and same-name workspace/project candidates
- **THEN** the contract output SHALL retain the canonical owned instruction path or report a blocker if native selection cannot enforce that ownership

#### Scenario: Escaping or stale skill source is rejected
- **WHEN** a critical-skill fixture resolves outside the owned root or uses another session's resource generation after new/load/refresh
- **THEN** the contract validator SHALL reject ownership without authorizing reads or replacing the critical skill by name alone
