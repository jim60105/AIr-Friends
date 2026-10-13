# Spec Delta

## MODIFIED Requirements

### Requirement: Trusted Read-Only ACP Skills Root Identity

The skills-root helper SHALL consume deployment-owned canonical source/root identity from the predecessor critical-skill compatibility contract and SHALL NOT trust a directory by name, by workspace contents or as an arbitrary model-supplied location. An agent-writable skill tree SHALL NOT by itself disqualify an otherwise canonical root. Canonical identity, link-free components, containment and current-generation evidence SHALL remain mandatory.

#### Scenario: Owned skill instruction is readable as an observation

- **GIVEN** a deployment-declared read-only root and a matching canonical current-generation instruction reference
- **WHEN** the instruction target is observed within that root
- **THEN** the result SHALL include the trusted read-only role and canonical owned instruction identity
- **AND** no mutation authority SHALL be created

#### Scenario: Skill name collision or external link is not trusted

- **WHEN** a same-name workspace file, a link leaving the root, a stale resource generation, a mismatching instruction path, or a root overlapping a writable root is supplied as a trusted reference
- **THEN** the helper SHALL return the specific ownership/containment/overlap failure
- **AND** it SHALL NOT substitute a same-name file or globally disable skills to claim success

#### Scenario: Critical references match contract path and generation

- **WHEN** an explicit critical reference is resolved against the skills root
- **THEN** it SHALL match the contract's canonical instruction path and the current session resource generation

#### Scenario: Skills root is disjoint, read-only and non-escaping

- **WHEN** the canonical skills root is established
- **THEN** it SHALL be disjoint from writable workspace/shared roots and SHALL be granted only the read-only role
- **AND** a skills-root link leaving that root SHALL fail trusted membership even if its destination lies within another readable root

#### Scenario: Trust decisions certify no native support or policy change

- **WHEN** the helper reaches trusted read-only identity decisions
- **THEN** those decisions SHALL NOT certify native OMP selection/discovery support, change unrelated workspace read-extension policy, or introduce a skills write exception

#### Scenario: Agent-writable shared root is admitted under identity checks

- **GIVEN** the deployment-declared shared skill root is writable by the runtime agent user
- **WHEN** an owned skill instruction inside it is observed
- **THEN** ownership SHALL be decided by canonical identity, link-free components, realpath containment and current-generation evidence alone
- **AND** a linked component, an escaping target, a replaced identity or a stale generation SHALL still deny

### Requirement: Read-Only Trusted Skills Access In ACP Callbacks

ACP reading SHALL additionally admit a target whose canonical role is the deployment-declared read-only trusted skills root, subject to that root's canonical identity, containment, current resource-generation currency and disjointness from writable roots, and SHALL treat that admission as root-scoped rather than extension-allowlist-based.

#### Scenario: Owned skill instruction is readable through the callback

- **GIVEN** a deployment-declared read-only skills root with matching current-generation provenance
- **WHEN** the agent reads an owned instruction file inside that root, including one whose extension is not in the workspace read allowlist
- **THEN** the read SHALL be authorized and return the owned file's content
- **AND** no write to that root SHALL be authorized afterward, for a restricted or YOLO session

#### Scenario: Permission-path skill read uses the same classification

- **WHEN** a restricted read permission request's locations resolve to the trusted skills role
- **THEN** the request SHALL be approved with the existing skill-directory audit reason
- **AND** a request anchored to an unowned HOME-discovered or workspace skills copy, an escaping link, a stale generation or an unowned root SHALL NOT be approved by the trusted rule

#### Scenario: Trusted exception does not broaden workspace reads

- **GIVEN** a workspace target whose extension is outside the read allowlist
- **WHEN** it is read while a trusted skills root is configured
- **THEN** the read SHALL still be denied by the unchanged workspace read-extension rule
- **AND** the trusted root SHALL NOT authorize any arbitrary external file

#### Scenario: Trusted root confers read authority only

- **GIVEN** a deployment-declared read-only trusted skills root
- **WHEN** the callback classifies any target under it
- **THEN** the trust SHALL confer read authority only
- **AND** it SHALL NOT authorize any write in any mode, any file outside the owned root, or any change to unrelated workspace read-extension rules

#### Scenario: Name, link, and provenance failures deny the trusted role

- **GIVEN** a workspace or project file merely sharing a skill's name, a link leaving the owned root whose destination is otherwise readable, or a root with a stale generation, a replaced identity, a canonical-path mismatch, an absent supplied identity or a writable-root overlap
- **WHEN** the callback classifies the target
- **THEN** it SHALL NOT gain the trusted role
- **AND** a stale generation, an identity mismatch or a writable-root overlap SHALL fail with the specific trusted-identity reason and no fallback to another readable role

#### Scenario: No trusted role without supplied provenance

- **WHEN** a skills root has no supplied ownership provenance
- **THEN** no trusted role SHALL exist for it
- **AND** the trusted classification SHALL NOT be applied

#### Scenario: HOME-derived auto-approval is replaced by canonical classification

- **WHEN** a skill read was previously auto-approved via the environment/HOME-derived rule
- **THEN** it SHALL be classified through the canonical trusted-skills rule instead
- **AND** a trusted skill read SHALL keep the existing approved audit reason

#### Scenario: Agent-writable declared root is admissible at the callback

- **GIVEN** the deployment-declared trusted skills root is writable by the runtime agent user, as the packaged personal tree is
- **WHEN** a canonical target inside it is classified with a matching supplied device/inode identity and current generation
- **THEN** the trusted-skills role SHALL be granted without an ownership or permission-bit test
- **AND** the root SHALL still fail classification when it overlaps a writable root, is reached through a linked root, or its supplied identity or generation no longer matches

### Requirement: Mode-Separated Owned OMP Settings Content

The system SHALL provide, as pure data and assembly code, deployment-owned OMP settings content for exactly two modes — restricted and native-yolo — each mode's composition SHALL resolve to complete owned settings documents plus owned provider-model and system-prompt assets, and the content SHALL contain no subprocess launch, pool, tool-policy-record, LSP-implementation, or packaging logic.

#### Scenario: Both mode compositions assemble deterministically

- **WHEN** the composition is requested for `restricted` and for `native-yolo`
- **THEN** each SHALL return its complete owned overlay document, ordered overlay paths with the mode document last, owned provider-model asset content, the system-prompt asset mapping, and the supported provider environment key set
- **AND** repeated assembly SHALL produce identical content without reading workspace state

#### Scenario: Workspace layer cannot loosen the pins

- **WHEN** a fixture presents a workspace/project `.omp/config.yml` or a populated global config as hostile lower layers
- **THEN** the composition SHALL record the source-backed neutralization responsibilities (deployment-owned launch cwd preventing project-layer discovery, empty deployment-owned global agent directory, authored overlay paths outside agent-writable roots) as spawn/packaging contracts
- **AND** it SHALL record that the generated skill-root declaration is prepended rather than appended, so a writable declaration can never out-rank the authored mode document's pins, that its declared value is validated against the daemon's resolved root before launch, that this one declaration path is exempt from the authored-overlay placement rule while remaining subject to the unchanged metadata checks (link, regular-file, canonical parent and accepted identity, which reveal a post-spawn rewrite), and that the pre-request preflight remains metadata-only
- **AND** no requirement in this delta SHALL claim ordering alone removes keys present only in lower layers

#### Scenario: Overlay ordering and environment posture are spawn-change contracts

- **WHEN** a mode composition is produced
- **THEN** it SHALL include ordered `--config` overlay paths with the generated skill-root declaration first and the mode document last among deployment overlays
- **AND** it SHALL record, as consumer contracts for the spawn change, the deployment-owned `PI_CODING_AGENT_DIR` under the selected process state root, the deployment-owned variable conveying the declared skill root to the extension, the declaration's own directory and spawn-time rewrite with one live process per mode-scoped state root, no `OMP_PROFILE`/`PI_PROFILE`/`PI_CONFIG_FILES` inheritance, and the deployment-owned launch working directory

#### Scenario: The declared skill directory follows the resolved root

- **GIVEN** the deployment resolved one absolute skill root
- **WHEN** either mode's generated skill-root declaration is produced at spawn time
- **THEN** the declaration document SHALL contain exactly one key, the skill custom-directory array holding that resolved root, and nothing else
- **AND** the authored mode document passed after it SHALL carry the skills-enablement and source-toggle pins and SHALL declare no skill directory, so the composed fold takes the directory from the declaration and every other pin from that document
- **AND** the declaration SHALL be validated against that same resolved root, and no other resolved overlay SHALL be required to declare a skill directory

### Requirement: Deployment-Owned OMP Skill Root Settings

Owned OMP settings SHALL declare the single deployment-resolved absolute skill root through pinned registered settings: the generated declaration carries the root, the authored mode documents carry skills enablement, the seven foreign-source toggles and no skill directory, and the composed fold therefore declares exactly that root. Exclude ambient/workspace sources where supported and keep skills globally enabled. Only that declared root SHALL supply critical-skill authority. Invalid or unowned declarations SHALL be rejected. Native verdicts and user-owned runtime acceptance SHALL remain unchanged.

#### Scenario: Both modes declare the same owned skill roots

- **WHEN** actual owned restricted/native-yolo overlays, the generated declarations and the composed settings are validated
- **THEN** the composed settings SHALL resolve to the same single resolved root with skills enabled and the registered source-toggle posture
- **AND** each generated declaration SHALL declare exactly that root, and each authored mode document SHALL declare no skill directory
- **AND** native-yolo SHALL retain native approval, LSP disabled and absence of restricted tool policy

#### Scenario: Invalid or ambient declarations fail closed

- **WHEN** a root declaration required in the generated declaration is missing/empty, relative, tilde-based, workspace-owned, linked, extra-host-root, mismatched with the daemon's resolved root, or expressed by an unregistered/default-falling-back key, or an authored mode document declares a skill directory of its own
- **THEN** owned-settings validation or canonical ownership observation SHALL reject it

#### Scenario: Overlay arrays replace without inheriting hostile roots

- **WHEN** owned source-root settings are assembled in the final mode overlay
- **THEN** the complete owned root array SHALL use pinned replacement semantics
- **AND** no inherited HOME/XDG/project source or lower custom root SHALL supply critical-skill authority

### Requirement: Owned Replacement Admission Preserves Separate Completion

Genuine owned replacement admission SHALL precede and retain the existing operation-specific controlled transport, search backend or trusted instruction-root policy. Module ownership SHALL NOT imply adapter completion, credential availability, skill ownership or filesystem authority. Denied completion SHALL NOT use native network or untrusted source fallback.

#### Scenario: Owned URL read reaches per-hop controlled transport

- **WHEN** a physically owned current-generation URL-read replacement is called for an authorized HTTP(S) destination
- **THEN** it SHALL reach the existing classified per-hop controlled transport
- **AND** denied addresses, redirects and alternate/device schemes SHALL remain denied without native fallback

#### Scenario: Owned search reaches the existing configured backend

- **WHEN** a physically owned current-generation web_search replacement is invoked
- **THEN** it SHALL reach existing backend selection and credential/host admission
- **AND** absent credentials or denied completion SHALL NOT fall back to a native provider

#### Scenario: Owned skill URI reaches its independent exact-root check

- **WHEN** a physically owned read replacement receives an owned skill instruction URI
- **THEN** the deployment-resolved skill root and the current skill identity SHALL be checked separately from module ownership
- **AND** only successful skill authorization SHALL delegate the original URI unchanged

#### Scenario: Development module ownership does not add skill URI authority

- **WHEN** an owned development module receives a skill URI outside the deployment-resolved skill root
- **THEN** skill authorization SHALL deny with no workspace or development fallback root
- **AND** native script-root selection for delivered prompts SHALL NOT expand that URI grant

#### Scenario: Module observation missing or stale

- **WHEN** physical module metadata is missing, violates its declared image/development ownership posture, is linked, outside the declaration or stale at the current epoch/generation
- **THEN** owned replacement admission SHALL deny before transport, backend execution or skill delegation
- **AND** no source-name or process-state-root fallback SHALL admit it

#### Scenario: Owned local read uses the accepted native posture

- **WHEN** the physically owned read replacement receives an ordinary screened local path
- **THEN** it SHALL delegate unchanged through the supported captured native reader under native approval and ambient OS permissions
- **AND** it SHALL NOT invent daemon session-root evidence or claim protected descriptor confinement

### Requirement: Canonical Critical-Skill Ownership Across New, Load, and Refresh

Critical skill identifiers SHALL resolve only to exact canonical instruction paths under the root declared by deployment-owned settings, carrying read-only source/root identity, collision decision and current-session resource generation. Workspace-owned discovery SHALL be excluded before critical-name selection. Name-only critical-skill resolution SHALL remain denied, skills SHALL stay globally enabled and ordinary owned skills SHALL remain usable.

#### Scenario: Owned skill wins over same-name workspace content

- **GIVEN** an owned critical instruction and workspace/project candidates sharing its name or content, including provider/custom/managed candidates and aliases
- **WHEN** critical resolution evaluates its candidate set
- **THEN** it SHALL exclude workspace candidates before precedence/collision logic
- **AND** only the exact settings-declared canonical owned instruction SHALL supply authority

#### Scenario: Name-only request never supplies canonical authority

- **WHEN** a critical reference carries only a name or native alias without exact canonical source/root and current session/generation evidence
- **THEN** resolution SHALL deny it without workspace fallback

#### Scenario: Missing or escaping owned instruction rejects

- **WHEN** a declared critical instruction is missing, linked outside its declared root, replaced or has a mismatched source identity
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

#### Scenario: Agent-writable ordinary skill is admitted by identity

- **GIVEN** the settings-declared shared root is writable by the runtime agent user and contains an ordinary (non-critical) skill
- **WHEN** its instruction is resolved
- **THEN** admission SHALL be decided by canonical path, containment and current-generation identity alone
- **AND** a workspace candidate, an escaping link, a replaced identity or a stale generation SHALL still deny

#### Scenario: Pinned critical layout keeps its ownership requirement

- **GIVEN** a candidate instruction whose relative path matches a pinned critical identifier's `SKILL.md` layout inside an agent-writable tree
- **WHEN** critical resolution evaluates it
- **THEN** it SHALL NOT supply critical authority, because critical minting consults the root's observed read-only determination — its ownership and mode observation — instead of assuming it, while ordinary skill admission does not
- **AND** a same-name candidate in a workspace SHALL NOT be substituted, and the denial SHALL be recorded rather than silently minting the identifier

#### Scenario: Native canonical-selection evidence is unchanged

- **WHEN** root declaration and selection unit/mock tests pass
- **THEN** decision 7 SHALL remain a DECIDED deployment disposition with the pinned name-only incompatibility and unresolved selection verdict unchanged
- **AND** real native skill resource selection on new/load/refresh SHALL remain user-owned and unverified

### Requirement: Owned Skill URIs Remain Readable Through Native Read

The registered read replacement SHALL expose the pinned native skill-reading capability. A skill URI SHALL resolve only against the declared canonical deployment-owned skill source and pass current canonical identity, generation and read-target checks before same-tool native delegation. Foreign, shadowed, traversing, stale, or unresolvable skills and other unsupported URI schemes SHALL remain denied. Network completion SHALL NOT grant skill authority.

#### Scenario: Declared owned skill is readable

- **WHEN** a current skill URI resolves to an instruction file under the canonical owned source
- **THEN** the read replacement SHALL admit the authorized target and delegate once to native skill reading
- **AND** the native instruction result SHALL be preserved without network dispatch

#### Scenario: Skill name alone cannot authorize a shadow

- **WHEN** a same-name skill comes from a foreign root, a replaced identity, or a stale generation
- **THEN** it SHALL be denied before native delegation
- **AND** name matching or network-adapter completion SHALL NOT override the denial

#### Scenario: Traversal and other devices remain blocked

- **WHEN** a skill URI escapes its owned source or an unsupported device URI is read
- **THEN** it SHALL be denied with a bounded reason
- **AND** no generic URI pass-through or fallback root SHALL be used

## ADDED Requirements

### Requirement: OMP Owned Skill Read And Execution Over The Shared Root

OMP SHALL admit the deployment-resolved shared skill root for owned skill instruction reads and for script execution, under the same root every other agent type resolves, without a separately packaged image tree. Admission SHALL judge the root and every target by canonical identity, link-free components and containment, and SHALL NOT require root ownership, agent-non-writability or non-group/world-writability for an ordinary skill.

#### Scenario: Installed external skill is usable by both agent types

- **GIVEN** an external skill was installed at runtime and published into the resolved root
- **WHEN** an `omp` session reads its instruction and invokes its enumerated script, and an `opencode` session does the same
- **THEN** both agent types SHALL admit the installed skill and reach the same canonical instruction path and script
- **AND** the deployment SHALL require exactly one install location and one configuration value for that skill

#### Scenario: Shared root passes OMP admission without root ownership

- **GIVEN** the resolved root is owned by a user other than root and its mode grants the runtime user write access
- **WHEN** OMP observes the root, a skill directory and a skill script inside it, in the extension and through the ACP callback layer alike
- **THEN** admission SHALL succeed on canonical identity, link-free components, real-directory/file type, `nlink === 1` for the file and supplied device/inode identity
- **AND** no ownership or permission-bit test SHALL admit a target that identity, containment or generation checks reject

#### Scenario: The extension learns the declared root from its deployment-owned launch environment

- **GIVEN** an OMP process launched in either spawn shape (per-spawn or pooled)
- **WHEN** the trusted extension resolves the declared skill root for `skill://` authorization
- **THEN** it SHALL read the deployment-owned value the daemon placed in its spawn environment, treat that value as its only witness of the declared root, and verify it is one absolute, existing, non-link directory its own root observation accepts
- **AND** an absent, unobservable or non-directory value SHALL deny with zero skill authority and no workspace, HOME or cwd fallback, and the per-spawn and pooled shapes SHALL behave identically

#### Scenario: Denied shapes stay denied

- **WHEN** the root or the target is linked, escapes the root through a link or realpath, is replaced between observation and decision, or carries a stale generation
- **THEN** OMP admission SHALL deny with a bounded reason
- **AND** a writable permission bit SHALL NOT convert such a denial into an admission

### Requirement: Inventory Denial Invariants Survive The Ownership Relaxation

The relaxed shared-root posture SHALL NOT weaken the script inventory's denial behavior. A script that appears after the inventory was constructed SHALL NOT be approved by that inventory, and an enumerated script whose identity changed in place SHALL be denied at decision time.

#### Scenario: Script planted after inventory construction is not approved

- **GIVEN** an inventory was constructed once for a connector or session from the resolved root
- **WHEN** a new script appears under that root later in that connector's or session's lifetime and is invoked
- **THEN** the permission gate SHALL deny it because it was never enumerated by that inventory
- **AND** no re-scan of the root SHALL occur per decision

#### Scenario: In-place modification of an enumerated script is denied

- **GIVEN** an enumerated script was accepted with its `(dev, ino, ctime, size)` identity
- **WHEN** its content is modified in place, or it is replaced at the same pathname, before the decision
- **THEN** the decision-time re-observation of the root and the script SHALL deny execution
- **AND** script authority SHALL NOT be re-established from the changed metadata alone
