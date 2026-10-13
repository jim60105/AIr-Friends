# Spec Delta

## ADDED Requirements

### Requirement: Current OMP Batch Documentation Distinguishes Archived Baseline and Proposed Corrections

Current OMP documentation SHALL distinguish the 35 archived baseline changes from the five seam-correction proposals and any applied correction. It SHALL preserve cancelled readiness, label historical rows/evidence, reflect superseded public-code-search removal and record issue owners, accepted decisions, dependencies and shared-file conflicts. Artifact validation SHALL NOT imply implementation or native acceptance.

#### Scenario: Archived baseline membership is reported
- **WHEN** the current OMP batch index is synchronized
- **THEN** it SHALL identify 27 original archived changes, seven archived C followups and the archived skill-root-resolution change
- **AND** unrelated non-OMP archive entries SHALL NOT inflate that baseline count

#### Scenario: Historical cancelled and superseded rows stay truthful
- **WHEN** the original readiness and public-code-search rows are shown
- **THEN** readiness SHALL stay cancelled with no handshake or acknowledgement
- **AND** the historical code-search adapter SHALL be labeled superseded by its archived removal, not an active supported capability

#### Scenario: New proposals are not claimed applied
- **WHEN** correction artifacts exist without their implementation having landed
- **THEN** the index SHALL report proposed status with its ownership and application matrix
- **AND** the user's accepted native local read/search and authorized ambient native mutation SHALL NOT be reported as daemon root confinement, a still-pending protected-IO prerequisite or an application-blocked mutation status

#### Scenario: Authorized native mutation is not a pending prerequisite
- **WHEN** the current docs describe ordinary native write/edit beside the accepted native read/search posture
- **THEN** they SHALL record the user's explicit authorization of the ambient native mutation risk and SHALL NOT retain an application-blocked mutation status or a pending mutation-route prerequisite
- **AND** they SHALL NOT claim ACP-sink protection for absolute native session-sandbox/plan targets or an unavailable client bridge, and SHALL NOT reopen the accepted local read/search decision

### Requirement: OMP Launch Documentation Names the Generated Deployment Artifact

Current launch, discovery and packaging documentation SHALL identify the canonical TypeScript tree as build input and the selected generated JavaScript bundle as the sole loaded artifact. It SHALL distinguish deployment module/root ownership from mutable process state and session roots. Obsolete copied source closure and raw-source launch instructions SHALL be removed, not retained as alternatives.

#### Scenario: Development and image launch paths agree
- **WHEN** development or image launch documentation shows the trusted-extension argument
- **THEN** development SHALL name the resolved generated `build/omp-extension/index.js` and image SHALL name `/opt/air/omp/extension/index.js`
- **AND** neither SHALL instruct launching the raw canonical `.ts` source

#### Scenario: Dependency closure description follows packaging
- **WHEN** the extension packaging closure is documented
- **THEN** it SHALL describe the generated locked artifact and explicit supported native-host facade with manifest coverage
- **AND** it SHALL NOT claim a copied `_daemon` import tree or mutable state root supplies deployment ownership

### Requirement: OMP Boundary Documentation Preserves Evidence Limits

Current OMP boundary documentation SHALL separate source/mock findings, user observations and unverified official-runtime behavior. It SHALL reflect DECIDED deployment dispositions beside unchanged unresolved native verdict strings, retain accepted extension-load residual risk and avoid hard handler-readiness guarantees. Substantive owners SHALL update their behavior docs before final consolidation.

#### Scenario: Extension load failure is not observable readiness
- **WHEN** discovery or launch docs discuss trusted-extension errors
- **THEN** they SHALL distinguish daemon preflight rejection from the pinned runner's accepted extension-error logging risk
- **AND** they SHALL NOT promise authenticated handler presence, guaranteed session/new/load rejection or never-extensionless execution

#### Scenario: Decided dispositions are not new pending approvals
- **WHEN** old unresolved native discovery/skill-selection verdicts are documented
- **THEN** their unchanged strings SHALL appear beside the existing DECIDED deployment dispositions
- **AND** they SHALL NOT be presented as awaiting a second user decision for those old dispositions

#### Scenario: Final docs pass removes current stale claims
- **WHEN** the correction owners' implemented behavior is consolidated
- **THEN** current docs SHALL reflect direct live roster observation, source-specific provenance, independent physical module evidence, delivered quoted root and all owning recovery callers
- **AND** no-runtime-consumer or pooled-only language SHALL NOT remain as a false current-state assertion

#### Scenario: Accepted native status and version audit stay distinct
- **WHEN** current docs describe local native read/search and the official v18.10.3 source investigation
- **THEN** they SHALL record approval plus ambient OS readability beyond daemon roots and the absence of a latest-version confined-IO fix
- **AND** deployment SHALL remain v18.6.1 without an automatic bump, custom broker or obsolete decision blocker

#### Scenario: Runtime checklist and scope invariants remain unchanged
- **WHEN** source/mock documentation is updated without official runtime acceptance
- **THEN** unexercised checklist entries SHALL remain UNVERIFIED and user observations SHALL NOT be rerun or recast as success
- **AND** pins, existing configuration trio, native-YOLO separation, LSP disable scope and sandbox/egress behavior SHALL remain unchanged
