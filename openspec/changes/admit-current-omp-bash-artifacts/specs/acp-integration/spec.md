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

OMP native state SHALL be excluded from broad callback workspace, staging and shared grants. Only the current bash-artifact read exception SHALL admit content in that state. Physical containment, no-follow access and identity/generation fences SHALL apply without broader-root fallback.

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
