## ADDED Requirements

### Requirement: Contextual ACP Filesystem Path Resolution

The common filesystem helpers SHALL require the requesting ACP session's explicit context and SHALL expand supported legacy session tokens using that context only. Structured `$TMPDIR`/`${TMPDIR}` SHALL mean `{session cwd}/tmp`, `$SESSION_ID`/`${SESSION_ID}` SHALL mean the active Skill API session ID, and `$AGENT_WORKSPACE`/`${AGENT_WORKSPACE}` SHALL mean the explicitly configured shared workspace. Unbraced expansion SHALL respect variable-name boundaries. Relative paths SHALL resolve against the session cwd, not the daemon cwd. Missing/mismatched context, unavailable referenced token values, unresolved variable syntax, empty/NUL paths and URI/device references SHALL fail closed. Helpers SHALL NOT execute shell expansion, consult another session's fallback context, or derive grants from process environment. The normalized contextual path SHALL be the downstream target, not a differently interpreted raw input.

#### Scenario: Legacy and absolute staging paths agree
- **GIVEN** a session with cwd `/data/user`, Skill API ID `skill-a`, and staging `/data/user/tmp/skill-a`
- **WHEN** equivalent absolute, `$TMPDIR/$SESSION_ID/payload.md`, `${TMPDIR}/${SESSION_ID}/payload.md`, and `tmp/skill-a/payload.md` paths are resolved
- **THEN** they SHALL return the same normalized session path `/data/user/tmp/skill-a/payload.md`
- **AND** a process TMPDIR under another mode or pool SHALL NOT affect that result

#### Scenario: Unknown or absent context fails without fallback
- **WHEN** the requesting ACP ID lacks a matching context, a referenced token value is absent, or the path contains `$TMPDIR2`, `$SESSION_ID2`, `$OTHER` or `${OTHER}`
- **THEN** the helper SHALL return a specific failure without a successful target
- **AND** a literal directory matching an unresolved token SHALL NOT make the request eligible

#### Scenario: Relative path ignores daemon cwd
- **GIVEN** the daemon cwd differs from the session cwd
- **WHEN** `notes.md` is resolved for that session
- **THEN** the resulting normalized path SHALL be under the session cwd and SHALL NOT be derived from the daemon cwd

### Requirement: Canonical ACP Session Root Identity

The helpers SHALL expose configured and canonical root identity for the requesting workspace, exact canonical Skill API staging location, optional shared Agent workspace and independently trusted read-only skills root. Configured workspace/shared/skills roots SHALL resolve to existing directories; absent optional roots SHALL grant nothing, while configured-but-invalid roots SHALL fail. A prospective staging directory SHALL be represented by its canonical existing directory ancestor and missing suffix without creating it. Staging identity SHALL correspond to `{canonical workspace}/tmp/{active Skill API ID}` and SHALL NOT resolve to a sibling session, ordinary workspace alias or process-state directory. Process TMPDIR and state roots SHALL NOT create additional authorizing roles. Observations SHALL carry session/context generation and available filesystem identities without inventing unavailable metadata.

#### Scenario: Lazy staging has a concrete physical anchor
- **GIVEN** the workspace exists but its own `tmp/skill-a` directory does not
- **WHEN** session roots are observed
- **THEN** the helper SHALL return prospective staging anchored to an existing canonical workspace directory with the ordered missing suffix
- **AND** it SHALL NOT create any directory or authorize a process temporary root instead

#### Scenario: Staging alias cannot change session ownership
- **WHEN** `tmp/skill-a` or its parent links to `tmp/skill-b`, an ordinary workspace directory, or a process-state root rather than the exact canonical session payload location
- **THEN** root construction SHALL fail with a specific identity/containment reason
- **AND** that alias SHALL NOT become a staging grant

#### Scenario: Canonical root alias preserves identity
- **GIVEN** a trusted caller supplies a host-provisioned workspace root alias resolving to an existing directory
- **WHEN** its root identity is constructed
- **THEN** the output SHALL include both configured and canonical paths and observed identity
- **AND** later request symlinks SHALL NOT establish additional roots

### Requirement: Canonical ACP Existing and Prospective Target Decisions

The helpers SHALL classify physical target membership with equal-or-separator containment against each applicable root. Existing targets SHALL return canonical destination, target type, root-relative destination and observed identity; missing new-file targets SHALL return a canonical existing directory ancestor, its identity and ordered missing suffix. Existing-only requests SHALL fail when absent. Special nodes and file/directory expectation mismatches SHALL fail. Every observed parent or final symlink traversal SHALL remain within the same applicable root to receive that root role. Escaping links SHALL NOT gain authority by reaching a different otherwise allowed root. Contained links MAY be eligible as canonical observations, but their raw spelling SHALL NOT be reopened as proof of safe access. Prospective decisions SHALL require confirmed absence rather than treating a dangling symlink, inaccessible object or canonicalization error as a missing file.

#### Scenario: Existing and nested new targets expose actionable observations
- **WHEN** an existing regular file and a new nested file under an applicable root are observed
- **THEN** the existing result SHALL expose its canonical root-relative target and identity
- **AND** the new result SHALL expose the nearest existing canonical directory ancestor and complete ordered missing suffix without performing protected IO

#### Scenario: Escaping parent and final symlinks are rejected
- **WHEN** a parent-directory or final-file link reaches an external path or sibling workspace, including a same-string-prefix sibling
- **THEN** it SHALL NOT receive workspace membership and SHALL return a specific escape failure if no independent applicable role succeeds
- **AND** lexical prefix containment SHALL NOT override the physical decision

#### Scenario: Narrow staging membership cannot be laundered
- **GIVEN** a valid session staging root contains a child link to another session's staging or an ordinary directory inside the same user workspace
- **WHEN** that target is classified
- **THEN** it SHALL NOT receive the requesting session's staging role
- **AND** any independently valid broad workspace role SHALL be returned separately rather than converted to restricted staging authorization

#### Scenario: In-root symlink resolves to canonical destination
- **WHEN** all observed links for a candidate role stay inside that same root
- **THEN** the result SHALL identify the canonical destination, applicable physical roles and observed symlinks
- **AND** it SHALL NOT imply that ordinary raw-path filesystem IO is safe

#### Scenario: Dangling link or metadata failure is not a prospective target
- **WHEN** lstat observes a link with a missing destination, a loop, a non-directory parent, a denied metadata operation or an inconsistent object that disappears before canonicalization
- **THEN** the helper SHALL return the applicable dangling-link, loop, type, canonicalization or path-changed failure
- **AND** it SHALL NOT downgrade the failure to new-file success

### Requirement: Trusted Read-Only ACP Skills Root Identity

The skills-root helper SHALL consume deployment-owned canonical source/root identity from the predecessor critical-skill compatibility contract, not trust by name, workspace contents or arbitrary model-supplied directory. Explicit critical references SHALL match the contract's canonical instruction path and current session resource generation. The canonical skills root SHALL be disjoint from writable workspace/shared roots and SHALL grant a read-only role only. A skills-root link leaving that owned root SHALL fail trusted membership even if its destination lies within another readable root. These decisions SHALL NOT certify native OMP selection/discovery support, change unrelated workspace read-extension policy, or introduce a skills write exception.

#### Scenario: Owned skill instruction is readable as an observation
- **GIVEN** a deployment-owned read-only root and a matching canonical current-generation instruction reference
- **WHEN** the instruction target is observed within that root
- **THEN** the result SHALL include the trusted read-only role and canonical owned instruction identity
- **AND** no mutation authority SHALL be created

#### Scenario: Skill name collision or external link is not trusted
- **WHEN** a same-name workspace file, escaping owned-root link, stale resource generation, mismatching instruction path or writable-root overlap is supplied as a trusted reference
- **THEN** the helper SHALL return the specific ownership/containment/overlap failure
- **AND** it SHALL NOT substitute a same-name file or globally disable skills to claim success

### Requirement: Fail-Closed ACP Root Observation and Evidence Limits

All context/root/target helpers SHALL return either a complete successful observation or one finite specific failure, never a partial successful grant, empty root or lexical fallback. Failure categories SHALL distinguish invalid context/path/token, invalid/unavailable/overlapping root, outside-root/link escape, dangling/looping link, missing object, wrong type, canonicalization failure, changed path and trusted identity mismatch. Observations SHALL be scoped to the exact session/context generation and SHALL NOT be reusable permissions or race-proof access guarantees. Secure access through the actual operation and client sink adoption SHALL remain separate dependent changes. Unsupported predecessor source boundaries SHALL remain blockers regardless of helper mocks. Tests SHALL use real helper logic with temporary filesystems or deterministic metadata mocks only, and SHALL NOT claim native OMP enforcement.

#### Scenario: Canonicalization error fails closed
- **WHEN** an applicable root or target metadata operation raises an error other than confirmed absence permitted by new-file semantics
- **THEN** the helper SHALL return a named failure with no successful target or lexical authorization fallback
- **AND** it SHALL perform no protected read-content or mutation operation

#### Scenario: Replacement does not become a race-proof claim
- **WHEN** a deterministic test changes a root, ancestor or final target between metadata observations
- **THEN** detectable inconsistency SHALL produce path-changed failure or the newly observed containment decision
- **AND** successful prechecks SHALL remain operation-scoped observations requiring the dependent secure access layer to preserve containment through actual IO

#### Scenario: Native YOLO keeps broad containment observations
- **GIVEN** a target physically inside the user workspace or shared Agent workspace, including another state file already inside that broad workspace
- **WHEN** a native YOLO consumer requests physical membership
- **THEN** the helpers SHALL expose its broad role without imposing restricted staging-only, extension, LSP, command or tool clamps
- **AND** external escapes SHALL remain ineligible; no claim SHALL be made about native execution paths that do not use ACP callbacks

#### Scenario: Passing helper tests does not clear compatibility blockers
- **WHEN** temporary-filesystem or synthetic contract fixtures pass while the actual P0 source verdict remains incompatible or unresolved
- **THEN** the helper evidence SHALL remain local decision evidence only
- **AND** downstream application SHALL remain blocked under the predecessor compatibility contract without manufactured native support
