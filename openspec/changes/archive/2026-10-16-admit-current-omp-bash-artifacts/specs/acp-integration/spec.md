# Spec Delta

## MODIFIED Requirements

### Requirement: Canonical ACP Session Root Identity

The helpers SHALL expose the configured and canonical root identity for the requesting workspace: the exact canonical Skill API staging location, the optional shared Agent workspace, the independently trusted read-only skills root, and an optional current-native-session OMP artifact root with lifecycle-proven identity.

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

#### Scenario: Configured roots exist, optional roots grant nothing
- **GIVEN** workspace, shared or skills roots are configured for the requesting workspace
- **WHEN** session root identity is constructed
- **THEN** configured roots SHALL resolve to existing directories, absent optional roots SHALL grant nothing, and configured-but-invalid roots SHALL fail
- **AND** a lazily absent optional OMP artifact directory SHALL grant no current access without failing unrelated ordinary-root operations

#### Scenario: Staging identity is workspace-derived
- **WHEN** the canonical staging identity is exposed
- **THEN** it SHALL correspond to `{canonical workspace}/tmp/{active Skill API ID}`
- **AND** it SHALL NOT resolve to a sibling session, ordinary workspace alias or process-state directory

#### Scenario: Process and state roots grant no authorizing roles
- **WHEN** a process TMPDIR or state directory is observed during root construction
- **THEN** it SHALL NOT create a general authorizing role
- **AND** only the exact lifecycle-proven current OMP artifact directory SHALL be eligible for the separate read-only artifact role

#### Scenario: Observations carry generation and available identity only
- **WHEN** session roots are observed
- **THEN** observations SHALL carry the session/context generation and available filesystem identities
- **AND** they SHALL NOT invent unavailable metadata

### Requirement: Permission Handling — YOLO Mode

In YOLO mode (global `--yolo` flag or per-channel `yolo: true`), the system SHALL auto-approve permission requests, including destructive-shaped requests, except OMP-context file operations targeting reserved OMP native state. Destructive normalization SHALL NOT introduce a restricted tool, extension, staging-only or target-count clamp. Reserved OMP state SHALL use its explicit callback read-only policy.

#### Scenario: YOLO auto-approve
- **GIVEN** YOLO mode is enabled (globally or per-channel)
- **WHEN** a permission request is received, including a delete, move or multi-operation patch request, outside the OMP-context reserved-state exception
- **THEN** it SHALL be auto-approved with reason `"yolo_mode"`
- **AND** no restricted destructive completeness or target-scope denial SHALL be substituted for that approval

#### Scenario: YOLO filesystem callback keeps broad containment without restricted clamps
- **GIVEN** a YOLO session
- **WHEN** it writes any extension to a path physically inside its user workspace or the shared Agent workspace, outside reserved OMP native state for an OMP callback context
- **THEN** the write SHALL be authorized through the protected access operation under that broad root role
- **AND** no restricted staging-only rule, extension allowlist or workspace-write authorization flag SHALL be applied

#### Scenario: YOLO does not relax escape or read-only-root denial
- **GIVEN** a YOLO session
- **WHEN** it requests a write, a deletion or a move whose source or destination is external or sibling-workspace, whose containment observation escapes, or which lies inside the trusted read-only skills root or OMP-context reserved native state
- **THEN** the operation SHALL be denied with the mapped bounded reason and no content IO

#### Scenario: YOLO behavior is identical for both agents
- **GIVEN** an OpenCode and an OMP session in YOLO mode
- **WHEN** the same filesystem callback or destructive target outside OMP-context reserved native state is presented to each
- **THEN** both SHALL receive the same authorization outcome, with no restricted-mode policy copied into YOLO
- **AND** only OMP callback contexts SHALL apply the explicitly declared OMP native-state reservation; OpenCode's existing outcomes SHALL remain unchanged

#### Scenario: YOLO callback authorization is broad physical containment including destructive targets
- **WHEN** YOLO authorizes an ACP filesystem callback
- **THEN** a target holding the requesting session's user-workspace or shared Agent workspace role SHALL be authorized with no staging-only restriction, write-extension filter, `canWriteAgentWorkspace` requirement or restricted tool/LSP/command clamp
- **AND** targets outside those roots, replaced or escaping paths, the read-only trusted skills root and OMP-context reserved native state SHALL still be denied for ordinary writes and destructive sources/destinations

#### Scenario: YOLO boundary constrains only ACP-delegated file operations
- **GIVEN** a YOLO session
- **WHEN** the authorization boundary is documented or tested
- **THEN** it SHALL apply to ACP-delegated file operations only and SHALL NOT imply native-execution containment
- **AND** a state file inside the permitted broad workspace SHALL remain eligible except for the explicitly reserved OMP native state in an OMP callback context

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
- **THEN** it SHALL retain the broad role without restricted staging, command, extension or tool clamps; external escapes SHALL remain ineligible
- **AND** OMP callback contexts SHALL exclude reserved OMP native state from broad grants and use only the explicit current-session bash-artifact read exception there

#### Scenario: Distinguished shared failure categories
- **WHEN** an observation fails
- **THEN** invalid context/path/token, invalid/unavailable/overlapping root, outside-root/link escape, dangling/looping link, missing object, wrong type, canonicalization failure, changed path and shared trusted-root identity mismatch SHALL remain distinguished.

#### Scenario: Observation lifetime
- **WHEN** successful helper metadata is consumed
- **THEN** it SHALL remain scoped to the exact shared session/context generation and SHALL not become a reusable permission or race-proof guarantee.

#### Scenario: Consumer evidence limits
- **WHEN** real helper logic with temporary filesystems or deterministic metadata mocks passes
- **THEN** that evidence SHALL certify only the exercised helper/access behavior, not native parser/tool/proxy enforcement; real native claims SHALL require separately exercised native consumers.

## ADDED Requirements

### Requirement: Current Native OMP Artifact Provenance

OMP artifact access SHALL be bound to the requesting ACP session's persisted native identity and factory-selected data root. Model-supplied paths, Skill API IDs and unrelated session metadata SHALL confer no artifact authority. Missing, ambiguous or stale provenance SHALL deny artifact access without disabling unrelated session operations.

#### Scenario: Actual native UUID selects the directory
- **GIVEN** a pooled or per-spawn OMP session in restricted or native-YOLO mode whose Skill API ID differs from its native ACP UUID
- **WHEN** native session registration completes
- **THEN** the eligible artifact directory SHALL be the actual matching native journal path with `.jsonl` removed
- **AND** no `sessions/<Skill API ID>` directory or entire sessions/data tree SHALL become readable

#### Scenario: Discovery verifies persisted identity
- **WHEN** journal discovery finds zero matches, duplicate UUID candidates, a mismatched session header/cwd, malformed or over-limit metadata, or an unsafe filesystem component
- **THEN** no artifact capability SHALL be granted
- **AND** the session SHALL remain available for otherwise-authorized work

#### Scenario: Lazy artifact directory
- **GIVEN** the native journal exists while its artifact directory has not yet been created
- **WHEN** an unrelated workspace read occurs and native OMP later creates the expected artifact directory
- **THEN** the workspace read SHALL retain its normal outcome and a subsequent valid artifact read SHALL be eligible
- **AND** the client SHALL NOT create the directory or accept a changed journal/parent identity

#### Scenario: Reconnect and stale registrations
- **WHEN** a session disconnects, is replaced or removed, or successfully loads on a fresh connection
- **THEN** old artifact observations SHALL lose authority and loaded-session access SHALL use freshly resolved provenance bound to the new registration
- **AND** an outstanding request from an old generation SHALL deny without reading file content

### Requirement: Read-Only Current OMP Bash Artifact Access

ACP callbacks SHALL admit direct regular `<numeric-id>.bash.log` files in the current lifecycle-proven OMP artifact directory through protected read access. This exception SHALL be read-only in every permission mode and SHALL NOT broaden ordinary workspace extension rules or OpenCode behavior.

#### Scenario: Spilled bash output can be read
- **GIVEN** a current OMP artifact directory contains regular `17.bash.log` with known UTF-8 text
- **WHEN** the owning restricted or native-YOLO session reads it through the ACP callback
- **THEN** the callback SHALL return the requested text using existing line/limit semantics
- **AND** protected root-relative IO SHALL select the artifact role

#### Scenario: The exception stays exact
- **WHEN** a callback requests `other.log`, `17.read.log`, `17.bash.log.tmp`, a nested child, a directory or a special node using artifact authority
- **THEN** it SHALL deny before content IO
- **AND** `.log` files outside that capability SHALL retain their existing read outcome

#### Scenario: Artifact writes never inherit broad authority
- **GIVEN** the selected native state is beneath the session workspace and the session uses native-YOLO
- **WHEN** a callback write, edit permission or destructive request targets the current artifact, sibling artifact or native journal
- **THEN** the operation SHALL deny before mutation despite overlapping workspace membership
- **AND** native shell approval and ordinary non-state YOLO writes SHALL remain unchanged

### Requirement: OMP Native State Callback Isolation

For OMP callback contexts, native state SHALL be excluded from broad callback workspace, staging and shared grants. Only the current bash-artifact read exception SHALL admit callback content there. Physical containment, no-follow access and identity/generation fences SHALL apply without broader-root fallback. Connector-internal bounded metadata discovery SHALL confer no callback authority.

#### Scenario: Same-user sibling and mode state remain private
- **GIVEN** current and sibling sessions share a pooled root or have native state beneath the same user workspace
- **WHEN** the current session requests another session's artifact or journal, a sibling mode's files, native auth/database files, or the containing sessions directory
- **THEN** callbacks SHALL deny, including for sibling files ending in `.md` or `.jsonl`
- **AND** none SHALL inherit authority from the broad workspace role

#### Scenario: Link and replacement attacks fail closed
- **WHEN** a journal, artifact root, ancestor or target is linked outside its authorized physical root or replaced between observation and protected opening
- **THEN** access SHALL fail with one bounded existing context/path/access reason before reading the replacement
- **AND** contained request-time links SHALL also be rejected by the supported backend

#### Scenario: OpenCode and payload staging are unchanged
- **WHEN** OpenCode uses its existing tool-output command path policy or either engine stages Skill API payloads
- **THEN** those decisions SHALL retain their existing roots, command rules and literal session staging paths
- **AND** an OMP artifact capability SHALL confer no command execution or payload-containment authority

#### Scenario: Lifecycle metadata is distinct from callback access
- **WHEN** connector-internal discovery reads bounded candidate journal metadata through a no-follow descriptor-bound operation
- **THEN** that lifecycle-only operation SHALL NOT authorize model-requested journal reads or expose the metadata through callbacks
- **AND** callback requests SHALL remain subject to the exact artifact-role and filename policy

#### Scenario: Host-provisioned workspace aliases compare canonically
- **GIVEN** the configured workspace cwd is a host-provisioned alias of its canonical directory
- **WHEN** persisted journal provenance is checked
- **THEN** both the header cwd and registered cwd SHALL be canonicalized through the same path rule before comparison
- **AND** a valid alias SHALL remain usable without accepting a different workspace identity
