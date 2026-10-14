# Spec Delta

## ADDED Requirements

### Requirement: Shared Agent Recovery With OpenCode Context Checks

OpenCode recovery with supplied ownership or gate context SHALL preserve its existing pre-teardown and post-connect ownership checks and bounded failures. OMP SHALL recover from the connector options through the shared load-capability path without a separate ownership prerequisite.

#### Scenario: Optional OpenCode context absent
- **WHEN** OpenCode recovers without trailing context
- **THEN** the existing cwd-only restore and capability-absence false result SHALL remain unchanged.

#### Scenario: OpenCode mismatched supplied record
- **WHEN** OpenCode recovery supplies a foreign-agent, mode or namespace mismatch
- **THEN** the existing bounded ownership failure SHALL occur before disconnect, spawn, load or context mutation.

#### Scenario: Read-only supplied record
- **WHEN** OpenCode successfully recovers with matching ownership
- **THEN** the record SHALL remain unmodified and existing cache/model/reasoning restoration ordering SHALL be preserved.

#### Scenario: OMP normal recovery
- **WHEN** OMP reconnects with configured options and no ownership record
- **THEN** it SHALL reconnect and load if supported, return false with existing cleanup if unsupported, and retain session-isolated native error reporting.

### Requirement: Shared Session Gate Restoration After Native Load

Successful recovery SHALL preserve the requesting session’s context and sibling contexts, restore supplied gate context consistently with load cwd, and invoke an optional post-restore hook before success. Existing OpenCode optional-context ordering SHALL remain unchanged.

#### Scenario: Supplied session context
- **WHEN** load succeeds with the recovered session’s gate context
- **THEN** callbacks SHALL use its cwd, skill session ID and permission flags, with no sibling-context substitution.

#### Scenario: Cwd mismatch
- **WHEN** supplied gate context disagrees with load cwd
- **THEN** the existing post-load gate-context failure SHALL apply to that session only.

#### Scenario: No extra context
- **WHEN** recovery has no supplied extra context
- **THEN** the existing cwd-only restore SHALL be available; absence of a hook SHALL add no readiness gate.

#### Scenario: Sibling replay
- **WHEN** one session recovers while sibling contexts are cached
- **THEN** siblings SHALL replay unchanged and the recovered ID SHALL retain its own policy context.

#### Scenario: Hook and configuration ordering
- **WHEN** supported load returns config options and the caller supplies model/reasoning and a hook
- **THEN** cache refresh, stable-first model selection, best-effort reasoning, gate restore and optional hook SHALL run in existing order; catalog or hook failure SHALL stay session-isolated.

### Requirement: Session Runner Recovery Context And Response Fences

Existing reconnect-capable OMP runners SHALL pass their own cwd, MCP definitions, current gate context and resolved effort through shared recovery. OpenCode’s existing optional context behavior and all existing recovery triggers, response fences and duplicate-response prevention SHALL remain unchanged.

#### Scenario: All owning runners
- **WHEN** pooled/per-spawn message, lurk, spontaneous, research/correction, maintenance or reminder enters an existing recovery path
- **THEN** its own session context and resolved effort SHALL reach recovery without an OMP ownership prerequisite.

#### Scenario: Response already delivered
- **WHEN** reply, file or reaction was recorded before a crash
- **THEN** the existing fence SHALL prevent re-prompting and duplicate delivery.

#### Scenario: Restore or hook failure
- **WHEN** shared restore/configuration/hook recovery fails
- **THEN** the affected session SHALL follow existing bounded loss/error reporting while sibling sessions and lease release remain correct.

#### Scenario: Nonqualifying crash
- **WHEN** per-spawn crash does not match an existing recovery trigger
- **THEN** existing fail-fast behavior SHALL remain and no new retry trigger SHALL be introduced.

### Requirement: OpenCode Acquisition Ownership Bookkeeping

OpenCode SHALL retain its existing acquisition ownership record and read-only recovery consumption. OMP acquisition SHALL retain its resolved process mode and audit observation without requiring an ownership record for recovery.

#### Scenario: OpenCode acquisition
- **WHEN** OpenCode acquires a pooled or per-spawn process
- **THEN** its existing permission-mode/namespace record SHALL remain available to the optional recovery checks.

#### Scenario: OMP acquisition
- **WHEN** OMP acquires either mode’s process
- **THEN** the resolved mode SHALL still select that mode’s pool/process and audit observation, independent of recovery ownership metadata.

## REMOVED Requirements

### Requirement: Connector Recovery Ownership Verification Before Teardown

**Reason**: The mandatory OMP ownership prerequisite is cancelled.

**Migration**: Use Shared Agent Recovery With OpenCode Context Checks; preserve OpenCode optional-context outcomes. No record migration is required.

### Requirement: Gate-Context Restoration And Recovery Hook In Connector Recovery

**Reason**: The complete-context-only restoration contract is replaced by shared optional restoration.

**Migration**: Use Shared Session Gate Restoration After Native Load; retain supplied-context consistency, model/hook order and sibling isolation without an OMP prevalidation bridge.

### Requirement: Recovery Context Threading And Failure Classification In Session Runs

**Reason**: Acquisition-owned OMP recovery fields are removed.

**Migration**: Use Session Runner Recovery Context And Response Fences; preserve every runner's own context and existing retry triggers.

### Requirement: Session Ownership Record Written At Acquisition

**Reason**: OMP ownership recording is no longer a recovery prerequisite.

**Migration**: Use OpenCode Acquisition Ownership Bookkeeping for unchanged OpenCode records and retain OMP process-mode audit observations.

### Requirement: OMP Recovery Cannot Select a Context-Free Legacy Path

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: OMP uses the existing shared optional context recovery path; OpenCode’s existing checks remain. No ownership-record migration is performed.
