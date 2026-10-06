## ADDED Requirements

### Requirement: Trusted-Module Pre-Import Discovery Exclusion Bootstrap

The AIr-owned trusted extension module SHALL compute, at load time inside the trusted module and before any untrusted executable tool or plugin module can import, a single frozen pre-import exclusion decision covering every discovery/import surface recorded by the pinned compatibility contract: native custom-tool discovery roots, plugin entry points, configured module roots, workspace-owned dependencies, symlinked/linked roots, and load/refresh rediscovery. Each surface SHALL carry the mechanism this integration applies plus a status of exactly `supported`, `candidate-to-verify`, or `no-supported-mechanism` as recorded at the pinned source revision, and the extension-disability surface SHALL NOT be generalized to custom-tool or plugin discovery. The bootstrap SHALL NOT import a candidate module to inspect its factory, metadata, or name, and SHALL NOT treat a host guard, preloaded-path input, post-import tool-name filter, or lifecycle allowlist as an import boundary.

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

### Requirement: Fail-Closed Session Setup When Exclusion Cannot Be Established

When the required pre-import exclusion cannot be established — a surface with no supported mechanism, a violated owned-module or dependency-closure identity, an owned-root symlink escape, or a contradicted deployment environment posture — trusted-module initialization SHALL fail and the affected session creation or recovery SHALL fail as an ACP request error observable to the client, naming the failing surface and its status with a bounded message free of credentials or file content. Session setup SHALL NOT degrade to a partially guarded session, an extensionless or unguarded process, or a different agent type.

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

### Requirement: Exact Owned-Module Trust Scope

Only the module at the contracted deployment-owned path imported from the owned path constants, together with its pinned image-owned dependency closure, SHALL be trusted. A candidate occupying a workspace path, a home-directory path, or a package-cache/npx-discoverable path SHALL gain nothing, even when byte-identical to the owned module. A candidate matching a critical skill name or critical tool name SHALL gain nothing by name alone. A symlink or linked package that leaves the owned canonical root SHALL be untrusted even when its destination is otherwise readable, and owned-root trust SHALL reuse the canonical filesystem-root identity decisions rather than a second canonicalizer or a lexical prefix test. Owned-module identity SHALL NOT depend on permission mode.

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

### Requirement: Canonical Critical-Skill Ownership Across New, Load, and Refresh

Critical skill identifiers SHALL resolve only to canonical instruction paths inside the pinned owned skills root, carrying the source identity, collision decision, and current resource generation from the compatibility contract. Untrusted project and workspace discovery SHALL be excluded from critical-name resolution, so same-name project or workspace content and escaping links cannot satisfy a critical identifier. Ordinary skills SHALL remain globally enabled: this boundary SHALL NOT disable skills globally, SHALL NOT introduce or pin a skills configuration key, and SHALL NOT remove provider skills. The ownership decision SHALL hold on initial creation, recovery, and every registry/skill-snapshot refresh, and a stale generation or another session's snapshot SHALL fail resolution.

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

### Requirement: Discovery And Critical-Selection Compatibility Gates Remain Blocking

The integration SHALL record two named application gates carrying the pinned verdicts verbatim: pre-import exclusion — extension flags alone incompatible and the supported full mechanism unresolved — and critical skill ownership — name-only trust incompatible and canonical selection unresolved. While either gate stands, full security consumption of OMP session setup SHALL remain blocked, and resolution of either gate SHALL require a source-backed supported mechanism adopted through an explicit user design decision together with a compatibility-contract revision. Automated unit and mock evidence in this change SHALL validate decision logic only — which roots, paths, and names would be excluded, and the fail-closed error shape — and SHALL NOT be presented as evidence that the official executable enforces the exclusion or canonical selection.

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
