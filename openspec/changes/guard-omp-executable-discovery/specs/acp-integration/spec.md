## ADDED Requirements

### Requirement: Trusted-Module Pre-Import Discovery Exclusion Bootstrap

The AIr-owned trusted extension module SHALL compute, at load time inside the trusted module and before any untrusted executable tool or plugin module can import, a single frozen pre-import exclusion decision covering every discovery/import surface recorded by the pinned compatibility contract.

#### Scenario: Unowned candidate is excluded without import
- **GIVEN** a discovery fixture supplies a workspace-owned custom tool root, a plugin entry, a configured module root, a workspace-owned dependency, or a linked root outside the owned root
- **WHEN** the bootstrap decision is computed
- **THEN** the candidate SHALL appear as an excluded root with its surface id and pinned status
- **AND** the fixture importer spy SHALL record zero import attempts for that candidate

#### Scenario: Extension flag is not claimed as complete exclusion
- **GIVEN** the launch carries the extension-disable flag and the exact owned trusted-module argument
- **WHEN** custom-tool or plugin discovery routes remain reachable at the pin with no supported mechanism
- **THEN** the decision SHALL report those surfaces as blocking with `no-supported-mechanism`
- **AND** the decision SHALL NOT report a complete-exclusion supported verdict

#### Scenario: Decision is frozen per process
- **WHEN** native state changes after module load, including registry or project-layer transitions
- **THEN** the pre-import decision SHALL remain the load-time frozen value and SHALL be re-consulted, not reopened, on subsequent session creation or recovery

#### Scenario: Every pinned surface carries its mechanism and status
- **GIVEN** the pinned compatibility contract records discovery surfaces including native custom-tool discovery roots, plugin entry points, configured module roots, workspace-owned dependencies, symlinked/linked roots, and load/refresh rediscovery
- **WHEN** the frozen pre-import decision is computed
- **THEN** each surface SHALL carry both the mechanism this integration applies and a status of exactly `supported`, `candidate-to-verify`, or `no-supported-mechanism` as recorded at the pinned source revision

#### Scenario: Extension-disability is not generalized to other discovery
- **GIVEN** the extension-disable flag is present in the launch
- **WHEN** custom-tool or plugin discovery surfaces are covered by the decision
- **THEN** the extension-disability surface SHALL NOT be generalized to custom-tool or plugin discovery

#### Scenario: No import or host guard acts as an import boundary
- **WHEN** the bootstrap excludes a candidate without inspecting it
- **THEN** the bootstrap SHALL NOT import the candidate module to inspect its factory, metadata, or name
- **AND** SHALL NOT treat a host guard, preloaded-path input, post-import tool-name filter, or lifecycle allowlist as an import boundary

### Requirement: Fail-Closed Session Setup When Exclusion Cannot Be Established

When the required pre-import exclusion cannot be established — a surface with no supported mechanism, a violated owned-module or dependency-closure identity, an owned-root symlink escape, or a contradicted deployment environment posture — trusted-module initialization SHALL fail and the affected session creation or recovery SHALL fail as an ACP request error observable to the client.

#### Scenario: Session creation fails visibly
- **GIVEN** the bootstrap decision contains an unresolved exclusion blocker
- **WHEN** a new session is requested
- **THEN** session creation SHALL reject with an error naming the failing surface id and status
- **AND** no guarded-session state SHALL be registered for that session

#### Scenario: Recovery fails closed identically
- **WHEN** session recovery is requested on a process whose exclusion decision is blocked or whose current selection generation is stale
- **THEN** recovery SHALL fail with the same named-surface error
- **AND** the session SHALL NOT resume with a previously established guard claim

#### Scenario: No silent downgrade path exists
- **WHEN** trusted-module initialization fails
- **THEN** the integration SHALL NOT proceed to launch or reuse an agent process without the trusted module
- **AND** SHALL NOT substitute another agent type or an unguarded fallback

#### Scenario: Failure message is bounded and credential-free
- **WHEN** session creation or recovery fails as an ACP request error
- **THEN** the error SHALL name the failing surface and its status
- **AND** the message SHALL be bounded and free of credentials or file content

#### Scenario: No degraded session shape is produced
- **WHEN** session setup cannot complete under the trusted-module guard
- **THEN** setup SHALL NOT degrade to a partially guarded session, an extensionless or unguarded process, or a different agent type

### Requirement: Exact Owned-Module Trust Scope

Only the module at the contracted deployment-owned path imported from the owned path constants, together with its pinned image-owned dependency closure, SHALL be trusted.

#### Scenario: Identical module outside the owned root is untrusted
- **GIVEN** a workspace, home, or package-cache path holds a copy of the owned module content
- **WHEN** the ownership decision is evaluated
- **THEN** the copy SHALL be excluded with an untrusted-location reason
- **AND** no trusted-extension argument, read exception, or skill authority SHALL be granted to it

#### Scenario: Critical-name match alone confers nothing
- **GIVEN** a discovered candidate is named after a critical skill or critical tool
- **WHEN** trust and critical-name resolution are evaluated
- **THEN** the candidate SHALL remain untrusted and SHALL NOT resolve the critical name
- **AND** the decision SHALL record name-only trust as rejected

#### Scenario: Escaping link out of the owned root is untrusted
- **GIVEN** a symlink or linked package inside the owned root resolves outside its canonical identity
- **WHEN** the ownership decision is evaluated
- **THEN** the candidate SHALL be untrusted with the canonical symlink-escape or identity-mismatch reason
- **AND** ordinary skills and workspace content outside the owned root SHALL remain unaffected otherwise

#### Scenario: Owned-root trust reuses canonical root identity
- **GIVEN** an owned-root path is evaluated for trust
- **WHEN** the ownership decision is computed
- **THEN** trust SHALL reuse the canonical filesystem-root identity decisions
- **AND** SHALL NOT apply a second canonicalizer or a lexical prefix test

#### Scenario: Escape is untrusted despite a readable destination
- **GIVEN** a symlink or linked package inside the owned root leaves the owned canonical root
- **WHEN** the ownership decision is evaluated
- **THEN** the linked module SHALL be untrusted even when its destination is otherwise readable

#### Scenario: Permission mode is not part of owned-module identity
- **WHEN** owned-module identity is evaluated
- **THEN** identity SHALL NOT depend on permission mode

### Requirement: Canonical Critical-Skill Ownership Across New, Load, and Refresh

Critical skill identifiers SHALL resolve only to canonical instruction paths inside the pinned owned skills root, carrying the source identity, collision decision, and current resource generation from the compatibility contract.

#### Scenario: Owned skill wins over same-name workspace content
- **GIVEN** an owned critical skill and same-name project/workspace candidates are both discoverable
- **WHEN** the critical identifier is resolved
- **THEN** the canonical owned instruction path SHALL be selected with its owned read-only root identity
- **AND** the workspace/project candidate SHALL be recorded as excluded from critical-name resolution

#### Scenario: Skills remain enabled while critical resolution is pinned
- **WHEN** ordinary (non-critical) skill discovery is evaluated on the same process
- **THEN** ordinary skills SHALL remain discoverable and usable
- **AND** no global skills disablement or new configuration key SHALL be involved

#### Scenario: Ownership survives load and refresh transitions
- **GIVEN** a session is created, then recovered, then a skill-snapshot/registry refresh replaces the active skills
- **WHEN** the critical identifier is resolved after each event
- **THEN** each resolution SHALL consult the current canonical selection and current resource generation
- **AND** a stale-generation or foreign-session snapshot SHALL be rejected with the contract's stale-resource reason

#### Scenario: Escaping link cannot satisfy a critical identifier
- **GIVEN** a candidate is discoverable only through a link that escapes the pinned owned skills root
- **WHEN** the critical identifier is resolved
- **THEN** the candidate SHALL NOT satisfy the critical identifier

### Requirement: Discovery And Critical-Selection Compatibility Gates Remain Blocking

The integration SHALL record two named application gates carrying the pinned verdicts verbatim, and while either gate stands, full security consumption of OMP session setup SHALL remain blocked.

#### Scenario: Passing mocks cannot clear a gate
- **WHEN** the exclusion, ownership, and critical-skill decision tests all pass
- **THEN** both gates SHALL still report `unresolved` with their pinned verdict text and a required user decision
- **AND** no test result, fixture, or synthetic positive SHALL be cited as native support

#### Scenario: Gate resolution requires a user decision
- **WHEN** an implementer proposes to close either gate
- **THEN** the change SHALL be blocked until the compatibility contract records a source-backed supported mechanism at the pin and an explicit user decision adopts it
- **AND** the specification SHALL NOT be rewritten to claim support in advance of that decision

#### Scenario: Operative boundary while gated
- **GIVEN** either gate stands open
- **WHEN** restricted execution is assessed
- **THEN** the restricted execution-time default-deny and filesystem authorization boundaries owned by other changes SHALL be documented as operative
- **AND** discovery-side exclusion SHALL be documented as defense in depth rather than a substitute

#### Scenario: Gate verdicts are recorded verbatim
- **WHEN** the two application gates are recorded
- **THEN** the pre-import exclusion gate SHALL carry the pinned verdict "extension flags alone incompatible and the supported full mechanism unresolved"
- **AND** the critical skill ownership gate SHALL carry the pinned verdict "name-only trust incompatible and canonical selection unresolved"

#### Scenario: Automated evidence validates decision logic only
- **GIVEN** automated unit and mock evidence is produced for this change
- **WHEN** that evidence is offered in support of either gate
- **THEN** the evidence SHALL validate decision logic only — which roots, paths, and names would be excluded, and the fail-closed error shape
- **AND** SHALL NOT be presented as evidence that the official executable enforces the exclusion or canonical selection
