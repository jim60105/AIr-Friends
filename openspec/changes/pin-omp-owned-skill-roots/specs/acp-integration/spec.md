## ADDED Requirements

### Requirement: Deployment-Owned OMP Skill Root Settings

Both owned OMP mode compositions SHALL declare canonical deployment-owned absolute skill roots through pinned registered settings, exclude ambient/workspace sources where supported and keep skills globally enabled. Only declared owned roots SHALL supply critical-skill authority. Invalid or unowned declarations SHALL be rejected. Native verdicts and user-owned runtime acceptance SHALL remain unchanged.

#### Scenario: Both modes declare the same owned skill roots
- **WHEN** actual owned restricted/native-yolo overlays and composed settings are validated
- **THEN** they SHALL declare the same owned roots with skills enabled and registered source-toggle posture
- **AND** native-yolo SHALL retain native approval, LSP disabled and absence of restricted tool policy

#### Scenario: Invalid or ambient declarations fail closed
- **WHEN** a root declaration is missing/empty, relative, tilde-based, workspace-owned, writable, linked, extra-host-root or expressed by an unregistered/default-falling-back key
- **THEN** owned-settings validation or canonical ownership observation SHALL reject it

#### Scenario: Overlay arrays replace without inheriting hostile roots
- **WHEN** owned source-root settings are assembled in the final mode overlay
- **THEN** the complete owned root array SHALL use pinned replacement semantics
- **AND** no inherited HOME/XDG/project source or lower custom root SHALL supply critical-skill authority

## MODIFIED Requirements

### Requirement: Canonical Critical-Skill Ownership Across New, Load, and Refresh

Critical skill identifiers SHALL resolve only to exact canonical instruction paths under roots declared by deployment-owned settings, carrying read-only source/root identity, collision decision and current-session resource generation. Workspace-owned discovery SHALL be excluded before critical-name selection. Name-only critical-skill resolution SHALL remain denied, skills SHALL stay globally enabled and ordinary owned skills SHALL remain usable.

#### Scenario: Owned skill wins over same-name workspace content
- **GIVEN** an owned critical instruction and workspace/project candidates sharing its name or content, including provider/custom/managed candidates and aliases
- **WHEN** critical resolution evaluates its candidate set
- **THEN** it SHALL exclude workspace candidates before precedence/collision logic
- **AND** only the exact settings-declared canonical owned instruction SHALL supply authority

#### Scenario: Name-only request never supplies canonical authority
- **WHEN** a critical reference carries only a name or native alias without exact canonical source/root and current session/generation evidence
- **THEN** resolution SHALL deny it without workspace fallback

#### Scenario: Missing or escaping owned instruction rejects
- **WHEN** a declared critical instruction is missing, writable, linked outside its owned root, replaced or has a mismatched source identity
- **THEN** resolution SHALL reject without trusting a same-name alternative or disabling all skills

#### Scenario: Ownership survives load and refresh transitions
- **GIVEN** a session is created, loaded/recovered and its active resources refreshed
- **WHEN** critical resolution follows each event
- **THEN** it SHALL consume the same owned-settings declaration and current authoritative session/resource generation
- **AND** stale or foreign-session native snapshots SHALL be rejected

#### Scenario: Skills remain enabled while critical resolution is pinned
- **WHEN** non-critical skills under declared deployment-owned roots are discovered or their instruction files read
- **THEN** they SHALL remain usable under existing trusted-read and staging contracts
- **AND** no global skill disablement, payload staging move or new restricted native-YOLO tool policy SHALL be involved

#### Scenario: Escaping link cannot satisfy a critical identifier
- **GIVEN** a candidate is reachable through a link escaping its settings-declared owned root
- **WHEN** critical resolution evaluates the candidate
- **THEN** it SHALL NOT satisfy the critical identifier

#### Scenario: Native canonical-selection evidence is unchanged
- **WHEN** root declaration and selection unit/mock tests pass
- **THEN** decision 7 SHALL remain a DECIDED deployment disposition with the pinned name-only incompatibility and unresolved selection verdict unchanged
- **AND** real native skill resource selection on new/load/refresh SHALL remain user-owned and unverified
