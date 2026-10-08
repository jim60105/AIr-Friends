## ADDED Requirements

### Requirement: Secure ACP Canonical Observation Consumption

Protected filesystem access SHALL consume the requesting session's current canonical root and target observations and one explicitly selected applicable root role, requiring exact session/context generation, valid canonical root-relative components and usable exact filesystem identities; access through a trusted-skills root SHALL be read-only.

#### Scenario: Selected staging authority cannot broaden
- **GIVEN** a target observation has independent workspace and staging roles
- **WHEN** a caller selects staging for an operation
- **THEN** access SHALL be bounded by that exact staging root's identity
- **AND** failure SHALL NOT retry under the broader workspace role

#### Scenario: Stale or incomplete observation is denied
- **WHEN** the observation belongs to another session/generation, lacks the selected role, contains invalid relative components, or lacks an exact usable root/target identity
- **THEN** access SHALL return one specific context, containment or identity failure
- **AND** it SHALL NOT perform protected content IO with a partial or guessed observation

#### Scenario: Trusted instruction content remains read-only
- **GIVEN** current predecessor-owned canonical skill identity and a valid trusted-skills role
- **WHEN** a caller reads the instruction through protected access
- **THEN** the instruction text SHALL be eligible for the same secure read operation
- **AND** a write selecting that role SHALL fail without mutation, including for a caller otherwise using broad YOLO permissions

#### Scenario: Successful observation does not authorize reinterpretation
- **GIVEN** a caller holds a successful canonical observation
- **WHEN** access would re-expand the original raw path, consult process environment or substitute another session
- **THEN** access SHALL operate only on the consumed canonical root-relative components and exact identities
- **AND** a successful canonical observation SHALL NOT be interpreted as permission

#### Scenario: Callback adoption and authorization remain dependent sinks
- **WHEN** a caller expects client callback adoption or per-mode/extension authorization as part of secure access
- **THEN** those SHALL remain covered by the separate dependent authorization change
- **AND** this requirement SHALL NOT be described as covering that sink

### Requirement: Root-Relative No-Follow ACP Content Access

Protected reads and writes SHALL establish an identity-checked canonical root capability and resolve the actual file beneath the explicitly selected root through a supported no-follow/root-relative mechanism, and SHALL reject request-time directory and final-file symlinks, including contained links, at the initially supported backend.

#### Scenario: Existing regular file is read and overwritten securely
- **GIVEN** an existing regular file under the selected root with matching observed identity
- **WHEN** protected access reads its UTF-8 text or overwrites it with new text
- **THEN** the returned/readback bytes SHALL match the requested operation, including empty and multibyte text
- **AND** an existing overwrite SHALL retain the opened file's identity rather than introduce a temp-file replacement protocol

#### Scenario: Canonical root alias cannot redirect IO
- **GIVEN** an owned configured root alias was observed resolving to a canonical directory
- **WHEN** that alias changes before access but the observed canonical directory is unchanged
- **THEN** the operation SHALL address the observed canonical root identity, not the changed alias destination
- **AND** a replacement of the canonical directory itself SHALL fail its identity check

#### Scenario: Parent and final symlinks cannot redirect content
- **WHEN** an observed or raced-in parent/final link targets an external path, sibling staging/workspace, another allowed root or an internal destination
- **THEN** access SHALL return the specific unsafe-traversal/containment failure without reading or mutating through that link
- **AND** external and sibling sentinel content SHALL remain unchanged

#### Scenario: Broad role does not add restricted policy
- **GIVEN** a caller independently selects an applicable broad workspace or shared role for an in-root file
- **WHEN** secure access is requested
- **THEN** the access mechanism SHALL preserve that physical boundary without adding staging-only, extension, LSP, command or tool denials
- **AND** it SHALL NOT claim to constrain native execution that bypasses ACP callbacks

#### Scenario: Newly introduced symlinks cannot redirect opened content
- **WHEN** a symlink is introduced or changed after secure opening beneath the selected root
- **THEN** content reads, truncation and writes SHALL use the same validated regular-file object that was securely opened, never a later path-based reopen
- **AND** the newly introduced symlink SHALL NOT redirect actual IO

#### Scenario: Precheck and confinement shortcuts are not equivalent
- **WHEN** resolution is attempted with ordinary realPath/lstat prechecks, final-component no-follow alone or optional subprocess confinement
- **THEN** those SHALL NOT be considered equivalent guarantees to the supported no-follow/root-relative mechanism
- **AND** a host-provisioned root alias SHALL remain usable only through its observed canonical root identity

### Requirement: Secure ACP Existing and New File Mutation Semantics

An existing overwrite SHALL securely open without truncation or create fallback, verify regular-file type and observed identity, then truncate and write that same opened object.

#### Scenario: Replacement file is not truncated
- **GIVEN** a regular file was observed for an existing overwrite
- **WHEN** it is replaced with a different regular file before the actual open/identity check
- **THEN** access SHALL report path-changed failure before truncation or writing
- **AND** the replacement file's bytes SHALL remain unchanged

#### Scenario: Exclusive new file creation succeeds
- **GIVEN** a prospective final file has one missing filename beneath an existing observed directory path and an existing selected root
- **WHEN** secure creation writes the supplied text
- **THEN** exactly that new regular file SHALL contain the supplied UTF-8 text under the selected root
- **AND** no directory SHALL be created as a side effect

#### Scenario: Raced-in new-file entry is denied
- **GIVEN** a prospective final file was observed absent
- **WHEN** another actor installs a regular file or symlink before exclusive creation
- **THEN** access SHALL fail without overwriting the installed entry or following its destination
- **AND** it SHALL NOT downgrade to an existing-file overwrite

#### Scenario: Lazy directories are an explicit failure
- **WHEN** the selected root is prospective or a new target requires one or more missing parent directories
- **THEN** access SHALL return unavailable-root or parent-missing failure without mkdir or partial directory creation
- **AND** the predecessor observation SHALL remain prospective rather than being rewritten as an authorizing root

#### Scenario: Invalid target and partial mutation remain honest
- **WHEN** a target is a directory/special node or a descriptor content operation fails
- **THEN** access SHALL return a specific type or IO failure and release its operation resources
- **AND** it SHALL perform no content mutation for a type denial and SHALL NOT claim rollback of bytes already safely written before an IO failure

#### Scenario: Creation requires a complete existing path
- **GIVEN** a caller requests secure creation of a new file beneath the selected existing root
- **WHEN** the final filename is absent but its complete directory path already exists
- **THEN** creation SHALL be exclusive so that a raced-in entry cannot be overwritten
- **AND** creation SHALL NOT occur when the complete directory path is missing or the root is prospective

#### Scenario: Partial mutation is reported honestly
- **WHEN** a content-IO failure occurs after a safely opened mutation has begun
- **THEN** the operation SHALL report failure rather than fabricate success
- **AND** the primitives SHALL NOT promise atomic replacement or rollback, so partial in-root content may remain

### Requirement: ACP Filesystem Replacement and Resource Failure Behavior

Detectable root, observed ancestor or final-object identity mismatch before the relevant content step SHALL fail closed; resolution that cannot establish containment, stale observations, disappearance or unexpected existence SHALL produce one bounded failure without automatic retry or ordinary path-IO fallback.

#### Scenario: Escaping replacement before open fails without side effect
- **WHEN** a test replaces the root, an ancestor or final file with an escaping link between observation and the actual constrained open
- **THEN** access SHALL fail without protected content IO through the replacement
- **AND** outside/sibling sentinel bytes SHALL remain unchanged and all acquired descriptors SHALL be released

#### Scenario: Validated descriptor cannot be redirected by path replacement
- **GIVEN** a regular file has already been securely opened and its identity verified under the selected root
- **WHEN** another actor replaces the pathname before content IO
- **THEN** content IO SHALL stay bound to the original opened object and SHALL NOT read or overwrite the replacement object
- **AND** documentation/tests SHALL identify this as descriptor binding, not universal replacement detection or namespace freezing

#### Scenario: Resolver or identity failure does not authorize fallback
- **WHEN** containment resolution reports a race/escape or an observed identity differs from the opened object's exact identity
- **THEN** access SHALL return its named path/containment failure before protected content IO
- **AND** it SHALL NOT retry under another root, recreate a disappeared existing file or invoke ordinary path-based read/write

#### Scenario: Short IO and cleanup errors are not false success
- **WHEN** native IO returns a short read/write, zero-progress write or failure, or cleanup itself fails
- **THEN** the operation SHALL either complete the requested byte transfer or return an honest bounded IO failure
- **AND** it SHALL attempt cleanup of every acquired operation resource without changing the primary failure to success

#### Scenario: Guarantee is descriptor binding, not namespace freezing
- **GIVEN** a securely opened inode is later renamed, unlinked, concurrently edited or path-replaced
- **WHEN** the guarantee is characterized in documentation or tests
- **THEN** it SHALL NOT be described as freezing the filesystem namespace, rejecting every possible in-root rename, revoking the already opened inode after external rename/unlink, preventing concurrent same-inode content edits or providing transactional rollback
- **AND** successfully opened identity-checked root/file objects SHALL remain the operation authority through actual descriptor IO

#### Scenario: Resources are released and diagnostics stay non-sensitive
- **WHEN** protected access completes or fails
- **THEN** all acquired resources SHALL be released on success and failure
- **AND** raw exception content, secrets and file contents SHALL NOT be emitted as access diagnostics

### Requirement: Explicit Secure ACP Filesystem Platform Policy

The initially supported secure backend SHALL require Linux little-endian x86_64/aarch64, GNU glibc at an explicitly owned supported system location, Linux constrained-open and descriptor-metadata support, exact usable identities and Deno FFI permission.

#### Scenario: Supported local filesystem uses the actual backend
- **GIVEN** the supported system library, native ABI and constrained-open/metadata capability are actually available
- **WHEN** protected access operates on a local temporary regular file
- **THEN** actual content IO SHALL use the supported backend and yield consumer-visible content/results
- **AND** a mock result alone SHALL NOT establish native capability

#### Scenario: Unsupported or sandbox-denied mechanism fails closed
- **WHEN** the OS/architecture/libc location is unsupported, FFI permission is denied, or the required constrained syscall/metadata is missing or seccomp-denied
- **THEN** access SHALL return the specific platform/capability failure without protected content IO
- **AND** the same denial SHALL apply for OpenCode/OMP and restricted/YOLO callers without an unsafe fallback

#### Scenario: Unsupported platform and missing capability fail closed
- **WHEN** the OS/ABI/libc is unsupported, a required library/symbol/permission is missing, a required syscall is unavailable under seccomp or an identity is unrepresentable
- **THEN** access SHALL fail closed with a bounded supported-platform/capability reason
- **AND** platform/version identification alone SHALL NOT establish syscall availability or prove the filesystem supplies required metadata

#### Scenario: No dynamic module loading or weaker portable fallback
- **WHEN** the supported backend is requested but unavailable, or an agent/workspace-selected native module is offered
- **THEN** the adapter SHALL NOT load agent/workspace-selected native modules, introduce a compiled/downloaded dependency or fall back to weaker portable access
- **AND** these platform requirements SHALL remain identical regardless of agent type or authorization mode

### Requirement: Secure ACP Access Evidence and Consumer Handoff

Acceptance SHALL exercise the actual access primitives with real canonical-observation logic, temporary filesystem fixtures and deterministic native-boundary mocks, and tests SHALL assert content, unchanged outside/sibling files, specific failures and descriptor ownership rather than source-string or forwarding-only assertions.

#### Scenario: Mocked replacement evidence has a concrete consumer effect
- **WHEN** an instrumented native boundary schedules a real fixture root/ancestor/final swap at an explicit operation boundary
- **THEN** the actual primitive SHALL produce the specified content/failure outcome with unchanged unauthorized sentinel files
- **AND** the evidence SHALL distinguish rejection before IO from descriptor binding after validation

#### Scenario: Local access success does not clear native gates
- **WHEN** unit/temp/mock checks pass while the predecessor source verdict remains incompatible or unresolved
- **THEN** the proposal's access evidence SHALL remain local primitive evidence only
- **AND** downstream application SHALL remain gated; real agent/platform/container/bwrap observations SHALL remain user-owned and unverified

#### Scenario: Documentation declares limits and sink readiness honestly
- **WHEN** the proposal documents supported behavior and its limits
- **THEN** documentation SHALL identify unsupported traversal/platform cases, missing-parent behavior, system-libc/FFI authority and descriptor/partial-IO limits
- **AND** existing callbacks SHALL NOT be described as hardened before the dependent sink cutover
